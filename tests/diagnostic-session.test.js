'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DiagnosticSession, sanitize } = require('../src/diagnostic-session');
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const token = 'a'.repeat(64);
const reply = data => ({ ok: true, text: async () => JSON.stringify(data) });

test('offline sessions redact secrets, bound history and export without networking', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-diagnostic-'));
  const session = new DiagnosticSession({ directory, request: () => { throw Error('No network permitted'); },
    providers: { status: () => ({ password: 'sensitive', customer: { name: 'Private' }, html: '<private>', audioData: 'private', ready: true, message: 'user@test.com token=hidden https://secret.example/x' }) } });
  try {
    session.start(); await session.snapshot();
    for (let i = 0; i < 1100; i++) session.record('ipc', { stage: 'test', message: 'user@test.com', payload: 'private' });
    session.record('unknown', { message: 'untrusted' });
    const report = session.report(); const text = JSON.stringify(report);
    assert.equal(report.events.length, 1000); assert.ok(report.summary.droppedEvents > 0);
    for (const secret of ['sensitive', 'Private', '<private>', 'user@test.com', 'token=hidden', 'secret.example', 'untrusted']) assert.equal(text.includes(secret), false, secret);
    const file = path.join(directory, 'report.json.gz'); session.export(file);
    assert.equal(JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).sessionId, session.id);
    session.stop(); assert.equal(session.previous().active, false);
  } finally { session.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('snapshot sharing, timeout and old-session completion cannot corrupt replacement', async () => {
  let resolve, reads = 0;
  const session = new DiagnosticSession({ snapshotTimeout: 30, providers: { delayed: () => { reads++; return new Promise(r => { resolve = r; }); } } });
  session.start(); const first = session.snapshot(); const shared = session.snapshot();
  await Promise.resolve(); assert.equal(reads, 1);
  session.stop(); session.start(); session.providers = { fresh: () => ({ ok: true }) };
  await session.snapshot(); resolve({ old: true }); await Promise.all([first, shared]);
  assert.equal(session.report().snapshots.length, 1); assert.ok(session.report().snapshots[0].parts.fresh);
  session.providers = { stuck: () => new Promise(() => {}) }; await session.snapshot();
  assert.equal(session.report().snapshots.at(-1).parts.stuck.status, 'error'); session.stop();
});

test('consent is required; remote actions are restricted and credentials never enter reports', async () => {
  let command = { id: '1', type: 'shell', script: 'danger' }; const routes = [];
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async (url) => {
    routes.push(url.pathname);
    if (url.pathname.endsWith('/connect')) return reply({ id, token });
    if (url.pathname.endsWith('/poll')) return reply({ command });
    return reply({ received: true });
  } });
  session.start(); await assert.rejects(session.connect(id + '.' + token, false), /approve/); assert.equal(routes.length, 0);
  await session.connect(id + '.' + token, true);
  await session.poll(); assert.equal(session.events.at(-1).status, 'rejected');
  assert.equal(JSON.stringify(session.report()).includes(token), false); assert.equal(JSON.stringify(session.state()).includes(token), false);
  command = { id: '2', type: 'stop' }; await session.poll();
  assert.equal(session.active, false); assert.equal(session.remote, null); assert.ok(routes.at(-1).endsWith('/close'));
});

test('initial upload failure retains bounded polling; revocation stops access and capture', async () => {
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async url => {
    if (url.pathname.endsWith('/connect')) return reply({ id, token });
    return { ok: false, status: url.pathname.endsWith('/poll') ? 401 : 503 };
  } });
  session.start(); session.setCapture(true);
  await assert.rejects(session.connect(id + '.' + token, true), /503/); assert.ok(session.pollTimer);
  await session.poll(); assert.equal(session.active, false); assert.equal(session.holdPrint(), false);
});

test('late connection after local stop is revoked, never attached to the next session', async () => {
  let resolve; const paths = [];
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async url => {
    paths.push(url.pathname); if (url.pathname.endsWith('/connect')) return new Promise(r => { resolve = r; }); return reply({});
  } });
  session.start(); const pending = session.connect(id + '.' + token, true); session.stop(); session.start();
  resolve(reply({ id, token })); await pending;
  assert.equal(session.remote, null); assert.ok(paths.at(-1).endsWith('/close')); session.stop();
});

