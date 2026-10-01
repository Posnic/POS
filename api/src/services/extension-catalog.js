'use strict';
const { ObjectId } = require('mongodb');
const pricing = require('./pricing-authority');
const Money = require('../utils/currency');
const { stockFact } = require('./business-stock-facts');
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
  const products = rows
    .map((product) => {
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
    })
    .filter(Boolean);
  if (products.length !== ids.size) {
    const error = new Error('extension_product_unavailable');
    error.status = 409;
    throw error;
  }
  return { products, currency: Money.policy(branch), timeZone: branch.time_zone || 'UTC' };
}
module.exports = { prepareContext };
