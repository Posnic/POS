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
jest.mock('../../../src/repositories/shift.repository', () =>
  jest.fn().mockImplementation(() => ({
    clockIn: mockClockIn,
    clockOut: mockClockOut,
    getCurrentShift: mockGetCurrent,
    listShifts: mockList,
  }))
);

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
});
