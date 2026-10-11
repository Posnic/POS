'use strict';

const SEARCH = ['name', 'sku', 'barcode', 'plu', 'supplier', 'category'];
const DISPLAY = ['sku', 'barcode', 'supplier', 'category', 'price', 'stock', 'image'];
const DEFAULT_SEARCH = ['name', 'sku', 'barcode', 'plu'];

function validate(key, value) {
  if (value === null) return null;
  const allowed = key === 'sales_search_fields' ? SEARCH : DISPLAY;
  if (
    !Array.isArray(value) ||
    value.some((field) => !allowed.includes(field)) ||
    (key === 'sales_search_fields' && !value.length)
  ) {
    throw new Error('Choose valid sales search fields; select at least one field to search.');
  }
  return [...new Set(value)];
}

function conditions(fields, query, regex) {
  const selected = Array.isArray(fields) && fields.length ? fields : DEFAULT_SEARCH;
  const columns = {
    name: ['name', 'translations.name'],
    sku: ['itemid', 'item_code'],
    barcode: ['barcode_id', 'barcodes'],
    supplier: ['supplier_name'],
    category: ['category_name'],
  };
  return selected.flatMap((field) =>
    field === 'plu'
      ? [
          { short_code: regex },
          ...(/^\d{1,6}$/.test(String(query)) ? [{ plu_code: String(query) }] : []),
        ]
      : (columns[field] || []).map((column) => ({ [column]: regex }))
  );
}

module.exports = { SEARCH, DISPLAY, DEFAULT_SEARCH, validate, conditions };
