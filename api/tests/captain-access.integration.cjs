'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'),
  crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const access = require('../src/services/captain-access');
let mongo, db, manager, staff, branch, req, server, base;
before(async () => {
  const binary = require('node:path').resolve(__dirname, '../../mongodb/bin/mongod.exe');
  mongo = await MongoMemoryServer.create({
    binary: require('node:fs').existsSync(binary) ? { systemBinary: binary } : {},
  });
  process.env.MONGODB_URI = mongo.getUri('captain_test');
  await mongoose.connect(process.env.MONGODB_URI);
  db = mongoose.connection.db;
  const license = new ObjectId();
  branch = { _id: new ObjectId(), license, branch_name: 'Test shop', module_captain_enable: true };
  manager = {
    _id: new ObjectId(),
    license,
    activate: true,
    usertype: 'owner',
    branch_id: branch._id,
  };
  staff = {
    _id: new ObjectId(),
    license,
    activate: true,
    username: 'Waiter',
    branch_id: branch._id,
    access: { sales: { write: true } },
    authVersion: 2,
  };
  manager.branch_access = staff.branch_access = [
    { branch_id: branch._id, branch_name: branch.branch_name },
  ];
  await db.collection('users').insertMany([manager, staff]);
  await db.collection('branches').insertOne(branch);
  req = {
    db,
    user: manager,
    tenantContext: { branchId: branch._id, licenseId: license },
    body: { staffId: String(staff._id) },
    ip: '127.0.0.1',
  };
  const express = require('express'),
    app = express();
  app.use(express.json());
  // lgtm[js/missing-token-validation] The real csrf.protect middleware below validates
  // credential-bound CSRF tokens before these test routes; cookie pairing is tested below.
  app.use(require('cookie-parser')());
  app.use(
    require('express-session')({
      secret: crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(require('../src/middleware/csrf').protect);
  app.use((r, _s, next) => {
    r.db = db;
    next();
  });
  app.use('/api/captain/v1', require('../src/routes/captain-access.routes'));
  const { protect, optionalProtect } = require('../src/middleware/auth');
  const paymentTestLimit = require('express-rate-limit')({windowMs:60000,limit:180});
  app.get('/api/sales/guestBills/table', paymentTestLimit, protect, (_r, s) => s.json({ allowed: true }));
  app.post('/api/sales/tablePayments/record', paymentTestLimit, protect, (_r, s) => s.json({ allowed: true }));
  app.get('/api/users/admin', protect, (r, s) => s.json({ user: r.user._id }));
  app.post('/api/items/accessQr', optionalProtect, (r, s) =>
    s.json({ user: r.user?._id, cookieUser: r.session.userId })
  );
  for (const [url, file] of [
    ['/api/captain-setup', 'captain-setup.html'],
    ['/api/captain-setup.js', 'captain-setup.js'],
    ['/api/captain-setup.css', 'captain-setup.css'],
  ])
    app.get(url, (_r, s) =>
      s.sendFile(require('node:path').resolve(__dirname, '../src/routes', file), {
        dotfiles: 'allow',
      })
    );
  app.use((e, r, s, next) => s.status(e.statusCode || 500).json({ error: e.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port + '/api';
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await mongoose.disconnect();
  const Model = require('../src/models/base.model');
  await Model.mongoClient?.close();
  await mongo?.stop();
});
test('real HTTP pairing, branch scoping and revocation; bearer does not mint an unscoped login cookie', async () => {
  const managerToken = require('../src/middleware/auth').signLegacyToken(
    manager,
    req,
    branch._id,
    900
  );
  const made = await fetch(base + '/captain/v1/pair-codes', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + managerToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId: String(staff._id) }),
  });
  assert.equal(made.status, 200, await made.clone().text());
  const code = await made.json();
  assert.ok(code.targets[0].qr.startsWith('data:image/png'));
  const response = await fetch(base + '/captain/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.code, device: { device_id: crypto.randomUUID() } }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const grant = await response.json(),
    headers = { Authorization: 'Bearer ' + grant.token };
  assert.equal((await fetch(base + '/captain/v1/session', { headers })).status, 200);
  const accessQr = await fetch(base + '/items/accessQr', {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'x-branch-id': String(new ObjectId()),
    },
    body: '{}',
  });
  assert.equal(accessQr.status, 200, await accessQr.clone().text());
  assert.equal((await accessQr.json()).cookieUser, undefined);
  const cookie = (accessQr.headers.getSetCookie() || []).map((v) => v.split(';')[0]).join(';');
  assert.equal((await fetch(base + '/users/admin', { headers: { cookie } })).status, 401);
  assert.equal((await fetch(base + '/users/admin', { headers })).status, 403);
  await db
    .collection('handsets')
    .updateOne(
      { device_id: require('jsonwebtoken').decode(grant.token).device_id },
      { $set: { revoked: true } }
    );
  assert.equal((await fetch(base + '/captain/v1/session', { headers })).status, 403);
});
test('expired codes and wrong cloud device proof cannot authorize a phone', async () => {
  const code = await access.createCode(req);
  await db
    .collection('captain_pair_codes')
    .updateOne({ _id: access.hash(code.code) }, { $set: { expires: new Date(0) } });
  await assert.rejects(
    access.pair({ db, body: { code: code.code, device: { device_id: 'test-phone-12345' } } }),
    (e) => e.code === 'PAIR_EXPIRED'
  );
  const cloud = await access.createCode(req);
  await db
    .collection('captain_pair_codes')
    .updateOne(
      { _id: access.hash(cloud.code) },
      { $set: { deviceId: 'another-phone-12345', codeChallenge: 'c'.repeat(43) } }
    );
  await assert.rejects(
    access.pair({
      db,
      body: {
        code: cloud.code,
        device: { device_id: 'test-phone-12345' },
        codeVerifier: 'v'.repeat(43),
      },
    }),
    (e) => e.code === 'INVALID_PAIR'
  );
});
test(
  'manager setup page generates a QR with a real login cookie and CSRF protection',
  { skip: !process.env.CAPTAIN_PLAYWRIGHT_PATH },
  async () => {
    const { chromium } = require(process.env.CAPTAIN_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext();
      context.setDefaultTimeout(10000);
      const token = require('../src/middleware/auth').signLegacyToken(
        manager,
        req,
        branch._id,
        900
      );
      await context.addCookies([
        { name: 'jwt', value: token, url: base + '/', httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.log('Setup page error:', e.message));
      page.on('response', async (r) => {
        if (r.status() >= 400) console.log('Setup response:', r.status(), r.url(), await r.text());
      });
      await page.goto(base + '/captain-setup');
      await page.locator('#staff option').first().waitFor({ state: 'attached' });
      await page.locator('#staff').selectOption(String(staff._id));
      await page.locator('#generate').click();
      await page.locator('#result:not([hidden]) img').first().waitFor();
      assert.match(await page.locator('#code').innerText(), /^[A-F0-9]{12}$/);
      await page.screenshot({
        path: require('node:path').resolve(__dirname, '../../captain-manager-setup.png'),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }
);
async function paired() {
  const code = await access.createCode(req);
  const grant = await access.pair({
    db,
    body: { code: code.code, device: { device_id: crypto.randomUUID() } },
    ip: '127.0.0.1',
  });
  return { code, grant };
}

test('route proof identifies the issuing session without accepting any credential', async () => {
  const { grant } = await paired();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const answer = await fetch(base + '/captain/v1/route-proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: grant.sessionId, nonce }),
  });
  assert.equal(answer.status, 200);
  assert.equal(
    (await answer.json()).proof,
    crypto.createHmac('sha256', grant.routeKey).update(nonce).digest('hex')
  );
  const wrong = await access
    .routeProof({ db, body: { sessionId: String(new ObjectId()), nonce } })
    .catch((e) => e);
  assert.equal(wrong.code, 'UNKNOWN_AUTHORITY');
  assert.equal(grant.idempotentOrders, true);
});

test('internet address is manager-only, validated and included in renewed grants', async () => {
  const managerToken = require('../src/middleware/auth').signLegacyToken(
    manager,
    req,
    branch._id,
    900
  );
  const save = (url) =>
    fetch(base + '/captain/v1/connection-settings', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + managerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fallbackUrl: url }),
    });
  assert.equal((await save('http://untrusted.example')).status, 400);
  assert.equal((await save('https://user:password@shop.example')).status, 400);
  assert.equal((await save('https://shop.example')).status, 200);
  const { grant } = await paired();
  assert.ok(grant.routes.includes('https://shop.example/api'));
  const denied = await fetch(base + '/captain/v1/connection-settings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fallbackUrl: 'https://another.example' }),
  });
  assert.equal(denied.status, 403);
});
test('manager grants a single-use, short-lived, staff-and-branch bound Captain session', async () => {
  const { code, grant } = await paired();
  const token = require('jsonwebtoken').verify(grant.token, process.env.JWT_SECRET);
  assert.equal(grant.user.id, String(staff._id));
  assert.equal(token.branch_id, String(branch._id));
  assert.equal(token.captain_session, grant.sessionId);
  assert.equal(token.exp - token.iat, 900);
  await assert.rejects(
    () =>
      access.pair({ db, body: { code: code.code, device: { device_id: 'other-phone-12345' } } }),
    (e) => e.code === 'PAIR_EXPIRED'
  );
});
test('proof verifies the issuing till without revealing pairing secret', async () => {
  const code = await access.createCode(req),
    nonce = crypto.randomBytes(32).toString('base64url');
  const result = await access.proof({ db, body: { enrolmentId: code.enrolmentId, nonce } });
  assert.equal(
    result.proof,
    crypto.createHmac('sha256', access.hash(code.code)).update(nonce).digest('hex')
  );
});
test('simultaneous claims accept only one device', async () => {
  const code = await access.createCode(req);
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      access.pair({ db, body: { code: code.code, device: { device_id: 'concurrent-phone-' + n } } })
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('refresh rotation survives a lost reply and rejects a different successor', async () => {
  const { grant } = await paired(),
    next = crypto.randomBytes(32).toString('base64url');
  const request = {
    db,
    body: { sessionId: grant.sessionId, refreshToken: grant.refreshToken, nextToken: next },
  };
  const results = await Promise.all([access.refresh(request), access.refresh(request)]);
  assert.ok(results.every((r) => r.refreshToken === next));
  await assert.rejects(
    () =>
      access.refresh({
        db,
        body: { ...request.body, nextToken: crypto.randomBytes(32).toString('base64url') },
      }),
    (e) => e.code === 'INVALID_SESSION'
  );
  const row = await db
    .collection('captain_sessions')
    .findOne({ _id: new ObjectId(grant.sessionId) });
  assert.equal(row.refreshHash, access.hash(next));
  assert.ok(!JSON.stringify(row).includes(next));
});
test('revocation and permission or feature removal prevent renewal', async () => {
  const { grant } = await paired(),
    body = {
      sessionId: grant.sessionId,
      refreshToken: grant.refreshToken,
      nextToken: crypto.randomBytes(32).toString('base64url'),
    };
  await db
    .collection('captain_sessions')
    .updateOne({ _id: new ObjectId(grant.sessionId) }, { $set: { revoked: true } });
  await assert.rejects(
    () => access.refresh({ db, body }),
    (e) => e.code === 'DEVICE_REVOKED'
  );
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { module_captain_enable: false } });
  await assert.rejects(
    () => access.createCode(req),
    (e) => e.code === 'CAPTAIN_DISABLED'
  );
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { module_captain_enable: true } });
});
test('staff cannot approve devices and cross-tenant staff cannot be selected', async () => {
  await assert.rejects(
    () => access.createCode({ ...req, user: staff }),
    (e) => e.code === 'MANAGER_REQUIRED'
  );
  const outsider = { ...staff, _id: new ObjectId(), license: new ObjectId() };
  await db.collection('users').insertOne(outsider);
  await assert.rejects(
    () => access.createCode({ ...req, body: { staffId: String(outsider._id) } }),
    (e) => e.code === 'CAPTAIN_PERMISSION'
  );
});
test('Captain scoped sessions cannot access Mobile POS or administration', async () => {
  const { grant } = await paired();
  const token = require('jsonwebtoken').decode(grant.token);
  const request = {
    db,
    tenantContext: req.tenantContext,
    captainSession: grant.sessionId,
    handsetDevice: token.device_id,
    originalUrl: '/api/sales/getListKot',
  };
  await access.verifySession(request, staff);
  await assert.rejects(
    () => access.verifySession({ ...request, originalUrl: '/api/mobile/v1/sales' }, staff),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await assert.rejects(
    () => access.verifySession({ ...request, originalUrl: '/api/users/delete' }, staff),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await assert.rejects(
    () =>
      access.verifySession(
        { ...request, tenantContext: { ...req.tenantContext, branchId: new ObjectId() } },
        staff
      ),
    (e) => e.code === 'CAPTAIN_SCOPE'
  );
  await db
    .collection('handsets')
    .updateOne({ device_id: token.device_id }, { $set: { revoked: true } });
  await assert.rejects(
    () => access.verifySession(request, staff),
    (e) => e.code === 'DEVICE_REVOKED'
  );
});

test('paired Captain can split and record payments but cannot change settings or use cashier bypass', async () => {
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/sales/guestBills/table', { headers })).status, 200);
  assert.equal((await fetch(base + '/captain/v1/payment-options', { headers })).status, 200);
  assert.equal((await fetch(base + '/captain/v1/payment-settings', { headers })).status, 403);
  assert.equal(
    (await fetch(base + '/sales/tablePayments/record', { method: 'POST', headers, body: '{}' }))
      .status,
    403
  );
  await db
    .collection('branches')
    .updateOne(
      { _id: branch._id },
      { $set: { captain_payments: { enabled: true, methods: ['Cash'], printReceipt: false } } }
    );
  await db.collection('sales').insertOne({
    branch_id: branch._id,
    license: branch.license,
    table_number: 'PAY1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    sales_total: 10,
    sales_sub_total: 10,
    items: [{ item_name: 'Tea', item_quantity: 1, item_base_price: 10 }],
  });
  const prepared = await fetch(base + '/captain/v1/payments/table', {
    method: 'POST',
    headers,
    body: JSON.stringify({ table_number: 'PAY1' }),
  });
  assert.equal(prepared.status, 200);
  const plan = await prepared.json();
  const response = await fetch(base + '/captain/v1/payments/record', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      planId: plan.id,
      version: plan.version,
      amountMinor: 1000,
      receivedMinor: 1000,
      method: 'Cash',
      request_id: crypto.randomUUID(),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dueMinor, 0);
});


test('paired Captain verifies its own phone through scoped routes', async () => {
  await db.collection('users').updateOne({_id:staff._id},{$set:{password:await require('bcryptjs').hash('staff-password',4)}});
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  const messaging = require('../src/services/messaging.service');
  const original = messaging.sendSms;
  let code;
  messaging.sendSms = async (_branch, _phone, message) => { code = message.match(/\b\d{6}\b/)[0]; return { ok: true }; };
  try {
    const unauthorized = await fetch(base + '/captain/v1/profile/phone/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthorized.status, 401);
    const sent = await fetch(base + '/captain/v1/profile/phone/start', { method: 'POST', headers, body: JSON.stringify({ phone: '+919000000001', currentPassword:'staff-password' }) });
    assert.equal(sent.status, 200);
    const challenge = await sent.json();
    assert.equal(challenge.code, undefined);
    const verified = await fetch(base + '/captain/v1/profile/phone/verify', { method: 'POST', headers, body: JSON.stringify({ challenge: challenge.challenge, code }) });
    assert.equal(verified.status, 200);
    assert.deepEqual(await verified.json(), { saved: true, phone: '+919000000001' });
    const profile = await fetch(base + '/captain/v1/profile', { headers });
    assert.equal((await profile.json()).phone, '+919000000001');
  } finally { messaging.sendSms = original; }
});


test('paired Captain verifies a new email through scoped routes', async () => {
  await db.collection('users').updateOne({_id:staff._id},{$set:{password:await require('bcryptjs').hash('staff-password',4)}});
  const {grant} = await paired();
  const headers = {Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
  const mail = require('../src/utils/email');
  const original = mail.resolveShopTransport;
  let code;
  mail.resolveShopTransport = () => ({from:'shop@example.test',transporter:{sendMail:async message=>{code=message.text.match(/\b\d{6}\b/)[0];}}});
  try {
    const sent = await fetch(base+'/captain/v1/profile/email/start',{method:'POST',headers,body:JSON.stringify({email:'NEW@EXAMPLE.TEST',currentPassword:'staff-password'})});
    assert.equal(sent.status,200);
    const challenge = await sent.json();
    assert.equal(challenge.code,undefined);
    const verified = await fetch(base+'/captain/v1/profile/email/verify',{method:'POST',headers,body:JSON.stringify({challenge:challenge.challenge,code})});
    assert.equal(verified.status,200);
    assert.deepEqual(await verified.json(),{saved:true,email:'new@example.test'});
    const profile = await fetch(base+'/captain/v1/profile',{headers});
    assert.equal((await profile.json()).email,'new@example.test');
  } finally { mail.resolveShopTransport = original; }
});


test('paired Captain moves a reserved group through scoped API without accepting another actor',async()=>{
 const seating=require('../src/services/seating-claims');
 const scope={branchId:branch._id,license:branch.license};
 const ids=[new ObjectId(),new ObjectId(),new ObjectId()];
 await db.collection('tableorder').insertMany(ids.map((id,index)=>({_id:id,branch_id:branch._id,license:branch.license,tableorder_value:'G'+index,capacity:2,max_capacity:3,adjacent_table_ids:ids[index+1]?[String(ids[index+1])]:[]})));
 const claim=await seating.reserve(db,scope,{request_id:'route-seating-0001',actor:String(manager._id),table_ids:ids.slice(0,2).map(String),primary_id:String(ids[0]),guests:4});
 const sale=new ObjectId();
 await seating.bind(db,scope,claim.id,String(manager._id),String(sale));
 await db.collection('sales').insertOne({_id:sale,branch_id:branch._id,license:branch.license,seating_request_id:claim.id,table_number:'G0',person_count:4,sale_process:'KOT'});
 const {grant}=await paired();
 const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
 const payload={orderId:String(sale),request_id:'route-moving-0001',tableIds:ids.slice(1).map(String),primaryId:String(ids[1]),guests:4,actor:String(manager._id)};
 const send=(action,body,auth=headers)=>fetch(base+'/captain/v1/tables/move/'+action,{method:'POST',headers:auth,body:JSON.stringify(body)});
 assert.equal((await send('prepare',payload,{'Content-Type':'application/json'})).status,401);
 const prepared=await send('prepare',payload);assert.equal(prepared.status,200);
 assert.equal((await seating.find(db,scope,payload.request_id)).actor,String(staff._id));
 const completed=await send('complete',{request_id:payload.request_id});assert.equal(completed.status,200);
 assert.equal((await completed.json()).state,'submitting');
 assert.equal((await send('prepare',payload)).status,200);
 assert.equal((await db.collection('sales').findOne({_id:sale})).table_number,'G1');
 const cancelled={...payload,request_id:'route-moving-0002',primaryId:String(ids[2])};
 assert.equal((await send('prepare',cancelled)).status,200);
 const cancelledReply=await send('cancel',{request_id:cancelled.request_id});
 assert.equal(cancelledReply.status,200);
 assert.equal((await cancelledReply.json()).state,'cancelled');
 assert.equal((await db.collection('sales').findOne({_id:sale})).table_number,'G1');
 const unprepared={...payload,request_id:'route-moving-0003'};
 const abandoned=await send('cancel',{request_id:unprepared.request_id,orderId:String(sale)});
 assert.equal(abandoned.status,200);
 assert.equal((await abandoned.json()).state,'cancelled');
 assert.equal((await send('prepare',unprepared)).status,409);
 assert.equal((await send('cancel',{request_id:unprepared.request_id,orderId:String(sale)})).status,200);
 assert.equal((await db.collection('sales').findOne({_id:sale})).table_number,'G1');

});


test('paired Captain can preview an edit over HTTP without modifying the sale', async () => {
  const { grant } = await paired();
  const product = new ObjectId(), id = new ObjectId();
  await db.collection('items').insertOne({ _id: product, license: branch.license, name: 'Soup', tax: 5, tax_type: 'exclusive' });
  const order = { _id: id, branch_id: branch._id, license: branch.license, sale_process: 'KOT', payment_status: 'Unpaid',
    sales_total: 105, sales_sub_total: 100, tax: 5, table_number: '1',
    items: [{ item_id: product, item_name: 'Soup', item_quantity: 2, item_price: 50 }], changes: [] };
  await db.collection('sales').insertOne(order);
  const url = base + '/captain/v1/orders/edit/preview';
  const body = JSON.stringify({ order_id: String(id), items: [{ product_id: String(product), quantity: 3, price: 50 }] });
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  const answer = await fetch(url, { method: 'POST', headers, body });
  assert.equal(answer.status, 200, await answer.clone().text());
  assert.equal(answer.headers.get('cache-control'), 'no-store');
  assert.equal((await answer.json()).total_amount, 157.5);
  assert.deepEqual(await db.collection('sales').findOne({ _id: id }), order);
  await db.collection('sales').updateOne({ _id: id }, { $set: { branch_id: new ObjectId() } });
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 404);
});
