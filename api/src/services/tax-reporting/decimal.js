'use strict';

// Reporting uses exact decimal strings. Never silently round a source value or
// coerce missing/invalid evidence to zero. JSON output must not contain BigInt.
function decimal(value) {
  if (typeof value !== 'string' || !/^-?\d{1,30}(?:\.\d{1,12})?$/.test(value)) {
    throw new TypeError('Expected a decimal string with at most 12 decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function format(units, scale) {
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  return (sign + digits.slice(0, -scale) + '.' + digits.slice(-scale))
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

function sum(values) {
  const parsed = values.map(decimal);
  const scale = parsed.reduce((maximum, n) => Math.max(maximum, n.scale), 0);
  return format(
    parsed.reduce((total, n) => total + n.units * 10n ** BigInt(scale - n.scale), 0n),
    scale
  );
}

function negate(value) {
  const n = decimal(value);
  return format(-n.units, n.scale);
}

function nonNegative(value) {
  if (decimal(value).units < 0n) throw new RangeError('Expected a non-negative source amount');
  return sum([value]);
}

module.exports = { sum, negate, nonNegative };
