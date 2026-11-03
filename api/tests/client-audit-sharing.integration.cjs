'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const ExcelJS = require('exceljs');
const sheets = require('../src/services/stock-count-sheet');
const sharing = require('../src/services/catalogue-sharing');
const inventory = require('../src/services/mobile-inventory');
let server, client, db, req, source, targetBranch;
before(async () => {
  process.env.JWT_SECRET = 'isolated-catalogue-test-key-not-a-production-secret';
  server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri());
  db = client.db('client_audit_sharing');
  require('../src/models/base.model').getDb = async () => db;
});
after(async () => { await client?.close(); await server?.stop(); });
beforeEach(async () => {
  await db.dropDatabase();
  const license = new ObjectId(), branch = new ObjectId(); targetBranch = new ObjectId();
  req = { db, user: { _id: new ObjectId(), usertype: 'owner', username: 'Manager', branch_access: [{ branch_id: branch }, { branch_id: targetBranch }] }, tenantContext: { branchId: String(branch), licenseId: String(license) }, query: {} };
  await db.collection('branches').insertMany([{ _id: branch, license, branch_name: 'Admin' }, { _id: targetBranch, license, branch_name: 'Centre' }]);
  source = { _id: new ObjectId(), branch_id: branch, license, name: 'Tomatoes', itemid: '101', selling_price: 52, unit: 'kg', track_inventory: true, item_weight_machine_based: true, available_quantity: 10, updated_date: new Date() };
  await db.collection('items').insertOne(source);
});
async function filled(value) {
  const data = await sheets.download(req), book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(data.base64, 'base64')); book.worksheets[0].getCell('E2').value = value; book.worksheets[0].getCell('F2').value = 'Monthly stock count';
  return { originalname: 'count.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}
test('worksheet import preserves zero, reviews first, applies once and rejects stale sheets', async () => {
  const file = await filled(0);
  req.file = file; req.body = { id: 'audit-test-request-1', reason: 'Month end' };
  const result = await sheets.upload(req);
  assert.equal((await db.collection('items').findOne({ _id: source._id })).available_quantity, 10);
  req.params = { id: result.operationId };
  await inventory.confirm(req); await inventory.confirm(req);
  assert.equal((await db.collection('items').findOne({ _id: source._id })).available_quantity, 0);
  assert.equal(await db.collection('stocklogs').countDocuments(), 1);
  req.body.id = 'audit-test-request-2';
  await assert.rejects(sheets.upload(req), /Stock changed/);
});
test('worksheet rejects formulas, foreign branches and extra precision', async () => {
  await assert.rejects(sheets.parse(await filled({ formula: '1+1', result: 2 }), req.tenantContext.branchId), /not a formula/);
  await assert.rejects(sheets.parse(await filled(1.1234), req.tenantContext.branchId), /three decimals/);
  await assert.rejects(sheets.parse(await filled(1), String(targetBranch)), /another branch/);
});
test('branch sharing starts new stock at zero, preserves centre stock, and does not duplicate on retry', async () => {
  let result = await sharing.distribute(req, [source._id]);
  assert.equal(result.created, 1); assert.deepEqual(result.conflicts, []);
  const target = await db.collection('items').findOne({ branch_id: targetBranch });
  assert.equal(target.available_quantity, 0);
  await db.collection('items').updateOne({ _id: target._id }, { $set: { available_quantity: 7.125 } });
  await db.collection('items').updateOne({ _id: source._id }, { $set: { selling_price: 65 } });
  result = await sharing.distribute(req, [source._id]);
  assert.equal(result.updated, 1);
  const saved = await db.collection('items').findOne({ _id: target._id });
  assert.equal(saved.available_quantity, 7.125); assert.equal(saved.selling_price, 65);
  assert.equal(await db.collection('items').countDocuments(), 2);
});
test('branch sharing refuses code collisions and unauthorized branches', async () => {
  await db.collection('items').insertOne({ ...source, _id: new ObjectId(), branch_id: targetBranch, name: 'Sweet lime', available_quantity: 8 });
  const result = await sharing.distribute(req, [source._id]);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].message, /code conflict/);
  assert.equal((await db.collection('items').findOne({ branch_id: targetBranch })).name, 'Sweet lime');
  await assert.rejects(sharing.distribute(req, [source._id], [String(new ObjectId())]), /unauthorized/);
});
test('automatic sharing defaults off, requires branch permission to enable, and honors explicit opt-in', async () => {
  assert.equal((await sharing.policy(req)).enabled, false);
  req.method = 'PUT'; req.body = { enabled: true };
  assert.equal((await sharing.policy(req)).enabled, true);
  req.user.usertype = 'staff'; req.user.access = { item: { write: true }, branch: { write: false } };
  await assert.rejects(sharing.policy(req), /Branch settings permission/);
});
test('automatic-sharing policy signatures use the active shop secret', async () => {
  const { runWithTenant } = require('../src/db/tenant-context');
  const crypto = require('node:crypto');
  req.method = 'PUT'; req.body = { enabled: true };
  const signatureFor = async key => runWithTenant({ db, secrets: { JWT_SECRET: key } }, async () => {
    await sharing.policy(req);
    return (await db.collection('branches').findOne({ _id: source.branch_id })).catalogue_policy.signature;
  });
  const a = await signatureFor('isolated-shop-a');
  const b = await signatureFor('isolated-shop-b');
  assert.notEqual(a, b);
  assert.equal(a, crypto.createHmac('sha256', 'isolated-shop-a').update(
    ['catalogue-policy-v1', String(source.license), String(source.branch_id), String(req.user._id)].join(':')
  ).digest('hex'));
});

