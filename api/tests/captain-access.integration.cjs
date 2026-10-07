'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict'),
  crypto = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const access = require('../src/services/captain-access');
let mongo, db, manager, staff, branch, req, server, base;
let testClient = 0;
beforeEach(() => { testClient++; });
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
  app.use(express.json({ limit: process.env.CAPTAIN_LIVE_AWS_CHECK === '1' ? '10mb' : '100kb' }));
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
    // Each scenario has its own client; requests within it still share limits.
    Object.defineProperty(r, 'ip', { value: `127.0.0.${testClient}` });
    r.db = db;
    next();
  });
  app.use('/api/captain/v1', require('../src/routes/captain-access.routes'));
  app.use('/api/kitchen', require('../src/routes/kitchen-board.routes'));
  const { protect, optionalProtect } = require('../src/middleware/auth');
  const paymentTestLimit = require('express-rate-limit')({windowMs:60000,limit:180});
  const guestBills = require('../src/controllers/guest-bill.controller');
  const salesController = require('../src/controllers/sales.controller');
  app.get('/api/sales/guestBills/table', paymentTestLimit, protect, guestBills.read);
  app.get('/api/sales/guestBills/latest', paymentTestLimit, protect, guestBills.latest);
  app.post('/api/sales/guestBills/print', paymentTestLimit, protect, guestBills.send);
  app.post('/api/sales/requestBillPrint', paymentTestLimit, protect, salesController.requestBillPrint.bind(salesController));
  app.post('/api/sales/updateOrder', paymentTestLimit, protect, salesController.updateOrder.bind(salesController));
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
test('paired Captain collects one takeaway bill with mixed tenders over HTTP and retries safely', async () => {
  await db.collection('branches').updateOne({_id:branch._id},{$set:{captain_payments:{enabled:true,methods:['Cash','Card']},printall:false}});
  const code=await access.createCode(req);
  const grant=await access.pair({db,body:{code:code.code,device:{device_id:crypto.randomUUID()}}});
  const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
  const sale={_id:new ObjectId(),branch_id:branch._id,license:branch.license,table_number:'',dine_type:'Take away',sales_id:'HTTP-1',sale_process:'KOT',payment_status:'Unpaid',floor_lifecycle:true,created_date:new Date(),kitchen_actor:{id:String(staff._id),name:'Waiter'},sales_total:105,sales_sub_total:100,tax:5,items:[{item_name:'Soup',item_quantity:2,item_base_price:50,item_tax:5}]};
  const other={...sale,_id:new ObjectId(),sales_id:'HTTP-2'};
  await db.collection('sales').insertMany([sale,other]);
  const billResponse=await fetch(base+'/captain/v1/bill?saleId='+sale._id,{headers});
  assert.equal(billResponse.status,200,await billResponse.clone().text());
  assert.deepEqual((await billResponse.json()).orderIds,[String(sale._id)]);
  const prepared=await fetch(base+'/captain/v1/payments/table',{method:'POST',headers,body:JSON.stringify({saleId:String(sale._id)})});
  assert.equal(prepared.status,200,await prepared.clone().text());
  const plan=await prepared.json();assert.equal(plan.dueMinor,10500);
  const input={planId:plan.id,version:plan.version,amountMinor:10500,receivedMinor:10500,method:'Mixed',request_id:crypto.randomUUID(),tenders:[{method:'Cash',amountMinor:10000,receivedMinor:10000},{method:'Card',amountMinor:500,receivedMinor:500,verified:true}]};
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(base+'/captain/v1/payments/record',{method:'POST',headers,body:JSON.stringify(input)});
    assert.equal(response.status,200,await response.clone().text());
    const result=await response.json();assert.equal(result.dueMinor,0);assert.equal(result.payments.length,1);
  }
  const stored=await db.collection('sales').findOne({_id:sale._id});
  assert.deepEqual(stored.multi_payment,{Cash:100,Card:5});assert.equal(stored.floor_closed_at,undefined);
  assert.equal((await db.collection('sales').findOne({_id:other._id})).payment_status,'Unpaid');
  // Paid food stays in preparation, reports partial readiness to its ordering
  // Captain, and closes only after pickup and service.
  const managerToken=require('../src/middleware/auth').signLegacyToken(manager,req,branch._id,900);
  const kitchenHeaders={Authorization:'Bearer '+managerToken,'Content-Type':'application/json'};
  const kitchen=await fetch(base+'/kitchen',{headers:kitchenHeaders});
  assert.equal(kitchen.status,200,await kitchen.clone().text());
  let ticket=(await kitchen.json()).tickets.find(ticket=>ticket.saleId===String(sale._id));
  assert.ok(ticket,'Payment must not hide preparation');
  assert.equal(ticket.orderNumber,'HTTP-1');assert.equal(ticket.takeaway,true);
  const action=async(path,auth,operation,quantity)=>{
    const response=await fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify({saleId:String(sale._id),roundId:ticket.roundId,
      itemId:ticket.items[0].id,revision:ticket.revision,actionId:crypto.randomUUID(),operation,quantity})});
    assert.equal(response.status,200,await response.clone().text());
    ticket=(await response.json()).ticket;
  };
  await action('/kitchen/transition',kitchenHeaders,'ready',1);
  const noticeResponse=await fetch(base+'/captain/v1/kitchen-ready',{headers});
  assert.equal(noticeResponse.status,200);
  const notice=await noticeResponse.json(),own=notice.tickets.find(row=>row.saleId===String(sale._id));
  assert.equal(own.owner,String(staff._id));assert.equal(own.items[0].ready,1);
  assert.equal(notice.readiness.find(row=>row.saleId===String(sale._id)).remaining,2);
  assert.equal((await db.collection('sales').findOne({_id:sale._id})).floor_closed_at,undefined);
  await action('/kitchen/transition',kitchenHeaders,'ready',2);
  await action('/captain/v1/kitchen-ready',headers,'collect',2);
  await action('/captain/v1/kitchen-ready',headers,'serve',2);
  assert.equal(ticket,null);
  assert.ok((await db.collection('sales').findOne({_id:sale._id})).floor_closed_at);
  const afterKitchen=await fetch(base+'/kitchen',{headers:kitchenHeaders});
  assert.ok(!(await afterKitchen.json()).tickets.some(row=>row.saleId===String(sale._id)));
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

