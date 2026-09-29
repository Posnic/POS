'use strict';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { context, allowed, fail } = require('../utils/branch-access');
const states = ['accepted', 'failed', 'pending', 'unknown'];
async function report(req) {
  const body = req.body;
  if (
    !ObjectId.isValid(String(body.saleId)) ||
    !ObjectId.isValid(String(body.branchId)) ||
    typeof body.key !== 'string' ||
    body.key.length > 240 ||
    !Array.isArray(body.printers) ||
    body.printers.length > 100 ||
    body.printers.some(
      (printer) =>
        !states.includes(printer.state) ||
        typeof printer.name !== 'string' ||
        printer.name.length > 200
    )
  )
    fail('Invalid delivery report.');
  const key = crypto.createHash('sha256').update(body.key).digest('hex');
  const at = new Date(body.at);
  if (!Number.isFinite(at.getTime())) fail('Invalid delivery report.');
  const value = {
    key: body.key,
    at,
    received_at: new Date(),
    till: String(body.till || '').slice(0, 100),
    printers: body.printers.map((printer) => ({
      name: printer.name,
      copy: Number(printer.copy) || 1,
      state: printer.state,
      reason: String(printer.reason || '').slice(0, 300),
    })),
  };
  const db = req.db || (await BaseModel.getDb());
  const field = 'kitchen_delivery.' + key;
  const filter = {
    _id: new ObjectId(String(body.saleId)),
    branch_id: new ObjectId(String(body.branchId)),
    ...(BaseModel.license ? { license: BaseModel.license } : {}),
    $or: [{ [field]: { $exists: false } }, { [field + '.at']: { $lte: at } }],
  };
  await db.collection('sales').updateOne(filter, { $set: { [field]: value } });
  return { received: true };
}
async function displayReport(req) {
  const body = req.body || {};
  if (
    !ObjectId.isValid(String(body.branchId)) ||
    !Array.isArray(body.saleIds) ||
    body.saleIds.length > 2000 ||
    body.saleIds.some((id) => !ObjectId.isValid(String(id))) ||
    !Array.isArray(body.screens) ||
    !body.screens.length ||
    body.screens.length > 100 ||
    !body.till ||
    String(body.till).length > 100
  )
    fail('Invalid display report.');
  const db = req.db || (await BaseModel.getDb());
  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify([String(body.till), [...body.screens].map(String).sort()]))
    .digest('hex');
  const value = {
    at: new Date(),
    till: String(body.till),
    screens: body.screens.map((id) => String(id).slice(0, 100)),
    saleIds: [...new Set(body.saleIds.map(String))],
  };
  await db.collection('branches').updateOne(
    {
      _id: new ObjectId(String(body.branchId)),
      ...(BaseModel.license ? { license: BaseModel.license } : {}),
    },
    { $set: { ['kitchen_display_status.' + key]: value } }
  );
  return { received: true };
}
async function status(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req),
    id = req.query.saleId;
  if (!ObjectId.isValid(String(id))) fail('Choose an order.');
  const sale = await req.db.collection('sales').findOne(
    { _id: new ObjectId(String(id)), license: c.license, branch_id: c.branchId },
    {
      projection: {
        kitchen_delivery: 1,
        created_date: 1,
        kitchen_service: 1,
        changes: 1,
        items: 1,
      },
    }
  );
  if (!sale) fail('Order not found.', 404);
  return {
    serverAccepted: true,
    displays: Object.values(c.branch.kitchen_display_status || {})
      .filter((display) => display.saleIds?.includes(String(id)))
      .map((display) => ({
        at: display.at,
        till: display.till,
        screens: display.screens,
        recent: Date.now() - new Date(display.at).getTime() < 30000,
      })),
    reports: Object.values(sale.kitchen_delivery || {})
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 20),
    remaining: require('../helpers/kitchen-rounds')
      .rounds(sale)
      .flatMap((round) => round.items)
      .reduce((n, line) => n + line.remaining, 0),
  };
}
module.exports = { report, displayReport, status };
