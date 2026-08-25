/*
 * A phone must be able to SCROLL the dashboard without dying.
 *
 * Owner: "i opened posnic web app in my iphone 14 pro max. i just scrolled
 * down. page is keep crash." An iOS tab kill leaves no error, no log and no
 * report - the process is simply gone - so the only defence is removing the
 * mechanism: scroll collapses Safari's URL bar, every collapse is a viewport
 * resize, amCharts answers each with a full relayout of a 3D SVG chart at 3x
 * DPR, and the animated theme replays its tweens on every one. A few strokes
 * of scrolling stacks enough rebuild-and-animate cycles to blow the tab's
 * memory ceiling.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const core = strip(fs.readFileSync(
  path.join(__dirname, '..', 'frontend/static/script/js/core/PosnicPro.js'), 'utf8'));
const dash = strip(fs.readFileSync(
  path.join(__dirname, '..', 'frontend/static/script/js/modules/js/dashboard.js'), 'utf8'));

const hook = (() => {
  const at = core.indexOf('_afterLoad: {');
  assert.ok(at > -1, 'the lazy-load init hook is gone');
  return core.slice(at, core.indexOf('reportExport') > -1 ? core.indexOf('reportExport') : at + 4000);
})();

test('amCharts gets its relief valves the moment it loads', () => {
  /* Set at the LOADER, before any page draws, so every report page inherits
     them - a per-page fix would be re-fought on each of the four pages that
     use the library. */
  assert.match(hook, /am4core\.options\.queue = true/);
  assert.match(hook, /am4core\.options\.onlyShowOnViewport = true/);
  // and the hook actually runs after load, exactly once
  assert.match(core, /var init = PosnicPro\.lazy\._afterLoad\[name\]/);
  assert.match(core, /if \(init && !init\._ran\)/);
});

test('the animated theme is refused on a coarse pointer, and never stacks', () => {
  /*
   * useTheme is a REGISTRY, not a set: every dashboard filter change pushed
   * the animated theme again, so the fifth render animated everything five
   * times over - on any device. And on a phone the tweens are pure memory
   * bill, replayed on every URL-bar resize.
   */
  assert.match(hook, /pointer: coarse/);
  assert.match(hook, /theme === am4themes_animated\) \{ return; \}/);
  assert.match(hook, /applied\.indexOf\(theme\) !== -1\) \{ return; \}/);
});

test('the guard is an optimisation, never a gate', () => {
  /* An amcharts build without these options must still draw charts. */
  const blocks = hook.split('try {').length - 1;
  assert.ok(blocks >= 2, 'the two guards are not independently wrapped');
  assert.match(hook, /catch \(e\)/);
});

test('the Apex donut stops animating under a finger too', () => {
  assert.match(dash, /animations: \{\s*enabled: !\(window\.matchMedia && window\.matchMedia\('\(pointer: coarse\)'\)\.matches\),?\s*\}/);
});
