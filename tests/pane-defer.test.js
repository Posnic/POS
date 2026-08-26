'use strict';

/*
 * The furled panes stay furled (PAGE_SPLIT_ANALYSIS Option A, slice 1).
 *
 * The build wraps every report pane in <template class="pane-defer">:
 * parsed, never rendered - a third of the phone's rendered tree
 * (measured: 19,531 -> 13,089 elements) on the tab iOS keeps killing for
 * memory. These pins hold the three load-bearing pieces: the build wraps
 * the whole defer set, the core inflates for desktop and at the reports
 * choke point, and no pane with an inline <script> ever joins the set -
 * adopting template content EXECUTES scripts it holds.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const htmlJs = fs.readFileSync(path.join(FRONTEND, 'gulpfile.js/html.js'), 'utf8');
const core = fs.readFileSync(
  path.join(FRONTEND, 'static/script/js/core/PosnicPro.js'), 'utf8');

function deferSet() {
  const m = htmlJs.match(/PHONE_DEFER = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'PHONE_DEFER set missing from the build');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('the defer set names real, script-free module panes', () => {
  const files = deferSet();
  assert.ok(files.length >= 20, 'the defer set shrank to ' + files.length);
  for (const f of files) {
    const p = path.join(FRONTEND, 'modules', f);
    assert.ok(fs.existsSync(p), f + ' is in the defer set but not in modules/');
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(!/<script\b/i.test(src),
      f + ' carries a <script> - adopting its template would execute it');
  }
});

test('every defer-set pane has lazy-chunk JS, never boot-bundle JS', () => {
  const map = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'pages_css_js_map.json'), 'utf8'));
  const bootJs = (map.dashboard.js || []).join('\n');
  /* priceSettings' module is report_pricesettings.js - in the lazy list */
  const lazy = (map.lazy_reports || []).join('\n');
  assert.ok(lazy.includes('report_sales.js'), 'lazy reports list moved?');
  /* the pin: no lazy report file may ALSO be in the boot bundle */
  for (const f of map.lazy_reports || []) {
    assert.ok(!bootJs.includes(f.split('/').pop()),
      f + ' is in BOTH the boot bundle and the lazy chunk');
  }
});

test('the core inflates panes for desktop and at the reports choke point', () => {
  assert.match(core, /function __posnicInflatePanes\(\)/);
  assert.match(core, /template\.pane-defer/);
  /* desktop: inflate immediately unless the pointer is coarse */
  assert.match(core, /pointer: coarse.*matches\)\)\s*\{\s*__posnicInflatePanes\(\)/s);
  /* the one choke point: lazy.load('reports') inflates first */
  assert.match(core, /if \(name === 'reports'\) \{ __posnicInflatePanes\(\); \}/);
});
