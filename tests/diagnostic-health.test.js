'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/diagnostic-health');
const { DiagnosticSession } = require('../src/diagnostic-session');
test('health never claims an untested area is healthy', () => {
  assert.equal(summarize({}).filter(r => r.status === 'ok').length, 0);
  const rows = summarize({ system: { status: 'error' }, services: { status: 'ok', data: [{ status: 'timeout' }] }, audio: { status: 'ok', data: { enabled: false } } });
  assert.equal(rows.find(r => r.key === 'system').status, 'attention');
  assert.equal(rows.find(r => r.key === 'services').status, 'attention');
  assert.equal(rows.find(r => r.key === 'audio').status, 'info');
});
test('checks expose progress while a slow provider is still running', async () => {
  let finish;
  const session = new DiagnosticSession({ providers: { system: () => ({ freeMemory: 2e9 }), services: () => new Promise(r => { finish = r; }) } });
  session.start();
  try {
    const pending = session.snapshot();
    await new Promise(r => setImmediate(r));
    assert.equal(session.state().checking, true);
    assert.equal(session.state().health.find(r => r.key === 'system').status, 'ok');
    assert.equal(session.state().health.find(r => r.key === 'services').status, 'pending');
    finish([{ status: 'reachable' }, { status: 'reachable' }]); await pending;
    assert.equal(session.state().checking, false);
    assert.equal(session.report().summary.health.find(r => r.key === 'services').status, 'ok');
  } finally { session.stop(); }
});
test('single support token connects and idle sound polling cannot drown out failures', async () => {
  const token = 'b'.repeat(64); const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  let auth;
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async (url, opts) => { if (url.pathname.endsWith('/connect')) auth = opts.headers.authorization; return { ok: true, text: async () => JSON.stringify({ id, token }) }; } });
  session.start();
  try {
    for (let n=0;n<2000;n++) session.record('ipc', { channel:'kitchen-audio:next', success:true });
    session.record('ipc', { channel:'kitchen-audio:next', success:false });
    assert.equal(session.events.length, 2);
    assert.equal(session.state().health.find(r=>r.key==='activity').status, 'attention');
    await session.connect(token, true); assert.equal(auth, 'Bearer ' + token);
  } finally { session.stop(); }
});