test('cloud worker propagates synced edits under a signed policy without replay or stock changes', async () => {
  req.user.license = source.license;
  await db.collection('users').insertOne(req.user);
  req.method = 'PUT'; req.body = { enabled: true }; await sharing.policy(req);
  await sharing.drain(db);
  let target = await db.collection('items').findOne({ branch_id: targetBranch });
  assert.equal(target.selling_price, 52);
  const histories = await db.collection('price_history').countDocuments();
  await sharing.drain(db);
  assert.equal(await db.collection('price_history').countDocuments(), histories);
  await db.collection('items').updateOne({ _id: source._id }, { $set: { selling_price: 67, updated_date: new Date() } });
  await sharing.drain(db);
  target = await db.collection('items').findOne({ branch_id: targetBranch });
  assert.equal(target.selling_price, 67); assert.equal(target.available_quantity, 0);
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { disabled: true } });
  await db.collection('items').updateOne({ _id: source._id }, { $set: { selling_price: 71 } });
  await sharing.drain(db);
  assert.equal((await db.collection('items').findOne({ branch_id: targetBranch })).selling_price, 67);
});
test('cloud worker rejects forged policy and desktop never writes foreign-branch copies', async () => {
  await db.collection('branches').updateOne({ _id: source.branch_id }, { $set: { catalogue_apply_all_branches: true, catalogue_policy: { actor: String(req.user._id), signature: 'forged' } } });
  await sharing.drain(db);
  assert.equal(await db.collection('items').countDocuments(), 1);
  process.env.POSNIC_DESKTOP = '1';
  try { await assert.rejects(sharing.distribute(req, [source._id]), /cloud admin/); await sharing.drain(db); }
  finally { delete process.env.POSNIC_DESKTOP; }
});

