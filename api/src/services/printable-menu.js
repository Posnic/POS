'use strict';
const { ObjectId } = require('mongodb');
const { currencySymbol } = require('../utils/currency-label');

/* Print uses the current branch's menu, even when no public store is configured.
   Neither a public channel exclusion nor a temporary stock-out removes a dish
   from a paper menu. Hidden, instant and deleted items still stay out. */
async function snapshot(db, context) {
  if (!ObjectId.isValid(String(context.branchId)) || !ObjectId.isValid(String(context.licenseId))) {
    throw new Error('Select a branch before opening its printable menu.');
  }
  const branchId = new ObjectId(String(context.branchId));
  const license = new ObjectId(String(context.licenseId));
  const branch = await db
    .collection('branches')
    .findOne(
      { _id: branchId, license },
      { projection: { branch_name: 1, currency: 1, currency_text: 1 } }
    );
  if (!branch) throw new Error('Branch not found.');
  const rows = await db
    .collection('items')
    .find(
      {
        license,
        $or: [{ branch_id: branchId }, { 'branch_access.branch_id': branchId }],
        del_status: { $nin: [1, '1', true] },
        is_deleted: { $ne: true },
        item_status: { $ne: 'instant' },
        show_on_menu: { $ne: false },
      },
      {
        projection: {
          name: 1,
          selling_price: 1,
          description: 1,
          diet: 1,
          category_id: 1,
          category_name: 1,
          sort_order: 1,
        },
      }
    )
    .sort({ category_name: 1, sort_order: 1, name: 1 })
    .toArray();
  const categories = new Map();
  for (const row of rows) {
    const id = String(row.category_id || row.category_name || 'uncategorized');
    if (!categories.has(id))
      categories.set(id, { id, name: row.category_name || 'Other', items: [] });
    categories.get(id).items.push({
      id: String(row._id),
      name: row.name || '',
      description: row.description || '',
      price: Number.isFinite(Number(row.selling_price)) ? Number(row.selling_price) : 0,
      diet: ['veg', 'vegan', 'egg', 'non_veg'].includes(row.diet) ? row.diet : '',
    });
  }
  return {
    branchId: String(branchId),
    name: branch.branch_name || '',
    currency: currencySymbol(branch.currency_text || branch.currency),
    categories: Array.from(categories.values()),
  };
}
module.exports = { snapshot };
