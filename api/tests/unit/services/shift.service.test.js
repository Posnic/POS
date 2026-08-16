'use strict';

/**
 * Unit tests for src/services/shift.service.js
 * The repository and audit service are mocked.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('mongoose', () => {
  function MockObjectId(id) {
    this._id = id;
  }
  MockObjectId.isValid = (v) => (typeof v === 'string' ? v.length >= 12 : !!v);
  return { Types: { ObjectId: MockObjectId } };
});

const mockClockIn = jest.fn();
const mockClockOut = jest.fn();
const mockGetCurrent = jest.fn();
const mockList = jest.fn();
const mockToggle = jest.fn();
const mockGetShiftReport = jest.fn();
const mockEditShift = jest.fn();
jest.mock('../../../src/repositories/shift.repository', () =>
  jest.fn().mockImplementation(() => ({
    clockIn: mockClockIn,
    clockOut: mockClockOut,
    getCurrentShift: mockGetCurrent,
    listShifts: mockList,
    toggleForUser: mockToggle,
    getShiftReport: mockGetShiftReport,
    editShift: mockEditShift,
  }))
);

const mockFindUserByCard = jest.fn();
jest.mock('../../../src/services/authorization.service', () => ({
  findUserByCard: (...a) => mockFindUserByCard(...a),
}));

jest.mock('../../../src/models/user.model', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => ({ license: 'L1', loggedUser: null, loggedUserName: null }));

const User = require('../../../src/models/user.model');

const mockRecord = jest.fn().mockResolvedValue({ status: true });
jest.mock('../../../src/services/audit.service', () => ({
  AuditService: class {
    record(...a) {
      return mockRecord(...a);
    }
  },
  AUDIT_EVENTS: { CLOCK_IN: 'clock_in', CLOCK_OUT: 'clock_out', SHIFT_EDIT: 'shift_edit' },
}));

const ShiftService = require('../../../src/services/shift.service');

beforeEach(() => jest.clearAllMocks());

describe('ShiftService', () => {
  test('clockIn records a CLOCK_IN audit on success', async () => {
    mockClockIn.mockResolvedValue({ status: true, data: { _id: 's1' } });
    const r = await new ShiftService().clockIn({ device_id: 'd1' });
    expect(r.status).toBe(true);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('clock_in');
    expect(ctx.entity).toBe('shift');
    expect(ctx.entity_id).toBe('s1');
  });

  test('clockIn does NOT audit on failure', async () => {
    mockClockIn.mockResolvedValue({ status: false, statusCode: 409 });
    await new ShiftService().clockIn({});
    expect(mockRecord).not.toHaveBeenCalled();
  });

  test('clockOut records CLOCK_OUT with worked_minutes in details', async () => {
    mockClockOut.mockResolvedValue({ status: true, data: { _id: 's1', worked_minutes: 480 } });
    await new ShiftService().clockOut({});
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('clock_out');
    expect(ctx.details).toEqual({ worked_minutes: 480 });
  });

  test('getCurrentShift / listShifts delegate to the repository', async () => {
    mockGetCurrent.mockResolvedValue({ status: true, data: null });
    mockList.mockResolvedValue({ status: true, data: [] });
    const svc = new ShiftService();
    expect((await svc.getCurrentShift()).status).toBe(true);
    expect((await svc.listShifts({})).status).toBe(true);
    expect(mockGetCurrent).toHaveBeenCalled();
    expect(mockList).toHaveBeenCalled();
  });

  test('clockByCard 404s an unrecognised card and does not toggle', async () => {
    mockFindUserByCard.mockResolvedValue(null);
    const r = await new ShiftService().clockByCard({ card_uid: 'DEADBEEF' });
    expect(r.statusCode).toBe(404);
    expect(mockToggle).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  test('clockByCard toggles the CARDHOLDER in and audits as that person', async () => {
    mockFindUserByCard.mockResolvedValue({ _id: 'u9', firstname: 'Meera', username: 'meera' });
    mockToggle.mockResolvedValue({ status: true, data: { action: 'clock_in', shift: { _id: 's1' } } });
    const r = await new ShiftService().clockByCard({ card_uid: '0417AABB', device_id: 'term1' });
    expect(r.status).toBe(true);
    expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u9', userName: 'Meera' }));
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('clock_in');
    expect(ctx.actor_user_id).toBe('u9'); // audited as the cardholder, not the terminal
  });

  test('clockByCard records CLOCK_OUT with worked minutes on toggle-out', async () => {
    mockFindUserByCard.mockResolvedValue({ _id: 'u9', username: 'meera' });
    mockToggle.mockResolvedValue({ status: true, data: { action: 'clock_out', shift: { _id: 's1', worked_minutes: 120 } } });
    await new ShiftService().clockByCard({ card_uid: '0417AABB' });
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('clock_out');
    expect(ctx.details.worked_minutes).toBe(120);
  });
});

describe('getReport (payout)', () => {
  test('joins hourly wage to compute payout per row + a grand total', async () => {
    mockGetShiftReport.mockResolvedValue({
      status: true,
      data: {
        rows: [
          { user_id: 'u1', user_name: 'A', worked_hours: 8 },
          { user_id: 'u2', user_name: 'B', worked_hours: 5 },
        ],
        totals: { users: 2, shifts: 3, worked_minutes: 780, worked_hours: 13 },
      },
    });
    User.find.mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve([
          { _id: 'u1', hourly_rate: 10 },
          { _id: 'u2', hourly_rate: 20 },
        ]),
      }),
    });
    const r = await new ShiftService().getReport({});
    const a = r.data.rows.find((x) => x.user_id === 'u1');
    const b = r.data.rows.find((x) => x.user_id === 'u2');
    expect(a.payout).toBe(80); // 8h * 10
    expect(b.payout).toBe(100); // 5h * 20
    expect(r.data.totals.payout).toBe(180);
  });

  test('payout is 0 when a user has no wage', async () => {
    mockGetShiftReport.mockResolvedValue({
      status: true,
      data: { rows: [{ user_id: 'u1', worked_hours: 8 }], totals: {} },
    });
    User.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: 'u1' }]) }) });
    const r = await new ShiftService().getReport({});
    expect(r.data.rows[0].payout).toBe(0);
    expect(r.data.totals.payout).toBe(0);
  });
});

describe('editShift', () => {
  test('records a SHIFT_EDIT audit on success', async () => {
    mockEditShift.mockResolvedValue({ status: true, data: { _id: 's1', worked_minutes: 450 } });
    const r = await new ShiftService().editShift('s1', { break_minutes: 30 });
    expect(r.status).toBe(true);
    const [event, ctx] = mockRecord.mock.calls[0];
    expect(event).toBe('shift_edit');
    expect(ctx.entity).toBe('shift');
    expect(ctx.entity_id).toBe('s1');
  });

  test('does not audit on failure', async () => {
    mockEditShift.mockResolvedValue({ status: false, statusCode: 404 });
    await new ShiftService().editShift('s1', {});
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe('setRate', () => {
  test('saves a valid wage', async () => {
    User.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await new ShiftService().setRate({ userId: '507f1f77bcf86cd799439011', hourlyRate: 15.5, license: 'L1' });
    expect(r.status).toBe(true);
    expect(User.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ license: 'L1' }),
      { $set: { hourly_rate: 15.5 } }
    );
  });

  test('rejects a negative or non-numeric wage', async () => {
    expect((await new ShiftService().setRate({ userId: '507f1f77bcf86cd799439011', hourlyRate: -5 })).statusCode).toBe(400);
    expect((await new ShiftService().setRate({ userId: '507f1f77bcf86cd799439011', hourlyRate: 'abc' })).statusCode).toBe(400);
  });

  test('rejects an invalid user id', async () => {
    expect((await new ShiftService().setRate({ userId: 'bad', hourlyRate: 10 })).statusCode).toBe(400);
  });
});
