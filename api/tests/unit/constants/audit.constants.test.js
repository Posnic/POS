'use strict';

const { AUDIT_EVENTS } = require('../../../src/constants/audit.constants');

describe('AUDIT_EVENTS', () => {
  test('exposes the core event types', () => {
    expect(AUDIT_EVENTS.LOGIN).toBe('login');
    expect(AUDIT_EVENTS.LOGOUT).toBe('logout');
    expect(AUDIT_EVENTS.CLOCK_IN).toBe('clock_in');
    expect(AUDIT_EVENTS.CLOCK_OUT).toBe('clock_out');
    expect(AUDIT_EVENTS.SALE_VOID).toBe('sale_void');
    expect(AUDIT_EVENTS.SALE_REFUND).toBe('sale_refund');
    expect(AUDIT_EVENTS.NO_SALE_OPEN_DRAWER).toBe('no_sale_open_drawer');
    expect(AUDIT_EVENTS.REGISTER_OPEN).toBe('register_open');
    expect(AUDIT_EVENTS.REGISTER_CLOSE).toBe('register_close');
    expect(AUDIT_EVENTS.MANAGER_APPROVAL).toBe('manager_approval');
    expect(AUDIT_EVENTS.SHIFT_EDIT).toBe('shift_edit');
  });

  test('all values are unique, non-empty, snake_case strings', () => {
    const values = Object.values(AUDIT_EVENTS);
    values.forEach((v) => {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      expect(v).toMatch(/^[a-z_]+$/);
    });
    expect(new Set(values).size).toBe(values.length);
  });
});
