jest.mock('../../src/sync/outbox', () => ({ enqueue: jest.fn() }));
jest.mock('../../src/sync/nudge', () => ({ nudgeSyncAgent: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn((x) => x),
  GetObjectCommand: jest.fn((x) => x),
}));
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(),
  DetectDocumentTextCommand: jest.fn((x) => x),
}));
jest.mock('../../src/utils/branch-access', () => ({
  context: jest.fn(),
  allowed: jest.fn(() => true),
  fail: (message, status = 422) => {
    throw Object.assign(new Error(message), { status });
  },
}));
const service = require('../../src/services/paper-order');
jest.mock('../../src/services/mobile-pos', () => ({ allowed: jest.fn(), context: jest.fn() }));
const mobile = require('../../src/services/mobile-pos');
const access = require('../../src/utils/branch-access');
const s3 = require('@aws-sdk/client-s3');
const textract = require('@aws-sdk/client-textract');
const jpeg = 'data:image/jpeg;base64,/9j/AA==';
const id = '12345678-1234-4234-8234-123456789abc';
const c = { license: 'tenant', branchId: 'branch', branch: { captain_paper_orders: true } };
let req, photos, sales, usage, sendS3, sendOCR;
beforeEach(() => {
  jest.clearAllMocks();
  mobile.allowed.mockReturnValue(true);
  mobile.context.mockResolvedValue({ ...c, config: { photoOrders: true } });
  process.env.ORDER_PHOTO_BUCKET = 'private-orders';
  process.env.AWS_REGION = 'ap-south-1';
  access.context.mockResolvedValue(c);
  access.allowed.mockReturnValue(true);
  photos = {
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOneAndUpdate: jest.fn(),
  };
  sales = { findOne: jest.fn().mockResolvedValue(null) };
  usage = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
  req = {
    user: { _id: 'staff' },
    body: { id, original: jpeg },
    params: { id },
    db: {
      collection: jest.fn((name) =>
        name === 'sales' ? sales : name === 'paper_order_usage' ? usage : photos
      ),
    },
  };
  sendS3 = jest.fn().mockResolvedValue({});
  sendOCR = jest
    .fn()
    .mockResolvedValue({ Blocks: [{ BlockType: 'LINE', Text: 'CB 5', Confidence: 98 }] });
  s3.S3Client.mockImplementation(() => ({ send: sendS3 }));
  textract.TextractClient.mockImplementation(() => ({ send: sendOCR }));
});

test('staging uploads privately without invoking recognition or consuming scan quota', async () => {
  const result = await service.upload(req);
  expect(result.referenceOnly).toBe(true);
  expect(sendS3).toHaveBeenCalled();
  expect(sendOCR).not.toHaveBeenCalled();
  expect(usage.updateOne.mock.calls.some((call) => call[1]?.$inc)).toBe(false);
});

test('recognition rejects a staged photo outside the current owner scope', async () => {
  req.body = { id, uploadId: '22345678-1234-4234-8234-123456789abc' };
  await expect(service.recognize(req)).rejects.toMatchObject({ status: 404 });
  expect(photos.findOne).toHaveBeenCalledWith(
    expect.objectContaining({ owner: 'staff', license: 'tenant', branch_id: 'branch' })
  );
  expect(sendOCR).not.toHaveBeenCalled();
});

test('mobile uses its own opt-in and strict selling ACL, independent of Captain', async () => {
  mobile.context.mockResolvedValue({
    ...c,
    branch: { captain_paper_orders: false },
    config: { photoOrders: true },
  });
  await expect(service.mobileRecognize(req)).resolves.toMatchObject({ id });
  expect(sendOCR).toHaveBeenCalledTimes(1);
  mobile.allowed.mockReturnValue(false);
  await expect(service.mobileRecognize(req)).rejects.toMatchObject({ status: 403 });
  expect(sendOCR).toHaveBeenCalledTimes(1);
});
test('enabling Captain does not enable mobile cloud reading', async () => {
  mobile.context.mockResolvedValue({ ...c, config: { photoOrders: false } });
  await expect(service.mobileRecognize(req)).rejects.toMatchObject({ status: 403 });
  expect(sendOCR).not.toHaveBeenCalled();
  await expect(service.mobileOptions(req)).resolves.toMatchObject({
    enabled: false,
    configured: true,
  });
});
test('reads table, optional pax and quantities; keeps unrecognized lines for review', () => {
  expect(
    service.parse(
      ['T4 P5', 'CB 5', 'MB 2', 'PBM 1', 'unclear'].map((Text) => ({
        BlockType: 'LINE',
        Text,
        Confidence: 96,
      }))
    )
  ).toMatchObject({
    table: '4',
    pax: 5,
    lines: [
      { name: 'CB', quantity: 5 },
      { name: 'MB', quantity: 2 },
      { name: 'PBM', quantity: 1 },
      { name: 'unclear', quantity: null },
    ],
  });
  expect(service.parse([{ BlockType: 'LINE', Text: 'T4' }]).pax).toBeNull();
});
test('feature is off unless explicitly enabled', async () => {
  expect(service.enabled({})).toBe(false);
  expect(service.enabled({ captain_paper_orders: 'true' })).toBe(false);
  access.context.mockResolvedValue({ ...c, branch: {} });
  await expect(service.recognize(req)).rejects.toMatchObject({ status: 403 });
  expect(sendOCR).not.toHaveBeenCalled();
});

