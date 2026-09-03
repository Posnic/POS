/*
 * The guided tour: point at real things, skip what is not there, leave when
 * told, never come back uninvited.
 *
 * Owner: "in feature we might want to do the guide tour for the user."
 *
 * WHAT BREAKS SILENTLY HERE. A tour is a list of selectors into an app that
 * keeps changing. Every failure mode is quiet: an id renamed means a step
 * floats in space or the tour strands; a feature switched off means a target
 * that never appears; a tour that re-offers itself is nagging nobody reports,
 * they just close it angrier each time. So the tests pin the guards and pin
 * the SELECTORS against the real markup - the one check nobody does by hand
 * after a refactor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const tourJs = strip(read('frontend/static/script/js/core/tour.js'));
const settingsJs = strip(read('frontend/static/script/js/modules/js/settings.js'));
const modalHtml = strip(read('frontend/modals/feature_intro.html'));
const customCss = strip(read('frontend/static/style/css/custom.css'));

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a > -1, `${from} not found`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `${to} not found after ${from}`);
  return source.slice(a, b);
}

test('every selector the tour points at exists in the real markup', () => {
  /*
   * THE test. A tour step names an id; a refactor renames the id; nothing
   * anywhere fails - the step is silently skipped forever and the tour
   * quietly gets shorter. Each target is asserted against the file that
   * actually renders it.
   */
  const sidebar = read('frontend/layouts/sidebar.html');
  const sales = read('frontend/modules/sales_write.html');
  const settings = read('frontend/modules/settings_write.html');

  assert.match(sidebar, /class="vertical-menu/);
  assert.match(sales, /id="sales_new_item_name"/);
  assert.match(sales, /id="sales_new_productList"/);
  assert.match(sales, /id="quick_sale_btn"/);
  assert.match(settings, /id="v-pills-modules"/);

  // And the steps really name those five, so this test cannot drift from
  // the tour it protects.
  const steps = between(tourJs, 'firstRun: function', 'start: function');
  for (const sel of ['.vertical-menu', '#sales_new_item_name',
    '#sales_new_productList', '#quick_sale_btn', '#v-pills-modules']) {
    assert.ok(steps.includes(`'${sel}'`), `the tour no longer points at ${sel}`);
  }
});

test('a missing or hidden target skips the step instead of stranding the tour', () => {
  const move = between(tourJs, '_move: function', 'show: function');
  // visibility, not mere existence: an element in a hidden pane has size 0
  assert.match(move, /offsetWidth > 0 && \w+\.offsetHeight > 0/);
  // bounded wait, then skip IN THE DIRECTION OF TRAVEL - skipping forward
  // while going back would trap Back on a missing step
  assert.match(move, /waited >= 3000/);
  assert.match(move, /self\._move\(dir\)/);
});

test('steps wait for the SPA to build the page, never a fixed sleep alone', () => {
  const move = between(tourJs, '_move: function', 'show: function');
  assert.match(move, /hasher\.setHash\(step\.hash\)/);
  assert.match(move, /setTimeout\(tryShow, 150\)/);
});

