'use strict';

/*
 * A table has one open order, unless the shop says otherwise.
 *
 * Owner: "basically two orders in single table not possible." Then, when asked
 * what the rule should be: "by default one order per tabel. inside restaurant
 * keep te settings. multiple order or only one order or maximum number of
 * order. keep the settings."
 *
 * This is NOT the duplicate-order bug. That one was a double tap on a handset
 * writing the same order twice, and it is fixed elsewhere with a key on the
 * order and a unique index behind it. This is the different, deliberate case:
 * a second order, genuinely placed, on a table that already has one open. On
 * most floors that is somebody choosing the wrong table, and the cost of
 * finding out is a bill split in two at the end of the meal.
 *
 * One integer holds the whole rule, because that is what a count is compared
 * against:
 *
 *   1   one open order per table. The default.
 *   0   no limit. Some shops genuinely run a ticket per round.
 *   N   at most N.
 *
 * The dropdown and the number box on the settings screen are a way of typing
 * that integer without asking a shopkeeper to know that zero means unlimited.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const BRANCH = read('api', 'src', 'models', 'branch.model.js');
const SETTING = read('api', 'src', 'models', 'setting.model.js');
const GROUPS = read('api', 'src', 'services', 'settings-groups.js');
const SALE_REPO = read('api', 'src', 'repositories', 'sale.repository.js');
const SALE_SVC = read('api', 'src', 'services', 'sale.service.js');
const SETTINGS_JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const SETTINGS_HTML = read('frontend', 'modules', 'settings_write.html');

/* The three helpers, lifted out of settings.js and given a fake jQuery, so the
   arithmetic is exercised rather than described. */
function screen(initial = {}) {
  const values = Object.assign({
    '#table_order_limit_mode': '1',
    '#table_order_limit_max': '2',
  }, initial);
  let maxShown = null;

  const $ = (sel) => ({
    val: (v) => (v === undefined ? values[sel] : (values[sel] = String(v))),
    toggle: (on) => { if (sel === '#table_order_limit_max_wrap') maxShown = on; },
  });

  const grab = (name) => {
    const at = SETTINGS_JS.indexOf('    ' + name + ': function (');
    assert.notStrictEqual(at, -1, name + ' is gone from settings.js');
    const open = SETTINGS_JS.indexOf('{', SETTINGS_JS.indexOf('function (', at));
    let depth = 0;
    for (let i = open; i < SETTINGS_JS.length; i += 1) {
      if (SETTINGS_JS[i] === '{') depth += 1;
      else if (SETTINGS_JS[i] === '}') { depth -= 1; if (depth === 0) return SETTINGS_JS.slice(at + 4 + name.length + 2, i + 1); }
    }
    throw new Error('unbalanced braces in ' + name);
  };

  const settings = {};
  const PosnicPro = { settings };
  for (const name of ['showTableOrderLimit', 'tableOrderLimitMode', 'tableOrderLimitValue']) {
    settings[name] = new Function('$', 'PosnicPro', 'return ' + grab(name) + ';')($, PosnicPro);
  }
  return { settings, values, maxShownNow: () => maxShown };
}

test('a branch that has never been asked allows one order per table', () => {
  assert.match(BRANCH, /table_order_limit: \{ type: Number, default: 1 \}/,
    'the field has no default, so an unasked shop would allow any number');
  assert.match(BRANCH, /withDefaults\.table_order_limit = withDefaults\.table_order_limit \?\? 1;/,
    'a branch written before this setting existed would read as no limit');
  assert.match(BRANCH, /table_order_limit: 1,/, 'a newly seeded branch has no limit set');
});

test('the default is read with ?? and not with ||, because zero is a real answer', () => {
  /*
   * `|| 1` would turn a shop that deliberately allows any number of orders per
   * table back into a one-order shop, silently, on every read. That is the
   * single most likely way this feature quietly stops working.
   */
  assert.ok(!/table_order_limit \|\| 1/.test(BRANCH + SETTING + SALE_REPO + SALE_SVC + SETTINGS_JS),
    'somewhere reads the limit with ||, which turns "no limit" into "one"');
});

