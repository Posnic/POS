'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const recoveryJS = read('frontend/static/script/js/core/offline-recovery.js');
const wizardHTML = read('src/install-wizard.html');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const sample = () => ({ recoveryAccount: 'owner@example.test', recoveryCodes: ['A123-B456-C789-D012-E345-F678-A901-B234', 'B123-C456-D789-E012-F345-A678-B901-C234'] });
function downloads(window) {
  const saved = [];
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { saved.push(blob); return 'blob:synthetic-test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  return saved;
}
function page(mode, handler) {
  const html = mode === 'login' ? read('frontend/login.html') : '<main class="rightbar"></main>' + read('frontend/modals/profile.html');
  const dom = new JSDOM(html, { url: 'http://localhost/' + (mode === 'login' ? 'login' : 'dashboard') + '.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.jQuery = (fn) => fn();
  w.PosnicPro = {
    i18n: { t: (_key, english) => english, say: (english) => english },
    get: (url, ok, fail) => handler('GET', url, {}, ok, fail),
    post: (params, ok, fail) => handler('POST', params.url, JSON.parse(params.data), ok, fail),
  };
  const saved = downloads(w);
  w.eval(recoveryJS);
  return { dom, w, doc: w.document, saved };
}
function submit(w, form) { form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); }
function paste(w, input, text) {
  const event = new w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  input.dispatchEvent(event);
  return event;
}

test('owner can replace and save codes; account text is inert and codes disappear on close', async () => {
  let posted;
  const data = sample(); data.recoveryAccount = '<img src=x onerror=alert(1)>';
  const { dom, w, doc, saved } = page('profile', (method, url, body, ok) => {
    if (url.endsWith('/options')) ok({ data: { offline: true } });
    else if (method === 'GET') ok({ data: { eligible: true, remaining: 0 } });
    else { posted = body; ok({ type: 'success', data }); }
  });
  try {
    await flush();
    assert.equal(doc.getElementById('offline_recovery_settings').hidden, false);
    doc.getElementById('offline_recovery_notice').querySelector('button').click();
    const dialog = doc.querySelector('dialog');
    dialog.querySelector('input').value = 'Current-password-26';
    submit(w, dialog.querySelector('form'));
    await flush();
    assert.deepEqual(posted, { currentPassword: 'Current-password-26' });
    assert.equal(dialog.querySelector('img'), null);
    assert.equal(dialog.querySelector('input[type=password]'), null);
    const buttons = [...dialog.querySelectorAll('button')];
    const done = buttons.find((b) => b.textContent === 'Done');
    assert.equal(done.disabled, true);
    buttons.find((b) => b.textContent === 'Save recovery codes').click();
    assert.match(await saved[0].text(), /A123-B456/);
    assert.match(await saved[0].text(), /only one complete line, not the whole list/);
    assert.match(dialog.textContent, /Each line is a separate recovery code/);
    const check = dialog.querySelector('input[type=checkbox]'); check.checked = true; check.dispatchEvent(new w.Event('change'));
    done.click();
    assert.equal(doc.querySelector('dialog'), null);
    assert.equal(data.recoveryCodes.length, 0);
    assert.equal(doc.getElementById('offline_recovery_notice'), null);
    assert.equal(w.localStorage.length, 0);
  } finally { dom.window.close(); }
});

test('recovery shows a failed code, then clears credentials after a successful reset', async () => {
  let attempt = 0, posted;
  const { dom, w, doc } = page('login', (method, _url, body, ok, fail) => {
    if (method === 'GET') ok({ data: { offline: true } });
    else {
      posted = body;
      if (++attempt === 1) fail({ responseJSON: { message: 'This code was already used.' } });
      else ok({ type: 'success', message: 'Password reset. Sign in with your new password.' });
    }
  });
  try {
    await flush();
    w.localStorage.setItem('posnic_jwt_token', 'old-sign-in');
    doc.getElementById('offline_recovery_open').click();
    const form = doc.querySelector('dialog form');
    for (const [key, value] of Object.entries({ account: 'owner@example.test', recoveryCode: sample().recoveryCodes[0], newPassword: 'New-password-26', confirmPassword: 'New-password-26' })) form.elements[key].value = value;
    submit(w, form); await flush();
    assert.match(doc.querySelector('[data-message]').textContent, /already used/);
    assert.equal(form.querySelector('button').disabled, false);
    submit(w, form); await flush();
    assert.equal(posted.newPassword, 'New-password-26');
    assert.equal(form.elements.recoveryCode.value, '');
    assert.equal(form.elements.newPassword.value, '');
    assert.equal(form.hidden, true);
    assert.equal(w.localStorage.getItem('posnic_jwt_token'), null);
    assert.match(doc.querySelector('dialog').textContent, /Sign in with your new password/);
  } finally { dom.window.close(); }
});

test('whole-sheet paste is caught before truncation and cannot submit a previously entered code', async () => {
  const posted = [];
  const { dom, w, doc } = page('login', (method, _url, body, ok) => {
    if (method === 'GET') ok({ data: { offline: true } });
    else { posted.push(body); ok({ type: 'success', message: 'Password reset.' }); }
  });
  try {
    await flush();
    doc.getElementById('offline_recovery_open').click();
    const form = doc.querySelector('dialog form'), code = form.elements.recoveryCode;
    form.elements.account.value = 'owner@example.test';
    form.elements.newPassword.value = form.elements.confirmPassword.value = 'New-password-26';
    code.value = sample().recoveryCodes[0];
    code.select();
    const sheet = 'POSNIC - OFFLINE RECOVERY CODES\nAccount: owner@example.test\n\n' + sample().recoveryCodes.join('\n');
    assert.ok(sheet.length > code.maxLength);
    assert.equal(paste(w, code, sheet).defaultPrevented, true);
    assert.equal(code.getAttribute('aria-invalid'), 'true');
    assert.equal(code.checkValidity(), false);
    assert.match(doc.getElementById('recovery-code-error').textContent, /only one recovery code/);
    submit(w, form); await flush();
    assert.equal(posted.length, 0, 'a malformed paste must not reset the account or spend an attempt');
    assert.equal(form.querySelector('[type=submit]').disabled, false);
    code.select();
    assert.equal(paste(w, code, '  ' + sample().recoveryCodes[1].toLowerCase().replaceAll('-', ' ') + '\r\n').defaultPrevented, true);
    assert.equal(code.value, sample().recoveryCodes[1]);
    assert.equal(code.hasAttribute('aria-invalid'), false);
    assert.equal(doc.getElementById('recovery-code-error').hidden, true);
    submit(w, form); await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].recoveryCode, sample().recoveryCodes[1]);
  } finally { dom.window.close(); }
});

