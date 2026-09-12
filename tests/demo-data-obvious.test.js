'use strict';

/*
 * Sample data says it is sample data, and can be got rid of from where you
 * are standing.
 *
 * Owner: "when demo enable need some notification or obvious demo data exist
 * and able to disable quickly. people also afraid clear existing data option
 * will delete newly created or not. so make it clear on this things."
 *
 * A shop set up with samples has products, sales and purchases it never made,
 * and until now no screen said so - the dashboard's figures are the
 * demonstration's and get read as the shop's. And the one control that
 * removes them sat in the Features list, where somebody looking at the
 * samples would not think to look, under wording that did not promise their
 * own work was safe.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HEADER = read('frontend', 'layouts', 'header.html');
const SHELL = read('frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');
const HTML = read('frontend', 'modules', 'settings_write.html');
const JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const CSS = read('frontend', 'static', 'style', 'css', 'custom.css');

test('every page says so while the samples are on, once and not twice', () => {
  assert.strictEqual((HEADER.match(/id="demo_data_bar"/g) || []).length, 1, 'the bar is missing, or in the markup twice');
  for (const key of ['lang_demo_bar_tag', 'lang_demo_bar_text', 'lang_demo_bar_manage']) {
    assert.ok(HEADER.includes(key), key + ' is not on the bar');
  }
  assert.match(HEADER, /href="#\/settings\/demodata"/, 'the bar offers no way to act on it');
  assert.match(HEADER, /data-t-aria-label="lang_hide"/, 'the dismiss button carries English no pack can reach');
});

test('the bar follows the switch, and stays quiet for the day once it is read', () => {
  assert.strictEqual((SHELL.match(/var samplesOn = /g) || []).length, 1, 'the toggle is missing, or applied twice');
  assert.match(SHELL, /\$\('#demo_data_bar'\)\.toggle\(samplesOn && !quiet\);/);
  assert.match(SHELL, /var samplesOn = on\('module_demo_data_enable'\);/, 'the bar does not read the Demo Data switch');
  assert.match(SHELL, /'demo_bar_hidden'\) === new Date\(\)\.toDateString\(\)/, 'dismissing it is forever, or for nothing');
  assert.match(SHELL, /on\('click', '#demo_data_bar_hide'/, 'the bar cannot be dismissed');
});

test('the Demo Data page has the door out, with the promise beside it', () => {
  const pane = HTML.slice(HTML.indexOf('id="v-pills-demodata"'), HTML.indexOf('id="v-pills-quotes"'));
  assert.ok(pane.includes('id="fc_demoremove"'), 'the page offers no way to remove the samples');
  assert.ok(pane.includes('id="demo_remove_all"'), 'there is no button');
  assert.ok(pane.includes('lang_demoremove_safe'), 'nothing on the page promises the shop its own work is safe');
  assert.match(pane, /lang_demoremove_help">[^<]*products, sales,\s*purchases, quotes, customers and suppliers/,
    'the page does not say which kinds of record go');
});

test('every wording that removes samples says what is NOT removed', () => {
  /* The fear the owner reported, in the three places it is decided. */
  const pane = HTML.slice(HTML.indexOf('id="v-pills-demodata"'), HTML.indexOf('id="v-pills-quotes"'));
  assert.match(pane, /Nothing you created yourself is removed/, 'the page');
  assert.match(JS, /Nothing you created yourself is removed/, 'the confirmation on the page');
  const featureConfirm = JS.slice(JS.indexOf('PosnicPro.settings.confirmDemoOff = function'));
  assert.match(featureConfirm.slice(0, 1200), /Nothing you created yourself is removed/, 'the Features switch');
  assert.match(JS, /Off removes the samples and nothing of your own/, 'the feature card still says only "Off removes them"');
  assert.match(pane, /Records you created yourself are never touched/, 'swapping trades does not promise it either');
});

test('removing from the page switches it off FIRST, then removes', () => {
  /*
   * Order matters. A removal that fails after the switch is off leaves the
   * samples hidden, which is what was asked for. A switch that fails after
   * the removal leaves a shop that asked for none of it looking at a feature
   * that says the samples are on and a catalogue that no longer has them.
   */
  const at = JS.indexOf('    removeAll: function () {');
  const fn = JS.slice(at, JS.indexOf('    load: function () {', at));
  assert.ok(fn.length > 200, 'removeAll is missing');
  assert.ok(fn.indexOf("url: 'settings/group/features'") < fn.indexOf("url: 'items/demo'"),
    'the samples are removed before the switch is off');
  assert.match(fn, /module_demo_data_enable: false/);
  assert.match(fn, /PosnicPro\.settings\._demoWasOn = false;/, 'the next save would ask to remove them all over again');
  assert.match(fn, /harmless = \/nothing\|no sample\|not found\/i\.test\(msg\)/, 'nothing to remove is reported as a failure');
  assert.match(JS, /on\('click', '#demo_remove_all', function \(\) \{\s*PosnicPro\.settings\.demoPacks\.removeAll\(\);/);
});

test('the bar and the promise are painted from theme variables', () => {
  const block = CSS.slice(CSS.indexOf('SAMPLE DATA, SAID OUT LOUD'));
  assert.ok(block.length > 100, 'no styles for the bar');
  for (const rule of ['.demo-data-bar', '.demo-data-bar-tag', '.demo-data-bar-hide', '#fc_demoremove .demo-safe-note']) {
    assert.ok(block.includes(rule), rule + ' is not styled');
  }
  const bare = block.match(/(?<![-\w(,\s])color:\s*#[0-9a-f]{3,6}/gi) || [];
  assert.deepStrictEqual(bare, [], 'a colour spelled out by hand where a theme could want a say');
});
