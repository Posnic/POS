'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { BrowserCloudAuth } = require('../src/browser-cloud-auth');
const { assertSameShop } = require('../src/cloud-shop-identity');
const details = { intent: 'login', deviceName: 'Counter', machineId: 'm'.repeat(32) };

function fixture(t, options = {}) {
  let initial, tokenBody, opened;
  let openedResolve;
  const opening = new Promise((resolve) => { openedResolve = resolve; });
  const client = new BrowserCloudAuth({ timeoutMs: 5000, ...options,
    fetch: async (url, opts) => {
      assert.equal(opts.redirect, 'error');
      if (url.endsWith('/requests')) {
        initial = JSON.parse(opts.body);
        if (options.beginError) throw new Error('fetch failed');
        return Response.json({ authorizationUrl: options.url || 'https://www.posnic.com/api/desktop/authorize?request=' + 'r'.repeat(43) });
      }
      tokenBody = JSON.parse(opts.body);
      assert.equal(crypto.createHash('sha256').update(tokenBody.codeVerifier).digest('base64url'), initial.codeChallenge);
      return options.tokenError ? Response.json({ error: 'expired' }, { status: 400 }) : Response.json({ deviceToken: 'a'.repeat(64), deviceId: 'test-device', syncUrl: 'https://gateway.posnic.com' });
    },
    openExternal: async (url) => { opened = url; openedResolve(); },
  });
  t.after(() => client.cancel());
  return { client, opening, get initial() { return initial; }, get tokenBody() { return tokenBody; }, get opened() { return opened; },
    callback: (overrides = {}) => {
      const url = new URL(initial.redirectUri);
      for (const [key, value] of Object.entries({ state: initial.state, code: 'c'.repeat(43), ...overrides })) url.searchParams.set(key, value);
      return fetch(url);
    } };
}
test('browser approval returns through a random loopback port and exchanges PKCE in the main process', async (t) => {
  const f = fixture(t), done = f.client.authorize(details);
  await f.opening;
  assert.match(f.initial.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/posnic-authorized$/);
  assert.equal(f.initial.codeVerifier, undefined); assert.equal(f.initial.password, undefined);
  assert.match(f.opened, /^https:\/\/www\.posnic\.com\/api\/desktop\/authorize\?request=/);
  assert.equal((await f.callback()).status, 200);
  assert.equal((await done).deviceId, 'test-device');
  assert.equal(f.client.active, null);
  await assert.rejects(fetch(f.initial.redirectUri));
});
test('wrong state and malformed codes do not consume a valid callback', async (t) => {
  const f = fixture(t), done = f.client.authorize(details); await f.opening;
  assert.equal((await f.callback({ state: 'x'.repeat(43) })).status, 400);
  assert.equal((await f.callback({ code: 'bad' })).status, 400);
  assert.equal(f.tokenBody, undefined);
  await f.callback(); assert.equal((await done).deviceId, 'test-device');
});
test('browser cancellation and expiry close the listener and allow retry', async (t) => {
  const f = fixture(t), done = f.client.authorize(details); await f.opening;
  const rejected = assert.rejects(done, /cancelled/);
  await f.callback({ error: 'access_denied' }); await rejected;
  assert.equal(f.tokenBody, undefined);
  const timed = fixture(t, { timeoutMs: 20 });
  await assert.rejects(timed.client.authorize(details), /expired/); assert.equal(timed.client.active, null);
});
test('local cancellation, reopening and duplicate starts have predictable results', async (t) => {
  const f = fixture(t), done = f.client.authorize(details); await f.opening;
  await f.client.reopen();
  await assert.rejects(f.client.authorize(details), /already in progress/);
  const rejected = assert.rejects(done, /cancelled/); f.client.cancel(); await rejected;
  await assert.rejects(f.client.reopen(), /Start browser/);
});
test('untrusted browser destinations and connection failures do not launch a browser', async (t) => {
  for (const url of ['https://evil.example/api/desktop/authorize?request=' + 'r'.repeat(43), 'https://www.posnic.com/other?request=' + 'r'.repeat(43), 'file:///tmp/approve']) {
    const f = fixture(t, { url }); await assert.rejects(f.client.authorize(details), /could not be verified/); assert.equal(f.opened, undefined);
  }
  const f = fixture(t, { beginError: true }); await assert.rejects(f.client.authorize(details), /fetch failed/); assert.equal(f.client.active, null);
});
test('failed exchange produces an actionable error and closes the listener', async (t) => {
  const f = fixture(t, { tokenError: true }), done = f.client.authorize(details); await f.opening;
  const rejected = assert.rejects(done, /expired/);
  assert.equal((await f.callback()).status, 502); await rejected;
  assert.equal(f.client.active, null);
});
test('shop identity permits a fresh install and same-shop reconnect, but never merges unrelated data', () => {
  const identity = { tenantDb: 'shop_one', branchIds: ['a'.repeat(24)] };
  const clean = { identity, savedTenant: null, localBranchIds: [], userCount: 0 };
  assert.equal(assertSameShop(clean).tenantDb, 'shop_one');
  assertSameShop({ ...clean, localBranchIds: ['a'.repeat(24)], userCount: 1 });
  assertSameShop({ ...clean, savedTenant: 'shop_one', userCount: 1 });
  for (const update of [{ savedTenant: 'shop_two' }, { localBranchIds: ['b'.repeat(24)] },
    { savedTenant: 'shop_one', localBranchIds: ['b'.repeat(24)] }, { userCount: 1 }, { businessDataCount: 1 }]) {
    assert.throws(() => assertSameShop({ ...clean, ...update }), /never merged automatically/);
  }
  assert.throws(() => assertSameShop({ ...clean, identity: { tenantDb: '../../bad', branchIds: [] } }), /Could not verify/);
});
