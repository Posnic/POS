const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const { runWithRequestContext } = require('../../../src/utils/request-context');
const { scope, requestScope, currentScope } = require('../../../src/utils/record-scope');
let mongod, db, items, branchRepo, variants, users, receiving, BaseModel;
const licenseA = new ObjectId(),
  licenseB = new ObjectId(),
  branchA = new ObjectId(),
  branchB = new ObjectId();
const a = { licenseId: licenseA, branchId: branchA },
  b = { licenseId: licenseB, branchId: branchB };
function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
function request(id, extra = {}) {
  return {
    params: { id: String(id) },
    query: {},
    body: {},
    user: { _id: new ObjectId(), license: licenseA, branch_id: branchA, usertype: 'admin' },
    tenantContext: a,
    db,
    ...extra,
  };
}
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('security_regression');
  await mongoose.connect(process.env.MONGODB_URI);
  db = mongoose.connection.db;
  BaseModel = require('../../../src/models/base.model');
  BaseModel.database = db;
  BaseModel.mongoClient = mongoose.connection.getClient();
  BaseModel._connectedUri = null;
  items = Object.create(require('../../../src/repositories/item.repository').prototype);
  items.collectionName = 'items';
  items.getCollection = async (name) => db.collection(name);
  branchRepo = require('../../../src/repositories/branch.repository');
  variants = require('../../../src/repositories/variant.repository');
  users = require('../../../src/controllers/users.controller');
  receiving = require('../../../src/controllers/receivings.controller');
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});
beforeEach(async () => {
  for (const name of ['items', 'branches', 'variants', 'users', 'receivings', 'purchase_orders'])
    await db.collection(name).deleteMany({});
});
test('scope fails closed and ignores payload scope; concurrent tenants stay separate', async () => {
  expect(() => scope({})).toThrow();
  expect(() => currentScope()).toThrow();
  expect(
    String(
      requestScope({ ...request(new ObjectId()), body: { license: licenseB, branch_id: branchB } })
        .license
    )
  ).toBe(String(licenseA));
  const results = await Promise.all(
    [licenseA, licenseB].map((license) =>
      runWithRequestContext({ license }, async () => {
        await Promise.resolve();
        return String(currentScope(false).license);
      })
    )
  );
  expect(results).toEqual([String(licenseA), String(licenseB)]);
});
test.each(['quickPatch', 'updateItemQuantity'])(
  '%s cannot change known foreign item IDs or another branch',
  async (method) => {
    const own = { _id: new ObjectId(), ...scope(a), selling_price: 5, available_quantity: 3 };
    const foreign = { _id: new ObjectId(), ...scope(b), selling_price: 9, available_quantity: 4 };
    const otherBranch = {
      _id: new ObjectId(),
      license: licenseA,
      branch_id: branchB,
      selling_price: 7,
      available_quantity: 6,
    };
    await db.collection('items').insertMany([own, foreign, otherBranch]);
    const value =
      method === 'quickPatch' ? { selling_price: 20, license: licenseB, branch_id: branchB } : 20;
    for (const row of [foreign, otherBranch])
      expect((await items[method](String(row._id), value, a)).status).toBe(false);
    expect((await items[method](String(own._id), value, a)).status).toBe(true);
    expect(await db.collection('items').findOne({ _id: foreign._id })).toEqual(foreign);
    expect(await db.collection('items').findOne({ _id: otherBranch._id })).toEqual(otherBranch);
    await expect(items[method](String(own._id), value, {})).rejects.toThrow();
  }
);
test('branch repository scopes reads, writes and deletes at the query', async () => {
  const own = { _id: branchA, license: licenseA, branch_name: 'A' };
  const foreign = { _id: branchB, license: licenseB, branch_name: 'B' };
  await db.collection('branches').insertMany([own, foreign]);
  await runWithRequestContext({ license: licenseA }, async () => {
    expect(await branchRepo.findById(branchB, { lean: true })).toBeNull();
    expect(await branchRepo.updateById(branchB, { $set: { branch_name: 'changed' } })).toBeNull();
    expect(await branchRepo.deleteById(branchB)).toBeNull();
    expect((await branchRepo.findById(branchA, { lean: true })).branch_name).toBe('A');
  });
  expect(await db.collection('branches').findOne({ _id: branchB })).toEqual(foreign);
});
test('variant read hides foreign and other-branch variants', async () => {
  const own = { _id: new ObjectId(), ...scope(a), name: 'own' };
  const foreign = { _id: new ObjectId(), ...scope(b), name: 'foreign' };
  await db.collection('variants').insertMany([own, foreign]);
  expect(await variants.findById(String(foreign._id), scope(a))).toBeNull();
  expect((await variants.findById(String(own._id), scope(a))).name).toBe('own');
});
test('user read hides foreign users and never exposes credentials for own tenant', async () => {
  const own = {
    _id: new ObjectId(),
    license: licenseA,
    name: 'own',
    apikey: 'secret',
    sso_token: 'secret',
    password: 'secret',
  };
  const foreign = { _id: new ObjectId(), license: licenseB, name: 'foreign', apikey: 'victim' };
  await db.collection('users').insertMany([own, foreign]);
  const denied = response();
  await users.getOne(request(foreign._id), denied);
  expect(denied.status).toHaveBeenCalledWith(404);
  const allowed = response();
  await users.getOne(request(own._id), allowed);
  const json = JSON.stringify(allowed.json.mock.calls);
  expect(json).toContain('own');
  expect(json).not.toContain('secret');
  expect(json).not.toContain('apikey');
});
test.each(['receivings', 'purchase_orders'])(
  'attachment removal scopes %s fallback',
  async (collection) => {
    const own = {
      _id: new ObjectId(),
      ...scope(a),
      receiving_id: String(new ObjectId()),
      receiving_number: String(new ObjectId()),
      attachments: [{ id: 'attachment' }],
    };
    const foreign = {
      _id: new ObjectId(),
      ...scope(b),
      receiving_id: String(new ObjectId()),
      receiving_number: String(new ObjectId()),
      attachments: [{ id: 'attachment' }],
    };
    await db.collection(collection).insertMany([own, foreign]);
    const denied = response();
    await receiving.removeAttachment(
      request(foreign._id, { params: { id: String(foreign._id), attId: 'attachment' } }),
      denied
    );
    expect(denied.status).toHaveBeenCalledWith(404);
    expect(
      (await db.collection(collection).findOne({ _id: foreign._id })).attachments
    ).toHaveLength(1);
    const allowed = response();
    await receiving.removeAttachment(
      request(own._id, { params: { id: String(own._id), attId: 'attachment' } }),
      allowed
    );
    expect((await db.collection(collection).findOne({ _id: own._id })).attachments).toHaveLength(0);
  }
);

