'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const inventory = require('../src/services/mobile-inventory');
let server, client, db, req, row;
before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db('inventory_test');
});
after(async () => {
  await client?.close();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  const license = new ObjectId(),
    branch = new ObjectId(),
    user = new ObjectId();
  req = {
    db,
    user: { _id: user, usertype: 'owner', username: 'test' },
    tenantContext: { licenseId: String(license), branchId: String(branch) },
    query: {},
  };
  await db
    .collection('branches')
    .insertOne({ _id: branch, license, module_mobile_pos_enable: true });
  row = {
    _id: new ObjectId(),
    license,
    branch_id: branch,
    name: 'Beans',
    available_quantity: 10,
    updated_date: new Date(),
    track_inventory: true,
    item_weight_machine_based: true,
  };
  await db.collection('items').insertOne(row);
});
async function prepare(mode = 'receive', quantity = 5000, id = 'inventory-test-001') {
  req.body = {
    id,
    mode,
    reason: 'Test delivery',
    lines: [{ itemId: String(row._id), quantity, revision: inventory.revision(row) }],
  };
  const draft = await inventory.prepare(req);
  req.params = { id: draft.operationId };
  return draft;
}
test('receive retries and concurrent confirmations produce one stock effect and one log', async () => {
  await prepare();
  await Promise.all([inventory.confirm(req), inventory.confirm(req)]);
  await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 15);
  assert.equal(await db.collection('stocklogs').countDocuments(), 1);
  assert.equal((await inventory.get(req)).state, 'complete');
});
test('crash after stock write resumes without applying again', async () => {
  await prepare();
  await assert.rejects(
    inventory.confirm(req, {
      afterEffect: () => {
        throw Error('power lost');
      },
    })
  );
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 15);
  await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 15);
  assert.equal(await db.collection('stocklogs').countDocuments(), 1);
});
test('zero count is explicit; a changed balance is a conflict and never overwritten', async () => {
  await prepare('count', 0);
  await db.collection('items').updateOne({ _id: row._id }, { $inc: { available_quantity: -1 } });
  assert.equal((await inventory.confirm(req)).state, 'conflict');
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 9);
});
test('count to zero and cancellation retain correct stock', async () => {
  await prepare('count', 0);
  await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 0);
  await prepare('receive', 1000, 'inventory-test-002');
  await inventory.cancel(req);
  await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 0);
});
test('damage cannot silently clamp an excessive reduction', async () => {
  await prepare('damage', 11000);
  assert.equal((await inventory.confirm(req)).state, 'conflict');
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 10);
});

test('administrator cancels a conflict with a reason without overwriting newer stock', async () => {
  await prepare('count', 8800);
  await db.collection('items').updateOne({_id:row._id},{$set:{available_quantity:9}});
  await inventory.confirm(req);
  req.user={...req.user,_id:new ObjectId(),usertype:'admin',username:'admin'};
  assert.equal((await inventory.get(req)).canCancel,true);
  req.body={};
  await assert.rejects(inventory.cancel(req),{status:400});
  req.body={reason:'Recounted using current stock'};
  const cancelled=await inventory.cancel(req);
  assert.equal(cancelled.state,'cancelled');
  assert.equal(cancelled.cancellation.actor,'admin');
  await inventory.cancel(req);
  await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({_id:row._id})).available_quantity,9);
  assert.equal(await db.collection('stocklogs').countDocuments(),0);
});

test('cancelling remaining changes preserves already applied rows and rejects processing state', async () => {
  await prepare();
  await db.collection('inventory_operations').updateOne({_id:req.params.id},{$set:{state:'applying'}});
  req.body={reason:'Do not continue'};
  await assert.rejects(inventory.cancel(req),{status:409});
  await db.collection('inventory_operations').updateOne({_id:req.params.id},{$set:{state:'conflict',applied:[String(row._id)]}});
  const result=await inventory.cancel(req);
  assert.deepEqual(result.applied,[String(row._id)]);
  assert.equal((await db.collection('items').findOne({_id:row._id})).available_quantity,10);
});

