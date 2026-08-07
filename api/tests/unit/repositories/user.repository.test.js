'use strict';

/**
 * Unit tests for src/repositories/users.repository.js
 * SINGLETON export — module.exports = new UsersRepository()
 * Does NOT extend BaseModel; uses Mongoose models directly + native MongoDB driver
 */

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const ObjectIdMock = jest.fn((id) => ({
    toString: () => String(id),
    toHexString: () => String(id),
    equals: (o) => String(id) === String(o),
  }));
  ObjectIdMock.isValid = jest.fn(() => true);
  return { ObjectId: ObjectIdMock };
});

// ─── Mock bcryptjs ──────────────────────────────────────────────────────────
jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash: jest.fn().mockResolvedValue('hashed-value'),
}));

// ─── Mock mongoose ────────────────────────────────────────────────────────────
const mockNativeCollection = jest.fn();
jest.mock('mongoose', () => ({
  connection: { db: { collection: mockNativeCollection } },
  model: jest.fn(),
  Types: { ObjectId: jest.fn((id) => ({ toString: () => String(id) })) },
}));

// ─── Mock user.model.js ───────────────────────────────────────────────────────
const mkQuery = (result) => ({
  select: jest.fn(function () {
    return this;
  }),
  lean: jest.fn(function () {
    return this;
  }),
  sort: jest.fn(function () {
    return this;
  }),
  limit: jest.fn(function () {
    return this;
  }),
  skip: jest.fn(function () {
    return this;
  }),
  exec: jest.fn().mockResolvedValue(result),
  then: (onResolve, onReject) => Promise.resolve(result).then(onResolve, onReject),
});

const mockUserModel = {
  findById: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  userPage: jest.fn(),
  userstatusReportPage: jest.fn(),
  getDataChanges: jest.fn(),
  exportUserOrder: jest.fn(),
  userInsertUpdate: jest.fn(),
};
jest.mock('../../../src/models/user.model', () => mockUserModel);