test('paired Captain prints and splits one Take Away order through real HTTP controllers', async () => {
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  const sale = { _id:new ObjectId(), branch_id:branch._id, license:branch.license,
    table_number:'', dine_type:'Take Away', sales_id:'PRINT-1048', sale_process:'KOT', payment_status:'Unpaid',
    sales_total:100, sales_sub_total:100, items:[{item_name:'Tea',item_quantity:2,item_base_price:50}] };
  const other = {...sale, _id:new ObjectId(), sales_id:'PRINT-1049'};
  await db.collection('sales').insertMany([sale,other]);
  const endpoint = '/sales/guestBills/table?branchId=' + branch._id + '&saleId=' + sale._id;
  assert.equal((await fetch(base+endpoint)).status,401);
  const response = await fetch(base+endpoint,{headers});
  assert.equal(response.status,200,await response.clone().text());
  const snapshot = (await response.json()).data;
  assert.equal(snapshot.table,'Take Away PRINT-1048');
  assert.equal(snapshot.totalMinor,10000);
  const splitInput = {branchId:String(branch._id), saleId:String(sale._id), revision:snapshot.revision, request_id:crypto.randomUUID(), copies:1,
    plan:{mode:'equal',guests:['Guest 1','Guest 2']}};
  const post = (path,body) => fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  for (let attempt=0;attempt<2;attempt++) {
    const result = await post('/sales/guestBills/print',splitInput);
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).data.queued,true);
  }
  assert.equal(await db.collection('printjobs').countDocuments({ticket_key:{$regex:'^guest-batch:'+splitInput.request_id+':'}}),2);
  const latest = await fetch(base+'/sales/guestBills/latest?branchId='+branch._id+'&saleId='+sale._id,{headers});
  assert.equal((await latest.json()).data.stale,false);
  for(let attempt=0;attempt<2;attempt++) {
    const result = await post('/sales/requestBillPrint',{branchId:String(branch._id),saleId:String(sale._id),copies:1});
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).data.waiting,1);
  }
  assert.equal(await db.collection('printjobs').countDocuments({sale_id:sale._id}),1);
  assert.equal((await db.collection('sales').findOne({_id:other._id})).bill_requested_at,undefined);
  const foreign={...sale,_id:new ObjectId(),branch_id:new ObjectId()};
  await db.collection('sales').insertOne(foreign);
  assert.equal((await fetch(base+'/sales/guestBills/table?branchId='+branch._id+'&saleId='+foreign._id,{headers})).status,409);
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
  assert.equal((await fetch(base + '/sales/guestBills/table?table_number=NO-OPEN-BILL&branchId='+branch._id, { headers })).status, 409);
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