test('partial count cancellation preserves successful stock effects and denies another ordinary writer', async () => {
  const second={...row,_id:new ObjectId(),name:'Second item'};
  await db.collection('items').insertOne(second);
  await prepare('count',8000);
  req.body.id='partial-count-002';
  req.body.lines.push({itemId:String(second._id),quantity:7000,revision:inventory.revision(second)});
  const draft=await inventory.prepare(req);req.params={id:draft.operationId};
  await db.collection('items').updateOne({_id:second._id},{$set:{available_quantity:9}});
  const conflict=await inventory.confirm(req);
  assert.equal(conflict.state,'conflict');assert.deepEqual(conflict.applied,[String(row._id)]);
  const author=req.user;
  req.user={_id:new ObjectId(),usertype:'staff',access:{item:{read:true,write:true}}};
  assert.equal((await inventory.get(req)).canCancel,false);
  req.body={reason:'Recount later'};
  await assert.rejects(inventory.cancel(req),{status:403});
  req.user=author;
  await inventory.cancel(req);await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({_id:row._id})).available_quantity,8);
  assert.equal((await db.collection('items').findOne({_id:second._id})).available_quantity,9);
  assert.equal(await db.collection('stocklogs').countDocuments(),1);
});
test('payload identity, branch wall and revoked write permission are enforced', async () => {
  const draft = await prepare();
  req.body.lines[0].quantity = 2000;
  await assert.rejects(inventory.prepare(req), { status: 409 });
  req.tenantContext.branchId = String(new ObjectId());
  await assert.rejects(inventory.get(req), { status: 403 });
  req.tenantContext.branchId = String(row.branch_id);
  req.user.usertype = 'staff';
  req.user.access = { item: { read: true, write: false } };
  req.params.id = draft.operationId;
  await assert.rejects(inventory.confirm(req), { status: 403 });
});
test('approval defaults off and configured approval denies ordinary writer', async () => {
  assert.equal((await prepare()).approvalRequired, false);
  await db
    .collection('branches')
    .updateOne(
      { _id: row.branch_id },
      { $set: { inventory_policy: { approvalActions: ['receive'] } } }
    );
  req.user.usertype = 'staff';
  req.user.access = { item: { read: true, write: true } };
  await assert.rejects(inventory.confirm(req), { status: 403 });
  req.user.usertype = 'owner';
  assert.equal((await inventory.confirm(req)).state, 'complete');
});
test('lookup includes inactive stock, preserves barcode zeroes and excludes other branches', async () => {
  await db
    .collection('items')
    .updateOne({ _id: row._id }, { $set: { active: false, barcode_id: '00042' } });
  await db
    .collection('items')
    .insertOne({ ...row, _id: new ObjectId(), branch_id: new ObjectId() });
  req.query = { q: '00042' };
  const page = await inventory.catalogue(req);
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].barcode, '00042');
  assert.equal(page.rows[0].active, false);
});
test('invalid, duplicate and excessive lines are rejected without truncation', async () => {
  const draft = {
    id: 'inventory-test-003',
    mode: 'receive',
    reason: 'Test',
    lines: [{ itemId: String(row._id), quantity: 1000 }],
  };
  assert.throws(() => inventory.validate({ ...draft, lines: Array(201).fill(draft.lines[0]) }));
  assert.throws(() => inventory.validate({ ...draft, lines: [draft.lines[0], draft.lines[0]] }));
  assert.throws(() =>
    inventory.validate({ ...draft, lines: [{ ...draft.lines[0], quantity: -1 }] })
  );
});
test('request status proves whether an interrupted submission exists, scoped to its author', async () => {
  req.params = { id: 'inventory-test-001' };
  assert.equal((await inventory.requestStatus(req)).operation, null);
  await prepare();
  req.params = { id: 'inventory-test-001' };
  assert.equal((await inventory.requestStatus(req)).operation.state, 'prepared');
  req.user._id = new ObjectId();
  assert.equal((await inventory.requestStatus(req)).operation, null);
});
test('confirmation reports actual opening and closing balances after intervening receiving', async () => {
  await prepare();
  await db.collection('items').updateOne({ _id: row._id }, { $inc: { available_quantity: 7 } });
  const result = await inventory.confirm(req);
  assert.equal(result.lines[0].actualOpening, 17000);
  assert.equal(result.lines[0].actualClosing, 22000);
});
test('inventory-only staff can enroll without gaining selling permission', async () => {
  const mobile = require('../src/services/mobile-pos');
  req.user.usertype = 'staff';
  req.user.access = { item: { read: true, write: true }, sales: { write: false } };
  assert.equal(mobile.canConnect(req.user), true);
  assert.equal(mobile.allowed(req.user, 'sales'), false);
  req.handsetDevice = 'test-mobile';
  await db
    .collection('branches')
    .updateOne({ _id: row.branch_id }, { $set: { module_mobile_pos_enable: false } });
  await assert.rejects(inventory.catalogue(req), { status: 403 });
});
test('approval policy is administrator-only and persists selected approval actions', async () => {
  assert.deepEqual((await inventory.policy(req)).approvalActions, []);
  assert.equal((await inventory.policy(req)).enabled, true);
  req.method = 'POST';
  req.body = { enabled: true, approvalActions: ['damage'] };
  assert.deepEqual((await inventory.policy(req)).approvalActions, ['damage']);
  assert.equal((await inventory.policy(req)).enabled, true);
  req.user.usertype = 'staff';
  req.user.access = { item: { read: true, write: true } };
  await assert.rejects(inventory.policy(req), { status: 403 });
});
test('stock history reads the shared desktop audit and remains branch scoped', async () => {
  await prepare();
  await inventory.confirm(req);
  req.params = { id: String(row._id) };
  const history = await inventory.history(req);
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].opening, '10');
  assert.equal(history.rows[0].closing, '15');
  assert.equal(history.rows[0].reason, 'Mobile inventory receive');
  await db.collection('stocklogs').insertOne({
    _id: new ObjectId(),
    view_item_id: row._id,
    license: row.license,
    branch_id: new ObjectId(),
    created_date: new Date(),
    process: 'Other branch',
  });
  assert.equal((await inventory.history(req)).rows.length, 1);
});
test('catalogue is fully paged, including categories and suppliers from the server', async () => {
  await db
    .collection('items')
    .insertMany(
      Array.from({ length: 204 }, (_, i) => ({ ...row, _id: new ObjectId(), name: 'Item ' + i }))
    );
  let page = await inventory.catalogue(req);
  assert.equal(page.rows.length, 200);
  req.query.after = page.next;
  page = await inventory.catalogue(req);
  assert.equal(page.rows.length, 5);
  assert.equal(page.next, null);
  for (const kind of ['categories', 'suppliers']) {
    await db.collection(kind).insertMany([
      { _id: new ObjectId(), license: row.license, branch_id: row.branch_id, name: 'Allowed' },
      {
        _id: new ObjectId(),
        license: row.license,
        branch_id: new ObjectId(),
        name: 'Other branch',
      },
    ]);
    req.query = { kind };
    assert.deepEqual(
      (await inventory.catalogue(req)).rows.map((r) => r.name),
      ['Allowed']
    );
  }
});
test('abandoned request tombstone rejects late prepare instead of creating an orphan approval', async () => {
  req.params = { id: 'inventory-test-001' };
  assert.equal((await inventory.abandonRequest(req)).state, 'cancelled');
  await assert.rejects(prepare(), { status: 409 });
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 10);
});
test('mobile writes reject a late request from a different logged-in staff member', async () => {
  await prepare();
  await db
    .collection('branches')
    .updateOne({ _id: row.branch_id }, { $set: { inventory_policy: { enabled: true } } });
  req.handsetDevice = 'test-phone';
  req.body = {
    scope: {
      shopId: require('../src/services/mobile-pos').hash(String(row.license)).slice(0, 24),
      branchId: String(row.branch_id),
      staffId: String(new ObjectId()),
    },
  };
  await assert.rejects(inventory.confirm(req), { status: 409 });
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 10);
  req.body.scope.staffId = String(req.user._id);
  assert.equal((await inventory.confirm(req)).state, 'complete');
});
test('null lines and case-variant duplicate ObjectIds are rejected before writing', () => {
  const body = { id: 'inventory-test-001', mode: 'receive', reason: 'Test', lines: [null] };
  assert.throws(() => inventory.validate(body), { status: 400 });
  body.lines = [
    { itemId: String(row._id), quantity: 1000 },
    { itemId: String(row._id).toUpperCase(), quantity: 1000 },
  ];
  assert.throws(() => inventory.validate(body), { status: 400 });
});

