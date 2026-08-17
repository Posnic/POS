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
    col.findOne.mockResolvedValue({
      _id: 'open1', status: SHIFT_STATUS.OPEN, clock_in: new Date(Date.now() - 60 * 60 * 1000),
    });
    const repo = makeRepo(col);
    const r = await repo.clockIn({});
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(409);
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  test('a stale forgotten shift is auto-closed (capped) and clock-in proceeds', async () => {
    const col = makeCollection();
    const clockIn = new Date(Date.now() - 20 * 60 * 60 * 1000); // 20h ago
    col.findOne.mockResolvedValue({
      _id: 'stale1', status: SHIFT_STATUS.OPEN, clock_in: clockIn, break_minutes: 30, note: null,
    });
    const repo = makeRepo(col);
    const r = await repo.clockIn({});
    expect(r.status).toBe(true);
    expect(r.auto_closed).toBeTruthy();
    // Gross capped at 12h; minus the 30min break.
    expect(r.auto_closed.worked_minutes).toBe(12 * 60 - 30);
    expect(r.auto_closed.note).toBe('[auto clock-out]');
    const closeSet = col.updateOne.mock.calls[0][1].$set;
    expect(closeSet.status).toBe(SHIFT_STATUS.CLOSED);
    expect(closeSet.clock_out.getTime()).toBe(clockIn.getTime() + 12 * 60 * 60000);
    expect(col.insertOne).toHaveBeenCalled(); // the fresh shift opened
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

describe('toggleForUser (clock-by-card)', () => {
  test('clocks OUT when the user has an open shift', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({
      _id: 'open1', status: SHIFT_STATUS.OPEN, clock_in: new Date(Date.now() - 30 * 60 * 1000), break_minutes: 0,
    });
    const repo = makeRepo(col);
    const r = await repo.toggleForUser({ userId: 'CARDUSER0001', userName: 'Meera' });
    expect(r.status).toBe(true);
    expect(r.data.action).toBe('clock_out');
    expect(col.updateOne).toHaveBeenCalled();
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  test('clocks IN when the user has no open shift', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue(null);
    const repo = makeRepo(col);
    const r = await repo.toggleForUser({ userId: 'CARDUSER0001', userName: 'Meera' });
    expect(r.status).toBe(true);
    expect(r.data.action).toBe('clock_in');
    expect(col.insertOne).toHaveBeenCalled();
    const doc = col.insertOne.mock.calls[0][0];
    expect(doc.user_name).toBe('Meera');
    expect(doc.status).toBe(SHIFT_STATUS.OPEN);
  });

  test('rejects when no user is supplied', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    const r = await repo.toggleForUser({ userId: null });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(400);
  });
});

describe('editShift (timecard correction)', () => {
  test('recomputes worked_minutes from corrected times minus break', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({
      _id: 's1', clock_in: new Date('2026-01-01T09:00:00Z'), clock_out: new Date('2026-01-01T17:00:00Z'), break_minutes: 0, status: 'closed',
    });
    const repo = makeRepo(col);
    const r = await repo.editShift('SHIFT0000001', {
      clock_in: '2026-01-01T09:00:00Z', clock_out: '2026-01-01T17:00:00Z', break_minutes: 30,
    });
    expect(r.status).toBe(true);
    const set = col.updateOne.mock.calls[0][1].$set;
    expect(set.worked_minutes).toBe(450); // 8h (480) - 30 break
    expect(set.break_minutes).toBe(30);
  });

  test('rejects clock_out before clock_in', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({ _id: 's1', clock_in: new Date('2026-01-01T09:00:00Z'), clock_out: null, break_minutes: 0 });
    const repo = makeRepo(col);
    const r = await repo.editShift('SHIFT0000001', { clock_out: '2026-01-01T08:00:00Z' });
    expect(r.statusCode).toBe(400);
    expect(col.updateOne).not.toHaveBeenCalled();
  });

  test('404 when the shift is not found, 400 on a bad id', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue(null);
    expect((await makeRepo(col).editShift('SHIFT0000001', {})).statusCode).toBe(404);
    expect((await makeRepo(col).editShift(null, {})).statusCode).toBe(400);
  });
});

describe('getShiftReport', () => {
  test('groups shifts by user with summed minutes/hours + grand totals', async () => {
    const col = makeCollection();
    col.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([
        { user_id: 'u1', user_name: 'A', status: 'closed', worked_minutes: 120, clock_in: new Date('2026-01-01T09:00:00Z'), clock_out: new Date('2026-01-01T11:00:00Z') },
        { user_id: 'u1', user_name: 'A', status: 'closed', worked_minutes: 60, clock_in: new Date('2026-01-02T09:00:00Z'), clock_out: new Date('2026-01-02T10:00:00Z') },
        { user_id: 'u2', user_name: 'B', status: 'open', worked_minutes: 0, clock_in: new Date('2026-01-02T09:00:00Z'), clock_out: null },
      ]),
    });
    const repo = makeRepo(col);
    const r = await repo.getShiftReport({});
    expect(r.status).toBe(true);
    const rowA = r.data.rows.find((x) => x.user_id === 'u1');
    expect(rowA.shifts).toBe(2);
    expect(rowA.worked_minutes).toBe(180);
    expect(rowA.worked_hours).toBe(3);
    const rowB = r.data.rows.find((x) => x.user_id === 'u2');
    expect(rowB.open_shifts).toBe(1);
    expect(r.data.totals.shifts).toBe(3);
    expect(r.data.totals.users).toBe(2);
    expect(r.data.totals.worked_hours).toBe(3);
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
    expect('clock_in' in query).toBe(false);
  });

  test('listShifts filters clock_in by from/to when given Dates (timecard export)', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-17T23:59:59Z');
    const r = await repo.listShifts({ from, to });
    expect(r.status).toBe(true);
    const query = col.find.mock.calls[0][0];
    expect(query.clock_in).toEqual({ $gte: from, $lte: to });
  });

  test('listShifts ignores non-Date from/to values', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    await repo.listShifts({ from: '2026-08-01', to: 'not a date' });
    const query = col.find.mock.calls[0][0];
    expect('clock_in' in query).toBe(false);
  });
});

