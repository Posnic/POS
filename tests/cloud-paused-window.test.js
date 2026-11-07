const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function windowFor(t, sync) {
  const html = fs.readFileSync(path.join(__dirname, '../src/cloud-setup.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  let plansOpened = 0;
  w.electronAPI = { cloud: {
    status: async () => ({ connected: true, sync }),
    plans: async () => { plansOpened++; },
    cancelAuthorization() {},
  } };
  w.eval([...w.document.querySelectorAll('script')].filter(s => !s.src).at(-1).textContent);
  await new Promise(resolve => setImmediate(resolve));
  return { w, d: w.document, plansOpened: () => plansOpened };
}
test('suspended completed shop shows local continuation without disconnecting', async t => {
  const p = await windowFor(t, { cloudPaused: true, online: false, initialSyncComplete: true, lastError: 'gateway 403' });
  assert.equal(p.d.getElementById('cloudPaused').hidden, false);
  assert.match(p.d.getElementById('syncState').textContent, /Paused/);
  assert.match(p.d.getElementById('cloudPausedHelp').textContent, /Continue using this downloaded shop/);
  assert.equal(p.d.getElementById('lastErrorBox').style.display, 'none');
  p.d.getElementById('plansBtn').click();
  assert.equal(p.plansOpened(), 1);
});
test('incomplete download does not promise the customer has their shop', async t => {
  const p = await windowFor(t, { cloudPaused: true, initialSyncComplete: false });
  assert.match(p.d.getElementById('cloudPausedHelp').textContent, /not complete/);
});
test('restored sync hides pause guidance and reports online', async t => {
  const sync = { cloudPaused: true, online: false, initialSyncComplete: true };
  const p = await windowFor(t, sync);
  sync.cloudPaused = false;
  sync.online = true;
  await p.w.refreshStatus();
  assert.equal(p.d.getElementById('cloudPaused').hidden, true);
  assert.equal(p.d.getElementById('syncState').textContent, 'Online, syncing');
});
