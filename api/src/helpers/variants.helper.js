/**
 * Variant Helper Functions
 *
 * A variant's values are a set of CHOICES - "Size: 38, 40, 42". The one thing
 * a set cannot contain is the same member twice, and nothing enforced that:
 * saving Size as 38, 40, 40 stored 40 twice, the item form then offered it
 * twice, and both copies could be picked. That produced two items called
 * "Shirt / 40" - same name, same axis, different prices and stock, and no way
 * for anyone to tell which one the barcode meant.
 *
 * Collapsed rather than rejected on purpose. The second 40 carries no
 * information, so dropping it loses nothing a person meant to say - and
 * refusing the save would block real work over a slip we can obviously
 * resolve. Errors are for what we cannot decide; this we can.
 */

/**
 * Turn whatever the form sent into a clean, duplicate-free field list.
 *
 * Compared case- and space-insensitively: "40 " and "40" are the same size,
 * and "Red" and "red" are the same colour. Someone typing both meant one.
 *
 * The FIRST spelling wins, so the shop's own capitalisation survives - keeping
 * the later one would let a stray lowercase entry silently rename a value
 * that is already printed on labels.
 *
 * @param {Array} rawTypes - values as submitted (strings, or {name} objects)
 * @returns {Array<{name: String}>} - trimmed, non-empty, de-duplicated
 */
const normalizeVariantFields = (rawTypes) => {
  if (!Array.isArray(rawTypes)) return [];

  const seen = new Set();
  const fields = [];

  rawTypes.forEach((entry) => {
    let name = '';
    if (entry != null && typeof entry === 'object') {
      name = entry.name != null ? String(entry.name).trim() : '';
    } else if (entry != null) {
      name = String(entry).trim();
    }
    if (!name) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ name });
  });

  return fields;
};

module.exports = {
  normalizeVariantFields,
};
