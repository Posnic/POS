'use strict';

const { ObjectId } = require('mongodb');
const demo = require('./demo-data');

const asNumber = (field) => ({ $convert: { input: field, to: 'double', onNull: 0, onError: 0 } });
const asDate = (field) => ({ $convert: { input: field, to: 'date', onNull: null, onError: null } });

module.exports = async function purchaseHistory(db, context, params) {
  const wall = {
    branch_id: new ObjectId(String(context.branchId)),
    license: new ObjectId(String(context.licenseId)),
  };
  if (params.supplier_id) wall.supplier_id = new ObjectId(String(params.supplier_id));
  const common = {
    id: { $toString: '$_id' },
    created: '$created_date',
    supplier: '$supplier_name',
    phone: '$supplier_phone',
    expected: asDate('$expected_date'),
  };
  const order = {
    ...common,
    kind: { $literal: 'po' },
    no: '$po_id',
    date: asDate('$order_date'),
    total: asNumber('$grand_total'),
    status: 1,
    ordered: { $sum: '$items.qty_ordered' },
    received: { $sum: '$items.qty_received' },
  };
  const receiving = {
    ...common,
    kind: { $literal: 'purchase' },
    no: '$receiving_id',
    date: asDate({ $ifNull: ['$date', '$updated_date'] }),
    total: asNumber({ $ifNull: ['$total_amount', '$items_total'] }),
    status: {
      $cond: [{ $eq: ['$receiving_status', 'Open'] }, 'ordered', { $toLower: '$receiving_status' }],
    },
    mismatch: '$invoice_total_mismatch',
    hasDoc: { $gt: [{ $size: { $cond: [{ $isArray: '$image' }, '$image', []] } }, 0] },
  };
  const match = {};
  if (typeof params.search === 'string' && params.search.trim()) {
    const tokens = params.search.trim().slice(0, 120).split(/\s+/);
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      params.exact === 'true'
        ? '^' + escape(tokens.join(' ')) + '$'
        : tokens.map((t) => '(?=.*' + escape(t) + ')').join(''),
      'i'
    );
    const fields = { receiving_id: 'no', supplier_name: 'supplier', supplier_phone: 'phone' };
    match.$or = (
      Object.hasOwn(fields, params.field) ? [fields[params.field]] : Object.values(fields)
    ).map((k) => ({ [k]: regex }));
  }
  if (params.status)
    match.status =
      params.status === 'ordered'
        ? { $in: ['draft', 'ordered'] }
        : params.status === 'received'
          ? { $in: ['closed', 'received'] }
          : String(params.status);
  for (const [key, field, op] of [
    ['from', 'date', '$gte'],
    ['to', 'date', '$lte'],
    ['dueFrom', 'expected', '$gte'],
    ['dueTo', 'expected', '$lt'],
  ]) {
    if (params[key]) match[field] = { ...match[field], [op]: new Date(params[key]) };
  }
  const sorts = {
    date_asc: { date: 1 },
    total_desc: { total: -1 },
    total_asc: { total: 1 },
    expected_asc: { missingExpected: 1, expected: 1 },
    supplier: { supplier: 1 },
  };
  const sort = {
    ...(Object.hasOwn(sorts, params.sort) ? sorts[params.sort] : { date: -1 }),
    created: -1,
    _id: -1,
  };
  const limit = Math.min(100, Math.max(1, parseInt(params.limit) || 10)),
    page = Math.max(1, parseInt(params.page) || 1);
  const [result] = await db
    .collection('purchase_orders')
    .aggregate([
      { $match: wall },
      { $project: order },
      {
        $unionWith: {
          coll: 'receivings',
          pipeline: [
            { $match: { ...wall, ...(await demo.filter(context)), is_deleted: { $ne: true } } },
            { $project: receiving },
          ],
        },
      },
      { $match: match },
      { $set: { missingExpected: { $eq: ['$expected', null] } } },
      {
        $facet: {
          list: [{ $sort: sort }, { $skip: (page - 1) * limit }, { $limit: limit }],
          count: [{ $count: 'n' }],
        },
      },
    ])
    .toArray();
  return { list: result.list, total: result.count[0]?.n || 0, current_page: page, per_page: limit };
};
