const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The post-sale confirmation strip.
 *
 * What used to sit here was:
 *
 *     Last Created Record  [View]
 *
 * A centred heading and a link - no sale number, no total, no customer, and
 * crucially not the change due, which for a cash sale is the number the
 * cashier acts on next and the routine mistake that costs real money.
 *
 * The owner chose stay-until-dismissed over auto-return, so nothing here may
 * be on a timer: a confirmation that clears itself is one a busy cashier can
 * miss entirely. The only timer permitted is the one that DISARMS the void
 * button, which fails safe.
 */

const ROOT = path.join(__dirname, '..');
const salesJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
  'utf8',
);
const salesHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'sales_write.html'), 'utf8');
const css = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'),
  'utf8',
);
const salesController = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'controllers', 'sales.controller.js'),
  'utf8',
);

/* The balanced { ... } opening at or after `marker`. Anchored lookups only -
   a bare first-occurrence match in these files lands in the wrong place. */
function blockAt(source, marker) {
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `not found: ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        assert.ok(i > start, 'block ends before it begins');
        return source.slice(start, i + 1);
      }
    }
  }
  assert.fail(`unbalanced block after: ${marker}`);
}

function cssRule(sel) {
  const at = css.indexOf(sel);
  assert.notStrictEqual(at, -1, `no CSS rule for: ${sel}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.ok(close > open);
  return css.slice(open + 1, close);
}

test('the bare "Last Created Record" link is gone', () => {
  assert.ok(
    !/Last Created Record\s*<a/.test(salesHtml),
    'a link with no information was the thing being replaced',
  );
  assert.ok(salesHtml.includes('sale-done-strip'), 'the strip must be there instead');
});

test('the strip says which sale, for how much, to whom', () => {
  for (const id of ['sds_number', 'sds_total', 'sds_customer', 'sds_loyalty', 'sds_change']) {
    assert.ok(salesHtml.includes(`id="${id}"`), `${id} missing from the strip`);
  }
  // View still works - the old link id is deliberately kept, so the code that
  // sets its href keeps finding it
  assert.ok(salesHtml.includes('id="last_created_sale"'), 'View must survive the rewrite');
});

test('change due is the largest thing on it', () => {
  const value = cssRule('.sds-change-value {');
  const line = cssRule('.sds-line {');
  const sizeOf = (rule) => {
    const m = rule.match(/font-size:\s*([\d.]+)px/);
    assert.ok(m, 'no font-size');
    return Number(m[1]);
  };
  assert.ok(
    sizeOf(value) > sizeOf(line) * 1.5,
    'the change figure must dominate, not merely be present',
  );
  assert.match(value, /tabular-nums/, 'money in columns needs tabular figures');
});

test('a sale with no change to give back does not shout a zero', () => {
  const fn = blockAt(salesJs, 'PosnicPro.sales.showSaleDone = function');
  assert.match(
    fn,
    /\$\('#sds_change_wrap'\)\.toggle\(change > 0\)/,
    'a card or exact-cash sale should show the sale, not a zero change figure',
  );
});

test('the change figure agrees with the tender panel rather than recomputing it', () => {
  const fn = blockAt(salesJs, 'PosnicPro.sales.showSaleDone = function');
  assert.ok(
    fn.includes('#tendered_balance'),
    'recomputing change invites the strip and the screen to disagree',
  );
});

test('loyalty shows only when the sale actually earned some', () => {
  const fn = blockAt(salesJs, 'PosnicPro.sales.showSaleDone = function');
  assert.match(fn, /loyalty_earned/, 'the strip must read the earned points');
  assert.match(
    fn,
    /Number\(loy\.points\) > 0/,
    'a shop with loyalty off must never see an empty points line',
  );
});

test('the API hands the points back before the response is written', () => {
  const fn = blockAt(salesController, 'async applyLoyaltyEarn(req, saleData) {');
  assert.match(fn, /const earned = await loyaltyService\.earn/, 'the result was being discarded');
  assert.match(fn, /saleData\.loyalty_earned = \{/, 'it must ride out on the sale response');
  // only when there is something to say
  assert.match(fn, /if \(pts > 0\)/, 'zero points should not produce a loyalty line');

  // and it must still run before the response, or attaching it achieves nothing
  const hook = salesController.indexOf('await this.applyLoyaltyEarn(req, result.data)');
  const respond = salesController.indexOf('return this.success(res, result.data, message, 200)');
  assert.notStrictEqual(hook, -1);
  assert.notStrictEqual(respond, -1);
  assert.ok(hook < respond, 'the loyalty hook must run before the response is sent');
});

test('nothing dismisses the strip on a timer', () => {
  const fn = blockAt(salesJs, 'PosnicPro.sales.showSaleDone = function');
  assert.ok(
    !/setTimeout[\s\S]*#show_last_created_sale/.test(fn),
    'the owner chose stay-until-dismissed; an auto-clearing confirmation can be missed',
  );
});

test('Enter starts the next sale, but only when the strip is up', () => {
  const handler = blockAt(salesJs, "$(document).on('keydown', function (e) {");
  assert.match(handler, /e\.which !== 13/, 'it is the Enter key');
  assert.match(
    handler,
    /\$\('#show_last_created_sale'\)\.is\(':visible'\)/,
    'Enter must not hijack the page when the strip is not showing',
  );
  assert.match(
    handler,
    /is\('input, textarea, select, \[contenteditable="true"\]'\)/,
    'Enter inside a field belongs to that field',
  );
});

test('voiding takes two clicks and disarms itself', () => {
  const handler = blockAt(salesJs, "$(document).on('click', '#sds_void', function () {");
  assert.match(handler, /\$btn\.data\('armed'\)/, 'a destructive action must not be one click');
  assert.match(handler, /setTimeout/, 'a stray first click must not leave it armed');
  assert.match(handler, /sales\/cancel\//, 'it reverses stock, loyalty, coupons and cashback');

  // a fresh sale must never inherit the previous armed state
  const show = blockAt(salesJs, 'PosnicPro.sales.showSaleDone = function');
  assert.match(show, /\.data\('armed', false\)/, 'the strip must reset the button');
});

test('void is hidden from whoever the server would refuse anyway', () => {
  const at = salesHtml.indexOf('id="sds_void"');
  assert.notStrictEqual(at, -1);
  const tag = salesHtml.slice(at, at + 220);
  assert.match(tag, /data-module="sales"/, 'the ACL layer needs the module');
  assert.match(
    tag,
    /data-access="delete"/,
    'the server gates cancel on sales:delete - the button must match it',
  );

  // and the server side of that gate must still be there
  const cancel = blockAt(salesController, '  async cancel(req, res) {');
  assert.match(
    cancel,
    /checkPermission\('sales', 'delete', req\.user\)/,
    'hiding the button is not the gate; this is',
  );
});
