'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { guideBrandState, buildBrandFlag, readFileBrand } = require('../api/src/helpers/guide-brand-state');

test('only a successful read of an explicit unbranded state permits Posnic help', () => {
  assert.deepEqual(guideBrandState({ descriptor: null, readSucceeded: true, buildEnabled: false }),
    { resolved: true, enabled: false, buildEnabled: false });
  assert.deepEqual(guideBrandState({ descriptor: { enabled: false }, readSucceeded: true, buildEnabled: false }),
    { resolved: true, enabled: false, buildEnabled: false });
});

test('white label, failed reads, malformed descriptors and unknown builds fail closed', () => {
  for (const input of [
    { descriptor: { enabled: true, name: 'Reseller' }, readSucceeded: true, buildEnabled: false },
    { descriptor: null, readSucceeded: true, buildEnabled: true },
    { descriptor: null, readSucceeded: false, buildEnabled: false },
    { descriptor: { name: 'Maybe' }, readSucceeded: true, buildEnabled: false },
    { descriptor: null, readSucceeded: true, buildEnabled: null },
  ]) {
    const state = guideBrandState(input);
    assert.notDeepEqual(state, { resolved: true, enabled: false, buildEnabled: false });
  }
});

test('legacy brand name overrides an absent installer seed; desktop seed must be known', () => {
  assert.equal(buildBrandFlag({ POSNIC_BUILD_BRANDED: '0', WHITE_LABEL_NAME: 'Reseller', POSNIC_DESKTOP: '1' }), true);
  assert.equal(buildBrandFlag({ POSNIC_BUILD_BRANDED: '1', POSNIC_DESKTOP: '1' }), true);
  assert.equal(buildBrandFlag({ POSNIC_BUILD_BRANDED: '0', POSNIC_DESKTOP: '1' }), false);
  assert.equal(buildBrandFlag({ POSNIC_DESKTOP: '1' }), null);
  assert.equal(buildBrandFlag({ POSNIC_DESKTOP: '0' }), false);
});

test('file branding distinguishes an absent stock file from unreadable or pending cloud branding', () => {
  const absent = { readFileSync() { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } };
  assert.deepEqual(readFileBrand('C:/fixture', { paired: false, buildEnabled: false }, absent),
    { descriptor: null, readSucceeded: true });
  assert.equal(readFileBrand('C:/fixture', { paired: true, buildEnabled: false }, absent).readSucceeded, false);
  assert.equal(readFileBrand('C:/fixture', { paired: false, buildEnabled: true }, absent).readSucceeded, false);
  const unreadable = { readFileSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.equal(readFileBrand('C:/fixture', { paired: false, buildEnabled: false }, unreadable).readSucceeded, false);
  const malformed = { readFileSync() { return '{broken'; } };
  assert.equal(readFileBrand('C:/fixture', { paired: false, buildEnabled: false }, malformed).readSucceeded, false);
  const branded = { readFileSync() { return '{"enabled":true,"name":"Reseller"}'; } };
  assert.equal(readFileBrand('C:/fixture', { paired: true, buildEnabled: false }, branded).descriptor.enabled, true);
});


test('unknown Help build metadata preserves an explicitly enabled visual brand', () => {
  const { cosmeticBrand } = require('../api/src/helpers/guide-brand-state');
  const descriptor = { enabled: true, name: 'Reseller' };
  const status = guideBrandState({ descriptor, readSucceeded: true, buildEnabled: null });
  assert.equal(status.resolved, false);
  assert.equal(cosmeticBrand(descriptor), descriptor);
  assert.equal(cosmeticBrand({ enabled: false }), null);
  assert.equal(cosmeticBrand(null), null);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../api/app.js'), 'utf8');
  assert.match(app, /brand = cosmeticBrand\(descriptor\)/);
  assert.match(app, /state\.brand \? \{ enabled: true, name:/);
});
