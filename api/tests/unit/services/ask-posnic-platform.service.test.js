'use strict';

jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
const platform = require('../../../src/services/ask-posnic-platform.service');

describe('Ask Posnic capability policy', () => {
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
