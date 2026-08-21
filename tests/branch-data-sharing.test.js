const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt } = require('./helpers/source-lookup');

/*
 * Sharing, on the screen (owner ask #85).
 *
 * "Whenever new branch created mandatory information needs to be auto filled...
 *  we should auto selected as true based on standard values."
 *
 * The server half is tested in api/tests/unit/services/data-sharing*. What
 * these guard is the gap between a form and a request, which is where this
 * feature can fail while looking like it works:
 *
 *   serializeArray() OMITS an unchecked checkbox. The server reads an absent
 *   key as "use the default", and the default here is ticked. So unticking
 *   Customers and pressing Save shares them anyway, and the form shows the
 *   opposite of what was stored. A setting that silently ignores the person
 *   setting it is worse than one that is missing.
 */

const ROOT = path.join(__dirname, '..');
const modal = fs.readFileSync(path.join(ROOT, 'frontend', 'modals', 'branch.html'), 'utf8');
const branchesJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'branches.js'),
  'utf8',
);

test('the create form offers all three choices', () => {
  for (const id of ['share_customers', 'share_suppliers', 'share_inventory']) {
    assert.ok(
      new RegExp(`id="${id}"`).test(modal),
      `${id} is not on the branch form - the setting exists with no way to reach it`,
    );
  }
});

test('customers and suppliers arrive ticked, stock does not', () => {
  /* One person across every shop is one person. Stock is on a shelf, in one
     building, and a shared count can sell what is not there. */
  const box = (id) => {
    const at = modal.indexOf(`id="${id}"`);
    assert.notStrictEqual(at, -1, `${id} missing`);
    return modal.slice(modal.lastIndexOf('<input', at), modal.indexOf('>', at) + 1);
  };
  assert.match(box('share_customers'), /\schecked\b/, 'customers should arrive shared');
  assert.match(box('share_suppliers'), /\schecked\b/, 'suppliers should arrive shared');
  assert.ok(!/\schecked\b/.test(box('share_inventory')), 'stock counts must NOT arrive shared');
});

test('each box says what it means, in the shop owner\'s terms', () => {
  /* A tick called "share_inventory" tells nobody what it does to a till. */
  assert.match(modal, /same balance, same loyalty/i, 'customers has no explanation');
  assert.match(modal, /can sell what is not there/i, 'the stock warning is the whole reason it is off');
  assert.match(modal, /changed later in Settings/i, 'a one-time-only decision would be a trap');
});

test('the choice is sent as an EXPLICIT boolean, never left to be inferred', () => {
  const fn = blockAt(branchesJs, 'sharingChoice: function () {');
  for (const id of ['share_customers', 'share_suppliers', 'share_inventory']) {
    assert.match(
      fn,
      new RegExp(`${id}: \\$\\('#${id}'\\)\\.is\\(':checked'\\)`),
      `${id} is not read as a boolean - an unticked box would vanish from the payload`,
    );
  }
});

test('the payload actually carries it', () => {
  const fn = blockAt(branchesJs, 'branch: function () {');
  assert.match(
    fn,
    /PosnicPro\.branches\.sharingChoice\(\)/,
    'sharingChoice is never merged into the request - the boxes do nothing',
  );
});

test('editing a branch sends nothing', () => {
  /* An account-wide rule is not changed from a branch form, and a stale form
     re-imposing a default over a rule set in Settings is exactly how a setting
     that "keeps resetting itself" is born. */
  const fn = blockAt(branchesJs, 'sharingChoice: function () {');
  assert.match(
    fn,
    /if \(\$\('#branch_id'\)\.val\(\) !== ''\) \{ return \{\}; \}/,
    'the edit path is not excluded',
  );
});

