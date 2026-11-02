'use strict';
// Location labels are branch-item metadata, never a second stock balance.
function normalize(value) {
  if (!Array.isArray(value) || value.length > 12)
    throw new Error('Enter up to 12 stock locations.');
  const result = [];
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      Array.from(entry).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new Error('Invalid stock location.');
    const label = entry.trim();
    if (!label || label.length > 120)
      throw new Error('Stock locations must contain 1 to 120 characters.');
    if (!result.some((v) => v.toLowerCase() === label.toLowerCase())) result.push(label);
  }
  return result;
}
function read(row) {
  try {
    return normalize(row.stock_locations || []);
  } catch (_) {
    return [];
  }
}
module.exports = { normalize, read };
