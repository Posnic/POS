const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');
const service = require('../api/src/services/help-feedback.service');
const root = path.join(__dirname, '..');
const req = (body = {}) => ({
  user: { name: 'Shop owner', email: 'owner@example.com' },
  tenantContext: { branchName: 'Main shop', licenseId: 'account-123' },
  body: { category: 'help', email: 'reply@example.com', comment: 'Please help with printing.', ...body },
});

test('all categories work with optional name and trusted account details', () => {
  for (const category of ['help', 'feedback', 'complaint', 'suggestion', 'customization', 'other']) {
    const data = service.payload(req({ category, name: '', system: { account: 'someone else' }, to: 'evil@example.com' }));
    assert.equal(data.name, '');
    assert.equal(data.kind, category);
    assert.equal(data.system.account, 'account-123');
    assert.match(data.detail, /Main shop/);
    assert.equal(data.to, undefined);
    assert.equal(data.attachments, undefined);
  }
});
test('Community does not require a cloud account or paid messaging', () => {
  const request = req();
  delete request.tenantContext;
  assert.equal(service.payload(request).system.account, '');
  assert.equal(service.context(request).email, 'owner@example.com');
});
test('public demo refuses outbound feedback before contacting the central service', async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    assert.equal(service.context(req()).demo, true);
    const result = await service.submit(req(), () => assert.fail('must not contact support'));
    assert.equal(result.status, 403);
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
test('invalid, empty and oversized submissions are refused', () => {
  for (const body of [{ email: 'invalid' }, { email: 'a\r\nb@example.com' }, { category: 'arbitrary' },
    { comment: '  ' }, { comment: 'x'.repeat(7001) }, { email: ['x@example.com'] }, { website: 'https://spam.example' }]) {
    assert.throws(() => service.payload(req(body)));
  }
  assert.ok(service.payload(req({ comment: 'x'.repeat(7000) })).detail.length < 8000);
});
test('relay uses a fixed HTTPS destination and accepts only central receipts', async () => {
  const result = await service.submit(req({ url: 'http://localhost', recipient: 'elsewhere' }), async (url, options) => {
    assert.equal(url, 'https://www.posnic.com/api/support');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    assert.equal(JSON.parse(options.body).email, 'reply@example.com');
    return { ok: true, status: 200, json: async () => ({ ok: true, reference: 'ABC123' }) };
  });
  assert.equal(result.reference, 'ABC123');
  for (const response of [{ ok: false, status: 500 }, { ok: true, status: 200 }]) {
    const rejected = await service.submit(req(), async () => ({ ...response, json: async () => ({}) }));
    assert.equal(rejected.status, 502);
  }
  const limited = await service.submit(req(), async () => ({ status: 429, json: async () => ({}) }));
  assert.equal(limited.status, 429);
  await assert.rejects(service.submit(req(), async () => { throw new Error('offline'); }));
});

function ui(t, search = false) {
  const header = search ? fs.readFileSync(path.join(root, 'frontend/layouts/header.html'), 'utf8') : '';
  const markup = header + fs.readFileSync(path.join(root, 'frontend/layouts/about.html'), 'utf8');
  const dom = new JSDOM(markup.replace(/class="modal fade"/g, 'class="modal"'), { runScripts: 'outside-only', url: 'https://shop.example/dashboard.html' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const $ = jquery(w);
  w.$ = w.jQuery = $;
  let get, request;
  const calls = [];
  w.PosnicPro = {
    get: (_url, ok, fail) => { get = { ok, fail }; },
    request: (params, ok, fail) => { calls.push(params); request = { ok, fail }; },
  };
  w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/core/help-feedback.js'), 'utf8'));
  const f = (name) => w.document.getElementById('posnic_feedback_' + name);
  const open = () => $(f('dialog')).trigger('show.bs.modal');
  const send = () => $(f('form')).trigger('submit');
  return { $, w, f, open, send, calls, get: () => get, request: () => request };
}
test('All search opens support for ordinary and restricted staff without submitting', (t) => {
  const u = ui(t, true);
  u.w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  u.w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  u.w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/bootstrap.min.js'), 'utf8'));
  Object.assign(u.w.PosnicPro, { local: { get: () => null }, userACL: {}, i18n: { t: (_key, english) => english } });
  u.w.eval(fs.readFileSync(path.join(root, 'frontend/static/script/js/core/command-palette.js'), 'utf8'));
  for (const acl of [{}, { branch: { write: true } }]) {
    u.w.PosnicPro.userACL = acl;
    for (const query of ['help', 'complaint', 'suggestion', 'customization', 'customisation']) {
      u.w.document.getElementById('posnic-header-search').click();
      const input = u.w.document.getElementById('cmdk-input');
      input.value = query;
      input.dispatchEvent(new u.w.Event('input'));
      const option = [...u.w.document.querySelectorAll('#cmdk-list [role=option]')].find((node) => /Help & feedback/.test(node.textContent));
      assert.ok(option, query);
      option.click();
      assert.equal(u.f('dialog').getAttribute('aria-modal'), 'true');
      assert.equal(u.calls.length, 0);
      u.$(u.f('dialog')).modal('hide');
    }
  }
});
test('opening loads account defaults once and preserves edits while loading', (t) => {
  const u = ui(t);
  u.open();
  u.f('email').value = 'typed@example.com';
  u.$(u.f('email')).trigger('input');
  u.get().ok({ data: { email: 'owner@example.com', name: 'Owner', branch: '<script>shop</script>', version: '1.9.2' } });
  assert.equal(u.f('email').value, 'typed@example.com');
  assert.equal(u.f('name').value, 'Owner');
  assert.match(u.f('context').textContent, /<script>shop/);
  assert.equal(u.f('context').querySelector('script'), null);
});
test('public demo shows the form but disables sending and explains why', (t) => {
  const u = ui(t);
  u.open();
  u.get().ok({ data: { demo: true } });
  assert.equal(u.f('send').disabled, true);
  assert.match(u.f('status').textContent, /public demo/);
  u.f('email').value = 'visitor@example.com';
  u.f('comment').value = 'Do not email this';
  u.send();
  assert.equal(u.calls.length, 0);
});
test('Community can submit without a name; one request while busy, receipt visible', (t) => {
  const u = ui(t);
  const category = u.f('category');
  const option = category.querySelector('option[value="customization"]');
  assert.equal(option.dataset.t, 'lang_feedback_customization');
  for (const language of require('../frontend/gulpfile.js/config').LANGUAGES) {
    const pack = require('../languages/' + (language.code === 'en' ? '_english' : language.code) + '.json');
    assert.ok(pack[option.dataset.t]?.trim(), language.code);
  }
  category.value = 'customization';
  u.f('email').value = 'shop@example.com';
  u.f('comment').value = 'A suggestion';
  u.send(); u.send();
  assert.equal(u.calls.length, 1);
  assert.equal(JSON.parse(u.calls[0].data).name, '');
  assert.equal(JSON.parse(u.calls[0].data).category, 'customization');
  assert.equal(u.f('send').disabled, true);
  assert.equal(u.f('comment').disabled, true);
  const hide = u.$.Event('hide.bs.modal');
  u.$(u.f('dialog')).trigger(hide);
  assert.equal(hide.isDefaultPrevented(), true);
  u.request().ok({ type: 'success', data: { reference: '123ABC' } });
  assert.equal(u.f('send').disabled, false);
  assert.equal(u.f('comment').disabled, false);
  assert.equal(u.f('comment').value, '');
  assert.match(u.f('status').textContent, /123ABC/);
  assert.equal(u.f('status').hidden, false);
});
test('network errors preserve the draft and allow retry; invalid forms do not send', (t) => {
  const u = ui(t);
  u.send();
  assert.equal(u.calls.length, 0);
  u.f('email').value = 'shop@example.com';
  u.f('comment').value = 'Keep my comment';
  u.send();
  u.request().fail({});
  assert.equal(u.f('comment').value, 'Keep my comment');
  assert.equal(u.f('send').disabled, false);
  assert.match(u.f('status').textContent, /internet/);
  u.send();
  assert.equal(u.calls.length, 2);
  u.request().ok({ type: 'error' });
  assert.equal(u.f('comment').value, 'Keep my comment');
});