test('user image removal does not touch another shop', async () => {
  const foreign = { _id: new ObjectId(), license: licenseB, image: 'foreign.png' };
  await db.collection('users').insertOne(foreign);
  const res = response();
  await users.userImageDelete(request(foreign._id, { body: { id: String(foreign._id) } }), res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect((await db.collection('users').findOne({ _id: foreign._id })).image).toBe('foreign.png');
});
test('attachment upload cannot add metadata to another shop', async () => {
  const foreign = {
    _id: new ObjectId(),
    ...scope(b),
    receiving_id: String(new ObjectId()),
    receiving_number: String(new ObjectId()),
    attachments: [],
  };
  await db.collection('receivings').insertOne(foreign);
  const res = response();
  await receiving.addAttachment(
    request(foreign._id, {
      file: {
        originalname: 'test.pdf',
        filename: 'test.pdf',
        size: 1,
        mimetype: 'application/pdf',
      },
    }),
    res
  );
  expect(res.status).toHaveBeenCalledWith(404);
  expect((await db.collection('receivings').findOne({ _id: foreign._id })).attachments).toEqual([]);
});

test('branch model read and edit isolate tenants, including same-tenant success', async () => {
  const Branch = require('../../../src/models/branch.model');
  const model = Object.create(Branch.BranchModel.prototype);
  model.model = Branch;
  model.baseModel = { changeLog: async () => {} };
  model.updateBranchNameInCollections = async () => {};
  await db.collection('branches').insertMany([
    { _id: branchA, license: licenseA, branch_name: 'A' },
    { _id: branchB, license: licenseB, branch_name: 'B' },
  ]);
  const user = request(branchA).user;
  expect((await model.getBranchById(String(branchB), user)).status).toBe(false);
  expect((await model.updateBranch(String(branchB), { name: 'changed' }, user)).status).toBe(false);
  expect((await model.getBranchById(String(branchA), user)).data.branch_name).toBe('A');
  expect((await model.updateBranch(String(branchA), { name: 'Allowed' }, user)).status).toBe(true);
  expect((await db.collection('branches').findOne({ _id: branchB })).branch_name).toBe('B');
});
test('item writes and attachment changes require module permission', async () => {
  const controller = require('../../../src/controllers/items.controller');
  const user = {
    _id: new ObjectId(),
    license: licenseA,
    branch_id: branchA,
    usertype: 'cashier',
    access: { item: { read: true, write: false }, receiving: { read: true, write: false } },
  };
  for (const [target, method] of [
    [controller, 'quickPatch'],
    [controller, 'updateItemQuantity'],
    [receiving, 'removeAttachment'],
    [receiving, 'addAttachment'],
  ]) {
    const res = response();
    await target[method](
      request(new ObjectId(), {
        user,
        body: { id: String(new ObjectId()), value: 10, selling_price: 10 },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  }
});

test('API account edits keep a hidden existing key; explicit replacement still works', async () => {
  const User = require('../../../src/models/user.model');
  const id = new ObjectId();
  const oldKey = 'a'.repeat(40);
  await db.collection('users').insertMany([
    { _id: new ObjectId(), license: licenseA, username: 'cashier', apikey: '' },
    { _id: id, license: licenseA, username: 'connector', usertype: 'api', apikey: oldKey },
  ]);
  await db.collection('branches').insertOne({ _id: branchA, license: licenseA, branch_name: 'A' });
  const plan = jest.spyOn(BaseModel.prototype, 'checkPlan').mockResolvedValue(0);
  const log = jest.spyOn(BaseModel.prototype, 'changeLog').mockResolvedValue();
  try {
    const data = {
      usertype: 'api',
      app_name: 'connector',
      app_key: '',
      branch_data: [{ branch_id: String(branchA), branch_name: 'A' }],
      user_status: 'active',
    };
    const context = { license: licenseA, user: request(id).user };
    const result = await User.userInsertUpdate(data, String(id), context);
    expect(result.status).toBe(true);
    expect((await db.collection('users').findOne({ _id: id })).apikey).toBe(oldKey);
    expect(
      (await User.userInsertUpdate({ ...data, app_key: 'b'.repeat(40) }, String(id), context))
        .status
    ).toBe(true);
    expect((await db.collection('users').findOne({ _id: id })).apikey).toBe('b'.repeat(40));
  } finally {
    plan.mockRestore();
    log.mockRestore();
  }
});
test('API key validation allows blank edits but rejects blank creates and short replacements', async () => {
  const { validateUser } = require('../../../src/middleware/users.validation');
  const { validationResult } = require('express-validator');
  for (const [id, key, invalid] of [
    [String(new ObjectId()), '', false],
    [undefined, '', true],
    [String(new ObjectId()), 'short', true],
  ]) {
    const req = { body: { usertype: 'api', app_key: key }, params: { id } };
    for (const validator of validateUser) await validator.run(req);
    expect(
      validationResult(req)
        .array()
        .some((e) => e.path === 'app_key')
    ).toBe(invalid);
  }
});
