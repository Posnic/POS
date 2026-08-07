'use strict';

/**
 * Unit tests for src/services/users.service.js
 *
 * Export type : SINGLETON — module.exports = new UsersService()
 * Base class  : None
 *
 * PRODUCTION BUGS FOUND:
 *   BUG-1 (authenticateUser): ERROR_MESSAGES.NO_BRANCHES used without import →
 *     ReferenceError caught → returns {status:false, message:'ERROR_MESSAGES is not defined'}
 *     instead of intended {status:'none', message:'User Have not Any Branch'}.
 *     Fix: add module-level import of ERROR_MESSAGES from users.constants.
 *
 *   BUG-2 (ssoAuthentication): `ssoCollection.updateOne(...)` called but `ssoCollection`
 *     is never defined anywhere in the file → ReferenceError always thrown after valid token
 *     found → successful SSO auth is impossible in production.
 *     Fix: replace with this.repository.deactivateSsoToken(token).
 *
 *   BUG-3 (security): authenticateUser returns the raw user object including password hash.
 *     Fix: delete user.password before returning.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/repositories/user.repository', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  deleteMany: jest.fn(),
  getUserPage: jest.fn(),
  getUserBranchList: jest.fn(),
  updateUserProfileImage: jest.fn(),
  updatePrintSetting: jest.fn(),
  getPrintType: jest.fn(),
  getUserRegisterList: jest.fn(),
  verifyUserPassword: jest.fn(),
  updateUserPassword: jest.fn(),
  getUserByKey: jest.fn(),
  getUserAjaxList: jest.fn(),
  getUserStatusReportPage: jest.fn(),
  exportUserOrder: jest.fn(),
  getDataChanges: jest.fn(),
  updateUserBranchName: jest.fn(),
  removeUserImage: jest.fn(),
  findCustomerById: jest.fn(),
  findActiveSsoToken: jest.fn(),
  deactivateSsoToken: jest.fn(),
  createSsoToken: jest.fn(),
  findBranchesWithKiosk: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../src/models/user.model', () => ({
  userInsertUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

jest.mock('mongoose', () => {
  function MockObjectId(id) {
    this._id = id;
    this.toString = () => String(id);
  }
  MockObjectId.isValid = jest.fn().mockReturnValue(true);
  return { Types: { ObjectId: MockObjectId } };
});

jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({ toString: () => 'mockhex' })),
  createHmac: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mocksig'),
  })),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const Branch = require('../../../src/models/branch.model');
const UserModel = require('../../../src/models/user.model');
const repository = require('../../../src/repositories/user.repository');
const service = require('../../../src/services/user.service');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_USER_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_BRANCH_ID = '64f8f2f4c2b9c0a1e4000002';
const FAKE_LICENSE = '64f8f2f4c2b9c0a1e4000003';

const mockUser = {
  _id: FAKE_USER_ID,
  firstname: 'Test',
  lastname: 'User',
  email: 'test@example.com',
  username: 'testuser',
  password: '$2a$10$hashedpassword',
  license: FAKE_LICENSE,
  activate: true,
  usertype: 'admin',
  branch_access: [{ branch_id: FAKE_BRANCH_ID, branch_name: 'Main' }],
  registers: [],
};

const mockBranch = {
  _id: FAKE_BRANCH_ID,
  branch_name: 'Main Branch',
  logo: 'logo.png',
  store_telephone: '9876543210',
  store_email: 'branch@test.com',
  store_address: '123 St',
  default_customer: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersService (singleton)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockResolvedValue(false);
    Branch.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(mockBranch) });
    Branch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(mockBranch) });
  });

  // ── createUser ─────────────────────────────────────────────────────────────

  describe('createUser', () => {
    test('passes empty string as userId to userModel.userInsertUpdate', async () => {
      UserModel.userInsertUpdate.mockResolvedValue({ status: true, data: mockUser });
      await service.createUser({ name: 'Test' }, { license: FAKE_LICENSE });
      expect(UserModel.userInsertUpdate).toHaveBeenCalledWith({ name: 'Test' }, '', {
        license: FAKE_LICENSE,
      });
    });

    test('returns result of userModel.userInsertUpdate', async () => {
      const res = { status: true, data: mockUser, message: 'created' };
      UserModel.userInsertUpdate.mockResolvedValue(res);
      const r = await service.createUser({}, {});
      expect(r).toEqual(res);
    });

    test('returns status:false on throw', async () => {
      UserModel.userInsertUpdate.mockRejectedValue(new Error('Insert failed'));
      const r = await service.createUser({}, {});
      expect(r).toEqual({ status: false, data: null, message: 'Insert failed' });
    });
  });

  // ── updateUser ─────────────────────────────────────────────────────────────

  describe('updateUser', () => {
    test('passes userId to userModel.userInsertUpdate', async () => {
      UserModel.userInsertUpdate.mockResolvedValue({ status: true });
      await service.updateUser(FAKE_USER_ID, { name: 'X' }, {});
      expect(UserModel.userInsertUpdate).toHaveBeenCalledWith({ name: 'X' }, FAKE_USER_ID, {});
    });

    test('returns status:false on throw', async () => {
      UserModel.userInsertUpdate.mockRejectedValue(new Error('Update failed'));
      const r = await service.updateUser(FAKE_USER_ID, {}, {});
      expect(r.status).toBe(false);
      expect(r.message).toBe('Update failed');
    });
  });

  // ── getUserById ────────────────────────────────────────────────────────────

  describe('getUserById', () => {
    test('returns status:false when user not found', async () => {
      repository.findById.mockResolvedValue(null);
      const r = await service.getUserById(FAKE_USER_ID);
      expect(r).toEqual({ status: false, data: null, message: 'User not found' });
    });

    test('returns status:true with user on success', async () => {
      repository.findById.mockResolvedValue({ ...mockUser });
      const r = await service.getUserById(FAKE_USER_ID);
      expect(r.status).toBe(true);
      expect(r.data.email).toBe('test@example.com');
    });

    test('sets registers default to [] when missing', async () => {
      repository.findById.mockResolvedValue({ ...mockUser, registers: undefined });
      const r = await service.getUserById(FAKE_USER_ID);
      expect(r.data.registers).toEqual([]);
    });

    test('sets branch_access default to [] when missing', async () => {
      repository.findById.mockResolvedValue({ ...mockUser, branch_access: undefined });
      const r = await service.getUserById(FAKE_USER_ID);
      expect(r.data.branch_access).toEqual([]);
    });

    test('passes options to repository.findById', async () => {
      repository.findById.mockResolvedValue({ ...mockUser });
      await service.getUserById(FAKE_USER_ID, { select: '+password' });
      expect(repository.findById).toHaveBeenCalledWith(FAKE_USER_ID, { select: '+password' });
    });

    test('returns status:false on throw', async () => {
      repository.findById.mockRejectedValue(new Error('DB error'));
      const r = await service.getUserById(FAKE_USER_ID);
      expect(r.status).toBe(false);
    });
  });

  // ── getUsersList ───────────────────────────────────────────────────────────

  describe('getUsersList', () => {
    test('delegates to repository.getUserPage', async () => {
      const page = { data: [mockUser], total: 1 };
      repository.getUserPage.mockResolvedValue(page);
      const r = await service.getUsersList(
        { active: true },
        { page: 1 },
        { license: FAKE_LICENSE }
      );
      expect(r).toEqual(page);
    });

    test('returns status:false on throw', async () => {
      repository.getUserPage.mockRejectedValue(new Error('List error'));
      const r = await service.getUsersList({}, {}, {});
      expect(r).toEqual({ status: false, data: null, message: 'List error' });
    });
  });

  // ── deleteUsers ────────────────────────────────────────────────────────────

  describe('deleteUsers', () => {
    const ctx = { license: FAKE_LICENSE };

    test('returns status:false when no matching users found', async () => {
      repository.find.mockResolvedValue([]);
      const r = await service.deleteUsers([FAKE_USER_ID], ctx);
      expect(r).toEqual({ status: false, data: null, message: 'No users found to delete' });
      expect(repository.deleteMany).not.toHaveBeenCalled();
    });

    test('returns status:true with deletedCount on success', async () => {
      repository.find.mockResolvedValue([mockUser]);
      repository.deleteMany.mockResolvedValue({ deletedCount: 1 });
      const r = await service.deleteUsers([FAKE_USER_ID], ctx);
      expect(r).toEqual({ status: true, data: 1, message: 'User deleted successfully' });
    });

    test('passes license from context in the find condition', async () => {
      repository.find.mockResolvedValue([mockUser]);
      repository.deleteMany.mockResolvedValue({ deletedCount: 1 });
      await service.deleteUsers([FAKE_USER_ID], ctx);
      const [cond] = repository.find.mock.calls[0];
      expect(cond.license).toBe(FAKE_LICENSE);
    });

    test('returns status:false on throw', async () => {
      repository.find.mockRejectedValue(new Error('Find error'));
      const r = await service.deleteUsers([FAKE_USER_ID], ctx);
      expect(r.status).toBe(false);
    });
  });

  // ── authenticateUser ───────────────────────────────────────────────────────

  describe('authenticateUser', () => {
    test('returns status:incorrect when user not found', async () => {
      repository.findOne.mockResolvedValue(null);
      const r = await service.authenticateUser('testuser', 'pass');
      expect(r).toEqual({
        status: 'incorrect',
        data: null,
        message: 'Incorrect username or password',
      });
    });

    test('returns status:incorrect when both bcrypt comparisons fail', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      bcrypt.compare.mockResolvedValue(false);
      const r = await service.authenticateUser('testuser', 'wrong');
      expect(r.status).toBe('incorrect');
    });

    test('succeeds when base64 bcrypt comparison passes', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      bcrypt.compare.mockResolvedValueOnce(true);
      const r = await service.authenticateUser('testuser', 'correct');
      expect(r.status).toBe(true);
      expect(r.data).toBeDefined();
    });

    test('succeeds when plain bcrypt comparison passes (base64 fails first)', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      bcrypt.compare.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const r = await service.authenticateUser('testuser', 'correct');
      expect(r.status).toBe(true);
    });

    test('normalizes username to lowercase before query', async () => {
      repository.findOne.mockResolvedValue(null);
      await service.authenticateUser('TestUser', 'pass');
      const [filter] = repository.findOne.mock.calls[0];
      expect(filter.$or[0].email).toBe('testuser');
    });

    test('a user with no branch access is told so, not handed a ReferenceError', async () => {
      /* ERROR_MESSAGES was used without being imported, so this path threw and
         the catch turned it into status:false carrying the ReferenceError text.
         Now imported, so the intended answer comes back. */
      repository.findOne.mockResolvedValue({ ...mockUser, branch_access: [] });
      bcrypt.compare.mockResolvedValueOnce(true);
      const r = await service.authenticateUser('testuser', 'pass');
      expect(r.status).toBe('none');
      expect(r.message).toBe('User Have not Any Branch');
    });

    test('the password hash does not come back with the user', async () => {
      /* findOne asks for +password so bcrypt can compare it, and the whole user
         object was then returned with the hash still attached - into
         controllers that serialise it into responses and sessions. */
      repository.findOne.mockResolvedValue({ ...mockUser });
      bcrypt.compare.mockResolvedValueOnce(true);
      const r = await service.authenticateUser('testuser', 'pass');
      expect(r.status).toBe(true);
      expect(r.data).not.toHaveProperty('password');
      expect(r.data.username).toBe(mockUser.username);
    });

    test('returns status:false on repository throw', async () => {
      repository.findOne.mockRejectedValue(new Error('Auth error'));
      const r = await service.authenticateUser('u', 'p');
      expect(r.status).toBe(false);
    });
  });

  // ── simple delegation methods ──────────────────────────────────────────────

  describe('getUserBranches', () => {
    test('delegates to repository.getUserBranchList', async () => {
      const result = [{ branch_id: FAKE_BRANCH_ID }];
      repository.getUserBranchList.mockResolvedValue(result);
      expect(await service.getUserBranches(FAKE_USER_ID, FAKE_LICENSE)).toEqual(result);
      expect(repository.getUserBranchList).toHaveBeenCalledWith(FAKE_USER_ID, FAKE_LICENSE);
    });
    test('returns status:false on throw', async () => {
      repository.getUserBranchList.mockRejectedValue(new Error('err'));
      expect((await service.getUserBranches(FAKE_USER_ID, FAKE_LICENSE)).status).toBe(false);
    });
  });

  describe('updateUserProfile', () => {
    test('delegates to repository.updateUserProfileImage', async () => {
      repository.updateUserProfileImage.mockResolvedValue({ status: true });
      await service.updateUserProfile(FAKE_USER_ID, { image: 'x.jpg' }, FAKE_LICENSE);
      expect(repository.updateUserProfileImage).toHaveBeenCalledWith(
        FAKE_USER_ID,
        { image: 'x.jpg' },
        FAKE_LICENSE
      );
    });
    test('returns status:false on throw', async () => {
      repository.updateUserProfileImage.mockRejectedValue(new Error('err'));
      expect((await service.updateUserProfile(FAKE_USER_ID, {}, FAKE_LICENSE)).status).toBe(false);
    });
  });

  describe('updatePrintSettings', () => {
    test('delegates to repository.updatePrintSetting', async () => {
      repository.updatePrintSetting.mockResolvedValue({ status: true });
      await service.updatePrintSettings(FAKE_USER_ID, FAKE_BRANCH_ID, {});
      expect(repository.updatePrintSetting).toHaveBeenCalled();
    });
    test('returns status:false on throw', async () => {
      repository.updatePrintSetting.mockRejectedValue(new Error('err'));
      expect((await service.updatePrintSettings(FAKE_USER_ID, FAKE_BRANCH_ID, {})).status).toBe(
        false
      );
    });
  });

  describe('getPrintTypes', () => {
    test('delegates to repository.getPrintType', async () => {
      repository.getPrintType.mockResolvedValue(['thermal']);
      expect(await service.getPrintTypes(FAKE_USER_ID)).toEqual(['thermal']);
    });
    test('returns status:false on throw', async () => {
      repository.getPrintType.mockRejectedValue(new Error('err'));
      expect((await service.getPrintTypes(FAKE_USER_ID)).status).toBe(false);
    });
  });

  describe('getRegisterList', () => {
    test('delegates to repository.getUserRegisterList', async () => {
      repository.getUserRegisterList.mockResolvedValue([{ id: 'r1' }]);
      await service.getRegisterList(FAKE_BRANCH_ID, FAKE_LICENSE);
      expect(repository.getUserRegisterList).toHaveBeenCalledWith(FAKE_BRANCH_ID, FAKE_LICENSE);
    });
    test('returns status:false on throw', async () => {
      repository.getUserRegisterList.mockRejectedValue(new Error('err'));
      expect((await service.getRegisterList(FAKE_BRANCH_ID, FAKE_LICENSE)).status).toBe(false);
    });
  });

  describe('verifyAdminPassword', () => {
    test('delegates to repository.verifyUserPassword', async () => {
      repository.verifyUserPassword.mockResolvedValue({ status: true });
      await service.verifyAdminPassword(FAKE_USER_ID, 'pass', FAKE_BRANCH_ID, FAKE_LICENSE);
      expect(repository.verifyUserPassword).toHaveBeenCalledWith(
        FAKE_USER_ID,
        'pass',
        FAKE_BRANCH_ID,
        FAKE_LICENSE
      );
    });
    test('returns status:false on throw', async () => {
      repository.verifyUserPassword.mockRejectedValue(new Error('err'));
      expect(
        (await service.verifyAdminPassword(FAKE_USER_ID, 'p', FAKE_BRANCH_ID, FAKE_LICENSE)).status
      ).toBe(false);
    });
  });

  describe('resetPassword', () => {
    test('delegates to repository.updateUserPassword', async () => {
      repository.updateUserPassword.mockResolvedValue({ status: true });
      await service.resetPassword('key', 'p1', 'p1');
      expect(repository.updateUserPassword).toHaveBeenCalledWith('key', 'p1', 'p1');
    });
    test('returns status:false on throw', async () => {
      repository.updateUserPassword.mockRejectedValue(new Error('err'));
      expect((await service.resetPassword('k', 'p', 'p')).status).toBe(false);
    });
  });

  describe('verifyResetKey', () => {
    test('delegates to repository.getUserByKey', async () => {
      repository.getUserByKey.mockResolvedValue({ status: true });
      await service.verifyResetKey('reset-key');
      expect(repository.getUserByKey).toHaveBeenCalledWith('reset-key');
    });
    test('returns status:false on throw', async () => {
      repository.getUserByKey.mockRejectedValue(new Error('err'));
      expect((await service.verifyResetKey('k')).status).toBe(false);
    });
  });

  describe('getUserAjaxSuggestions', () => {
    test('delegates to repository.getUserAjaxList', async () => {
      repository.getUserAjaxList.mockResolvedValue([mockUser]);
      await service.getUserAjaxSuggestions('q', FAKE_BRANCH_ID, FAKE_LICENSE);
      expect(repository.getUserAjaxList).toHaveBeenCalledWith('q', FAKE_BRANCH_ID, FAKE_LICENSE);
    });
    test('returns status:false on throw', async () => {
      repository.getUserAjaxList.mockRejectedValue(new Error('err'));
      expect((await service.getUserAjaxSuggestions('q', FAKE_BRANCH_ID, FAKE_LICENSE)).status).toBe(
        false
      );
    });
  });

  describe('getUserStatusReport', () => {
    test('delegates to repository.getUserStatusReportPage', async () => {
      repository.getUserStatusReportPage.mockResolvedValue({ data: [] });
      expect(await service.getUserStatusReport({}, {})).toEqual({ data: [] });
    });
    test('returns status:false on throw', async () => {
      repository.getUserStatusReportPage.mockRejectedValue(new Error('err'));
      expect((await service.getUserStatusReport({}, {})).status).toBe(false);
    });
  });

  describe('exportUsers', () => {
    test('delegates to repository.exportUserOrder', async () => {
      repository.exportUserOrder.mockResolvedValue([mockUser]);
      await service.exportUsers([FAKE_USER_ID], FAKE_LICENSE);
      expect(repository.exportUserOrder).toHaveBeenCalledWith([FAKE_USER_ID], FAKE_LICENSE);
    });
    test('returns status:false on throw', async () => {
      repository.exportUserOrder.mockRejectedValue(new Error('err'));
      expect((await service.exportUsers([], FAKE_LICENSE)).status).toBe(false);
    });
  });

  describe('getDataChanges', () => {
    test('delegates to repository.getDataChanges', async () => {
      repository.getDataChanges.mockResolvedValue([]);
      await service.getDataChanges('users', '2024-01-01');
      expect(repository.getDataChanges).toHaveBeenCalledWith('users', '2024-01-01');
    });
    test('returns status:false on throw', async () => {
      repository.getDataChanges.mockRejectedValue(new Error('err'));
      expect((await service.getDataChanges('m', 'd')).status).toBe(false);
    });
  });

  describe('removeUserImage', () => {
    test('delegates to repository.removeUserImage', async () => {
      repository.removeUserImage.mockResolvedValue({ status: true });
      await service.removeUserImage(FAKE_USER_ID, 'img.jpg', FAKE_LICENSE);
      expect(repository.removeUserImage).toHaveBeenCalledWith(
        FAKE_USER_ID,
        'img.jpg',
        FAKE_LICENSE
      );
    });
    test('returns status:false on throw', async () => {
      repository.removeUserImage.mockRejectedValue(new Error('err'));
      expect((await service.removeUserImage(FAKE_USER_ID, 'img', FAKE_LICENSE)).status).toBe(false);
    });
  });

  // ── updateBranchName ───────────────────────────────────────────────────────

  describe('updateBranchName', () => {
    test('wraps modifiedCount in status:true response', async () => {
      repository.updateUserBranchName.mockResolvedValue(5);
      const r = await service.updateBranchName(FAKE_BRANCH_ID, 'New Name', FAKE_LICENSE);
      expect(r).toEqual({ status: true, data: 5, message: 'Branch name updated successfully' });
    });

    test('calls repository with correct args', async () => {
      repository.updateUserBranchName.mockResolvedValue(2);
      await service.updateBranchName(FAKE_BRANCH_ID, 'Branch X', FAKE_LICENSE);
      expect(repository.updateUserBranchName).toHaveBeenCalledWith(
        FAKE_BRANCH_ID,
        'Branch X',
        FAKE_LICENSE
      );
    });

    test('returns status:false on throw', async () => {
      repository.updateUserBranchName.mockRejectedValue(new Error('Branch name error'));
      const r = await service.updateBranchName(FAKE_BRANCH_ID, 'X', FAKE_LICENSE);
      expect(r.status).toBe(false);
    });
  });

  // ── changeBranch ───────────────────────────────────────────────────────────

  describe('changeBranch', () => {
    const mongoose = require('mongoose');

    beforeEach(() => {
      mongoose.Types.ObjectId.isValid.mockReturnValue(true);
      repository.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    });

    test('returns status:false when branchId is invalid ObjectId', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValue(false);
      const r = await service.changeBranch('bad-id', FAKE_USER_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Invalid branch ID' });
      expect(Branch.findOne).not.toHaveBeenCalled();
    });

    test('returns status:false when branch not found', async () => {
      Branch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Branch not found' });
    });

    test('returns status:true with branch data', async () => {
      repository.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID, FAKE_LICENSE);
      expect(r.status).toBe(true);
      expect(r.data.branch_name).toBe('Main Branch');
      expect(r.data.user_id).toBe(String(FAKE_USER_ID));
      expect(r.data.license).toBe(String(FAKE_LICENSE));
      expect(repository.updateOne).toHaveBeenCalledWith(
        {
          _id: FAKE_USER_ID,
          license: FAKE_LICENSE,
          'branch_access.branch_id': FAKE_BRANCH_ID,
        },
        { $set: { branch: FAKE_BRANCH_ID, branch_id: FAKE_BRANCH_ID } }
      );
    });

    test('rejects switching when persisted user access no longer includes the branch', async () => {
      repository.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID, FAKE_LICENSE);
      expect(r).toEqual({
        status: false,
        data: null,
        message: 'You do not have access to the selected branch',
      });
    });

    test('uses empty customer defaults when no default_customer on branch', async () => {
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID);
      expect(r.data.customer_name).toBe('');
    });

    test('uses default_customer when branch.default_customer is set', async () => {
      Branch.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...mockBranch, default_customer: FAKE_USER_ID }),
      });
      repository.findCustomerById.mockResolvedValue({
        name: 'Walk-in',
        phone: '0000',
        email: '',
        address: '',
      });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID);
      expect(r.data.customer_name).toBe('Walk-in');
    });

    test('uses DEFAULTS.BRANCH_IMAGE when branch.logo is missing', async () => {
      Branch.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ...mockBranch, logo: undefined }),
      });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID);
      expect(r.data.branch_logo).toBe('store.png');
    });

    test('returns status:false on throw', async () => {
      Branch.findOne.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB err')) });
      const r = await service.changeBranch(FAKE_BRANCH_ID, FAKE_USER_ID);
      expect(r.status).toBe(false);
    });
  });

  // ── ssoAuthentication ──────────────────────────────────────────────────────

  describe('ssoAuthentication', () => {
    const validSso = {
      token: 'sso.tok.abc',
      email: 'test@example.com',
      license: FAKE_LICENSE,
      expire_date: new Date(Date.now() + 600_000),
      status: 'active',
    };

    test('returns status:false when SSO token not found', async () => {
      repository.findActiveSsoToken.mockResolvedValue(null);
      const r = await service.ssoAuthentication('bad');
      expect(r).toEqual({ status: false, data: null, message: 'Invalid or expired SSO token' });
    });

    test('returns status:false when SSO token is expired', async () => {
      repository.findActiveSsoToken.mockResolvedValue({
        ...validSso,
        expire_date: new Date(Date.now() - 1000),
      });
      const r = await service.ssoAuthentication('exp');
      expect(r).toEqual({ status: false, data: null, message: 'SSO token has expired' });
    });

    test('a valid token authenticates, and is retired so it cannot be reused', async () => {
      /* The service reached for a bare `ssoCollection`, a name that only ever
         existed in the repository, so this threw ReferenceError every time:
         SSO sign-in could not succeed, and the single-use token was never
         retired. */
      repository.findActiveSsoToken.mockResolvedValue(validSso);
      repository.deactivateSsoToken.mockResolvedValue({ modifiedCount: 1 });
      repository.findOne.mockResolvedValue({ ...mockUser, email: validSso.email });

      const r = await service.ssoAuthentication('sso.tok.abc');

      expect(r.status).toBe(true);
      expect(repository.deactivateSsoToken).toHaveBeenCalledWith('sso.tok.abc');
    });
  });

  // ── generateSsoToken ───────────────────────────────────────────────────────

  describe('generateSsoToken', () => {
    test('returns status:false when user not found', async () => {
      repository.findOne.mockResolvedValue(null);
      const r = await service.generateSsoToken('nobody@test.com', 'UTC');
      expect(r).toEqual({ status: false, data: null, message: 'User not found' });
      expect(repository.createSsoToken).not.toHaveBeenCalled();
    });

    test('returns status:true with token string on success', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      repository.createSsoToken.mockResolvedValue(undefined);
      const r = await service.generateSsoToken('test@example.com', 'Asia/Kolkata');
      expect(r.status).toBe(true);
      expect(typeof r.data.token).toBe('string');
      expect(r.message).toBe('SSO token generated successfully');
    });

    test('saves correct email and license in SSO record', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      repository.createSsoToken.mockResolvedValue(undefined);
      await service.generateSsoToken('test@example.com', 'UTC');
      const [ssoData] = repository.createSsoToken.mock.calls[0];
      expect(ssoData.email).toBe('test@example.com');
      expect(ssoData.status).toBe('active');
    });

    test('defaults timezone to UTC when not provided', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser });
      repository.createSsoToken.mockResolvedValue(undefined);
      await service.generateSsoToken('test@example.com');
      const [ssoData] = repository.createSsoToken.mock.calls[0];
      expect(ssoData.timezone).toBe('UTC');
    });

    test('returns status:false on throw', async () => {
      repository.findOne.mockRejectedValue(new Error('SSO err'));
      const r = await service.generateSsoToken('test@example.com', 'UTC');
      expect(r.status).toBe(false);
    });
  });

  // ── updateUserPlan ─────────────────────────────────────────────────────────

  describe('updateUserPlan', () => {
    const planData = {
      name: 'Pro',
      max_sales: 1000,
      plan_expire: '2026-12-31',
      access: 'true',
      plan_access: JSON.stringify({ dashboard: true }),
    };

    test('calls userModel.updateOne and returns success', async () => {
      UserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      const r = await service.updateUserPlan(FAKE_LICENSE, 'test@example.com', planData);
      expect(UserModel.updateOne).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ status: true, data: null, message: 'Plan updated successfully' });
    });

    test('parses plan_access JSON string before saving', async () => {
      UserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      await service.updateUserPlan(FAKE_LICENSE, 'test@example.com', planData);
      const [, update] = UserModel.updateOne.mock.calls[0];
      expect(update.$set.plan_access).toEqual({ dashboard: true });
    });

    test('keeps plan_access as object when already parsed', async () => {
      UserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      await service.updateUserPlan(FAKE_LICENSE, 'e@e.com', {
        ...planData,
        plan_access: { ok: true },
      });
      const [, update] = UserModel.updateOne.mock.calls[0];
      expect(update.$set.plan_access).toEqual({ ok: true });
    });

    test('returns status:false on throw', async () => {
      UserModel.updateOne.mockRejectedValue(new Error('Plan DB error'));
      const r = await service.updateUserPlan(FAKE_LICENSE, 'e@e.com', planData);
      expect(r.status).toBe(false);
    });
  });

  // ── mobileLogin ────────────────────────────────────────────────────────────

  describe('mobileLogin', () => {
    test('returns status:false when user not found', async () => {
      repository.findOne.mockResolvedValue(null);
      const r = await service.mobileLogin('testuser', 'pass');
      expect(r.status).toBe(false);
      expect(r.message).toBe('User not found');
    });

    test('returns status:false when account not activated', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser, activate: false });
      const r = await service.mobileLogin('testuser', 'pass');
      expect(r.status).toBe(false);
      expect(r.message).toBe('User account is not activated');
    });

    test('returns status:false when password invalid', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser, activate: true });
      bcrypt.compare.mockResolvedValue(false);
      const r = await service.mobileLogin('testuser', 'wrong');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Invalid password');
    });

    test('returns status:true with branch_access on success', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser, activate: true });
      bcrypt.compare.mockResolvedValue(true);
      const r = await service.mobileLogin('testuser', 'correct');
      expect(r.status).toBe(true);
      expect(r.message).toBe('Successfully login');
    });

    test('returns empty array when branch_access is undefined', async () => {
      repository.findOne.mockResolvedValue({
        ...mockUser,
        activate: true,
        branch_access: undefined,
      });
      bcrypt.compare.mockResolvedValue(true);
      const r = await service.mobileLogin('testuser', 'pass');
      expect(r.data).toEqual([]);
    });

    test('returns status:false on throw', async () => {
      repository.findOne.mockRejectedValue(new Error('Mobile err'));
      const r = await service.mobileLogin('u', 'p');
      expect(r.status).toBe(false);
    });
  });

  // ── kioskLogin ─────────────────────────────────────────────────────────────

  describe('kioskLogin', () => {
    const kioskUser = {
      ...mockUser,
      activate: true,
      username: 'testuser',
      branch_access: [{ branch_id: FAKE_BRANCH_ID, branch_name: 'Main', branch_image: 'logo.png' }],
    };

    test('returns status:incorrect when user not found', async () => {
      repository.findOne.mockResolvedValue(null);
      const r = await service.kioskLogin('testuser', 'pass');
      expect(r).toEqual({ status: 'incorrect', data: null, message: 'Invalid credentials' });
    });

    test('returns status:incorrect when password invalid', async () => {
      repository.findOne.mockResolvedValue(kioskUser);
      bcrypt.compare.mockResolvedValue(false);
      const r = await service.kioskLogin('testuser', 'wrong');
      expect(r.status).toBe('incorrect');
    });

    test('returns status:incorrect when user not activated', async () => {
      repository.findOne.mockResolvedValue({ ...kioskUser, activate: false });
      bcrypt.compare.mockResolvedValue(true);
      const r = await service.kioskLogin('testuser', 'pass');
      expect(r.status).toBe('incorrect');
    });

    test('returns status:true with filtered branches on success', async () => {
      repository.findOne.mockResolvedValue(kioskUser);
      bcrypt.compare.mockResolvedValue(true);
      repository.findBranchesWithKiosk.mockResolvedValue([
        {
          kiosk: [
            {
              branch_id: FAKE_BRANCH_ID,
              store_id: 'STORE-01',
              payment_cod: true,
              payment_number: false,
              payment_razorpay: null,
            },
          ],
        },
      ]);
      const r = await service.kioskLogin('testuser', 'correct');
      expect(r.status).toBe(true);
      const branch = r.data[0];
      expect(branch.store_id).toBe('STORE-01');
      expect(branch.branch_id).toBe(String(FAKE_BRANCH_ID));
    });

    test('excludes branches without store_id from result', async () => {
      repository.findOne.mockResolvedValue(kioskUser);
      bcrypt.compare.mockResolvedValue(true);
      repository.findBranchesWithKiosk.mockResolvedValue([
        {
          kiosk: [{ branch_id: FAKE_BRANCH_ID }], // no store_id
        },
      ]);
      const r = await service.kioskLogin('testuser', 'pass');
      expect(r.data).toHaveLength(0);
    });

    test('returns status:false on throw', async () => {
      repository.findOne.mockRejectedValue(new Error('Kiosk err'));
      const r = await service.kioskLogin('u', 'p');
      expect(r.status).toBe(false);
    });
  });
});