test('category ordering is numeric by SKU and isolated from foreign categories', async () => {
  const a = new ObjectId(), b = new ObjectId(), foreign = new ObjectId();
  await db.collection('categories').insertMany([{_id:a,license:source.license,branch_id:source.branch_id,name:'Vegetables',sort_order:20},{_id:b,license:source.license,branch_id:source.branch_id,name:'Fruit',sort_order:10},{_id:foreign,license:new ObjectId(),branch_id:source.branch_id,name:'Foreign',sort_order:-1}]);
  await db.collection('items').deleteMany({});
  await db.collection('items').insertMany([{...source,_id:new ObjectId(),name:'Zebra',itemid:'2',category_id:a},{...source,_id:new ObjectId(),name:'Apple',itemid:'10',category_id:a},{...source,_id:new ObjectId(),name:'Pear',itemid:'50',category_id:b},{...source,_id:new ObjectId(),name:'Other',itemid:'1',category_id:foreign}]);
  const rows=await db.collection('items').aggregate(require('../src/utils/catalogue-order').stages()).toArray();
  assert.deepEqual(rows.map(r=>r.name),['Pear','Zebra','Apple','Other']);
});
test('category sharing preserves local edits until explicitly applied and renames the same target', async () => {
  const service=require('../src/services/category-sharing');
  const category={_id:new ObjectId(),name:'Vegetables',sort_order:20,license:source.license,branch_id:source.branch_id};
  req.body={apply_branches:[String(targetBranch)]};
  const plan=await service.prepare(req);
  assert.equal((await service.distribute(plan,category))[0].status,'created');
  const target=await db.collection('categories').findOne({branch_id:targetBranch});
  await db.collection('categories').updateOne({_id:target._id},{$set:{sort_order:35}});
  req.body={};assert.equal((await service.prepare(req)).targets.length,0);
  assert.equal((await db.collection('categories').findOne({_id:target._id})).sort_order,35);
  assert.equal((await service.distribute(plan,{...category,name:'Fresh vegetables',sort_order:10},'Vegetables'))[0].status,'updated');
  assert.equal(await db.collection('categories').countDocuments(),1);
  assert.equal((await db.collection('categories').findOne({_id:target._id})).name,'Fresh vegetables');
  req.body={apply_branches:[String(new ObjectId())]};await assert.rejects(service.prepare(req),/unauthorized/);
});
test('stock worksheet requires per-item reason and writes it to stock history and results', async () => {
  req.file=await filled(8.125);req.body={id:'audit-reason-test',reason:'Stock adjustment'};
  const r=await sheets.upload(req);assert.equal(r.lines[0].reason,'Monthly stock count');
  req.params={id:r.operationId};await inventory.confirm(req);
  assert.equal((await db.collection('stocklogs').findOne()).note,'Monthly stock count');
  const report=await sheets.report(req),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(report.base64,'base64'));
  assert.equal(book.worksheets[0].getCell('H2').value,'Monthly stock count');
  const f=await filled(6),b=new ExcelJS.Workbook();await b.xlsx.load(f.buffer);b.worksheets[0].getCell('F2').value='';
  await assert.rejects(sheets.parse({originalname:'count.xlsx',buffer:Buffer.from(await b.xlsx.writeBuffer())},req.tenantContext.branchId),/reason/);
});
test('stock audit branch selection is membership checked and desktop cannot target another branch', async () => {
  req.query={targetBranchId:String(targetBranch)};
  assert.equal((await sheets.scoped(req)).tenantContext.branchId,String(targetBranch));
  req.query.targetBranchId=String(new ObjectId());await assert.rejects(sheets.scoped(req),/unauthorized/);
  req.query.targetBranchId=String(targetBranch);process.env.POSNIC_DESKTOP='1';
  try{await assert.rejects(sheets.scoped(req),/cloud/);}finally{delete process.env.POSNIC_DESKTOP;}
});
test('price expansion applies edited SKU to selected branches and reuses blank exported rows', async () => {
  const price=require('../src/services/price-sheet'),scope=require('../src/services/price-scope');
  const target={...source,_id:new ObjectId(),branch_id:targetBranch,available_quantity:7};await db.collection('items').insertOne(target);
  const c=await scope.context(req.user,req.tenantContext.branchId,req.tenantContext.licenseId);
  const rows=await price.expandRows(c,{branches:'all',rows:[{id:String(source._id),branchId:String(source.branch_id),changes:{selling_price:{old:52,value:60}}},{id:String(target._id),branchId:String(targetBranch),changes:{selling_price:{old:52,value:''}}}]});
  assert.equal(rows.length,2);assert.equal(rows[1].changes.selling_price.value,60);
  assert.equal((await db.collection('items').findOne({_id:target._id})).selling_price,52);
  await db.collection('items').updateOne({_id:target._id},{$set:{name:'Different product'}});
  const conflict=await price.expandRows(c,{branches:'all',rows:[rows[0]]});assert.match(conflict[1].invalidReason,/different product/);
  await db.collection('items').updateOne({_id:source._id},{$set:{selling_price:55}});
  const stale=await price.expandRows(c,{branches:'all',rows:[rows[0]]});assert.equal(stale.length,1);assert.match(stale[0].invalidReason,/Source price changed/);
});


test('count and spoilage sheets expose categories, sort category then numeric SKU, and accept previous headings', async () => {
  const fruit = new ObjectId(), veg = new ObjectId();
  await db.collection('categories').insertMany([
    { _id: fruit, license: source.license, branch_id: source.branch_id, name: 'Fruit', sort_order: 10 },
    { _id: veg, license: source.license, branch_id: source.branch_id, name: 'Vegetables', sort_order: 20 },
  ]);
  await db.collection('items').deleteMany({});
  await db.collection('items').insertMany([
    { ...source, _id: new ObjectId(), name: 'Veg ten', itemid: '10', category_id: veg },
    { ...source, _id: new ObjectId(), name: 'Veg two', itemid: '2', category_id: veg },
    { ...source, _id: new ObjectId(), name: 'Fruit', itemid: '99', category_id: fruit },
  ]);
  for (const service of [sheets, require('../src/services/spoilage-sheet')]) {
    const data = await service.download(req), book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(data.base64, 'base64'));
    const sheet = book.worksheets[0], headings = sheet.getRow(1).values;
    const categoryColumn = headings.indexOf('Category');
    assert(categoryColumn > 0); assert(!sheet.getColumn(categoryColumn).hidden);
    assert.deepEqual([2,3,4].map(n => sheet.getCell(n,1).value), ['Fruit','Veg two','Veg ten']);
    assert.deepEqual([2,3,4].map(n => sheet.getCell(n,categoryColumn).value), ['Fruit','Vegetables','Vegetables']);
    sheet.spliceColumns(categoryColumn, 1);
    sheet.getCell(2,5).value = 1; sheet.getCell(2,6).value = service === sheets ? 'Counted again' : 'Spoilage';
    const file = { originalname: 'legacy.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) };
    if (service === sheets) assert.equal((await service.parse(file, source.branch_id)).length, 1);
    else assert.equal((await service.upload({...req, file})).lines.length, 1);
  }
});
