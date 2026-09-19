'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { Readable } = require('stream');
const { validateActivation } = require('../src/cloud-activation');
const { AssetUpdater } = require('../src/asset-updater');
const { installAgent } = require('../src/agent-bootstrap');
const Manager = require('../src/sync-agent-manager');
const keys = crypto.generateKeyPairSync('ed25519');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = new AssetUpdater({ root, publicKey: keys.publicKey, baseline: path.join(root, 'baseline') });
  const contents = Buffer.from('verified component');
  const manifest = { version: '1.6.4', kind: 'agent', files: [{ path: 'src/index.js', sha256: AssetUpdater.hash(contents) }] };
  manifest.signature = crypto.sign(null, Buffer.from(AssetUpdater.signedPayload(manifest)), keys.privateKey).toString('base64');
  const requests = [];
  const opts = {
    config: { gatewayUrl: 'https://cloud.example', deviceToken: 'test-token' }, engine,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return url.endsWith('/bundle') ? new Response('zip') : Response.json({ version: '1.6.4', manifest });
    },
    open: async () => ({ files: [{ path: 'src/index.js', type: 'File', uncompressedSize: contents.length, stream: () => Readable.from([contents]) }] }),
  };
  return { root, engine, manifest, opts, requests };
}

test('a public installer installs a signed component after activation', async (t) => {
  const { opts, engine, requests } = fixture(t);
  assert.equal(await installAgent(opts), '1.6.4');
  assert.equal(engine.activeVersion(), '1.6.4');
  assert.equal(fs.readFileSync(path.join(engine.activeDir(), 'src/index.js'), 'utf8'), 'verified component');
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.options.headers.authorization, 'Bearer test-token');
    assert.equal(request.options.redirect, 'error');
  }
});

test('unsigned code is refused before downloading or extracting it', async (t) => {
  const { opts, manifest, requests, engine } = fixture(t);
  manifest.signature = 'invalid';
  opts.open = () => assert.fail('must not extract');
  await assert.rejects(installAgent(opts), /could not be verified/);
  assert.equal(requests.length, 1);
  assert.equal(engine.activeVersion(), null);
});

test('corrupt bundle contents never become active and temporary files are removed', async (t) => {
  const { opts, root, engine } = fixture(t);
  opts.open = async () => ({ files: [{ path: 'src/index.js', type: 'File', uncompressedSize: 7, stream: () => Readable.from([Buffer.from('corrupt')]) }] });
  await assert.rejects(installAgent(opts), /failed verification/);
  assert.equal(engine.activeVersion(), null);
  assert.deepEqual(fs.readdirSync(root), [], 'no unverified bytes reach disk');
});

test('unavailable feed fails with a retryable error instead of claiming a download started', async (t) => {
  const { opts } = fixture(t);
  opts.fetch = async () => new Response(null, { status: 204 });
  await assert.rejects(installAgent(opts), /unavailable.*retry/);
});

test('Community mode makes no cloud request without activation', async (t) => {
  const { root } = fixture(t);
  const manager = new Manager({ app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.1' }, fetch: () => assert.fail('no cloud request') });
  assert.equal(await manager.start(), false);
});

test('a public installer upgrade retains the downloaded agent when it has no bundled replacement', async (t) => {
  const { opts, engine, root } = fixture(t);
  await installAgent(opts);
  const manager = new Manager({ app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.1' } });
  manager._engine = engine;
  await manager._applyDownloadedUpdates();
  assert.equal(engine.activeVersion(), '1.6.4');
  assert.ok(manager._findAgent());
});

// Exercise the real main-process connection helper with an asynchronous manager.
function connection(start) {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const helper = main.slice(main.indexOf('let cloudConnectionBusy ='), main.indexOf("ipcMain.handle('cloud:resume'"));
  const manager = { stop() {}, start };
  const sandbox = { fs: { existsSync: () => false, writeFileSync() {}, chmodSync() {} }, validateActivation, path, app: { getPath: () => 'test' },
    process: { env: {} }, console: { log() {}, warn() {} }, CLOUD_CONFIG_FILE: 'test.json', syncAgentManager: manager,
    WEBSITE_API: 'https://www.posnic.com', AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ tenantDb: 'shop', branchIds: [] }) }),
    require: (name) => name === 'mongodb' ? { MongoClient: class {
      async connect() {} async close() {}
      db() { return { collection: () => ({ find: () => ({ toArray: async () => [] }), countDocuments: async () => 0 }) }; }
    } } : require(name === './cloud-shop-identity' ? '../src/cloud-shop-identity' : name),
    createMenu() {}, tray: null, refreshBrand: async () => {}, refreshLimits: async () => {}, };
  vm.runInNewContext(helper, sandbox);
  return sandbox.connectCloudDevice({ deviceToken: 'a'.repeat(64), deviceId: 'device' }, 'https://cloud.example');
}

test('activation awaits startup and refuses async false', async () => {
  const result = await connection(async () => false);
  assert.equal(result.ok, false);
});

