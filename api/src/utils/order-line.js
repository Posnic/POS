'use strict';

// Product identity answers what was ordered; line identity answers which guest's
// preparation was ordered. Never use an array position as a persisted identity.
function product(line) {
  return String(line.item_id || line.product_id || line.item || line._id || '');
}
function id(line) {
  const value = line.line_id;
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw new Error('invalid_order_line');
  }
  return value;
}
function key(line) {
  return id(line) || product(line);
}
function identity(line) {
  const value = id(line);
  return value ? { line_id: value } : {};
}
function validate(lines) {
  const seen = new Set();
  for (const line of lines) {
    const value = key(line);
    if (!value || seen.has(value)) throw new Error('ambiguous_order_lines');
    seen.add(value);
  }
}
module.exports = { product, id, key, identity, validate };
