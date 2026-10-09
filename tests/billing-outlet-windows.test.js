'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('jsdom');
const { register } = require('../src/billing-windows');
const id = n => String(n).padStart(24, '0');
test('three outlet windows are independently titled, and minimized windows restore without reloading carts', async () => {
  const made = []; let open;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; made.push(this); }
    async loadURL(url) { this.url = url; this.loads = (this.loads || 0) + 1; }
    show() {} focus() {} isDestroyed() { return false; } isMinimized() { return !!this.minimized; }
    restore() { this.minimized = false; } setTitle(title) { this.title = title; }
  }
  register({ ipcMain: { handle: (_, handler) => { open = handler; } }, BrowserWindow: Window });
  const event = { senderFrame: { url: 'http://localhost:5555/dashboard.html' } };
  for (const [i, name] of ['Restaurant', 'Bar', 'Room Service'].entries()) await open(event, { outletId: id(i), branchId: id(9), name });
  assert.equal(made.length, 3);
  assert.deepEqual(made.map(w => w.options.title), ['Restaurant — Posnic', 'Bar — Posnic', 'Room Service — Posnic']);
  made[1].minimized = true;
  await open(event, { outletId: id(1), branchId: id(9), name: 'Bar' });
  assert.equal(made.length, 3); assert.equal(made[1].loads, 1); assert.equal(made[1].minimized, false);
  await assert.rejects(open(event, { outletId: '../bad', branchId: id(9) }));
});
function page() {
  const dom = new JSDOM('<!doctype html><aside class="leftbar">Navigation</aside><div class="rightbar"><div class="page_loader" id="sales_page">Cart</div></div><span id="billing_outlet_charge"></span><span id="addSalesGstTax_1">0</span>', { url: 'http://localhost/dashboard.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(fs.readFileSync('frontend/static/script/js/jquery.min.js', 'utf8'));
  w.billingWindowId = ''; w.API_URL = '/api/';
  w.PosnicPro = { i18n: { t: (key, fallback) => fallback }, sales: { charges: [], cart: ['Fish'] }, local: { get: () => id(9) }, request: (p, cb) => cb({ status: true, data: { branch: { id: id(9), name: 'Hotel' }, outlets: [], manage: false } }) };
  w.eval(fs.readFileSync('frontend/static/script/js/core/billing-outlets.js', 'utf8'));
  return w;
}
test('outlet prices and service charges do not compound on repeated recalculation', () => {
  const w = page(); const ui = w.PosnicPro.billingoutlets;
  ui.current = { markup_percent: 25, service_percent: 10, service_tax_percent: 5 };
  assert.equal(ui.price({ id: id(1), selling_price: 200 }).selling_price, 250);
  ui.charge(250); ui.charge(250);
  assert.equal(w.PosnicPro.sales.charges.length, 1);
  assert.equal(w.PosnicPro.sales.charges[0].amount, 25);
  assert.equal(w.PosnicPro.sales.charges[0].tax_amount, 1.25);
  w.close();
});

test('outlet sidebar and billing button follow explicit enablement, including disabling again', () => {
  const w = page();
  w.$('body').append('<ul><li id="manage_li_billingoutlets"></li></ul><button id="billing_outlets_open"></button>');
  w.PosnicPro.demoSamples = { load() {} };
  const source = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8');
  const start = source.indexOf('    applyModuleSidebar: function () {');
  const end = source.indexOf('\n    },', start);
  const apply = w.eval('(' + source.slice(start, end + 6).replace('applyModuleSidebar:', '') + ')');
  for (const enabled of [undefined, false, true, false]) {
    w.PosnicPro.local.get = key => key === 'general_settings' ? JSON.stringify({ module_billing_outlets_enable: enabled }) : null;
    apply();
    for (const selector of ['#manage_li_billingoutlets', '#billing_outlets_open']) {
      assert.equal(w.$(selector).css('display') !== 'none', enabled === true);
    }
  }
  w.close();
});
test('opening and leaving the outlet menu preserves the existing cart', async () => {
  const w = page(); w.PosnicPro.billingoutlets.show();
  await Promise.resolve(); w.$('#billing_back').trigger('click');
  assert.deepEqual(w.PosnicPro.sales.cart, ['Fish']);
  w.close();
});
test('window-scoped branch and register preferences do not overwrite the shared main-window state', () => {
  const w = new JSDOM('', { url: 'http://localhost/dashboard.html?billing_window=' + id(1) + '&billing_branch=' + id(9), runScripts: 'outside-only' }).window;
  w.PosnicPro = {}; w.localStorage.setItem('branch_id_set', id(8)); w.localStorage.setItem('cash_register_id', 'main-register');
  const source = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8');
  const start = source.indexOf('// Outlet windows own their billing preferences;');
  const end = source.indexOf('\n/*', start);
  w.eval(source.slice(start, end));
  assert.equal(w.PosnicPro.local.get('branch_id_set'), id(9));
  assert.equal(w.PosnicPro.local.get('cash_register_id'), null);
  w.PosnicPro.local.setVolatile('branchphone', '+919000000121');
  assert.equal(w.PosnicPro.local.get('branchphone'), '+919000000121');
  assert.equal(w.localStorage.getItem('branchphone'), null);
  assert.equal(w.sessionStorage.length, 0);
  w.PosnicPro.local.set('cash_register_id', 'bar-register'); w.PosnicPro.local.set('branch_id_set', id(7));
  assert.equal(w.localStorage.getItem('cash_register_id'), 'main-register');
  assert.equal(w.PosnicPro.local.get('cash_register_id'), 'bar-register');
  assert.equal(w.PosnicPro.local.get('branch_id_set'), id(9));
  w.close();
});

test('outlet page stays in the dashboard content without covering navigation and offers setup when empty', async () => {
 const w=page(); await w.PosnicPro.billingoutlets.show();
 assert.equal(w.$('#billing_outlets_page')[0].tagName, 'SECTION');
 assert.equal(w.$('#billing_outlets_page').parent()[0], w.$('.rightbar')[0]);
 assert.notEqual(w.$('#billing_outlets_page').css('position'), 'fixed');
 assert.notEqual(w.$('.leftbar').css('display'), 'none');
 assert.match(w.$('#billing_content').text(), /No billing outlets yet/);
 w.PosnicPro.billingoutlets.data.manage=true; w.PosnicPro.billingoutlets.tab('windows');
 assert.equal(w.$('#billing_content [data-billing-tab="setup"]').length,1);
 w.$('#billing_content [data-billing-tab="setup"]').trigger('click');
 assert.equal(w.$('#billing_form input[name="name"]').length,1);
 w.close();
});
test('failed load shows recovery and cannot open uninitialized tabs', async () => {
 const w=page(); w.PosnicPro.request=(p,cb,fail)=>fail({message:'Connection unavailable'});
 await w.PosnicPro.billingoutlets.show();
 assert.match(w.$('#billing_message').text(),/Connection unavailable/);
 assert.equal(w.$('#billing_retry').length,1);
 assert.equal(w.$('[data-billing-tab]:enabled').length,0);
 assert.doesNotThrow(()=>w.PosnicPro.billingoutlets.tab('setup'));
 w.close();
});
test('disabled outlets show Features guidance without opening billing windows', async () => {
 const w=page(); await w.PosnicPro.billingoutlets.show();
 w.PosnicPro.billingoutlets.data.enabled=false;
 w.PosnicPro.billingoutlets.tab('windows');
 assert.match(w.$('#billing_content').text(),/switched off/);
 assert.equal(w.$('#billing_features').length,1);
 w.close();
});

test('Back leaves the outlet route without reloading the existing cart', async () => {
 const w=page(); w.location.hash='/billingoutlets'; await w.PosnicPro.billingoutlets.show();
 w.PosnicPro.billingoutlets.previousPages=w.$('#sales_page');
 w.$('#billing_back').trigger('click');
 assert.equal(w.location.hash,'#/sales/new');
 assert.deepEqual(w.PosnicPro.sales.cart,['Fish']); w.close();
});

test('Back after loading the outlet route initializes billing through the sales route', async () => {
 const w=page(); w.location.hash='/billingoutlets';
 w.$.expr.pseudos.visible=()=>true;
 await w.PosnicPro.billingoutlets.showDataTablePage();
 assert.equal(w.PosnicPro.billingoutlets.previousPages.length,0);
 let silentReplacements=0;
 w.history.replaceState=()=>{ silentReplacements++; };
 w.$('#billing_back').trigger('click');
 assert.equal(w.location.hash,'#/sales/new');
 assert.equal(silentReplacements,0,'must dispatch a route change instead of exposing uninitialized sale markup');
 assert.equal(w.$('#sales_page').css('display'),'none');
 w.close();
});
