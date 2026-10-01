'use strict';

const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const budget = require('./ai-budget');
const entitlements = require('./managed-ai-entitlement.service');

const COLLECTION = 'managed_ai_credits';
const RESERVATIONS = 'managed_ai_reservations';

function scope(context) {
  const license = String(context?.licenseId || '');
  if (!license) throw new Error('Managed AI requires a shop identity.');
  return { license, month: budget.monthKey() };
}

function validId(id) { return /^[a-f0-9-]{36}$/.test(String(id || '')); }

// The account is the accounting authority. Its balance and each hold change in
// the same MongoDB write, including on standalone MongoDB without transactions.
// The separate reservation collection is a recoverable audit projection.
async function flushFinalized(db, account) {
  for (const [id, hold] of Object.entries(account.holds || {})) {
    if (!validId(id) || !['reconciled', 'released'].includes(hold.status)) continue;
    await db.collection(RESERVATIONS).updateOne({ _id: id }, { $set: { ...hold, license: account.license, month: account.month } }, { upsert: true });
    await db.collection(COLLECTION).updateOne({ license: account.license, month: account.month, [`holds.${id}.status`]: hold.status }, { $unset: { [`holds.${id}`]: '' } });
  }
}

async function recover(context) {
  const key = scope(context);
  const db = await BaseModel.getDb();
  const accounts = await db.collection(COLLECTION).find({ license: key.license, holds: { $exists: true } }).toArray();
  for (const account of accounts) await flushFinalized(db, account);
}

