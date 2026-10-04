'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const Sale = require('../../../src/models/sale.model');
const Jobs = require('../../../src/models/print-job.model');
const queue = require('../../../src/repositories/print-job.repository');
const { createService } = require('../../../src/services/guest-bill.service');
let mem, branch, service;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('guest-bills'));
  await Jobs.init();
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (mem) await mem.stop();
});
beforeEach(async () => {
  await Sale.deleteMany({});
  await Jobs.deleteMany({});
  branch = new mongoose.Types.ObjectId();
  service = createService({
    Branch: { findById: () => ({ lean: async () => ({ currency: '₹', bill_print_copies: 2 }) }) },
  });
});
async function openSale(table = 'T1') {
  const doc = {
    branch_id: branch,
    table_number: table,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    sales_sub_total: 100,
    sales_total: 105,
    tax: 5,
    items: [{ item_name: 'Soup', item_quantity: 2, item_base_price: 50, item_tax: 5 }],
  };
  const result = await Sale.collection.insertOne(doc);
  return Sale.findById(result.insertedId).lean();
}
test('concurrent retries produce one batch and one job per guest copy, claimable only once', async () => {
  await Jobs.collection.dropIndex('branch_id_1_ticket_key_1');
  const original = await openSale();
  await openSale('T2');
  const input = {
    branchId: String(branch),
    table_number: 'T1',
    request_id: '12345678-1234-1234-1234-123456789012',
    plan: { mode: 'equal', guests: ['A', 'B'] },
  };
  input.revision = (await service.read(input)).snapshot.revision;
  await Promise.all([service.send(input), service.send(input)]);
  expect(await Jobs.countDocuments({ status: 'shadow' })).toBe(1);
  expect(await Jobs.countDocuments({ status: 'queued' })).toBe(4);
  const claimed = await queue.claimPrintJobs({
    branchId: String(branch),
    tillId: 'counter',
    limit: 20,
  });
  expect(claimed.status).toBe(true);
  expect(claimed.data).toHaveLength(4);
  expect(claimed.data.every((j) => j.kind === 'bill' && j.payload.title === 'GUEST BILL')).toBe(
    true
  );
  await service.send(input);
  expect(
    (await queue.claimPrintJobs({ branchId: String(branch), tillId: 'counter' })).data
  ).toHaveLength(0);
  const after = await Sale.findById(original._id).lean();
  expect(after).toEqual(original);
  const other = await queue.claimPrintJobs({
    branchId: String(new mongoose.Types.ObjectId()),
    tillId: 'other',
  });
  expect(other.data).toHaveLength(0);
}, 30000);
test('closed tickets and other branches never enter a guest bill snapshot', async () => {
  const current = await openSale();
  await Sale.collection.insertOne({
    branch_id: new mongoose.Types.ObjectId(),
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    sales_total: 9000,
    items: current.items,
  });
  const read = await service.read({ branchId: String(branch), table_number: 'T1' });
  expect(read.snapshot.totalMinor).toBe(10500);
  await Sale.updateOne({ _id: current._id }, { $set: { payment_status: 'Paid' } });
  await expect(
    service.read({ branchId: String(branch), table_number: 'T1' })
  ).rejects.toMatchObject({ status: 409 });
});
test('cashier references detect an order modified after guest bills were sent', async () => {
  const sale = await openSale(),
    input = {
      branchId: String(branch),
      table_number: 'T1',
      request_id: '12345678-1234-1234-1234-123456789012',
      plan: { mode: 'equal', guests: ['A', 'B'] },
    };
  input.revision = (await service.read(input)).snapshot.revision;
  await service.send(input);
  expect((await service.latest(input)).stale).toBe(false);
  await Sale.updateOne({ _id: sale._id }, { $set: { sales_total: 106 } });
  expect((await service.latest(input)).stale).toBe(true);
});

test('Take Away guest bills isolate one order and retain its numbered identity on retries', async () => {
  const selected = await openSale(''),
    other = await openSale('');
  await Sale.collection.updateMany(
    { _id: { $in: [selected._id, other._id] } },
    {
      $set: { dine_type: 'Take Away', sales_id: '1048' },
    }
  );
  const input = {
    branchId: String(branch),
    saleId: String(selected._id),
    request_id: 'takeaway-12345678-1234-1234-123456789012',
    plan: { mode: 'equal', guests: ['A', 'B'] },
  };
  const { snapshot, sales } = await service.read(input);
  expect(sales.map((sale) => String(sale._id))).toEqual([String(selected._id)]);
  expect(snapshot.table).toBe('Take Away 1048');
  expect(snapshot.totalMinor).toBe(10500);
  input.revision = snapshot.revision;
  await service.send(input);
  await service.send(input);
  expect(await Jobs.countDocuments({ status: 'queued' })).toBe(4);
  const jobs = await Jobs.find({ status: 'queued' }).lean();
  expect(jobs.every((job) => job.label.startsWith('Take Away 1048 ·'))).toBe(true);
  expect((await service.latest(input)).stale).toBe(false);
  await Sale.updateOne({ _id: other._id }, { $set: { sales_total: 200 } });
  expect((await service.latest(input)).stale).toBe(false);
  await Sale.updateOne({ _id: selected._id }, { $set: { sales_total: 106 } });
  expect((await service.latest(input)).stale).toBe(true);
});

test('Take Away targeting rejects dine-in, foreign branches, closed orders and malformed IDs', async () => {
  const sale = await openSale('T1');
  const input = { branchId: String(branch), saleId: String(sale._id) };
  await expect(service.read(input)).rejects.toMatchObject({ status: 409 });
  await Sale.collection.updateOne({ _id: sale._id }, { $set: { dine_type: 'Take Away' } });
  await expect(
    service.read({ ...input, branchId: String(new mongoose.Types.ObjectId()) })
  ).rejects.toMatchObject({ status: 409 });
  await Sale.collection.updateOne({ _id: sale._id }, { $set: { floor_closed_at: new Date() } });
  await expect(service.read(input)).rejects.toMatchObject({ status: 409 });
  await expect(service.read({ ...input, saleId: 'bad' })).rejects.toMatchObject({ status: 400 });
  await expect(
    service.read({ branchId: input.branchId, table_number: 'takeaway:' + input.saleId })
  ).rejects.toMatchObject({ status: 400 });
});
