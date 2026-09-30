'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/business-approval.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><button id="tender">Tender</button></body></html>', { url: 'https://till.example.test/dashboard.html', runScripts: 'outside-only' });
  const window = dom.window, document = window.document;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.API_URL = 'https://till.example.test/api/';
  window.$ = () => ({ prop() { return this; }, removeClass() { return this; }, remove() { return this; } });
  const caps = { enabled: true, currencyDigits: 2, branchId: 'a'.repeat(24), requesterId: 'b'.repeat(24) };
  const payload = { sale_process: 'add', extra_discount: 10, payment_mode: 'Cash', items: [{ item_id: 'c'.repeat(24), item_quantity: 1 }] };
  const params = { data: JSON.stringify(payload) };
  let recoveryPage, unknownLookup = false;
  let record = null, saves = 0, local = 0, failCreate = false, failRead = false;
  const calls = [], alerts = [];
  window.PosnicPro = { sales: { SaleAction: 'add', saleProcess: 'add' }, i18n: { t: (_key, fallback) => fallback }, alert: (...args) => alerts.push(args) };
  function request(method, options, success, failure) {
    const body = options.data ? JSON.parse(options.data) : null;
    calls.push({ method, url: options.url, body });
    if (options.url.endsWith('/capabilities')) return success({ data: caps });
    if (options.url.includes('/recoveries')) return failRead ? failure({ status: 0 }) : success({ data: recoveryPage });
    if (method === 'post' && options.url === 'sales/business-decisions') {
      record = { id: 'd'.repeat(24), branchId: caps.branchId, requesterId: caps.requesterId, operationId: body.sale.billing_transaction_id, state: 'pending', expiresAt: new Date(Date.now() + 300000).toISOString(),
        summary: { currency: 'INR', currencyDigits: 2, beforeDiscountMinor: 10000, discountMinor: 1000, payableMinor: 9000, roundingMinor: 0, reason: body.reason } };
      return failCreate ? failure({ status: 0 }) : success({ data: record });
    }
    if (unknownLookup && options.url.includes('/operation/')) return success({ data: null });
    if (options.url.endsWith('/cancel')) { record = { ...record, state: 'cancelled' }; return success({ data: record }); }
    if (failRead) return failure({ status: 0 });
    return success({ data: record });
  }
  window.PosnicPro.get = (options, success, failure) => request('get', options, success, failure);
  window.PosnicPro.post = (options, success, failure) => request('post', options, success, failure);
  window.eval(source);
  const api = window.PosnicPro.businessApproval;
  const offer = () => api.offer(params, () => { saves++; }, () => { local++; });
  const button = label => Array.from(document.querySelectorAll('dialog button')).find(node => node.textContent === label);
  async function send(reason = 'Regular customer') {
    await offer();
    const input = document.querySelector('textarea'); input.value = reason; input.dispatchEvent(new window.Event('input'));
    button('Send request').click(); await settle();
  }
  return { dom, window, document, api, caps, params, calls, alerts, offer, send, button, saves: () => saves, local: () => local,
    unknownLookup: value => { unknownLookup = value; }, recoveries: page => { recoveryPage = page; }, record: () => record, change: change => { record = { ...record, ...change }; }, failCreate: () => { failCreate = true; }, failRead: () => { failRead = true; } };
}
test('requesting and receiving approval never saves automatically; an explicit save uses the same operation', async () => {
  const f = fixture();
  try {
    await f.send('<img src=x onerror=alert(1)>');
    assert.equal(f.saves(), 0); assert.equal(f.document.querySelectorAll('dialog img').length, 0);
    assert.equal(f.button('Save approved bill'), undefined);
    f.change({ state: 'approved' }); f.button('Check status').click(); await settle();
    assert.equal(f.saves(), 0); assert.ok(f.button('Save approved bill'));
    f.button('Save approved bill').click();
    assert.equal(f.saves(), 1);
    const sent = JSON.parse(f.params.data);
    assert.equal(sent.business_decision_id, f.record().id); assert.equal(sent.billing_transaction_id, f.record().operationId);
    assert.equal(f.window.sessionStorage.length, 1);
    const journal = JSON.parse(f.window.sessionStorage.getItem(f.window.sessionStorage.key(0)));
    assert.deepEqual(Object.keys(journal).sort(), ['operationId', 'requestId']);
    f.api.saved(); assert.equal(f.window.sessionStorage.length, 0); assert.equal(f.document.querySelector('dialog'), null);
  } finally { f.dom.window.close(); }
});
test('a lost request response recovers by operation without sending another request', async () => {
  const f = fixture();
  try {
    f.failCreate(); await f.send();
    assert.equal(f.calls.filter(call => call.method === 'post').length, 1);
    f.button('Check status').click(); await settle();
    assert.ok(f.calls.some(call => call.url.includes('/operation/')));
    assert.match(f.document.querySelector('h2').textContent, /Waiting/);
    assert.equal(f.calls.filter(call => call.method === 'post').length, 1);
  } finally { f.dom.window.close(); }
});
test('an uncertain save removes the save action until the receipt is verified and permits recovery only when saved', async () => {
  const f = fixture();
  try {
    await f.send(); f.change({ state: 'approved' }); f.button('Check status').click(); await settle();
    f.button('Save approved bill').click(); f.api.failed({ status: 0 });
    assert.equal(f.button('Save approved bill'), undefined);
    f.change({ state: 'applying', checkout: { state: 'reconciling', saleId: null } });
    f.button('Check status').click(); await settle();
    assert.equal(f.button('Save approved bill'), undefined); assert.equal(f.button('Recover saved bill'), undefined);
    f.change({ checkout: { state: 'saved', saleId: 'e'.repeat(24) } });
    f.button('Check status').click(); await settle();
    f.button('Recover saved bill').click();
    assert.equal(f.saves(), 2); assert.equal(JSON.parse(f.params.data).billing_transaction_id, f.record().operationId);
  } finally { f.dom.window.close(); }
});
test('closing a pending request preserves its reference and reopening reads its current scoped state', async () => {
  const f = fixture();
  try {
    await f.send(); f.document.querySelector('.business-approval-close').click();
    assert.equal(f.window.sessionStorage.length, 1); assert.equal(f.document.querySelector('dialog'), null);
    f.change({ state: 'declined' }); await f.offer(); await settle();
    assert.match(f.document.querySelector('h2').textContent, /declined/);
    assert.equal(f.button('Save approved bill'), undefined);
    f.button('Back to bill').click(); assert.equal(f.window.sessionStorage.length, 0);
  } finally { f.dom.window.close(); }
});
test('a failed status check cannot use the previously approved state or silently fall back to local approval', async () => {
  const f = fixture();
  try {
    await f.send(); f.change({ state: 'approved' }); f.button('Check status').click(); await settle();
    f.failRead(); f.button('Check status').click(); await settle();
    assert.equal(f.button('Save approved bill'), undefined); assert.equal(f.local(), 0);
  } finally { f.dom.window.close(); }
});
test('disabled capability uses the existing local approval only when there is no pending reference', async () => {
  const f = fixture();
  try {
    f.caps.enabled = false; await f.offer(); assert.equal(f.local(), 1);
    f.caps.enabled = true; await f.send(); f.document.querySelector('.business-approval-close').click();
    f.caps.enabled = false; await f.offer(); await settle(); assert.equal(f.local(), 1); assert.ok(f.document.querySelector('dialog'));
  } finally { f.dom.window.close(); }
});