test('mobile inventory defaults on, preserves explicit off and existing approval choices', async () => {
  req.method = 'GET';
  assert.equal((await inventory.policy(req)).enabled, true);
  req.handsetDevice = 'test-phone';
  assert.equal((await inventory.catalogue(req)).rows.length, 1);
  await db.collection('branches').updateOne(
    { _id: row.branch_id },
    {
      $set: { inventory_policy: { enabled: false, approvalActions: ['count'] } },
    }
  );
  assert.equal((await inventory.policy(req)).enabled, false);
  assert.deepEqual((await inventory.policy(req)).approvalActions, ['count']);
  await assert.rejects(inventory.catalogue(req), { status: 403 });
  req.method = 'POST';
  req.body = { approvalActions: ['count'] };
  assert.equal((await inventory.policy(req)).enabled, false);
  req.body.enabled = true;
  assert.equal((await inventory.policy(req)).enabled, true);
  assert.equal((await inventory.catalogue(req)).rows.length, 1);
  assert.equal((await db.collection('items').findOne({ _id: row._id })).available_quantity, 10);
});

test('availability duplicate review, alternates, restore, audit, retry, conflict and stock preservation', async () => {
  const availability = require('../src/services/item-availability');
  const mapItem = require('../src/services/mobile-pos').mapItem;
  await db
    .collection('items')
    .updateOne({ _id: row._id }, { $set: { barcode_id: '123', selling_price: 10, tax: 10 } });
  const other = {
    ...row,
    _id: new ObjectId(),
    name: 'Other beans',
    barcodes: ['123'],
    selling_price: 20,
  };
  await db.collection('items').insertOne(other);
  req.query.q = '123';
  let page = await inventory.catalogue(req);
  assert.equal(page.rows.length, 2);
  assert.notEqual(page.rows[0].price, page.rows[1].price);
  assert.ok(page.rows.every((i) => i.availableForSale));
  req.body = {
    id: 'availability-test-001',
    changes: [{ itemId: String(row._id), available: false, revision: '' }],
  };
  assert.equal((await availability.change(req)).results[0].state, 'confirmed');
  await availability.change(req);
  let hidden = await db.collection('items').findOne({ _id: row._id });
  assert.equal(mapItem(hidden).active, false);
  assert.equal(hidden.available_quantity, 10);
  assert.equal(hidden.availability_history.length, 1);
  assert.equal(hidden.availability_history[0].actor, String(req.user._id));
  assert.equal(await db.collection('stocklogs').countDocuments(), 0);
  page = await inventory.catalogue(req);
  assert.equal(page.rows.length, 2);
  req.body = {
    id: 'availability-test-002',
    changes: [{ itemId: String(row._id), available: true, revision: '' }],
  };
  assert.equal((await availability.change(req)).results[0].state, 'conflict');
  req.body.changes[0].revision = hidden.availability_revision;
  await availability.change(req);
  hidden = await db.collection('items').findOne({ _id: row._id });
  assert.equal(mapItem(hidden).active, true);
  assert.equal(hidden.availability_history.length, 2);
  assert.equal(hidden.available_quantity, 10);
  req.user.usertype = 'staff';
  req.user.access = { item: { read: true, write: false } };
  await assert.rejects(availability.change(req), { status: 403 });
});

