'use strict';

// Pure bill-discount projection. Callers must normalize legacy extra-discount
// fields before use and persist the result through the transfer allocation seal.
// No route/editor uses this until those legacy formats are reconciled.
function plan(side, amountMinor) {
  const fail = () => { throw new Error('Invalid bill discount allocation.'); };
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 1e12 ||
      !side || !Array.isArray(side.lines)) fail();
  const result = structuredClone(side), keys = new Set();
  let available = 0, originalTotal = 0;
  const originalComponents = {};
  for (const line of result.lines) {
    if (!line.lineKey || keys.has(line.lineKey) || !Array.isArray(line.components)) fail();
    keys.add(line.lineKey);
    const previous = line.billDiscountMinor ?? 0;
    if (!Number.isSafeInteger(previous) || previous < 0 || previous > 1e12) fail();
    const discount = line.components.find(row => row.key === 'discount');
    const names = new Set();
    let sum = 0;
    for (const component of line.components) {
      if (names.has(component.key) || !Number.isSafeInteger(component.minor) || Math.abs(component.minor) > 1e12) fail();
      names.add(component.key); sum += component.minor;
      originalComponents[component.key] = (originalComponents[component.key] || 0) + component.minor;
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
  if (originalTotal !== side.totalMinor || Object.keys(originalComponents).length !== Object.keys(side.components || {}).length ||
      Object.entries(originalComponents).some(([key, minor]) => side.components[key] !== minor)) fail();
  if (!Number.isSafeInteger(available) || amountMinor > available) fail();
  // Largest remainder with BigInt avoids losing a penny when monetary
  // weights multiplied by the discount exceed Number's exact integer range.
  const denominator = BigInt(available || 1), amount = BigInt(amountMinor);
  const shares = result.lines.map((line, index) => {
    const product = amount * BigInt(line.amountMinor);
    return { index, minor: Number(product / denominator), remainder: product % denominator };
  });
  const remaining = amountMinor - shares.reduce((sum, row) => sum + row.minor, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remaining; i++) ranked[i].minor++;
  result.totalMinor = 0; result.components = {};
  for (const [index, line] of result.lines.entries()) {
    const minor = shares[index].minor;
    line.components.find(row => row.key === 'discount').minor -= minor;
    line.billDiscountMinor = minor;
    line.amountMinor -= minor;
    result.totalMinor += line.amountMinor;
    for (const row of line.components) result.components[row.key] = (result.components[row.key] || 0) + row.minor;
  }
  return result;
}
module.exports = { plan };
