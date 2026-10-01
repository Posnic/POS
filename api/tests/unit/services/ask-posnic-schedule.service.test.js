'use strict';

const dueId = '64f9a1c2e3b4d5e6f7000009';
let mockRows;
const mockCollection = {
  find: jest.fn(() => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn(async () => mockRows),
  })),
  findOneAndUpdate: jest.fn(async (filter, update) => ({ ...mockRows[0], ...update.$set })),
  updateOne: jest.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })),
  updateMany: jest.fn(async () => ({ acknowledged: true })),
  insertOne: jest.fn(async () => ({ insertedId: dueId })),
  deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
};
jest.mock(
  '../../../src/models/base.model',
  () =>
    function MockBaseModel() {
      this.getCollection = async () => mockCollection;
    }
);

const service = require('../../../src/services/ask-posnic-schedule.service');

describe('Ask Posnic summary schedules', () => {
  beforeEach(() => {
    mockRows = [];
    jest.clearAllMocks();
  });

  test('rejects oversized or malformed destinations before database access', async () => {
    const context = { licenseId: 'l', branchId: 'b', userId: 'u' };
    for (const destination of [
      '!@!.' + '!.'.repeat(100000),
      { $ne: null },
      'a@b..example',
      'a@example.com\r\nBcc:other@example.com',
    ]) {
      await expect(
        service.save(context, { report: 'sales', frequency: 'daily', destination })
      ).rejects.toThrow(/valid delivery/);
    }
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
    const row = await service.save(context, {
      report: 'sales',
      frequency: 'daily',
      destination: ' Owner+reports@Example.com ',
    });
    expect(row.destination).toBe('owner+reports@example.com');
  });

  test('calculates the next daily run after the current time', () => {
    const next = service.nextRun(
      { frequency: 'daily', hour: 8, timezone: 'Asia/Kolkata' },
      new Date('2026-10-01T04:00:00Z')
    );
    expect(next.toISOString()).toBe('2026-10-02T02:30:00.000Z');
  });

  test('claims, delivers, and advances a due schedule once', async () => {
    mockRows = [
      {
        _id: dueId,
        report: 'sales',
        frequency: 'daily',
        hour: 8,
        timezone: 'UTC',
        destination: 'owner@example.com',
        next_run_at: new Date('2026-10-01T08:00:00Z'),
      },
    ];
    const build = jest.fn(async () => ({ answer: 'Sales are 10' }));
    const deliver = jest.fn(async () => ({
      status: 'sent',
      provider: 'smtp',
      reference: 'synthetic-message-id',
    }));
    const result = await service.runDue(
      { licenseId: 'l', branchId: 'b' },
      build,
      deliver,
      new Date('2026-10-01T09:00:00Z')
    );
    expect(result).toEqual([{ id: dueId, status: 'sent' }]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(mockCollection.updateOne.mock.calls[0][0]).toMatchObject({
      enabled: true,
      running_claim: expect.any(String),
    });
    expect(
      mockCollection.updateOne.mock.calls.find((call) => call[1].$set.last_status === 'sent')[0]
    ).toMatchObject({ running_claim: expect.any(String) });
  });

  test('accepts a WhatsApp destination and records the channel', async () => {
    const row = await service.save(
      { licenseId: 'l', branchId: 'b', userId: 'u' },
      {
        report: 'sales',
        frequency: 'daily',
        hour: 8,
        timezone: 'UTC',
        channel: 'whatsapp',
        destination: '+919876543210',
      }
    );
    expect(row.channel).toBe('whatsapp');
    expect(row.destination).toBe('+919876543210');
  });
});
