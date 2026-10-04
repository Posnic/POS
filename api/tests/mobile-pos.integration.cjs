'use strict';
/* global document */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
let mongo, db, server, base, mobile, BaseModel, req, user, branch, item, token, snapshot;
const device = { device_id: 'mobile-integration-test', device_model: 'Test phone' };
const sessionStores = new Set();
before(
  async () => {
    mongo = await MongoMemoryServer.create({
      binary: fs.existsSync(path.resolve(__dirname, '../../mongodb/bin/mongod.exe'))
        ? { systemBinary: path.resolve(__dirname, '../../mongodb/bin/mongod.exe') }
        : {},
      instance: { dbName: 'mobile_test' },
    });
    process.env.MONGODB_URI = mongo.getUri();
    await mongoose.connect(process.env.MONGODB_URI);
    db = mongoose.connection.db;
    mobile = require('../src/services/mobile-pos');
    BaseModel = require('../src/models/base.model');
    await BaseModel.getDb();
    const license = new ObjectId(),
      branchId = new ObjectId(),
      userId = new ObjectId();
    branch = {
      _id: branchId,
      license,
      branch_name: 'Mobile test shop',
      sales_prefix: 'M',
      currency_value: [{ currency_text: 'INR' }],
      mobile_pos: {
        enabled: true,
        offlineHours: 24,
        quickSale: true,
        quickTaxBps: 0,
        quickTaxInclusive: true,
        upiAccounts: [
          { id: 'upi1', name: 'Shop bank', vpa: 'shop@bank', active: true, verification: 'manual' },
        ],
        defaultUpiAccountId: 'upi1',
      },
    };
    user = {
      _id: userId,
      license,
      username: 'mobile-test',
      email: 'mobile@example.test',
      activate: true,
      usertype: 'owner',
      password: await require('bcryptjs').hash('test-password', 4),
      branch_access: [{ branch_id: branchId, branch_name: branch.branch_name }],
    };
    item = {
      _id: new ObjectId(),
      license,
      branch_id: branchId,
      name: 'Tea',
      selling_price: 10,
      tax: 5,
      tax_type: 'exclusive',
      plu_code: '12',
      track_inventory: true,
      available_quantity: 100,
    };
    await db.collection('branches').insertOne(branch);
    await db.collection('users').insertOne(user);
    await db.collection('items').insertOne(item);
    req = {
      db,
      user,
      handsetDevice: device.device_id,
      tenantContext: { licenseId: license, branchId },
    };
    BaseModel.license = license;
    BaseModel.currentBranch = branchId;
    const express = require('express'),
      app = express();
    app.get('/api/uploads/mobile-test-image.png', (r, s) => {
      assert.equal(r.headers.authorization, undefined);
      s.type('png').send(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64'
        )
      );
    });
    app.use(express.json());
    app.use((req, res, next) => {
      res.on('finish', () => {
        if (req.sessionStore) sessionStores.add(req.sessionStore);
      });
      next();
    });
    if (process.env.MOBILE_FULL_APP === '1') app.use('/api', require('../app'));
    app.use(require('cookie-parser')());
    app.use(require('../src/middleware/csrf').protect);
    app.use((r, s, n) => {
      r.db = db;
      n();
    });
    app.post('/api/users/kioskMobileLogin', rateLimit({ windowMs: 60000, limit: 30 }), (r, s) =>
      require('../src/controllers/users.controller').kioskMobileLogin(r, s)
    );
    app.use('/api/branch-payments', require('../src/routes/branch-payments.routes'));
    app.use('/api/mobile/v1', require('../src/routes/mobile-pos.routes'));
    app.get('/api/runtime-info', (r, s) =>
      s.json(require('../src/utils/runtime-info').buildRuntimeInfo())
    );
    if (process.env.MOBILE_PREVIEW_DIR) app.use(express.static(process.env.MOBILE_PREVIEW_DIR));
    for (const ext of ['html', 'js', 'css']) {
      app.get('/api/mobile-pos-setup' + (ext === 'html' ? '' : '.' + ext), (r, s) =>
        s.sendFile(path.resolve(__dirname, '../src/routes/mobile-pos-setup.' + ext))
      );
    }
    app.use((e, r, s, n) => {
      s.status(e.statusCode || 500).json({ error: e.message });
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = 'http://127.0.0.1:' + server.address().port + '/api';
  },
  { timeout: 60000 }
);
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  for (const store of sessionStores) {
    if (store._baseStore) await store._baseStore.close();
    for (const nested of store._perShop?.values() || []) await nested.close();
  }
  await mongoose.disconnect();
  if (BaseModel?.mongoClient) await BaseModel.mongoClient.close();
  if (mongo) await mongo.stop();
});

