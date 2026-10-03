'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn((x) => x),
  GetObjectCommand: jest.fn((x) => x),
}));
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(),
  DetectDocumentTextCommand: jest.fn((x) => x),
}));
jest.mock('../../../src/sync/outbox', () => ({ enqueue: jest.fn() }));
jest.mock('../../../src/sync/nudge', () => ({ nudgeSyncAgent: jest.fn() }));
const service = require('../../../src/services/paper-order');
const s3 = require('@aws-sdk/client-s3');
const textract = require('@aws-sdk/client-textract');
let memory, db, branch, license, sale, req, send;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('photo-reference'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await memory?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  jest.clearAllMocks();
  process.env.ORDER_PHOTO_BUCKET = 'private-test';
  process.env.AWS_REGION = 'ap-south-1';
  branch = new ObjectId();
  license = new ObjectId();
  sale = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license, captain_paper_orders: true });
  const sales = db.collection('sales');
  await sales.insertOne({
    _id: sale,
    branch_id: branch,
    license,
    items: [{ item_name: 'Soup', item_quantity: 2 }],
    sales_total: 100,
    payment_status: 'Paid',
  });
  req = {
    db,
    tenantContext: { branchId: branch, licenseId: license },
    user: { _id: new ObjectId(), role: 'manager' },
    body: {
      id: require('crypto').randomUUID(),
      saleId: String(sale),
      original: 'data:image/jpeg;base64,/9j/AA==',
    },
  };
  send = jest.fn();
  send.mockResolvedValue({
    Body: { transformToByteArray: async () => Buffer.from('/9j/AA==', 'base64') },
  });
  s3.S3Client.mockImplementation(() => ({ send }));
});
test('a lost-response retry stores one reference and leaves paid sale content unchanged', async () => {
  const before = await db.collection('sales').findOne({ _id: sale });
  const first = await service.attach(req);
  expect(await service.attach(req)).toEqual(first);
  const after = await db.collection('sales').findOne({ _id: sale });
  expect(after.order_photos).toHaveLength(1);
  expect(after.items).toEqual(before.items);
  expect(after.sales_total).toBe(100);
  expect(after.payment_status).toBe('Paid');
  expect(after.order_photos[0].uploaded_by).toBe(String(req.user._id));
  expect(send).toHaveBeenCalledTimes(1);
  expect(textract.TextractClient).not.toHaveBeenCalled();
  const view = await service.read({
    ...req,
    params: { id: first.photo.id },
    user: { _id: new ObjectId(), role: 'manager' },
  });
  expect(view.data).toBe(req.body.original);
});
test('the same photo request cannot be rebound to a different order', async () => {
  await service.attach(req);
  const second = new ObjectId();
  await db.collection('sales').insertOne({ _id: second, branch_id: branch, license });
  await expect(
    service.attach({ ...req, body: { ...req.body, saleId: String(second) } })
  ).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: second })).order_photos).toBeUndefined();
});