async function ensureAccount(context) {
  const key = scope(context);
  const db = await BaseModel.getDb();
  const entitlement = entitlements.configured() ? await entitlements.get() : null;
  if (entitlement) key.month = entitlement.active ? `billing:${entitlement.period_id}` : `unfunded:${key.month}`;
  await db.collection(COLLECTION).createIndex({ license: 1, month: 1 }, { unique: true });
  const configured = Number(process.env.POSNIC_MANAGED_AI_MONTHLY_CAP || 0);
  const monthly = Number.isFinite(configured) ? Math.max(0, configured) : 0;
  const currency = entitlement ? { code: 'USD', rate: 1 } : await budget.currencyOf(context);
  const allowanceMinor = entitlement ? entitlement.allowance_minor : Math.round(monthly * 100);
  try {
    await db.collection(COLLECTION).updateOne(key, { $setOnInsert: { ...(!entitlement ? { allowance_minor: allowanceMinor } : {}), used_minor: 0, reserved_minor: 0, currency: currency.code, exchange_rate: currency.rate, created_at: new Date() }, ...(entitlement ? { $set: { allowance_minor: allowanceMinor, funding: 'paid', valid_until: entitlement.valid_until || null, updated_at: new Date() } } : {}) }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const account = await db.collection(COLLECTION).findOne(key);
  if (!account) throw new Error('Managed AI allowance is unavailable.');
  // Failure to project old audit entries must not erase an already-accounted
  // response or make a model call free. A later status/recovery call retries it.
  await flushFinalized(db, account).catch(() => {});
  return account;
}

async function reserve(context, { feature, model, promptChars, maxOutputTokens }) {
  const key = scope(context);
  const db = await BaseModel.getDb();
  const account = await ensureAccount(context);
  const currency = account.currency && account.exchange_rate ? { code: account.currency, rate: account.exchange_rate } : await budget.currencyOf(context);
  const unitPrice = { ...budget.priceFor(model) };
  const worstMinor = Math.max(1, Math.ceil(budget.costMicrominor({ model, tokensIn: Math.ceil(Number(promptChars || 0) / 3), tokensOut: Number(maxOutputTokens ?? 4000), rate: currency.rate, unitPrice }) / 1e6));
  if (!Number.isSafeInteger(worstMinor)) throw new Error('Invalid managed AI reservation.');
  if (!account.allowance_minor) return { ok: false, message: 'This shop has no active managed AI allowance.' };
  const id = crypto.randomUUID();
  const accountScope = { license: key.license, month: account.month };
  const hold = { feature: String(feature || '').slice(0, 80), model: String(model || '').slice(0, 160), unit_price: unitPrice, reserved_minor: worstMinor, currency, status: 'reserved', created_at: new Date(), expires_at: new Date(Date.now() + 10 * 60 * 1000) };
  hold.execution_owner = require('./ask-posnic-execution-owner').current();
  hold.operation_id = String(context.operationId || crypto.randomUUID());
  hold.branch_id = String(context.branchId || '');
  hold.meter_currency = await budget.currencyOf(context);
  const updated = await db.collection(COLLECTION).findOneAndUpdate({ ...accountScope, $expr: { $lte: [{ $add: ['$used_minor', '$reserved_minor', worstMinor] }, '$allowance_minor'] } }, { $inc: { reserved_minor: worstMinor }, $set: { [`holds.${id}`]: hold, updated_at: new Date() } }, { returnDocument: 'after' });
  if (!updated) return { ok: false, message: 'This shop has reached its managed AI allowance.' };
  const reservation = { ok: true, id, ...accountScope, reservedMinor: worstMinor, currency };
  try {
    await db.collection(RESERVATIONS).insertOne({ _id: id, ...accountScope, ...hold });
  } catch (error) {
    // No provider call has happened yet; release the durable hold safely.
    await release(context, reservation).catch(() => {});
    throw error;
  }
  return reservation;
}

async function locate(db, context, reservation) {
  const license = scope(context).license;
  if (!validId(reservation?.id)) return null;
  return db.collection(COLLECTION).findOne({ license, [`holds.${reservation.id}`]: { $exists: true } });
}

async function reconcile(context, reservation, { model, tokensIn, tokensOut }) {
  if (!reservation?.id) return;
  const db = await BaseModel.getDb();
  const account = await locate(db, context, reservation);
  if (!account) return;
  const hold = account.holds[reservation.id];
  if (['released', 'reconciled'].includes(hold.status)) { await flushFinalized(db, account).catch(() => {}); return; }
  const actual = budget.costMicrominor({ model: hold.model || model, tokensIn, tokensOut, rate: hold.currency.rate, unitPrice: hold.unit_price });
  const prefix = `holds.${reservation.id}`;
  const result = await db.collection(COLLECTION).findOneAndUpdate({ license: account.license, month: account.month, [`${prefix}.status`]: { $in: ['reserved', 'uncertain'] } }, [
    { $set: { reserved_minor: { $subtract: ['$reserved_minor', hold.reserved_minor] }, used_microminor: { $add: [{ $ifNull: ['$used_microminor', { $multiply: ['$used_minor', 1e6] }] }, actual] }, [`${prefix}.status`]: 'reconciled', [`${prefix}.actual_microminor`]: actual, [`${prefix}.tokens_in`]: Number(tokensIn) || 0, [`${prefix}.tokens_out`]: Number(tokensOut) || 0, [`${prefix}.reconciled_at`]: new Date(), updated_at: new Date() } },
    { $set: { used_minor: { $ceil: { $divide: ['$used_microminor', 1e6] } } } },
  ], { returnDocument: 'after' });
  if (result) await flushFinalized(db, result).catch(() => {});
}

async function release(context, reservation) {
  if (!reservation?.id) return;
  const db = await BaseModel.getDb();
  const account = await locate(db, context, reservation);
  if (!account) return;
  const hold = account.holds[reservation.id];
  const prefix = `holds.${reservation.id}`;
  const result = await db.collection(COLLECTION).findOneAndUpdate({ license: account.license, month: account.month, [`${prefix}.status`]: 'reserved' }, { $inc: { reserved_minor: -hold.reserved_minor }, $set: { [`${prefix}.status`]: 'released', [`${prefix}.released_at`]: new Date(), updated_at: new Date() } }, { returnDocument: 'after' });
  if (result) await flushFinalized(db, result).catch(() => {});
}

async function markUncertain(context, reservation) {
  const db = await BaseModel.getDb();
  const account = await locate(db, context, reservation);
  if (!account) return;
  const prefix = `holds.${reservation.id}`;
  await db.collection(COLLECTION).updateOne({ license: account.license, month: account.month, [`${prefix}.status`]: 'reserved' }, { $set: { [`${prefix}.status`]: 'uncertain', [`${prefix}.review_required_at`]: new Date() } });
  await db.collection(RESERVATIONS).updateOne({ _id: reservation.id, license: account.license, status: 'reserved' }, { $set: { status: 'uncertain', review_required_at: new Date() } });
}

async function status(context) {
  const account = await ensureAccount(context);
  return { allowance_minor: account.allowance_minor || 0, used_minor: account.used_minor || 0, reserved_minor: account.reserved_minor || 0, remaining_minor: Math.max(0, (account.allowance_minor || 0) - (account.used_minor || 0) - (account.reserved_minor || 0)), pending_reviews: Object.values(account.holds || {}).filter((hold) => hold.status === 'uncertain' || hold.status === 'reserved' && new Date(hold.expires_at) < new Date()).length, currency: account.currency, estimated: true, month: account.month, funding: account.funding || 'pilot', valid_until: account.valid_until || null };
}

module.exports = { reserve, reconcile, release, markUncertain, recover, status, ensureAccount, COLLECTION, RESERVATIONS };