test('locations are searchable inside the authorized branch and can be cleared', async () => {
  await db
    .collection('items')
    .updateOne({ _id: row._id }, { $set: { stock_locations: ['Rack 5 / Shelf 2'] } });
  await db
    .collection('items')
    .insertOne({
      ...row,
      _id: new ObjectId(),
      branch_id: new ObjectId(),
      stock_locations: ['Rack 5 / Shelf 2'],
    });
  req.query = { q: 'Rack 5' };
  let result = await inventory.catalogue(req);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].stockLocations, ['Rack 5 / Shelf 2']);
  await db.collection('items').updateOne({ _id: row._id }, { $set: { stock_locations: [] } });
  result = await inventory.catalogue(req);
  assert.equal(result.rows.length, 0);
});

test('product picker paginates tracked catalogue and filters category and name',async()=>{
 const category=new ObjectId();await db.collection('items').insertMany(Array.from({length:60},(_,i)=>({...row,_id:new ObjectId(),name:'Picker '+i,category_id:category,track_inventory:i!==59})));
 req.query={limit:'25',tracked:'true',category:String(category),q:'Picker'};
 const first=await inventory.catalogue(req);assert.equal(first.rows.length,25);assert(first.next);
 const second=await inventory.catalogue({...req,query:{...req.query,after:first.next}});assert.equal(second.rows.length,25);assert(!second.rows.some(r=>first.rows.some(f=>f.id===r.id)));
 const third=await inventory.catalogue({...req,query:{...req.query,after:second.next}});assert.equal(third.rows.length,9);assert.equal(third.next,null);
});


test('overview status filters precede pagination and preserve branch isolation', async () => {
  const draft = await prepare();
  const original = await db.collection('inventory_operations').findOne({_id:draft.operationId});
  await db.collection('inventory_operations').insertMany(Array.from({length:55},(_,i)=>({...original,_id:String(i).padStart(64,'0'),state:'complete'})));
  await db.collection('inventory_operations').insertOne({...original,_id:'f'.repeat(64),state:'complete',branch_id:new ObjectId()});
  req.query={status:'attention'};
  const attention=await inventory.list(req);assert.equal(attention.rows.length,1);assert.equal(attention.rows[0].state,'prepared');
  req.query={status:'complete'};const first=await inventory.list(req);assert.equal(first.rows.length,50);assert(first.next);
  req.query={status:'complete',after:first.next};const second=await inventory.list(req);assert.equal(second.rows.length,5);assert.equal(second.next,null);
  req.query={status:'cancelled'};assert.equal((await inventory.list(req)).rows.length,0);
  req.query={status:'bad'};await assert.rejects(inventory.list(req),/Invalid inventory status/);
});
