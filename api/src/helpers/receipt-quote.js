const crypto = require('crypto');
const library = require('./thirukkural-library');

// No shared counter: offline tills follow their existing bill-number sequence.
// Persist this snapshot with the sale, so later library/settings edits cannot alter it.
function select(policy, saleNumber, existing) {
  if (existing !== undefined) return existing;
  if (!policy || policy.source === 'none') return null;
  const entries =
    policy.source === 'thirukkural'
      ? library
          .entries()
          .map((v) => ({
            text: v.lines.join('\n'),
            number: v.number,
            ...(policy.showQr === true
              ? { qr: v.qr, url: 'https://www.posnic.com/tools/thirukural/' + v.number }
              : {}),
          }))
      : policy.source === 'custom' && Array.isArray(policy.quotes)
        ? policy.quotes
            .filter((q) => typeof q === 'string' && q.trim())
            .map((q) => ({ text: q.trim() }))
        : [];
  if (!entries.length) return null;
  const sequence = String(saleNumber || '').match(/(\d+)$/);
  if (!saleNumber || (policy.order === 'sequential' && !sequence)) return null;
  const index =
    policy.order === 'sequential'
      ? Number((BigInt(sequence[1]) + BigInt(entries.length) - 1n) % BigInt(entries.length))
      : crypto.createHash('sha256').update(String(saleNumber)).digest().readUInt32BE(0) %
        entries.length;
  return { source: policy.source, version: '2026-10-19', ...entries[index] };
}

module.exports = { select };