async function call(route, body, credential = token, method) {
  const response = await fetch(base + route, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(credential ? { Authorization: 'Bearer ' + credential } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
function sale(overrides = {}) {
  const id = crypto.randomUUID();
  return {
    id,
    shopId: snapshot.shop.id,
    branchId: String(branch._id),
    staffId: String(user._id),
    snapshotVersion: snapshot.shop.snapshotVersion,
    createdAt: new Date().toISOString(),
    currency: 'INR',
    receipt: 'M001',
    training: false,
    sync: 'pending',
    cart: {
      id: crypto.randomUUID(),
      lines: [
        {
          id: crypto.randomUUID(),
          itemId: String(item._id),
          name: 'Tea',
          quantity: 2,
          price: 1000,
          taxBps: 500,
          taxInclusive: false,
        },
      ],
    },
    total: 2100,
    tax: 100,
    payment: { method: 'cash', received: 2500, change: 400 },
    ...overrides,
  };
}
test('real password login registers phone and downloads live branch catalogue', async () => {
  const login = await call(
    '/users/kioskMobileLogin',
    { username: user.username, password: 'test-password', device },
    null
  );
  assert.equal(login.status, 200, JSON.stringify(login.data));
  token = login.data.token;
  const result = await call('/mobile/v1/bootstrap');
  assert.equal(result.status, 200, JSON.stringify(result.data));
  snapshot = result.data;
  assert.equal(snapshot.items[0].code, '12');
  assert.equal(snapshot.items[0].price, 1000);
  assert.equal(snapshot.shop.capabilities.saleSync, true);
  assert.deepEqual(snapshot.shop.historyPolicy, { days: 90, maxReceipts: 10000 });
});

test('mobile retention settings are validated and delivered in authenticated bootstrap', async () => {
  const original = await call('/mobile/v1/settings');
  const settings = {
    offlineHours: original.data.offlineHours,
    quickSale: original.data.quickSale,
    quickTaxBps: original.data.quickTaxBps,
    quickTaxInclusive: original.data.quickTaxInclusive,
    tillId: original.data.tillId,
  };
  assert.equal(
    (await call('/mobile/v1/settings', { ...settings, historyDays: 0, historyMaxReceipts: 10000 }))
      .status,
    422
  );
  assert.equal(
    (await call('/mobile/v1/settings', { ...settings, historyDays: 30, historyMaxReceipts: 99 }))
      .status,
    422
  );
  assert.equal(
    (await call('/mobile/v1/settings', { ...settings, historyDays: 30, historyMaxReceipts: 5000 }))
      .status,
    200
  );
  const updated = await call('/mobile/v1/bootstrap');
  assert.deepEqual(updated.data.shop.historyPolicy, { days: 30, maxReceipts: 5000 });
  // Legacy clients omit the fields; saving their other settings must preserve policy.
  assert.equal((await call('/mobile/v1/settings', settings)).status, 200);
  assert.equal((await call('/mobile/v1/settings')).data.historyDays, 30);
  await call('/mobile/v1/settings', { ...settings, historyDays: 90, historyMaxReceipts: 10000 });
});
test('mobile photo reading has a separate opt-in and legacy settings preserve it', async () => {
  const options = await call('/mobile/v1/photo-orders/options');
  assert.equal(options.status, 200);
  assert.equal(options.data.enabled, false);
  const current = (await call('/mobile/v1/settings')).data;
  const settings = {
    offlineHours: current.offlineHours,
    quickSale: current.quickSale,
    quickTaxBps: current.quickTaxBps,
    quickTaxInclusive: current.quickTaxInclusive,
    tillId: current.tillId,
  };
  assert.equal((await call('/mobile/v1/settings', { ...settings, photoOrders: true })).status, 200);
  assert.equal((await call('/mobile/v1/photo-orders/options')).data.enabled, true);
  await call('/mobile/v1/settings', settings);
  assert.equal((await call('/mobile/v1/photo-orders/options')).data.enabled, true);
  await call('/mobile/v1/settings', { ...settings, photoOrders: false });
  const denied = await call('/mobile/v1/photo-orders/recognize', {
    id: crypto.randomUUID(),
    original: 'invalid',
  });
  assert.equal(denied.status, 403);
});
test('paid cash sale lands in normal desktop sales and concurrent retry deducts stock once', async () => {
  const s = sale();
  const body = { idempotencyKey: s.id, sale: s };
  const replies = await Promise.all([
    call('/mobile/v1/sales', body),
    call('/mobile/v1/sales', body),
  ]);
  for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(replies[0].data.serverId, replies[1].data.serverId);
  const saved = await db
    .collection('sales')
    .findOne({ _id: new ObjectId(replies[0].data.serverId) });
  assert.equal(saved.sales_total, 21);
  assert.equal(saved.payment_status, 'Paid');
  assert.equal(saved.items[0].item_name, 'Tea');
  assert.equal((await db.collection('items').findOne({ _id: item._id })).available_quantity, 98);
  const changed = await call('/mobile/v1/sales', {
    idempotencyKey: s.id,
    sale: { ...s, total: 2200 },
  });
  assert.equal(changed.status, 409);
  const printed = await call('/mobile/v1/print-jobs', {
    id: 'receipt:' + s.id,
    saleId: s.id,
    document: 'receipt',
  });
  assert.equal(printed.status, 200, JSON.stringify(printed.data));
  const duplicate = await call('/mobile/v1/print-jobs', {
    id: 'receipt:' + s.id,
    saleId: s.id,
    document: 'receipt',
  });
  assert.equal(duplicate.data.id, printed.data.id);
  assert.equal(await db.collection('printjobs').countDocuments(), 1);
  assert.equal((await call('/mobile/v1/print-jobs/' + s.id)).data.state, 'queued');
  for (const status of ['printing', 'needs_attention', 'done', 'failed']) {
    await db
      .collection('printjobs')
      .updateOne({ _id: new ObjectId(printed.data.id) }, { $set: { status } });
    const observed = await call('/mobile/v1/print-jobs/' + s.id);
    assert.equal(observed.status, 200);
    assert.deepEqual(observed.data, { saleId: s.id, state: status });
  }
  assert.equal(await db.collection('printjobs').countDocuments(), 1);
});
test('server interruption after stock effects resumes without another sale or decrement', async () => {
  const s = sale();
  req.body = { idempotencyKey: s.id, sale: s };
  await assert.rejects(
    mobile.ingest(req, {
      afterEffects: async () => {
        throw Error('simulated process failure');
      },
    }),
    /simulated/
  );
  const retry = await mobile.ingest(req);
  assert.ok(retry.serverId);
  assert.equal((await db.collection('items').findOne({ _id: item._id })).available_quantity, 96);
  assert.equal(await db.collection('sales').countDocuments(), 2);
});
test('quick sale, customer and staff-confirmed UPI use configured branch account', async () => {
  const s = sale({
    cart: {
      id: crypto.randomUUID(),
      customer: { id: 'customer-1', name: 'Sample customer', phone: '9876543210' },
      lines: [
        {
          id: crypto.randomUUID(),
          name: 'Quick sale',
          price: 3500,
          quantity: 1,
          taxBps: 0,
          taxInclusive: true,
        },
      ],
    },
    total: 3500,
    tax: 0,
    payment: {
      method: 'upi',
      account: snapshot.shop.upiAccounts[0],
      status: 'staff-confirmed',
      reference: 'test',
    },
  });
  const r = await call('/mobile/v1/sales', { idempotencyKey: s.id, sale: s });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await db.collection('customers').countDocuments(), 1);
  const saved = await db.collection('sales').findOne({ _id: new ObjectId(r.data.serverId) });
  assert.equal(saved.payment_mode, 'Upi');
  assert.equal(saved.sales_total, 35);
});
test('tampered prices, expired grant, foreign branch and missing auth are refused', async () => {
  let s = sale();
  s.cart.lines[0].price = 1;
  assert.equal((await call('/mobile/v1/sales', { idempotencyKey: s.id, sale: s })).status, 409);
  s = sale({ branchId: String(new ObjectId()) });
  assert.equal((await call('/mobile/v1/sales', { idempotencyKey: s.id, sale: s })).status, 403);
  s = sale({ createdAt: new Date(Date.now() + 48 * 3600000).toISOString() });
  assert.equal((await call('/mobile/v1/sales', { idempotencyKey: s.id, sale: s })).status, 409);
  assert.equal((await call('/mobile/v1/bootstrap', undefined, null)).status, 401);
});
test('held prices remain valid after a catalogue refresh', async () => {
  const s = sale();
  s.cart.lines[0].snapshotVersion = snapshot.shop.snapshotVersion;
  await db.collection('items').updateOne({ _id: item._id }, { $set: { selling_price: 12 } });
  const refreshed = await call('/mobile/v1/bootstrap');
  assert.equal(refreshed.status, 200);
  s.snapshotVersion = refreshed.data.shop.snapshotVersion;
  const result = await call('/mobile/v1/sales', { idempotencyKey: s.id, sale: s });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const saved = await db.collection('sales').findOne({ _id: new ObjectId(result.data.serverId) });
  assert.equal(saved.sales_total, 21);
  assert.equal(await db.collection('stocklogs').countDocuments(), 3);
});
test('cashier permissions and device revocation are enforced by the server', async () => {
  const staff = {
    ...user,
    _id: new ObjectId(),
    username: 'cashier-test',
    email: 'cashier@example.test',
    usertype: 'custom',
    access: { sales: { read: true, write: true }, pos: { quick_sale: false } },
  };
  await db.collection('users').insertOne(staff);
  const login = await call(
    '/users/kioskMobileLogin',
    {
      username: staff.username,
      password: 'test-password',
      device: { device_id: 'cashier-phone-123' },
    },
    null
  );
  assert.equal(login.status, 200);
  const result = await call('/mobile/v1/bootstrap', undefined, login.data.token);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.shop.permissions.quickSale, false);
  assert.equal(result.data.shop.permissions.customerWrite, false);
  assert.equal(result.data.shop.permissions.receiptPrint, false);
  assert.equal(result.data.shop.permissions.voidLine, false);
  assert.equal(
    (
      await call(
        '/mobile/v1/print-jobs',
        {
          id: 'denied-print-test',
          document: 'test',
        },
        login.data.token
      )
    ).status,
    403
  );
  assert.equal(
    (await call('/mobile/v1/settings', { enabled: true }, login.data.token)).status,
    403
  );
  assert.equal(
    (await call('/mobile/v1/devices/revoke', { device: 'cashier-phone-123' })).status,
    200
  );
  assert.equal((await call('/mobile/v1/bootstrap', undefined, login.data.token)).status, 403);
});
test('cloud authorization is bound to the approved phone and proof and is consumed once', async () => {
  const code = 'AABB1122CCDD',
    verifier = 'v'.repeat(43);
  await db.collection('mobile_pair_codes').insertOne({
    _id: mobile.hash(code),
    userId: user._id,
    branchId: branch._id,
    license: branch.license,
    expires: new Date(Date.now() + 60000),
    deviceId: 'cloud-phone-123',
    codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  });
  const payload = { code, codeVerifier: verifier, device: { device_id: 'cloud-phone-123' } };
  assert.equal(
    (await call('/mobile/v1/pair', { ...payload, codeVerifier: 'x'.repeat(43) }, null)).status,
    401
  );
  assert.equal((await call('/mobile/v1/pair', { ...payload, device }, null)).status, 401);
  const pair = await call('/mobile/v1/pair', payload, null);
  assert.equal(pair.status, 200, JSON.stringify(pair.data));
  assert.equal((await call('/mobile/v1/bootstrap', undefined, pair.data.token)).status, 200);
  assert.equal((await call('/mobile/v1/pair', payload, null)).status, 401);
});

test('pairing code is single use and branch switch disables new mobile activity', async () => {
  const code = await call('/mobile/v1/pair-codes', {});
  assert.equal(code.status, 200, JSON.stringify(code.data));
  const pair = await call(
    '/mobile/v1/pair',
    { code: code.data.code, device: { device_id: 'paired-phone-123' } },
    null
  );
  assert.equal(pair.status, 200, JSON.stringify(pair.data));
  assert.equal((await call('/mobile/v1/bootstrap', undefined, pair.data.token)).status, 200);
  assert.equal((await call('/mobile/v1/pair', { code: code.data.code, device }, null)).status, 401);
  const config = await call('/mobile/v1/settings');
  assert.equal(config.status, 200);
  const Setting = require('../src/models/setting.model');
  const model = new Setting();
  model.setContext({ branchId: branch._id, licenseId: branch.license, user });
  assert.equal(
    (await model.updateBranchModules(branch._id, { module_mobile_pos_enable: false })).status,
    true
  );
  assert.equal((await call('/mobile/v1/bootstrap')).status, 403);
});
test(
  'desktop setup works with the real login cookie and CSRF protection',
  { skip: !process.env.MOBILE_PLAYWRIGHT_PATH },
  async () => {
    const { chromium } = require(process.env.MOBILE_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1050, height: 900 } });
      await context.addCookies([
        { name: 'jwt', value: token, url: base, httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + '/mobile-pos-setup');
      await page.locator('#settings').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#enabled').count(), 0);
      assert.match(await page.locator('#feature-status').innerText(), /off/);
      await db
        .collection('branches')
        .updateOne({ _id: branch._id }, { $set: { module_mobile_pos_enable: true } });
      await page.reload();
      await page.locator('#settings').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
      await page.getByRole('button', { name: 'Generate pairing code' }).click();
      await page.waitForFunction(() => document.getElementById('code').textContent.length > 8);
      await page
        .getByRole('img', { name: 'Scan to authorize the selected staff account' })
        .waitFor();
      await page.screenshot({
        path: path.resolve(__dirname, '../../tmp/mobile-pos-desktop-setup.png'),
        fullPage: true,
      });
      await page.reload();
      await page.locator('#settings').waitFor({ state: 'visible' });
      assert.match(await page.locator('#feature-status').innerText(), /enabled/);
      await page.goto(base + '/mobile-pos-setup?view=payments');
      await page.locator('#settings').waitFor({ state: 'visible' });
      await page.locator('.name').first().fill('Shared branch bank');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
      const payments = await call('/branch-payments');
      assert.equal(payments.data.upiAccounts[0].name, 'Shared branch bank');
      assert.equal(
        (await call('/mobile/v1/bootstrap')).data.shop.upiAccounts[0].name,
        'Shared branch bank'
      );
      await page.screenshot({
        path: path.resolve(__dirname, '../../tmp/branch-payments.png'),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  }
);

test(
  'real mobile UI signs in, sells offline, then synchronizes to desktop sales',
  { skip: !process.env.MOBILE_PREVIEW_DIR || !process.env.MOBILE_PLAYWRIGHT_PATH },
  async () => {
    const { chromium, expect } = require(
      process.env.MOBILE_PLAYWRIGHT_PATH.replace(/playwright$/, '@playwright/test')
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('requestfailed', (r) =>
        console.log('REQUEST FAILED', r.url(), r.failure()?.errorText)
      );
      page.on('response', async (r) => {
        if (r.url().includes('/api/'))
          console.log(
            'API RESPONSE',
            r.status(),
            r.url(),
            r.status() >= 400 ? await r.text().catch(() => '[navigation completed]') : ''
          );
      });
      await db.collection('items').updateOne(
        { _id: item._id },
        {
          $set: { image: '/uploads/mobile-test-image.png' },
        }
      );
      await page.goto(base.replace(/\/api$/, '/'));
      await page
        .getByRole('button', { name: 'Connect a local or Community shop', exact: true })
        .click();
      await page.getByTestId('manual-server').click();
      await page.getByTestId('server-input').fill(base);
      await page.getByTestId('choose-server-next').click();
      await page.getByRole('textbox', { name: 'Username', exact: true }).fill(user.username);
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      try {
        await page
          .getByRole('textbox', { name: 'PIN', exact: true })
          .fill('4829', { timeout: 8000 });
      } catch (e) {
        console.log('MOBILE UI:', await page.locator('body').innerText());
        await page.screenshot({
          path: path.resolve(__dirname, '../../tmp/mobile-pos-signin-error.png'),
        });
        throw e;
      }
      await page.getByRole('textbox', { name: 'Confirm PIN', exact: true }).fill('4829');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const product = page.getByTestId('item-' + String(item._id));
      await expect(product.locator('img')).toHaveAttribute('src', /^data:image\/png/);
      await page.getByTestId('item-' + String(item._id)).click();
      const before = await db.collection('sales').countDocuments();
      await context.setOffline(true);
      await page.getByTestId('view-cart').click();
      await page.getByTestId('take-payment').click();
      await page.getByRole('button', { name: /^Cash ·/ }).click();
      await page.getByTestId('cash-received').fill('20');
      await page.getByTestId('finish-cash').click();
      await expect(page.getByRole('heading', { name: 'Sale saved' })).toBeVisible();
      assert.equal(await db.collection('sales').countDocuments(), before);
      await context.setOffline(false);
      await expect
        .poll(async () => db.collection('sales').countDocuments(), { timeout: 45000 })
        .toBe(before + 1);
      const saved = await db.collection('sales').findOne({ sales_total: 12.6 });
      assert.ok(saved);
      assert.equal(saved.payment_mode, 'Cash');
      await page.screenshot({
        path: path.resolve(__dirname, '../../tmp/mobile-pos-live-sale.png'),
      });
      const receiptNumber = await page.getByTestId('receipt-number').innerText();
      const cloudIntent = await db
        .collection('mobile_sales')
        .findOne({ 'sale.receipt': receiptNumber });
      await db.collection('mobile_cloud_capabilities').insertOne({
        _id: 'delivery:' + String(branch.license),
        protocol: 1,
        authority: 'test-gateway',
      });
      await db.collection('mobile_cloud_receipts').insertOne({
        _id: 'mobile:' + cloudIntent._id,
        saleId: String(cloudIntent.serverId),
        branchId: String(branch._id),
        authority: 'test-gateway',
        receivedAt: new Date().toISOString(),
      });
      await page.getByRole('button', { name: 'Connection & sync', exact: true }).click();
      const delivery = page.waitForResponse((response) =>
        response.url().endsWith('/mobile/v1/delivery-status')
      );
      await page.getByRole('button', { name: 'Sync now', exact: true }).click();
      assert.equal((await (await delivery).json()).receipts.length, 1);
      await expect(page.getByText('Received in cloud', { exact: true })).toBeVisible();
      await page.screenshot({
        path: path.resolve(__dirname, '../../tmp/mobile-cloud-delivery.png'),
      });
      await page.getByRole('tab', { name: 'Receipts', exact: true }).click();
      await page.getByText('Find an older receipt', { exact: true }).click();
      await page.getByRole('textbox').fill(receiptNumber);
      await page.getByRole('button', { name: 'Find an older receipt', exact: true }).click();
      await page.getByRole('button', { name: receiptNumber, exact: true }).click();
      await expect(page.getByRole('heading', { name: receiptNumber, exact: true })).toBeVisible();
      await page.screenshot({
        path: path.resolve(__dirname, '../../tmp/mobile-server-receipt.png'),
      });
      // Web preview intentionally never persists bearer/PIN secrets. Reload with
      // API/image access unavailable verifies the durable non-secret image cache.
      await page.route('**/api/**', (route) => route.abort());
      await page.reload();
      await expect(product.locator('img')).toHaveAttribute('src', /^data:image\/png/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await db.collection('mobile_cloud_receipts').deleteMany({});
      await db.collection('mobile_cloud_capabilities').deleteMany({});
    }
  }
);

test('branch payments migrate legacy data and mobile settings cannot overwrite features or payments', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { module_mobile_pos_enable: true } });
  const original = await call('/branch-payments');
  assert.equal(original.status, 200);
  assert.equal(
    (await call('/branch-payments', { ...original.data, defaultUpiAccountId: 'missing' })).status,
    422
  );
  const accounts = {
    upiAccounts: [{ id: 'shared', name: 'Branch bank', vpa: 'branch@bank' }],
    defaultUpiAccountId: 'shared',
  };
  assert.equal((await call('/branch-payments', accounts)).status, 200);
  const config = (await call('/mobile/v1/settings')).data;
  assert.equal(
    (
      await call('/mobile/v1/settings', {
        ...config,
        enabled: false,
        upiAccounts: [],
        defaultUpiAccountId: '',
      })
    ).status,
    200
  );
  const updated = await db.collection('branches').findOne({ _id: branch._id });
  assert.equal(updated.module_mobile_pos_enable, true);
  assert.equal(updated.mobile_pos.upiAccounts, undefined);
  assert.equal(updated.payment_settings.defaultUpiAccountId, 'shared');
  assert.equal((await call('/mobile/v1/bootstrap')).data.shop.defaultUpiAccountId, 'shared');
});

for (const useLocal of [false, true])
  test(
    'account-first mobile UI reaches PIN using ' +
      (useLocal ? 'the authenticated LAN till' : 'the cloud shop'),
    { skip: !process.env.MOBILE_PREVIEW_DIR || !process.env.MOBILE_PLAYWRIGHT_PATH },
    async () => {
      const { chromium, expect } = require(
        process.env.MOBILE_PLAYWRIGHT_PATH.replace(/playwright$/, '@playwright/test')
      );
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        let request, pairedAt;
        const code = useLocal ? '112233445566' : 'ABCDEF123456';
        const enrolmentId = crypto.randomUUID();
        await context.route('https://www.posnic.com/api/mobile/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/authorize'))
            return route.fulfill({ contentType: 'text/html', body: '<p>Approved test device</p>' });
          const body = route.request().postDataJSON();
          if (path.endsWith('/requests')) {
            request = body;
            return route.fulfill({
              json: {
                request: 'r'.repeat(43),
                expiresIn: 900,
                authorizationUrl:
                  'https://www.posnic.com/api/mobile/authorize?request=' + 'r'.repeat(43),
              },
            });
          }
          assert.equal(
            crypto.createHash('sha256').update(body.codeVerifier).digest('base64url'),
            request.codeChallenge
          );
          await db.collection('mobile_pair_codes').insertOne({
            _id: mobile.hash(code),
            enrolmentId,
            userId: user._id,
            branchId: branch._id,
            license: branch.license,
            expires: new Date(Date.now() + 60000),
            deviceId: request.deviceId,
            codeChallenge: request.codeChallenge,
          });
          return route.fulfill({
            json: {
              baseUrl: 'https://mobile-test.example/api',
              code,
              localServers: useLocal
                ? [
                    {
                      name: 'Nearby till',
                      addresses: ['http://192.168.50.4:42590/api'],
                      code,
                      enrolmentId,
                    },
                  ]
                : [],
            },
          });
        });
        await context.route(
          /^(https:\/\/mobile-test\.example|http:\/\/192\.168\.50\.4:42590)\/api\//,
          async (route) => {
            const r = route.request();
            if (r.url().endsWith('/pair')) pairedAt = new URL(r.url()).hostname;
            const response = await fetch(base + new URL(r.url()).pathname.replace(/^\/api/, ''), {
              method: r.method(),
              headers: {
                'content-type': 'application/json',
                ...(r.headers().authorization ? { authorization: r.headers().authorization } : {}),
              },
              body: r.postData() || undefined,
            });
            await route.fulfill({
              status: response.status,
              contentType: 'application/json',
              body: await response.text(),
            });
          }
        );
        const page = await context.newPage();
        await page.goto(base.replace(/\/api$/, '/'));
        await expect(page.getByTestId('server-input')).toHaveCount(0);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'PIN', exact: true })).toBeVisible({
          timeout: 15000,
        });
        assert.equal(request.intent, 'login');
        assert.equal(pairedAt, useLocal ? '192.168.50.4' : 'mobile-test.example');
      } finally {
        await browser.close();
      }
    }
  );

