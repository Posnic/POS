'use strict';

/**
 * Unit tests for src/services/authorization.service.js (manager-PIN elevation).
 * The User model, bcrypt, audit service and mongoose are all mocked, so no real
 * DB / hashing is exercised.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('mongoose', () => {
  function MockObjectId(id) {
    this._id = id;
    this.toString = () => String(id);
  }
  MockObjectId.isValid = (v) => (typeof v === 'string' ? v.length >= 12 : !!v);
  return { Types: { ObjectId: MockObjectId } };
});

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('HASHED'),
  compare: jest.fn(),
}));

jest.mock('../../../src/models/user.model', () => ({
  updateOne: jest.fn(),
  find: jest.fn(),
}));

const mockRecord = jest.fn().mockResolvedValue({ status: true });
jest.mock('../../../src/services/audit.service', () => ({
  AuditService: class {
    record(...args) {
      return mockRecord(...args);
    }
  },
  AUDIT_EVENTS: { MANAGER_APPROVAL: 'manager_approval' },
}));

jest.mock('../../../src/models/base.model', () => ({ loggedUser: null, loggedUserName: null }));

const bcrypt = require('bcryptjs');
const User = require('../../../src/models/user.model');
const service = require('../../../src/services/authorization.service');

const VALID_ID = '507f1f77bcf86cd799439011';

// Helper: make User.find(...).select(...).lean() resolve to `candidates`.
const mockCandidates = (candidates) => {
  User.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(candidates) }) });
};

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.hash.mockResolvedValue('HASHED');
});

describe('setManagerPin', () => {
  test('rejects a missing/invalid user id', async () => {
    const r = await service.setManagerPin({ userId: 'bad', pin: '1234' });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(400);
  });

  test('rejects a non 4-8 digit PIN', async () => {
    const r = await service.setManagerPin({ userId: VALID_ID, pin: '12' });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(400);
    const r2 = await service.setManagerPin({ userId: VALID_ID, pin: 'abcd' });
    expect(r2.status).toBe(false);
  });

  test('hashes and stores a valid PIN', async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await service.setManagerPin({ userId: VALID_ID, pin: '4821', license: 'L1' });
    expect(bcrypt.hash).toHaveBeenCalledWith('4821', 10);
    expect(User.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ license: 'L1' }),
      { $set: { manager_pin: 'HASHED' } }
    );
    expect(r.status).toBe(true);
  });

  test('an empty PIN clears the hash (no hashing)', async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await service.setManagerPin({ userId: VALID_ID, pin: '' });
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(User.updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: { manager_pin: null },
    });
    expect(r.message).toMatch(/cleared/i);
  });

  test('returns 404 when the user is not found', async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 0 });
    const r = await service.setManagerPin({ userId: VALID_ID, pin: '4821' });
    expect(r.statusCode).toBe(404);
  });
});

describe('verifyManagerPin', () => {
  test('rejects a missing PIN or action', async () => {
    expect((await service.verifyManagerPin({ pin: '', action: 'void_sale' })).statusCode).toBe(400);
    expect((await service.verifyManagerPin({ pin: '1234', action: '' })).statusCode).toBe(400);
  });

  test('approves when an allowed manager PIN matches, and records the approval', async () => {
    mockCandidates([
      { _id: 'm1', usertype: 'cashier', firstname: 'Meera', access: { pos: { void_sale: true } }, manager_pin: 'H' },
    ]);
    bcrypt.compare.mockResolvedValue(true);
    const r = await service.verifyManagerPin({
      pin: '4821', action: 'void_sale', license: 'L1',
      actor: { id: 'c9', name: 'Cashier Joe' }, entityId: 'S123',
    });
    expect(r.status).toBe(true);
    expect(r.data.approved_by_user_id).toBe('m1');
    expect(r.data.approved_by_name).toBe('Meera');
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('manager_approval');
    expect(ctx.approved_by_user_id).toBe('m1');
    expect(ctx.actor_user_id).toBe('c9');
    expect(ctx.entity_id).toBe('S123');
  });

  test('a legacy manager usertype may authorise even without a pos matrix', async () => {
    mockCandidates([{ _id: 'a1', usertype: 'admin', username: 'boss', manager_pin: 'H' }]);
    bcrypt.compare.mockResolvedValue(true);
    const r = await service.verifyManagerPin({ pin: '9999', action: 'refund' });
    expect(r.status).toBe(true);
    expect(r.data.approved_by_name).toBe('boss');
  });

  test('a candidate NOT allowed for the action is skipped -> 403', async () => {
    mockCandidates([
      { _id: 'x1', usertype: 'cashier', access: { pos: { void_sale: false } }, manager_pin: 'H' },
    ]);
    bcrypt.compare.mockResolvedValue(true); // even if the PIN would match
    const r = await service.verifyManagerPin({ pin: '4821', action: 'void_sale' });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  test('a wrong PIN against an allowed manager -> 403', async () => {
    mockCandidates([
      { _id: 'm1', usertype: 'store_manager', manager_pin: 'H' },
    ]);
    bcrypt.compare.mockResolvedValue(false);
    const r = await service.verifyManagerPin({ pin: '0000', action: 'void_sale' });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(403);
  });
});
