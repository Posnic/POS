/*
 * Giving existing shops explicit feature settings.
 *
 * "why these many activated already. this is not i wanted. when account
 * creation why its not created properly."
 *
 * New shops are fixed - they are created with four features on and the rest
 * off. Defaults only apply at creation, so every shop that already exists still
 * shows the full menu, and the reason is that a module reads as ON unless a
 * branch document explicitly says false. A shop that has never opened Settings
 * has no module_* keys at all.
 *
 * THE FAILURE MODE THIS FILE EXISTS FOR
 *
 * The obvious fix - change what "absent" means - would switch features off in
 * every shop already running. A shop taking credit sales for a year has no
 * module_credit_enable key either; it never needed one. Flip the convention,
 * deploy, and its Credit menu is gone overnight with its outstanding balances
 * unreachable, and nothing anywhere reports an error. The data is all still
 * there, which is exactly what makes it hard to diagnose: it reads as the
 * feature having been removed from the product.
 *
 * So the backfill writes explicit values decided from EVIDENCE, and every test
 * below is about not taking something away from somebody who is using it.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  FEATURES, planBranch, writesOf, isUnset, measure,
} = require(path.join(__dirname, '..', 'scripts', 'module-defaults-backfill.js'));

const noUsage = () => ({});
const usageFor = (key, n) => ({ [key]: n === undefined ? 1 : n });

test('a feature with records is never switched off', () => {
  /*
   * The whole point. This shop has expenses; switching the cash book off would
   * hide work somebody did, and they would report it as data loss.
   */
  const plan = planBranch({}, usageFor('module_cashbook_enable'), FEATURES);
  const row = plan.find((p) => p.key === 'module_cashbook_enable');
  assert.strictEqual(row.action, 'set');
  assert.strictEqual(row.value, true);
  assert.match(row.reason, /in use/);
});

test('every evidence-backed feature switches on when it has records', () => {
  /* Swept rather than spot-checked: a row added later with a typo in its
     evidence would otherwise pass unnoticed, and it fails silently - as a
     feature switched off in a shop that was using it. */
  for (const feature of FEATURES) {
    if (!feature.evidence.length) continue;
    const plan = planBranch({}, usageFor(feature.key, 3), FEATURES);
    const row = plan.find((p) => p.key === feature.key);
    assert.strictEqual(row.value, true, `${feature.key} was not switched on despite records`);
  }
});

test('a shop with no history gets the new-shop defaults', () => {
  const plan = planBranch({}, noUsage(), FEATURES);
  const value = (k) => plan.find((p) => p.key === k).value;

  // The four a new shop is created with, minus demo data, which is evidenced.
  assert.strictEqual(value('module_tax_enable'), true);
  assert.strictEqual(value('quick_sale_enable'), true);
  assert.strictEqual(value('module_themes_enable'), true);

  // And the rest off, which is the complaint being answered.
  assert.strictEqual(value('module_marketing_enable'), false);
  assert.strictEqual(value('module_messaging_enable'), false);
  assert.strictEqual(value('module_channels_enable'), false);
  assert.strictEqual(value('module_credit_enable'), false);
  assert.strictEqual(value('quotes_enable'), false);
});

test('a decision the shop already made is never overwritten', () => {
  /*
   * `false` is a decision as much as `true` is. A shop that switched Marketing
   * off did so on purpose, and a migration that "corrects" it is worse than the
   * gap it closes - it is the shops that took the trouble to configure things
   * whose configuration would be discarded.
   */
  const branch = { module_marketing_enable: false, module_tax_enable: true };
  const plan = planBranch(branch, noUsage(), FEATURES);

  const marketing = plan.find((p) => p.key === 'module_marketing_enable');
  assert.strictEqual(marketing.action, 'keep');
  const tax = plan.find((p) => p.key === 'module_tax_enable');
  assert.strictEqual(tax.action, 'keep');

  const set = writesOf(plan);
  assert.ok(!('module_marketing_enable' in set));
  assert.ok(!('module_tax_enable' in set));
});

test('only absent counts as undecided', () => {
  assert.strictEqual(isUnset(undefined), true);
  assert.strictEqual(isUnset(null), true);
  assert.strictEqual(isUnset(''), true);
  /* Both booleans, and both strings: the settings write path has stored
     'false' as a string in places, and treating that as a gap would overwrite
     a shop's explicit off with an on. */
  assert.strictEqual(isUnset(false), false);
  assert.strictEqual(isUnset(true), false);
  assert.strictEqual(isUnset('false'), false);
  assert.strictEqual(isUnset('true'), false);
});

test('a shop that has decided everything is written to at all', () => {
  const branch = {};
  for (const f of FEATURES) branch[f.key] = true;
  const plan = planBranch(branch, noUsage(), FEATURES);
  assert.deepStrictEqual(writesOf(plan), {},
    'a fully-configured shop must produce no write at all');
});

