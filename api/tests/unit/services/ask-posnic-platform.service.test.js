'use strict';

jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
jest.mock('../../../src/services/ask-posnic-metrics.service', () => ({ record: jest.fn().mockResolvedValue() }));
const platform = require('../../../src/services/ask-posnic-platform.service');

describe('Ask Posnic capability policy', () => {
  const req = { user: { _id: 'user', license: 'shop', branch_id: 'outlet' } };

  test('confirmed-action telemetry counts only the first audit projection, including recovery replays', async () => {
    const BaseModel = require('../../../src/models/base.model');
    const metrics = require('../../../src/services/ask-posnic-metrics.service');
    const updateOne = jest.fn().mockResolvedValueOnce({ upsertedCount: 1 }).mockResolvedValue({ upsertedCount: 0 });
    const draft = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', type: 'stock_count', status: 'completed', output: { private: 'business output' } };
    BaseModel.prototype.getCollection = jest.fn(async name => name === 'ask_posnic_audit' ? { updateOne }
      : { findOne: async () => name === 'ask_posnic_action_drafts' ? draft : { _id: 'saved-count' } });
    const actor = { user: { ...req.user, license: 'bbbbbbbbbbbbbbbbbbbbbbbb', branch_id: 'cccccccccccccccccccccccc' } };
    await platform.actionOutcome(actor, draft._id);
    await platform.actionOutcome(actor, draft._id);
    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith({ licenseId: actor.user.license }, 'quality', { actions_confirmed: 1 });
    delete BaseModel.prototype.getCollection;
  });

  test('rejects oversized authored knowledge instead of truncating restrictions', async () => {
    await expect(platform.saveDocument(req, { title: 'Policy', content: 'x'.repeat(200001) })).rejects.toThrow(/200,000/);
    await expect(platform.saveDocument(req, { title: 'x'.repeat(201), content: 'Policy' })).rejects.toThrow(/title exceeds 200/);
  });

  test('validates every bundle source before opening a collection for writes', async () => {
    const valid = { title: 'Policy', content: 'Complete instructions', status: 'published', visibility: 'customer' };
    await expect(platform.importBundle(req, { schema: 'posnic.ask-knowledge.v1', documents: [valid, { ...valid, content: 'x'.repeat(200001) }] })).rejects.toThrow(/200,000/);
    await expect(platform.importBundle(req, { schema: 'posnic.ask-knowledge.v1', documents: [valid, null] })).rejects.toThrow(/invalid source/);
  });

  test('defaults to enabled when no role list is configured', () => {
    expect(platform.capabilityAllowed({ insights_enabled: true, roles: {} }, 'insights', { role: 'cashier' })).toBe(true);
  });

  test('honours capability switches and role allowlists', () => {
    expect(platform.capabilityAllowed({ actions_enabled: false, roles: {} }, 'actions', { role: 'admin' })).toBe(false);
    expect(platform.capabilityAllowed({ actions_enabled: true, roles: { actions: ['admin', 'manager'] } }, 'actions', { role: 'cashier' })).toBe(false);
    expect(platform.capabilityAllowed({ actions_enabled: true, roles: { actions: ['admin', 'manager'] } }, 'actions', { role: 'manager' })).toBe(true);
  });

  test('normalizes role policy and discards unknown roles', () => {
    expect(platform.normalizeRoles({
      help: ['Manager', 'manager', 'unknown'],
      insights: ['owner', 'cashier'],
      unrelated: ['admin'],
    })).toEqual({ help: ['manager'], insights: ['owner', 'cashier'] });
  });

  test('normalizes FAQ questions for exact matching', () => {
    expect(platform.normalizeQuestion('How do I return a sale?')).toBe('how do i return a sale');
    expect(platform.normalizeQuestion('  HOW-do I return a sale!! ')).toBe('how do i return a sale');
  });

  test('an invalid-only role list cannot silently become allow-all', () => {
    expect(() => platform.normalizeRoles({ actions: ['invented'] })).toThrow('valid role');
  });
});
