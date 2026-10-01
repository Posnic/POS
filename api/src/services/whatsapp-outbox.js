'use strict';
/*
 * WhatsApp outbox (INTEGRATIONS_ROADMAP I6, first increment).
 *
 * Today whatsapp-web.js - and the Chromium underneath it - runs INSIDE the
 * API process. That is the single worst dependency this server carries
 * (the audit highs live in its chain), and a browser crash is an API
 * incident. The exit is a signed connector (I5) that owns the WhatsApp
 * session out-of-process and speaks to the API with one scoped token.
 *
 * This module is the seam between the two worlds: a durable outbox the
 * API writes and the connector drains. Nothing changes for a shop until
 * its messaging settings flip whatsapp_transport:
 *
 *   'inprocess' (default)  today's path, untouched.
 *   'shadow'               today's path STILL sends; every send is also
 *                          recorded here with the in-process result, so a
 *                          week of parity data exists before anything real
 *                          rides the connector.
 *   'connector'            sends are queued here and the connector
 *                          delivers them; the API never touches Chromium.
 *
 * Delivery discipline mirrors the webhook outbox: rows are durable intent,
 * claims expire so a dead connector's work returns to the pool, failures
 * retry up to MAX_ATTEMPTS and then park as 'dead' - visible, never silent.
 */

const { ObjectId } = require('mongodb');

const OUTBOX = 'whatsapp_outbox';
const STATE = 'whatsapp_connector_state';
const MAX_ATTEMPTS = 5;
/* A claim a connector has sat on this long is a crashed connector's. */
const CLAIM_TTL_MS = 2 * 60_000;

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);

/** Queue one message. shadow=true records parity data, never a send. */
async function enqueue(db, license, { branch_id, phone, message, shadow, inprocess, scheduled } = {}) {
  const now = new Date();
  const row = {
    license: license || null,
    branch_id: oid(branch_id) || null,
    phone: String(phone || ''),
    message: String(message || ''),
    status: shadow ? 'shadow' : 'pending',
    attempts: 0,
    created_date: now,
    updated_date: now,
  };
  if (shadow && inprocess) {
    /* What the in-process path did for the same message, stamped at write
       time - the parity report is a query over these rows. */
    row.inprocess_ok = !!inprocess.ok;
    row.inprocess_error = inprocess.error || null;
  }
  if (scheduled) {
    if (!ObjectId.isValid(scheduled.id) || !scheduled.license || String(scheduled.branch_id) !== String(branch_id) || !scheduled.user_id || !/^[a-f0-9-]{36}$/i.test(scheduled.claim || '')) throw new Error('Invalid scheduled delivery scope.');
    row.scheduled = { id: String(scheduled.id), license: String(scheduled.license), branch_id: String(scheduled.branch_id), user_id: String(scheduled.user_id), claim: scheduled.claim };
    row.license = row.scheduled.license;
    row._id = new ObjectId(require('node:crypto').createHash('sha256').update(JSON.stringify(row.scheduled)).digest('hex').slice(0, 24));
    // An interrupted enqueue can be inspected/retried with the same identity.
    await db.collection(OUTBOX).updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true });
    const stored = await db.collection(OUTBOX).findOne({ _id: row._id });
    if (stored.phone !== row.phone || stored.message !== row.message) throw new Error('Scheduled delivery content changed. Review the existing outbox record.');
    return { id: row._id, status: stored.status };
  }
  const r = await db.collection(OUTBOX).insertOne(row);
  return { id: r.insertedId, status: row.status };
}

/*
 * Hand a batch to the connector, atomically: pending rows (or claims gone
 * stale) flip to 'claimed' one by one, so two connectors - or a connector
 * beside its own restart - never send the same message twice.
 */
