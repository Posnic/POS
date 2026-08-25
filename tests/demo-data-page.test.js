/*
 * Changing which trade a shop's sample data comes from.
 *
 * Owner: "Demo data user should able to change the industry and install the
 * different data. so keep dedicated page for that."
 *
 * WHAT WAS ACTUALLY WRONG
 *
 * A shop signs up in about thirty seconds. It either picks a trade from a short
 * list or does not pick one at all, and a shop that does not pick is given the
 * supermarket set - which is the right default and the wrong catalogue for a
 * bakery. That bakery then opens its till for the first time and finds
 * twenty-four grocery lines. It is the first thing they see of the product, and
 * until now the only way out was deleting the samples one at a time.
 *
 * The dangerous half is not the chooser. It is that swapping trades DELETES
 * rows, and some of those rows are no longer samples: a shop edits a sample
 * into a real product, or sells one. The purge already refuses both and reports
 * what it kept; these tests hold that behaviour in place and hold the ordering
 * that makes it work.
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

const settingsJs = strip(read('frontend/static/script/js/modules/js/settings.js'));
const settingsHtml = strip(read('frontend/modules/settings_write.html'));
const installSvc = strip(read('api/src/services/install.service.js'));
const itemsCtrl = strip(read('api/src/controllers/items.controller.js'));
const itemsRoutes = strip(read('api/src/routes/items.routes.js'));

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a > -1, `${from} not found`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `${to} not found after ${from}`);
  return source.slice(a, b);
}

const demoPacks = between(settingsJs, 'PosnicPro.settings.demoPacks = {', "$(document).on('change', '#demo_pack_choice'");

test('Demo Data has its own page - a real pane with a sidebar entry', () => {
  /* One system (owner): the card shows the guide; configuration lives in the
     feature's OWN entry under Manage. The chooser markup moved into the
     v-pills-demodata pane, reached by #/settings/demodata. */
  assert.match(settingsHtml, /id="v-pills-demodata"/);
  assert.match(settingsHtml, /id="v-pills-demodata-tab"/);
  assert.match(settingsHtml, /id="fc_demodata"/);
  assert.match(settingsHtml, /id="demo_pack_choice"/);
  assert.match(settingsHtml, /id="demo_pack_install"/);
});