describe('tips declared at clock-out', () => {
  test('clockOut stores a valid tips amount rounded to 2dp', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({
      _id: 'open1', status: SHIFT_STATUS.OPEN,
      clock_in: new Date(Date.now() - 60 * 60 * 1000), break_minutes: 0,
    });
    const repo = makeRepo(col);
    const r = await repo.clockOut({ tips: '12.505' });
    expect(r.status).toBe(true);
    expect(col.updateOne.mock.calls[0][1].$set.tips_declared).toBe(12.51);
  });

  test('clockOut ignores an invalid or negative tips value', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({
      _id: 'open1', status: SHIFT_STATUS.OPEN,
      clock_in: new Date(Date.now() - 60 * 60 * 1000), break_minutes: 0,
    });
    const repo = makeRepo(col);
    await repo.clockOut({ tips: -5 });
    expect('tips_declared' in col.updateOne.mock.calls[0][1].$set).toBe(false);
  });

  test('editShift rejects a negative tips correction', async () => {
    const col = makeCollection();
    col.findOne.mockResolvedValue({ _id: 's1', clock_in: new Date(), break_minutes: 0 });
    const repo = makeRepo(col);
    const r = await repo.editShift('SHIFT0000001', { tips: -1 });
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(400);
  });
});

describe('roster / schedules', () => {
  test('addSchedule validates and stores a planned stretch with minutes', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    const r = await repo.addSchedule({
      user_id: 'USER00000001', user_name: 'Joe',
      date: '2026-08-20', start: '09:00', end: '17:30',
    });
    expect(r.status).toBe(true);
    const doc = col.insertOne.mock.calls[0][0];
    expect(doc.date).toBe('2026-08-20');
    expect(doc.minutes).toBe(510);
  });

  test('addSchedule refuses end before start and bad formats', async () => {
    const repo = makeRepo(makeCollection());
    expect((await repo.addSchedule({
      user_id: 'USER00000001', date: '2026-08-20', start: '17:00', end: '09:00',
    })).statusCode).toBe(400);
    expect((await repo.addSchedule({
      user_id: 'USER00000001', date: '20-08-2026', start: '09:00', end: '17:00',
    })).statusCode).toBe(400);
    expect((await repo.addSchedule({
      user_id: 'USER00000001', date: '2026-08-20', start: '9am', end: '17:00',
    })).statusCode).toBe(400);
  });

  test('listSchedules filters by the date-string range', async () => {
    const col = makeCollection();
    const repo = makeRepo(col);
    await repo.listSchedules({ from: '2026-08-01', to: '2026-08-31' });
    const query = col.find.mock.calls[0][0];
    expect(query.date).toEqual({ $gte: '2026-08-01', $lte: '2026-08-31' });
  });

  test('deleteSchedule 404s when nothing matches', async () => {
    const col = makeCollection();
    col.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 0 });
    const repo = makeRepo(col);
    const r = await repo.deleteSchedule('SCHED0000001');
    expect(r.status).toBe(false);
    expect(r.statusCode).toBe(404);
  });

  test('getShiftReport sums declared + sale tips and overlays scheduled minutes', async () => {
    const col = makeCollection();
    col.find = jest.fn((query) => ({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(
        'date' in query
          ? [{ user_id: 'USER00000001', user_name: 'Joe', minutes: 480 }]
          : 'tip_amount' in query
            ? [{ user_id: 'USER00000001', tip_amount: 15 }, { user_id: 'USER00000001', tip_amount: 5 }]
            : [{
                user_id: 'USER00000001', user_name: 'Joe', status: SHIFT_STATUS.CLOSED,
                clock_in: new Date('2026-08-17T09:00:00Z'), clock_out: new Date('2026-08-17T17:00:00Z'),
                worked_minutes: 450, tips_declared: 25,
              }]
      ),
    }));
    const repo = makeRepo(col);
    const r = await repo.getShiftReport({
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
    });
    expect(r.status).toBe(true);
    const row = r.data.rows[0];
    expect(row.tips).toBe(25); // declared cash tips
    expect(row.sale_tips).toBe(20); // captured at tender
    expect(row.tips_total).toBe(45);
    expect(row.scheduled_minutes).toBe(480);
    expect(row.scheduled_hours).toBe(8);
    expect(r.data.totals.tips_total).toBe(45);
    expect(r.data.totals.scheduled_hours).toBe(8);
  });
});