test('report stays below upload budget and capture expires without requiring timer delivery', async () => {
  let now = 1000;
  const session = new DiagnosticSession({ now: () => now, providers: { huge: () => Array(100).fill('x'.repeat(2000)) } });
  session.start(); session.setCapture(true); await session.snapshot();
  for (let i = 0; i < 1000; i++) session.record('ipc', { message: 'x'.repeat(500), stage: 'y'.repeat(500) });
  assert.ok(Buffer.byteLength(JSON.stringify(session.report())) < 1024 * 1024);
  assert.equal(session.snapshots[0].parts.huge.status, 'truncated');
  now += 30 * 60000; assert.equal(session.holdPrint(), false); session.stop();
  assert.equal(sanitize({ audio: { enabled: true }, token: 'hidden' }).audio.enabled, true);
  assert.equal(sanitize('2026-10-01T04:00:00.000Z'), '2026-10-01T04:00:00.000Z');
});

test('endpoint rejects HTTP, paths and redirects; bounded streaming response is cancelled', async () => {
  const session = new DiagnosticSession({ baseUrl: 'http://support.posnic.com', request: () => { throw Error('should not send'); } });
  await assert.rejects(session.call('/api/test', {}, token), /HTTPS origin/);
  let cancelled = false;
  session.baseUrl = 'https://support.posnic.com';
  session.request = async (_url, opts) => { assert.equal(opts.redirect, 'error'); return { ok: true, body: { getReader: () => ({ read: async () => ({ value: Buffer.alloc(100001), done: false }), cancel: async () => { cancelled = true; }, releaseLock() {} }) } }; };
  await assert.rejects(session.call('/api/test', {}, token), /too large/); assert.equal(cancelled, true);
});

test('pairing rejects incomplete codes before networking and accepts a complete code with surrounding whitespace', async () => {
  const headers = [];
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async (url, options) => {
    headers.push(options.headers.authorization);
    return url.pathname.endsWith('/connect') ? reply({ id, token }) : reply({});
  } });
  session.start();
  try {
    for (const code of [token.slice(1), id.slice(24) + '.' + token, 'Instructions: ' + id + '.' + token, id + '.' + token.slice(1), null]) {
      await assert.rejects(session.connect(code, true), /Copy full code/);
    }
    assert.equal(headers.length, 0);
    await session.connect(' \n' + id + '.' + token + '\n ', true);
    assert.equal(headers[0], 'Bearer ' + id + '.' + token);
    assert.ok(session.remote);
  } finally { session.stop(); }
});

test('expired pairing gives recovery instructions and permits a fresh attempt', async () => {
  let reject = true;
  const session = new DiagnosticSession({ baseUrl: 'https://support.posnic.com', request: async url => {
    if (url.pathname.endsWith('/connect')) return reject ? { ok: false, status: 401 } : reply({ id, token });
    return reply({});
  } });
  session.start();
  try {
    await assert.rejects(session.connect(id + '.' + token, true), /expire after 15 minutes/);
    assert.equal(session.connectPending, false);
    assert.equal(session.remote, null);
    reject = false;
    await session.connect(id + '.' + token, true);
    assert.ok(session.remote);
  } finally { session.stop(); }
});

test('connected sessions send fresh reports automatically, but disconnected sessions do not', async () => {
  let time=100000, uploads=0, checks=0;
  const session=new DiagnosticSession({ now:()=>time, baseUrl:'https://support.posnic.com', providers:{system:()=>{checks++;return {}; }}, request:async url=>{
    if(url.pathname.endsWith('/report'))uploads++;
    return reply(url.pathname.endsWith('/connect')?{id,token}:{});
  }});
  session.start();
  try {
    await session.connect(token,true); assert.equal(uploads,1);
    time+=59000;await session.poll();assert.equal(uploads,1);
    time+=1001;await session.poll();assert.equal(uploads,2);assert.equal(checks,1);
    session.stop();time+=60001;await session.poll();assert.equal(uploads,2);
  } finally {session.stop();}
});
