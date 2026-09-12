'use strict';

/*
 * Sample data says it is sample data, says how much of it there is, and can
 * be removed from wherever you noticed it.
 *
 * Owner, first: "when demo enable need some notification or obvious demo data
 * exist and able to disable quickly. people also afraid clear existing data
 * option will delete newly created or not." Then, after seeing the first
 * version: "some customer ping ask how to remove data. so remove data one
 * dashboard or all pages might be helpful. should not annoy but it should be
 * very useful."
 *
 * A link to a settings page answers "where is the button". The question under
 * it is "how much of what I am looking at is not mine", and the dashboard is
 * where that costs something, because its figures include the samples. So the
 * count is read once a visit and both surfaces draw from it, both remove from
 * where they stand, and both go quiet the moment there is nothing to say.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HEADER = read('frontend', 'layouts', 'header.html');
const SHELL = read('frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');
const DASH_HTML = read('frontend', 'modules', 'dashboard.html');
const DASH_JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'dashboard.js');
const HTML = read('frontend', 'modules', 'settings_write.html');
const JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const CSS = read('frontend', 'static', 'style', 'css', 'custom.css');
const REPO = read('api', 'src', 'repositories', 'item.repository.js');
const ROUTES = read('api', 'src', 'routes', 'items.routes.js');

const samples = SHELL.slice(SHELL.indexOf('PosnicPro.demoSamples = {'), SHELL.indexOf("$(document).on('click', '#demo_data_bar_hide'"));

test('every page says so while there are samples, once and not twice', () => {
  assert.strictEqual((HEADER.match(/id="demo_data_bar"/g) || []).length, 1, 'the bar is missing, or in the markup twice');
  for (const key of ['lang_demo_bar_tag', 'lang_demo_bar_text']) {
    assert.ok(HEADER.includes(key), key + ' is not on the bar');
  }
  assert.match(HEADER, /data-t-aria-label="lang_hide"/, 'the dismiss button carries English no pack can reach');
  /* The bar removes; it does not only point at a page that removes. */
  assert.ok(HEADER.includes('id="demo_data_bar_remove"'), 'the bar cannot remove the samples itself');
  assert.match(HEADER, /href="#\/settings\/demodata"/, 'the bar offers no way to look at them first');
});

test('nothing is said until the server says there is something to say', () => {
  /* A shop whose samples are all gone but whose switch is still on used to be
     told it had samples. The count is what decides now, not the switch. */
  assert.match(samples, /if \(!s \|\| !s\.on \|\| !\(Number\(s\.total\) > 0\)\) \{ return false; \}/,
    'the bar is shown without knowing whether any samples remain');
  assert.match(samples, /url: 'items\/demo\/status'/, 'nothing reads the count');
  assert.match(samples, /self\._status = \{ on: false, total: 0, counts: \{\} \};[\s\S]{0,200}\}\);\s*\},/,
    'a failed count is treated as "there are samples"');
  assert.match(SHELL, /PosnicPro\.demoSamples\.load\(\);/, 'the shell never asks for the count');
});

test('the bar and the dashboard card never both speak', () => {
  assert.match(samples, /var onCard = show && \$\('#demo_data_card'\)\.is\(':visible'\);/);
  assert.match(samples, /\$\('#demo_data_bar'\)\.toggle\(show && !onCard\);/, 'the same thing is said twice on the dashboard');
  assert.match(samples, /'demo_bar_hidden'\) === new Date\(\)\.toDateString\(\)/, 'dismissing the bar is forever, or for nothing');
  assert.match(SHELL, /on\('click', '#demo_data_bar_hide'/, 'the bar cannot be dismissed');
});

