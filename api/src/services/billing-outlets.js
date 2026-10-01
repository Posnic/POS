'use strict';
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const SettingsRepository = require('../repositories/settings.repository');
async function enabled(context) {
  const result = await new SettingsRepository().resolveGroup('features', context);
  if (!result.status) fail('Could not load billing outlet settings. Please retry.');
  return result.data.values.module_billing_outlets_enable === true;
}
const money = (value) => Math.round(Number(value) * 100) / 100;
const fail = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
};
const scope = (branch, license) => ({
  branch_id: new ObjectId(String(branch)),
  license: new ObjectId(String(license)),
});
function validate(input) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 60) fail('Outlet name must be between 1 and 60 characters.');
  const number = (key, min, max) => {
    const value = Number(input[key] ?? 0);
    if (!Number.isFinite(value) || value < min || value > max)
      fail('Invalid ' + key.replace(/_/g, ' '));
    return value;
  };
  const members = input.members || [];
  if (
    !Array.isArray(members) ||
    members.length > 500 ||
    members.some((id) => !/^[a-f\d]{24}$/i.test(String(id)))
  )
    fail('Invalid staff access list.');
  const prices = input.prices || [];
  if (!Array.isArray(prices) || prices.length > 2000) fail('Too many item prices.');
  const seen = new Set();
  const itemPrices = prices.map((p) => {
    const id = String(p.item_id || '');
    const price = Number(p.price);
    if (
      !/^[a-f\d]{24}$/i.test(id) ||
      seen.has(id) ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 1000000
    )
      fail('Invalid or duplicate item price.');
    seen.add(id);
    return { item_id: id, price: money(price) };
  });
  return {
    name,
    active: input.active !== false,
    markup_percent: number('markup_percent', -100, 1000),
    service_percent: number('service_percent', 0, 100),
    service_tax_percent: number('service_tax_percent', 0, 100),
    members: [...new Set(members.map(String))],
    prices: itemPrices,
  };
}
function allowed(outlet, userId) {
  return !outlet.members?.length || outlet.members.map(String).includes(String(userId));
}
async function resolve(context, requested, existing, revision) {
  if (existing && requested && String(existing.outlet_id || '') !== String(requested))
    fail('Open this bill in its original outlet window.');
  const id = String(existing?.outlet_id || requested || '');
  if (!id) return null;
  if (existing && String(requested || id) !== id)
    fail('An existing bill cannot be moved to another outlet.');
  if (!/^[a-f\d]{24}$/i.test(id)) fail('Invalid outlet.');
  if (!existing && !(await enabled(context)))
    fail(
      'Billing outlets is switched off. Enable it in Features before starting a new outlet bill.'
    );
  const db = await BaseModel.getDb();
  const outlet = await db
    .collection('billing_outlets')
    .findOne({ ...scope(context.branchId, context.licenseId), _id: new ObjectId(id) });
  if (!outlet || (!existing && outlet.active === false) || !allowed(outlet, context.userId))
    fail('This outlet is unavailable or you do not have access.');
  if (!existing && String(revision || '') !== new Date(outlet.updated_at).toISOString())
    fail('Outlet settings changed. Reload the outlet before starting a new bill.');
  // Existing bills keep the rules with which they were opened.
  return { ...(existing?.outlet_snapshot || outlet), id };
}
function price(outlet, product, entered) {
  if (
    !outlet ||
    product.open_price === true ||
    Number(product.selling_price || 0) <= 0 ||
    product.item_status === 'instant'
  )
    return entered;
  const override = outlet.prices?.find((p) => String(p.item_id) === String(product._id));
  return override
    ? override.price
    : money(Number(product.selling_price) * (1 + outlet.markup_percent / 100));
}
function charge(outlet, base) {
  if (!outlet || !(base > 0) || !outlet.service_percent) return null;
  const amount = money((base * outlet.service_percent) / 100);
  return {
    name: 'Service charge (' + outlet.service_percent + '%)',
    amount,
    source: 'outlet',
    taxed: outlet.service_tax_percent > 0,
    tax_name: 'Service charge tax',
    tax_amount: money((amount * outlet.service_tax_percent) / 100),
  };
}
module.exports = { enabled, scope, validate, allowed, resolve, price, charge, money };