test('incomplete and joined codes show an inline error without an HTTP reset request', async () => {
  let attempts = 0;
  const { dom, w, doc } = page('login', (method, _url, _body, ok) => {
    if (method === 'GET') ok({ data: { offline: true } });
    else attempts++;
  });
  try {
    await flush();
    doc.getElementById('offline_recovery_open').click();
    const form = doc.querySelector('dialog form'), code = form.elements.recoveryCode;
    for (const value of ['A123-B456', sample().recoveryCodes.join(' '), 'G'.repeat(32)]) {
      code.value = value;
      code.dispatchEvent(new w.Event('input', { bubbles: true }));
      submit(w, form); await flush();
      assert.equal(attempts, 0);
      assert.equal(code.getAttribute('aria-invalid'), 'true');
      assert.equal(doc.getElementById('recovery-code-error').hidden, false);
      assert.equal(form.querySelector('[type=submit]').disabled, false);
    }
  } finally { dom.window.close(); }
});

test('Cloud and staff pages do not offer owner recovery controls', async () => {
  for (const mode of ['login', 'profile']) {
    const { dom, doc } = page(mode, (_method, url, _body, ok) => ok({ data: url.endsWith('/options') ? { offline: mode !== 'login' } : { eligible: false } }));
    await flush();
    assert.equal(doc.getElementById(mode === 'login' ? 'offline_recovery_login' : 'offline_recovery_settings').hidden, true);
    assert.equal(doc.querySelector('dialog'), null);
    dom.window.close();
  }
});

async function install(mode) {
  const dom = new JSDOM(wizardHTML, { url: 'http://localhost/install-wizard.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window, doc = w.document, data = sample(), navigations = [], requests = [];
  const saved = downloads(w);
  w.electron = { loadPage: (name) => navigations.push(name), saveBackupConfig: async () => ({}), getDefaultBackupPath: async () => 'synthetic-backups' };
  w.electronAPI = { install: { credentials: async () => ({ key: 'synthetic-key', secret: 'synthetic-secret' }) } };
  w.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/api/install/add') ? { type: 'success', data } : { data: [] } };
  };
  for (const script of [...doc.querySelectorAll('script:not([src])')]) w.eval(script.textContent);
  await flush();
  if (mode === 'quick') {
    for (const [id, value] of Object.entries({ qBusinessName: 'Test shop', qEmail: 'owner@example.test', qPassword: 'Owner-password-26' })) doc.getElementById(id).value = value;
    doc.getElementById('qCreateBtn').click();
  } else {
    for (const [id, value] of Object.entries({ email: 'owner@example.test', password: 'Owner-password-26', branchName: 'Test shop', address: 'Test address', dbPassword: 'Strong-database-26!', dbPasswordConfirm: 'Strong-database-26!' })) doc.getElementById(id).value = value;
    for (const id of ['country', 'state']) { const option = doc.createElement('option'); option.value = 'Test'; option.textContent = 'Test'; doc.getElementById(id).append(option); doc.getElementById(id).value = 'Test'; }
    doc.getElementById('backupEnabled').checked = false;
    doc.getElementById('loadDemoData').checked = false;
    submit(w, doc.getElementById('installForm'));
  }
  // Quick setup includes two successful health probes 300ms apart.
  for (let i = 0; i < 30 && doc.getElementById('stepRecovery').style.display !== 'block'; i++) await new Promise((r) => setTimeout(r, 30));
  return { dom, w, doc, data, saved, navigations, requests };
}
for (const mode of ['quick', 'advanced']) test(`${mode} installation waits for saved-code confirmation before sign-in`, async () => {
  const { dom, w, doc, data, saved, navigations, requests } = await install(mode);
  try {
    assert.equal(doc.getElementById('stepRecovery').style.display, 'block', doc.getElementById('errorMessage').textContent);
    assert.equal(requests.filter((r) => r.url.endsWith('/api/install/add')).length, 1);
    assert.deepEqual(navigations, []);
    const next = doc.getElementById('recoveryContinue');
    next.click(); assert.deepEqual(navigations, []);
    doc.getElementById('saveRecoveryCodes').click();
    assert.match(await saved[0].text(), /owner@example.test/);
    assert.match(await saved[0].text(), /only one complete line, not the whole list/);
    assert.match(doc.getElementById('stepRecovery').textContent, /Each line is a separate recovery code/);
    const check = doc.getElementById('recoverySaved'); check.checked = true; check.dispatchEvent(new w.Event('change'));
    next.click();
    assert.deepEqual(navigations, ['login']);
    assert.equal(doc.getElementById('recoveryCodes').textContent, '');
    assert.equal(data.recoveryCodes.length, 0);
  } finally { dom.window.close(); }
});
