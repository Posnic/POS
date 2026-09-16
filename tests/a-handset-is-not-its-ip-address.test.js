'use strict';

/*
 * Why the captain app kept disconnecting, and it was not the Wi-Fi.
 *
 * Owner: "captain app keep disconnected... mobile till not responding after
 * seconds its connecting. its coz of wifi and rounter... i want right reason
 * with evidence."
 *
 * The Wi-Fi WAS bad - measured on his shop, 516ms to the router itself with
 * packet loss on a strong signal and an empty channel. But underneath it sat a
 * fault of ours that no router would have fixed.
 *
 * THE FAULT
 *
 * The till keeps a list of the handsets talking to it, capped at six. It was
 * keyed by IP ADDRESS. Nothing ever expired it - entries were removed only by
 * an admin pressing something - and it was written to disk, so restarting the
 * till did not clear it either.
 *
 * A phone's address changes constantly on normal Wi-Fi: a DHCP lease renews,
 * it roams between access points, it reconnects after the screen sleeps. Every
 * new address took a permanent slot. On his shop, ten wireless clients on one
 * router, six slots went in days.
 *
 * THEN THE HEALTH CHECK GOT REFUSED
 *
 * Captain asks /runtime-info every twenty seconds while connected and every
 * four while it is not. Once the slots were full that came back 403, and
 * captain reads any non-ok response as "this server is unreachable":
 *
 *     if (!response.ok) return fail('REFUSED', String(response.status));
 *
 * So it dropped the till, rescanned the network - 64 concurrent probes, which
 * on a weak router makes everything worse - found the same till, asked again,
 * and was refused again. For ever. That loop is the disconnection.
 *
 * Two rules fix it, and they are what this file pins.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const slots = require(path.join(ROOT, 'src', 'handset-slots.js'));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A device list with `n` handsets, all seen just now. */
function full(n, seenAgoMs = 0) {
  const devices = {};
  for (let i = 1; i <= n; i += 1) {
    devices[`192.168.1.${i}`] = {
      ip: `192.168.1.${i}`,
      lastSeen: new Date(Date.now() - seenAgoMs).toISOString(),
    };
  }
  return devices;
}

/* ------------------------------------------- 1. a health check is not a device */

test('A HEALTH CHECK IS ANSWERED EVEN WHEN EVERY SLOT IS TAKEN', () => {
  /*
   * The single change that breaks the disconnection loop. Refusing this is
   * what turned "six handsets are registered" into "this till is unreachable",
   * because the app cannot tell a refusal from a dead server.
   */
  const verdict = slots.admit({
    devices: full(6),
    ip: '192.168.1.99',
    method: 'GET',
    url: '/api/runtime-info',
    maxDevices: 6,
  });
  assert.strictEqual(verdict.allow, true, 'the health check was refused with the slots full');
  assert.strictEqual(verdict.register, false, 'asking if a till is alive took a slot');
});

test('and it does not consume a slot even when there is room', () => {
  const devices = full(1);
  slots.admit({ devices, ip: '10.0.0.5', method: 'GET', url: '/api/runtime-info' });
  assert.deepStrictEqual(Object.keys(devices), ['192.168.1.1'], 'a probe registered a device');
});

test('the supervisor probes are health checks too', () => {
  for (const url of ['/api/runtime-info', '/api/healthz', '/api/readyz', '/runtime-info?x=1']) {
    assert.ok(slots.isHealthCheck(url), url + ' should not cost a device slot');
  }
  for (const url of ['/api/sales', '/api/login', '/api/runtime-information']) {
    assert.ok(!slots.isHealthCheck(url), url + ' is a real request');
  }
});

test('BUT A BLOCKED DEVICE IS STILL BLOCKED, health check or not', () => {
  /* Exempting the probe must not become a way around a deliberate block. */
  const verdict = slots.admit({
    devices: {},
    blocked: new Set(['192.168.1.7']),
    ip: '192.168.1.7',
    method: 'GET',
    url: '/api/runtime-info',
  });
  assert.strictEqual(verdict.allow, false);
  assert.strictEqual(verdict.code, 'DEVICE_BLOCKED');
});

/* ------------------------------------------------ 2. a slot is not forever */

