'use strict';

/*
 * Whether one branch sees another branch's customers, suppliers and stock.
 *
 * The owner's framing, and it is the right one: "this should be visible based
 * on settings only". Not a migration, not a merge, not a script anybody has to
 * remember to run - a switch, and the reads follow it.
 *
 * WHY THIS IS RESOLVED AT READ TIME
 *
 * The obvious alternative is to write the sharing into the rows: turn it on,
 * grant every existing customer to every branch, done. That is wrong in three
 * ways. It is a mass write over live data. It cannot be undone - once the
 * grants are in the rows, turning sharing OFF means guessing which grants were
 * blanket and which were deliberate. And it leaves every customer created
 * afterwards needing the same treatment, so "why doesn't the new branch see
 * this customer" comes back forever.
 *
 * Resolving at read time has none of that. Flip it on and the next query
 * shares; flip it off and the next query does not. Nothing is written, so
 * nothing has to be unwritten, and the deliberate per-customer grants that
 * `branch_access[]` exists for keep working underneath either setting.
 *
 * WHAT "SHARED" MEANS FOR A QUERY
 *
 * It means the branch clause is dropped, and nothing else. Every one of these
 * queries already carries `license`, and a shop's data lives in its own
 * database (db/tenant-connections.js), so dropping the branch clause widens a
 * read to the ACCOUNT and can reach no further. That is the whole mechanism -
 * see scopeBranch below, which returns null and lets the existing
 * `if (!branchId) return query` in branch-scope.js do the work.
 *
 * WHY THE STORED DEFAULT IS OFF WHILE THE FORM DEFAULT IS ON
 *
 * The owner asked for these "auto selected as true based on standard values",
 * and the branch-creation form does exactly that - the boxes arrive ticked.
 * But an ABSENT setting on an existing account must resolve to off, because
 * the alternative is that a deploy silently shows one shop another shop's
 * customer list. Sharing is a decision, and someone has to have made it; a
 * pre-ticked box on a form is a decision, an upgrade is not.
 */

const SettingsRepository = require('../repositories/settings.repository');

/*
 * This module exports the CLASS, not an instance.
 *
 * Calling resolveGroup on the class gives undefined, which throws, which the
 * catch below turns into "not shared" - so the switch would have been dead in
 * exactly the way that looks like a working narrow default. Written the wrong
 * way first here, and only caught because the mock in the tests had the shape
 * the real module does not. `_repo()` exists so a test can assert the wiring
 * without a mock standing in for it.
 */
let repo = null;
const _repo = () => {
  if (!repo) repo = new SettingsRepository();
  return repo;
};

/* entity -> the setting that governs it. Named by entity rather than by key so
   a caller says what it is reading, not which switch to consult. */
const SHARING_KEYS = Object.freeze({
  customers: 'share_customers',
  suppliers: 'share_suppliers',
});

/*
 * What a NEW branch is offered, pre-ticked.
 *
 * Customers and suppliers default to shared: a person who walks into one shop
 * of a chain and then another is the same person, with the same balance and
 * the same loyalty, and two records for them is the bug.
 *
 * INVENTORY IS DELIBERATELY NOT HERE. The owner asked for "inventory copy, or
 * common inventory", and for this schema those are not two settings - one is
 * workable and one would corrupt a till. Stock lives on the item document and
 * each branch owns its own items, so widening the item read the way these
 * widen the customer read would show a cashier N copies of every product, one
 * per branch, each with a different count; selling the wrong row decrements
 * another shop's stock. A real common inventory needs per-branch stock records,
 * which is a schema change, not a switch.
 *
 * What a new branch actually wants is the CATALOGUE with its own counts, and
 * that is services/catalogue-copy.js - offered on the same form, as a copy.
 */
const CREATE_DEFAULTS = Object.freeze({
  share_customers: true,
  share_suppliers: true,
});

/* Absent means off. See the header - an upgrade must not change who can see
   whom. */
const READ_DEFAULTS = Object.freeze({
  share_customers: false,
  share_suppliers: false,
});

/*
 * Settings arrive as whatever the screen that wrote them used - a real
 * boolean, "true", "1", "enable". Reading them with `!!` makes the string
 * "false" mean true, which for a visibility switch is the wrong direction to
 * be wrong in.
 */
const truthy = (v) => {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return (
    s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enable' || s === 'enabled'
  );
};

/*
 * A short cache, because this is consulted on the read path.
 *
 * Every customer lookup would otherwise be two queries instead of one. Thirty
 * seconds is chosen against what happens when it is wrong: a switch takes at
 * most half a minute to take hold, which nobody notices, while a stale entry
 * shows or hides records for at most that long. Writes clear the key outright
 * so the person who flipped the switch sees it immediately - the delay is only
 * ever for OTHER processes serving the same account.
 */
const TTL_MS = 30 * 1000;
const cache = new Map();

const cacheKey = (license, branch) => `${String(license || '-')}::${String(branch || '-')}`;

async function resolveAll(context = {}) {
  const license = context.licenseId;
  const branch = context.branchId;
  if (!license || !branch) return { ...READ_DEFAULTS };

  const key = cacheKey(license, branch);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.values;

  let values = { ...READ_DEFAULTS };
  try {
    const res = await _repo().resolveGroup('sharing', { licenseId: license, branchId: branch });
    if (res && res.status && res.data && res.data.values) {
      for (const k of Object.keys(READ_DEFAULTS)) {
        if (res.data.values[k] !== undefined) values[k] = truthy(res.data.values[k]);
      }
    }
  } catch (e) {
    /* A settings read that fails must not fail the customer list. Defaults are
       the narrow answer, so the failure mode is "sees less", never "sees another
       branch's data". */
    console.error('Error in dataSharing.resolveAll:', e);
    values = { ...READ_DEFAULTS };
  }

  cache.set(key, { values, until: Date.now() + TTL_MS });
  return values;
}

/** Is `entity` (customers | suppliers | inventory) shared across branches? */
async function isShared(entity, context = {}) {
  const key = SHARING_KEYS[entity];
  if (!key) return false;
  const values = await resolveAll(context);
  return values[key] === true;
}

/*
 * The branch id a query should scope to - or null, meaning "do not scope".
 *
 * This is the whole integration surface. `withBranchScope(query, null)` already
 * returns the query untouched, so a call site becomes one await and no new
 * branching:
 *
 *     const scope = await scopeBranch('customers', branchId, ctx);
 *     query = withBranchScope(query, scope);
 */
async function scopeBranch(entity, branchId, context = {}) {
  if (!branchId) return branchId;
  const ctx = {
    licenseId: context.licenseId,
    branchId: context.branchId || branchId,
  };
  return (await isShared(entity, ctx)) ? null : branchId;
}

/* Drop what is cached for one account, or everything. Called after a write so
   the person who just flipped the switch is not told to wait. */
function invalidate(license) {
  if (license === undefined) {
    cache.clear();
    return;
  }
  const prefix = `${String(license)}::`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

module.exports = {
  SHARING_KEYS,
  CREATE_DEFAULTS,
  READ_DEFAULTS,
  truthy,
  isShared,
  scopeBranch,
  invalidate,
  _repo,
  _cache: cache,
};
