'use strict';

/*
 * Whether a shop still sees the sample products it was given on day one.
 *
 * The owner's framing: "one feature called Demo Data. when user switch off
 * then all demo data will be hidden or removed."
 *
 * WHY HIDDEN RATHER THAN REMOVED, BY DEFAULT
 *
 * A demo item can be SOLD. That is the entire point of demo data - somebody
 * rings one up to see whether the till suits them - and sale lines store
 * `item_id` (sale.model.js). Deleting such an item does not tidy anything up:
 * it orphans a real transaction, and the sale history then shows a purchase of
 * a product that does not exist. The sale is real even though the product was
 * not, so that damage cannot be undone.
 *
 * A shop also EDITS demo items. Changing the price on a sample product and
 * putting it on the shelf is how a small shop starts its real catalogue.
 * Deleting that is deleting their work.
 *
 * So the switch hides, which is instant, complete and perfectly reversible,
 * and permanent deletion is a separate, explicit action that refuses anything
 * sold or edited and reports what it kept. Same reasoning as data-sharing.js:
 * a setting the reads follow, not a migration somebody has to run.
 *
 * WHY THE DEFAULT IS ON
 *
 * The opposite of the sharing default, and for the opposite reason. An absent
 * sharing setting must mean "not shared", because the cost of guessing wrong
 * is one shop seeing another's customers. An absent demo setting must mean
 * "shown", because every shop that exists today has these records visible and
 * a deploy that silently emptied their catalogue would be indistinguishable
 * from data loss. Hiding is the change; it needs a decision behind it.
 */

const SettingsRepository = require('../repositories/settings.repository');

const KEY = 'module_demo_data_enable';

/*
 * The CLASS is exported by settings.repository, not an instance - the same
 * trap data-sharing.js documents. Instantiating lazily here keeps that in one
 * place and lets a test assert the wiring without a mock standing in for it.
 */
let repo = null;
const _repo = () => {
  if (!repo) repo = new SettingsRepository();
  return repo;
};

/* 'false' and false both mean off; anything else, including absent, is on. */
const truthy = (v) => !(v === false || v === 'false' || v === 0 || v === '0');

const TTL_MS = 30 * 1000;
const cache = new Map();
const SWEEP_ABOVE = 200;

function sweep(now) {
  for (const [k, v] of cache) {
    if (v.until <= now) cache.delete(k);
  }
}

const cacheKey = (license, branch) => `${String(license || '-')}::${String(branch || '-')}`;

/**
 * Is demo data shown for this branch?
 *
 * @param {Object} context - { licenseId, branchId }
 * @returns {Promise<Boolean>}
 */
async function isShown(context = {}) {
  const license = context.licenseId;
  const branch = context.branchId;
  /* Without a scope there is no setting to read, and the safe answer is the
     one that shows the shop everything it has. */
  if (!license || !branch) return true;

  const key = cacheKey(license, branch);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  let value = true;
  try {
    const res = await _repo().resolveGroup('features', {
      licenseId: license,
      branchId: branch,
    });
    if (res && res.status && res.data && res.data.values && res.data.values[KEY] !== undefined) {
      value = truthy(res.data.values[KEY]);
    }
  } catch (e) {
    /* A settings read that fails must not empty the item list. Showing is the
       forgiving answer: the failure mode is "sees the sample products it
       already had", never "the catalogue went missing". */
    console.error('Error in demoData.isShown:', e);
    value = true;
  }

  const now = Date.now();
  if (cache.size > SWEEP_ABOVE) sweep(now);
  cache.set(key, { value, until: now + TTL_MS });
  return value;
}

/**
 * The clause that hides demo records, or nothing at all.
 *
 * Returns `{}` when demo data is shown, so a caller can spread it
 * unconditionally and the query is untouched.
 *
 * `$exists: false` rather than a comparison: records created before tagging
 * existed carry no `demo_pack` at all, and they are a shop's own data. A
 * `$ne` test would keep them (correct here) but the intent is clearer stated
 * as "has no demo tag", and it uses the same index shape either way.
 *
 * @param {Object} context - { licenseId, branchId }
 * @returns {Promise<Object>}
 */
async function filter(context = {}) {
  return (await isShown(context)) ? {} : { demo_pack: { $exists: false } };
}

/* The read above caches for thirty seconds. Whoever just flipped the switch
   must not be told to wait for it - the delay is for OTHER processes serving
   the same account, not for the person at the screen. */
function invalidate(license) {
  if (license === undefined || license === null) {
    cache.clear();
    return;
  }
  const prefix = `${String(license)}::`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

module.exports = {
  KEY,
  truthy,
  isShown,
  filter,
  invalidate,
  _repo,
  _sweep: sweep,
  SWEEP_ABOVE,
  _cache: cache,
};
