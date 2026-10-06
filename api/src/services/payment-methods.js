'use strict';
const { ObjectId } = require('mongodb');
const { countries } = require('../json/countries.json');

// Merchant acceptance markets, not the unrelated list of NRI phone-number countries.
// NPCI / PIB: March 2026 global acceptance list, plus Cambodia launched June 2026.
const UPI_COUNTRIES = new Set(['IN', 'AE', 'SG', 'BT', 'NP', 'LK', 'FR', 'MU', 'QA', 'KH']);
function defaults(branch) {
  const input = String(branch.country || '').trim().toLowerCase();
  const country = countries.find(c => String(c.id) === String(branch.country_id) ||
    c.sortname.toLowerCase() === input || c.value.toLowerCase() === input);
  return ['Cash', 'Card', ...(UPI_COUNTRIES.has(country?.sortname) ? ['Upi'] : [])];
}
function canonical(value) {
  const key = String(value || '').replace(/[\s_-]/g, '').toLowerCase();
  return ({ cash: 'Cash', card: 'Card', creditcard: 'Card', debitcard: 'Card', upi: 'Upi' })[key];
}
function enabled(rows, branch) {
  if (!branch.payment_methods_initialized && !rows.length) return ['Cash', 'Card', 'Upi'];
  const methods = new Set(rows.filter(r => r.enabled !== false).map(r => canonical(r.payment_field || r.payment_value)).filter(Boolean));
  // Old tills had an implicit Cash method. Explicitly disabled rows take priority.
  if (!branch.payment_methods_initialized && !rows.some(r => canonical(r.payment_field || r.payment_value) === 'Cash')) methods.add('Cash');
  return [...methods];
}
async function read(db, branch) {
  const rows = await db.collection('payment_method').find({ branch_id: branch._id, license: branch.license }).toArray();
  return enabled(rows, branch);
}
async function seed(collection, branch) {
  const now = new Date();
  for (const name of defaults(branch)) {
    const id = new ObjectId();
    await collection.updateOne({ branch_id: branch._id, license: branch.license, payment_field: name }, {
      $setOnInsert: { _id: id, payment_value: name, enabled: true,
        payment_fields: [{ field_id: id, field_value: name }],
        created_date: now, updated_date: now, created_by: branch.created_by || 'system' },
    }, { upsert: true });
  }
}
module.exports = { defaults, canonical, enabled, read, seed };
