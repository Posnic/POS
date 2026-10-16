const { gststate } = require('../json/gst_state_code.json');

function stateKey(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const state = gststate.find(
    (row) => row.id === key.padStart(2, '0') || row.value.toLowerCase() === key
  );
  return state ? state.id : key;
}

function isInterState(supplierState, customerState) {
  const supplier = stateKey(supplierState);
  const customer = stateKey(customerState);
  return Boolean(supplier && customer && supplier !== customer);
}

function customerState(data, branch, customer) {
  const supplier = String(branch.state || '').trim();
  const isDefault =
    !data.customer_id ||
    (branch.default_customer && String(data.customer_id) === String(branch.default_customer));
  const explicit = String(data.customer_state || '').trim();
  if (explicit) return explicit;
  if (isDefault) return supplier;
  return String(data.customer_state || customer?.state || '').trim() || supplier;
}

function placeOfSupply(data, branch, customer) {
  return String(data.place_of_supply || '').trim() || customerState(data, branch, customer);
}
function validate(data) {
  for (const field of ['customer_state', 'place_of_supply']) {
    if (data[field] && !gststate.some((row) => row.id === stateKey(data[field])))
      throw new Error('Select a valid Indian state.');
  }
  const gstin = String(data.customer_gst_number || '')
    .trim()
    .toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin))
    throw new Error('Enter a valid customer GSTIN.');
  if (gstin && !data.customer_state)
    data.customer_state = gststate.find((row) => row.id === gstin.slice(0, 2))?.value || '';
  if (gstin && data.customer_state && gstin.slice(0, 2) !== stateKey(data.customer_state))
    throw new Error('GSTIN and customer state do not match.');
}
module.exports = { stateKey, isInterState, customerState, placeOfSupply, validate };
