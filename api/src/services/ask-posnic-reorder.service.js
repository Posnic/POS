'use strict';

const moment = require('moment-timezone');
const crypto = require('crypto');
const numeric = (field) => ({ $convert: { input: field, to: 'double', onError: null, onNull: 0 } });
const string = (field) => ({ $convert: { input: field, to: 'string', onError: '', onNull: '' } });
const round = (value) => Math.round(value * 1000) / 1000;

function options(input = {}, question = '') {
  input = input || {};
  if (typeof input !== 'object' || Array.isArray(input))
    throw Object.assign(new Error('Planning options must contain lookback and coverage days.'), {
      statusCode: 400,
    });
  const bounded = (value, fallback, min) => {
    if (
      value !== undefined &&
      typeof value !== 'number' &&
      !(typeof value === 'string' && /^\d+$/.test(value.trim()))
    )
      throw Object.assign(new Error('Planning days must be whole numbers.'), { statusCode: 400 });
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < min || number > 90)
      throw Object.assign(new Error(`Planning days must be whole numbers from ${min} to 90.`), {
        statusCode: 400,
      });
    return number;
  };
  return {
    lookback_days: bounded(
      input.lookback_days ?? question.match(/(?:last|previous)\s+(\d+)\s+days/i)?.[1],
      30,
      7
    ),
    coverage_days: bounded(
      input.coverage_days ?? question.match(/next\s+(\d+)\s+days/i)?.[1],
      7,
      1
    ),
  };
}

