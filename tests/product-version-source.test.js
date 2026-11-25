'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stampRuntimeVersion } = require('../scripts/stamp-runtime-version');
const { renderProductVersion } = require('../frontend/gulpfile.js/product-version');
const { resolveAppVersion } = require('../api/src/utils/runtime-info');
const root = path.resolve(__dirname, '..');

test('one root version change reaches browser metadata and a standalone API', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-version-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const api = path.join(fixture, 'api');
  fs.mkdirSync(api);
  fs.writeFileSync(path.join(api, 'package.json'), JSON.stringify({ name: 'posnic-api', version: '2.0.0' }));
  for (const version of ['1.9.4', '3.2.1-beta.12']) {
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'posnic', version }));
    stampRuntimeVersion(fixture);
    stampRuntimeVersion(fixture, true);
    assert.equal(resolveAppVersion({}, api), version);
    fs.renameSync(path.join(fixture, 'package.json'), path.join(fixture, 'package.hidden'));
    assert.equal(resolveAppVersion({}, api), version, 'standalone deployment retains its build version');
    fs.renameSync(path.join(fixture, 'package.hidden'), path.join(fixture, 'package.json'));
    const html = renderProductVersion('{"softwareVersion":"__POSNIC_PRODUCT_VERSION__"}', version);
    assert.equal(JSON.parse(html).softwareVersion, version);
    assert.equal(resolveAppVersion({ POSNIC_APP_VERSION: '1.8.0' }, api), '1.8.0', 'an older installed shell must not claim the latest release');
  }
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'posnic', version: '4.0.0' }));
  assert.equal(resolveAppVersion({}, api), '3.2.1-beta.12', 'an unrelated or stale parent must not override the deployed API build');
  assert.throws(() => stampRuntimeVersion(fixture, true), /stale/);
});

test('build and deployment paths derive versions from the root', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.version, 'node scripts/sync-version.js');
  const login = fs.readFileSync(path.join(root, 'frontend/login.html'), 'utf8');
  assert.match(login, /"softwareVersion": "__POSNIC_PRODUCT_VERSION__"/);
  assert.ok(renderProductVersion(login).includes(`"softwareVersion": "${pkg.version}"`));
  assert.match(fs.readFileSync(path.join(root, 'frontend/gulpfile.js/html.js'), 'utf8'), /renderProductVersion\(getLinkContent/);
  for (const name of ['deploy-api.yml', 'deploy-frontend.yml', 'deploy-frontend-cdn.yml']) {
    assert.ok(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8').includes('"package.json"'), `${name} must run on a root version bump`);
  }
  for (const name of ['deploy-api.yml', 'deploy-develop.yml']) {
    assert.match(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'), /node scripts\/stamp-runtime-version\.js/);
  }
});