test('the trade list is served, never typed into the page', () => {
  /*
   * A list hard-coded in the frontend is correct until somebody adds a pack,
   * and then it is a menu silently missing an option nobody knows exists -
   * while the server would install it happily if asked.
   */
  assert.match(demoPacks, /url: 'items\/demo\/packs'/);
  assert.match(itemsRoutes, /router\.get\('\/demo\/packs'/);
  assert.match(itemsCtrl, /async listDemoPacks\(req, res\)/);
});

test('the chooser opens on the trade the shop is actually on', () => {
  /* Otherwise it opens on the first row of the list and reads as though the
     shop is set to something it is not. */
  assert.match(itemsCtrl, /current = \(row && row\.demo_pack\) \|\| null/);
  assert.match(demoPacks, /_current/);
  assert.match(demoPacks, /p\.key === \w+\._current \? ' selected' : ''/);
});

test('the counts are counted, not written down', () => {
  /*
   * "24 products" typed into a label is right on the day it is typed and wrong
   * from the next catalogue edit onwards - and a stale number looks exactly
   * like a fresh one.
   */
  const util = strip(read('api/utils/demoData.js'));
  const list = between(util, 'function listDemoPacks()', 'function isDemoPack');
  assert.match(list, /products: \(pack\.products \|\| \[\]\)\.length/);
  assert.match(list, /categories: \(pack\.categories \|\| \[\]\)\.length/);
});

test('a pack with no label is a failure, not a pack nobody is offered', () => {
  /*
   * DEMO_PACK_LABELS is the OUTPUT list; DEMO_PACK_BY_TYPE is the input
   * vocabulary and holds several words for the same catalogue. Adding a pack
   * to DEMO_PACKS and forgetting the label would leave it installable by the
   * server and invisible in the chooser - a feature that exists and cannot be
   * reached.
   */
  const demo = require(path.join(ROOT, 'api/utils/demoData.js'));
  const util = read('api/utils/demoData.js');
  const packs = between(util, 'const DEMO_PACKS = {', '};');
  const keys = (packs.match(/^\s{2}(\w+):/gm) || []).map((m) => m.trim().replace(':', ''));
  assert.ok(keys.length >= 7, `expected the seven catalogues, found ${keys.length}`);

  /*
   * Compared by CATALOGUE, not by key. 'electronics' and 'electrical' name the
   * same object, and offering both would put the same list in the chooser
   * twice under two names. Resolved through getDemoDataByType because that is
   * what actually decides which catalogue a key installs - inferring it from
   * an export name looks equivalent and silently treats an alias as a pack of
   * its own, which is how this test failed the first time it was written.
   */
  const offered = demo.listDemoPacks().map((p) => demo.getDemoDataByType(p.key));
  for (const key of keys) {
    const catalogue = demo.getDemoDataByType(key);
    assert.ok(offered.indexOf(catalogue) > -1,
      `${key} is installable but its catalogue is not offered in the chooser`);
  }
});

test('an explicit trade is checked, never coerced', () => {
  /*
   * getDemoDataByType falls back to the supermarket set for anything it does
   * not recognise, which is right for a trade somebody typed into a signup
   * form. Here the value came from a list we showed, so an unknown key is our
   * bug - and quietly installing groceries into a bakery is a wrong answer
   * delivered confidently.
   */
  const reseed = between(installSvc, 'async reseedDemoData(', 'async _insertBusinessTypeDemoData');
  assert.match(reseed, /if \(asked && !isDemoPack\(asked\)\)/);
  assert.match(reseed, /That is not a sample data pack\./);
});

test('an explicit trade beats what the shop had before', () => {
  /* The fallback chain is the point of the feature: without `asked` first, the
     chooser would install whatever the shop already had, every time. */
  const reseed = between(installSvc, 'async reseedDemoData(', 'async _insertBusinessTypeDemoData');
  assert.match(reseed, /const businessType =\s*\n\s*asked \|\|/);
});

test('the switch is left agreeing with what is on screen', () => {
  /*
   * Installing samples while Demo Data is switched OFF hides them the moment
   * the progress bar closes - which is indistinguishable from the install
   * having failed.
   */
  assert.match(demoPacks, /if \(!\$\('#module_demo_data_enable'\)\.is\(':checked'\)\)/);
  assert.match(demoPacks, /prop\('checked', true\)\.trigger\('change'\)/);
});

test('a swap removes before it seeds', () => {
  /* The server refuses to seed on top of existing samples, so the other order
     reports a failure that is really the guard doing its job. */
  const run = between(demoPacks, '_run: function', '_seed: function');
  assert.match(run, /PosnicPro\.delete\(\{ url: 'items\/demo'/);
  assert.match(run, /self\._seed\(key\)/);
});

test('"nothing to remove" is not treated as a failure', () => {
  /*
   * It is the ordinary state of a shop that already cleared its samples, and
   * the install it just asked for can go ahead. Stopping there would refuse
   * the one shop most likely to want a different trade.
   */
  const run = between(demoPacks, '_run: function', '_seed: function');
  assert.match(run, /nothing\|no sample\|not found/);
  assert.match(run, /self\._seed\(key\);/);
});

test('nothing is replaced without being asked', () => {
  /* This removes rows. A shop must never find its samples changed by a button
     it pressed to read the label. */
  const install = between(demoPacks, 'install: function', '_run: function');
  assert.match(install, /swal\(\{/);
  assert.match(install, /showCancelButton: true/);
  /* SweetAlert v6 REJECTS on cancel; without the second handler, pressing
     Cancel throws an unhandled rejection on a screen where nothing happened. */
  assert.match(install, /\}\).then\(function \(\) \{ \w+\._run\(key\); \}, function \(\) \{ \}\);/);
});

test('the progress bar says which work is running', () => {
  /*
   * It was written for one job - putting samples back - and its script names
   * stages of that job. Showing "Adding products…" while rows are being
   * REMOVED is a bar describing work other than the work being done.
   */
  const prog = between(settingsJs, 'PosnicPro.settings.demoProgress = {', 'PosnicPro.settings.syncDemoDataAfterSave');
  assert.match(prog, /open: function \(title\)/);
  assert.match(prog, /step: function \(label\)/);
  assert.match(prog, /_scripted = false/);
  // The scripted narration stands down once the caller starts naming stages.
  assert.match(prog, /if \(self\._scripted && i < steps\.length\)/);
  assert.match(demoPacks, /demoProgress\.open\('Changing the sample data'\)/);
});

test('the list is fetched when the page opens, not at boot', () => {
  /* A request at boot is a request on the path to a shop's first sale, for a
     screen most shops never open. The pill that opens the pane is the
     trigger now. */
  assert.match(settingsHtml,
    /id="v-pills-demodata-tab"[\s\S]{0,400}?onclick="PosnicPro\.settings\.demoPacks\.load\(\);"/);
});

test('a failed fetch says so instead of reading as still working', () => {
  assert.match(demoPacks, /Could not load the list/);
});
