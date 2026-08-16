'use strict';

const CashbackService = require('../../../src/services/cashback.service');

describe('CashbackService.computeCashback', () => {
  const cfg = { enabled: true, percent: 10, min_spend: 0, max_cashback: 0 };

  test('gives a percentage of the bill', () => {
    expect(CashbackService.computeCashback(1000, cfg)).toBe(100);
    expect(CashbackService.computeCashback(250, cfg)).toBe(25);
  });

  test('respects the minimum spend', () => {
    expect(CashbackService.computeCashback(50, { ...cfg, min_spend: 100 })).toBe(0);
  });

  test('caps the cashback', () => {
    expect(CashbackService.computeCashback(1000, { ...cfg, max_cashback: 40 })).toBe(40);
  });

  test('gives nothing when disabled or percent is zero', () => {
    expect(CashbackService.computeCashback(1000, { ...cfg, enabled: false })).toBe(0);
    expect(CashbackService.computeCashback(1000, { ...cfg, percent: 0 })).toBe(0);
  });
});

describe('CashbackService.renderMessage', () => {
  test('fills the merge fields', () => {
    const out = CashbackService.renderMessage(
      '{name}: {currency}{amount} code {code} by {expiry} at {shop}',
      {
        name: 'Asha',
        amount: 40,
        code: 'CBABC123',
        currency: '₹',
        shop: 'Store',
        expiry: '2026-09-01',
      }
    );
    expect(out).toBe('Asha: ₹40 code CBABC123 by 2026-09-01 at Store');
  });
});