test('the number is clamped on the way in, on every writer', () => {
  /* Three places write branch settings. A clamp in one of them is a clamp in
     none of them, because a shop reaches this screen through whichever it
     happens to use. */
  const writers = SETTING.split('table_order_limit').length - 1;
  assert.ok(writers >= 4, 'not every settings writer carries the field');
  assert.match(SETTING, /table_order_limit = Math\.min\(table_order_limit, 99\)/);
  assert.match(SETTING, /updateFields\.table_order_limit = Math\.min\(cap, 99\)/);
  /* Nonsense becomes the default, not zero. Falling back to zero would read as
     "no limit", which is the opposite of what was asked for. */
  assert.match(SETTING, /if \(isNaN\(table_order_limit\) \|\| table_order_limit < 0\) \{\s*\n\s*table_order_limit = 1;/);
  assert.match(SETTING, /if \(isNaN\(cap\) \|\| cap < 0\) cap = 1;/);
});

test('it travels with the feature it belongs to', () => {
  const features = GROUPS.slice(GROUPS.indexOf('const FEATURES'), GROUPS.indexOf('const PREFERENCES'));
  assert.match(features, /'table_order_limit'/,
    'the setting is not in a group, so it would not be saved or copied with the rest');
});

test('the server refuses a second order on a full table, and says what to do', () => {
  const guard = SALE_REPO.slice(SALE_REPO.indexOf('const openTableLimit'), SALE_REPO.indexOf('const openTableLimit') + 1800);
  assert.match(guard, /sale_process: 'KOT'/, 'the count includes sales that are not table orders');
  assert.match(guard, /payment_status: 'Unpaid'/, 'a settled table would still count as occupied');
  assert.match(guard, /if \(openNow >= openTableLimit\)/);
  assert.match(guard, /Add to it, or settle it first/,
    'the refusal does not tell a waiter what to do instead');
});

test('no limit means no query at all', () => {
  /* A shop that turned the limit off must not pay for a count on every order.
     `openTableLimit > 0` guards the whole block, not just the comparison. */
  assert.match(SALE_REPO, /if \(openTableLimit > 0 && wantsTable\) \{/);
});

test('a takeaway is not a table', () => {
  /* Every takeaway order would otherwise collide on the same empty table name
     and the second one of the day would be refused. */
  assert.match(SALE_REPO, /const wantsTable = String\(servicePoint\.label \|\| kiosk_table_no \|\| table \|\| ''\)\.trim\(\);/);
  assert.match(SALE_REPO, /openTableLimit > 0 && wantsTable/);
});

test('the floor tells a handset the limit, so it can grey a full table out', () => {
  assert.match(SALE_SVC, /table_order_limit: tableOrderLimit,/,
    'the app has to place an order and be refused to find out the table was full');
  assert.match(SALE_SVC, /projection: \{ table_order_limit: 1 \}/,
    'the whole branch document is pulled for one number');
  /* And a floor that cannot read the setting still draws. The refusal on the
     server is the rule; this is only so the app can be polite about it. */
  assert.match(SALE_SVC, /could not read the table order limit/);
});

test('the setting is on the Tables tab, not on the Features list', () => {
  /* Features says whether the restaurant exists. This says how its floor
     behaves, which is a different question and a different screen. */
  const tables = SETTINGS_HTML.slice(
    SETTINGS_HTML.indexOf('id="restauranttables-line"'),
    SETTINGS_HTML.indexOf('id="restaurantmenu-line"')
  );
  assert.match(tables, /id="table_order_limit_mode"/, 'the control is not on the Tables tab');
  assert.match(tables, /lang_orders_per_table/, 'the card has no heading a pack can translate');
});

test('the three choices are one order, at most this many, and no limit', () => {
  const { settings, values, maxShownNow } = screen();

  settings.showTableOrderLimit(1);
  assert.strictEqual(values['#table_order_limit_mode'], '1');
  assert.strictEqual(settings.tableOrderLimitValue(), '1');
  assert.strictEqual(maxShownNow(), false, 'the number box shows for a one-order shop');

  settings.showTableOrderLimit(0);
  assert.strictEqual(values['#table_order_limit_mode'], '0');
  assert.strictEqual(settings.tableOrderLimitValue(), '0');

  settings.showTableOrderLimit(4);
  assert.strictEqual(values['#table_order_limit_mode'], 'max');
  assert.strictEqual(values['#table_order_limit_max'], '4');
  assert.strictEqual(settings.tableOrderLimitValue(), '4');
  assert.strictEqual(maxShownNow(), true, 'the number box is hidden when it is the thing being set');
});

test('a blank or silly number box never saves as "no limit"', () => {
  /*
   * parseInt('') || 0 is 0, and 0 means unlimited. A shopkeeper who cleared
   * the box to retype it and hit Save would have turned the limit off without
   * being told.
   */
  const { settings, values } = screen({ '#table_order_limit_mode': 'max' });
  for (const typed of ['', '0', '1', 'abc', '-3']) {
    values['#table_order_limit_max'] = typed;
    assert.strictEqual(settings.tableOrderLimitValue(), '2',
      'a box holding "' + typed + '" saved as something other than the smallest real maximum');
  }
  values['#table_order_limit_max'] = '500';
  assert.strictEqual(settings.tableOrderLimitValue(), '99', 'the maximum is not capped');
});

test('switching to "at most this many" offers a number that means something', () => {
  /* The box has a minimum of 2. Leaving a 1 in it would show a value the
     control itself rejects. */
  const { settings, values } = screen();
  settings.showTableOrderLimit(1);
  assert.strictEqual(values['#table_order_limit_max'], '2');
  settings.showTableOrderLimit(0);
  assert.strictEqual(values['#table_order_limit_max'], '2');
});

test('the screen saves the number, and keeps no dead control to do it', () => {
  assert.match(SETTINGS_JS, /table_order_limit: PosnicPro\.settings\.tableOrderLimitValue\(\),/,
    'the setting is not in the save payload');
  /* An input nothing reads is a control that looks like it works. */
  assert.ok(!/id="table_order_limit"[^_]/.test(SETTINGS_HTML),
    'a hidden field was left behind that nothing reads');
});
