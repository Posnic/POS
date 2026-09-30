const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../src/loading.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('startup recovery actions pass the IPC guard without a running API', async () => {
  const url = pathToFileURL(path.join(__dirname, '../src/loading.html'));
  url.searchParams.set('startupError', 'Startup failed');
  url.searchParams.set('details', '<img src=x onerror=alert(1)>');
  const calls = [], handlers = new Map();
  const guarded = require('../src/ipc-guard').guard({ handle: (name, fn) => handlers.set(name, fn) });
  guarded.handle('startup:retry', () => { calls.push('retry'); return true; });
  guarded.handle('desktop:open', (_event, target) => { calls.push(target); return true; });
  const invoke = (name, ...args) => handlers.get(name)({ senderFrame: { url: url.href } }, ...args);
  const dom = new JSDOM(html, { url: url.href, runScripts: 'dangerously', beforeParse(w) {
    w.electronAPI = { startup: { retry: () => invoke('startup:retry') }, desktop: { open: target => invoke('desktop:open', target) } };
  } });
  try {
    const d = dom.window.document;
    assert.ok(d.body.classList.contains('has-error'));
    assert.equal(d.getElementById('statusDetails').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(d.querySelector('#statusDetails img'), null);
    for (const id of ['btnRetry', 'btnHardware', 'btnBackup', 'btnOpenLog']) { d.getElementById(id).click(); await tick(); }
    assert.deepEqual(calls, ['retry', 'hardware', 'backup', 'log']);
    dom.window.electronAPI.desktop.open = async () => { throw new Error('Test refusal'); };
    d.getElementById('btnOpenLog').click(); await tick();
    assert.match(d.getElementById('recoveryFeedback').textContent, /Test refusal/);
    assert.equal(d.getElementById('btnOpenLog').disabled, false);
  } finally { dom.window.close(); }
});