test('local reconciliation overrides an approved owner status and never offers a second save or cancellation', async () => {
  const f = fixture();
  try {
    await f.send();
    f.change({ state: 'approved', checkout: { state: 'reconciling', saleId: null } });
    f.button('Check status').click(); await settle();
    assert.equal(f.button('Save approved bill'), undefined);
    assert.equal(f.button('Cancel request'), undefined);
    assert.equal(f.button('Recover saved bill'), undefined);
    assert.match(f.document.querySelector('h2').textContent, /receipt/);
    assert.equal(f.saves(), 0);
  } finally { f.dom.window.close(); }
});

test('every cashier approval message is present in the initial 18 language packs', () => {
  const keys = [...new Set([...source.matchAll(/PosnicPro\.i18n\.t\('(lang_business_[^']+)'/g)].map(match => match[1]))];
  assert.equal(keys.length, 40);
  for (const locale of ['_english', 'ta', 'hi', 'ml', 'kn', 'te', 'si', 'ne', 'ar', 'fr', 'es', 'pt', 'id', 'th', 'de', 'sw', 'nl', 'it']) {
    const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '../languages', locale + '.json'), 'utf8'));
    for (const key of keys) assert.ok(typeof dictionary[key] === 'string' && dictionary[key].trim(), locale + ': ' + key);
  }
});


test('restart recovery reads durable references without changing the current bill or creating another execution', async () => {
  const f = fixture();
  try {
    await f.send();
    f.change({ state: 'applying', checkout: { state: 'reconciling', saleId: null } });
    f.document.querySelector('.business-approval-close').click();
    f.window.sessionStorage.clear();
    f.caps.recoveryVersion = 1;
    f.recoveries({ references: [{ requestId: f.record().id, startedAt: new Date().toISOString() }], nextCursor: null });
    const original = f.params.data;
    const writes = f.calls.filter(call => call.method === 'post').length;
    await f.offer(); f.button('Earlier checkout attempts').click(); await settle();
    f.document.querySelector('.business-approval-recovery-row').click(); await settle();
    assert.match(f.document.querySelector('h2').textContent, /receipt/);
    assert.match(f.document.querySelector('.business-approval-message').textContent, /Review only/);
    assert.equal(f.button('Save approved bill'), undefined);
    assert.equal(f.button('Recover saved bill'), undefined);
    assert.equal(f.button('Cancel request'), undefined);
    f.change({ state: 'applied', checkout: { state: 'applied', saleId: 'e'.repeat(24) } });
    f.button('Check status').click(); await settle();
    assert.equal(f.button('Recover saved bill'), undefined);
    assert.equal(f.params.data, original);
    assert.equal(f.window.sessionStorage.length, 0);
    assert.equal(f.calls.filter(call => call.method === 'post').length, writes);
    assert.equal(f.saves(), 0);
  } finally { f.dom.window.close(); }
});

