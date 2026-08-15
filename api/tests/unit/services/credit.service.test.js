'use strict';

const CreditService = require('../../../src/services/credit.service');

describe('CreditService.renderReminder', () => {
  test('fills name, due, currency and shop', () => {
    const out = CreditService.renderReminder('Hi {name}, {currency}{due} due at {shop}.', {
      name: 'Asha',
      due: 250.5,
      currency: '$',
      shop: 'Corner Store',
    });
    expect(out).toBe('Hi Asha, $250.5 due at Corner Store.');
  });

  test('falls back to a default template and tolerates missing data', () => {
    const out = CreditService.renderReminder('', { name: 'Bo', due: 10, currency: '₹' });
    expect(out).toContain('Bo');
    expect(out).toContain('10');
    expect(CreditService.renderReminder('{name} {unknown}', {})).toBe('Customer {unknown}');
  });
});

describe('CreditService.withinLimit', () => {
  test('0 limit means unlimited', () => {
    const r = CreditService.withinLimit(0, 5000, 1000);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(0);
  });

  test('allows a sale that stays within the limit', () => {
    const r = CreditService.withinLimit(10000, 6000, 3000);
    expect(r.allowed).toBe(true);
    expect(r.wouldBe).toBe(9000);
  });

  test('blocks a sale that would break the limit', () => {
    const r = CreditService.withinLimit(10000, 6000, 5000);
    expect(r.allowed).toBe(false);
    expect(r.wouldBe).toBe(11000);
  });

  test('exactly at the limit is allowed', () => {
    expect(CreditService.withinLimit(10000, 6000, 4000).allowed).toBe(true);
  });
});
