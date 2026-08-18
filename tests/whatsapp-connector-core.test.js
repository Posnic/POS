/*
 * The WhatsApp connector's loop (connectors/whatsapp/src/core.js).
 *
 * What must hold: every claimed row gets exactly one verdict (the outbox
 * owns retries - a connector that re-queued on its own would double-send);
 * messages for an unlinked branch fail with a verdict rather than sitting
 * claimed until the TTL; init requests from the screen become clients and
 * QR codes flow back through the state mirror; and an API outage is
 * contained - the loop reports nothing, sends nothing twice, and carries on.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ConnectorCore } = require('../connectors/whatsapp/src/core');

function fakeApi() {
  const state = { rows: [], reports: [], posted: [], claimQueue: [] };
  return {
    state,
    claim: async () => state.claimQueue.shift() || [],
    report: async (id, ok, error) => state.reports.push({ id, ok, error }),
    getStates: async () => state.rows,
    postState: async (s) => state.posted.push(s),
  };
}

function fakeWa() {
  const created = [];
  return {
    created,
    create(branchId, deviceId) {
      const client = {
        branchId,
        deviceId,
        sent: [],
        _cbs: {},
        onQr(cb) { this._cbs.qr = cb; },
        onReady(cb) { this._cbs.ready = cb; },
        onDisconnected(cb) { this._cbs.disconnected = cb; },
        async sendMessage(phone, text) { this.sent.push({ phone, text }); },
        async destroy() { this.destroyed = true; },
      };
      created.push(client);
      return client;
    },
  };
}

test('an init request becomes a client and its QR flows back through the mirror', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  api.state.rows = [{ branch_id: 'B1', device_id: 'd1', status: 'init_requested' }];

  await core.handleInitRequests();
  assert.strictEqual(wa.created.length, 1);
  await wa.created[0]._cbs.qr('QR-BYTES');
  const qrPost = api.state.posted.find((p) => p.status === 'qr_ready');
  assert.strictEqual(qrPost.qr, 'QR-BYTES');
  assert.strictEqual(qrPost.branch_id, 'B1');
});

test('a linked branch sends and every row gets exactly one verdict', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  await core.ensureClient('B1', 'd1');
  await wa.created[0]._cbs.ready(); // linked

  api.state.claimQueue.push([
    { id: 'm1', branch_id: 'B1', phone: '9199', message: 'hello' },
    { id: 'm2', branch_id: 'B1', phone: '9200', message: 'world' },
  ]);
  const n = await core.drainOnce();
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(wa.created[0].sent.map((s) => s.phone), ['9199', '9200']);
  assert.deepStrictEqual(api.state.reports.map((r) => [r.id, r.ok]), [['m1', true], ['m2', true]]);
});

test('an unlinked branch fails with a verdict, never leaves rows hanging', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  api.state.claimQueue.push([{ id: 'm1', branch_id: 'B9', phone: '9', message: 'x' }]);

  await core.drainOnce();
  assert.strictEqual(api.state.reports.length, 1);
  assert.strictEqual(api.state.reports[0].ok, false);
  assert.match(api.state.reports[0].error, /not linked|initializing/i);
});

test('a send that throws reports the failure - the outbox decides what happens next', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  await core.ensureClient('B1', 'd1');
  await wa.created[0]._cbs.ready();
  wa.created[0].sendMessage = async () => { throw new Error('page crashed'); };

  api.state.claimQueue.push([{ id: 'm1', branch_id: 'B1', phone: '9', message: 'x' }]);
  await core.drainOnce();
  assert.deepStrictEqual(api.state.reports, [{ id: 'm1', ok: false, error: 'page crashed' }]);
});

test('an API outage is contained: claim fails, nothing sends, the loop survives', async () => {
  const api = fakeApi();
  api.claim = async () => { throw new Error('ECONNREFUSED'); };
  const core = new ConnectorCore({ api, wa: fakeWa() });
  const n = await core.drainOnce();
  assert.strictEqual(n, 0);
  assert.strictEqual(api.state.reports.length, 0);
});

test('a disconnect drops the client so the next message re-links instead of silently failing forever', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  await core.ensureClient('B1', 'd1');
  await wa.created[0]._cbs.ready();
  await wa.created[0]._cbs.disconnected('LOGOUT');

  assert.strictEqual(core.clients.has('B1'), false);
  const post = api.state.posted[api.state.posted.length - 1];
  assert.strictEqual(post.status, 'disconnected');
});

test('stop destroys every client', async () => {
  const api = fakeApi();
  const wa = fakeWa();
  const core = new ConnectorCore({ api, wa });
  await core.ensureClient('B1', 'd1');
  await core.ensureClient('B2', 'd2');
  await core.stop();
  assert.ok(wa.created.every((c) => c.destroyed));
  assert.strictEqual(core.clients.size, 0);
});
