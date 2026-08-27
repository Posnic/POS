'use strict';

/*
 * The seed's rows must be the SAME SHAPE the app writes, down to BSON types.
 *
 * Every list screen scopes by the session's ObjectIds. A seeder that
 * stringifies branch_id writes rows that exist, count in aggregates, and
 * never appear on their own history page - the public demo shipped exactly
 * that: 14 sales, 3 quotes and 5 purchases in Mongo, every list empty, and
 * the owner reading it as "purchase is not working". The dashboard looked
 * alive while every history screen said the shop had never traded.
 *
 * So this is a contract, not a unit test: whatever context the caller
 * passes, the built documents must carry it UNCHANGED - ObjectIds stay
 * ObjectIds - and every date field must be a real Date, never a string.
 */

const { ObjectId } = require('mongodb');
const demoSeed = require('../../../src/services/demo-seed');

const branchId = new ObjectId();
const licenseId = new ObjectId();
const now = new Date('2026-08-27T10:00:00Z');

const branch = {
  branch_id: branchId,
  branch_name: 'Typed Branch',
  license: licenseId,
  country_id: '101',
  state: 'Tamil Nadu',
  sortname: 'IN',
};

const items = Array.from({ length: 8 }, (_, i) => ({
  _id: new ObjectId(),
  name: `Item ${i}`,
  selling_price: 50 + i,
  purchase_price: 30 + i,
  cost_price: 30 + i,
  unit: 'pcs',
}));

const people = demoSeed.buildPeople({ branch, pack: 'supermarket', now, base: {} });
const customers = people.customers.map((c) => ({ _id: new ObjectId(), name: c.name }));
const suppliers = people.suppliers.map((s) => ({
  _id: new ObjectId(),
  name: s.name,
  phone: s.phone || '',
}));

const sales = demoSeed.buildSales({
  items,
  customers,
  customer: customers[0],
  branch,
  pack: 'supermarket',
  now,
  userName: 'admin',
});
const quotes = demoSeed.buildQuotes({ items, branch, pack: 'supermarket', now });
const purchases = demoSeed.buildPurchases({ items, suppliers, branch, pack: 'supermarket', now });

const DATE_FIELDS = ['date', 'created_date', 'updated_date', 'demo_seeded_at'];

function expectTyped(doc, label) {
  expect(doc.branch_id).toBeInstanceOf(ObjectId);
  expect(doc.branch_id.equals(branchId)).toBe(true);
  expect(doc.license).toBeInstanceOf(ObjectId);
  expect(doc.license.equals(licenseId)).toBe(true);
  for (const f of DATE_FIELDS) {
    if (doc[f] !== undefined) {
      expect(doc[f]).toBeInstanceOf(Date);
    }
  }
}

describe('demo-seed BSON type contract', () => {
  test('every built sale carries the caller ObjectIds and real dates', () => {
    expect(sales.length).toBeGreaterThan(0);
    for (const s of sales) expectTyped(s, 'sale');
  });

  test('every built quote carries the caller ObjectIds and real dates', () => {
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) expectTyped(q, 'quote');
  });

  test('every built purchase carries the caller ObjectIds and real dates', () => {
    expect(purchases.length).toBeGreaterThan(0);
    for (const p of purchases) expectTyped(p, 'purchase');
  });

  test('every built person carries the caller ObjectIds and real dates', () => {
    const rows = people.customers.concat(people.suppliers);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expectTyped(r, 'person');
  });
});
