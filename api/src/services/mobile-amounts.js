'use strict';
// Decimal quantity contract: thousandths of the configured selling unit;
// prices and results remain integer minor currency units.
function lineAmounts(line) {
  const scale = line.quantityScale === 1000 ? 1000 : 1;
  const units = Math.round(line.quantity * scale);
  if (
    !Number.isSafeInteger(units) ||
    units <= 0 ||
    units / scale !== line.quantity ||
    !Number.isSafeInteger(line.price) ||
    line.price < 0 ||
    !Number.isInteger(line.taxBps) ||
    line.taxBps < 0 ||
    line.taxBps > 10000
  )
    throw Error('Invalid price or quantity.');
  const raw = BigInt(line.price) * BigInt(units);
  const round = (n, d) => Number((n * 2n + d) / (d * 2n));
  const base = round(raw, BigInt(scale));
  const tax = round(
    raw * BigInt(line.taxBps),
    BigInt(scale) * BigInt(line.taxInclusive ? 10000 + line.taxBps : 10000)
  );
  const amount = base + (line.taxInclusive ? 0 : tax);
  if (!Number.isSafeInteger(amount)) throw Error('Sale amount is too large.');
  return { amount, tax };
}
module.exports = { lineAmounts };
