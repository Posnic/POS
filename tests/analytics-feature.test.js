'use strict';

/*
 * The shop's own Google Analytics - off by default, everywhere, always.
 *
 * Owner's design: "make it as feature. on / off with entering GA value."
 * These pins hold the contract's load-bearing pieces: the setting exists in
 * the preferences group, the CSP only widens behind the toggle, the injector
 * rides both pages but acts only on a configured shop, and PRIVACY.md tells
 * the truth about all of it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the two settings keys live in the preferences group', () => {
  const groups = read('api/src/services/settings-groups.js');
  assert.match(groups, /'analytics_enable'/);
  assert.match(groups, /'analytics_ga_id'/);
});

test('the CSP widens ONLY behind the toggle - both policies exist, chosen per request', () => {
  const app = read('api/app.js');
  assert.match(app, /helmetBase/);
  assert.match(app, /helmetGa/);
  assert.match(app, /a\.enabled \? helmetGa : helmetBase/);
  /* the base directives must not carry the Google domains */
  const base = app.slice(app.indexOf('const cspDirectives'), app.indexOf('const gaCspDirectives'));
  assert.ok(!base.includes('googletagmanager'), 'the locked-down CSP grew a Google domain');
});

test('the injector rides both pages and refuses anything but a plausible id', () => {
  const map = JSON.parse(read('frontend/pages_css_js_map.json'));
  for (const page of ['dashboard', 'login']) {
    assert.ok(
      map[page].js.includes('static/script/js/core/analytics-inject.js'),
      page + ' bundle lost the injector'
    );
  }
  const inject = read('frontend/static/script/js/core/analytics-inject.js');
  assert.match(inject, /a\.enabled/);
  assert.match(inject, /G-\[A-Z0-9\]\{4,14\}/);
});

test('the save door coerces the toggle and refuses a malformed id', () => {
  const repo = read('api/src/repositories/settings.repository.js');
  assert.match(repo, /analytics_enable[\s\S]{0,120}coerceFeatureToggle/);
  assert.match(repo, /The Google Analytics id should look like G-XXXXXXXXXX/);
});

test('PRIVACY.md tells the truth about the switch', () => {
  const privacy = read('docs/PRIVACY.md');
  assert.match(privacy, /Google Analytics \| Yes \|/);
  assert.match(privacy, /refuses Google's domains outright/);
});