test('the dashboard says how many of each kind, and removes them from there', () => {
  assert.strictEqual((DASH_HTML.match(/id="demo_data_card"/g) || []).length, 1, 'the card is missing, or in the markup twice');
  for (const id of ['demo_data_card_counts', 'demo_card_remove', 'demo_card_keep']) {
    assert.ok(DASH_HTML.includes(`id="${id}"`), `#${id} is missing from the dashboard card`);
  }
  assert.ok(DASH_HTML.includes('lang_demo_card_help'), 'the card does not say the figures on the page include the samples');
  assert.match(DASH_JS, /PosnicPro\.demoSamples\.load\(function \(status\) \{/, 'the card does not read the count');
  assert.match(DASH_JS, /if \(!status \|\| !status\.on \|\| !\(Number\(status\.total\) > 0\)\)/, 'the card shows with nothing to show');
  assert.match(DASH_JS, /on\('click', '#demo_card_remove', function \(\) \{\s*PosnicPro\.demoSamples\.remove\(\);/);
  /* Kept for a month, not for ever: somebody interrupted at the counter
     should be asked again. */
  assert.match(DASH_JS, /30 \* 24 \* 60 \* 60 \* 1000/, 'keeping them quiets the card for ever');
  assert.match(DASH_JS, /PosnicPro\.local\.set\('demo_card_kept', String\(Date\.now\(\)\)\)/);
});

test('each kind is named by a key a translator is actually offered', () => {
  /* The scanner reads literal t('lang_...') calls; a key held in a variable
     is a key no pack ever gets asked for. */
  for (const key of ['items', 'sales', 'purchases', 'quotes', 'customers', 'suppliers']) {
    assert.ok(DASH_JS.includes(`PosnicPro.i18n.t('lang_demo_kind_${key}'`), `lang_demo_kind_${key} is not a literal call`);
  }
});

test('one removal, reached from all three doors', () => {
  /*
   * Order matters. A removal that fails after the switch is off leaves the
   * samples hidden, which is what was asked for. A switch that fails after
   * the removal leaves a shop looking at a feature that says the samples are
   * on and a catalogue that no longer has them.
   */
  const remove = samples.slice(samples.indexOf('    remove: function (done) {'), samples.indexOf('    _done: function'));
  assert.ok(remove.length > 400, 'the removal is missing from the shell');
  assert.ok(remove.indexOf("url: 'settings/group/features'") < remove.indexOf("url: 'items/demo'"),
    'the samples are removed before the switch is off');
  assert.match(remove, /module_demo_data_enable: false/);
  assert.match(remove, /PosnicPro\.settings\._demoWasOn = false;/, 'the next settings save would ask to remove them again');
  assert.match(remove, /harmless = \/nothing\|no sample\|not found\/i\.test\(msg\)/, 'nothing to remove is reported as a failure');
  /* All three doors, one implementation. */
  assert.match(JS, /removeAll: function \(\) \{\s*PosnicPro\.demoSamples\.remove\(\);\s*\},/, 'the settings page keeps its own copy of the deletion');
  assert.match(SHELL, /on\('click', '#demo_data_bar_remove', function \(\) \{\s*PosnicPro\.demoSamples\.remove\(\);/);
  assert.match(DASH_JS, /on\('click', '#demo_card_remove'/);
  /* And when it is done, nothing anywhere still claims there are samples. */
  const done = samples.slice(samples.indexOf('    _done: function'));
  assert.match(done, /\$\('#demo_data_bar,#demo_data_card'\)\.hide\(\);/);
  assert.match(done, /_status = \{ on: false, total: 0, counts: \{\} \};/);
});

test('the counts come from the server, kind by kind, and never throw', () => {
  assert.match(ROUTES, /router\.get\('\/demo\/status', bindController\(itemsController\.demoStatus\)\)/, 'there is no endpoint to read');
  const counts = REPO.slice(REPO.indexOf('  async demoCounts('), REPO.indexOf('  async purgeDemoData('));
  assert.ok(counts.length > 400, 'demoCounts is missing');
  for (const kind of ['items', 'sales', 'receivings', 'quotes', 'customers', 'suppliers']) {
    assert.ok(counts.includes(`'${kind}'`), `${kind} is not counted`);
  }
  assert.match(counts, /demoData\.seededClause\(name\)/, 'the counts do not use the same idea of "sample" as the removal');
  assert.match(counts, /\$in: \[value, String\(value\)\]/, 'a branch written as a string counts as zero');
  assert.match(counts, /del_status: \{ \$ne: 1 \}/, 'samples in the recycle bin are counted as still here');
  assert.match(counts, /counts\[name\] = 0;/, 'a collection that cannot be counted breaks the dashboard');
});

test('the Demo Data page has the door out, with the promise beside it', () => {
  const pane = HTML.slice(HTML.indexOf('id="v-pills-demodata"'), HTML.indexOf('id="v-pills-quotes"'));
  assert.ok(pane.includes('id="fc_demoremove"'), 'the page offers no way to remove the samples');
  assert.ok(pane.includes('id="demo_remove_all"'), 'there is no button');
  assert.ok(pane.includes('lang_demoremove_safe'), 'nothing on the page promises the shop its own work is safe');
});

test('every wording that removes samples says what is NOT removed', () => {
  /* The fear the owner reported, in each place it is decided. */
  const pane = HTML.slice(HTML.indexOf('id="v-pills-demodata"'), HTML.indexOf('id="v-pills-quotes"'));
  assert.match(pane, /Nothing you created yourself is removed/, 'the page');
  assert.match(samples, /Nothing you created yourself is removed/, 'the confirmation shared by all three doors');
  const featureConfirm = JS.slice(JS.indexOf('PosnicPro.settings.confirmDemoOff = function'));
  assert.match(featureConfirm.slice(0, 1200), /Nothing you created yourself is removed/, 'the Features switch');
  assert.match(JS, /Off removes the samples and nothing of your own/, 'the feature card still says only "Off removes them"');
  assert.match(pane, /Records you created yourself are never touched/, 'swapping trades does not promise it either');
  assert.match(DASH_HTML, /Removing them takes nothing you created yourself/, 'the dashboard card');
});

test('the bar and the card are painted from theme variables', () => {
  for (const marker of ['SAMPLE DATA, SAID OUT LOUD', 'SAMPLE DATA, ON THE DASHBOARD']) {
    const block = CSS.slice(CSS.indexOf(marker));
    assert.ok(CSS.includes(marker) && block.length > 100, marker + ' has no styles');
  }
  const all = CSS.slice(CSS.indexOf('SAMPLE DATA, SAID OUT LOUD'));
  for (const rule of ['.demo-data-bar', '.demo-data-card', '.demo-data-card-counts .demo-count', '#fc_demoremove .demo-safe-note']) {
    assert.ok(all.includes(rule), rule + ' is not styled');
  }
  const bare = all.match(/(?<![-\w(,\s])color:\s*#[0-9a-f]{3,6}/gi) || [];
  assert.deepStrictEqual(bare, [], 'a colour spelled out by hand where a theme could want a say');
});
