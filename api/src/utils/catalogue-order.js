'use strict';
// One ordering contract for the sale catalogue, price grid and exported worksheet.
// Category joins are tenant and branch scoped; missing categories follow numbered ones.
function stages() {
  return [
    { $lookup: { from: 'categories', let: { category: '$category_id', tenant: '$license', branch: '$branch_id' }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$_id', '$$category'] }, { $eq: ['$license', '$$tenant'] }, { $eq: ['$branch_id', '$$branch'] }] }, del_status: { $nin: [1, '1', true] }, is_deleted: { $ne: true } } },
      { $project: { sort_order: 1, name: 1 } }
    ], as: '_orderedCategory' } },
    { $set: {
      _categoryOrder: { $convert: { input: { $first: '$_orderedCategory.sort_order' }, to: 'double', onNull: 2147483647, onError: 2147483647 } },
      _categoryName: { $ifNull: [{ $first: '$_orderedCategory.name' }, { $ifNull: ['$category_name', ''] }] },
      _skuNumber: { $convert: { input: '$itemid', to: 'decimal', onNull: 1e30, onError: 1e30 } },
      _skuText: { $convert: { input: '$itemid', to: 'string', onNull: '', onError: '' } }
    } },
    { $sort: { _categoryOrder: 1, _categoryName: 1, _skuNumber: 1, _skuText: 1, name: 1, branch_id: 1, _id: 1 } }
  ];
}
module.exports = { stages };
