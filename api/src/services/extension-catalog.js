'use strict';
const { ObjectId } = require('mongodb');
const pricing = require('./pricing-authority');
const Money = require('../utils/currency');
const { stockFact } = require('./business-stock-facts');
const { MetricError } = require('./business-metrics');
function productSnapshot(product, branch, scope) {
  const stock = stockFact(product, {
    id: String(scope.branchId),
    license: String(scope.license),
    notificationRange: '0',
  });
  if (!stock) return null;
  const snapshot = pricing.resolve({ product, branch });
  const unit = pricing.calculate(
    snapshot,
    1,
    branch,
    Number(product.discount_amount || 0),
    Number(product.discount_percentage || 0)
  );
  return {
    id: String(product._id),
    description: product.name || product.item_name,
    barcode: String(product.barcode_id || product.itemid || ''),
    priceMinor: Money.toMinor(unit.total, branch),
    stockMilli: stock.availableMilli,
    stepMilli: 1,
    pricing: snapshot,
    unit: product.unit,
  };
}
async function prepareContext({ db, scope, state, command, resources = [] }) {
  if (!resources.includes('catalog.products')) return {};
  const ids = new Set((state.products || []).map((product) => product.id));
  for (const line of command.lines || []) if (line.productId) ids.add(line.productId);
  if (ids.size > 500 || [...ids].some((id) => !/^[a-f\d]{24}$/i.test(id))) {
    const error = new Error('extension_catalog_request_invalid');
    error.status = 422;
    throw error;
  }
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branchId, license: scope.license });
  if (!branch) {
    const error = new Error('extension_branch_unavailable');
    error.status = 403;
    throw error;
  }
  const rows = await db
    .collection('items')
    .find({ license: scope.license, _id: { $in: [...ids].map((id) => new ObjectId(id)) } })
    .toArray();
  const products = rows.map((product) => productSnapshot(product, branch, scope)).filter(Boolean);
  if (products.length !== ids.size) {
    const error = new Error('extension_product_unavailable');
    error.status = 409;
    throw error;
  }
  return { products, currency: Money.policy(branch), timeZone: branch.time_zone || 'UTC' };
}
// Search is bounded and branch-scoped before documents leave MongoDB. A cursor
// follows scanned rows, including unavailable items, so an invalid legacy item
// cannot trap the cashier on the same page or break the entire catalogue.
async function searchProducts({ db, scope, query = '', after = '' }) {
  if (
    typeof query !== 'string' ||
    query.length > 80 ||
    typeof after !== 'string' ||
    (after && !/^[a-f\d]{24}$/i.test(after))
  ) {
    const error = new Error('extension_catalog_request_invalid');
    error.status = 422;
    throw error;
  }
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    license: scope.license,
    $and: [{ $or: [{ branch_id: scope.branchId }, { 'branch_access.branch_id': scope.branchId }] }],
  };
  if (after) filter._id = { $gt: new ObjectId(after) };
  if (escaped)
    filter.$and.push({
      $or: ['name', 'barcode_id', 'itemid'].map((field) => ({
        [field]: { $regex: escaped, $options: 'i' },
      })),
    });
  const rows = await db
    .collection('items')
    .find(filter)
    .sort({ _id: 1 })
    .limit(51)
    .maxTimeMS(2000)
    .toArray();
  const page = rows.slice(0, 50);
  const products = [];
  let unavailableCount = 0;
  // Reuse the command-time authority. Search results are suggestions, never
  // grants to spend stock or accept prices submitted by the browser.
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branchId, license: scope.license });
  if (!branch) {
    const error = new Error('extension_branch_unavailable');
    error.status = 403;
    throw error;
  }
  for (const row of page) {
    try {
      const product = productSnapshot(row, branch, scope);
      if (!product) {
        unavailableCount++;
        continue;
      }
      const { pricing: _pricing, ...publicProduct } = product;
      products.push(publicProduct);
    } catch (error) {
      // Known catalogue/configuration errors may hide one unavailable item.
      // Database and unexpected failures must remain visible and retryable.
      if (!(error.statusCode === 409 || error instanceof MetricError)) throw error;
      unavailableCount++;
    }
  }
  return {
    products,
    unavailableCount,
    currency: Money.policy(branch),
    timeZone: branch.time_zone || 'UTC',
    next: rows.length > 50 ? String(page.at(-1)._id) : null,
  };
}
module.exports = { prepareContext, searchProducts };
