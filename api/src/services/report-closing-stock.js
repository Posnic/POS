'use strict';
const { ObjectId } = require('mongodb');

// Read the last audited balance before the report boundary. Never substitute
// today's item balance for a historical closing stock. No inventory is written.
async function closingStock(db, { branch, license, end, itemIds }) {
  const result = new Map();
  const ids = [...new Set(itemIds.map(String))].filter((id) => ObjectId.isValid(id));
  if (!ObjectId.isValid(branch) || !ObjectId.isValid(license) || !ids.length) return result;
  const rows = await db
    .collection('stocklogs')
    .aggregate([
      {
        $match: {
          branch_id: new ObjectId(branch),
          license: new ObjectId(license),
          view_item_id: { $in: ids.map((id) => new ObjectId(id)) },
          is_deleted: { $ne: true },
        },
      },
      {
        $addFields: {
          report_date: {
            $convert: {
              input: { $ifNull: ['$date', '$created_date'] },
              to: 'date',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { report_date: { $ne: null, $lt: end } } },
      { $sort: { report_date: -1, _id: -1 } },
      { $group: { _id: '$view_item_id', balance: { $first: '$closing_balance' } } },
    ])
    .toArray();
  for (const row of rows) {
    const value = row.balance;
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== '' &&
      Number.isFinite(Number(value))
    )
      result.set(String(row._id), Number(value));
  }
  return result;
}
module.exports = { closingStock };
