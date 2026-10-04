'use strict';
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');

async function defaultTax(context) {
  const db = await BaseModel.getDb();
  const branch_id = new ObjectId(String(context.branchId));
  const license = new ObjectId(String(context.licenseId));
  const branch = await db.collection('branches').findOne({ _id: branch_id, license });
  if (!branch?.default_tax || !ObjectId.isValid(String(branch.default_tax)))
    throw new Error('Configure a default tax in Tax settings before using Quick sale.');
  const tax = await db.collection('grouptax').findOne({
    _id: new ObjectId(String(branch.default_tax)), branch_id, license,
  });
  if (!tax || tax.rate == null || !Number.isFinite(Number(tax.rate)) || Number(tax.rate) < 0)
    throw new Error('The default tax is unavailable. Check Tax settings.');
  return { id: String(tax._id), name: String(tax.name || 'Tax'), rate: Number(tax.rate), type: 'exclusive' };
}

async function applyDefaultTax(data, context) {
  const tax = await defaultTax(context);
  const expected = data.quick_sale_tax;
  if (expected && (expected.id !== tax.id || Number(expected.rate) !== tax.rate))
    throw new Error('Tax settings changed. Review the Quick sale amount again.');
  const amount = Number(data.items_selling_price);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000)
    throw new Error('Enter a valid Quick sale amount.');
  return { ...data, items_tax_id: tax.id, items_tax_name: tax.name,
    items_tax: tax.rate, items_tax_type: 'exclusive' };
}
module.exports = { defaultTax, applyDefaultTax };