test('recovery pages are bounded and malformed or foreign records cannot become review authority', async () => {
  const f = fixture();
  try {
    await f.send(); f.document.querySelector('.business-approval-close').click(); f.window.sessionStorage.clear();
    f.caps.recoveryVersion = 1;
    const reference = { requestId: f.record().id, startedAt: new Date().toISOString() };
    f.recoveries({ references: [reference, reference], nextCursor: null });
    await f.offer(); f.button('Earlier checkout attempts').click(); await settle();
    assert.equal(f.document.querySelector('.business-approval-recovery-row'), null);
    const cursor = 'a'.repeat(64);
    f.recoveries({ references: [reference], nextCursor: cursor });
    f.button('Check status').click(); await settle();
    f.change({ branchId: 'e'.repeat(24) });
    f.document.querySelector('.business-approval-recovery-row').click(); await settle();
    assert.equal(f.button('Save approved bill'), undefined);
    assert.equal(f.document.querySelector('.business-approval-reason'), null);
    f.recoveries({ references: [], nextCursor: null });
    f.button('More references').click(); await settle();
    assert.ok(f.calls.some(call => call.url.endsWith('/recoveries?cursor=' + cursor)));
    assert.match(f.document.querySelector('.business-approval-details').textContent, /No unconfirmed/);
    f.failRead(); f.button('Check status').click(); await settle();
    assert.equal(f.document.querySelector('.business-approval-recovery-row'), null);
    assert.ok(f.document.querySelector('.business-approval-error').textContent);
  } finally { f.dom.window.close(); }
});


test('a pre-claim request survives session loss as a read-only unknown operation until its response arrives', async () => {
  const f = fixture();
  try {
    await f.send(); f.document.querySelector('.business-approval-close').click(); f.window.sessionStorage.clear();
    f.caps.recoveryVersion = 1; f.caps.requestRecovery = true;
    const operationId = f.record().operationId;
    f.recoveries({ references: [{ requestId: null, operationId, startedAt: new Date().toISOString() }], nextCursor: null });
    f.unknownLookup(true);
    const originalBill = f.params.data;
    await f.offer(); f.button('Earlier checkout attempts').click(); await settle();
    assert.ok(f.calls.some(call => call.url.endsWith('/recoveries?requests=1')));
    f.document.querySelector('.business-approval-recovery-row').click(); await settle();
    assert.ok(f.document.querySelector('.business-approval-error').textContent);
    assert.equal(f.button('Send request'), undefined);
    f.unknownLookup(false); f.button('Check status').click(); await settle();
    assert.match(f.document.querySelector('h2').textContent, /Waiting/);
    f.change({ state: 'approved' }); f.button('Check status').click(); await settle();
    assert.equal(f.button('Save approved bill'), undefined);
    assert.equal(f.button('Cancel request'), undefined);
    assert.equal(f.params.data, originalBill);
    assert.equal(f.window.sessionStorage.length, 0);
    assert.equal(f.calls.filter(call => call.method === 'post').length, 1);
  } finally { f.dom.window.close(); }
});

test('request recovery binds the operation identity and accepts the negotiated request-page cursor only', async () => {
  const f = fixture();
  try {
    await f.send(); f.document.querySelector('.business-approval-close').click(); f.window.sessionStorage.clear();
    f.caps.recoveryVersion = 1; f.caps.requestRecovery = true;
    f.recoveries({ references: [{ requestId: f.record().id, operationId: 'different-operation-1234', startedAt: new Date().toISOString() }], nextCursor: 'requests' });
    await f.offer(); f.button('Earlier checkout attempts').click(); await settle();
    f.document.querySelector('.business-approval-recovery-row').click(); await settle();
    assert.ok(f.document.querySelector('.business-approval-error').textContent);
    assert.equal(f.button('Save approved bill'), undefined);
    f.recoveries({ references: [], nextCursor: null });
    f.button('More references').click(); await settle();
    assert.ok(f.calls.some(call => call.url.endsWith('/recoveries?requests=1&cursor=requests')));
  } finally { f.dom.window.close(); }
});
