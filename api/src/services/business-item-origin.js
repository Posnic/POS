'use strict';
const { BSON } = require('mongodb');
const { minorUnits } = require('./business-metrics');
const { MAX_LINES } = require('./business-item-allocation');
const validId = (value) => {
  const text = String(value ?? '').toLowerCase();
  if (!/^[a-f\d]{24}$/.test(text)) throw new Error('invalid_item_origin');
  return text;
};
function decimal(value) {
  // Retain decimal text; the reader applies the branch's currency precision.
  minorUnits(value, 3);
  const [whole, fraction = ''] = String(value).split('.');
  const tail = fraction.replace(/0+$/, '');
  return whole.replace(/^0+(?=\d)/, '') + (tail ? '.' + tail : '');
}
function mirror(line, primary, legacy, parse) {
  const values = [line[primary], line[legacy]].filter((value) => value != null);
  if (!values.length) throw new Error('invalid_item_origin');
  const parsed = values.map(parse);
  if (parsed.some((value) => value !== parsed[0])) throw new Error('conflicting_item_origin');
  return parsed[0];
}

/** Preserve original facts only before the first recorded return. Missing or
 * contradictory legacy facts stay unavailable; analytics never blocks a refund. */
function originalItemFacts(sale, capturedAt) {
  try {
    if (
      Object.hasOwn(sale, 'business_item_origin') ||
      !['Add', 'Edit', 'Partial', 'KOT'].includes(sale.sale_process) ||
      (sale.items_return !== undefined &&
        (!Array.isArray(sale.items_return) || sale.items_return.length)) ||
      (sale.return_refund_transactions !== undefined &&
        (!Array.isArray(sale.return_refund_transactions) ||
          sale.return_refund_transactions.length)) ||
      minorUnits(sale.items_return_total ?? 0, 3) !== 0 ||
      !Array.isArray(sale.items) ||
      !sale.items.length ||
      sale.items.length > MAX_LINES
    )
      return null;
    if (
      !(sale.date instanceof Date) &&
      !(
        typeof sale.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sale.date)
      )
    )
      return null;
    const date = new Date(sale.date),
      captured = new Date(capturedAt);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(captured.getTime())) return null;
    const lines = sale.items.map((line) => {
      const name = line.name ?? line.item_name;
      const unit = line.item_unit ?? 'qty';
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 300 ||
        typeof unit !== 'string' ||
        !unit.trim() ||
        unit.length > 32
      )
        throw new Error('invalid_item_origin');
      const quantity = mirror(line, 'quantity', 'item_quantity', decimal);
      if (!minorUnits(quantity, 3)) throw new Error('invalid_item_origin');
      return {
        itemId: mirror(line, 'item', 'item_id', validId),
        name: name.trim(),
        unit: unit.trim(),
        quantity,
        grossAmount: mirror(line, 'total', 'total_amount', decimal),
      };
    });
    const value = {
      schemaVersion: 1,
      saleId: validId(sale._id),
      branchId: validId(sale.branch_id),
      businessId: validId(sale.license),
      invoiceDate: date.toISOString(),
      capturedAt: captured.toISOString(),
      salesTotal: decimal(sale.sales_total),
      lines,
    };
    return BSON.calculateObjectSize(value) <= 128 * 1024 ? value : null;
  } catch {
    return null;
  }
}

/** Add facts to the same locked write that appends the return. No extra write,
 * no replacement of an existing origin, and no document-size failure caused by
 * optional analytics metadata. The supplied update remains untouched. */
function withOriginalItemFacts(sale, update, capturedAt) {
  const origin = originalItemFacts(sale, capturedAt);
  if (!origin) return update;
  try {
    const prospective = { ...sale, ...update.$set, business_item_origin: origin };
    for (const [field, value] of Object.entries(update.$push || {})) {
      if (value && typeof value === 'object' && Object.hasOwn(value, '$each')) return update;
      prospective[field] = [...(sale[field] || []), value];
    }
    if (BSON.calculateObjectSize(prospective) > 16 * 1024 * 1024 - 16384) return update;
    return { ...update, $set: { ...update.$set, business_item_origin: origin } };
  } catch {
    return update;
  }
}
module.exports = { originalItemFacts, withOriginalItemFacts };