test(
  'Features API persists Mobile POS independently and branch read returns the saved switch',
  { skip: process.env.MOBILE_FULL_APP !== '1' },
  async () => {
    const result = await call(
      '/setting/updateCommonSettings',
      {
        module_mobile_pos_enable: 'false',
        module_captain_enable: 'true',
        sales_prefix: 'M',
        receiving_prefix: 'R',
      },
      token,
      'PUT'
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const read = await call('/branches/getOneStore?id=' + branch._id);
    assert.equal(read.status, 200, JSON.stringify(read.data));
    assert.equal(read.data.data.module_mobile_pos_enable, false);
    assert.equal(read.data.data.module_captain_enable, true);
    assert.equal((await call('/mobile/v1/bootstrap')).status, 403);
    const payments = await call('/branch-payments');
    assert.equal(payments.data.defaultUpiAccountId, 'shared');
    const enabled = await call(
      '/setting/updateCommonSettings',
      { modules_only: true, module_mobile_pos_enable: true },
      token,
      'PUT'
    );
    assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
    assert.equal((await call('/mobile/v1/bootstrap')).status, 200);
  }
);

test('manager denials and current user overrides protect mobile bootstrap and ingestion', async () => {
  const restricted = {
    ...user,
    usertype: 'manager',
    access: {
      sales: { write: true },
      customer: { write: false },
      pos: { quick_sale: false, void_line: false, reprint_receipt: false },
    },
  };
  const staffReq = { ...req, user: restricted };
  const result = await mobile.bootstrap(staffReq);
  assert.equal(result.shop.permissions.quickSale, false);
  assert.equal(result.shop.permissions.customerWrite, false);
  assert.equal(result.shop.permissions.voidLine, false);
  assert.equal(result.shop.permissions.receiptPrint, false);
  // A previously issued owner snapshot must not bypass current user denials.
  const quick = sale();
  delete quick.cart.lines[0].itemId;
  const customers = sale();
  customers.cart.customer = { id: 'test-customer', name: 'Test', phone: '' };
  const count = await db.collection('mobile_sales').countDocuments();
  await assert.rejects(
    () => mobile.ingest({ ...staffReq, body: { idempotencyKey: quick.id, sale: quick } }),
    /Quick sales are not permitted/
  );
  await assert.rejects(
    () => mobile.ingest({ ...staffReq, body: { idempotencyKey: customers.id, sale: customers } }),
    /Customer creation is not permitted/
  );
  assert.equal(await db.collection('mobile_sales').countDocuments(), count);
  await assert.rejects(
    () =>
      mobile.bootstrap({
        ...staffReq,
        user: { ...restricted, access: { sales: { write: false } } },
      }),
    /cannot sell/
  );
});

test('a shared device cannot print another staff member receipt', async () => {
  const saleId = crypto.randomUUID();
  await db.collection('mobile_sales').insertOne({
    _id: mobile.hash(
      [String(branch.license), String(branch._id), device.device_id, saleId].join(':')
    ),
    state: 'complete',
    userId: new ObjectId(),
    serverId: new ObjectId(),
  });
  const result = await call('/mobile/v1/print-jobs', {
    id: 'receipt:' + saleId,
    saleId,
    document: 'receipt',
  });
  assert.equal(result.status, 409);
  assert.equal((await call('/mobile/v1/print-jobs/' + saleId)).status, 404);
});

test('owner pairs the selected staff identity without transferring owner privileges', async () => {
  const cashier = {
    ...user,
    _id: new ObjectId(),
    usertype: 'custom',
    username: 'pilot-cashier',
    email: 'pilot@example.test',
    access: { sales: { write: true }, pos: { quick_sale: false, reprint_receipt: false } },
  };
  await db.collection('users').insertOne(cashier);
  const settings = await call('/mobile/v1/settings');
  assert.ok(settings.data.pairingStaff.some((s) => s.id === String(cashier._id)));
  const issued = await call('/mobile/v1/pair-codes', { staffId: String(cashier._id) });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  assert.equal(issued.data.staffId, String(cashier._id));
  const paired = await call(
    '/mobile/v1/pair',
    { code: issued.data.code, device: { device_id: 'staff-pair-pilot' } },
    null
  );
  assert.equal(paired.status, 200);
  const bootstrap = await call('/mobile/v1/bootstrap', undefined, paired.data.token);
  assert.equal(bootstrap.data.shop.staffId, String(cashier._id));
  assert.equal(bootstrap.data.shop.permissions.quickSale, false);
  assert.equal(bootstrap.data.shop.permissions.receiptPrint, false);
  assert.equal(
    (await call('/mobile/v1/pair-codes', { staffId: String(user._id) }, paired.data.token)).status,
    403
  );
  const foreign = {
    ...cashier,
    _id: new ObjectId(),
    license: new ObjectId(),
    username: 'foreign-pilot',
    email: 'foreign-pilot@example.test',
  };
  await db.collection('users').insertOne(foreign);
  assert.equal((await call('/mobile/v1/pair-codes', { staffId: String(foreign._id) })).status, 403);
  await db.collection('users').updateOne({ _id: cashier._id }, { $set: { branch_access: [] } });
  assert.equal((await call('/mobile/v1/pair-codes', { staffId: String(cashier._id) })).status, 403);
});

test('older receipt search is literal, paginated and limited to the cashier and branch', async () => {
  const prefix = 'receipt-lookup-';
  const ids = [];
  for (let n = 0; n < 53; n++) {
    const key = mobile.hash(prefix + n);
    ids.push(key);
    await db.collection('mobile_sales').insertOne({
      _id: key,
      license: branch.license,
      branchId: branch._id,
      userId: user._id,
      state: 'complete',
      created: new Date(1700000000000 + n),
      sale: sale({ receipt: prefix + '[literal].' + n }),
      serverId: new ObjectId(),
    });
  }
  const foreign = mobile.hash(prefix + 'foreign');
  ids.push(foreign);
  await db.collection('mobile_sales').insertOne({
    _id: foreign,
    license: branch.license,
    branchId: branch._id,
    userId: new ObjectId(),
    state: 'complete',
    created: new Date(),
    sale: sale({ receipt: prefix + '[literal].secret' }),
    serverId: new ObjectId(),
  });
  try {
    const first = await mobile.receipts({ ...req, query: { q: prefix + '[literal].' } });
    assert.equal(first.receipts.length, 50);
    assert.equal(first.receipts[0].receipt, prefix + '[literal].52');
    assert.ok(first.next);
    const second = await mobile.receipts({
      ...req,
      query: { q: prefix + '[literal].', before: first.next },
    });
    assert.equal(second.receipts.length, 3);
    assert.equal(second.next, null);
    assert.equal(new Set([...first.receipts, ...second.receipts].map((r) => r.id)).size, 53);
    assert.ok(!first.receipts.some((r) => r.receipt.includes('secret')));
    const none = await mobile.receipts({ ...req, query: { q: prefix + '.*' } });
    assert.equal(none.receipts.length, 0);
    await assert.rejects(mobile.receipts({ ...req, query: { before: 'bad' } }), /Invalid receipt/);
    await assert.rejects(
      mobile.receipts({ ...req, handsetDevice: null, query: {} }),
      /Receipt access/
    );
    await assert.rejects(
      mobile.receipts({ ...req, user: { ...user, usertype: 'staff', access: {} }, query: {} }),
      /Receipt access/
    );
  } finally {
    await db.collection('mobile_sales').deleteMany({ _id: { $in: ids } });
  }
});

test('paged catalogue exceeds 10k items, remains immutable, and binds pages to the authorized device', async () => {
  const added = Array.from({ length: 10017 }, (_, n) => ({
    _id: new ObjectId(),
    license: branch.license,
    branch_id: branch._id,
    name: 'Paged item ' + n,
    selling_price: 10,
    tax: 0,
    activate: true,
  }));
  await db.collection('items').insertMany(added);
  try {
    const first = await mobile.bootstrap({ ...req, query: { catalogue: 'paged' } });
    assert.ok(first.catalogue.count > 10000);
    assert.equal(
      first.catalogue.pages.reduce((n, p) => n + p.count, 0),
      first.catalogue.count
    );
    const grant = await db.collection('mobile_grants').findOne({ _id: first.shop.snapshotVersion });
    assert.equal(grant.items, undefined);
    assert.ok(grant.pages.length > 39);
    const params = { version: first.shop.snapshotVersion, page: '0' };
    const page = await mobile.cataloguePage({ ...req, params });
    assert.ok(page.items.length <= 256);
    await assert.rejects(
      mobile.cataloguePage({ ...req, params, handsetDevice: 'other-device' }),
      /Refresh the catalogue/
    );
    const target = added[0];
    const originalPrice = (
      await require('../src/services/mobile-catalogue').hydrate(db, grant, [String(target._id)])
    ).items[0].price;
    await db.collection('items').updateOne({ _id: target._id }, { $set: { selling_price: 20 } });
    const unchanged = (
      await require('../src/services/mobile-catalogue').hydrate(db, grant, [String(target._id)])
    ).items[0].price;
    assert.equal(unchanged, originalPrice);
    const fresh = await mobile.bootstrap({ ...req, query: { catalogue: 'paged' } });
    assert.notEqual(fresh.shop.snapshotVersion, first.shop.snapshotVersion);
    assert.ok(
      fresh.catalogue.pages.filter((p, index) => p.id === first.catalogue.pages[index]?.id).length >
        38
    );
    const transaction = sale({
      snapshotVersion: first.shop.snapshotVersion,
      total: 1000,
      tax: 0,
      cart: {
        id: crypto.randomUUID(),
        lines: [
          {
            id: crypto.randomUUID(),
            itemId: String(target._id),
            name: target.name,
            quantity: 1,
            price: 1000,
            taxBps: 0,
            taxInclusive: false,
          },
        ],
      },
      payment: { method: 'cash', received: 1000, change: 0 },
    });
    const accepted = await mobile.ingest({
      ...req,
      body: { idempotencyKey: transaction.id, sale: transaction },
    });
    assert.equal(accepted.saleId, transaction.id);
    await db.collection('items').updateOne({ _id: target._id }, { $set: { is_deleted: true } });
    const deleted = await mobile.bootstrap({ ...req, query: { catalogue: 'paged' } });
    assert.equal(deleted.catalogue.count, first.catalogue.count - 1);
  } finally {
    await db.collection('items').deleteMany({ _id: { $in: added.map((row) => row._id) } });
  }
});

test('cloud delivery requires explicit matching evidence and stays scoped to its issuing device', async () => {
  const intent = await db
    .collection('mobile_sales')
    .findOne({ userId: user._id, branchId: branch._id, state: 'complete' });
  const paid = intent.sale;
  const ack = intent.ack;
  const query = { ...req, body: { ids: [paid.id] } };
  assert.equal((await mobile.deliveryStatus(query)).available, false);
  const cap = {
    _id: 'delivery:' + String(branch.license),
    protocol: 1,
    authority: 'verified-gateway',
  };
  const proof = {
    _id: 'mobile:' + intent._id,
    saleId: ack.serverId,
    branchId: String(branch._id),
    authority: cap.authority,
    receivedAt: new Date().toISOString(),
  };
  try {
    await db.collection('mobile_cloud_capabilities').insertOne(cap);
    assert.deepEqual((await mobile.deliveryStatus(query)).receipts, []);
    await db.collection('mobile_cloud_receipts').insertOne({ ...proof, branchId: 'other' });
    assert.deepEqual((await mobile.deliveryStatus(query)).receipts, []);
    await db
      .collection('mobile_cloud_receipts')
      .updateOne({ _id: proof._id }, { $set: { branchId: proof.branchId, saleId: 'wrong' } });
    assert.deepEqual((await mobile.deliveryStatus(query)).receipts, []);
    await db.collection('mobile_cloud_receipts').updateOne({ _id: proof._id }, { $set: proof });
    assert.deepEqual((await mobile.deliveryStatus(query)).receipts, [
      { id: paid.id, serverId: ack.serverId, receivedAt: proof.receivedAt },
    ]);
    assert.deepEqual(
      (await mobile.deliveryStatus({ ...query, handsetDevice: 'other-device' })).receipts,
      []
    );
    assert.deepEqual(
      (await mobile.deliveryStatus({ ...query, user: { ...user, _id: new ObjectId() } })).receipts,
      []
    );
    assert.equal((await mobile.bootstrap(req)).shop.capabilities.cloudDelivery, true);
  } finally {
    await db.collection('mobile_cloud_receipts').deleteOne({ _id: proof._id });
    await db.collection('mobile_cloud_capabilities').deleteOne({ _id: cap._id });
  }
});

test('weighed items opt in to fixed quantities and replay has one stock effect', async () => {
  assert.equal(mobile.mapItem({ ...item, open_price: true }).requiresConfiguration, true);
  const weighted = {
    ...item,
    _id: new ObjectId(),
    name: 'Weighed rice',
    selling_price: 12.35,
    tax: 5,
    tax_type: 'exclusive',
    item_weight_machine_based: true,
    unit: 'kg',
    available_quantity: 10,
  };
  await db.collection('items').insertOne(weighted);
  try {
    const legacy = await mobile.bootstrap(req);
    assert.equal(
      legacy.items.find((row) => row.id === String(weighted._id)).requiresConfiguration,
      true
    );
    const modern = await mobile.bootstrap({ ...req, query: { quantity: 'fixed3' } });
    const product = modern.items.find((row) => row.id === String(weighted._id));
    assert.equal(product.requiresConfiguration, false);
    assert.equal(product.quantityScale, 1000);
    const transaction = sale({
      snapshotVersion: modern.shop.snapshotVersion,
      total: 162,
      tax: 8,
      cart: {
        id: crypto.randomUUID(),
        lines: [
          {
            id: crypto.randomUUID(),
            itemId: product.id,
            name: product.name,
            price: 1235,
            taxBps: 500,
            taxInclusive: false,
            quantity: 0.125,
            quantityScale: 1000,
            unit: 'kg',
          },
        ],
      },
      payment: { method: 'cash', received: 200, change: 38 },
    });
    const send = (paid) => mobile.ingest({ ...req, body: { idempotencyKey: paid.id, sale: paid } });
    const wrong = {
      ...transaction,
      id: crypto.randomUUID(),
      snapshotVersion: legacy.shop.snapshotVersion,
    };
    await assert.rejects(send(wrong), /catalogue/);
    const precision = {
      ...transaction,
      id: crypto.randomUUID(),
      cart: { ...transaction.cart, lines: [{ ...transaction.cart.lines[0], quantity: 0.1251 }] },
    };
    await assert.rejects(send(precision), /Quantity/);
    const ordinary = modern.items.find((row) => row.id === String(item._id));
    const forged = {
      ...transaction,
      id: crypto.randomUUID(),
      cart: {
        ...transaction.cart,
        lines: [
          {
            ...transaction.cart.lines[0],
            itemId: ordinary.id,
            price: ordinary.price,
            name: ordinary.name,
            taxBps: ordinary.taxBps,
            taxInclusive: ordinary.taxInclusive,
          },
        ],
      },
    };
    await assert.rejects(send(forged), /Quantity/);
    const ack = await send(transaction);
    assert.deepEqual(await send(transaction), ack);
    assert.equal(
      (await db.collection('items').findOne({ _id: weighted._id })).available_quantity,
      9.875
    );
    const stored = await db.collection('sales').findOne({ _id: new ObjectId(ack.serverId) });
    const line = stored.items[0];
    assert.equal(line.item_quantity, 0.125);
    assert.equal(line.item_unit, 'kg');
    assert.equal(line.total_amount, 1.62);
  } finally {
    await db.collection('items').deleteOne({ _id: weighted._id });
  }
});

test('cloud pair uses the scoped shop database and cannot consume another shop code', async () => {
  const express = require('express');
  const { enableMultiTenant, runWithTenant } = require('../src/db/tenant-context');
  const connection = mongoose.connection.useDb('mobile_cloud_pair_test', { useCache: true });
  const shopDb = connection.db;
  const code = 'ABCD99887766',
    verifier = 'p'.repeat(43);
  await shopDb.collection('users').insertOne({ ...user, usertype: 'owner', activate: true });
  await shopDb.collection('branches').insertOne({ ...branch, module_mobile_pos_enable: true });
  await shopDb.collection('mobile_pair_codes').insertOne({
    _id: mobile.hash(code),
    userId: user._id,
    branchId: branch._id,
    license: branch.license,
    expires: new Date(Date.now() + 60000),
    deviceId: 'cloud-scoped-phone',
    codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  });
  const app = express();
  app.use(express.json());
  app.use((r, s, next) => {
    const selected = r.headers['x-test-shop'] === 'correct' ? connection : mongoose.connection;
    runWithTenant(
      { db: selected.db, connection: selected, secrets: { JWT_SECRET: process.env.JWT_SECRET } },
      next
    );
  });
  app.use(require('../src/db/request-db').attachDb);
  app.use('/mobile/v1', require('../src/routes/mobile-pos.routes'));
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  enableMultiTenant();
  try {
    const send = (shop) =>
      fetch('http://127.0.0.1:' + srv.address().port + '/mobile/v1/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-shop': shop },
        body: JSON.stringify({
          code,
          codeVerifier: verifier,
          device: { device_id: 'cloud-scoped-phone' },
        }),
      });
    assert.equal((await send('wrong')).status, 401);
    assert.equal(
      (await shopDb.collection('mobile_pair_codes').findOne({ _id: mobile.hash(code) })).usedAt,
      undefined
    );
    const paired = await send('correct');
    assert.equal(paired.status, 200, await paired.text());
    assert.ok(
      (await shopDb.collection('mobile_pair_codes').findOne({ _id: mobile.hash(code) })).usedAt
    );
    assert.equal((await send('correct')).status, 401);
  } finally {
    enableMultiTenant(false);
    await new Promise((resolve) => srv.close(resolve));
    await shopDb.dropDatabase();
  }
});