test('activation does not succeed before the component has started', async () => {
  let finish;
  let complete = false;
  const result = connection(() => new Promise((resolve) => { finish = resolve; })).then((r) => { complete = true; return r; });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(complete, false);
  finish(true);
  assert.equal((await result).ok, true);
});

test('startup failure permits retry without redeeming a pairing code twice', async () => {
  const result = await connection(async () => { throw new Error('download failed'); });
  assert.equal(result.ok, false);
  assert.equal(result.canResume, true);
  assert.equal(result.error, 'download failed');
});

function wizard(t, cloud) {
  const source = fs.readFileSync(path.join(__dirname, '../src/install-wizard.html'), 'utf8');
  const fn = source.slice(source.indexOf('        async function runCloudSetup('), source.indexOf('        async function initApiBase('));
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { style: {}, disabled: false, textContent: '' }); return elements.get(id); } };
  let poll;
  let now = 0;
  const sandbox = { resumeCloudDownload: false, document, window: { electronAPI: { cloud } }, API_BASE: 'http://localhost',
    Date: { now: () => now }, setTimeout: (fn) => { poll = fn; return 1; }, clearTimeout: () => { poll = null; } };
  vm.runInNewContext(fn, sandbox);
  return { run: sandbox.runCloudSetup, document, tick: async (elapsed) => { now += elapsed; const fn = poll; poll = null; await fn(); } };
}

for (const type of ['false', 'rejection', 'status failure', 'no status']) {
  test(`wizard recovers its controls after ${type}`, async (t) => {
    const harness = wizard(t, { status: async () => { if (type === 'status failure') throw new Error('IPC gone'); return { sync: null }; } });
    await harness.run(async () => { if (type === 'rejection') throw new Error('IPC gone'); return { ok: type !== 'false' }; });
    if (type === 'status failure' || type === 'no status') await harness.tick(61_000);
    for (const id of ['cloudConnectBtn', 'cloudBackBtn', 'pairBtn']) assert.equal(harness.document.getElementById(id).disabled, false);
    assert.equal(harness.document.getElementById('cloudError').style.display, 'block');
  });
}

// A small real ZIP (stored entries) exercises the production in-memory parser.
function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(data);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, bytes);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, filename); offset += local.length + filename.length + bytes.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, index, end]);
}

for (const scenario of ['valid', 'unexpected path', 'duplicate', 'tampered', 'missing']) {
  test(`real ZIP: ${scenario} contents are verified before any disk write`, async (t) => {
    const { opts, engine, root, manifest } = fixture(t);
    const entries = [['src/index.js', scenario === 'tampered' ? 'tampered' : 'verified component']];
    if (scenario === 'unexpected path') entries.push(['../escape.js', 'untrusted']);
    if (scenario === 'duplicate') entries.push(entries[0]);
    if (scenario === 'missing') entries.length = 0;
    const archive = zip(entries);
    delete opts.open;
    opts.fetch = async (url) => url.endsWith('/bundle') ? new Response(archive) : Response.json({ version: manifest.version, manifest });
    if (scenario === 'valid') assert.equal(await installAgent(opts), '1.6.4');
    else {
      await assert.rejects(installAgent(opts), /unexpected|repeated|verification|incomplete/);
      assert.equal(engine.activeVersion(), null);
      assert.deepEqual(fs.readdirSync(root), []);
    }
  });
}

test('a ZIP cannot evade the expansion limit by lying about its size', async (t) => {
  const { opts, root } = fixture(t);
  const megabyte = Buffer.alloc(1024 * 1024);
  opts.open = async () => ({ files: [{ path: 'src/index.js', type: 'File', uncompressedSize: 1,
    stream: () => Readable.from(Array(65).fill(megabyte)) }] });
  await assert.rejects(installAgent(opts), /too large/);
  assert.deepEqual(fs.readdirSync(root), []);
});

const { cloudServerUrl } = require('../src/cloud-activation');
test('activation accepts the gateway protocol and persists only defined fields', () => {
  const result = validateActivation({ deviceToken: 'a'.repeat(64), deviceId: 'till-1234', syncUrl: 'https://gateway.example/', ignored: 'untrusted' }, 'https://other.example');
  assert.deepEqual(result, { deviceToken: 'a'.repeat(64), deviceId: 'till-1234', gatewayUrl: 'https://gateway.example' });
});
for (const url of ['http://remote.example', 'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com?token=x', 'https://example.com/#script', 'not-a-url']) {
  test(`activation refuses unsafe server address ${url}`, () => assert.throws(() => cloudServerUrl(url)));
}
for (const reply of [null, { deviceToken: {}, deviceId: 'device' }, { deviceToken: 'a'.repeat(64), deviceId: '../file' }, { deviceToken: 'a'.repeat(10000), deviceId: 'device' }]) {
  test('malformed activation cannot become saved configuration', () => assert.throws(() => validateActivation(reply, 'https://cloud.example')));
}

test('loopback development servers remain available', () => assert.equal(cloudServerUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080'));
