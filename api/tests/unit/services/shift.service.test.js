'use strict';

/**
 * Unit tests for src/services/shift.service.js
 * The repository and audit service are mocked.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockClockIn = jest.fn();
const mockClockOut = jest.fn();
const mockGetCurrent = jest.fn();
const mockList = jest.fn();
const mockToggle = jest.fn();
jest.mock('../../../src/repositories/shift.repository', () =>
  jest.fn().mockImplementation(() => ({
    clockIn: mockClockIn,
    clockOut: mockClockOut,
    getCurrentShift: mockGetCurrent,
    listShifts: mockList,
    toggleForUser: mockToggle,
  }))
);

const mockFindUserByCard = jest.fn();
jest.mock('../../../src/services/authorization.service', () => ({
  findUserByCard: (...a) => mockFindUserByCard(...a),
}));

jest.mock('../../../src/models/base.model', () => ({ license: 'L1', loggedUser: null, loggedUserName: null }));

const mockRecord = jest.fn().mockResolvedValue({ status: true });
jest.mock('../../../src/services/audit.service', () => ({
  AuditService: class {
    record(...a) {
      return mockRecord(...a);
    }
  },
  AUDIT_EVENTS: { CLOCK_IN: 'clock_in', CLOCK_OUT: 'clock_out' },
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