test('the two onOnly switches are left out', () => {
  /*
   * staff_tips_enable and till_lock_enable already parse absent as FALSE, so
   * they are off in every shop today and there is nothing to correct. Including
   * them would be a migration that changes nothing, and every row it touched
   * would still have to be explained to whoever reads the audit log next.
   */
  const keys = FEATURES.map((f) => f.key);
  assert.ok(!keys.includes('staff_tips_enable'));
  assert.ok(!keys.includes('till_lock_enable'));
});

test('every feature it does write is a real module switch', () => {
  /*
   * Checked against the server's own map. A key invented here would be written
   * to every branch in the estate and read by nothing - a column of noise that
   * looks like a setting.
   */
  const SettingModel = require(path.join(__dirname, '..', 'api', 'src', 'models', 'setting.model.js'));
  const real = SettingModel.moduleToggleMap();
  for (const f of FEATURES) {
    assert.ok(Object.prototype.hasOwnProperty.call(real, f.key),
      `${f.key} is not in moduleToggleMap - nothing would read it`);
  }
});

test('what it writes for a fresh shop matches what a fresh shop is given', () => {
  /*
   * The two lists are written in different files for different reasons, and
   * nothing but this connects them. If they drift, an existing shop is
   * backfilled to a state a new shop would never be created in - and the whole
   * point was to make them agree.
   */
  const InstallService = require(path.join(__dirname, '..', 'api', 'src', 'services', 'install.service.js'));
  const fresh = InstallService.newShopModuleDefaults({ demoData: false });
  const plan = planBranch({}, noUsage(), FEATURES);

  for (const row of plan) {
    if (!(row.key in fresh)) continue;   // not something a new shop is given
    assert.strictEqual(row.value, fresh[row.key],
      `${row.key}: backfill says ${row.value}, a new shop is created with ${fresh[row.key]}`);
  }
});

test('every evidence query is scoped to the branch and the licence', async () => {
  /*
   * THE DANGEROUS ONE. A query missing the licence counts another company's
   * records and switches a feature on for a shop that has never used it. It
   * shows up as a menu entry nobody asked for, in somebody else's shop, and is
   * never traced back to a migration that ran once months earlier.
   */
  const seen = [];
  const db = {
    collection: () => ({
      countDocuments: async (q) => { seen.push(q); return 0; },
    }),
  };
  const branch = { _id: 'BRANCH', license: 'LICENCE' };
  await measure(db, branch, FEATURES);

  assert.ok(seen.length, 'no queries were made at all');
  for (const q of seen) {
    const clauses = JSON.stringify(q.$and || []);
    assert.match(clauses, /"license":"LICENCE"/, `a query is not scoped to the licence: ${clauses}`);
    assert.match(clauses, /BRANCH/, `a query is not scoped to the branch: ${clauses}`);
  }
});

test('a collection this shop does not have counts zero rather than throwing', async () => {
  /* Shops provisioned by older builds simply do not have some of these. That
     is a fact about the shop, not a failure to report - and a throw here would
     abandon the whole estate part-way through. */
  const db = {
    collection: () => ({
      countDocuments: async () => { throw new Error('ns does not exist'); },
    }),
  };
  const usage = await measure(db, { _id: 'B', license: 'L' }, FEATURES);
  for (const f of FEATURES) {
    assert.strictEqual(usage[f.key], 0);
  }
});

test('it stops counting once one record is found', async () => {
  /*
   * Marketing has four evidence collections. One record is already the answer,
   * and running the other three against every branch in the estate is work
   * whose result cannot change the decision.
   */
  let calls = 0;
  const db = {
    collection: () => ({
      countDocuments: async () => { calls++; return 1; },
    }),
  };
  const marketing = FEATURES.filter((f) => f.key === 'module_marketing_enable');
  assert.ok(marketing[0].evidence.length > 1, 'this test needs a multi-collection feature');
  await measure(db, { _id: 'B', license: 'L' }, marketing);
  assert.strictEqual(calls, 1);
});

test('items are found by branch_access, everything else by branch_id', async () => {
  /*
   * Items carry branch_access[].branch_id and the rest carry branch_id.
   * Matching only one of them would count zero for the other - and counting
   * zero is what switches a live feature off.
   */
  const seen = [];
  const db = {
    collection: () => ({
      countDocuments: async (q) => { seen.push(JSON.stringify(q)); return 0; },
    }),
  };
  await measure(db, { _id: 'B', license: 'L' }, FEATURES);
  for (const q of seen) {
    assert.match(q, /branch_access\.branch_id/);
    assert.match(q, /"branch_id"/);
  }
});

test('report is the default and writing has to be asked for', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'module-defaults-backfill.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  assert.match(src, /const args = \{ apply: false \}/);
  assert.match(src, /if \(args\.apply\) \{/);
  assert.match(src, /Report only\. Re-run with --apply to write\./);
});
