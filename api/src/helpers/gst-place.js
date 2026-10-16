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
  if (isDefault) return supplier;
  return String(data.customer_state || customer?.state || '').trim() || supplier;
}

module.exports = { stateKey, isInterState, customerState };
