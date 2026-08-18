'use strict';

const {
  ROLE_KEYS,
  DEFAULT_ROLES,
  POS_PERMISSIONS,
} = require('../../../src/constants/roles.constants');

const byKey = (k) => DEFAULT_ROLES.find((r) => r.key === k);
const MODULES = [
  'dashboard',
  'sales',
  'receiving',
  'customer',
  'supplier',
  'category',
  'item',
  'expense',
  'branch',
  'report',
  'user',
  'plan',
];

describe('DEFAULT_ROLES', () => {
  test('ships the 8 standard system roles in order', () => {
    expect(DEFAULT_ROLES).toHaveLength(8);
    expect(DEFAULT_ROLES.map((r) => r.key)).toEqual([
      'owner',
      'admin',
      'store_manager',
      'shift_supervisor',
      'cashier',
      'inventory_clerk',
      'accountant',
      'api',
    ]);
  });

  test('every role is a system role with a name, description and full access matrix', () => {
    DEFAULT_ROLES.forEach((r) => {
      expect(r.is_system).toBe(true);
      expect(typeof r.name).toBe('string');
      expect(r.description.length).toBeGreaterThan(0);
      MODULES.forEach((m) => expect(r.access[m]).toBeDefined());
    });
  });

  test('Owner and Admin have full access + financials', () => {
    [byKey('owner'), byKey('admin')].forEach((r) => {
      expect(r.access.dashboard.financials).toBe(true);
      expect(r.access.sales).toEqual({ read: true, write: true, delete: true });
      expect(r.access.user).toEqual({ read: true, write: true, delete: true });
      expect(r.access.plan.read).toBe(true);
    });
  });

  test('Cashier can ring sales + add customers, but NOT delete, see reports/financials, or manage users', () => {
    const c = byKey('cashier');
    expect(c.access.sales).toEqual({ read: true, write: true, delete: false });
    expect(c.access.customer).toEqual({ read: true, write: true, delete: false });
    expect(c.access.dashboard.financials).toBe(false);
    expect(c.access.report).toEqual({ read: false, write: false, delete: false });
    expect(c.access.user).toEqual({ read: false, write: false, delete: false });
    expect(c.access.expense).toEqual({ read: false, write: false, delete: false });
    expect(c.access.plan.read).toBe(false);
  });

  test('Accountant is read-only with financials (no writes anywhere)', () => {
    const a = byKey('accountant');
    expect(a.access.dashboard.financials).toBe(true);
    expect(a.access.report.read).toBe(true);
    ['sales', 'item', 'expense', 'customer'].forEach((m) => {
      expect(a.access[m].write).toBe(false);
      expect(a.access[m].delete).toBe(false);
    });
  });

  test('Inventory Clerk manages items but has no POS (sales) access', () => {
    const k = byKey('inventory_clerk');
    expect(k.access.item).toEqual({ read: true, write: true, delete: true });
    expect(k.access.sales).toEqual({ read: false, write: false, delete: false });
  });

  test('ROLE_KEYS values are unique snake_case strings and cover all defaults', () => {
    const vals = Object.values(ROLE_KEYS);
    vals.forEach((v) => expect(v).toMatch(/^[a-z_]+$/));
    expect(new Set(vals).size).toBe(vals.length);
    expect(vals.sort()).toEqual(DEFAULT_ROLES.map((r) => r.key).sort());
  });
});

describe('POS-granular permissions (Phase 2)', () => {
  test('every role has a full pos object with all POS_PERMISSIONS keys + an approval list', () => {
    const keys = Object.values(POS_PERMISSIONS);
    DEFAULT_ROLES.forEach((r) => {
      keys.forEach((k) => expect(r.pos[k]).toBeDefined());
      expect(Array.isArray(r.requires_manager_approval)).toBe(true);
    });
  });

  test('Owner / Admin / Store Manager have full POS rights and need no approvals', () => {
    ['owner', 'admin', 'store_manager'].forEach((k) => {
      const r = byKey(k);
      expect(r.pos.void_sale).toBe(true);
      expect(r.pos.refund).toBe(true);
      expect(r.pos.discount_apply).toBe(true);
      expect(r.pos.register_close).toBe(true);
      expect(r.requires_manager_approval).toEqual([]);
    });
  });

  test('Cashier can only reprint; sensitive actions all require a manager', () => {
    const c = byKey('cashier');
    expect(c.pos.reprint_receipt).toBe(true);
    expect(c.pos.void_sale).toBe(false);
    expect(c.pos.refund).toBe(false);
    expect(c.pos.discount_apply).toBe(false);
    expect(c.pos.no_sale_open_drawer).toBe(false);
    expect(c.pos.register_close).toBe(false);
    expect(c.requires_manager_approval).toEqual(
      expect.arrayContaining(['void_sale', 'refund', 'discount_apply', 'register_close'])
    );
  });

  test('Shift Supervisor: void a line + refund + register close, but a full void needs a manager', () => {
    const s = byKey('shift_supervisor');
    expect(s.pos.void_line).toBe(true);
    expect(s.pos.refund).toBe(true);
    expect(s.pos.register_close).toBe(true);
    expect(s.pos.discount_max_percent).toBe(20);
    expect(s.requires_manager_approval).toContain('void_sale');
  });
});
