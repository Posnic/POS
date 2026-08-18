'use strict';
/*
 * Low-stock device notification - the first push producer (user decision
 * 2026-08-18: the notification centre matters enough to "notify the user
 * via device").
 *
 * Fired from the change-events seam on the shop's own stock-moving traffic,
 * like the webhook drain: throttled hard in-process (one check per shop per
 * CHECK_EVERY_MS), and it only speaks when the number of low items has
 * GROWN since the last look - restocking back down re-arms it silently, so
 * a shop hears "low stock" when it gets worse, not on every sale forever.
 *
 * The notification carries a count and a destination, never item data.
 * Recipients are the shop's push-subscribed users who hold item read
 * (access is resolve-on-write, so the user document answers directly).
 */

const STATE = 'push_state';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const lastCheck = new Map(); // dbName -> ts (per process, like drainDue)

/* The widest notification_range configured on any branch; the shop-wide
   answer for a shop-wide notification. No branch configured = silent. */
async function configuredRange(db) {
  const branches = await db
    .collection('branches')
    .find(
      { notification_range: { $exists: true, $nin: [null, ''] } },
      { projection: { notification_range: 1 } }
    )
    .toArray();
  let range = -1;
  for (const b of branches) {
    const n = parseInt(b.notification_range, 10);
    if (Number.isFinite(n) && n >= 0 && n > range) range = n;
  }
  return range;
}

async function recipients(db) {
  const subs = await db
    .collection('push_subscriptions')
    .find({}, { projection: { user_id: 1 } })
    .toArray();
  const byKey = new Map();
  for (const s of subs) {
    if (s.user_id != null) byKey.set(String(s.user_id), s.user_id);
  }
  if (!byKey.size) return [];
  const out = [];
  for (const [, uid] of byKey) {
    let user = null;
    try {
      const { ObjectId } = require('mongodb');
      const q = ObjectId.isValid(String(uid)) ? { _id: new ObjectId(String(uid)) } : { _id: uid };
      user = await db.collection('users').findOne(q, { projection: { access: 1 } });
    } catch (e) {
      /* fall through - no user, no push */
    }
    if (user && user.access && user.access.item && user.access.item.read === true) out.push(uid);
  }
  return out;
}

/**
 * Best-effort, never throws to the caller's traffic. Exposed knobs are for
 * tests only.
 */
async function maybeNotify(db, { now = Date.now(), force = false } = {}) {
  if (!db) return { checked: false };
  const key = db.databaseName || 'db';
  const last = lastCheck.get(key) || 0;
  if (!force && now - last < CHECK_EVERY_MS) return { checked: false };
  lastCheck.set(key, now);

  const range = await configuredRange(db);
  if (range < 0) return { checked: true, notified: 0 };

  const count = await db.collection('items').countDocuments({
    available_quantity: { $lte: range },
    item_status: { $ne: 'instant' },
  });

  const state = (await db.collection(STATE).findOne({ _id: 'low_stock' })) || {};
  const previous = Number.isFinite(state.count) ? state.count : 0;
  if (count <= previous) {
    // Fell or flat: remember the better number so the NEXT rise notifies.
    if (count !== previous) {
      await db
        .collection(STATE)
        .updateOne({ _id: 'low_stock' }, { $set: { count, at: new Date(now) } }, { upsert: true });
    }
    return { checked: true, notified: 0 };
  }

  await db
    .collection(STATE)
    .updateOne(
      { _id: 'low_stock' },
      { $set: { count, at: new Date(now), notified_at: new Date(now) } },
      { upsert: true }
    );

  const push = require('./push');
  const users = await recipients(db);
  let notified = 0;
  for (const uid of users) {
    try {
      await push.sendToUser(db, uid, {
        title: 'Low stock',
        body: count + (count === 1 ? ' item is' : ' items are') + ' at or below the reorder level.',
        url: '/dashboard.html#/lowstockitems',
      });
      notified++;
    } catch (e) {
      /* one dead subscription must not silence the rest */
    }
  }
  return { checked: true, notified };
}

/* Test hook: the in-process throttle survives between unit tests otherwise. */
function resetThrottle() {
  lastCheck.clear();
}

module.exports = { maybeNotify, resetThrottle, CHECK_EVERY_MS, STATE };