async function read(model, input, at = new Date()) {
  if (!model?.branchId || !model?.licenseId)
    throw new Error('An authenticated shop and outlet are required.');
  const settings = options(input),
    timezone = moment.tz.zone(model.timeZone) ? model.timeZone : 'UTC';
  const end = moment.tz(at, timezone).startOf('day'),
    start = end.clone().subtract(settings.lookback_days, 'days');
  if (!end.isValid()) throw new Error('A valid planning date is required.');
  const sales = await model.getCollection('sales');
  // One bounded aggregation reads all three independently scoped sources. An
  // unavailable incoming-order source fails the plan instead of assuming zero.
  const [data = {}] = await sales
    .aggregate(
      [
        {
          $match: model.getContextMatch({
            date: { $gte: start.toDate(), $lt: end.toDate() },
            sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
          }),
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: string({ $ifNull: ['$items.item_id', '$items.item'] }),
            sold: {
              $sum: {
                $max: [0, numeric({ $ifNull: ['$items.item_quantity', '$items.quantity'] })],
              },
            },
          },
        },
        {
          $unionWith: {
            coll: 'purchase_orders',
            pipeline: [
              { $match: model.getContextMatch({ status: { $in: ['ordered', 'partial'] } }) },
              { $unwind: '$items' },
              {
                $project: {
                  _id: string('$items.item_id'),
                  incoming: {
                    $max: [
                      0,
                      {
                        $subtract: [numeric('$items.qty_ordered'), numeric('$items.qty_received')],
                      },
                    ],
                  },
                  incoming_invalid: {
                    $cond: [
                      {
                        $or: [
                          { $eq: [numeric('$items.qty_ordered'), null] },
                          { $eq: [numeric('$items.qty_received'), null] },
                          { $lt: [numeric('$items.qty_ordered'), 0] },
                          { $lt: [numeric('$items.qty_received'), 0] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            ],
          },
        },
        {
          $unionWith: {
            coll: 'items',
            pipeline: [
              {
                $match: model.getContextMatch({
                  track_inventory: true,
                  del_status: { $nin: [1, '1', true] },
                  item_status: { $nin: ['instant', 'inactive', 'draft', 'deleted'] },
                }),
              },
              {
                $project: {
                  _id: string('$_id'),
                  catalog: { $literal: 1 },
                  name: '$name',
                  stock: numeric('$available_quantity'),
                  reorder_point: numeric('$reorder_point'),
                  supplier_id: string('$supplier_id'),
                  supplier_name: '$supplier_name',
                  unit_cost: numeric('$cost_price'),
                  unit: '$unit',
                  barcode_id: '$itemid',
                },
              },
            ],
          },
        },
        {
          $group: {
            _id: '$_id',
            sold: { $sum: '$sold' },
            incoming: { $sum: '$incoming' },
            incoming_invalid: { $sum: '$incoming_invalid' },
            catalog: { $sum: '$catalog' },
            name: { $max: '$name' },
            stock: { $max: '$stock' },
            reorder_point: { $max: '$reorder_point' },
            supplier_id: { $max: '$supplier_id' },
            supplier_name: { $max: '$supplier_name' },
            unit_cost: { $max: '$unit_cost' },
            unit: { $max: '$unit' },
            barcode_id: { $max: '$barcode_id' },
          },
        },
        { $match: { catalog: 1, stock: { $ne: null }, reorder_point: { $gte: 0 } } },
        { $set: { daily_rate: { $divide: ['$sold', settings.lookback_days] } } },
        {
          $set: {
            target: {
              $max: ['$reorder_point', { $multiply: ['$daily_rate', settings.coverage_days] }],
            },
          },
        },
        {
          $set: {
            suggested: {
              $max: [0, { $subtract: [{ $subtract: ['$target', '$stock'] }, '$incoming'] }],
            },
          },
        },
        { $match: { suggested: { $gt: 0 } } },
        { $sort: { suggested: -1, name: 1, _id: 1 } },
        { $facet: { rows: [{ $limit: 100 }], count: [{ $count: 'value' }] } },
      ],
      { maxTimeMS: 15000, allowDiskUse: true }
    )
    .toArray();
  const rows = (data.rows || []).map((row) => {
    if (row.incoming_invalid)
      throw new Error('Check quantities on open purchase orders before planning a reorder.');
    const result = {
      item_id: row._id,
      item_name: row.name || 'Unnamed item',
      sold: round(row.sold),
      daily_rate: round(row.daily_rate),
      current_quantity: row.stock,
      incoming: round(row.incoming),
      reorder_point: row.reorder_point,
      target: round(row.target),
      qty_ordered: Math.ceil(row.suggested * 1000) / 1000,
      supplier_id: row.supplier_id || '',
      supplier_name: row.supplier_name || '',
      unit_cost: row.unit_cost,
      unit: row.unit || '',
      barcode_id: row.barcode_id || '',
    };
    if (
      ![
        result.current_quantity,
        result.qty_ordered,
        result.incoming,
        result.sold,
        result.target,
      ].every(Number.isFinite)
    )
      throw new Error('Check stock and sales quantities before using reorder suggestions.');
    result.planning_fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(result))
      .digest('hex');
    return result;
  });
  return {
    rows,
    count: data.count?.[0]?.value || 0,
    plan: {
      ...settings,
      timezone,
      from: start.toISOString(),
      to: end.clone().subtract(1, 'millisecond').toISOString(),
      as_of: new Date(at).toISOString(),
    },
  };
}

function answer(result) {
  const plan = result.plan,
    visible = result.rows.slice(0, 10);
  return {
    answer: `Reorder planning uses the previous ${plan.lookback_days} complete days of recorded sales to cover the next ${plan.coverage_days} days. Suggested quantity = the larger of the item's reorder point or average daily sales × coverage days, minus current stock and outstanding quantities on ordered/partially received purchase orders. Draft and cancelled orders are excluded. Quantities round up to 0.001 inventory units. Showing ${visible.length} of ${result.count} items needing stock. This is an average-rate estimate; check supplier lead times, pack sizes, seasonality and stockouts before ordering. Unsynced sales or orders are not included.`,
    metrics: visible.map((row) => ({
      label: row.item_name,
      value: `Suggest ${row.qty_ordered} ${row.unit} · ${row.current_quantity} in stock · ${row.incoming} incoming · ${row.daily_rate}/day${row.supplier_name ? '' : ' · supplier needed'}`,
    })),
    source: 'Recorded sales, tracked inventory and open purchase orders',
    link: '#/purchaseorders',
    ...(result.count
      ? {
          action: {
            type: 'purchase_order',
            source: 'demand',
            label: 'Review suggested purchase orders',
            ...options(plan),
          },
        }
      : {}),
  };
}

async function prepare(model, input, at = new Date()) {
  const result = await read(model, options(input), at);
  const groups = new Map(),
    skipped = [];
  let totalMinor = 0;
  for (const row of result.rows) {
    if (!row.supplier_name) {
      skipped.push(row.item_name);
      continue;
    }
    if (!Number.isFinite(row.unit_cost) || row.unit_cost < 0)
      throw new Error('Check item costs before preparing purchase orders.');
    totalMinor += Math.round(row.qty_ordered * row.unit_cost * 100);
    if (!Number.isSafeInteger(totalMinor))
      throw new Error('The planned order value is too large. Check quantities and costs.');
    const key = row.supplier_id || row.supplier_name;
    if (!groups.has(key))
      groups.set(key, {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        items: [],
      });
    groups.get(key).items.push(row);
  }
  if (!groups.size)
    throw new Error('No suggested quantities with an assigned supplier are available.');
  return {
    source: 'demand',
    orders: [...groups.values()],
    skipped_without_supplier: skipped,
    plan: result.plan,
    eligible_count: result.count,
    planned_count: result.rows.length,
  };
}

async function validate(model, payload) {
  if (!payload.plan?.as_of) throw new Error('Prepare a fresh reorder plan.');
  const result = await read(model, payload.plan, new Date(payload.plan.as_of));
  const byId = new Map(result.rows.map((row) => [row.item_id, row]));
  for (const order of payload.orders || [])
    for (const row of order.items || []) {
      const current = byId.get(row.item_id);
      if (
        !current ||
        current.planning_fingerprint !== row.planning_fingerprint ||
        current.qty_ordered !== row.qty_ordered ||
        current.supplier_id !== order.supplier_id ||
        current.supplier_name !== order.supplier_name
      )
        throw new Error(
          'Demand, inventory or incoming orders changed. Prepare a fresh reorder plan to review.'
        );
    }
}

module.exports = { options, read, answer, prepare, validate };