test('paired Captain adds the same dish as a new preparation round without overwriting the old note', async () => {
  const {grant}=await paired();
  const product=new ObjectId(), id=new ObjectId(), firstAt=new Date(Date.now()-600000);
  const original={item_id:product,line_id:'original-round',item_name:'Naan',item_quantity:1,item_price:40,item_base_price:40,item_description:'No butter'};
  await db.collection('items').insertOne({_id:product,license:branch.license,name:'Naan',tax:0,tax_type:'exclusive',selling_price:40});
  await db.collection('sales').insertOne({_id:id,branch_id:branch._id,license:branch.license,sale_process:'KOT',payment_status:'Unpaid',
    table_number:'ROUND-4',dine_type:'Dine-in',person_count:2,sales_sub_total:40,sales_total:40,
    created_date:firstAt,updated_date:firstAt,items:[original],changes:[{timestamp:firstAt,items:[{...original,process:'add'}]}]});
  const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
  const input={order_id:String(id),seen_at:firstAt.toISOString(),items:[
    {product_id:String(product),line_id:'original-round',name:'Naan',quantity:1,price:40,item_description:'No butter'},
    {product_id:String(product),line_id:'new-round',name:'Naan',quantity:2,price:40,item_description:'Extra butter'}],total_amount:120,preparation_note:'Serve together'};
  const response=await fetch(base+'/sales/updateOrder',{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal(response.status,200,await response.clone().text());
  const sale=await db.collection('sales').findOne({_id:id});
  assert.equal(sale.sales_total,120);
  assert.equal(sale.preparation_note,'Serve together');
  assert.equal(sale.changes[1].preparation_note,'Serve together');
  assert.deepEqual(sale.items.map(item=>[item.line_id,item.item_quantity,item.item_description]),[
    ['original-round',1,'No butter'],['new-round',2,'Extra butter']]);
  assert.equal(sale.changes.length,2);
  assert.equal(sale.changes[0].timestamp.getTime(),firstAt.getTime());
  assert.deepEqual(sale.changes[1].items.map(item=>[item.line_id,item.item_quantity,item.item_description,item.process]),[
    ['new-round',2,'Extra butter','add']]);
  const retry=await fetch(base+'/sales/updateOrder',{method:'POST',headers,body:JSON.stringify(input)});
  assert.notEqual(retry.status,200,'Stale edit must not duplicate a kitchen round');
  assert.equal((await db.collection('sales').findOne({_id:id})).changes.length,2);
  const noteOnly={...input,seen_at:sale.updated_date.toISOString(),preparation_note:'Pack separately'};
  const changed=await fetch(base+'/sales/updateOrder',{method:'POST',headers,body:JSON.stringify(noteOnly)});
  assert.equal(changed.status,200,await changed.clone().text());
  const noted=await db.collection('sales').findOne({_id:id});
  assert.equal(noted.sales_total,120);
  assert.deepEqual(noted.items,sale.items);
  assert.equal(noted.changes.length,3);
  assert.deepEqual(noted.changes[2].items,[]);
  assert.equal(noted.changes[2].note_only,true);
  assert.equal(noted.changes[2].preparation_note,'Pack separately');
  assert.equal(noted.changes[1].preparation_note,'Serve together','Earlier print snapshot is immutable');
  const tickets=require('../src/helpers/kitchen-rounds').tickets(noted);
  assert.equal(tickets.flatMap(ticket=>ticket.items).reduce((n,item)=>n+item.qty,0),3);
  assert.ok(tickets.every(ticket=>ticket.preparationNote==='Pack separately'));
  const BaseModel=require('../src/models/base.model');
  const previousGetDb=BaseModel.getDb;
  BaseModel.getDb=async()=>db;
  try {
    const queue=await require('../src/repositories/sale.repository').multiKitchenPrintModel(String(branch._id),{onlySaleId:String(id)});
    assert.equal(queue.status,true);
    assert.equal(queue.data.length,1);
    const jobs=queue.data[0].print_jobs;
    assert.equal(jobs.length,3);
    assert.equal(jobs[0].preparation_note,'','An earlier ticket must not inherit the latest note');
    assert.equal(jobs[1].preparation_note,'Serve together');
    assert.equal(jobs[1].items[0].item_quantity,2);
    assert.equal(jobs[2].preparation_note,'Pack separately');
    assert.equal(jobs[2].note_only,true);
    assert.deepEqual(jobs[2].items,[]);
    assert.equal(queue.data[0].new_last_printed_change_index,2);
  } finally {BaseModel.getDb=previousGetDb;}
  const invalid=await fetch(base+'/sales/updateOrder',{method:'POST',headers,body:JSON.stringify({...noteOnly,preparation_note:'x'.repeat(501)})});
  assert.equal(invalid.status,422);
});


test('paired Captain reaches bill, kitchen and guest recovery routes with scoped audio ownership', async () => {
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  const call = (path, body) => fetch(base + '/captain/v1/' + path, { method: body ? 'POST' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const order = { branch_id: branch._id, license: branch.license, sale_process: 'KOT', payment_status: 'Unpaid',
    table_number: 'ROUTE-BILL', sales_total: 10, sales_sub_total: 10,
    items: [{ item_name: 'Tea', item_quantity: 1, item_base_price: 10 }] };
  await db.collection('sales').insertOne(order);
  const bill = await call('bill?table=ROUTE-BILL');
  assert.equal(bill.status, 200, await bill.clone().text());
  assert.equal((await bill.json()).totalMinor, 1000);
  const ready = await call('kitchen-ready');
  assert.equal(ready.status, 200, await ready.clone().text());
  const guest = await call('tables/guests/status', { request_id: 'missing-guest-request-1234' });
  assert.equal(guest.status, 200);
  assert.equal((await guest.json()).state, 'unknown');
  // Malformed mutations reach their own validation, never mutate a sale.
  for (const path of ['tables/guests', 'kitchen-ready']) {
    const response = await call(path, {});
    assert.equal(response.status, path === 'kitchen-ready' ? 400 : 422, await response.clone().text());
  }
  // A paired device still needs the staff member's merge permission.
  for (const path of ['tables/merge/prepare', 'tables/transfer/preview']) {
    const response = await call(path, {});
    assert.equal(response.status, 403);
    assert.notEqual((await response.json()).error.code, 'CAPTAIN_SCOPE');
  }
  const events = [];
  const listener = (event, reply) => { events.push(event); reply(null, { accepted: true }); };
  process.on('posnic:kitchen-audio', listener);
  try {
    for (const action of ['start', 'cancel', 'voice', 'status']) {
      const response = await call('kitchen-audio/' + action, { id: 'recording-test', owner: 'forged', branchId: 'forged' });
      assert.equal(response.status, 200, await response.clone().text());
    }
    assert.equal(events.length, 4);
    for (const event of events) {
      assert.equal(event.branchId, String(branch._id));
      assert.equal(event.owner, String(branch.license) + ':' + String(staff._id));
    }
  } finally { process.removeListener('posnic:kitchen-audio', listener); }
  for (const path of ['kitchen-audio/delete', 'tables/transfer/commit', 'tables/merge/delete', 'pair-codes']) {
    const response = await call(path, {});
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CAPTAIN_SCOPE');
  }
});


test('paired Captain can check scanning and reach photo validation without gaining settings access', async () => {
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  const call = (path, body) =>
    fetch(base + '/captain/v1/paper-orders/' + path, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const options = await call('options');
  assert.equal(options.status, 200, await options.clone().text());
  assert.equal((await options.json()).enabled, false);
  for (const [path, body] of [
    ['recognize', {}],
    ['reference', {}],
    ['photos/' + crypto.randomUUID(), null],
  ]) {
    const response = await call(path, body);
    assert.ok(response.status >= 400);
    assert.notEqual((await response.json()).error.code, 'CAPTAIN_SCOPE');
  }
  for (const path of ['settings', 'delete', 'photos/not-an-id']) {
    const response = await call(path, {});
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CAPTAIN_SCOPE');
  }
});

test('paired Captain reads the real sample through HTTP and AWS', { skip: process.env.CAPTAIN_LIVE_AWS_CHECK !== '1' }, async () => {
  const { grant } = await paired();
  const headers = { Authorization: 'Bearer ' + grant.token, 'Content-Type': 'application/json' };
  const id = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const original = 'data:image/png;base64,' + require('node:fs').readFileSync(process.env.CAPTAIN_SCAN_SAMPLE).toString('base64');
  await db.collection('branches').updateOne({ _id: branch._id }, { $set: { captain_paper_orders: true } });
  const s3 = new (require('@aws-sdk/client-s3').S3Client)({ region: process.env.AWS_REGION });
  try {
    const options = await fetch(base + '/captain/v1/paper-orders/options', { headers });
    assert.equal(options.status, 200);
    assert.equal((await options.json()).configured, true);
    const upload = await fetch(base + '/captain/v1/paper-orders/upload', { method: 'POST', headers, body: JSON.stringify({ id: uploadId, original }) });
    assert.equal(upload.status, 200, await upload.clone().text());
    assert.equal((await upload.json()).referenceOnly, true);
    assert.equal((await db.collection('paper_order_usage').findOne({})).count, 0);
    const response = await fetch(base + '/captain/v1/paper-orders/recognize', { method: 'POST', headers, body: JSON.stringify({ id, uploadId }) });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.table, '4');
    assert.equal(result.pax, 3);
    assert.deepEqual(result.lines.map(line => [line.name, line.quantity]), [['Chicken Biryani', 2], ['Mutton Biryani', 1], ['Paneer Butter Masala', 1]]);
    const photo = await fetch(base + '/captain/v1/paper-orders/photos/' + id, { headers });
    assert.equal(photo.status, 200, await photo.clone().text());
    assert.equal((await photo.json()).data, original);
  } finally {
    await s3.send(new (require('@aws-sdk/client-s3').DeleteObjectCommand)({ Bucket: process.env.ORDER_PHOTO_BUCKET, Key: `orders/${branch.license}/${branch._id}/${id}` }));
    await s3.send(new (require('@aws-sdk/client-s3').DeleteObjectCommand)({ Bucket: process.env.ORDER_PHOTO_BUCKET, Key: `orders/${branch.license}/${branch._id}/${uploadId}` }));
    s3.destroy();
    await db.collection('branches').updateOne({ _id: branch._id }, { $unset: { captain_paper_orders: '' } });
  }
});

test('paired transfer status requires merge permission and returns scoped unknown recovery',async()=>{
 const {grant}=await paired();
 const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
 const body=JSON.stringify({orderId:String(new ObjectId()),requestId:'unknown-transfer-123456'});
 const send=()=>fetch(base+'/captain/v1/tables/transfer/status',{method:'POST',headers,body});
 assert.equal((await send()).status,403);
 await db.collection('users').updateOne({_id:staff._id},{$set:{'access.sales.merge':true}});
 try {
  const response=await send();assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{requestId:'unknown-transfer-123456',state:'unknown'});
 } finally {await db.collection('users').updateOne({_id:staff._id},{$unset:{'access.sales.merge':''}});}
});


test('paired transfer completion conserves totals and replays the same destination',async()=>{
 const {grant}=await paired();
 const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
 const post=(action,body,auth=headers)=>fetch(base+'/captain/v1/tables/transfer/'+action,{method:'POST',headers:auth,body:JSON.stringify(body)});
 const id=new ObjectId(),product=new ObjectId(),table=new ObjectId();
 await db.collection('tableorder').insertOne({_id:table,branch_id:branch._id,license:branch.license,tableorder_value:'TRANSFER-TARGET',capacity:4,max_capacity:4});
 await db.collection('sales').insertOne({_id:id,branch_id:branch._id,license:branch.license,sale_process:'KOT',payment_status:'Unpaid',
  table_number:'TRANSFER-SOURCE',sales_sub_total:100,sales_total:105,tax:5,
  items:[{item_id:product,item_name:'Corn',item_quantity:2,item_base_price:50,item_tax:5}],
  changes:[{timestamp:new Date(),items:[{item_id:product,item_name:'Corn',item_quantity:2,process:'add'}]}]});
 const body={orderId:String(id),items:[{id:'c0i0',quantity:1}],requestId:'http-transfer-complete-123',
  destination:{tableIds:[String(table)],primaryId:String(table),guests:2}};
 assert.equal((await post('complete',body,{'Content-Type':'application/json'})).status,401);
 assert.equal((await post('complete',body)).status,403);
 await db.collection('users').updateOne({_id:staff._id},{$set:{'access.sales.merge':true}});
 try {
  const preview=await post('preview',body);assert.equal(preview.status,200);
  body.revision=(await preview.json()).revision;
  const response=await post('complete',body);assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.state,'completed');
  const retry=await post('complete',body);assert.equal(retry.status,200);
  assert.deepEqual(await retry.json(),result);
  const status=await post('status',{orderId:body.orderId,requestId:body.requestId});
  assert.deepEqual(await status.json(),result);
  const source=await db.collection('sales').findOne({_id:id});
  const destination=await db.collection('sales').findOne({_id:new ObjectId(result.destinationId)});
  assert.equal(source.sales_total+destination.sales_total,105);
  assert.equal(source.captain_payment_plan,undefined);assert.equal(destination.captain_payment_plan,undefined);
  assert.equal(await db.collection('sales').countDocuments({'captain_transfer_operations.id':destination.captain_transfer_operations[0].id}),2);
  const changed=await post('complete',{...body,items:[{id:'c0i0',quantity:2}]});assert.equal(changed.status,409);
 } finally {await db.collection('users').updateOne({_id:staff._id},{$unset:{'access.sales.merge':''}});}
});

test('public discovery exposes only a single Captain shop and its configured address', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch._id }, { $set: { captain_fallback_url: 'https://shop.example/api' } });
  const response = await fetch(base + '/captain/v1/discovery');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    connections: { shopName: 'Test shop', cloud: 'https://shop.example/api' },
  });
  const extra = {
    _id: new ObjectId(),
    license: branch.license,
    module_captain_enable: true,
    branch_name: 'Other',
  };
  await db.collection('branches').insertOne(extra);
  try {
    assert.deepEqual(await (await fetch(base + '/captain/v1/discovery')).json(), {
      connections: {},
    });
  } finally {
    await db.collection('branches').deleteOne({ _id: extra._id });
    await db
      .collection('branches')
      .updateOne({ _id: branch._id }, { $unset: { captain_fallback_url: '' } });
  }
});

test('connection details require a session and stay scoped to its branch', async () => {
  const { grant } = await paired();
  const body = JSON.stringify({ branch_id: String(branch._id) });
  const send = (payload, authenticated = true) =>
    fetch(base + '/captain/v1/connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: 'Bearer ' + grant.token } : {}),
      },
      body: payload,
    });
  assert.equal((await send(body, false)).status, 401);
  const response = await send(body);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.branchId, String(branch._id));
  assert.equal(result.shopName, 'Test shop');
  // Captain authentication replaces caller-supplied branch IDs with its grant.
  const spoofed = await send(JSON.stringify({ branch_id: String(new ObjectId()) }));
  assert.equal(spoofed.status, 200);
  assert.equal((await spoofed.json()).branchId, String(branch._id));
});
