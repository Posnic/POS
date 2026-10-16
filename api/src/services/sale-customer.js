'use strict';
const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const validator = require('validator');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function customerId(scope, name) {
  return new ObjectId(
    createHash('sha256')
      .update(
        JSON.stringify([
          'sale-customer',
          String(scope.license),
          String(scope.branchId),
          name.trim().replace(/\s+/g, ' ').toLowerCase(),
        ])
      )
      .digest('hex')
      .slice(0, 24)
  );
}

// Planning is read-only: failed validation, previews and abandoned baskets
// must never create contacts. The committed sale is the durable recovery record.
async function plan(db, scope, data) {
  if (data.create_customer_on_save !== true || data.customer_id) return null;
  const name = String(data.customer_name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length > 200) throw new Error('Customer name is too long.');
  for (const [key, limit] of [
    ['phone', 40],
    ['email', 254],
    ['address', 500],
  ]) {
    if (String(data['customer_' + key] || '').length > limit)
      throw new Error('Customer ' + key + ' is too long.');
  }
  const email = String(data.customer_email || '').trim();
  if (email && !validator.isEmail(email)) throw new Error('Enter a valid customer email.');
  const collection = db.collection('customers');
  const matches = await collection
    .find({
      license: scope.license,
      branch_id: scope.branchId,
      is_deleted: { $ne: true },
      name: new RegExp('^' + escape(name) + '$', 'i'),
    })
    .limit(2)
    .toArray();
  if (matches.length > 1)
    throw new Error('More than one customer has this name. Select the correct customer.');
  if (matches.length) return { id: matches[0]._id, pending: false, customer: matches[0] };
  const id = customerId(scope, name);
  if (await collection.findOne({ _id: id, is_deleted: true }))
    throw new Error('This customer was deleted. Restore the customer or use a different name.');
  if (
    email &&
    (await collection.findOne({ license: scope.license, email, is_deleted: { $ne: true } }))
  )
    throw new Error('This email belongs to a saved customer. Select that customer.');
  return { id, pending: true };
}

async function finish(db, scope, saleId) {
  const sales = db.collection('sales');
  const sale = await sales.findOne({
    _id: new ObjectId(saleId),
    license: scope.license,
    branch_id: scope.branchId,
    customer_creation_pending: true,
  });
  if (!sale) return;
  const id = customerId(scope, sale.customer_name);
  if (String(id) !== String(sale.customer_id))
    throw new Error('Customer creation identity mismatch.');
  const now = new Date();
  const customer = {
    _id: id,
    name: sale.customer_name,
    license: scope.license,
    branch_id: scope.branchId,
    branch_name: sale.branch_name || '',
    branch_access: [{ branch_id: scope.branchId, branch_name: sale.branch_name || '' }],
    phone: sale.customer_phone || '',
    address: sale.customer_address || '',
    state: sale.customer_state || '',
    country: sale.customer_country || '',
    gst_type: sale.customer_gst_type || 'consumer',
    gst_number: sale.customer_gst_number || '',
    balance: 0,
    wallet: 0,
    partial_balance: false,
    is_deleted: false,
    created_date: now,
    updated_date: now,
    created_by: sale.created_by || '',
    created_by_id: sale.created_by_id,
  };
  if (sale.customer_email) customer.email = sale.customer_email;
  // Stable across concurrent saves and offline tills; never overwrite details,
  // balances, or a later deletion when replaying a saved sale.
  try {
    await db
      .collection('customers')
      .updateOne({ _id: id }, { $setOnInsert: customer }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000 || !(await db.collection('customers').findOne({ _id: id })))
      throw error;
  }
  await sales.updateOne(
    { _id: sale._id, license: scope.license, branch_id: scope.branchId },
    { $set: { customer_creation_pending: false, updated_date: now } }
  );
}

async function recover(db, scope, query) {
  if (!scope.license || !scope.branchId) return;
  const pending = await db
    .collection('sales')
    .find({
      license: scope.license,
      branch_id: scope.branchId,
      customer_creation_pending: true,
      customer_name: new RegExp(escape(String(query).slice(0, 200)), 'i'),
    })
    .limit(20)
    .toArray();
  for (const sale of pending) await finish(db, scope, sale._id);
}
module.exports = { customerId, plan, finish, recover };
