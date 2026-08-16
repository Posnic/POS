'use strict';

/**
 * Unit tests for src/utils/approval-token.util.js
 * Pure crypto util - no mocks needed.
 */

const {
  signApproval,
  verifyApproval,
  isApprovedFor,
} = require('../../../src/utils/approval-token.util');

describe('approval-token', () => {
  test('sign -> verify round-trips the payload and adds an expiry', () => {
    const t = signApproval({ action: 'void_sale', cashier_user_id: 'c1' });
    const p = verifyApproval(t);
    expect(p).not.toBeNull();
    expect(p.action).toBe('void_sale');
    expect(p.cashier_user_id).toBe('c1');
    expect(p.exp).toBeGreaterThan(Date.now());
  });

  test('a tampered signature fails', () => {
    const t = signApproval({ action: 'void_sale' });
    expect(verifyApproval(t + 'x')).toBeNull(); // length/HMAC mismatch
  });

  test('malformed / empty tokens fail', () => {
    expect(verifyApproval('')).toBeNull();
    expect(verifyApproval('nodot')).toBeNull();
    expect(verifyApproval(null)).toBeNull();
    expect(verifyApproval(undefined)).toBeNull();
  });

  test('an expired token fails', () => {
    const t = signApproval({ action: 'void_sale' }, -1000); // exp in the past
    expect(verifyApproval(t)).toBeNull();
  });

  test('isApprovedFor checks action + cashier binding', () => {
    const t = signApproval({ action: 'void_sale', cashier_user_id: 'c1' });
    expect(isApprovedFor(t, 'void_sale', 'c1')).toBe(true);
    expect(isApprovedFor(t, 'refund', 'c1')).toBe(false); // wrong action
    expect(isApprovedFor(t, 'void_sale', 'c2')).toBe(false); // wrong cashier
    expect(isApprovedFor(t, 'void_sale')).toBe(true); // cashier optional
    expect(isApprovedFor('garbage', 'void_sale', 'c1')).toBe(false);
  });
});
