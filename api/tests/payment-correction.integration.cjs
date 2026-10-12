const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const service = require('../src/services/payment-correction');
const summary = require('../src/helpers/sale-payment-summary');
let server, client, db;
const branchId = new ObjectId(), license = new ObjectId(), saleId = new ObjectId(), registerId = new ObjectId();
const req = () => ({ db, user: { _id: new ObjectId(), username: 'Cashier', access: { sales: { write: true } } },
  tenantContext: { branchId, licenseId: license }, params: { id: String(saleId) } });
before(async () => { server = await MongoMemoryServer.create(); client = await MongoClient.connect(server.getUri()); db = client.db('corrections'); });
after(async () => { await client?.close(); await server?.stop(); });
beforeEach(async () => {
  await db.dropDatabase();
  await db.collection('branches').insertOne({ _id: branchId, license, allow_payment_correction: true, payment_methods_initialized: true });
  await db.collection('payment_method').insertMany(['Cash','UPI','Card','Bank transfer'].map(payment_value => ({branch_id: branchId, license, payment_value, enabled: true})));
  await db.collection('sales').insertOne({ _id: saleId, branch_id: branchId, license, payment_status: 'Paid', sales_id: 'S1',
    payment_mode: 'Cash', multi_payment: { Cash: 500 }, paid_amount: 500, items_total: 500, payment_pending: 0, sale_process: 'Sale', items: [{ name: 'Meal' }] });
  await db.collection('cashregister').insertOne({ _id: registerId, branch_id: branchId, license, register_status: 'Opened',
    register_sales: [{ sales_id: saleId, register_paymentmode: 'Cash', register_amount: 500, multi_payment: { Cash: 500 } }] });
});
async function request(payments = [{method: 'UPI',amount:300},{method:'Cash',amount:200}]) {
  const r = req(), options = await service.read(r);
  r.body = { requestId: new ObjectId().toString(), revision: options.revision, payments, reason: 'Mixed payment missed' };
  return r;
}
test('mixed correction updates receipt and drawer, preserves totals/items, and records before/after', async () => {
  const r = await request(); await service.save(r);
  const sale = await db.collection('sales').findOne({_id:saleId});
  const register = await db.collection('cashregister').findOne({_id:registerId});
  assert.deepEqual(summary.rows(sale), [{method:'UPI',amount:300},{method:'Cash',amount:200}]);
  assert.deepEqual(register.register_sales[0].multi_payment, {UPI:300,Cash:200});
  assert.equal(sale.items_total,500); assert.equal(sale.paid_amount,500); assert.equal(sale.items[0].name,'Meal');
  assert.equal(sale.payment_corrections.length,1); assert.equal(sale.payment_corrections[0].before[0].method,'Cash');
  assert.equal(sale.payment_corrections[0].actor,'Cashier'); assert.equal(sale.payment_correction_pending,undefined);
  assert.deepEqual(register.payment_correction_locks,[]);
});
test('retries are idempotent, while reused ids with changed amounts are rejected', async () => {
  const r=await request(); await service.save(r); await service.save(r);
  assert.equal((await db.collection('sales').findOne({_id:saleId})).payment_corrections.length,1);
  r.body.reason='Different reason'; await assert.rejects(service.save(r),/already used/);
});
test('stale revisions, unbalanced totals, unknown/disabled methods, blank reasons and no-op changes reject', async () => {
  let r=await request(); r.body.payments[0].amount=301; await assert.rejects(service.save(r),/equal/);
  r=await request(); r.body.reason=''; await assert.rejects(service.save(r),/reason/);
  r=await request([{method:'Fake',amount:500}]); await assert.rejects(service.save(r),/enabled/);
  r=await request([{method:'Cash',amount:500}]); await assert.rejects(service.save(r),/different/);
  r=await request(); await db.collection('sales').updateOne({_id:saleId},{$set:{updated_date:new Date()}}); await assert.rejects(service.save(r),/changed/);
  r=await request(); await db.collection('payment_method').updateOne({payment_value:'UPI'},{$set:{enabled:false}}); await assert.rejects(service.save(r),/enabled/);
});
test('defaults off, enforces permission and isolates branch/tenant', async () => {
  const r = await request();
  await db.collection('branches').updateOne({_id:branchId},{$unset:{allow_payment_correction:''}});
  await assert.rejects(service.save(r),/Enable/);
  await db.collection('branches').updateOne({_id:branchId},{$set:{allow_payment_correction:true}});
  r.user.access={}; await assert.rejects(service.save(r),/permission/);
  r.user.access={sales:{write:true}}; r.tenantContext.licenseId=new ObjectId(); await assert.rejects(service.save(r),/Branch not found/);
});
test('closed drawers, refunded and partially paid sales cannot be rewritten', async () => {
  const r=await request(); await db.collection('cashregister').updateOne({_id:registerId},{$set:{register_status:'Closed'}});
  await assert.rejects(service.save(r),/closed/);
  await db.collection('cashregister').updateOne({_id:registerId},{$set:{register_status:'Opened'}});
  await db.collection('sales').updateOne({_id:saleId},{$set:{payment_status:'Unpaid'}});
  await assert.rejects(service.read(req()),/fully paid/);
});
test('recovers interrupted register projection without duplicate history or collection', async () => {
  const r=await request(); const real=db.collection.bind(db); let failed=false;
  r.db={collection(name){const collection=real(name); if(name!=='cashregister')return collection;
    return new Proxy(collection,{get(target,key){if(key==='updateOne')return async(filter,update,options)=>{
      if(update.$set?.['register_sales.$[entry].multi_payment'] && !failed){failed=true;throw Error('simulated interruption');}
      return target.updateOne(filter,update,options);
    }; const v=target[key]; return typeof v==='function'?v.bind(target):v;}});
  }};
  await assert.rejects(service.save(r),/interruption/);
  assert.equal((await real('sales').findOne({_id:saleId})).payment_corrections.length,1);
  assert.equal((await real('cashregister').findOne({_id:registerId})).payment_correction_locks.length,1);
  r.db=db; await service.save(r);
  assert.equal((await real('sales').findOne({_id:saleId})).payment_corrections.length,1);
  assert.deepEqual((await real('cashregister').findOne({_id:registerId})).register_sales[0].multi_payment,{UPI:300,Cash:200});
});
test('custom configured method works without a drawer; duplicate register collections reject', async () => {
  let r=await request([{method:'Bank transfer',amount:500}]);
  await db.collection('cashregister').deleteMany({}); await service.save(r);
  assert.equal((await db.collection('sales').findOne({_id:saleId})).payment_mode,'Bank transfer');
  r=await request([{method:'Card',amount:500}]);
  await db.collection('cashregister').insertOne({branch_id:branchId,license,register_status:'Opened',register_sales:[{sales_id:saleId},{sale_id:saleId}]});
  await assert.rejects(service.save(r),/multiple register/);
});
test('currency validation supports zero and three decimals without rounding entered amounts', () => {
  assert.deepEqual(service.normalize([{method:'Cash',amount:'123'}],['Cash'],{currencyDigits:0}),[{method:'Cash',amount:123}]);
  assert.throws(()=>service.normalize([{method:'Cash',amount:'123.4'}],['Cash'],{currencyDigits:0}),/valid/);
  assert.deepEqual(service.normalize([{method:'Cash',amount:'1.234'}],['Cash'],{currencyDigits:3}),[{method:'Cash',amount:1.234}]);
});
test('a successful request remains retryable after the optional setting is disabled', async () => {
  const r=await request(); await service.save(r);
  await db.collection('branches').updateOne({_id:branchId},{$set:{allow_payment_correction:false}});
  assert.equal((await service.save(r)).saved,true);
  assert.equal((await service.read(req())).enabled,false);
});
test('refund and edit locks prevent a correction starting against another operation', async () => {
  const r=await request();
  await db.collection('sales').updateOne({_id:saleId},{$set:{return_refund_lock:{token:'refund'}}});
  await assert.rejects(service.save(r),/refund/);
  await db.collection('sales').updateOne({_id:saleId},{$unset:{return_refund_lock:''},$set:{captain_edit_until:new Date(Date.now()+60000)}});
  await assert.rejects(service.save(r),/edit/);
});
