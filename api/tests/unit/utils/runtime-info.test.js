'use strict';

/**
 * Unit tests for src/utils/runtime-info.js — the edition/mode/version contract
 * (SEAMLESS_UPDATE_ROADMAP U1). Pure function; env and root are injected.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildRuntimeInfo, resolveMode, resolveAppVersion } = require('../../../src/utils/runtime-info');
const {
  API_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
} = require('../../../src/constants/runtime.constants');

describe('resolveMode', () => {
  test('desktop when the Electron shell says so', () => {
    expect(resolveMode({ POSNIC_DESKTOP: '1' })).toBe('desktop');
  });
  test('cloud on the provisioner env (POSNIC_KEY) or explicit override', () => {
    expect(resolveMode({ POSNIC_KEY: 'k' })).toBe('cloud');
    expect(resolveMode({ POSNIC_CLOUD: '1' })).toBe('cloud');
  });
  test('local otherwise (community self-hosted server)', () => {
    expect(resolveMode({})).toBe('local');
  });
  test('desktop wins over cloud signals (a till with cloud sync is a till)', () => {
    expect(resolveMode({ POSNIC_DESKTOP: '1', POSNIC_KEY: 'k' })).toBe('desktop');
  });
});

describe('resolveAppVersion', () => {
  test('env wins and must look like a semver', () => {
    expect(resolveAppVersion({ POSNIC_APP_VERSION: '1.4.0' }, '/nowhere')).toBe('1.4.0');
    expect(resolveAppVersion({ POSNIC_APP_VERSION: 'not-a-version' }, '/nowhere')).toBeNull();
  });
  test('falls back to the package.json ABOVE the api directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtinfo-'));
    const apiRoot = path.join(root, 'api');
    fs.mkdirSync(apiRoot);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'posnic', version: '9.9.9' }));
    expect(resolveAppVersion({}, apiRoot)).toBe('9.9.9');
  });
  test("never reports the api package's own version as the app version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtinfo-'));
    const apiRoot = path.join(root, 'api');
    fs.mkdirSync(apiRoot);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'posnic-api', version: '2.0.0' }));
    expect(resolveAppVersion({}, apiRoot)).toBeNull();
  });
  test('null when nothing trustworthy exists (honest unknown beats a lie)', () => {
    expect(resolveAppVersion({}, '/definitely/not/here')).toBeNull();
  });
});

describe('buildRuntimeInfo', () => {
  test('cloud mode is the branded edition; everything else is community', () => {
    expect(buildRuntimeInfo({ POSNIC_KEY: 'k' }, '/nowhere').edition).toBe('cloud');
    expect(buildRuntimeInfo({ POSNIC_DESKTOP: '1' }, '/nowhere').edition).toBe('community');
    expect(buildRuntimeInfo({}, '/nowhere').edition).toBe('community');
  });
  test('carries the schema and sync-protocol coordination numbers', () => {
    const info = buildRuntimeInfo({}, '/nowhere');
    expect(info.apiSchema).toBe(API_SCHEMA_VERSION);
    expect(info.syncProtocol).toBe(SYNC_PROTOCOL_VERSION);
  });
  test('channel is null unless configured; features is always an object', () => {
    expect(buildRuntimeInfo({}, '/nowhere').channel).toBeNull();
    expect(buildRuntimeInfo({ POSNIC_UPDATE_CHANNEL: 'beta' }, '/nowhere').channel).toBe('beta');
    expect(buildRuntimeInfo({}, '/nowhere').features).toEqual({});
  });
});