// ─── Mock branch.model.js ─────────────────────────────────────────────────────
jest.mock('../../../src/models/branch.model', () => ({}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const repository = require('../../../src/repositories/user.repository');
const bcrypt = require('bcryptjs');

// ─── Shared fake data ─────────────────────────────────────────────────────────
const FAKE_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_BRANCH = '64f8f2f4c2b9c0a1e4000003';
const FAKE_LICENSE = '64f8f2f4c2b9c0a1e4000004';

const mockUser = {
  _id: FAKE_ID,
  firstname: 'Test',
  lastname: 'User',
  email: 'test@example.com',
  username: 'testuser',
  usertype: 'admin',
  branch_access: [{ branch_id: FAKE_BRANCH, branch_name: 'Main', branch_image: 'store.png' }],
  preference: { printing_design: 'standard' },
};

const mkNativeChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

// ═════════════════════════════════════════════════════════════════════════════
describe('UsersRepository', () => {
  let nativeCol;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    Object.values(mockUserModel).forEach((fn) => {
      if (typeof fn === 'function') fn.mockReset();
    });

    mockUserModel.findById.mockReturnValue(mkQuery(mockUser));
    mockUserModel.findOne.mockReturnValue(mkQuery(mockUser));
    mockUserModel.find.mockReturnValue(mkQuery([mockUser]));
    mockUserModel.countDocuments.mockResolvedValue(1);
    mockUserModel.create.mockResolvedValue(mockUser);
    mockUserModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockUserModel.updateMany.mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
    mockUserModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    mockUserModel.findByIdAndUpdate.mockResolvedValue(mockUser);
    mockUserModel.userPage.mockResolvedValue({
      status: true,
      data: { list: [mockUser] },
      message: 'success',
    });
    mockUserModel.userstatusReportPage.mockResolvedValue({
      status: true,
      data: { list: [] },
      message: 'success',
    });
    mockUserModel.getDataChanges.mockResolvedValue([mockUser]);
    mockUserModel.exportUserOrder.mockResolvedValue([mockUser]);
    mockUserModel.userInsertUpdate.mockResolvedValue({
      status: true,
      data: mockUser,
      message: 'success',
    });

    bcrypt.compare.mockReset().mockResolvedValue(true);
    bcrypt.hash.mockReset().mockResolvedValue('hashed-value');

    nativeCol = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue(mkNativeChain([])),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    mockNativeCollection.mockReturnValue(nativeCol);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────────────
  describe('constructor', () => {
    test('injects User and Branch models', () => {
      expect(repository.userModel).toBe(mockUserModel);
      expect(repository.branchModel).toBeDefined();
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────
  describe('findById', () => {
    test('returns user by id with defaults', async () => {
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(mockUser);
      expect(mockUserModel.findById).toHaveBeenCalledWith(FAKE_ID);
    });
    test('applies select', async () => {
      await repository.findById(FAKE_ID, { select: 'name email' });
      expect(mockUserModel.findById.mock.results[0].value.select).toHaveBeenCalledWith(
        'name email'
      );
    });
    test('applies lean', async () => {
      await repository.findById(FAKE_ID, { lean: true });
      expect(mockUserModel.findById.mock.results[0].value.lean).toHaveBeenCalled();
    });
    test('returns null when not found', async () => {
      mockUserModel.findById.mockReturnValue(mkQuery(null));
      const r = await repository.findById(FAKE_ID);
      expect(r).toBeNull();
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────────
  describe('findOne', () => {
    test('returns user matching filter', async () => {
      const r = await repository.findOne({ email: 'test@example.com' });
      expect(r).toEqual(mockUser);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    });
    test('applies select and lean', async () => {
      await repository.findOne({ email: 'test@example.com' }, { select: '+password', lean: true });
      const chain = mockUserModel.findOne.mock.results[0].value;
      expect(chain.select).toHaveBeenCalledWith('+password');
      expect(chain.lean).toHaveBeenCalled();
    });
  });

  // ── find ────────────────────────────────────────────────────────────────────
  describe('find', () => {
    test('returns users matching filter', async () => {
      const r = await repository.find({ usertype: 'admin' });
      expect(r).toEqual([mockUser]);
      expect(mockUserModel.find).toHaveBeenCalledWith({ usertype: 'admin' });
    });
    test('applies sort, limit, skip, select, lean', async () => {
      await repository.find(
        {},
        { sort: { name: 1 }, limit: 5, skip: 10, select: 'name', lean: true }
      );
      const chain = mockUserModel.find.mock.results[0].value;
      expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.select).toHaveBeenCalledWith('name');
      expect(chain.lean).toHaveBeenCalled();
    });
    test('returns empty array when none found', async () => {
      mockUserModel.find.mockReturnValue(mkQuery([]));
      const r = await repository.find({});
      expect(r).toEqual([]);
    });
  });

  // ── countDocuments ──────────────────────────────────────────────────────────
  describe('countDocuments', () => {
    test('returns count', async () => {
      mockUserModel.countDocuments.mockResolvedValue(5);
      const r = await repository.countDocuments({ status: 'active' });
      expect(r).toBe(5);
      expect(mockUserModel.countDocuments).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────
  describe('create', () => {
    test('creates and returns user', async () => {
      const r = await repository.create({ firstname: 'New' });
      expect(r).toEqual(mockUser);
      expect(mockUserModel.create).toHaveBeenCalledWith({ firstname: 'New' });
    });
    test('rethrows on creation failure', async () => {
      mockUserModel.create.mockRejectedValue(new Error('dup key'));
      await expect(repository.create({})).rejects.toThrow('dup key');
    });
  });

  // ── updateOne ───────────────────────────────────────────────────────────────
  describe('updateOne', () => {
    test('updates and returns result', async () => {
      const r = await repository.updateOne({ _id: FAKE_ID }, { $set: { name: 'U' } });
      expect(r).toEqual({ matchedCount: 1, modifiedCount: 1 });
      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: FAKE_ID },
        { $set: { name: 'U' } },
        {}
      );
    });
    test('passes options', async () => {
      await repository.updateOne({ _id: FAKE_ID }, { name: 'X' }, { upsert: true });
      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: FAKE_ID },
        { name: 'X' },
        { upsert: true }
      );
    });
  });

  // ── updateMany ──────────────────────────────────────────────────────────────
  describe('updateMany', () => {
    test('updates multiple', async () => {
      const r = await repository.updateMany({ status: 'pending' }, { status: 'active' });
      expect(r).toEqual({ matchedCount: 2, modifiedCount: 2 });
      expect(mockUserModel.updateMany).toHaveBeenCalledWith(
        { status: 'pending' },
        { status: 'active' },
        {}
      );
    });
  });

  // ── deleteMany ──────────────────────────────────────────────────────────────
  describe('deleteMany', () => {
    test('deletes matching', async () => {
      const r = await repository.deleteMany({ status: 'inactive' });
      expect(r).toEqual({ deletedCount: 1 });
      expect(mockUserModel.deleteMany).toHaveBeenCalledWith({ status: 'inactive' });
    });
  });

  // ── findByIdAndUpdate ───────────────────────────────────────────────────────
  describe('findByIdAndUpdate', () => {
    test('updates and returns user', async () => {
      const r = await repository.findByIdAndUpdate(FAKE_ID, { name: 'U' }, { new: true });
      expect(r).toEqual(mockUser);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        FAKE_ID,
        { name: 'U' },
        { new: true }
      );
    });
  });

  // ── getUserPage ───────────────────────────────────────────────────────────────
  describe('getUserPage', () => {
    test('delegates to userModel.userPage', async () => {
      const r = await repository.getUserPage(
        { status: 'active' },
        { page: 1, limit: 10 },
        { license: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
      expect(r.data.list).toEqual([mockUser]);
      expect(mockUserModel.userPage).toHaveBeenCalledWith(
        { status: 'active' },
        { page: 1, limit: 10 },
        { license: FAKE_LICENSE }
      );
    });
  });

  // ── getUserStatusReportPage ─────────────────────────────────────────────────
  describe('getUserStatusReportPage', () => {
    test('delegates to userModel.userstatusReportPage', async () => {
      const r = await repository.getUserStatusReportPage({ branchid: [FAKE_BRANCH] }, { page: 1 });
      expect(r.status).toBe(true);
      expect(mockUserModel.userstatusReportPage).toHaveBeenCalledWith(
        { branchid: [FAKE_BRANCH] },
        { page: 1 }
      );
    });
  });

  // ── getDataChanges ──────────────────────────────────────────────────────────
  describe('getDataChanges', () => {
    test('delegates to userModel.getDataChanges', async () => {
      const r = await repository.getDataChanges('users', '2024-01-01');
      expect(r).toEqual([mockUser]);
      expect(mockUserModel.getDataChanges).toHaveBeenCalledWith('users', '2024-01-01');
    });
  });

  // ── exportUserOrder ─────────────────────────────────────────────────────────
  describe('exportUserOrder', () => {
    test('delegates to userModel.exportUserOrder', async () => {
      const r = await repository.exportUserOrder({ status: 'active' }, FAKE_LICENSE);
      expect(r).toEqual([mockUser]);
      expect(mockUserModel.exportUserOrder).toHaveBeenCalledWith(
        { status: 'active' },
        FAKE_LICENSE
      );
    });
  });

  // ── userInsertUpdate ────────────────────────────────────────────────────────
  describe('userInsertUpdate', () => {
    test('delegates to userModel.userInsertUpdate', async () => {
      const r = await repository.userInsertUpdate({ name: 'T' }, FAKE_ID, { user: FAKE_ID });
      expect(r.status).toBe(true);
      expect(mockUserModel.userInsertUpdate).toHaveBeenCalledWith({ name: 'T' }, FAKE_ID, {
        user: FAKE_ID,
      });
    });
  });

  // ── getUserAjaxList ─────────────────────────────────────────────────────────
  describe('getUserAjaxList', () => {
    test('returns formatted list from native collection', async () => {
      nativeCol.find.mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            {
              _id: { toString: () => FAKE_ID },
              username: 'u',
              register_id: { toString: () => 'r1' },
              register_name: 'R1',
            },
          ]),
        }),
      });
      const r = await repository.getUserAjaxList('u', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.data[0]).toMatchObject({
        userid: FAKE_ID,
        name: 'u',
        registerid: 'r1',
        registername: 'R1',
      });
    });
    test('returns error on failure', async () => {
      mockNativeCollection.mockImplementation(() => {
        throw new Error('db down');
      });
      const r = await repository.getUserAjaxList('u', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('db down');
    });
  });

  // ── updatePrintSetting ──────────────────────────────────────────────────────
  describe('updatePrintSetting', () => {
    test('updates print setting', async () => {
      mockUserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      const r = await repository.updatePrintSetting(FAKE_ID, FAKE_BRANCH, {
        print_type: 'thermal',
        print_character: '48',
        print_size: 'small',
      });
      expect(r.status).toBe(true);
      expect(r.data).toBe(1);
      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.anything(),
          'printing_design.branch_id': expect.anything(),
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ 'printing_design.$.printing_design': 'thermal' }),
        })
      );
    });
    test('returns error on failure', async () => {
      mockUserModel.updateOne.mockRejectedValue(new Error('fail'));
      const r = await repository.updatePrintSetting(FAKE_ID, FAKE_BRANCH, {
        print_type: 't',
        print_character: '48',
        print_size: 's',
      });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Print setting update failed');
    });
  });

  // ── getPrintType ────────────────────────────────────────────────────────────
  describe('getPrintType', () => {
    test('returns print status', async () => {
      mockUserModel.findById.mockReturnValue(
        mkQuery({ preference: { printing_design: 'thermal' } })
      );
      const r = await repository.getPrintType(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data).toBe('thermal');
    });
    test('returns error when user not found', async () => {
      mockUserModel.findById.mockReturnValue(mkQuery(null));
      const r = await repository.getPrintType(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Print setting retrieval failed');
    });
  });

  // ── getUserRegisterList ─────────────────────────────────────────────────────
  describe('getUserRegisterList', () => {
    test('returns register list from aggregation', async () => {
      nativeCol.aggregate.mockReturnValue({
        toArray: jest
          .fn()
          .mockResolvedValue([
            { _id: { register_id: { toString: () => 'r1' }, register_name: 'R1' } },
          ]),
      });
      const r = await repository.getUserRegisterList(FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.data).toEqual([{ register_id: 'r1', register_name: 'R1' }]);
    });
    test('returns error on failure', async () => {
      mockNativeCollection.mockImplementation(() => {
        throw new Error('agg fail');
      });
      const r = await repository.getUserRegisterList(FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('agg fail');
    });
  });

  // ── verifyUserPassword ────────────────────────────────────────────────────────
  describe('verifyUserPassword', () => {
    test('valid for super_admin with correct password', async () => {
      bcrypt.compare.mockResolvedValue(true);
      mockUserModel.findOne.mockReturnValue(
        mkQuery({ ...mockUser, usertype: 'super_admin', password: 'h' })
      );
      const r = await repository.verifyUserPassword(FAKE_ID, 'p', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.message).toBe('Valid Admin');
    });
    test('invalid for non-super_admin', async () => {
      bcrypt.compare.mockResolvedValue(true);
      mockUserModel.findOne.mockReturnValue(
        mkQuery({ ...mockUser, usertype: 'admin', password: 'h' })
      );
      const r = await repository.verifyUserPassword(FAKE_ID, 'p', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Invalid Admin Password');
    });
    test('not found when user missing', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery(null));
      const r = await repository.verifyUserPassword(FAKE_ID, 'p', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('User not found');
    });
    test('invalid when password mismatch', async () => {
      bcrypt.compare.mockResolvedValue(false);
      mockUserModel.findOne.mockReturnValue(
        mkQuery({ ...mockUser, usertype: 'super_admin', password: 'h' })
      );
      const r = await repository.verifyUserPassword(FAKE_ID, 'wrong', FAKE_BRANCH, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Invalid Admin Password');
    });
  });

  // ── updateUserBranchName ────────────────────────────────────────────────────
  describe('updateUserBranchName', () => {
    test('updates and returns modifiedCount', async () => {
      mockUserModel.updateMany.mockResolvedValue({ modifiedCount: 3 });
      const r = await repository.updateUserBranchName(FAKE_BRANCH, 'New', FAKE_LICENSE);
      expect(r).toBe(3);
    });
    test('rethrows on failure', async () => {
      mockUserModel.updateMany.mockRejectedValue(new Error('fail'));
      await expect(repository.updateUserBranchName(FAKE_BRANCH, 'N', FAKE_LICENSE)).rejects.toThrow(
        'fail'
      );
    });
  });

  // ── updateUserProfileImage ──────────────────────────────────────────────────
  describe('updateUserProfileImage', () => {
    test('updates and returns profile', async () => {
      const r = await repository.updateUserProfileImage(
        FAKE_ID,
        { image: 'a.jpg', name: 'John', lastname: 'Doe' },
        FAKE_LICENSE
      );
      expect(r.status).toBe(true);
      expect(r.data.firstname).toBe('John');
    });
    test('returns error on failure', async () => {
      mockUserModel.updateOne.mockRejectedValue(new Error('fail'));
      const r = await repository.updateUserProfileImage(
        FAKE_ID,
        { image: 'a', name: 'n', lastname: 'l' },
        FAKE_LICENSE
      );
      expect(r.status).toBe(false);
    });
  });

  // ── removeUserImage ─────────────────────────────────────────────────────────
  describe('removeUserImage', () => {
    test('removes image and returns data', async () => {
      const r = await repository.removeUserImage(FAKE_ID, 'user.svg', FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.data).toBe('user.svg');
    });
    test('returns error on failure', async () => {
      mockUserModel.updateOne.mockRejectedValue(new Error('fail'));
      const r = await repository.removeUserImage(FAKE_ID, 'user.svg', FAKE_LICENSE);
      expect(r.status).toBe(false);
    });
  });

  // ── getUserBranchList ───────────────────────────────────────────────────────
  describe('getUserBranchList', () => {
    test('returns branch list with printing design', async () => {
      mockUserModel.findOne
        .mockReturnValueOnce(
          mkQuery({
            branch_access: [
              {
                branch_id: { toString: () => FAKE_BRANCH },
                branch_name: 'Main',
                branch_image: 'store.png',
              },
            ],
          })
        )
        .mockReturnValueOnce(
          mkQuery({
            printing_design: [
              {
                branch_id: { toString: () => FAKE_BRANCH },
                printing_design: 'thermal',
                printing_max_char: '48',
                printing_size: 'small',
              },
            ],
          })
        );
      const r = await repository.getUserBranchList(FAKE_ID, FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(1);
      expect(r.data[0].printing_design).toBe('thermal');
    });
    test('returns error when user not found', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery(null));
      const r = await repository.getUserBranchList(FAKE_ID, FAKE_LICENSE);
      expect(r.status).toBe(false);
      expect(r.message).toBe('User not found');
    });
  });

  // ── getUserByKey ──────────────────────────────────────────────────────────────
  describe('getUserByKey', () => {
    test('returns verified for active key', async () => {
      mockUserModel.findOne.mockReturnValue(
        mkQuery({ userkey: 'abc', expire_date: new Date(Date.now() + 86400000) })
      );
      const r = await repository.getUserByKey('abc');
      expect(r.status).toBe(true);
      expect(r.data).toBe('abc');
    });
    test('returns empty when not found', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery(null));
      const r = await repository.getUserByKey('missing');
      expect(r.status).toBe('empty');
    });
    test('returns false when expired', async () => {
      mockUserModel.findOne.mockReturnValue(
        mkQuery({ userkey: 'old', expire_date: new Date(Date.now() - 86400000) })
      );
      const r = await repository.getUserByKey('old');
      expect(r.status).toBe(false);
      expect(r.message).toContain('expired');
    });
    test('catches exception', async () => {
      mockUserModel.findOne.mockImplementation(() => {
        throw new Error('db fail');
      });
      const r = await repository.getUserByKey('k');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Your key deactivated, please contact posnic admin !');
    });
  });

  // ── updateUserPassword ────────────────────────────────────────────────────────
  describe('updateUserPassword', () => {
    test('updates password when conditions met', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery({ userkey: 'abc', password: 'old' }));
      bcrypt.compare.mockResolvedValue(false);
      const r = await repository.updateUserPassword('new', 'new', 'abc');
      expect(r.status).toBe('success');
      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { userkey: 'abc' },
        expect.objectContaining({ $set: expect.objectContaining({ password: 'hashed-value' }) })
      );
    });
    test('returns exist when userkey mismatch', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery(null));
      const r = await repository.updateUserPassword('a', 'a', 'bad');
      expect(r.status).toBe('exist');
    });
    test('returns false when passwords mismatch', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery({ userkey: 'k', password: 'old' }));
      const r = await repository.updateUserPassword('a', 'b', 'k');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Password mismatch');
    });
    test('returns exist when password unchanged', async () => {
      mockUserModel.findOne.mockReturnValue(mkQuery({ userkey: 'abc', password: 'old' }));
      bcrypt.compare.mockResolvedValue(true);
      const r = await repository.updateUserPassword('new', 'new', 'abc');
      expect(r.status).toBe('exist');
    });
    test('catches exception', async () => {
      mockUserModel.findOne.mockImplementation(() => {
        throw new Error('db fail');
      });
      const r = await repository.updateUserPassword('a', 'a', 'k');
      expect(r.status).toBe(false);
      expect(r.message).toBe('db fail');
    });
  });

  // ── findCustomerById ──────────────────────────────────────────────────────────
  describe('findCustomerById', () => {
    test('returns customer from native collection', async () => {
      nativeCol.findOne.mockResolvedValue({ _id: FAKE_ID, name: 'C' });
      const r = await repository.findCustomerById(FAKE_ID);
      expect(r).toEqual({ _id: FAKE_ID, name: 'C' });
    });
    test('returns null on failure', async () => {
      nativeCol.findOne.mockRejectedValue(new Error('fail'));
      const r = await repository.findCustomerById(FAKE_ID);
      expect(r).toBeNull();
    });
  });

  // ── findActiveSsoToken ──────────────────────────────────────────────────────
  describe('findActiveSsoToken', () => {
    test('returns active token', async () => {
      nativeCol.findOne.mockResolvedValue({ token: 'abc', status: 'active' });
      const r = await repository.findActiveSsoToken('abc');
      expect(r).toEqual({ token: 'abc', status: 'active' });
    });
    test('returns null on failure', async () => {
      nativeCol.findOne.mockRejectedValue(new Error('fail'));
      const r = await repository.findActiveSsoToken('abc');
      expect(r).toBeNull();
    });
  });

  // ── createSsoToken ────────────────────────────────────────────────────────────
  describe('createSsoToken', () => {
    test('creates token and returns insertedId', async () => {
      nativeCol.insertOne.mockResolvedValue({ insertedId: FAKE_ID });
      const r = await repository.createSsoToken({ token: 'abc', status: 'active' });
      expect(r).toBe(FAKE_ID);
    });
    test('throws on failure', async () => {
      nativeCol.insertOne.mockRejectedValue(new Error('fail'));
      await expect(repository.createSsoToken({})).rejects.toThrow('Failed to create SSO token');
    });
  });

  // ── findBranchesWithKiosk ─────────────────────────────────────────────────────
  describe('findBranchesWithKiosk', () => {
    test('returns branches from native collection', async () => {
      nativeCol.find.mockReturnValue(mkNativeChain([{ _id: FAKE_BRANCH }]));
      const r = await repository.findBranchesWithKiosk([FAKE_BRANCH]);
      expect(r).toEqual([{ _id: FAKE_BRANCH }]);
    });
    test('returns empty array on failure', async () => {
      nativeCol.find.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await repository.findBranchesWithKiosk([FAKE_BRANCH]);
      expect(r).toEqual([]);
    });
  });
});
