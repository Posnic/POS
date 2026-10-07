'use strict';
const { ObjectId } = require('mongodb');
const seed = require('../../../src/services/demo-seed');
const { aliases, untouched, repairDemoRecords } = require('../../../src/services/demo-repair');
const now = new Date('2026-10-01T12:00:00Z');
const branch = { branch_id: new ObjectId(), license: new ObjectId(), branch_name: 'Sample' };
const items = [
  { _id: new ObjectId(), name: 'Pizza', selling_price: 200, company_price: 120, unit: 'plate' },
  { _id: new ObjectId(), name: 'Tea', selling_price: 40, company_price: 15, unit: 'cup' },
];
const suppliers = [{ _id: new ObjectId(), name: 'Sample supplier' }];
test.each([
  'restaurant',
  'cafe',
  'bakery',
  'retail',
  'hardware',
  'pharmacy',
  'textile',
  'auto_parts',
])('%s documents reconcile using UI fields', (pack) => {
  const supplies = seed.buildPurchaseSupplies({ items, branch, pack, now });
  const purchases = seed.buildPurchases({
    items: supplies.length ? supplies : items,
    suppliers,
    branch,
    pack,
    now,
  });
  expect(purchases).toHaveLength(5);
  for (const doc of purchases) {
    let total = 0;
    for (const l of doc.items) {
      expect(l.item_quantity).toBeGreaterThan(0);
      expect(l.item_price).toBeGreaterThan(0);
      expect(l.total_amount).toBeCloseTo(l.item_quantity * l.item_price, 2);
      total += l.total_amount;
    }
    expect(doc.subtotal_amount).toBeCloseTo(total, 2);
    expect(doc.total_amount).toBeCloseTo(total, 2);
    expect(doc.items_total).toBeCloseTo(total, 2);
    if (supplies.length)
      for (const l of doc.items) expect(['Pizza', 'Tea']).not.toContain(l.item_name);
  }
  for (const q of seed.buildQuotes({ items, branch, pack, now })) {
    expect(q.items.reduce((n, l) => n + l.line_total, 0)).toBeCloseTo(q.total, 2);
    for (const l of q.items) expect(l.line_total).toBeCloseTo(l.qty * l.unit_price, 2);
  }
  for (const s of seed.buildSales({ items, branch, pack, now })) {
    expect(s.items.reduce((n, l) => n + l.total_amount, 0)).toBeCloseTo(s.items_total, 2);
    for (const l of s.items) expect(l.total_amount).toBeCloseTo(l.item_quantity * l.item_price, 2);
  }
  for (const s of supplies) {
    expect(s.available_quantity).toBe(0);
    expect(s.track_inventory).toBe(true);
    expect(s.negative_stock).toBe(false);
  }
});
const legacy = {
  _id: new ObjectId(),
  ...branch,
  demo_pack: 'retail',
  created_by: 'Demo data',
  created_date: now,
  updated_date: now,
  total_amount: 60,
  items: [{ name: 'Soap', quantity: 2, unit_price: 30, total: 60 }],
};
test('repair rejects real, edited, returned, already repaired and inconsistent samples', () => {
  expect(untouched(legacy)).toBeTruthy();
  for (const change of [
    { demo_pack: null },
    { created_by: 'Owner' },
    { updated_by: 'Owner' },
    { updated_date: new Date(+now + 1) },
    { items_return: [{}] },
    { demo_seed_version: 2 },
  ])
    expect(untouched({ ...legacy, ...change })).toBeFalsy();
  expect(aliases({ ...legacy, total_amount: 70 }, 'receivings')).toBeNull();
  const result = aliases(legacy, 'receivings');
  expect(result.items[0].item_quantity).toBe(2);
  expect(result.items[0].item_price).toBe(30);
  expect(result.subtotal_amount).toBe(60);
});
test('repair compares original contents and preserves originals; second pass is a no-op', async () => {
  let row = { ...legacy };
  const writes = [];
  const coll = {
    find: () => ({
      async *[Symbol.asyncIterator]() {
        yield row;
      },
    }),
    updateOne: async (filter, op) => {
      writes.push({ filter, op });
      row = { ...row, ...op.$set };
    },
  };
  await repairDemoRecords({ collection: () => coll });
  expect(writes).toHaveLength(1);
  expect(writes[0].filter.items).toEqual(legacy.items);
  expect(row.demo_repair_original.items).toEqual(legacy.items);
  await repairDemoRecords({ collection: () => coll });
  expect(writes).toHaveLength(1);
});

test('legacy restaurant purchase becomes a reconciled supply bill with real supply ids', async () => {
  const purchase = {
    ...legacy,
    demo_pack: 'restaurant',
    receiving_id: 'R-DEMO-000001',
    supplier_id: suppliers[0]._id,
    supplier_name: 'Restaurant Service Parts',
    demo_seeded_at: now,
  };
  const writes = [];
  const itemWrites = [];
  const cols = {
    sales: { find: () => ({ async *[Symbol.asyncIterator]() {} }) },
    quotes: { find: () => ({ async *[Symbol.asyncIterator]() {} }) },
    receivings: {
      find: () => ({
        async *[Symbol.asyncIterator]() {
          yield purchase;
        },
      }),
      updateOne: async (f, o) => writes.push(o.$set),
    },
    items: {
      find: () => ({ toArray: async () => items }),
      updateOne: async (f, o) => itemWrites.push(o.$setOnInsert),
    },
    suppliers: { findOne: async () => null },
  };
  await repairDemoRecords({ collection: (n) => cols[n] });
  expect(writes).toHaveLength(1);
  const fixed = writes[0];
  expect(fixed.items.map((l) => l.item_name).sort()).toEqual(['Cooking oil', 'Long-grain rice']);
  expect(fixed.items.reduce((n, l) => n + l.total_amount, 0)).toBeCloseTo(fixed.total_amount, 2);
  for (const line of fixed.items)
    expect(itemWrites.some((i) => String(i._id) === line.item_id)).toBe(true);
  expect(fixed.demo_repair_original.items).toEqual(purchase.items);
});
