'use strict';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z][A-Za-z0-9.-]{1,31}$/;
function payee(branch) {
  const id = branch.branch_upi_id;
  const name = branch.branch_upi_name;
  return typeof id === 'string' &&
    id.length <= 80 &&
    ID.test(id) &&
    typeof name === 'string' &&
    name.trim() &&
    name.length <= 80 &&
    !/[<>]/.test(name) &&
    !Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ? { id, name }
    : null;
}
function update(data) {
  if (data.branch_upi_id === undefined && data.branch_upi_name === undefined) return {};
  if (typeof data.branch_upi_id !== 'string' || typeof data.branch_upi_name !== 'string')
    throw new Error('Enter the UPI ID and receiving name.');
  const fields = {
    branch_upi_id: data.branch_upi_id.trim(),
    branch_upi_name: data.branch_upi_name.trim(),
  };
  if (fields.branch_upi_id && !payee(fields))
    throw new Error('Enter a valid UPI ID and receiving name.');
  if (!fields.branch_upi_id) fields.branch_upi_name = '';
  return fields;
}
module.exports = { payee, update };
