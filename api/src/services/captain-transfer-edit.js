'use strict';
const allocation = require('../utils/transfer-allocation');
const orderLine = require('../utils/order-line');
const { BSON } = require('mongodb');
const clone = value => BSON.EJSON.deserialize(BSON.EJSON.serialize(value));
const lineFields = ['name', 'item_name', 'quantity', 'item_quantity', 'qty', 'unit_price', 'item_base_price', 'item_price',
  'item_total', 'total', 'total_amount', 'item_discount', 'item_tax', 'tax_amount', 'tax', 'tax_type',
  'cgst_tax', 'sgst_tax', 'igst_tax', 'tax_components'];
const saleFields = ['sales_sub_total', 'subtotal', 'total', 'items_subtotal', 'items_total', 'sales_total',
  'discount', 'tax', 'sales_tax', 'round_off', 'sales_round_off'];
const quantity = line => Number(line.quantity ?? line.item_quantity ?? line.qty);

// Metadata-only changes must not recalculate transferred pennies using today's
// catalogue. Return null for financial edits; they need explicit reconciliation.
function metadata(sale, proposed, branch) {
  const saved = allocation.read(sale, branch);
  if (!saved) return null;
  for (const field of ['extra_discount', 'extra_discount_type', 'sale_extra_discount'])
    if (proposed[field] !== undefined && proposed[field] !== sale[field]) return null;
  const before = sale.items || [], after = proposed.items || [];
  if (before.length !== after.length || before.some((line, index) => !line || !after[index] ||
      orderLine.key(line) !== orderLine.key(after[index]) || orderLine.product(line) !== orderLine.product(after[index]) ||
      quantity(line) !== quantity(after[index]) || !!line.return !== !!after[index].return ||
      !!line.cancelled !== !!after[index].cancelled || line.status !== after[index].status)) return null;
  const result = { ...proposed, items: clone(after) };
  result.items.forEach((line, index) => {
    for (const field of lineFields) {
      if (before[index][field] === undefined) delete line[field];
      else line[field] = clone(before[index][field]);
    }
  });
  // Preserve historical aliases and omit newly calculated aliases which the
  // original bill did not have. The caller replaces its proposed $set fields.
  for (const field of saleFields) {
    if (sale[field] !== undefined) result[field] = clone(sale[field]);
    else delete result[field];
  }
  result.captain_transfer_allocation = allocation.seal({ ...sale, ...result }, branch, saved);
  return result;
}
// Reconcile reductions from the existing allocation, never current catalogue
// prices. Increases/new preparations and bill-level discount changes still need
// their own pricing policy. The ordinary editor owns cancellation history and
// stock side effects; this function only reconciles its monetary projection.
function reduce(sale, proposed, branch) {
  const saved = allocation.read(sale, branch);
  if (!saved || Number(sale.extra_discount || 0) || Number(sale.sale_extra_discount || 0)) return null;
  for (const field of ['extra_discount', 'extra_discount_type', 'sale_extra_discount'])
    if (proposed[field] !== undefined && proposed[field] !== sale[field]) return null;
  const { divide, units } = require('./captain-transfer-plan');
  const { applyMoney } = require('./captain-transfer-projection');
  const before = new Map((sale.items || []).filter(Boolean).map(line => [orderLine.key(line), line]));
  const seen = new Set(), side = { lines: [], components: {}, totalMinor: 0 };
  const result = { ...proposed, items: clone(proposed.items || []) };
  for (const line of result.items) {
    if (!line) return null;
    const key = orderLine.key(line), old = before.get(key);
    if (!old || seen.has(key) || orderLine.product(old) !== orderLine.product(line) ||
        !!old.return !== !!line.return || !!old.cancelled !== !!line.cancelled || old.status !== line.status) return null;
    seen.add(key);
    const count = units(quantity(line)), previous = units(quantity(old));
    if (!count || count > previous) return null;
    const allocated = saved.lines.find(row => row.lineKey === key);
    if (!allocated) return null;
    for (const field of lineFields) {
      if (old[field] === undefined) delete line[field];
      else line[field] = clone(old[field]);
    }
    for (const field of ['quantity', 'item_quantity', 'qty'])
      if (old[field] !== undefined) line[field] = count / 1000;
    const components = allocated.components.map(row => ({ key: row.key,
      minor: divide(row.minor, count, previous - count)[0] }));
    const amountMinor = components.reduce((sum, row) => sum + row.minor, 0);
    side.lines.push({ ...clone(allocated), quantity: count / 1000, components, amountMinor,
      ...(allocated.billDiscountMinor !== undefined ?
        { billDiscountMinor: divide(allocated.billDiscountMinor, count, previous - count)[0] } : {}) });
    side.totalMinor += amountMinor;
    for (const row of components) side.components[row.key] = (side.components[row.key] || 0) + row.minor;
  }
  if (side.totalMinor < 0) return null;
  return applyMoney(sale, result, branch, side);
}
// New preparations use the ordinary editor's server-priced line. Reconcile
// existing preparations separately so a new dish cannot reprice old food.
function additions(sale, proposed, branch) {
  const before = new Set((sale.items || []).filter(Boolean).map(orderLine.key));
  const after = proposed.items || [];
  if (after.some(line => !line)) return null;
  const fresh = after.filter(line => !before.has(orderLine.key(line)));
  if (!fresh.length) return null;
  const keys = after.map(orderLine.key);
  if (new Set(keys).size !== keys.length) return null;
  const retained = reduce(sale, { ...proposed, items: after.filter(line => before.has(orderLine.key(line))) }, branch);
  if (!retained) return null;
  const reconciled = new Map(retained.items.map(line => [orderLine.key(line), line]));
  const allocated = new Map(retained.captain_transfer_allocation.lines.map(line => [line.lineKey, line]));
  for (const line of fresh) {
    const priced = priceLine(sale, line, branch);
    if (!priced) return null;
    const key = orderLine.key(line);
    reconciled.set(key, clone(line));
    allocated.set(key, priced);
  }
  const side = { lines: keys.map(key => allocated.get(key)), components: {}, totalMinor: 0 };
  for (const line of side.lines) {
    side.totalMinor += line.amountMinor;
    for (const row of line.components) side.components[row.key] = (side.components[row.key] || 0) + row.minor;
  }
  const result = { ...proposed, items: keys.map(key => reconciled.get(key)) };
  return require('./captain-transfer-projection').applyMoney(sale, result, branch, side);
}
function priceLine(sale, line, branch) {
  const { snapshotFrom } = require('./guest-bill.service');
  const { units } = require('./captain-transfer-plan');
  if (line.return || line.cancelled || ['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) ||
    !units(quantity(line))) return null;
  const gross = Number(line.item_price ?? line.unit_price ?? line.item_base_price) * quantity(line);
  const total = Number(line.total_amount ?? line.item_total ?? line.total);
  const tax = Number(line.item_tax ?? line.tax_amount ?? 0), discount = Number(line.item_discount || 0);
  const base = gross - (line.tax_type === 'inclusive' ? tax : 0);
  if (![base, total, tax, discount].every(value => Number.isFinite(value) && value >= 0)) return null;
  // Tax labels infer their rate from the taxable base, not a gross
  // inclusive price or the amount before a line discount. Only this
  // one-line snapshot uses that basis; the sale retains its selling price.
  const taxableLine = { ...line, item_base_price: (base - discount) / quantity(line) };
  const snapshot = snapshotFrom([{ _id: sale._id, items: [taxableLine], sales_sub_total: base,
    sales_total: total, tax, discount, round_off: 0 }], branch, sale.table_number || '', { allowZero: true });
  return { ...snapshot.lines[0], lineKey: orderLine.key(line) };
}

// Add only the incremental portions at the editor's price. The original
// allocation (including rounding) belongs to the portions already ordered.
function increases(sale, proposed, branch) {
  const before = new Map((sale.items || []).filter(Boolean).map(line => [orderLine.key(line), line]));
  const after = proposed.items || [];
  if (after.some(line => !line)) return null;
  const growing = after.filter(line => before.has(orderLine.key(line)) && quantity(line) > quantity(before.get(orderLine.key(line))));
  if (!growing.length) return null;
  const capped = after.map(line => {
    const old = before.get(orderLine.key(line));
    if (!old || quantity(line) <= quantity(old)) return line;
    const result = { ...line };
    for (const field of ['quantity', 'item_quantity', 'qty']) if (result[field] !== undefined) result[field] = quantity(old);
    return result;
  });
  const retained = additions(sale, { ...proposed, items: capped }, branch) || reduce(sale, { ...proposed, items: capped }, branch);
  if (!retained) return null;
  const side = clone(retained.captain_transfer_allocation);
  const { units } = require('./captain-transfer-plan');
  const Money = require('../utils/currency'), policy = Money.policy(branch);
  for (const line of growing) {
    const key = orderLine.key(line), old = before.get(key);
    // A different price/rate needs a separate preparation to keep receipt
    // unit prices and tax percentages unambiguous for existing portions.
    const rate = item => Number(item.item_price ?? item.unit_price ?? item.item_base_price);
    if (rate(line) !== rate(old) || (old.tax !== undefined && Number(old.tax) !== Number(line.tax)) ||
        (old.tax_type !== undefined && old.tax_type !== line.tax_type)) return null;
    const count = units(quantity(line)), previous = units(quantity(old)), extra = count - previous;
    const increment = clone(line);
    for (const field of ['quantity', 'item_quantity', 'qty']) if (increment[field] !== undefined) increment[field] = extra / 1000;
    for (const field of ['total_amount', 'item_total', 'total', 'item_tax', 'tax_amount', 'item_discount'])
      if (increment[field] !== undefined) increment[field] = Money.fromMinor(Money.toMinor(Number(increment[field]) * extra / count, policy), policy);
    const priced = priceLine(sale, increment, branch);
    if (!priced) return null;
    const allocated = side.lines.find(row => row.lineKey === key);
    const parts = new Map(allocated.components.map(row => [row.key, row.minor]));
    for (const row of priced.components) parts.set(row.key, (parts.get(row.key) || 0) + row.minor);
    allocated.components = [...parts].map(([key, minor]) => ({ key, minor }));
    allocated.amountMinor += priced.amountMinor;
    allocated.quantity = count / 1000;
    const item = retained.items.find(row => orderLine.key(row) === key);
    for (const field of ['quantity', 'item_quantity', 'qty']) if (item[field] !== undefined) item[field] = count / 1000;
  }
  side.totalMinor = 0; side.components = {};
  for (const line of side.lines) {
    side.totalMinor += line.amountMinor;
    for (const row of line.components) side.components[row.key] = (side.components[row.key] || 0) + row.minor;
  }
  return require('./captain-transfer-projection').applyMoney(sale, retained, branch, side);
}
function reconcile(sale, proposed, branch) {
  const explicit = proposed.extra_discount !== undefined;
  const candidate = { ...proposed };
  if (explicit) {
    for (const field of ['extra_discount','extra_discount_type','sale_extra_discount']) {
      if (sale[field] === undefined) delete candidate[field];
      else candidate[field] = sale[field];
    }
  }
  const result = metadata(sale,candidate,branch) || reduce(sale,candidate,branch) ||
    additions(sale,candidate,branch) || increases(sale,candidate,branch);
  if (!result || !explicit) return result;
  const value = Number(proposed.extra_discount);
  const type = String(proposed.extra_discount_type ?? sale.extra_discount_type ?? 'amount').toLowerCase();
  if (!Number.isFinite(value) || value < 0 ||
      !['amount','price','fixed','percent','percentage'].includes(type)) return null;
  const percentage = ['percent','percentage'].includes(type);
  if (percentage && value > 100) return null;
  const discounts = require('./captain-transfer-discount');
  const clear = discounts.plan(result.captain_transfer_allocation,0);
  const Money = require('../utils/currency'), policy = Money.policy(branch);
  const base = Math.max(0,(clear.components.base || 0)+(clear.components.discount || 0));
  const amount = percentage ? Money.toMinor(Money.fromMinor(base,policy)*value/100,policy) : Money.toMinor(value,policy);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12) return null;
  const side = discounts.plan(clear,Math.min(amount,clear.totalMinor));
  // The allocated discount is already included in line/root amounts. Keep
  // legacy extra inputs zero so receipt/report readers cannot deduct it again.
  // Current bill-discount value is the sum of the tracked allocation shares.
  Object.assign(result,{extra_discount:0,sale_extra_discount:0,extra_discount_type:'amount'});
  return require('./captain-transfer-projection').applyMoney(sale,result,branch,side);
}
module.exports = { metadata, reduce, additions, increases, reconcile };