test('real sample Textract blocks pair right-column quantities and recognize Guests', () => {
  const blocks = require('../fixtures/paper-sample-textract.json');
  const parsed = service.parse(blocks);
  expect(parsed).toMatchObject({ table: '4', pax: 3 });
  expect(parsed.lines.map(({ name, quantity }) => [name, quantity])).toEqual([
    ['Chicken Biryani', 2],
    ['Mutton Biryani', 1],
    ['Paneer Butter Masala', 1],
  ]);
  // An unrelated number below a dish must remain for review, not become its qty.
  expect(service.parse([blocks[2], blocks[5]]).lines).toHaveLength(2);
  expect(service.parse([blocks[2], { ...blocks[3], Geometry: undefined }]).lines).toHaveLength(2);
});
test('rejects non-image content', () => {
  expect(() => service.image('data:image/jpeg;base64,aGVsbG8=')).toThrow();
});
test('dish names starting with T are not mistaken for table metadata', () => {
  expect(service.parse([{ BlockType: 'LINE', Text: 'Tea' }])).toMatchObject({
    table: '',
    lines: [{ name: 'Tea', quantity: null }],
  });
});
test('stores original privately and recognizes crop bytes', async () => {
  req.body.crop = 'data:image/jpeg;base64,/9j/AQ==';
  await expect(service.recognize(req)).resolves.toMatchObject({
    id,
    lines: [{ name: 'CB', quantity: 5 }],
  });
  expect(sendS3.mock.calls[0][0]).toMatchObject({
    Bucket: 'private-orders',
    Key: `orders/tenant/branch/${id}`,
    ServerSideEncryption: 'AES256',
    Body: Buffer.from('/9j/AA==', 'base64'),
  });
  expect(sendOCR.mock.calls[0][0].Document.Bytes).toEqual(Buffer.from('/9j/AQ==', 'base64'));
});
test('cross-tenant replay never invokes AWS', async () => {
  photos.findOne.mockResolvedValue({ license: 'other', branch_id: 'branch', owner: 'staff' });
  await expect(service.recognize(req)).rejects.toMatchObject({ status: 409 });
  expect(sendS3).not.toHaveBeenCalled();
});
test('completed retry uses saved recognition without another charge', async () => {
  await service.recognize(req);
  const saved = photos.insertOne.mock.calls[0][0];
  photos.findOne.mockResolvedValue({ ...saved, result: { table: '4', lines: [] } });
  await expect(service.recognize(req)).resolves.toMatchObject({ id, table: '4' });
  expect(sendOCR).toHaveBeenCalledTimes(1);
});
test('monthly cap stops processing before AWS', async () => {
  usage.updateOne.mockResolvedValue({ modifiedCount: 0 });
  await expect(service.recognize(req)).rejects.toMatchObject({ status: 429 });
  expect(sendOCR).not.toHaveBeenCalled();
});
test('photo binding cannot reuse another order key', async () => {
  photos.findOneAndUpdate.mockResolvedValue(null);
  await expect(service.reference(req.db, c, id, 'new-order', 'staff')).rejects.toMatchObject({
    status: 409,
  });
  expect(photos.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    license: 'tenant',
    branch_id: 'branch',
    owner: 'staff',
    $or: [{ orderKey: { $exists: false } }, { orderKey: 'new-order' }],
  });
});
test('photo read rejects a reference pointing outside this branch', async () => {
  sales.findOne.mockResolvedValue({
    paper_order: { bucket: 'private-orders', key: 'orders/other/branch/stolen' },
  });
  await expect(service.read(req)).rejects.toMatchObject({ status: 404 });
  expect(sendS3).not.toHaveBeenCalled();
});

test('reference photo attaches without extraction or changing sale lines and money', async () => {
  req.body.saleId = '507f1f77bcf86cd799439011';
  sales.findOne.mockResolvedValue({ _id: req.body.saleId });
  sales.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  const photo = {
    _id: id,
    key: `orders/tenant/branch/${id}`,
    bucket: 'private-orders',
    type: 'image/jpeg',
    created: new Date(),
  };
  photos.findOneAndUpdate.mockResolvedValue(photo);
  await expect(service.attach(req)).resolves.toMatchObject({
    photo: { id, visibility: 'private' },
  });
  expect(sendOCR).not.toHaveBeenCalled();
  expect(sendS3).toHaveBeenCalledTimes(1);
  const [where, update] = sales.updateOne.mock.calls[0];
  expect(where).toMatchObject({ license: c.license, branch_id: c.branchId });
  expect(Object.keys(update.$set)).toEqual(['updated_date']);
  expect(update.$addToSet.order_photos.id).toBe(id);
  expect(photos.findOneAndUpdate.mock.calls[0][1].$set.orderKey).toBe(req.body.saleId);
});

test('reference upload rejects another branch order before storing any image', async () => {
  req.body.saleId = '507f1f77bcf86cd799439011';
  await expect(service.attach(req)).rejects.toMatchObject({ status: 404 });
  expect(sales.findOne.mock.calls[0][0]).toMatchObject({
    license: c.license,
    branch_id: c.branchId,
  });
  expect(sendS3).not.toHaveBeenCalled();
});
