'use strict';
const { ObjectId } = require('mongodb');
const parcel = require('../utils/parcel-details');
// Read-only projection of existing, scoped metadata; no packing or partner writes.
async function readParcelHints({ db, scope, mappings }) {
  const license = new ObjectId(String(scope.license)),
    branch_id = new ObjectId(String(scope.branchId));
  const projection = { projection: { parcel_cartons: 1 } };
  const [branch, account, legacy] = await Promise.all([
    db.collection('branch_channels').findOne({ license, branch_id }, projection),
    db.collection('branch_channels').findOne({ license, branch_id: null }, projection),
    db.collection('branches').findOne({ _id: branch_id, license }, projection),
  ]);
  const presetSource = [branch, account, legacy].find((x) => x?.parcel_cartons != null);
  const warnings = [];
  let cartons = [];
  try {
    cartons = parcel.cartons(presetSource?.parcel_cartons || []);
  } catch {
    warnings.push('Saved carton measurements need correction in Packaging settings.');
  }
  const valid = mappings.filter((x) => ObjectId.isValid(x.productId));
  const items = valid.length
    ? await db
        .collection('items')
        .find(
          { license, branch_id, _id: { $in: valid.map((x) => new ObjectId(x.productId)) } },
          { projection: { parcel_details: 1 } }
        )
        .toArray()
    : [];
  const products = valid.map((mapping) => {
    const item = items.find((x) => String(x._id) === mapping.productId);
    let measurements = null;
    try {
      measurements = item?.parcel_details ? parcel.product(item.parcel_details) : null;
    } catch {
      warnings.push('A linked product has invalid parcel measurements.');
    }
    return { sku: mapping.sku, measurements };
  });
  return { cartons, products, warnings: [...new Set(warnings)] };
}
module.exports = { readParcelHints };
