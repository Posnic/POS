const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/dashboard.html'), 'utf8');
const doc = new JSDOM(source);
const script = [...doc.window.document.scripts].map(x => x.textContent).find(x => x.includes('Desktop tools quick-access'));
doc.window.close();
async function menu(t, open) {
  const dom = new JSDOM('<button id="outside">Outside</button>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, opened = [], alerts = [];
  w.PosnicPro = { i18n: { t: (_key, text) => text }, local: { get: () => true },
    userACL: { branch: { write: true } }, alert: (...args) => alerts.push(args) };
  w.hasher = { setHash: target => opened.push(target) };
  w.console.error = () => {};
  w.electronAPI = { desktop: { capabilities: async () => ({ backup: true }), open: open || (async target => { opened.push(target); return true; }) }, cloud: { status: async () => ({ connected: false }) } };
  w.eval(script);
  await new Promise(r => setImmediate(r));
  return { w, opened, alerts, fab: w.document.querySelector('#posnic-desktop-fab'), trigger: w.document.querySelector('.fab-btn') };
}
test('moving focus between Desktop items must not hide the item before its click', async t => {
  const { w, fab, trigger, opened } = await menu(t);
  const items = [...fab.querySelectorAll('[role=menuitem]')];
  assert.equal(items.find(x => x.textContent === 'Hardware Manager').textContent, 'Hardware Manager');
  const targets = ['settings/app', 'hardware', 'hardware:kot', 'backup', 'update', 'cloud', 'log', 'about'];
  for (let i = 0; i < items.length; i++) {
    trigger.click();
    // Chromium delivers focusout while activeElement is temporarily body.
    // Flush the microtask here, before the destination receives focus/click.
    items[0].blur();
    fab.classList.add('open');
    items[0].dispatchEvent(new w.FocusEvent('focusout', { bubbles: true, relatedTarget: items[i] }));
    await Promise.resolve();
    assert.ok(fab.classList.contains('open'), targets[i] + ' disappeared before click');
    items[i].focus(); items[i].click();
    await Promise.resolve();
    assert.equal(opened.at(-1), targets[i]);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  }
});
test('moving focus outside closes the menu', async t => {
  const { w, fab, trigger } = await menu(t);
  trigger.click(); w.document.querySelector('#outside').focus();
  assert.equal(fab.classList.contains('open'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
for (const [name, open] of [['rejected IPC', async () => { throw Error('Unavailable'); }], ['unsupported action', async () => false]]) {
  test(name + ' gives feedback instead of a silent failure', async t => {
    const { fab, alerts } = await menu(t, open);
    [...fab.querySelectorAll('[role=menuitem]')].find(x => x.textContent === 'Cloud Sync').click();
    await new Promise(r => setImmediate(r));
    assert.equal(alerts.length, 1);
    assert.match(alerts[0][1], /Request failed/);
  });
}
test('the application log viewer can read its log through the guarded bridge', () => {
  const { isTrustedFrame } = require('../src/ipc-guard');
  assert.equal(isTrustedFrame({ url: 'file:///C:/app/resources/app.asar/src/log-viewer.html' }), true);
  assert.equal(isTrustedFrame({ url: 'https://example.com/log-viewer.html' }), false);
});
