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

/*
 * Round two: the relief valves were not enough - the owner's iPhone still
 * dropped the tab. So the mechanism itself goes on touch devices: the 3D
 * chart (several SVG faces per column, all re-laid-out per resize) becomes
 * its flat twin, and charts stop answering the URL-bar resize storm at all.
 */
test('the dashboard chart is FLAT on touch - 3D is for desks', () => {
    assert.match(dash, /coarse \? am4charts\.XYChart : am4charts\.XYChart3D/);
    const seriesPicks = dash.match(/coarse \? new am4charts\.ColumnSeries\(\) : new am4charts\.ColumnSeries3D\(\)/g) || [];
    assert.strictEqual(seriesPicks.length, 2, 'both column series must pick the flat twin on touch');
});

test('on touch, every chart stops listening to the viewport', () => {
    /*
     * iOS fires a REAL window resize for every URL-bar collapse under a
     * scrolling thumb, and amCharts answers each with a full SVG relayout.
     * The chart div never changes size in those resizes, so the work is
     * all waste - and the waste is what killed the tab.
     */
    const tame = core.slice(core.indexOf('_tameForTouch:'), core.indexOf('_live: {}'));
    assert.match(tame, /pointer: coarse/);
    assert.match(tame, /autoResize = false/);
    /* height-only resizes (the URL bar) are ignored; only a real width
       change re-measures, debounced */
    assert.match(tame, /window\.innerWidth === lastWidth\) \{ return; \}/);
    assert.match(tame, /setTimeout/);
    /* guarded as an optimisation - an untameable chart still renders */
    assert.match(tame, /catch \(e\)/);
    /* and the choke point actually calls it */
    const create = core.slice(core.indexOf('create: function (id, type)'), core.indexOf('_tameForTouch:'));
    assert.match(create, /PosnicPro\.chart\._tameForTouch\(chart\)/);
});

/*
 * Round three, the owner's own rule: "if chart is issue disable graphical
 * stuff to all mobile view. no problem at no one sees that report in
 * mobile." No charts on a phone, full stop - a rule with no exceptions
 * cannot leak memory through the exception.
 */
test('no chart is ever created on a coarse pointer - the choke point refuses', () => {
    const gate = core.slice(core.indexOf('disabledHere:'), core.indexOf('_tameForTouch:'));
    assert.match(gate, /pointer: coarse/);
    /* the refusal happens INSIDE create, before am4core.create can run */
    assert.match(gate, /disabledHere\(\)\) \{/);
    assert.match(gate, /return null;/);
    /* and the panel says so instead of sitting there as a hole */
    assert.match(gate, /chart-empty-state/);
    assert.match(gate, /desktop version/);
});

test('the two direct Apex sites carry the same refusal', () => {
    /* Everything else goes through PosnicPro.chart.create; these two build
       ApexCharts by hand and would quietly become the exception. */
    const kiosk = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'report_kiosk.js'), 'utf8');
    for (const src of [dash, kiosk]) {
        assert.match(src, /PosnicPro\.chart\.disabledHere\(\)/);
        assert.match(src, /desktop version/);
    }
});
