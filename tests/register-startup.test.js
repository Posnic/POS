'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { getRequestDeviceId } = require('../api/src/utils/device-id.util');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'frontend/static/script/js', file), 'utf8');
const ajax = read('core/ajax.js');
const users = read('modules/js/users.js');
const sales = read('modules/js/sales.js');
const registers = read('modules/js/registers.js');

function loadClient(storage = new Map(), userAgent = 'Electron/40') {
  const requests = [];
  const context = {
    PosnicPro: {}, API_URL: '/api/', navigator: { userAgent },
    window: { crypto: webcrypto, addEventListener() {}, location: { hash: '#/sales/new' } },
    localStorage: {
      getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
    },
    setTimeout() {}, console: { log() {} },
    $: { ajax: (options) => { requests.push(options); return { done() {}, fail() {} }; } },
  };
  vm.runInNewContext(ajax, context);
  const request = () => {
    context.PosnicPro.request({ url: 'sales/sale' }, () => {});
    const header = requests.at(-1).headers['X-Device-Id'];
    return getRequestDeviceId({ headers: { 'x-device-id': header, 'user-agent': userAgent }, ip: 'new-network' });
  };
  return { context, request, requests };
}

test('register identity survives an app update and restart', () => {
  const storage = new Map();
  const before = loadClient(storage, 'Electron/39').request();
  const after = loadClient(storage, 'Electron/40').request();
  assert.equal(after, before);
  assert.notEqual(loadClient(new Map()).request(), before, 'a separate till must have a separate lock');
});

test('a malformed saved device ID is replaced once', () => {
  const client = loadClient(new Map([['posnic_request_device_id', '[object Object]']]));
  const first = client.request();
  assert.equal(client.request(), first);
  assert.match(client.requests[0].headers['X-Device-Id'], /^[a-f0-9]{32}$/);
});

test('unavailable browser storage does not change identity on every request', () => {
  const client = loadClient({ get() { throw new Error('storage blocked'); }, set() { throw new Error('storage blocked'); } }, 'Mozilla/5.0');
  assert.equal(client.request(), client.request());
});

function registerScreen({ moduleOn = true, branchHasNoRegisters = 'false' } = {}) {
  const state = new Map([
    ['branch_id_set', 'branch-1'], ['userRegisterStatus', 'Open'],
    ['register_id', 'register-1'], ['cash_register_id', 'cached-session'],
    ['branch_has_no_registers', branchHasNoRegisters],
  ]);
  const indexed = [];
  const shown = [];
  const requests = [];
  const context = {
    PosnicPro: {
      users: {}, sales: { _loadPriceLists() {} },
      local: { get: (key) => state.get(key), set: (key, value) => state.set(key, value) },
      shiftWidget: { _setting: (key) => key === 'cash_register_enable' ? moduleOn : false },
      i18n: { t: (_, fallback) => fallback }, alert() {},
      get: (params, callback) => requests.push({ params, callback }),
    },
    db: { currentregister: { put: (record) => { indexed.push(record); return Promise.resolve(); } } },
    window: { location: '' },
    $: (selector) => ({ toggle() {}, show() { shown.push([selector, 'show']); }, hide() {},
      find() { return { remove() {} }; }, modal(action) { shown.push([selector, action]); } }),
  };
  const restore = users.slice(users.indexOf('    restoreRegisterSession: function'), users.indexOf('    selectedRegisterActiveBranchUser: function'));
  vm.runInNewContext('PosnicPro.users = {' + restore + '};', context);
  context.PosnicPro.users.fillRegisterSelect = (_, list) => { context.offered = list; };
  const defaults = sales.slice(sales.indexOf('PosnicPro.sales.setSaleDefaults = function'), sales.indexOf('    // For normal new sales'));
  vm.runInNewContext(defaults + '};', context);
  return { context, state, indexed, shown, requests };
}

const openRegister = (resumeRequired) => ({
  open_register: { register_status: 'Opened', resume_required: resumeRequired,
    cash_register_id: 'server-session', register_id: 'register-1', register_name: 'Main' },
  register_data: [{ register_id: 'register-1', register_name: 'Main', in_use: true, in_use_by_me: true }],
});

