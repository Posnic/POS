/*
 * Charts must replace each other, not pile up.
 *
 * A shop opened Item Reports / Top 5 Selling and got a grey panel with
 * "Maximum call stack size exceeded" in a small box. That box is amCharts' own
 * error modal: raiseCriticalError disables the chart - hence grey - and shows
 * the message inside the chart's container.
 *
 * The cause was two charts on one div. itemGraphTabClick both fetched the data
 * (which renders when it returns) and called the renderer again with no data,
 * so every visit to the tab created a chart, then created a second one beside
 * it. Two amCharts instances measuring and resizing the same container drive
 * each other until the stack runs out.
 *
 * Nothing in the code said "there can only be one chart here", so eight other
 * reports had the same shape, waiting for a second render from a date change or
 * a revisited tab. These tests say it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE = path.join(__dirname, '..', 'frontend/static/script/js/core/PosnicPro.js');
const MODULES = path.join(__dirname, '..', 'frontend/static/script/js/modules/js');

const REPORTS = ['report_items', 'report_customers', 'report_payment', 'report_receivings',
  'report_sales', 'report_suppliers', 'report_users', 'dashboard']
  .map((n) => ({ name: n + '.js', src: fs.readFileSync(path.join(MODULES, n + '.js'), 'utf8') }));

/* ---- the rule, stated once ------------------------------------------- */

