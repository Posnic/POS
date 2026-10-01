'use strict';

// Pure bill-discount projection. Callers must normalize legacy extra-discount
// fields before use and persist the result through the transfer allocation seal.
// The editor uses this after transfer normalization has sealed those formats.
function plan(side, amountMinor) {
  const fail = () => {
    throw new Error('Invalid bill discount allocation.');
  };
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    amountMinor > 1e12 ||
    !side ||
    !Array.isArray(side.lines)
  )
    fail();
  const result = structuredClone(side),
    keys = new Set();
  let available = 0,
    originalTotal = 0;
  const originalComponents = {};
  for (const line of result.lines) {
    if (!line.lineKey || keys.has(line.lineKey) || !Array.isArray(line.components)) fail();
    keys.add(line.lineKey);
    const previous = line.billDiscountMinor ?? 0;
    if (!Number.isSafeInteger(previous) || previous < 0 || previous > 1e12) fail();
    const discount = line.components.find((row) => row.key === 'discount');
    const names = new Set();
    let sum = 0;
    for (const component of line.components) {
      if (
        names.has(component.key) ||
        !Number.isSafeInteger(component.minor) ||
        Math.abs(component.minor) > 1e12
      )
        fail();
      names.add(component.key);
      sum += component.minor;
      originalComponents[component.key] =
        (originalComponents[component.key] || 0) + component.minor;
    }
    if (sum !== line.amountMinor || (previous && (!discount || discount.minor > -previous))) fail();
    originalTotal += sum;
    // Restore only the discount applied by this planner. Original item and
    // inherited transfer discounts remain part of the bill's base amounts.
    if (discount) discount.minor += previous;
    else line.components.push({ key: 'discount', minor: 0 });
    line.amountMinor += previous;
    line.billDiscountMinor = 0;
    if (line.amountMinor < 0 || !Number.isSafeInteger(line.amountMinor)) fail();
    available += line.amountMinor;
  }
  if (
    originalTotal !== side.totalMinor ||
    Object.keys(originalComponents).length !== Object.keys(side.components || {}).length ||
    Object.entries(originalComponents).some(([key, minor]) => side.components[key] !== minor)
  )
    fail();
  if (!Number.isSafeInteger(available) || amountMinor > available) fail();
  // Largest remainder with BigInt avoids losing a penny when monetary
  // weights multiplied by the discount exceed Number's exact integer range.
  const denominator = BigInt(available || 1),
    amount = BigInt(amountMinor);
  const shares = result.lines.map((line, index) => {
    const product = amount * BigInt(line.amountMinor);
    return { index, minor: Number(product / denominator), remainder: product % denominator };
  });
  const remaining = amountMinor - shares.reduce((sum, row) => sum + row.minor, 0);
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  );
  for (let i = 0; i < remaining; i++) ranked[i].minor++;
  result.totalMinor = 0;
  result.components = {};
  for (const [index, line] of result.lines.entries()) {
    const minor = shares[index].minor;
    line.components.find((row) => row.key === 'discount').minor -= minor;
    line.billDiscountMinor = minor;
    line.amountMinor -= minor;
    result.totalMinor += line.amountMinor;
    for (const row of line.components)
      result.components[row.key] = (result.components[row.key] || 0) + row.minor;
  }
  return result;
}
// Identify the two legacy storage conventions from stored line amounts.
// This is read-only: do not guess if the persisted values disagree, and never
// infer a percentage from the final amount when the input type is missing.
function legacy(sale, branch) {
  const Money = require('../utils/currency'),
    policy = Money.policy(branch);
  const fail = () => {
    throw new Error('The saved discount needs reconciliation.');
  };
  const minor = (value) => {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number) || number < 0) fail();
    const amount = Money.toMinor(number, policy);
    if (!Number.isSafeInteger(amount) || amount > 1e12) fail();
    return amount;
  };
  const recorded = minor(sale.discount);
  const lines = (sale.items || []).filter(
    (line) =>
      line &&
      !line.return &&
      !line.cancelled &&
      !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
      Number(line.quantity ?? line.item_quantity ?? line.qty) > 0
  );
  const itemDiscount = lines.reduce((sum, line) => sum + minor(line.item_discount), 0);
  const type = String(sale.extra_discount_type || '')
    .trim()
    .toLowerCase();
  const raw = Number(sale.extra_discount ?? 0);
  if (!Number.isFinite(raw) || raw < 0) fail();
  let extra;
  if (sale.sale_extra_discount !== undefined && sale.sale_extra_discount !== null) {
    extra = minor(sale.sale_extra_discount);
  } else if (['percent', 'percentage'].includes(type)) {
    if (raw > 100 || sale.sales_sub_total === undefined) fail();
    const base = minor(sale.sales_sub_total) - itemDiscount;
    if (base < 0) fail();
    extra = Money.toMinor((Money.fromMinor(base, policy) * raw) / 100, policy);
  } else if (['', 'amount', 'price', 'fixed'].includes(type)) {
    extra = minor(raw);
  } else fail();
  if (!extra)
    return {
      storage: 'no-extra',
      itemDiscountMinor: recorded,
      billDiscountMinor: 0,
      totalDiscountMinor: recorded,
    };
  if (recorded === itemDiscount)
    return {
      storage: 'separate',
      itemDiscountMinor: itemDiscount,
      billDiscountMinor: extra,
      totalDiscountMinor: itemDiscount + extra,
    };
  if (recorded === itemDiscount + extra)
    return {
      storage: 'combined',
      itemDiscountMinor: itemDiscount,
      billDiscountMinor: extra,
      totalDiscountMinor: recorded,
    };
  fail();
}
// Attach the known legacy bill-discount share to the snapshot's existing
// discount components. Apportion within those components so a later clear can
// never restore more discount than that line actually received.
function track(lines, amountMinor) {
  if (!amountMinor) return;
  const weights = lines.map((line) =>
    Math.max(0, -(line.components.find((row) => row.key === 'discount')?.minor || 0))
  );
  const total = weights.reduce((sum, minor) => sum + minor, 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > total)
    throw new Error('The saved discount needs reconciliation.');
  const denominator = BigInt(total),
    amount = BigInt(amountMinor);
  const shares = weights.map((weight, index) => {
    const product = amount * BigInt(weight);
    return { index, minor: Number(product / denominator), remainder: product % denominator };
  });
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  );
  const remaining = amountMinor - shares.reduce((sum, row) => sum + row.minor, 0);
  for (let i = 0; i < remaining; i++) ranked[i].minor++;
  for (const row of shares) lines[row.index].billDiscountMinor = row.minor;
}
function editorValue(sale) {
  if (!sale.captain_transfer_allocation)
    return {
      extra_discount: sale.extra_discount || 0,
      extra_discount_type: sale.extra_discount_type || 'price',
    };
  const saved = require('../utils/transfer-allocation').read(
    sale,
    sale.captain_transfer_allocation
  );
  const minor = saved.lines.reduce((sum, line) => sum + (line.billDiscountMinor || 0), 0);
  const Money = require('../utils/currency');
  return {
    extra_discount: Money.fromMinor(minor, Money.policy(saved)),
    extra_discount_type: 'amount',
    discount_basis: Money.fromMinor(
      (saved.components.base || 0) + (saved.components.discount || 0) + minor,
      Money.policy(saved)
    ),
  };
}
module.exports = { plan, legacy, track, editorValue };