test('cached Open state is rechecked; a stale lock opens register selection before checkout', () => {
  const screen = registerScreen();
  screen.context.PosnicPro.sales.setSaleDefaults();
  assert.equal(screen.requests.length, 1);
  screen.requests[0].callback({ type: 'success', data: openRegister(true) });
  assert.equal(screen.state.get('userRegisterStatus'), 'Closed');
  assert.equal(screen.indexed.at(-1).register_status, 'closed');
  assert.deepEqual(screen.shown, [['#salesRegisterModal', 'show']]);
  assert.equal(screen.state.get('cash_register_id'), 'cached-session', 'a refused session must not be silently replaced');
});

test('a verified same-device session restores without another opening float or register prompt', () => {
  const screen = registerScreen();
  screen.context.PosnicPro.sales.setSaleDefaults();
  screen.requests[0].callback({ type: 'success', data: openRegister(false) });
  assert.equal(screen.state.get('userRegisterStatus'), 'Open');
  assert.equal(screen.state.get('cash_register_id'), 'server-session');
  assert.equal(screen.indexed.at(-1).register_status, 'open');
  assert.equal(screen.shown.length, 0);
});

test('unverified legacy responses never mark a register ready', () => {
  const screen = registerScreen();
  assert.equal(screen.context.PosnicPro.users.restoreRegisterSession(openRegister(undefined)), false);
});

test('a register response from the previous branch cannot restore its session', () => {
  const screen = registerScreen();
  screen.context.PosnicPro.sales.setSaleDefaults();
  screen.state.set('branch_id_set', 'branch-2');
  screen.requests[0].callback({ type: 'success', data: openRegister(false) });
  assert.equal(screen.indexed.length, 0);
});

test('shops with Cash Register off still go straight to selling', () => {
  const screen = registerScreen({ moduleOn: false });
  screen.context.PosnicPro.sales.setSaleDefaults();
  assert.equal(screen.requests.length, 0);
  assert.equal(screen.shown.length, 0);
});

test('login restores only a verified lock and offers selection for a stale one', () => {
  for (const required of [false, true]) {
    const screen = registerScreen();
    const source = users.slice(users.indexOf('    selectedRegisterActiveBranchUser: function'), users.indexOf('    loginregisterSelectFormSubmit: function'));
    vm.runInNewContext('Object.assign(PosnicPro.users, {' + source + '});', screen.context);
    screen.context.PosnicPro.users.createCookie = () => {};
    screen.context.PosnicPro.users.selectedRegisterActiveBranchUser('branch-1');
    screen.requests[0].callback({ type: 'success', data: openRegister(required) });
    assert.equal(screen.context.window.location, required ? '' : 'dashboard.html#/dashboard');
    assert.equal(screen.state.get('userRegisterStatus'), required ? 'Closed' : 'Open');
    assert.equal(screen.shown.some(([selector]) => selector === '#registerselect_form'), required);
  }
});

test('Cash Register offers Resume even when the browser still remembers Open', () => {
  let rendered = '';
  const context = {
    PosnicPro: { registers: {}, local: { get: () => 'Open' } },
    $: (selector) => ({ text: (value) => ({ html: () => value }), html: (value) => {
      if (selector === '#register_overview_body') rendered = value;
    } }),
  };
  const source = registers.slice(registers.indexOf('    renderOverview: function'), registers.indexOf('    /* Row\'s Open/Resume'));
  vm.runInNewContext('PosnicPro.registers = {' + source + '};', context);
  const row = { register_id: 'r1', register_name: 'Main', in_use: true, in_use_by_me: true };
  context.PosnicPro.registers.renderOverview({ register_data: [{ ...row, resume_required: true }] });
  assert.match(rendered, /Resume/);
  context.PosnicPro.registers.renderOverview({ register_data: [{ ...row, resume_required: false }] });
  assert.doesNotMatch(rendered, /Resume/);
});