test('no report creates a chart without disposing what was there', () => {
  for (const { name, src } of REPORTS) {
    const raw = (src.match(/am4core\.create\(/g) || []).length;
    assert.strictEqual(raw, 0,
      `${name} calls am4core.create() directly ${raw} time(s). Use ` +
      `PosnicPro.chart.create(), which disposes the previous chart first - ` +
      `two charts on one div resize each other until the stack overflows.`);
  }
});

test('a tab click renders once, not twice', () => {
  /* graphicalReportX() fetches and renders on return. A bare showGraphReport()
     beside it renders a second, dataless chart onto the same div - which is
     exactly how the reported crash was produced. */
  for (const { name, src } of REPORTS) {
    const bare = src.match(/\w+graphicalreport\.show\w*\(\s*\)\s*;/g) || [];
    assert.deepStrictEqual(bare, [],
      `${name} renders a chart with no arguments: ${bare.join(', ')}`);
  }
});

test('the graphical report sections are GONE - and stay gone', () => {
  /*
   * Owner, 2026-08-25, after charts cost him one crash too many: "remove
   * all graphical report section completely. remove its packages. jquery
   * plugin css everything remove it. no need." Every report's graph tab,
   * pane, renderer object and chart call was removed. The dashboard is the
   * one chart surface left (desktop only - the mobile gate refuses).
   */
  for (const { name, src } of REPORTS) {
    if (name === 'dashboard.js') continue;
    assert.ok(!src.includes('graphicalreport'), name + ' grew a graph object back');
    assert.ok(!src.includes('PosnicPro.chart.create('), name + ' creates a chart again');
    assert.ok(!src.includes('ApexCharts'), name + ' uses ApexCharts again');
  }
});

/* ---- and the helper that enforces it ---------------------------------- */

function loadPosnicPro(am4core) {
  const els = {};

  /* Enough jQuery for the file to load. The $(document).ready block at the end
     is page wiring - printers, menus, keyboard - none of which this is about,
     so ready() never runs its callback. */
  const $ = function () {
    return new Proxy(function () {}, {
      get: (t, p) => (p === 'length' ? 0 : () => $()),
      apply: () => $(),
    });
  };
  $.fn = {};
  $.extend = Object.assign;

  const sandbox = {
    am4core,
    $,
    jQuery: $,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    /* The file schedules a clock tick on load; nothing here needs it to fire. */
    setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    /* The offline database, declared on load. Charts never touch it. */
    Dexie: class { version() { return { stores: () => ({}) }; } table() { return {}; } },
    document: {
      getElementById: (id) => els[id] || null,
      addEventListener() {},
      readyState: 'complete',
    },
    window: {},
    navigator: { userAgent: 'node' },
    console,
    PosnicPro: undefined,
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  /* The file is one object literal; nothing in it runs on load. */
  vm.runInContext(fs.readFileSync(CORE, 'utf8'), sandbox, { filename: 'PosnicPro.js' });
  return { PosnicPro: sandbox.PosnicPro, els };
}

/* A chart that records whether it was disposed, and an amCharts registry that
   behaves like the real one: created charts stay in baseSprites until disposed. */
function fakeAmCharts() {
  const registry = { baseSprites: [] };
  const api = {
    registry,
    create(id, type) {
      const chart = {
        id, type, disposed: false,
        svgContainer: { htmlElement: { id } },
        isDisposed() { return this.disposed; },
        dispose() {
          this.disposed = true;
          const i = registry.baseSprites.indexOf(this);
          if (i >= 0) registry.baseSprites.splice(i, 1);
        },
      };
      registry.baseSprites.push(chart);
      return chart;
    },
  };
  return api;
}

test('creating a chart disposes the one it replaces', () => {
  const am4core = fakeAmCharts();
  const { PosnicPro, els } = loadPosnicPro(am4core);
  els['chartdiv'] = { id: 'chartdiv', innerHTML: '' };

  const first = PosnicPro.chart.create('chartdiv', 'XYChart');
  const second = PosnicPro.chart.create('chartdiv', 'XYChart');

  assert.ok(first.disposed, 'the first chart was left on the div');
  assert.ok(!second.disposed, 'the new chart should be alive');
  assert.strictEqual(am4core.registry.baseSprites.length, 1,
    'exactly one chart may occupy a div');
});

test('a chart made the old way is still cleared out', () => {
  /* The registry sweep, not the tracked reference: a chart created before this
     helper existed is attached to the div and would still fight a new one. */
  const am4core = fakeAmCharts();
  const { PosnicPro, els } = loadPosnicPro(am4core);
  els['chartdiv'] = { id: 'chartdiv', innerHTML: '' };

  const orphan = am4core.create('chartdiv', 'XYChart'); // bypasses the helper
  PosnicPro.chart.create('chartdiv', 'XYChart');

  assert.ok(orphan.disposed, 'an untracked chart was left on the div');
  assert.strictEqual(am4core.registry.baseSprites.length, 1);
});

test('a chart on another div is left alone', () => {
  const am4core = fakeAmCharts();
  const { PosnicPro, els } = loadPosnicPro(am4core);
  els['one'] = { id: 'one', innerHTML: '' };
  els['two'] = { id: 'two', innerHTML: '' };

  const a = PosnicPro.chart.create('one', 'XYChart');
  PosnicPro.chart.create('two', 'XYChart');

  assert.ok(!a.disposed, 'disposing one div must not disturb another');
  assert.strictEqual(am4core.registry.baseSprites.length, 2);
});

test('a missing div yields no chart rather than a broken one', () => {
  const am4core = fakeAmCharts();
  const { PosnicPro } = loadPosnicPro(am4core);

  assert.strictEqual(PosnicPro.chart.create('never-opened-tab', 'XYChart'), null);
  assert.strictEqual(am4core.registry.baseSprites.length, 0,
    'nothing should be created for a div that is not on the page');
});

test('every caller checks for that null', () => {
  /* create() returns null for a div that is not on the page; the line after it
     would otherwise throw on the chart the report thinks it has. */
  for (const { name, src } of REPORTS) {
    const creates = (src.match(/PosnicPro\.chart\.create\(/g) || []).length;
    const guards = (src.match(/if \(![\w.]+\) return; \/\/ the (panel|tab) is not on the page/g) || []).length;
    assert.strictEqual(guards, creates,
      `${name}: ${creates} chart(s) created but ${guards} guarded against a missing div`);
  }
});

test('saying there is no data replaces the chart rather than sitting behind it', () => {
  const am4core = fakeAmCharts();
  const { PosnicPro, els } = loadPosnicPro(am4core);
  els['chartdiv'] = { id: 'chartdiv', innerHTML: '' };

  const chart = PosnicPro.chart.create('chartdiv', 'XYChart');
  PosnicPro.chart.empty('chartdiv', 'No sales in the selected period');

  assert.ok(chart.disposed, 'the chart must go before its replacement text');
  assert.match(els['chartdiv'].innerHTML, /No sales in the selected period/);
  assert.strictEqual(am4core.registry.baseSprites.length, 0);
});

test('disposal survives an amCharts that has already torn itself down', () => {
  /* Navigating away can dispose charts underneath us; a report that then tries
     to clean up must not throw on the way to rendering the next one. */
  const am4core = fakeAmCharts();
  const { PosnicPro, els } = loadPosnicPro(am4core);
  els['chartdiv'] = { id: 'chartdiv', innerHTML: '' };

  const chart = PosnicPro.chart.create('chartdiv', 'XYChart');
  chart.dispose();
  delete am4core.registry.baseSprites;

  assert.doesNotThrow(() => PosnicPro.chart.dispose('chartdiv'));
});
