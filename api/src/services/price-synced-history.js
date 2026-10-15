'use strict';
// Read-only projection of applied rows already delivered by normal price-history
// sync. Never copy execution jobs/leases or infer the remote job's full outcome.
const { ObjectId } = require('mongodb');
function match(c, ids, batch) {
  return {
    license: new ObjectId(c.licenseId),
    branch_id: { $in: ids.map((id) => new ObjectId(id)) },
    batch_id: batch ? new ObjectId(batch) : { $type: 'objectId' },
    field: { $in: ['selling_price', 'company_price', 'mrp_price'] },
  };
}
function projection() {
  return [
    { $sort: { date: 1, _id: 1 } },
    {
      $group: {
        _id: '$batch_id',
        branch_id: { $first: '$branch_id' },
        branchIds: { $addToSet: '$branch_id' },
        note: { $first: '$note' },
        created_date: { $min: '$date' },
        effectiveAt: { $max: '$date' },
      },
    },
    { $set: { status: 'complete', syncedHistory: true } },
  ];
}
async function list(db, c, ids, localQuery, page, pageSize) {
  const result = await db
    .collection('price_history')
    .aggregate([
      { $match: match(c, ids) },
      ...projection(),
      // A local job is authoritative, even if it is pending or has issues.
      {
        $lookup: {
          from: 'price_sheet_jobs',
          localField: '_id',
          foreignField: '_id',
          as: 'localJob',
        },
      },
      { $match: { localJob: { $size: 0 } } },
      { $unset: 'localJob' },
      { $unionWith: { coll: 'price_sheet_jobs', pipeline: [{ $match: localQuery }] } },
      { $sort: { created_date: -1, _id: -1 } },
      {
        $facet: {
          jobs: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
          count: [{ $count: 'total' }],
        },
      },
    ])
    .toArray();
  return { jobs: result[0]?.jobs || [], total: result[0]?.count[0]?.total || 0, page, pageSize };
}
async function status(db, c, ids, batch, page, filter) {
  const query = match(c, ids, batch);
  const jobs = await db
    .collection('price_history')
    .aggregate([{ $match: query }, ...projection()])
    .toArray();
  if (!jobs.length) throw new Error('Price job not found in this branch');
  const total = await db.collection('price_history').countDocuments(query);
  const show = ['', 'changes', 'updated'].includes(filter);
  const rows = show
    ? await db
        .collection('price_history')
        .find(query)
        .sort({ date: 1, _id: 1 })
        .skip((page - 1) * 50)
        .limit(50)
        .toArray()
    : [];
  return {
    job: jobs[0],
    counts: { updated: total },
    total: show ? total : 0,
    page,
    rows: rows.map((r, i) => ({
      number: (page - 1) * 50 + i + 1,
      name: r.item_name,
      itemId: String(r.item_id),
      branch_id: r.branch_id,
      status: 'updated',
      changes: { [r.field]: { old: r.old_value, value: r.new_value } },
    })),
  };
}
module.exports = { list, status };
