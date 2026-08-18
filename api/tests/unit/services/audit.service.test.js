'use strict';

/**
 * Unit tests for src/services/audit.service.js
 * The service is injected with a fake model, so no real DB/mongodb is exercised.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._id = id;
  }
  return { MongoClient: { connect: jest.fn() }, ObjectId: MockObjectId };
});

const { AuditService, AUDIT_EVENTS } = require('../../../src/services/audit.service');

function makeModel() {
  const insertOne = jest.fn().mockResolvedValue({ insertedId: 'a1' });
  return {
    _insertOne: insertOne,
    getCollection: jest.fn().mockResolvedValue({ insertOne }),
    toObjectId: jest.fn((v) => (v === null || v === undefined ? null : { oid: v })),
    licenseId: null,
    branchId: null,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('AuditService.record', () => {
  test('writes to audit_log and returns status:true', async () => {
    const model = makeModel();
    const r = await new AuditService(model).record(AUDIT_EVENTS.LOGIN, {
      actor_user_id: 'u1',
      actor_name: 'Alice',
      entity: 'user',
      entity_id: 'u1',
    });
    expect(r.status).toBe(true);
    expect(model.getCollection).toHaveBeenCalledWith('audit_log');
    expect(model._insertOne).toHaveBeenCalledTimes(1);
    const doc = model._insertOne.mock.calls[0][0];
    expect(doc.event).toBe('login');
    expect(doc.actor_name).toBe('Alice');
    expect(doc.entity).toBe('user');
    expect(doc.entity_id).toBe('u1');
    expect(doc.at instanceof Date).toBe(true);
  });

  test('never throws — returns status:false on failure', async () => {
    const model = makeModel();
    model.getCollection = jest.fn().mockRejectedValue(new Error('db down'));
    const r = await new AuditService(model).record(AUDIT_EVENTS.SALE_VOID, {});
    expect(r.status).toBe(false);
    expect(r.error).toBe('db down');
  });

  test('defaults a missing event to "unknown" and drops empty fields', async () => {
    const model = makeModel();
    await new AuditService(model).record(undefined, {});
    const doc = model._insertOne.mock.calls[0][0];
    expect(doc.event).toBe('unknown');
    expect('reason' in doc).toBe(false);
    expect('amount' in doc).toBe(false);
    expect('actor_name' in doc).toBe(false);
  });

  test('keeps a numeric amount, reason and details object', async () => {
    const model = makeModel();
    await new AuditService(model).record(AUDIT_EVENTS.SALE_REFUND, {
      amount: 250.5,
      reason: 'customer return',
      details: { sale_no: 'S1' },
    });
    const doc = model._insertOne.mock.calls[0][0];
    expect(doc.amount).toBe(250.5);
    expect(doc.reason).toBe('customer return');
    expect(doc.details).toEqual({ sale_no: 'S1' });
  });

  test('non-numeric amount is dropped', async () => {
    const model = makeModel();
    await new AuditService(model).record(AUDIT_EVENTS.CASH_OUT, { amount: 'lots' });
    const doc = model._insertOne.mock.calls[0][0];
    expect('amount' in doc).toBe(false);
  });
});
