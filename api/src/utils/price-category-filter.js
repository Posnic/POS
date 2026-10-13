'use strict';
const { ObjectId } = require('mongodb');

// Both the paged editor and full-sheet export must use the same OR filter.
module.exports = function priceCategoryFilter(value) {
  if (value == null || value === '') return null;
  const values = Array.isArray(value) ? value : String(value).split(',');
  if (values.length > 500) throw new Error('Select at most 500 categories');
  const ids = [...new Set(values.map((id) => String(id).trim()))];
  if (ids.some((id) => !/^[a-f\d]{24}$/i.test(id))) throw new Error('Invalid category identifier');
  return ids.length ? { $in: ids.map((id) => new ObjectId(id)) } : null;
};
