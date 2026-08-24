'use strict';

const demoSeed = require('../../../src/services/demo-seed');

/*
 * Sample customers and suppliers.
 *
 * Owner report: "supplier list or customer list not filled."
 *
 * A new shop was given exactly one of each - Walk-in Customer and General
 * Supplier - because the demo packs carry products and nothing else. Two of
 * the six things in the main menu opened looking broken, and every sample sale
 * belonged to the same walk-in, which is not what a customer list is for.
 */
describe('demo people', () => {
  const branch = { branch_id: 'b1', branch_name: 'Shop', license: 'l1' };
  const now = new Date('2026-08-23T10:00:00Z');
  const built = demoSeed.buildPeople({ branch, pack: 'cafe', now, base: {} });

  test('both lists are filled, and neither is a crowd', () => {
    /* Enough to show what the screens do; few enough that the shop's own
       first real entry is not buried among strangers. */
    expect(built.customers.length).toBeGreaterThanOrEqual(5);
    expect(built.customers.length).toBeLessThanOrEqual(12);
    expect(built.suppliers.length).toBeGreaterThanOrEqual(3);
    expect(built.suppliers.length).toBeLessThanOrEqual(8);
  });

  test('nobody owes anything', () => {
    /*
     * A demo customer carrying a balance puts money into the credit report
     * that nobody owes, and that figure is read as fact. They exist to be sold
     * to, not to be chased.
     */
    for (const p of [...built.customers, ...built.suppliers]) {
      expect(p.balance).toBe(0);
      expect(p.partial_balance).toBe(false);
    }
  });

  test('every row is tagged, so it can be removed exactly', () => {
    for (const p of [...built.customers, ...built.suppliers]) {
      expect(p.demo_pack).toBe('cafe');
      expect(p.demo_seeded_at).toBe(now);
      expect(p.license).toBe('l1');
      expect(p.branch_id).toBe('b1');
    }
  });

  test('names are distinct - two identical rows are not a list', () => {
    const names = built.customers.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('everyone has a phone, because that is how a shop finds them', () => {
    for (const p of [...built.customers, ...built.suppliers]) {
      expect(String(p.phone)).toMatch(/^\d{10}$/);
    }
  });
});

describe('sales are spread across the sample customers', () => {
  const branch = { branch_id: 'b1', branch_name: 'Shop', license: 'l1' };
  const items = [{ _id: 'i1', name: 'Bread', selling_price: 40, unit: 'pc' }];
  const now = new Date('2026-08-23T10:00:00Z');

  test('more than one person buys something', () => {
    /* Twelve sales to one walk-in demonstrates nothing about a customer list. */
    const customers = [
      { _id: 'c0', name: 'Walk-in Customer' },
      { _id: 'c1', name: 'Anand Kumar' },
      { _id: 'c2', name: 'Meera Raghavan' },
    ];
    const sales = demoSeed.buildSales({ items, customers, branch, pack: 'cafe', now });
    expect(new Set(sales.map((s) => s.customer_name)).size).toBeGreaterThan(1);
  });

  test('the walk-in is still among them', () => {
    /* A shop that never takes a counter sale is not a shop. */
    const customers = [
      { _id: 'c0', name: 'Walk-in Customer' },
      { _id: 'c1', name: 'Anand Kumar' },
    ];
    const sales = demoSeed.buildSales({ items, customers, branch, pack: 'cafe', now });
    expect(sales.some((s) => s.customer_name === 'Walk-in Customer')).toBe(true);
  });

  test('with nobody to sell to it still produces sales', () => {
    /* The generator must not depend on the people having been seeded. */
    const sales = demoSeed.buildSales({ items, branch, pack: 'cafe', now });
    expect(sales.length).toBeGreaterThan(0);
    expect(sales[0].customer_name).toBe('Walk-in Customer');
  });
});

describe('demo people and the unique email index', () => {
  const seed = require('../../../src/services/demo-seed');
  const branch = { branch_id: 'B', branch_name: 'Shop', license: 'L' };
  const people = seed.buildPeople({ branch, pack: 'cafe', now: new Date(0), base: {} });

  test('every person carries a distinct email', () => {
    /*
     * suppliers carry a unique index on email, and the shop's own General
     * Supplier already holds the empty string. Five demo suppliers arriving
     * with email:'' meant the first insert collided (E11000), the whole
     * people write failed, and the sample sales and quotes built on those
     * people were silently skipped - xyzshop got products and nothing else,
     * with the only trace one line in a server log.
     */
    const all = [...people.customers, ...people.suppliers].map((p) => p.email);
    expect(all.every((e) => e && e.length > 3)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  test('the placeholder addresses can never deliver or belong to anyone', () => {
    /* RFC 2606 reserves example.com for exactly this. A plausible real domain
       would one day send a campaign email to a stranger. */
    for (const p of [...people.customers, ...people.suppliers]) {
      expect(p.email).toMatch(/^[a-z0-9.]+@example\.com$/);
    }
  });
});