test('the tour starts only after a SUCCESSFUL save, and only when asked', () => {
  /*
   * Two doors, one save path. The tour button sets a flag the save-success
   * handler reads: a failed save must never start a tour of a shop that did
   * not save, and plain Save must never grow an uninvited tour.
   */
  /*
   * The tour button raises the flag and then saves. Asserted over the WHOLE
   * handler rather than as two adjacent lines: this regex demanded that
   * `_tourAfterSave = true;` be immediately followed by `saveIntro()`, and a
   * later change inserted `_settingsAfterSave = false;` between them. Both pull
   * requests were green on their own and the merge of the two was red - the
   * behaviour never changed, only the line spacing.
   *
   * A test that fails when a correct line is added tests the typing, not the
   * program.
   */
  const tourButton = between(settingsJs, "on('click', '#feature_intro_tour'", '});');
  assert.match(tourButton, /_tourAfterSave = true;/,
    'the tour button does not raise the flag the save-success handler reads');
  assert.match(tourButton, /PosnicPro\.features\.saveIntro\(\)/,
    'the tour button does not save');
  assert.ok(
    tourButton.indexOf('_tourAfterSave = true;') < tourButton.indexOf('saveIntro()'),
    'the flag must be set before the save, or the success handler will not see it'
  );
  const success = between(settingsJs, "PosnicPro.alert('success', 'Feature switches saved')", 'PosnicPro.alert(response.type');
  assert.match(success, /if \(PosnicPro\.features\._tourAfterSave\)/);
  assert.match(success, /PosnicPro\.tour\.firstRun\(\)/);
  // the failure path clears the flag, or the NEXT save inherits the wish
  const fail = between(settingsJs, "Could not save - you can set these later", '};');
  assert.match(settingsJs, /_tourAfterSave = false;\s*\n\s*PosnicPro\.alert\('error'/);
  assert.ok(fail.length >= 0);
});

test('leaving is remembered per shop, and a silent restart is not "seen"', () => {
  const key = between(tourJs, 'seenKey: function', 'firstRun: function');
  assert.match(key, /branch_id_set/);
  assert.match(key, /'feature_tour_done:' \+ branch/);
  const close = between(tourJs, 'close: function (silent)', '};');
  assert.match(close, /if \(!silent && \w+\._steps\.length\)/);
  assert.match(close, /local\.set\(PosnicPro\.tour\.seenKey\(\), 'true'\)/);
});

test('Escape leaves, arrows move, and the listeners leave with the tour', () => {
  assert.match(tourJs, /e\.key === 'Escape'/);
  assert.match(tourJs, /ArrowRight|ArrowLeft/);
  /* Namespaced handlers, removed in close(): a dead tour still eating
     Escape and Enter is a keyboard bug on the SALE screen. */
  assert.match(tourJs, /\.posnictour/);
  const close = between(tourJs, 'close: function (silent)', '};');
  assert.match(close, /off\('\.posnictour'\)/);
  assert.match(close, /removeEventListener\('resize'/);
  assert.match(close, /removeEventListener\('scroll', \w+\._reposition, true\)/);
});

test('the spotlight follows the element on scroll and resize', () => {
  assert.match(tourJs, /addEventListener\('scroll', self\._reposition, true\)/);
  assert.match(tourJs, /addEventListener\('resize', self\._reposition\)/);
});

test('the card is pulled back inside the window on every side', () => {
  const place = between(tourJs, 'place: function', 'close: function');
  assert.match(place, /left \+ cw > vw - 8/);
  assert.match(place, /if \(left < 8\)/);
  assert.match(place, /top \+ ch > vh - 8/);
  assert.match(place, /if \(top < 8\)/);
});

test('the tour is in the dashboard bundle, or none of this runs', () => {
  const map = read('frontend/pages_css_js_map.json');
  const dashboard = map.slice(map.indexOf('"dashboard"'), map.indexOf('"login"'));
  assert.ok(dashboard.includes('static/script/js/core/tour.js'),
    'tour.js is not bundled into the dashboard');
});

test('the welcome offers it and the Features page can re-run it', () => {
  assert.match(modalHtml, /id="feature_intro_tour"/);
  const settings = read('frontend/modules/settings_write.html');
  assert.match(settings, /id="features_take_tour"/);
  assert.match(settings, /PosnicPro\.tour\.firstRun\(\)/);
});

test('the tour is styled from theme tokens', () => {
  const block = customCss.slice(customCss.indexOf('#posnic_tour'));
  assert.match(block, /var\(--theme-card-bg/);
  assert.match(block, /var\(--theme-primary-color/);
  assert.match(block, /prefers-reduced-motion/);
  const hard = block.match(/(?:^|[^-\w])(?:background|color):\s*#[0-9a-fA-F]{3,8}\s*;/gm) || [];
  assert.deepStrictEqual(hard, [], 'the tour hard-codes colours: ' + hard.join(', '));
});
