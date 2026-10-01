'use strict';
const { activeCatalog } = require('./ask-posnic-catalog');

function scopedMatch(model, range) {
  if (!model?.branchId || !model?.licenseId)
    throw new Error('An authenticated shop and outlet are required.');
  const from = new Date(range?.start_date),
    to = new Date(range?.end_date);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to - +from > 367 * 86400000)
    throw new Error('Choose a valid report period up to one year.');
  return model.getContextMatch({
    date: { $gte: from, $lte: to },
    sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
  });
}
const string = (value) => ({ $convert: { input: value, to: 'string', onError: '', onNull: '' } });
const number = (value) => ({ $convert: { input: value, to: 'double', onError: 0, onNull: 0 } });
const round = (value) => Math.round(Number(value || 0) * 100) / 100;

async function read(model, range, intent) {
  const match = scopedMatch(model, range);
  const sales = await model.getCollection('sales');
  let pipeline;
  if (['slow_items', 'no_sale_items'].includes(intent)) {
    // Aggregate sales once, then join the scoped catalog by union/group. This
    // includes unsold stock without running a sales query for every item.
    pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: string('$items.item_id'),
          units: { $sum: number({ $ifNull: ['$items.item_quantity', '$items.quantity'] }) },
        },
      },
      {
        $unionWith: {
          coll: 'items',
          pipeline: [
            {
              $match: model.getContextMatch({
                available_quantity: { $gt: 0 },
                ...activeCatalog(true),
              }),
            },
            {
              $project: {
                _id: string('$_id'),
                label: '$name',
                stock: '$available_quantity',
                unit: { $ifNull: ['$unit', ''] },
                catalog: { $literal: 1 },
                units: { $literal: 0 },
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$_id',
          units: { $sum: '$units' },
          stock: { $max: '$stock' },
          label: { $max: '$label' },
          unit: { $max: '$unit' },
          catalog: { $max: '$catalog' },
        },
      },
      { $match: { catalog: 1, ...(intent === 'no_sale_items' ? { units: 0 } : {}) } },
      { $sort: { units: 1, stock: -1, label: 1, _id: 1 } },
      { $facet: { rows: [{ $limit: 10 }], count: [{ $count: 'value' }] } },
    ];
  } else if (intent === 'category_performance') {
    pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $set: {
          category_key: string('$items.category_id'),
          category_label: { $ifNull: ['$items.category_name', ''] },
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $ne: ['$category_key', ''] },
              '$category_key',
              { $concat: ['name:', '$category_label'] },
            ],
          },
          label: { $max: '$category_label' },
          units: { $sum: number({ $ifNull: ['$items.item_quantity', '$items.quantity'] }) },
          amount: { $sum: number({ $ifNull: ['$items.total_amount', '$items.total'] }) },
        },
      },
      { $sort: { amount: -1, _id: 1 } },
      {
        $facet: {
          rows: [{ $limit: 10 }],
          count: [{ $count: 'value' }],
          total: [{ $group: { _id: null, amount: { $sum: '$amount' } } }],
        },
      },
    ];
  } else if (intent === 'customer_segments') {
    pipeline = [
      { $match: match },
      {
        $set: {
          customer_key: {
            $cond: [
              { $eq: [{ $toLower: string('$customer_name') }, 'walk-in-customer'] },
              '',
              string({
                $convert: { input: '$customer_id', to: 'objectId', onError: null, onNull: null },
              }),
            ],
          },
        },
      },
      {
        $group: {
          _id: '$customer_key',
          transactions: { $sum: 1 },
          amount: { $sum: '$items_total' },
        },
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$_id', ''] },
              'unidentified',
              { $cond: [{ $gt: ['$transactions', 1] }, 'repeat', 'single'] },
            ],
          },
          customers: { $sum: { $cond: [{ $eq: ['$_id', ''] }, 0, 1] } },
          transactions: { $sum: '$transactions' },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ];
  } else throw new Error('Unsupported commerce insight.');
  const result = await sales
    .aggregate(pipeline, { maxTimeMS: 15000, allowDiskUse: true })
    .toArray();
  if (intent === 'customer_segments')
    return {
      rows: result.map((row) => ({
        segment: row._id,
        customers: row.customers,
        transactions: row.transactions,
        amount: round(row.amount),
      })),
    };
  const data = result[0] || {};
  return {
    rows: (data.rows || []).map((row) => ({
      id: row._id,
      label:
        row.label ||
        (intent === 'category_performance'
          ? row._id === 'name:'
            ? 'Uncategorized'
            : 'Unnamed category'
          : 'Unnamed item'),
      units: Number(row.units || 0),
      ...(intent === 'category_performance'
        ? { amount: round(row.amount) }
        : { stock: Number(row.stock || 0), unit: row.unit || '' }),
    })),
    count: data.count?.[0]?.value || 0,
    ...(intent === 'category_performance' ? { total: round(data.total?.[0]?.amount) } : {}),
  };
}

function answer(data, intent, period) {
  const selected = String(period).replace(/_/g, ' ');
  if (['slow_items', 'no_sale_items'].includes(intent))
    return {
      answer: data.count
        ? `${intent === 'no_sale_items' ? `${data.count} stocked products had no recorded sales` : 'The slowest-selling stocked products'} for ${selected}. Showing ${data.rows.length} of ${data.count} eligible products. Quantities follow completed and partially returned sales; inactive and out-of-stock items are excluded.`
        : `No eligible stocked products ${intent === 'no_sale_items' ? 'without recorded sales ' : ''}were found for ${selected}.`,
      metrics: data.rows.map((row) => ({
        label: row.label,
        value: `${row.units} sold · ${row.stock}${row.unit ? ` ${row.unit}` : ''} in stock`,
      })),
      source: 'Sales quantities and current inventory',
      link: '#/itemReport',
    };
  if (intent === 'category_performance')
    return {
      answer: data.count
        ? `Category sales for ${selected}: showing the top ${data.rows.length} of ${data.count} categories. Categories use the names saved on each sale; line totals may differ from bill totals after bill-level discounts or charges.`
        : `No category sales were recorded for ${selected}.`,
      metrics: [
        { label: 'All category line totals', value: data.total.toFixed(2) },
        ...data.rows.map((row) => ({
          label: row.label,
          value: `${row.amount.toFixed(2)} · ${row.units} sold`,
        })),
      ],
      source: 'Sale line categories',
      link: '#/categoryReport',
    };
  const labels = {
    single: 'One-purchase customers',
    repeat: 'Repeat-purchase customers',
    unidentified: 'Unidentified sales',
  };
  return {
    answer: data.rows.length
      ? `Customer purchase segments for ${selected}. Repeat means two or more recorded purchases within this period at this outlet, not lifetime loyalty. Unidentified sales are counted as transactions, not distinct customers.`
      : `No customer purchases were recorded for ${selected}.`,
    metrics: data.rows.map((row) => ({
      label: labels[row.segment],
      value: `${row.segment === 'unidentified' ? '' : `${row.customers} customers · `}${row.transactions} transactions · ${row.amount.toFixed(2)}`,
    })),
    source: 'Sales grouped by customer purchase frequency',
    link: '#/sales',
  };
}

module.exports = { read, answer };
