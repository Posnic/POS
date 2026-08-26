'use strict';

/*
 * Whether this shop switched its own Google Analytics on, and with which id.
 *
 * Owner's design: "make it as feature. on / off with entering GA value."
 * Off by default everywhere - PRIVACY.md's promise that the product ships no
 * analytics holds unless the shop's OWNER configures their own id, and then
 * the data flows to the shop's own Google account, like every other
 * integration in the switch-on list.
 *
 * Read by two pre-render surfaces, which is why it lives here and not in a
 * request-scoped repository: the CSP middleware (the Google domains are only
 * allowed when the feature is ON - enforcement, not convention) and
 * /runtime-info (the login page injects pre-auth from there). Both run
 * before any branch context exists, so the rule is: the feature is ON for
 * the process if ANY branch of the shop enabled it with a plausible id.
 * Cached for 30 seconds; the settings save invalidates on write, so a
 * toggle bites on the next request rather than the next half minute.
 */
const { MongoClient } = require('mongodb');

const TTL_MS = 30 * 1000;
const GA_ID_SHAPE = /^G-[A-Z0-9]{4,14}$/;

let cache = { at: 0, value: { enabled: false, id: '' } };
let dbPromise = null;

function isPlausibleGaId(id) {
  return GA_ID_SHAPE.test(String(id || '').trim().toUpperCase());
}

async function db() {
  if (!dbPromise) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    dbPromise = MongoClient.connect(uri).then((c) => c.db());
  }
  return dbPromise;
}

async function readOnce() {
  try {
    const d = await db();
    const row = await d
      .collection('branch_preferences')
      .findOne({ analytics_enable: true, analytics_ga_id: { $type: 'string' } });
    if (row && isPlausibleGaId(row.analytics_ga_id)) {
      return { enabled: true, id: String(row.analytics_ga_id).trim().toUpperCase() };
    }
    /* a shop configured before the group cutover would hold it on the
       branch document - same rule, same shape */
    const legacy = await d
      .collection('branches')
      .findOne({ analytics_enable: true, analytics_ga_id: { $type: 'string' } });
    if (legacy && isPlausibleGaId(legacy.analytics_ga_id)) {
      return { enabled: true, id: String(legacy.analytics_ga_id).trim().toUpperCase() };
    }
  } catch (e) {
    /* an unreadable config is an OFF config - never block a request on it */
  }
  return { enabled: false, id: '' };
}

async function getAnalytics() {
  const now = Date.now();
  if (now - cache.at > TTL_MS) {
    cache = { at: now, value: await readOnce() };
  }
  return cache.value;
}

function invalidate() {
  cache.at = 0;
}

module.exports = { getAnalytics, invalidate, isPlausibleGaId };
