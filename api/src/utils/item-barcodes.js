// Barcode identity is local to a shop branch. Variants are sellable items too.
const normalize = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const codes = (item = {}) => [
  ...new Set(
    [item.barcode_id, ...(Array.isArray(item.barcodes) ? item.barcodes : [])]
      .map(normalize)
      .filter(Boolean)
  ),
];

const label = (item = {}) => {
  const name = normalize(item.name) || String(item._id || 'Unnamed item');
  const variant = normalize(item.variant_value);
  return variant && !name.includes(variant) ? `${name} (${variant})` : name;
};

// Existing API messages are rendered by the legacy HTML toast widget.
const display = (value) =>
  String(value)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const branchScope = (branchId) => ({
  $or: [
    { 'branch_access.branch_id': branchId },
    { 'branch_access.0': { $exists: false }, branch_id: branchId },
  ],
});

const conflictMessage = (barcode, item) =>
  `Barcode "${display(barcode)}" is already used by item "${display(label(item))}". Use a different barcode for each item or variant in this branch.`;

async function findConflict(collection, candidateCodes, { branchId, licenseId, selfId } = {}) {
  if (!candidateCodes.length) return null;
  const item = await collection.findOne({
    license: licenseId,
    del_status: { $nin: [1, '1', true] },
    ...(selfId ? { _id: { $ne: selfId } } : {}),
    $and: [branchScope(branchId)],
    $or: [{ barcode_id: { $in: candidateCodes } }, { barcodes: { $in: candidateCodes } }],
  });
  if (!item) return null;
  const barcode = codes(item).find((code) => candidateCodes.includes(code)) || candidateCodes[0];
  return { barcode, item, message: conflictMessage(barcode, item) };
}

// A desktop API can receive an import and an item save together. Keep their
// check-and-write sequences ordered. Independently offline tills are still
// checked by the startup health scan after their catalogues synchronize.
const writes = new Map();
async function withWriteLock(context, operation) {
  const key = String(context.licenseId || '');
  const previous = writes.get(key) || Promise.resolve();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  writes.set(key, pending);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writes.get(key) === pending) writes.delete(key);
  }
}

module.exports = {
  normalize,
  codes,
  label,
  display,
  branchScope,
  conflictMessage,
  findConflict,
  withWriteLock,
};
