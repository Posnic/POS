'use strict';

function normalize(value, baseUnit) {
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('Use at most eight selling units.');
  const seen = new Set([
    String(baseUnit || 'qty')
      .trim()
      .toLowerCase(),
  ]);
  return value.map((row) => {
    const unit = String(row.unit || '').trim();
    const factor = Number(row.factor);
    if (!unit || unit.length > 20 || seen.has(unit.toLowerCase()))
      throw new Error('Selling units must have different names.');
    if (!Number.isFinite(factor) || factor <= 0 || factor > 1000000)
      throw new Error('Enter a positive unit conversion.');
    seen.add(unit.toLowerCase());
    const price = row.price === '' || row.price == null ? null : Number(row.price);
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 1000000))
      throw new Error('Enter a valid selling-unit price.');
    return { unit, factor, price };
  });
}

function resolve(product, submittedUnit, previous) {
  const base = String(product.unit || 'qty');
  const unit = String(submittedUnit || base).trim();
  if (previous?.unit_conversion) {
    if (unit !== previous.unit_conversion.unit)
      throw new Error('Keep the original selling unit when editing this line.');
    return { ...previous.unit_conversion };
  }
  if (previous) {
    const oldUnit = previous.item_unit || base;
    if (unit !== oldUnit) throw new Error('Keep the original selling unit when editing this line.');
    return { unit: oldUnit, base_unit: oldUnit, factor: 1 };
  }
  if (unit === base) return { unit: base, base_unit: base, factor: 1 };
  const row = normalize(product.selling_units || [], base).find((row) => row.unit === unit);
  if (!row) throw new Error('This selling unit is no longer configured. Refresh the item.');
  return { unit: row.unit, base_unit: base, factor: row.factor, price: row.price };
}

function stockQuantity(line, quantity = line.item_quantity ?? line.quantity) {
  const factor = Number(line.unit_conversion?.factor ?? 1);
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || !Number.isFinite(factor) || factor <= 0)
    throw new Error('Invalid stock quantity conversion.');
  return Math.round(qty * factor * 1e9) / 1e9;
}

module.exports = { normalize, resolve, stockQuantity };