test('the block is shown when creating and hidden when editing', () => {
  const fn = blockAt(branchesJs, 'sharingRow: function (creating) {');
  assert.match(fn, /#branch_sharing_row/, 'the row is never toggled');
  assert.match(branchesJs, /sharingRow\(true\)/, 'creating never shows it');
  assert.match(branchesJs, /sharingRow\(false\)/, 'editing never hides it');
});

test('the fieldset is not selected by a lang_ class anywhere in JS', () => {
  /* gulp strips <lang> wrappers from built pages, so any selector keyed on one
     matches nothing in production and everything in the source. */
  assert.ok(
    !/lang_(datasharing|sharecustomers|sharesuppliers|shareinventory)/.test(branchesJs),
    'a lang_ class is being used as a selector - it does not exist after the build',
  );
});

/*
 * The permanent home, in Settings.
 *
 * The branch form promises "can be changed later in Settings", so that has to
 * be true. This block is the only thing on that screen that writes at ACCOUNT
 * level, which is where its two traps come from.
 */
const settingsHtml = fs.readFileSync(
  path.join(ROOT, 'frontend', 'modules', 'settings_write.html'),
  'utf8',
);
const settingsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'),
  'utf8',
);

test('Settings carries the switches the branch form promised', () => {
  for (const id of ['set_share_customers', 'set_share_suppliers', 'set_share_inventory']) {
    assert.ok(new RegExp(`id="${id}"`).test(settingsHtml), `${id} is missing from Settings`);
  }
  assert.match(settingsHtml, /id="sharing_save_btn"/, 'there is no way to save it');
});

test('it has its OWN save, not the general form save', () => {
  /* Everything around it writes to this branch. Riding that save would let a
     screen opened on one shop push that shop's view onto all of them. */
  assert.match(settingsHtml, /onclick="PosnicPro\.settings\.saveSharing\(\);"/, 'no dedicated save');
  const save = blockAt(settingsJs, 'PosnicPro.settings.saveSharing = function () {');
  assert.match(save, /url: 'settings\/group\/sharing'/, 'it must use the sharing endpoint alone');
  assert.match(save, /level: 'account'/, 'writing at branch level would not share anything');
});

test('it READS the account level, not what this branch resolves to', () => {
  /* resolveGroup answers "what is in force at THIS branch". Showing that and
     saving it back turns one branch's override into everybody's rule. */
  const load = blockAt(settingsJs, 'PosnicPro.settings.loadSharing = function () {');
  assert.match(load, /level: 'account'/, 'the read must ask for the account level');
});

test('every switch travels on save, including the ones left alone', () => {
  const save = blockAt(settingsJs, 'PosnicPro.settings.saveSharing = function () {');
  assert.match(save, /is\(':checked'\)/, 'the value must be stated, not implied');
  assert.ok(
    !/if \(\$\('#set_/.test(save),
    'a switch is being sent conditionally - the server would keep what it had',
  );
});

test('"false" is read as false on the way in as well', () => {
  const on = blockAt(settingsJs, 'PosnicPro.settings._sharingOn = function (v) {');
  assert.match(on, /toLowerCase\(\)/, '"TRUE" from an older screen must still read as true');
  assert.match(on, /t === 'true'/, 'the string form is what a form actually writes');
  assert.ok(!/return !!v/.test(on), '!!"false" is true - the switch would show the opposite');
});

test('the panel loads on the way in, not only when the tab is clicked', () => {
  /* Core Settings is the tab that is ALREADY active, so a click handler alone
     never fires on first open and the switches sit at their markup default -
     disagreeing with what is stored. */
  const entry = blockAt(settingsJs, 'showDataTablePage: function () {');
  assert.match(entry, /PosnicPro\.settings\.loadSharing\(\)/, 'first open would show stale switches');
});

test('a refused save says WHY', () => {
  /* This is deliberately owner-class. A generic "could not save" turns a
     permission rule into a mystery. */
  const save = blockAt(settingsJs, 'PosnicPro.settings.saveSharing = function () {');
  assert.match(save, /xhr\.status === 403/, '403 is not distinguished');
  assert.match(save, /Only an owner/i, 'the reason is not said out loud');
});
