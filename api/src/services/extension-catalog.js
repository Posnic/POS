'use strict';
const { ObjectId } = require('mongodb');
const pricing = require('./pricing-authority');
const Money = require('../utils/currency');
const { stockFact } = require('./business-stock-facts');
const { MetricError } = require('./business-metrics');
function productSnapshot(
  product,
  branch,
  scope,
  submitted,
  allowCounterPriceOverride = false,
  roundGrossUnit = false
) {
  const stock = stockFact(product, {
    id: String(scope.branchId),
    license: String(scope.license),
    notificationRange: '0',
  });
  if (!stock) return null;
  const snapshot = pricing.resolve({
    product,
    branch,
    allowCounterPriceOverride,
    roundGrossUnit,
    submitted:
      submitted === undefined && product.open_price === true ? product.selling_price : submitted,
  });
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
    // Retain sub-penny tax precision until the complete quantity is valued.
    priceSubminor: unit.totalSubminor,
    sellingPrice: snapshot.selling_price,
    stockMilli: stock.availableMilli,
    allowNegativeStock: product.negative_stock === true,
    stepMilli: 1,
    pricing: snapshot,
    unit: product.unit,
  };
}
async function prepareContext({
  db,
  scope,
  state,
  command,
  resources = [],
  selection,
  allowCounterPriceOverride = false,
  roundGrossUnit = false,
}) {
  if (!resources.includes('catalog.products')) return {};
  // A signed worker may name only the products required by this command.
  // Never accept descriptions/prices/scope from that projection or the caller.
  if (
    selection !== undefined &&
    (!selection ||
      !Array.isArray(selection.productIds) ||
      selection.productIds.length > 200 ||
      Object.keys(selection).some((key) => key !== 'productIds'))
  ) {
    const error = new Error('extension_catalog_request_invalid');
    error.status = 422;
    throw error;
  }
  const ids = new Set(
    selection === undefined
      ? (state.products || []).map((product) => product.id)
      : selection.productIds
  );
  if (selection === undefined)
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
  const source = ['basket.create', 'basket.update'].includes(command.type)
    ? command
    : [...(state.baskets || []), ...(state.adjustments || [])].find(
        (row) => row.id === (command.basketId || command.sourceId)
      );
  const inputs = new Map((source?.lines || []).map((line) => [line.productId, line.sellingPrice]));
  const products = rows
    .map((product) =>
      productSnapshot(
        product,
        branch,
        scope,
        allowCounterPriceOverride ||
          ['basket.create', 'basket.update'].includes(command.type) ||
          product.open_price === true ||
          product.item_status === 'instant' ||
          Number(product.selling_price || 0) <= 0
          ? inputs.get(String(product._id))
          : undefined,
        allowCounterPriceOverride,
        roundGrossUnit
      )
    )
    .filter(Boolean);
  if (products.length !== ids.size) {
    const error = new Error(
      'A selected product is unavailable in this shop. Restore its catalogue entry or cancel the ordinary basket.'
    );
    error.code = 'extension_product_unavailable';
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