test('A SLOT NOBODY HAS USED FOR A FORTNIGHT IS RELEASED', () => {
  /*
   * The other half. Without this the cap is a one-way ratchet: six addresses
   * ever, then the till refuses every phone in the shop until somebody finds
   * a screen they have never been told about.
   */
  const devices = full(6, 20 * DAY);
  const verdict = slots.admit({
    devices,
    ip: '192.168.1.200',
    method: 'GET',
    url: '/api/sales',
    maxDevices: 6,
  });
  assert.strictEqual(verdict.allow, true, 'a real phone was refused behind stale entries');
  assert.strictEqual(verdict.register, true);
});

test('a phone seen yesterday keeps its place', () => {
  /* The expiry must not evict the handsets actually in use. */
  const devices = full(6, 1 * DAY);
  const verdict = slots.admit({
    devices,
    ip: '192.168.1.200',
    method: 'GET',
    url: '/api/sales',
    maxDevices: 6,
  });
  assert.strictEqual(verdict.allow, false, 'six live handsets should still fill the list');
  assert.strictEqual(verdict.code, 'DEVICE_LIMIT_REACHED');
});

test('an entry with no readable lastSeen is left alone', () => {
  /* More likely a shape this code has not met than a stale row, and evicting
     a live handset is the worse mistake. */
  const devices = { '10.0.0.1': { ip: '10.0.0.1' }, '10.0.0.2': { ip: '10.0.0.2', lastSeen: 'x' } };
  assert.strictEqual(slots.releaseIdle(devices, Date.now()), 0);
  assert.strictEqual(Object.keys(devices).length, 2);
});

/* ------------------------------------------------------- what a phone is told */

test('the refusal says what to DO, not "contact your administrator"', () => {
  /*
   * For a shop where the owner IS the administrator, the old text was an
   * instruction to contact himself about a screen nobody had mentioned.
   */
  const verdict = slots.admit({
    devices: full(6),
    ip: '192.168.1.200',
    method: 'GET',
    url: '/api/sales',
    maxDevices: 6,
  });
  assert.strictEqual(verdict.code, 'DEVICE_LIMIT_REACHED');
  assert.match(verdict.message, /Hardware Manager/, 'does not say where to go');
  assert.match(verdict.message, /Mobile Devices/, 'does not say which screen');
  assert.match(verdict.message, /fixed address/, 'does not say how to stop it recurring');
});

/* ----------------------------------------------------------- the plumbing */

test('a browser preflight is not a device, and never was', () => {
  const devices = {};
  const verdict = slots.admit({ devices, ip: '10.0.0.9', method: 'OPTIONS', url: '/api/sales' });
  assert.strictEqual(verdict.allow, true);
  assert.strictEqual(verdict.register, false);
});

test('a known device is served without re-counting the list', () => {
  const devices = full(6);
  const verdict = slots.admit({
    devices,
    ip: '192.168.1.3',
    method: 'GET',
    url: '/api/sales',
    maxDevices: 6,
  });
  assert.strictEqual(verdict.allow, true, 'a registered handset was refused by its own cap');
});

test('THE SERVER ACTUALLY USES THIS, rather than keeping its own copy', () => {
  /*
   * The decision was inline in an emit override, where it could not be tested
   * and quietly drifted. If it moves back, this file is testing nothing.
   */
  const server = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/handset-slots'\)/, 'the server no longer uses the module');
  assert.match(server, /slots\.admit\(/, 'the server decides for itself again');
  assert.ok(
    !/const MAX_DEVICES = t\.maxDevices/.test(server),
    'the old inline cap is back alongside the module'
  );
});

test('it is in the packaged build, WHERE SERVER.JS CAN ACTUALLY REACH IT', () => {
  /*
   * This checked `build.files` alone, and it was green for the entire life of
   * the bug it was written to prevent.
   *
   * `build.files` puts the module inside app.asar, at src/handset-slots.js.
   * But server.js is NOT in the asar - it is in `extraResources`, flattened to
   * the resources root - so its `require('./handset-slots')` looks for
   * resources/handset-slots.js and finds nothing. A shop's till threw
   * MODULE_NOT_FOUND on every LAN request and answered none of them.
   *
   * Both entries are needed and they are not interchangeable. The general form
   * of the rule, derived from what server.js actually requires rather than
   * restating a filename, is in tests/what-ships-beside-the-server.test.js.
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/handset-slots.js'), 'not in the asar');
  assert.ok(
    (pkg.build.extraResources || []).some(
      (e) => e && e.from === 'src/handset-slots.js' && e.to === 'handset-slots.js'
    ),
    'not beside server.js at the resources root, which is the only place its require can look'
  );
});
