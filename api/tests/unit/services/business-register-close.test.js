'use strict';
const { ObjectId } = require('mongodb');
const {
  registerCloseFact,
  readRegisterClose,
  CLOSE_GRACE_MS,
} = require('../../../src/services/business-register-close');
const branch = { id: 'a'.repeat(24), license: 'b'.repeat(24), timezone: 'Asia/Kolkata' };
const now = () => Date.parse('2026-09-29T19:00:00Z');
const row = () => ({
  _id: new ObjectId('c'.repeat(24)),
  register_id: new ObjectId('d'.repeat(24)),
  branch_id: new ObjectId(branch.id),
  license: new ObjectId(branch.license),
  register_name: ' Main till ',
  register_status: 'Closed',
  register_opendate: new Date('2026-09-29T12:00:00Z'),
  register_closedate: new Date('2026-09-29T18:45:00Z'),
  closing_expected: 123,
  register_sales: [{ secret: 'not returned' }],
});
describe('explicit register-close source facts', () => {
  test('separates physical register/session identity and uses local close date without claiming totals', () => {
    const fact = registerCloseFact(row(), branch, { now });
    expect(fact).toEqual({
      schemaVersion: 1,
      branchId: branch.id,
      sessionId: 'c'.repeat(24),
      registerId: 'd'.repeat(24),
      registerName: 'Main till',
      openedAt: '2026-09-29T12:00:00.000Z',
      closedAt: '2026-09-29T18:45:00.000Z',
      closeRevision: expect.stringMatching(/^[a-f\d]{64}$/),
      businessDate: '2026-09-30',
      timezone: 'Asia/Kolkata',
      eligibleAt: '2026-09-29T18:55:00.000Z',
    });
    expect(CLOSE_GRACE_MS).toBe(600000);
    expect(registerCloseFact(row(), branch, { now }).closeRevision).toBe(fact.closeRevision);
    expect(
      registerCloseFact(
        { ...row(), register_closedate: new Date('2026-09-29T18:46:00Z') },
        branch,
        { now }
      ).closeRevision
    ).not.toBe(fact.closeRevision);
    expect(
      registerCloseFact({ ...row(), register_opendate: new Date('2026-09-29T11:00:00Z') }, branch, {
        now,
      }).closeRevision
    ).not.toBe(fact.closeRevision);
  });
  test('missing and reopened sessions produce no close event; malformed or foreign sources fail closed', () => {
    expect(registerCloseFact(null, branch, { now })).toBeNull();
    expect(registerCloseFact({ ...row(), register_status: 'Opened' }, branch, { now })).toBeNull();
    expect(() =>
      registerCloseFact({ ...row(), branch_id: new ObjectId() }, branch, { now })
    ).toThrow('access_denied');
    for (const change of [
      { register_status: 'Unknown' },
      { register_name: '' },
      { register_id: 'not-an-id' },
      { register_closedate: '2026-09-29T18:45:00Z' },
      { register_closedate: new Date('invalid') },
      { register_closedate: new Date('2026-09-29T20:00:00Z') },
      { register_opendate: new Date('2026-09-29T18:46:00Z') },
    ])
      expect(() => registerCloseFact({ ...row(), ...change }, branch, { now })).toThrow(
        'close_unavailable'
      );
    expect(() => registerCloseFact(row(), { ...branch, timezone: 'invalid' }, { now })).toThrow(
      'close_unavailable'
    );
  });
  test('primary-key rechecks require branch and capabilities and never fetch register financial arrays', async () => {
    const findOne = jest.fn().mockResolvedValue(row()),
      collection = jest.fn(() => ({ findOne }));
    const context = {
      businessId: branch.license,
      branches: [branch],
      capabilities: ['overview.read', 'notifications.self.manage'],
    };
    for (const changed of [
      { ...context, branches: [] },
      { ...context, capabilities: ['overview.read'] },
    ])
      await expect(
        readRegisterClose({ collection }, changed, branch.id, 'c'.repeat(24), { now })
      ).rejects.toThrow('access_denied');
    expect(collection).not.toHaveBeenCalled();
    expect(
      await readRegisterClose({ collection }, context, branch.id, 'c'.repeat(24), { now })
    ).toMatchObject({ sessionId: 'c'.repeat(24) });
    expect(collection).toHaveBeenCalledWith('cashregister');
    const [query, options] = findOne.mock.calls[0];
    expect(String(query._id)).toBe('c'.repeat(24));
    expect(String(query.license)).toBe(branch.license);
    expect(String(query.branch_id)).toBe(branch.id);
    expect(options.maxTimeMS).toBe(250);
    expect(Object.keys(options.projection).sort()).toEqual([
      '_id',
      'branch_id',
      'license',
      'register_closedate',
      'register_id',
      'register_name',
      'register_opendate',
      'register_status',
    ]);
  });
});
