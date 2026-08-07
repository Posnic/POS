/*
 * Plan limits, read from wherever this copy of the app happens to be running.
 *
 * The desktop app caches them in its data folder after the gateway hands them
 * over; a cloud shop reads them from its own database, written there by the
 * admin console. Same shape either way, so callers do not care which they are.
 *
 * A shop with no cloud account has no limits, which is the point of the free
 * edition. Any failure reads as "no limit": a shop must never be blocked from
 * trading because a limits file was unreadable.
 */
const fs = require('fs');
const path = require('path');

const TTL_MS = 30_000;
let cache = { at: 0, limits: null };

async function getLimits() {
  if (Date.now() - cache.at < TTL_MS) return cache.limits;
  let limits = null;
  try {
    const dir = process.env.POSNIC_BRAND_DIR;
    if (dir) {
      const file = path.join(dir, 'limits.json');
      if (fs.existsSync(file)) limits = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        limits = await mongoose.connection.db.collection('app_limits').findOne({ _id: 'limits' });
      }
    }
  } catch (err) {
    limits = null;
  }
  cache = { at: Date.now(), limits };
  return limits;
}

/** Outlets this shop may run, or null when nothing is enforcing a number. */
async function branchLimit() {
  const limits = await getLimits();
  const n = limits && Number(limits.branches);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Drops the cache so a freshly synced limit applies without a restart. */
function invalidate() {
  cache = { at: 0, limits: null };
}

module.exports = { getLimits, branchLimit, invalidate };
