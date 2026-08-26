/*
 * No charts. Anywhere. Owner order, 2026-08-26: "delete all chart related
 * code" - after the iPhone tab-kill saga (amCharts relayout-per-resize,
 * OWNER_QUEUE rows 193-200) the decision moved from "no charts on mobile"
 * to none at all. The libraries, the PosnicPro.chart namespace, the lazy
 * chunks and the vendor shelf are gone; this pins the door shut so a
 * future feature cannot quietly wheel one back in.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.join(__dirname, '..', 'frontend');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'public' || name === '.git') continue;
      walk(p, out);
    } else if (/\.(js|html)$/.test(name) && !/\.min\.js$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test('no chart library is referenced anywhere in frontend source', () => {
  const needles = /am4core|am4charts|am4themes|ApexCharts|c3\.generate|new Chartist|Morris\.|\$\.plot\(/;
  const hits = [];
  for (const f of walk(FRONTEND, [])) {
    const src = fs.readFileSync(f, 'utf8');
    if (needles.test(src)) {
      hits.push(path.relative(FRONTEND, f));
    }
  }
  assert.deepStrictEqual(hits, [],
    'chart library reference found - the owner ordered every chart removed: ' + hits.join(', '));
});

test('the chart vendor directories stay deleted', () => {
  const banned = [
    'static/script/js/plugins/amcharts',
    'static/script/js/plugins/apexcharts',
    'static/script/js/plugins/c3',
    'static/script/js/plugins/d3',
    'static/style/plugins/apexcharts',
    'static/style/plugins/chart.js',
    'static/style/plugins/chartist-js',
    'static/style/plugins/flot-chart',
    'static/style/plugins/morris',
    'static/style/plugins/peity',
  ];
  const present = banned.filter((d) => fs.existsSync(path.join(FRONTEND, d)));
  assert.deepStrictEqual(present, [], 'chart vendor directory came back: ' + present.join(', '));
});

test('PosnicPro.chart namespace stays deleted', () => {
  const core = fs.readFileSync(
    path.join(FRONTEND, 'static/script/js/core/PosnicPro.js'), 'utf8');
  assert.ok(!/chart:\s*\{/.test(core), 'a chart: namespace reappeared in PosnicPro core');
});
