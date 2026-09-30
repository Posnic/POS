'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const indexes = new WeakMap();
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
async function scope(req, saleId) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Order access is required.', 403);
  if (typeof saleId !== 'string' || !/^[a-f0-9]{24}$/i.test(saleId))
    fail('Choose an open order for this recording.', 400);
  const c = await context(req);
  const sale = await req.db.collection('sales').findOne(
    {
      _id: new ObjectId(saleId),
      license: c.license,
      branch_id: c.branchId,
      kitchen_closed: { $ne: true },
      ...require('../helpers/kitchen-eligibility').kitchenEligibility(),
    },
    { projection: { _id: 1 } }
  );
  if (!sale) fail('This order is no longer available in your kitchen.', 404);
  return { license: c.license, branch_id: c.branchId, saleId: String(sale._id) };
}
async function collection(db) {
  const coll = db.collection('kitchen_voice_messages');
  if (!indexes.has(db)) {
    const pending = Promise.all([
      coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      coll.createIndex({ license: 1, branch_id: 1, saleId: 1, created: 1 }),
    ]).catch((e) => {
      indexes.delete(db);
      throw e;
    });
    indexes.set(db, pending);
  }
  await indexes.get(db);
  return coll;
}
// Save before queuing: an accepted broadcast must not lose its order attachment.
// The queue's session ID is also the immutable recording ID, making retries idempotent.
async function prepare(req, validateSession = async () => {}) {
  if (!req.body?.saleId) return null; // Older clients send general messages only.
  const where = await scope(req, req.body.saleId);
  const { id, data } = req.body;
  if (
    !validId(id) ||
    typeof data !== 'string' ||
    data.length > 1500000 ||
    !/^data:audio\/(webm|ogg|mp4|wav)(;codecs=[a-zA-Z0-9., -]+)?;base64,[A-Za-z0-9+/=]+$/.test(data)
  )
    fail('Invalid or oversized voice recording.', 400);
  const coll = await collection(req.db);
  const owner = String(req.user._id);
  const existing = await coll.findOne({ _id: id });
  if (existing) {
    if (
      String(existing.license) !== String(where.license) ||
      String(existing.branch_id) !== String(where.branch_id) ||
      existing.saleId !== where.saleId ||
      existing.owner !== owner ||
      existing.data !== data
    )
      fail('This recording belongs to a different message. Record a new message.', 409);
    if (!existing.queued) await validateSession();
    return { coll, id, queued: existing.queued };
  }
  if ((await coll.countDocuments({ ...where, expiresAt: { $gt: new Date() } })) >= 30)
    fail('This order already has 30 recordings.', 409);
  await validateSession();
  try {
    await coll.insertOne({
      _id: id,
      ...where,
      owner,
      data,
      queued: false,
      created: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
  } catch (e) {
    if (e.code === 11000) return prepare(req, validateSession);
    throw e;
  }
  return { coll, id, queued: false };
}
async function markQueued(attachment) {
  if (attachment)
    await attachment.coll.updateOne({ _id: attachment.id }, { $set: { queued: true } });
}
async function listForTickets(req, c, tickets) {
  if (!tickets.length) return;
  const notes = await req.db
    .collection('kitchen_voice_messages')
    .find(
      {
        license: c.license,
        branch_id: c.branchId,
        saleId: { $in: [...new Set(tickets.map((t) => t.saleId))] },
        queued: true,
        expiresAt: { $gt: new Date() },
      },
      { projection: { _id: 1, saleId: 1, created: 1 } }
    )
    .sort({ created: 1 })
    .toArray();
  for (const ticket of tickets)
    ticket.voiceNotes = notes
      .filter((n) => n.saleId === ticket.saleId)
      .map((n) => ({ id: n._id, created: n.created }));
}
async function read(req) {
  const where = await scope(req, req.params.saleId);
  if (!validId(req.params.voiceId)) fail('Recording not found.', 404);
  const note = await req.db.collection('kitchen_voice_messages').findOne(
    {
      ...where,
      _id: req.params.voiceId,
      queued: true,
      expiresAt: { $gt: new Date() },
    },
    { projection: { data: 1 } }
  );
  if (!note) fail('This recording is no longer available.', 404);
  return { data: note.data };
}
module.exports = { prepare, markQueued, listForTickets, read };
