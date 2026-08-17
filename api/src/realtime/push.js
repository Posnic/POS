'use strict';
/*
 * Web Push infrastructure (SW roadmap W4).
 *
 * The PIPE only: key management, subscription storage, delivery, cleanup.
 * What may actually notify a person is a product decision the roadmap
 * gates separately - the single sender wired today is the test endpoint,
 * which proves the pipe end-to-end from the bell panel.
 *
 * VAPID keys are PER SHOP, generated on first use and stored in the shop's
 * own database (push_vapid, one row). Nothing to provision, nothing shared
 * across tenants, and a shard serves each shop with that shop's identity -
 * the same isolation stance as session secrets and approval tokens.
 *
 * Every function is fire-safe: push is an accelerator for attention, never
 * a dependency of any business flow.
 */

const COLLECTION = 'push_subscriptions';
const VAPID_COLLECTION = 'push_vapid';

/* Lazy so an install without the dependency (or a stripped build) degrades
   to "push unavailable" instead of failing to boot. */
function webpush() {
  try {
    return require('web-push');
  } catch (e) {
    return null;
  }
}

/** The shop's VAPID pair, minting one on first use. */
async function getVapid(db) {
  const wp = webpush();
  if (!wp || !db) return null;
  const coll = db.collection(VAPID_COLLECTION);
  let row = await coll.findOne({ _id: 'vapid' });
  if (!row) {
    const keys = wp.generateVAPIDKeys();
    row = { _id: 'vapid', publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: new Date() };
    try {
      await coll.insertOne(row);
    } catch (e) {
      /* Two tills raced first-use; the winner's pair is the shop's. */
      row = await coll.findOne({ _id: 'vapid' });
    }
  }
  return row;
}

async function getPublicKey(db) {
  const row = await getVapid(db);
  return row ? row.publicKey : null;
}

/** One row per (user, endpoint): a person may enable several devices. */
async function subscribe(db, userId, subscription) {
  if (!db || !userId || !subscription || !subscription.endpoint) {
    return { ok: false, reason: 'invalid' };
  }
  await db.collection(COLLECTION).updateOne(
    { user_id: String(userId), endpoint: subscription.endpoint },
    {
      $set: { subscription, updatedAt: new Date() },
      $setOnInsert: { user_id: String(userId), endpoint: subscription.endpoint, createdAt: new Date() },
    },
    { upsert: true }
  );
  return { ok: true };
}

/**
 * Deliver to every device of one user. 404/410 mean the browser revoked the
 * subscription; those rows are pruned so the store never accumulates ghosts.
 */
async function sendToUser(db, userId, payload) {
  const wp = webpush();
  if (!wp || !db) return { sent: 0 };
  const vapid = await getVapid(db);
  if (!vapid) return { sent: 0 };

  const rows = await db.collection(COLLECTION).find({ user_id: String(userId) }).toArray();
  let sent = 0;
  for (const row of rows) {
    try {
      await wp.sendNotification(row.subscription, JSON.stringify(payload), {
        vapidDetails: {
          subject: 'mailto:support@posnic.com',
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
        TTL: 60 * 60,
      });
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        await db.collection(COLLECTION).deleteOne({ _id: row._id }).catch(() => {});
      }
      /* Anything else: this delivery is lost, the pipe is not. */
    }
  }
  return { sent };
}

module.exports = { getPublicKey, subscribe, sendToUser, getVapid, COLLECTION, VAPID_COLLECTION };
