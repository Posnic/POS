const { ObjectId } = require('mongodb');

// Clearing is a shared list action, not a financial void or hard deletion.
// Separate immutable markers avoid rewriting financial sales during offline sync.
async function clearAll(db, { branchId, licenseId, userId }) {
  // The authenticated controller passes a BSON ObjectId for real tenants.
  // Keep its type when matching sales and writing a synced visibility marker.
  const license =
    licenseId &&
    licenseId._bsontype === 'ObjectId' &&
    typeof licenseId.toHexString === 'function' &&
    ObjectId.isValid(licenseId)
      ? new ObjectId(licenseId.toHexString())
      : typeof licenseId === 'string' && licenseId.trim()
        ? ObjectId.isValid(licenseId) && /^[a-f\d]{24}$/i.test(licenseId)
          ? new ObjectId(licenseId)
          : licenseId
        : null;
  if (!ObjectId.isValid(String(branchId || '')) || !license || !userId)
    throw new Error('A signed-in branch is required to clear parked sales.');
  const branch = new ObjectId(String(branchId));
  const now = new Date();
  const sales = await db
    .collection('sales')
    .find({
      license,
      $or: [{ branch_id: branch }, { branch: branch }],
      sale_process: 'Hold',
    })
    .project({ _id: 1 })
    .toArray();
  let cleared = 0;
  for (let i = 0; i < sales.length; i += 500) {
    const result = await db.collection('settings').bulkWrite(
      sales.slice(i, i + 500).map((sale) => ({
        updateOne: {
          filter: { _id: 'parked-clear:' + String(sale._id) },
          update: {
            $setOnInsert: {
              kind: 'parked_sale_clearance',
              branch_id: branch,
              license,
              parked_sale_id: sale._id,
              cleared_by: String(userId),
              created_date: now,
              updated_date: now,
            },
          },
          upsert: true,
        },
      }))
    );
    cleared += result.upsertedCount || 0;
  }
  return { cleared };
}

function visibilityStages() {
  return [
    {
      $lookup: {
        from: 'settings',
        let: { key: { $concat: ['parked-clear:', { $toString: '$_id' }] }, tenant: '$license' },
        pipeline: [
          {
            $match: {
              kind: 'parked_sale_clearance',
              $expr: { $and: [{ $eq: ['$_id', '$$key'] }, { $eq: ['$license', '$$tenant'] }] },
            },
          },
        ],
        as: '_parkedClearance',
      },
    },
    {
      $match: {
        $or: [{ sale_process: { $ne: 'Hold' } }, { '_parkedClearance.0': { $exists: false } }],
      },
    },
    { $project: { _parkedClearance: 0 } },
  ];
}

module.exports = { clearAll, visibilityStages };
