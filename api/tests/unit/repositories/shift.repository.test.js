'use strict';

/**
 * Unit tests for src/repositories/shift.repository.js
 * A fake model is injected, so no real mongodb/DB is exercised.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._mockId = id;
  }
  MockObjectId.isValid = jest.fn((val) => (typeof val === 'string' ? val.length >= 12 : !!val));
  return { MongoClient: { connect: jest.fn() }, ObjectId: MockObjectId };
});

const ShiftRepository = require('../../../src/repositories/shift.repository');
const { SHIFT_STATUS } = require('../../../src/constants/shift.constants');

function makeCollection() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 's1' }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
  };
}

function makeRepo(collection) {
  const model = {
    getCollection: jest.fn().mockResolvedValue(collection),
    licenseId: 'LICENSE000001',
    branchId: 'BRANCH0000001',
    user: { _id: 'USER00000001', username: 'Joe' },
  };
  return new ShiftRepository(model);
}

beforeEach(() => jest.clearAllMocks());

describe('clockIn', () => {
  test('creates an open shift when none is open', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    const r = await repo.clockIn({ note: ' first ' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Clocked in');
    const doc = col.insertOne.mock.calls[0][0];
    expect(doc.status).toBe(SHIFT_STATUS.OPEN);
    expect(doc.user_name).toBe('Joe');
    expect(doc.note).toBe('first');
    expect(doc.clock_in instanceof Date).toBe(true);
    expect(doc.clock_out).toBeNull();
    expect(r.data._id).toBe('s1');
  });

  test('refuses a second open shift (409)', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({ _id: 'open1', status: SHIFT_STATUS.OPEN });
    const repo = makeRepo(col);
    const r = await repo.clockIn({});
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(409);
    expect(col.insertOne).not.toHaveBeenCalled();
  });
});

describe('clockOut', () => {
  test('closes the open shift and computes worked minutes (gross - break)', async () => {
    const col = makeCollection();
    const clockIn = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes ago
    col.findOne.mockResolvedValue({
      _id: 'open1', status: SHIFT_STATUS.OPEN, clock_in: clockIn, break_minutes: 10, note: 'x',
    });
    const repo = makeRepo(col);
    const r = await repo.clockOut({});
    expect(r.status).toBe(true);
    expect(r.message).toBe('Clocked out');
    const set = col.updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe(SHIFT_STATUS.CLOSED);
    expect(set.clock_out instanceof Date).toBe(true);
    // ~60 gross minus 10 break = ~50 (allow a minute of test execution slack).
    expect(set.worked_minutes).toBeGreaterThanOrEqual(49);
    expect(set.worked_minutes).toBeLessThanOrEqual(51);
  });

  test('returns 409 when there is no open shift', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue(null);
    const repo = makeRepo(col);
    const r = await repo.clockOut({});
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(409);
    expect(col.updateOne).not.toHaveBeenCalled();
  });
});

describe('getCurrentShift / listShifts', () => {
  test('getCurrentShift returns the open shift', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({ _id: 'open1', status: SHIFT_STATUS.OPEN });
    const repo = makeRepo(col);
    const r = await repo.getCurrentShift();
    expect(r.status).toBe(true);
    expect(r.data._id).toBe('open1');
  });

  test('listShifts queries by license + branch, sorted and limited', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    const r = await repo.listShifts({ status: SHIFT_STATUS.CLOSED, limit: 5 });
    expect(r.status).toBe(true);
    const query = col.find.mock.calls[0][0];
    expect(query.status).toBe(SHIFT_STATUS.CLOSED);
    expect('license' in query).toBe(true);
    expect('branch_id' in query).toBe(true);
  });
});