async function claim(db, license, { limit = 10, now = new Date() } = {}) {
  const rows = [];
  const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS);
  const max = Math.min(Number(limit) || 10, 50);
  for (let i = 0; i < max; i++) {
    const r = await db.collection(OUTBOX).findOneAndUpdate(
      {
        $and: [
          { $or: [{ status: 'pending' }, { status: 'claimed', claimed_at: { $lt: staleBefore } }] },
          { $or: [{ scheduled: { $exists: false } }, { 'scheduled.license': String(license || '') }] },
        ],
      },
      { $set: { status: 'claimed', claimed_at: now, updated_date: now } },
      { sort: { created_date: 1 }, returnDocument: 'after' }
    );
    const doc = r && (r.value !== undefined ? r.value : r);
    if (!doc || !doc._id) break;
    if (doc.scheduled) {
      // Ordinary messaging retains its existing retries. A financial summary
      // never resends an expired claim whose provider outcome is unknown.
      if (doc.attempts > 0 || doc.scheduled_claimed) {
        await db.collection(OUTBOX).updateOne({ _id: doc._id, status: 'claimed', claimed_at: now }, { $set: { status: 'needs_review', updated_date: now, error: 'Interrupted scheduled delivery requires review.' } });
        continue;
      }
      try {
        const scheduled = doc.scheduled;
        const schedule = await db.collection('ask_posnic_schedules').findOne({ _id: new ObjectId(scheduled.id), license: scheduled.license, branch_id: scheduled.branch_id, user_id: scheduled.user_id, enabled: true });
        if (!schedule || String(doc.branch_id) !== scheduled.branch_id || new Date(doc.created_date).getTime() < now.getTime() - 86400000 || !(schedule.running_claim === scheduled.claim || schedule.last_status === 'queued' && schedule.last_delivery?.reference === String(doc._id))) throw new Error('Schedule changed or expired.');
        await require('./ask-posnic-runner.service').authorize(db, schedule);
        const approved = await db.collection(OUTBOX).updateOne({ _id: doc._id, status: 'claimed', claimed_at: now }, { $set: { scheduled_claimed: true } });
        if (approved.matchedCount !== 1) continue;
      } catch (_error) {
        await db.collection(OUTBOX).updateOne({ _id: doc._id, status: 'claimed', claimed_at: now }, { $set: { status: 'needs_review', updated_date: now, error: 'Schedule permission or delivery state changed. Review before sending.' } });
        continue;
      }
    }
    rows.push({
      id: String(doc._id),
      branch_id: doc.branch_id ? String(doc.branch_id) : null,
      phone: doc.phone,
      message: doc.message,
      attempts: doc.attempts || 0,
    });
  }
  return rows;
}

/** The connector's verdict on one claimed row. */
async function report(db, license, id, { ok, error, now = new Date() } = {}) {
  const _id = oid(id);
  if (!_id) return { ok: false, reason: 'bad-id' };
  const row = await db.collection(OUTBOX).findOne({ _id });
  if (!row) return { ok: false, reason: 'not-found' };

  if (row.scheduled) {
    if (row.scheduled.license !== String(license || '')) return { ok: false, reason: 'not-found' };
    // A late connector response cannot clear a paused/reviewed delivery.
    if (row.status !== 'claimed' || row.scheduled_claimed !== true) return { ok: false, reason: 'scheduled-delivery-needs-review' };
    const status = ok === true ? 'sent' : 'needs_review';
    const changed = await db.collection(OUTBOX).updateOne({ _id, status: 'claimed', claimed_at: row.claimed_at }, { $set: { status, updated_date: now, ...(ok === true ? { sent_at: now, error: null } : { error: 'Connector did not confirm scheduled delivery. Review before retrying.' }) } });
    return { ok: changed.matchedCount === 1, status };
  }

  if (ok) {
    await db
      .collection(OUTBOX)
      .updateOne(
        { _id },
        { $set: { status: 'sent', sent_at: now, updated_date: now, error: null } }
      );
    return { ok: true, status: 'sent' };
  }
  const attempts = (row.attempts || 0) + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  await db.collection(OUTBOX).updateOne(
    { _id },
    {
      $set: {
        /* Back to the pool until the attempts run out - visible as 'dead'
           after that, never silently gone. */
        status: dead ? 'dead' : 'pending',
        attempts,
        error: String(error || 'send failed'),
        updated_date: now,
      },
    }
  );
  return { ok: true, status: dead ? 'dead' : 'pending', attempts };
}

/*
 * The connector's link-state mirror, one row per branch. The settings
 * screen polls the SAME shapes it always did; when a branch rides the
 * connector these rows are where the answers come from.
 */
async function recordState(db, license, { branch_id, device_id, status, qr } = {}) {
  const now = new Date();
  await db.collection(STATE).updateOne(
    { branch_id: oid(branch_id) || null },
    {
      $set: {
        license: license || null,
        device_id: String(device_id || ''),
        status: String(status || 'unknown'),
        qr: qr ? String(qr) : null,
        updated_date: now,
      },
      $setOnInsert: { created_date: now },
    },
    { upsert: true }
  );
  return { ok: true };
}

async function getState(db, branch_id) {
  return db.collection(STATE).findOne({ branch_id: oid(branch_id) || null });
}

/* One number the Integrations screen can show; also the shadow-parity
   report in embryo: how the two paths disagreed, over a window. */
async function stats(db, { since } = {}) {
  const q = since ? { created_date: { $gte: since } } : {};
  const rows = await db.collection(OUTBOX).find(q).toArray();
  const out = { pending: 0, claimed: 0, sent: 0, dead: 0, shadow: 0, shadow_inprocess_failed: 0 };
  for (const r of rows) {
    if (out[r.status] !== undefined) out[r.status]++;
    if (r.status === 'shadow' && r.inprocess_ok === false) out.shadow_inprocess_failed++;
  }
  return out;
}

module.exports = {
  OUTBOX,
  STATE,
  MAX_ATTEMPTS,
  CLAIM_TTL_MS,
  enqueue,
  claim,
  report,
  recordState,
  getState,
  stats,
};
