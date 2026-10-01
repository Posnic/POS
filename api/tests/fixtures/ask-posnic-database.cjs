'use strict';

const { test, before: beforeAll, after: afterAll, beforeEach } = require('node:test');
const { expect } = require('expect');
const jest = require('jest-mock');

const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
let mockDb;
require.cache[require.resolve('../../src/models/base.model')] = { exports: class {
  async getCollection(name) { return mockDb.collection(name); }
  static async getDb() { return mockDb; }
} };
require.cache[require.resolve('../../src/services/ai-budget')] = { exports: {
  monthKey: () => '2026-10', currencyOf: async () => ({ rate: 1, code: 'USD' }),
  priceFor: () => ({ in: 5, out: 25 }),
  costMinor: ({ tokensOut }) => Math.ceil(Number(tokensOut || 0) / 100),
  costMicrominor: ({ tokensOut }) => Math.ceil(Number(tokensOut || 0) / 100) * 1e6,
} };
const platform = require('../../src/services/ask-posnic-platform.service');
const credits = require('../../src/services/managed-ai-credits.service');
const schedules = require('../../src/services/ask-posnic-schedule.service');
const retention = require('../../src/services/ask-posnic-retention.service');
const trends = require('../../src/services/ask-posnic-trends.service');
const commerceInsights = require('../../src/services/ask-posnic-commerce-insights.service');
const saleDrafts = require('../../src/services/ask-posnic-sale-draft.service');
const outletInsights = require('../../src/services/ask-posnic-outlet-insights.service');
const promotionInsights = require('../../src/services/ask-posnic-promotion-insights.service');
const supplierMessages = require('../../src/services/ask-posnic-supplier-message.service');
const reorders = require('../../src/services/ask-posnic-reorder.service');
const inventoryDrafts = require('../../src/services/ask-posnic-inventory-drafts.service');
const { validateInventory } = require('../../src/services/ask-posnic-action-validation.service');
const semantic = require('../../src/services/ask-posnic-semantic.service');
const insightModel = () => ({ branchId: 'outlet-a', licenseId: 'shop-a', getCollection: (name) => mockDb.collection(name), getContextMatch: (filter) => ({ ...filter, branch_id: 'outlet-a', license: 'shop-a' }) });
const insightPeriod = { start_date: new Date('2026-09-01T00:00:00Z'), end_date: new Date('2026-09-30T23:59:59.999Z') };
const saleForInsights = () => ({ branch_id: 'outlet-a', license: 'shop-a', date: new Date('2026-09-15T10:00:00Z'), sale_process: 'Add' });
const req = (license = 'shop-a', branch = 'outlet-a', user = 'owner-a') => ({ tenantContext: { licenseId: license, branchId: branch }, user: { _id: user, role: 'admin' } });
let server;
let client;
const savedEnv = { cap: process.env.POSNIC_MANAGED_AI_MONTHLY_CAP, secret: process.env.ASK_POSNIC_ACTION_SECRET, billingUrl: process.env.ASK_POSNIC_BILLING_URL, billingToken: process.env.ASK_POSNIC_BILLING_TOKEN };
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  mockDb = client.db('ask_posnic_isolated_tests');
  process.env.ASK_POSNIC_ACTION_SECRET = 'isolated-test-secret-do-not-use-in-production';
});
beforeEach(async () => { await mockDb.dropDatabase(); process.env.POSNIC_MANAGED_AI_MONTHLY_CAP = '1'; delete process.env.ASK_POSNIC_BILLING_URL; delete process.env.ASK_POSNIC_BILLING_TOKEN; });

test('PDF pages survive publication and bundle import, with revision and tenant checks at citation opening', async () => {
  const mapped = require('../../src/services/knowledge-page-map').fromPages([{ num: 1, text: 'Receipt printer setup: choose Print settings.' }, { num: 2, text: '' }, { num: 3, text: 'Review printer connections before checkout.' }], 3);
  const doc = await platform.saveDocument(req(), { title: 'Printer guide', kind: 'pdf', status: 'published', revision: 'r1', ...mapped });
  const matches = await platform.retrieve(req(), 'Receipt printer setup');
  expect(matches[0].pages).toEqual([1, 3]);
  const opened = await platform.getDocument(req(), String(doc._id), { revision: 'r1', chunk: '0' });
  expect(opened.sections.map(section => section.page)).toEqual([1, 3]);
  expect(opened.sections[1].text).toBe('Review printer connections before checkout.');
  expect(await platform.getDocument(req('shop-b'), String(doc._id), { revision: 'r1', chunk: '0' })).toBeNull();
  expect(await platform.getDocument(req(), String(doc._id), { revision: 'r0', chunk: '0' })).toBeNull();
  const bundle = { schema: 'posnic.ask-knowledge.v1', source: 'posnic-intranet', snapshot: true, documents: [{ seriesId: 'pdf-source', version: 1, title: 'Published PDF', kind: 'pdf', status: 'published', visibility: 'customer', ...mapped }] };
  await platform.importBundle(req(), bundle);
  const imported = await mockDb.collection('ask_posnic_documents').findOne({ central_id: 'pdf-source' });
  expect(imported.page_map).toEqual(mapped.page_map);
  const invalid = { ...bundle, documents: [{ ...bundle.documents[0], content: 'Changed without fresh page mapping' }] };
  await expect(platform.importBundle(req(), invalid)).rejects.toThrow(/no longer matches/);
  expect((await mockDb.collection('ask_posnic_documents').findOne({ _id: imported._id })).status).toBe('published');
  await platform.setDocumentStatus(req(), String(doc._id), 'retired');
  expect(await platform.getDocument(req(), String(doc._id), { revision: 'r1', chunk: '0' })).toBeNull();
});

test('retention trims individual old messages without extending them when a conversation continues', async () => {
  const at = new Date(), recent = new Date(at.getTime() - 1000), old = new Date(at.getTime() - 31 * 86400000);
  const scope = { license: 'shop-a', branch_id: 'outlet-a', user_id: 'owner-a' };
  await mockDb.collection('ask_posnic_conversations').insertMany([
    { ...scope, updated_at: recent, messages: [{ role: 'user', payload: 'Expired private question', at: old }, { role: 'assistant', payload: 'Current answer', at: recent }, { role: 'user', payload: 'Undated legacy data' }] },
    { ...scope, updated_at: recent, messages: [{ role: 'user', at: old }] },
    { ...scope, license: 'shop-b', messages: [{ role: 'user', at: old }] },
  ]);
  const visible = await platform.history(req());
  expect(visible).toHaveLength(1);
  expect(visible[0].messages.map(row => row.payload)).toEqual(['Current answer']);
  const result = await retention.sweep(mockDb, { licenseId: 'shop-a', at });
  expect(result).toMatchObject({ conversationsChanged: 2, conversationsDeleted: 1 });
  expect(await mockDb.collection('ask_posnic_conversations').countDocuments({ license: 'shop-b' })).toBe(1);
  expect((await mockDb.collection('ask_posnic_conversations').findOne({ license: 'shop-a' })).messages).toHaveLength(1);
  expect(await retention.sweep(mockDb, { licenseId: 'shop-a', at })).toEqual({ conversationsChanged: 0, conversationsDeleted: 0, feedbackDeleted: 0 });
});

test('retention respects each shop policy, bounds a sweep and leaves accounting and action records intact', async () => {
  const at = new Date(), old = new Date(at.getTime() - 31 * 86400000), scope = { license: 'shop-a', branch_id: 'outlet-a', user_id: 'owner-a' };
  await mockDb.collection('ask_posnic_preferences').insertOne({ license: 'shop-b', retention_days: 90 });
  await mockDb.collection('ask_posnic_feedback').insertMany([
    ...Array.from({ length: 3 }, () => ({ ...scope, at: old, note: 'Expired feedback' })),
    { ...scope, license: 'shop-b', at: old }, { ...scope, at: new Date(at.getTime() - 1000) },
  ]);
  for (const name of ['ask_posnic_audit', 'ask_posnic_action_drafts', 'managed_ai_credits', 'managed_ai_reservations']) await mockDb.collection(name).insertOne({ ...scope, at: old, sentinel: true });
  expect((await platform.usage(req())).feedback).toBe(1);
  expect((await retention.sweep(mockDb, { at, limit: 2 })).feedbackDeleted).toBe(2);
  expect((await retention.sweep(mockDb, { at, limit: 2 })).feedbackDeleted).toBe(1);
  expect(await mockDb.collection('ask_posnic_feedback').countDocuments()).toBe(2);
  for (const name of ['ask_posnic_audit', 'ask_posnic_action_drafts', 'managed_ai_credits', 'managed_ai_reservations']) expect(await mockDb.collection(name).countDocuments({ sentinel: true })).toBe(1);
});

test('retention settings reject malformed values and older clients preserve the current policy', async () => {
  expect((await platform.getPreferences(req())).retention_days).toBe(30);
  for (const value of [0, -1, 8, '90', [30], null, 10000]) await expect(platform.savePreferences(req(), { retention_days: value })).rejects.toThrow('retention period');
  await platform.savePreferences(req(), { retention_days: 90 });
  await platform.savePreferences(req(), { store_conversations: false });
  expect((await platform.getPreferences(req())).retention_days).toBe(90);
  await platform.saveMessage(req(), '', 'user', 'Storage disabled');
  expect(await mockDb.collection('ask_posnic_conversations').countDocuments()).toBe(0);
  await platform.savePreferences(req(), { retention_days: 7 });
  expect((await platform.getPreferences(req())).retention_days).toBe(7);
});

test('history deletion removes only the requesting user and outlet feedback, preserving other data', async () => {
  const scope = { license: 'shop-a', branch_id: 'outlet-a', user_id: 'owner-a' }, at = new Date();
  for (const name of ['ask_posnic_conversations', 'ask_posnic_feedback']) await mockDb.collection(name).insertMany([
    { ...scope, at }, { ...scope, user_id: 'owner-b', at }, { ...scope, branch_id: 'outlet-b', at }, { ...scope, license: 'shop-b', at },
  ]);
  await mockDb.collection('ask_posnic_audit').insertOne({ ...scope, at, event: 'action_confirmed' });
  expect(await platform.deleteHistory(req())).toEqual({ deletedCount: 1, feedbackDeletedCount: 1 });
  for (const name of ['ask_posnic_conversations', 'ask_posnic_feedback']) expect(await mockDb.collection(name).countDocuments()).toBe(3);
  expect(await mockDb.collection('ask_posnic_audit').countDocuments()).toBe(1);
});

test('cleanup preserves a message appended between selection and pruning', async () => {
  const at = new Date(), old = new Date(at.getTime() - 366 * 86400000), col = mockDb.collection('ask_posnic_conversations');
  const { insertedId } = await col.insertOne({ license: 'shop-a', messages: [{ at: old, payload: 'expired' }] });
  const { Collection } = require('mongodb');
  const original = Collection.prototype.updateMany;
  const hooked = jest.spyOn(Collection.prototype, 'updateMany').mockImplementation(async function (...args) {
    if (this.collectionName === 'ask_posnic_conversations') await col.updateOne({ _id: insertedId }, { $push: { messages: { at, payload: 'concurrent' } } });
    return original.apply(this, args);
  });
  try { await retention.sweep(mockDb, { licenseId: 'shop-a', at }); } finally { hooked.mockRestore(); }
  expect((await col.findOne({ _id: insertedId })).messages.map(row => row.payload)).toEqual(['concurrent']);
});

test('reorder planning uses complete local days, item thresholds and net open-order quantities within the outlet', async () => {
  const ids = Array.from({ length: 4 }, () => new ObjectId());
  const item = { license: 'shop-a', branch_id: 'outlet-a', track_inventory: true, item_status: 'active', supplier_id: new ObjectId(), supplier_name: 'Supplier A', cost_price: 3, unit: 'pcs' };
  await mockDb.collection('items').insertMany([
    { ...item, _id: ids[0], name: 'Tea', available_quantity: 1 },
    { ...item, _id: ids[1], name: 'Milk', available_quantity: 3, reorder_point: 8 },
    { ...item, _id: ids[2], name: 'Backorder', available_quantity: -2 },
    { ...item, _id: ids[3], name: 'Unassigned', available_quantity: 1, reorder_point: 2, supplier_name: '' },
    { ...item, name: 'Deleted', available_quantity: -100, del_status: 1 },
    { ...item, name: 'Inactive', available_quantity: -100, item_status: 'inactive' },
    { ...item, name: 'Untracked', available_quantity: -100, track_inventory: false },
    { ...item, name: 'Other shop', available_quantity: -100, license: 'shop-b' },
    { ...item, name: 'Other outlet', available_quantity: -100, branch_id: 'outlet-b' },
  ]);
  const sale = (qty) => ({ ...saleForInsights(), items: [{ item_id: ids[0], item_quantity: qty }] });
  await mockDb.collection('sales').insertMany([
    { ...sale(10), date: new Date('2026-08-31T18:30:00Z') },
    { ...sale(20), items: [{ item_id: String(ids[0]), item_quantity: 20 }] },
    { ...sale(1000), date: new Date('2026-08-31T18:29:59Z') },
    { ...sale(1000), date: new Date('2026-09-30T18:30:00Z') },
    { ...sale(1000), sale_process: 'FullReturn' },
    { ...sale(1000), license: 'shop-b' }, { ...sale(1000), branch_id: 'outlet-b' },
  ]);
  const po = { license: 'shop-a', branch_id: 'outlet-a', items: [{ item_id: ids[0], qty_ordered: 5, qty_received: 2 }] };
  await mockDb.collection('purchase_orders').insertMany([
    { ...po, status: 'ordered' }, { ...po, status: 'partial', items: [{ item_id: String(ids[0]), qty_ordered: 4, qty_received: 3 }] },
    ...['draft', 'cancelled', 'closed'].map((status) => ({ ...po, status })),
    { ...po, status: 'ordered', license: 'shop-b' }, { ...po, status: 'ordered', branch_id: 'outlet-b' },
  ]);
  const model = { ...insightModel(), timeZone: 'Asia/Kolkata' }, at = new Date('2026-10-01T03:00:00Z');
  const result = await reorders.read(model, {}, at);
  expect(result.count).toBe(4);
  expect(result.plan).toMatchObject({ lookback_days: 30, coverage_days: 7, from: '2026-08-31T18:30:00.000Z', to: '2026-09-30T18:29:59.999Z' });
  expect(result.rows.find((row) => row.item_name === 'Tea')).toMatchObject({ sold: 30, daily_rate: 1, incoming: 4, target: 7, qty_ordered: 2 });
  expect(result.rows.find((row) => row.item_name === 'Milk')).toMatchObject({ sold: 0, target: 8, qty_ordered: 5 });
  const prepared = await reorders.prepare(model, {}, at);
  expect(prepared.orders).toHaveLength(1);
  expect(prepared.orders[0].items).toHaveLength(3);
  expect(prepared.skipped_without_supplier).toEqual(['Unassigned']);
  await reorders.validate(model, prepared);
  await mockDb.collection('purchase_orders').insertOne({ ...po, status: 'ordered', items: [{ item_id: ids[0], qty_ordered: 1, qty_received: 0 }] });
  await expect(reorders.validate(model, prepared)).rejects.toThrow('incoming orders changed');
  expect(await mockDb.collection('purchase_orders').countDocuments({ status: 'draft' })).toBe(1);
});

test('reorder options are bounded and malformed incoming quantities cannot become zero incoming stock', async () => {
  expect(reorders.options({}, 'Show reorder suggestions for next 14 days based on last 60 days')).toEqual({ coverage_days: 14, lookback_days: 60 });
  expect(() => reorders.options({ coverage_days: 0 })).toThrow('whole numbers');
  expect(() => reorders.options({ lookback_days: 6 })).toThrow('whole numbers');
  expect(() => reorders.options({ lookback_days: 91 })).toThrow('whole numbers');
  expect(() => reorders.options({ coverage_days: true })).toThrow('whole numbers');
  expect(() => reorders.options({ coverage_days: [7] })).toThrow('whole numbers');
  expect(reorders.options(null)).toEqual({ lookback_days: 30, coverage_days: 7 });
  const itemId = new ObjectId();
  await mockDb.collection('items').insertOne({ _id: itemId, license: 'shop-a', branch_id: 'outlet-a', track_inventory: true, reorder_point: 5, available_quantity: 0 });
  await mockDb.collection('purchase_orders').insertOne({ license: 'shop-a', branch_id: 'outlet-a', status: 'ordered', items: [{ item_id: itemId, qty_ordered: 'bad', qty_received: 0 }] });
  await expect(reorders.read(insightModel(), {})).rejects.toThrow('Check quantities on open purchase orders');
});

test('inventory drafts exclude deleted and untracked items and subtract scoped incoming orders', async () => {
  const id = new ObjectId();
  const item = { license: 'shop-a', branch_id: 'outlet-a', name: 'Tea', track_inventory: true, item_status: 'active', available_quantity: 2, supplier_id: new ObjectId(), supplier_name: 'Tea supplier', cost_price: 3, unit: 'pcs' };
  await mockDb.collection('items').insertMany([
    { ...item, _id: id },
    ...[1, '1', true].map((del_status) => ({ ...item, del_status })),
    { ...item, track_inventory: false }, { ...item, track_inventory: null },
    { ...item, item_status: 'inactive' }, { ...item, item_status: 'draft' },
    { ...item, license: 'shop-b' }, { ...item, branch_id: 'outlet-b' },
    { ...item, available_quantity: 10 },
  ]);
  const po = { license: 'shop-a', branch_id: 'outlet-a', status: 'ordered', items: [{ item_id: id, qty_ordered: 5, qty_received: 2 }] };
  await mockDb.collection('purchase_orders').insertMany([
    { ...po }, { ...po, status: 'partial', items: [{ item_id: String(id), qty_ordered: 2, qty_received: 1 }] },
    ...['draft', 'cancelled', 'closed'].map((status) => ({ ...po, status })),
    { ...po, license: 'shop-b' }, { ...po, branch_id: 'outlet-b' },
  ]);
  const draft = await inventoryDrafts.lowStock(insightModel());
  expect(draft.orders).toHaveLength(1);
  expect(draft.orders[0].items).toHaveLength(1);
  expect(draft.orders[0].items[0]).toMatchObject({ item_id: String(id), incoming_quantity: 4, qty_ordered: 4 });
  await validateInventory('purchase_order', draft, insightModel());
  const count = await inventoryDrafts.stockCount(insightModel());
  expect(count.items).toHaveLength(2);
  await validateInventory('stock_count', count, insightModel());
  await mockDb.collection('items').updateOne({ _id: id }, { $set: { track_inventory: false } });
  await expect(validateInventory('stock_count', count, insightModel())).rejects.toThrow('Inventory changed');
  await expect(validateInventory('purchase_order', draft, insightModel())).rejects.toThrow('Inventory changed');
  await mockDb.collection('items').updateOne({ _id: id }, { $set: { track_inventory: true } });
  await mockDb.collection('purchase_orders').insertOne({ ...po });
  await expect(validateInventory('purchase_order', draft, insightModel())).rejects.toThrow('Incoming orders changed');
  expect((await inventoryDrafts.lowStock(insightModel())).orders[0].items[0].qty_ordered).toBe(1);
  await mockDb.collection('purchase_orders').insertOne({ ...po, items: [{ item_id: id, qty_ordered: 'broken', qty_received: 0 }] });
  await expect(inventoryDrafts.lowStock(insightModel())).rejects.toThrow('Check quantities on open purchase orders');
});

test('supplier-message drafts derive remaining PO quantities and require unchanged source before saving', async () => {
  const orderId = new ObjectId();
  await mockDb.collection('purchase_orders').insertMany([
    { _id: orderId, license: 'shop-a', branch_id: 'outlet-a', po_id: 'PO-000001', status: 'draft', supplier_name: 'Supplier <img src=x>', items: [{ item_id: new ObjectId(), item_name: 'Tea', qty_ordered: 5.5, qty_received: 2 }] },
    { license: 'shop-b', branch_id: 'outlet-a', po_id: 'PO-000002', status: 'draft' },
    { license: 'shop-a', branch_id: 'outlet-b', po_id: 'PO-000003', status: 'draft' },
  ]);
  const payload = await supplierMessages.prepare(insightModel(), { purchase_order: 'po-000001', body: 'Forged message', note: 'Please reply by Friday.' });
  expect(payload.kind).toBe('availability_request');
  expect(payload.body).toContain('Tea: 3.5');
  expect(payload.body).toContain('proposed order');
  expect(payload.body).not.toContain('Forged message');
  await supplierMessages.validate(insightModel(), payload);
  await expect(supplierMessages.validate(insightModel(), { ...payload, body: 'Tampered' })).rejects.toThrow('changed');
  await expect(supplierMessages.prepare(insightModel(), { purchase_order: 'PO-000002' })).rejects.toThrow('in this outlet');
  await expect(supplierMessages.prepare(insightModel(), { purchase_order: 'PO-000003' })).rejects.toThrow('in this outlet');
  await mockDb.collection('purchase_orders').updateOne({ _id: orderId }, { $set: { status: 'partial', 'items.0.qty_received': 3 } });
  await expect(supplierMessages.validate(insightModel(), payload)).rejects.toThrow('changed');
  const updated = await supplierMessages.prepare(insightModel(), { purchase_order: String(orderId) });
  expect(updated.kind).toBe('delivery_followup');
  expect(updated.body).toContain('Tea: 2.5');
  await mockDb.collection('purchase_orders').updateOne({ _id: orderId }, { $set: { status: 'cancelled' } });
  await expect(supplierMessages.prepare(insightModel(), { purchase_order: String(orderId) })).rejects.toThrow('no longer open');
});

test('supplier messages persist once and saved text is restricted to the initiating user, shop and outlet', async () => {
  const licenseId = new ObjectId(), branchId = new ObjectId(), userId = new ObjectId();
  const context = { licenseId, branchId, userId, askPosnicAction: { id: String(new ObjectId()), step: 0 } };
  const payload = { subject: 'Delivery follow-up: PO-000001', body: 'Private message', po_id: 'PO-000001', supplier_name: 'Test' };
  const first = await supplierMessages.save(payload, context);
  const replay = await supplierMessages.save(payload, context);
  expect(replay.id).toBe(first.id);
  expect(await mockDb.collection('supplier_message_drafts').countDocuments()).toBe(1);
  expect(await supplierMessages.list(req(String(licenseId), String(branchId), String(userId)))).toHaveLength(1);
  expect(await supplierMessages.list(req(String(licenseId), String(branchId), String(new ObjectId())))).toHaveLength(0);
  expect(await supplierMessages.list(req(String(new ObjectId()), String(branchId), String(userId)))).toHaveLength(0);
  expect(await supplierMessages.list(req(String(licenseId), String(new ObjectId()), String(userId)))).toHaveLength(0);
});

test('coupon promotion reports isolate redemptions, exclude voids and preserve currencies', async () => {
  const row = { license: 'shop-a', branch_id: 'outlet-a', date: new Date('2026-09-15T10:00:00Z'), code: ' SAVE ', currency: 'usd', discount: 5, bill_total: 25, voided: false, customer_name: 'Private customer' };
  await mockDb.collection('coupon_redemptions').insertMany([
    row, { ...row, code: 'save', discount: '2.50', bill_total: '10' },
    { ...row, currency: 'INR', discount: 50, bill_total: 500 },
    { ...row, code: 'OTHER', discount: 3, bill_total: 30 },
    { ...row, license: 'shop-b', discount: 99999 },
    { ...row, branch_id: 'outlet-b', discount: 99999 },
    { ...row, voided: true, discount: 99999 },
    { ...row, date: new Date('2026-10-01T00:00:00Z'), discount: 99999 },
  ]);
  const result = await promotionInsights.read(insightModel(), insightPeriod);
  expect(result).toMatchObject({ count: 3, currencies: [
    { currency: 'INR', uses: 1, discount: 50, bill_total: 500 },
    { currency: 'USD', uses: 3, discount: 10.5, bill_total: 65 },
  ] });
  expect(result.rows[0]).toEqual({ code: 'SAVE', currency: 'USD', uses: 2, discount: 7.5, bill_total: 35 });
  const answer = promotionInsights.answer(result, 'month');
  expect(answer.metrics[0]).toEqual({ label: 'Recorded coupon uses', value: 4 });
  expect(answer.answer).toContain('not sales lift');
  expect(JSON.stringify(result)).not.toContain('Private customer');
  await expect(promotionInsights.read(insightModel(), { start_date: insightPeriod.end_date, end_date: insightPeriod.start_date })).rejects.toThrow('valid report period');
});

test('coupon report full totals include codes beyond the visible ten and legacy missing currency stays separate', async () => {
  await mockDb.collection('coupon_redemptions').insertMany(Array.from({ length: 12 }, (_, n) => ({ license: 'shop-a', branch_id: 'outlet-a', date: new Date('2026-09-15T10:00:00Z'), code: `CODE${n}`, discount: 1, bill_total: 10 })));
  const result = await promotionInsights.read(insightModel(), insightPeriod);
  expect(result.count).toBe(12);
  expect(result.rows).toHaveLength(10);
  expect(result.currencies).toEqual([{ currency: 'Currency not recorded', uses: 12, discount: 12, bill_total: 120 }]);
  const empty = await promotionInsights.read({ ...insightModel(), getContextMatch: (filter) => ({ ...filter, license: 'shop-b', branch_id: 'outlet-a' }) }, insightPeriod);
  expect(promotionInsights.answer(empty, 'month').answer).toContain('No non-voided');
});

test('outlet comparison derives assignments from the database, isolates licenses and keeps currencies separate', async () => {
  const second = new ObjectId();
  await mockDb.collection('users').insertOne({ _id: 'owner-a', license: 'shop-a', role: 'admin', branch_access: [{ branch_id: 'outlet-a' }, { branch_id: String(second) }, { branch_id: 'foreign' }, { branch_id: 'empty' }] });
  await mockDb.collection('branches').insertMany([
    { _id: 'outlet-a', license: 'shop-a', branch_name: 'A', currency: 'USD' },
    { _id: second, license: 'shop-a', branch_name: 'B', currency: 'INR' },
    { _id: 'private', license: 'shop-a', branch_name: 'Private' },
    { _id: 'foreign', license: 'shop-b', branch_name: 'Foreign' },
    { _id: 'empty', license: 'shop-a', branch_name: 'No records', currency: 'USD' },
  ]);
  await mockDb.collection('sales').insertMany([
    { ...saleForInsights(), items_total: 10 },
    { ...saleForInsights(), branch_id: second, items_total: 20 },
    { ...saleForInsights(), branch_id: String(second), items_total: 30, sale_process: 'PartialReturn' },
    ...['foreign', 'private'].map((branch_id) => ({ ...saleForInsights(), branch_id, items_total: 900 })),
    { ...saleForInsights(), license: 'shop-b', items_total: 900 },
    { ...saleForInsights(), sale_process: 'FullReturn', items_total: 900 },
    { ...saleForInsights(), sale_process: 'Open', items_total: 900 },
    { ...saleForInsights(), date: new Date('2026-08-31T23:59:59Z'), items_total: 900 },
  ]);
  const request = req();
  request.body = { branch_ids: ['private', 'foreign'] };
  request.user.branch_access = [{ branch_id: 'private' }];
  const result = await outletInsights.read(request, insightPeriod, 'Asia/Kolkata');
  expect(result.outlets.map((row) => [row.outlet, row.currency, row.amount, row.transactions])).toEqual([
    ['A', 'USD', 10, 1], ['B', 'INR', 50, 2], ['No records', 'USD', 0, 0],
  ]);
  const response = outletInsights.answer(result, 'month');
  expect(response.metrics).toHaveLength(3);
  expect(response.answer).toContain('unsynced');
  expect(outletInsights.canReadSaved(response, await outletInsights.historyAccess(request))).toBe(true);
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $pull: { branch_access: { branch_id: String(second) } } });
  expect(outletInsights.canReadSaved(response, await outletInsights.historyAccess(request))).toBe(false);
  const after = await outletInsights.read(request, insightPeriod, 'Asia/Kolkata');
  expect(after.outlets.map((row) => row.outlet)).toEqual(['A', 'No records']);
});

test('outlet comparison rejects stale financial permissions, session restrictions and inactive accounts', async () => {
  await mockDb.collection('branches').insertOne({ _id: 'outlet-a', license: 'shop-a' });
  await mockDb.collection('users').insertOne({ _id: 'owner-a', license: 'shop-a', role: 'cashier', branch_access: [{ branch_id: 'outlet-a' }] });
  await expect(outletInsights.read(req(), insightPeriod)).rejects.toThrow('financial access');
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $set: { 'access.dashboard.financials': true } });
  expect((await outletInsights.read(req(), insightPeriod)).outlets).toHaveLength(1);
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $set: { 'access.sales.session_filter': true } });
  await expect(outletInsights.read(req(), insightPeriod)).rejects.toThrow('single-session');
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $set: { role: 'admin', isActive: false, 'access.sales.session_filter': false } });
  expect((await outletInsights.historyAccess(req())).size).toBe(0);
});

test('sales drafts derive prices and tax from scoped catalog, reject ambiguity and revalidate before confirmation', async () => {
  const first = new ObjectId(), second = new ObjectId();
  const item = { license: 'shop-a', branch_id: 'outlet-a', name: 'A+B Tea', selling_price: 10, tax: 10, tax_type: 'Exc', item_status: 'active', unit: 'pcs' };
  await mockDb.collection('items').insertMany([
    { ...item, _id: first, sku: 'TEA-1' }, { ...item, _id: second, sku: 'TEA-2' },
    { ...item, name: 'Private', license: 'shop-b' }, { ...item, name: 'Other outlet', branch_id: 'outlet-b' },
    { ...item, name: 'Draft product', item_status: 'draft' },
    ...[1, '1', true].map((del_status) => ({ ...item, name: 'Deleted product', del_status })),
  ]);
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x A+B Tea' })).rejects.toThrow('more than one');
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x .*' })).rejects.toThrow('No sellable item');
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x Private' })).rejects.toThrow('No sellable item');
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x Other outlet' })).rejects.toThrow('No sellable item');
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x Draft product' })).rejects.toThrow('No sellable item');
  await expect(saleDrafts.prepare(insightModel(), { lines_text: '1 x Deleted product' })).rejects.toThrow('No sellable item');
  const prepared = await saleDrafts.prepare(insightModel(), { lines_text: '0.5 x TEA-1\n2 x TEA-1', unit_price: 0, total: 0 });
  expect(prepared.lines).toHaveLength(1);
  expect(prepared.lines[0]).toMatchObject({ item_id: String(first), qty: 2.5, unit_price: 10 });
  expect(prepared).toMatchObject({ total: 27.5, tax_total: 2.5 });
  await saleDrafts.validate(insightModel(), prepared);
  await mockDb.collection('items').updateOne({ _id: first }, { $set: { del_status: '1' } });
  await expect(saleDrafts.validate(insightModel(), prepared)).rejects.toThrow('Catalog details changed');
  await mockDb.collection('items').updateOne({ _id: first }, { $unset: { del_status: '' } });
  await mockDb.collection('items').updateOne({ _id: first }, { $set: { selling_price: 11 } });
  await expect(saleDrafts.validate(insightModel(), prepared)).rejects.toThrow('Catalog details changed');
  expect(() => saleDrafts.parse('0 x Tea')).toThrow('quantity');
  expect(() => saleDrafts.parse(Array(31).fill('1 x Tea').join('\n'))).toThrow('30');
});

test('slow-moving insights include zero-sale stock and exclude other shops, outlets, drafts and dates', async () => {
  const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
  const item = { license: 'shop-a', branch_id: 'outlet-a', item_status: 'active', track_inventory: true, available_quantity: 10, unit: 'pcs' };
  await mockDb.collection('items').insertMany([
    { ...item, _id: ids[0], name: 'Milk' }, { ...item, _id: ids[1], name: 'Tea' }, { ...item, _id: ids[2], name: 'Milk' },
    { ...item, name: 'Foreign shop', license: 'shop-b' }, { ...item, name: 'Foreign outlet', branch_id: 'outlet-b' },
    { ...item, name: 'Not sellable', item_status: 'draft' }, { ...item, name: 'Inactive', item_status: 'inactive' }, { ...item, name: 'Empty stock', available_quantity: 0 },
    { ...item, name: 'Untracked', track_inventory: false },
    ...[1, '1', true].map((del_status) => ({ ...item, name: 'Deleted stock', del_status })),
  ]);
  const line = (id, quantity) => ({ item_id: id, item_quantity: quantity });
  await mockDb.collection('sales').insertMany([
    { ...saleForInsights(), items: [line(ids[0], 2), line(String(ids[0]), 3), line(ids[2], 1)] },
    { ...saleForInsights(), license: 'shop-b', items: [line(ids[1], 500)] },
    { ...saleForInsights(), branch_id: 'outlet-b', items: [line(ids[1], 500)] },
    { ...saleForInsights(), sale_process: 'Open', items: [line(ids[1], 500)] },
    { ...saleForInsights(), sale_process: 'FullReturn', items: [line(ids[1], 500)] },
    { ...saleForInsights(), date: new Date('2026-08-31T23:59:59Z'), items: [line(ids[1], 500)] },
  ]);
  const result = await commerceInsights.read(insightModel(), insightPeriod, 'slow_items');
  expect(result.count).toBe(3);
  expect(result.rows.map((row) => [row.id, row.units])).toEqual([[String(ids[1]), 0], [String(ids[2]), 1], [String(ids[0]), 5]]);
  const unsold = await commerceInsights.read(insightModel(), insightPeriod, 'no_sale_items');
  expect(unsold.count).toBe(1);
  expect(unsold.rows[0]).toMatchObject({ label: 'Tea', stock: 10, units: 0 });
});

test('category performance uses sale snapshots, includes uncategorized lines and reconciles all category totals', async () => {
  const category = new ObjectId();
  const lines = [{ category_id: category, category_name: 'Drinks', item_quantity: 2, total_amount: 20 }, { category_id: String(category), category_name: 'Drinks', item_quantity: 1, total_amount: 10 }, { item_quantity: 1, total_amount: 5 }];
  await mockDb.collection('sales').insertMany([
    { ...saleForInsights(), items: lines },
    { ...saleForInsights(), license: 'shop-b', items: lines },
    { ...saleForInsights(), branch_id: 'outlet-b', items: lines },
    { ...saleForInsights(), sale_process: 'FullReturn', items: lines },
  ]);
  const result = await commerceInsights.read(insightModel(), insightPeriod, 'category_performance');
  expect(result).toMatchObject({ count: 2, total: 35 });
  expect(result.rows).toEqual([{ id: String(category), label: 'Drinks', units: 3, amount: 30 }, { id: 'name:', label: 'Uncategorized', units: 1, amount: 5 }]);
  expect(commerceInsights.answer(result, 'category_performance', 'month').metrics[0].value).toBe('35.00');
});

test('customer segments deduplicate customer IDs without treating anonymous transactions as one customer', async () => {
  const repeat = new ObjectId(), single = new ObjectId();
  const sale = { ...saleForInsights(), items_total: 10 };
  await mockDb.collection('sales').insertMany([
    { ...sale, customer_id: repeat }, { ...sale, customer_id: String(repeat) }, { ...sale, customer_id: single },
    { ...sale }, { ...sale, customer_id: null }, { ...sale, customer_id: '' },
    { ...sale, customer_id: new ObjectId(), customer_name: 'Walk-In-Customer' },
    { ...sale, customer_id: '0' },
    { ...sale, license: 'shop-b', customer_id: single }, { ...sale, branch_id: 'outlet-b', customer_id: single },
    { ...sale, date: new Date('2026-08-15'), customer_id: single },
  ]);
  const result = await commerceInsights.read(insightModel(), insightPeriod, 'customer_segments');
  expect(result.rows).toEqual([
    { segment: 'repeat', customers: 1, transactions: 2, amount: 20 },
    { segment: 'single', customers: 1, transactions: 1, amount: 10 },
    { segment: 'unidentified', customers: 0, transactions: 5, amount: 50 },
  ]);
  expect(JSON.stringify(result)).not.toContain(String(repeat));
  await expect(commerceInsights.read({ ...insightModel(), licenseId: null }, insightPeriod, 'customer_segments')).rejects.toThrow('authenticated shop');
});

test('sales trends use outlet calendar boundaries, recorded totals and strict tenant scope', async () => {
  const model = { branchId: 'outlet-a', licenseId: 'shop-a', timeZone: 'Asia/Kolkata', getCollection: (name) => mockDb.collection(name), getContextMatch: (filter) => ({ ...filter, branch_id: 'outlet-a', license: 'shop-a' }) };
  const sale = { branch_id: 'outlet-a', license: 'shop-a', date: new Date('2026-09-30T18:45:00Z'), sale_process: 'Add', items_total: 12.5 };
  await mockDb.collection('sales').insertMany([
    sale,
    { ...sale, date: new Date('2026-09-30T19:00:00Z'), sale_process: 'PartialReturn', items_total: 20 },
    { ...sale, date: new Date('2026-09-30T20:00:00Z'), items_total: 7.5 },
    { ...sale, branch_id: 'outlet-b', items_total: 1000 },
    { ...sale, license: 'shop-b', items_total: 2000 },
    { ...sale, sale_process: 'FullReturn', items_total: 4000 },
    { ...sale, sale_process: 'Open', items_total: 8000 },
    { ...sale, date: new Date('2026-09-30T18:29:59Z'), items_total: 16000 },
  ]);
  const range = { start_date: new Date('2026-09-30T18:30:00Z'), end_date: new Date('2026-10-01T18:29:59.999Z') };
  const hourly = await trends.read(model, range, 'hour');
  expect(hourly).toEqual([{ label: '00:00', amount: 32.5, transactions: 2 }, { label: '01:00', amount: 7.5, transactions: 1 }]);
  const daily = await trends.read(model, range, 'day');
  expect(daily).toEqual([{ label: '2026-10-01', amount: 40, transactions: 3 }]);
  expect(trends.answer(daily, 'day', 'today', model.timeZone).metrics[0].value).toBe('40.00');
  await expect(trends.read({ ...model, branchId: null }, range, 'hour')).rejects.toThrow('authenticated shop');
  await expect(trends.read(model, range, 'arbitrary')).rejects.toThrow('Unsupported');
});
afterAll(async () => {
  await client?.close(); await server?.stop();
  for (const [key, value] of Object.entries({ POSNIC_MANAGED_AI_MONTHLY_CAP: savedEnv.cap, ASK_POSNIC_ACTION_SECRET: savedEnv.secret, ASK_POSNIC_BILLING_URL: savedEnv.billingUrl, ASK_POSNIC_BILLING_TOKEN: savedEnv.billingToken })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('concurrent allowance requests cannot overspend or create duplicate monthly accounts', async () => {
  const context = { licenseId: 'shop-a' };
  const results = await Promise.all(Array.from({ length: 20 }, () => credits.reserve(context, { feature: 'help', model: 'test', promptChars: 100, maxOutputTokens: 4000 })));
  expect(results.filter((r) => r.ok)).toHaveLength(2);
  expect(await mockDb.collection(credits.COLLECTION).countDocuments({})).toBe(1);
  expect((await credits.status(context)).reserved_minor).toBe(80);
  const held = results.find((r) => r.ok);
  await credits.release({ licenseId: 'shop-b' }, held);
  expect((await credits.status(context)).reserved_minor).toBe(80);
  await Promise.all(Array.from({ length: 5 }, () => credits.reconcile(context, held, { model: 'test', tokensIn: 1, tokensOut: 100 })));
  expect(await credits.status(context)).toMatchObject({ used_minor: 1, reserved_minor: 40 });
});

test('a reservation reconciles the account it was created in across month rollover', async () => {
  const context = { licenseId: 'shop-a' };
  const held = await credits.reserve(context, { maxOutputTokens: 4000 });
  await mockDb.collection(credits.RESERVATIONS).updateOne({ _id: held.id }, { $set: { month: '2026-09' } });
  await mockDb.collection(credits.COLLECTION).updateOne({ license: 'shop-a' }, { $set: { month: '2026-09' } });
  await credits.reconcile(context, { ...held, reservedMinor: 9999 }, { tokensOut: 100 });
  expect(await mockDb.collection(credits.COLLECTION).findOne({ month: '2026-09' })).toMatchObject({ reserved_minor: 0, used_minor: 1 });
});

test('managed semantic retrieval restores page references from the current permitted source', async () => {
  const saved = [process.env.ASK_POSNIC_VECTOR_BUCKET, process.env.ASK_POSNIC_VECTOR_INDEX, process.env.ASK_POSNIC_VECTOR_NAMESPACE];
  process.env.ASK_POSNIC_VECTOR_BUCKET = 'synthetic-bucket'; process.env.ASK_POSNIC_VECTOR_INDEX = 'synthetic-index'; process.env.ASK_POSNIC_VECTOR_NAMESPACE = 'synthetic-installation';
  const data = new Map();
  const vectors = { exists: async keys => keys.map(key => data.get(key)).filter(Boolean), put: async (key, vector, metadata) => data.set(key, { key, metadata, data: { float32: vector }, distance: 0.2 }), remove: async keys => keys.forEach(key => data.delete(key)), query: async () => [...data.values()] };
  const embed = async () => ({ status: true, data: { vector: Array(256).fill(0.0625) } });
  try {
    const mapped = require('../../src/services/knowledge-page-map').fromPages([{ num: 4, text: 'Printer guidance from the approved PDF.' }], 5);
    await platform.saveDocument(req(), { title: 'Printer guide', kind: 'pdf', status: 'published', ...mapped });
    expect((await semantic.indexBatch(mockDb, { store: vectors, embed })).state).toBe('ready');
    const matches = await semantic.retrieve(mockDb, 'shop-a', 'A paraphrase', { licenseId: 'shop-a' }, { store: vectors, embed });
    expect(matches[0].pages).toEqual([4]);
  } finally { ['ASK_POSNIC_VECTOR_BUCKET', 'ASK_POSNIC_VECTOR_INDEX', 'ASK_POSNIC_VECTOR_NAMESPACE'].forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
});

test('semantic indexing checkpoints bounded work and retrieval rechecks tenant, revision and publication', async () => {
  const saved = [process.env.ASK_POSNIC_VECTOR_BUCKET, process.env.ASK_POSNIC_VECTOR_INDEX, process.env.ASK_POSNIC_VECTOR_NAMESPACE];
  process.env.ASK_POSNIC_VECTOR_BUCKET = 'synthetic-bucket'; process.env.ASK_POSNIC_VECTOR_INDEX = 'synthetic-index'; process.env.ASK_POSNIC_VECTOR_NAMESPACE = 'synthetic-installation';
  const data = new Map();
  const vectors = { exists: async (keys) => keys.map((key) => data.get(key)).filter(Boolean), put: async (key, vector, metadata) => data.set(key, { key, metadata, data: { float32: vector }, distance: 0.2 }), remove: async (keys) => keys.forEach((key) => data.delete(key)), query: async () => [...data.values()] };
  const embed = jest.fn(async () => ({ status: true, data: { vector: Array(256).fill(0.0625) } }));
  try {
    const source = { license: 'shop-a', branch_id: 'outlet-a', central_id: 'export-series', title: 'Approved export', revision: '1', content: 'Approved passage.', chunks: Array(10).fill('Approved passage.'), visibility: 'customer', status: 'published' };
    let id = (await mockDb.collection('ask_posnic_documents').insertOne({ ...source })).insertedId;
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'pending', chunks: 8 });
    expect(embed).toHaveBeenCalledTimes(8);
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'ready', chunks: 10 });
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'idle' });
    const matches = await semantic.retrieve(mockDb, 'shop-a', 'A paraphrase', { licenseId: 'shop-a' }, { store: vectors, embed });
    expect(matches).toHaveLength(10);
    expect(matches[0]).toMatchObject({ document_id: String(id), text: 'Approved passage.' });
    const changed = { ...source, revision: '2', chunks: ['Changed first passage', ...source.chunks.slice(1)] };
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { status: 'retired' } });
    id = (await mockDb.collection('ask_posnic_documents').insertOne({ ...changed, semantic_source_hash: semantic.sourceHash(changed) })).insertedId;
    const beforeRevision = embed.mock.calls.length;
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'pending' });
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'ready' });
    expect(embed.mock.calls.length - beforeRevision).toBe(1);
    expect(data.size).toBe(10);
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'retired' });
    expect(await semantic.retrieve(mockDb, 'shop-b', 'A paraphrase', { licenseId: 'shop-b' }, { store: vectors, embed })).toHaveLength(0);
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { visibility: 'internal' } });
    expect(await semantic.retrieve(mockDb, 'shop-a', 'A paraphrase', { licenseId: 'shop-a' }, { store: vectors, embed })).toHaveLength(0);
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { visibility: 'customer', content: 'Changed', chunks: ['Changed'] } });
    expect(await semantic.retrieve(mockDb, 'shop-a', 'A paraphrase', { licenseId: 'shop-a' }, { store: vectors, embed })).toHaveLength(0);
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { status: 'retired' } });
    expect(await semantic.retrieve(mockDb, 'shop-a', 'A paraphrase', { licenseId: 'shop-a' }, { store: vectors, embed })).toHaveLength(0);
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'retired' });
    expect(data.size).toBe(0);
  } finally {
    ['ASK_POSNIC_VECTOR_BUCKET', 'ASK_POSNIC_VECTOR_INDEX', 'ASK_POSNIC_VECTOR_NAMESPACE'].forEach((key, i) => { if (saved[i] == null) delete process.env[key]; else process.env[key] = saved[i]; });
  }
});

test('uncertain indexing pauses without replay and old processing claims are never automatically reclaimed', async () => {
  const names = ['ASK_POSNIC_VECTOR_BUCKET', 'ASK_POSNIC_VECTOR_INDEX', 'ASK_POSNIC_VECTOR_NAMESPACE'];
  const saved = names.map((name) => process.env[name]);
  names.forEach((name) => { process.env[name] = 'synthetic-test'; });
  const vectors = { exists: async () => [], remove: async () => {}, put: async () => {} };
  const embed = jest.fn(async () => ({ status: false, uncertain: true, message: 'No acknowledgement' }));
  try {
    const id = (await mockDb.collection('ask_posnic_documents').insertOne({ license: 'shop-a', branch_id: 'outlet-a', title: 'Approved', content: 'Approved passage', revision: '1', visibility: 'customer', status: 'published' })).insertedId;
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'needs_review' });
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { 'semantic.retry_at': new Date(0) } });
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'idle' });
    await mockDb.collection('ask_posnic_documents').updateOne({ _id: id }, { $set: { 'semantic.state': 'processing', 'semantic.started_at': new Date(0) } });
    expect(await semantic.indexBatch(mockDb, { store: vectors, embed })).toMatchObject({ state: 'idle' });
    expect(embed).toHaveBeenCalledTimes(1);
  } finally { names.forEach((name, i) => { if (saved[i] == null) delete process.env[name]; else process.env[name] = saved[i]; }); }
});

test('changing adjacent evidence while a model runs invalidates an otherwise unchanged cited chunk', async () => {
  const source = await platform.saveDocument(req(), { title: 'Discount permission', content: 'x'.repeat(1170) + 'Discount change | Approval only if the operator lacks direct authority.', status: 'published' });
  const { contextForChunk } = require('../../src/services/ask-posnic-retrieval');
  const match = { document_id: String(source._id), title: source.title, revision: source.revision, chunk: 0, text: source.chunks[0], context: contextForChunk(source, 0) };
  expect(await platform.currentMatches(req(), [match])).toHaveLength(1);
  const changed = source.chunks.slice(); changed[1] += ' Updated approval condition.';
  await mockDb.collection('ask_posnic_documents').updateOne({ _id: source._id }, { $set: { chunks: changed } });
  expect(await platform.currentMatches(req(), [match])).toHaveLength(0);
});

test('knowledge excludes other shops, internal drafts and retired sources; citations resolve only while published', async () => {
  const doc = { title: 'Export catalog', content: 'Export catalog using Items > Export.', kind: 'faq', status: 'published' };
  const published = await platform.saveDocument(req(), doc);
  await platform.saveDocument(req('shop-b'), doc);
  await platform.saveDocument(req(), { ...doc, status: 'draft' });
  await platform.saveDocument(req(), { ...doc, visibility: 'internal' });
  expect(await platform.retrieve(req(), 'Export catalog')).toHaveLength(1);
  expect(await platform.getDocument(req('shop-b'), published._id)).toBeNull();
  expect(await platform.getDocument(req(), published._id)).toMatchObject({ content: doc.content });
  expect(await platform.retrieve(req(), 'Where can I find my zebras?')).toHaveLength(0);
  await platform.setDocumentStatus(req(), published._id, 'retired');
  expect(await platform.getDocument(req(), published._id)).toBeNull();
  expect(await platform.retrieve(req(), 'Export catalog')).toHaveLength(0);
});

test('Tamil exact FAQ retains its identity and full approved answer', async () => {
  const doc = await platform.saveDocument(req(), { title: 'பட்டியல் ஏற்றுமதி', content: 'விளக்கம் '.repeat(400), kind: 'faq', status: 'published' });
  const matches = await platform.retrieve(req(), 'பட்டியல் ஏற்றுமதி?');
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ exact: true, text: doc.content });
});

test('authoritative imports retire removed central sources and preserve shop documents', async () => {
  const snapshot = { schema: 'posnic.ask-knowledge.v1', source: 'posnic-intranet', snapshot: true, documents: [{ seriesId: 'central-a', version: 1, title: 'Export catalog', content: 'Export CSV.', kind: 'faq', status: 'published', visibility: 'customer' }] };
  await platform.importBundle(req(), snapshot);
  await platform.importBundle(req(), snapshot);
  expect(await mockDb.collection('ask_posnic_documents').countDocuments()).toBe(1);
  await platform.saveDocument(req(), { title: 'Shop guide', content: 'Local approved content.', status: 'published' });
  await platform.importBundle(req(), { ...snapshot, documents: [] });
  expect((await platform.listDocuments(req())).map((row) => row.title)).toEqual(['Shop guide']);
  await expect(platform.importBundle(req(), { ...snapshot, documents: [{ title: 'Incomplete' }] })).rejects.toThrow('incomplete');
});

test('history is user and outlet scoped, including deletion', async () => {
  const id = await platform.saveMessage(req(), null, 'user', { question: 'sales' });
  expect(await platform.history(req())).toHaveLength(1);
  expect(await platform.history(req('shop-a', 'outlet-b'))).toHaveLength(0);
  expect(await platform.history(req('shop-a', 'outlet-a', 'other-user'))).toHaveLength(0);
  await platform.deleteHistory(req('shop-a', 'outlet-b'));
  expect((await platform.history(req()))[0]._id.toString()).toBe(id);
});

test('altered, cross-shop, cross-outlet and cross-user confirmations never execute', async () => {
  const draft = await platform.createDraft(req(), 'stock_count', { items: [] });
  const execute = jest.fn(async () => ({ id: 'worksheet' }));
  const [body, signature] = draft.token.split('.');
  const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), type: 'campaign' })).toString('base64url');
  await expect(platform.confirmDraft(req(), `${altered}.${signature}`, execute)).rejects.toThrow('Invalid');
  for (const other of [req('shop-b'), req('shop-a', 'outlet-b'), req('shop-a', 'outlet-a', 'other')]) {
    await expect(platform.confirmDraft(other, draft.token, execute)).rejects.toThrow('different');
  }
  expect(execute).not.toHaveBeenCalled();
  const outcomes = await Promise.allSettled([platform.confirmDraft(req(), draft.token, execute), platform.confirmDraft(req(), draft.token, execute)]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(platform.confirmDraft(req(), draft.token, execute)).rejects.toThrow('already used');
});

test('expired confirmation cannot execute', async () => {
  const draft = await platform.createDraft(req(), 'stock_count', { items: [] });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
  const execute = jest.fn();
  try { await expect(platform.confirmDraft(req(), draft.token, execute)).rejects.toThrow('expired'); }
  finally { clock.mockRestore(); }
  expect(execute).not.toHaveBeenCalled();
});

test('two concurrent schedule workers deliver a due report exactly once', async () => {
  const context = { licenseId: 'shop-a', branchId: 'outlet-a', userId: 'owner-a' };
  const schedule = await schedules.save(context, { frequency: 'daily', report: 'sales', destination: 'owner@example.test', hour: 0, weekday: 0 });
  expect(schedule).toMatchObject({ hour: 0, weekday: 0 });
  await mockDb.collection(schedules.COLLECTION).updateOne({ _id: schedule._id }, { $set: { next_run_at: new Date(0) } });
  const deliver = jest.fn(async () => ({ status: 'sent', provider: 'smtp', reference: 'synthetic-message-id' }));
  await Promise.all([schedules.runDue(context, async () => 'report', deliver), schedules.runDue(context, async () => 'report', deliver)]);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(await mockDb.collection(schedules.COLLECTION).findOne({ _id: schedule._id })).toMatchObject({ last_status: 'sent' });
});

test('ambiguous delivery is paused and never resent automatically', async () => {
  const context = { licenseId: 'shop-a', branchId: 'outlet-a', userId: 'owner-a' };
  const row = await schedules.save(context, { frequency: 'daily', report: 'sales', destination: 'owner@example.test' });
  await mockDb.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  const deliver = jest.fn(async () => { throw new Error('Provider timeout after accepting'); });
  expect(await schedules.runDue(context, async () => 'report', deliver)).toEqual([{ id: String(row._id), status: 'needs_review' }]);
  await schedules.runDue(context, async () => 'report', deliver, new Date(Date.now() + 3600000));
  expect(deliver).toHaveBeenCalledTimes(1);
});

test('background runner revalidates persisted owner and outlet access', async () => {
  const runner = require('../../src/services/ask-posnic-runner.service');
  const context = { licenseId: 'shop-a', branchId: 'outlet-a', userId: 'owner-a' };
  await mockDb.collection('users').insertOne({ _id: 'owner-a', license: 'shop-a', role: 'admin', branch_access: [{ branch_id: 'outlet-a' }] });
  await mockDb.collection('branches').insertOne({ _id: 'outlet-a', license: 'shop-a', branch_name: 'Test shop' });
  const row = await schedules.save(context, { frequency: 'daily', report: 'sales', destination: 'owner@example.test' });
  const col = mockDb.collection(schedules.COLLECTION);
  await col.updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  const send = jest.fn(async () => ({ status: 'sent', provider: 'smtp', reference: 'synthetic-message-id' }));
  const build = jest.fn(async (schedule, at, db) => { await runner.authorize(db, schedule); return {}; });
  await runner.sweep({ db: mockDb, build, send });
  expect(send).toHaveBeenCalledTimes(1);
  await col.updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $set: { role: 'cashier' } });
  await runner.sweep({ db: mockDb, build, send });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await col.findOne({ _id: row._id })).last_status).toBe('failed');
});

test('account settlement survives audit-write failure and recovers without double charge', async () => {
  const context = { licenseId: 'shop-a' };
  const held = await credits.reserve(context, { maxOutputTokens: 4000 });
  const { Collection } = require('mongodb');
  const update = Collection.prototype.updateOne;
  const failure = jest.spyOn(Collection.prototype, 'updateOne').mockImplementation(function (...args) {
    if (this.collectionName === credits.RESERVATIONS) throw new Error('Simulated audit write outage');
    return update.apply(this, args);
  });
  try {
    await credits.reconcile(context, held, { tokensIn: 1, tokensOut: 100 });
    await credits.reconcile(context, held, { tokensIn: 1, tokensOut: 100 });
    const account = await mockDb.collection(credits.COLLECTION).findOne({ license: 'shop-a' });
    expect(account).toMatchObject({ reserved_minor: 0, used_minor: 1 });
    expect(account.holds[held.id].status).toBe('reconciled');
  } finally { failure.mockRestore(); }
  await credits.recover(context);
  await credits.reconcile(context, held, { tokensIn: 1, tokensOut: 100 });
  const account = await mockDb.collection(credits.COLLECTION).findOne({ license: 'shop-a' });
  expect(account.holds[held.id]).toBeUndefined();
  expect(account).toMatchObject({ reserved_minor: 0, used_minor: 1 });
  expect(await mockDb.collection(credits.RESERVATIONS).findOne({ _id: held.id })).toMatchObject({ status: 'reconciled', actual_microminor: 1000000 });
});

async function queuedSummary() {
  const outbox = require('../../src/services/whatsapp-outbox');
  const context = { licenseId: 'shop-a', branchId: 'outlet-a', userId: 'owner-a' };
  await mockDb.collection('users').insertOne({ _id: 'owner-a', license: 'shop-a', role: 'admin', branch_access: [{ branch_id: 'outlet-a' }] });
  await mockDb.collection('branches').insertOne({ _id: 'outlet-a', license: 'shop-a' });
  const row = await schedules.save(context, { frequency: 'daily', report: 'sales', channel: 'whatsapp', destination: '+919999999999' });
  await mockDb.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  let queued, scope;
  const sent = await schedules.runDue(context, async () => 'synthetic report', async claim => {
    scope = { id: String(claim._id), license: claim.license, branch_id: claim.branch_id, user_id: claim.user_id, claim: claim.running_claim };
    queued = await outbox.enqueue(mockDb, context.licenseId, { branch_id: claim.branch_id, phone: claim.destination, message: 'synthetic report', scheduled: scope });
    return { status: 'queued', provider: 'whatsapp_connector', reference: String(queued.id) };
  });
  expect(sent).toEqual([{ id: String(row._id), status: 'queued' }]);
  return { context, row, queued, scope, outbox };
}

test('queued summaries wait for connector acknowledgement and retain a durable receipt', async () => {
  const { context, row, queued, outbox } = await queuedSummary();
  const col = mockDb.collection(schedules.COLLECTION);
  expect((await col.findOne({ _id: row._id })).last_delivery).toMatchObject({ status: 'queued', reference: String(queued.id), provider: 'whatsapp_connector' });
  await expect(schedules.save(context, { ...row, id: String(row._id) })).rejects.toThrow(/operator review/);
  expect(await schedules.remove(context, String(row._id))).toBe(false);
  await col.updateOne({ _id: row._id }, { $set: { next_run_at: new Date(0) } });
  const another = jest.fn();
  await schedules.runDue(context, another, another);
  expect(another).not.toHaveBeenCalled();
  expect(await outbox.claim(mockDb, 'other-shop')).toHaveLength(0);
  const claimed = await outbox.claim(mockDb, 'shop-a');
  expect(claimed).toHaveLength(1);
  expect(await outbox.claim(mockDb, 'shop-a')).toHaveLength(0);
  expect((await outbox.report(mockDb, 'other-shop', String(queued.id), { ok: true })).ok).toBe(false);
  expect((await outbox.report(mockDb, 'shop-a', String(queued.id), { ok: true })).status).toBe('sent');
  await schedules.reconcileQueued(mockDb, { context });
  expect((await col.findOne({ _id: row._id })).last_status).toBe('sent');
});

test('scheduled queue identity is idempotent and cannot change content', async () => {
  const { context, row, queued, scope, outbox } = await queuedSummary();
  const payload = { branch_id: context.branchId, phone: row.destination, message: 'synthetic report', scheduled: scope };
  expect(String((await outbox.enqueue(mockDb, context.licenseId, payload)).id)).toBe(String(queued.id));
  expect(await mockDb.collection(outbox.OUTBOX).countDocuments()).toBe(1);
  await expect(outbox.enqueue(mockDb, context.licenseId, { ...payload, message: 'changed' })).rejects.toThrow(/content changed/);
});

test('a revoked owner cannot leak a previously queued financial report to a connector', async () => {
  const { context, row, outbox } = await queuedSummary();
  await mockDb.collection('users').updateOne({ _id: 'owner-a' }, { $set: { role: 'cashier' } });
  expect(await outbox.claim(mockDb, 'shop-a')).toHaveLength(0);
  await schedules.reconcileQueued(mockDb, { context });
  expect(await mockDb.collection(schedules.COLLECTION).findOne({ _id: row._id })).toMatchObject({ enabled: false, last_status: 'needs_review' });
});

test('interrupted connector claims never automatically resend financial summaries', async () => {
  const { context, row, queued, outbox } = await queuedSummary();
  const at = new Date();
  expect(await outbox.claim(mockDb, 'shop-a', { now: at })).toHaveLength(1);
  expect(await outbox.claim(mockDb, 'shop-a', { now: new Date(at.getTime() + outbox.CLAIM_TTL_MS + 1) })).toHaveLength(0);
  expect((await outbox.report(mockDb, 'shop-a', String(queued.id), { ok: true })).ok).toBe(false);
  await schedules.reconcileQueued(mockDb, { context });
  expect(await mockDb.collection(schedules.COLLECTION).findOne({ _id: row._id })).toMatchObject({ enabled: false, last_status: 'needs_review' });
});

test('the runner pauses expired or missing queue records and never recreates them', async () => {
  const { context, row, queued, outbox } = await queuedSummary();
  await mockDb.collection(outbox.OUTBOX).updateOne({ _id: queued.id }, { $set: { created_date: new Date(0) } });
  await schedules.reconcileQueued(mockDb, { context });
  expect((await mockDb.collection(outbox.OUTBOX).findOne({ _id: queued.id })).status).toBe('needs_review');
  expect((await mockDb.collection(schedules.COLLECTION).findOne({ _id: row._id })).enabled).toBe(false);
  expect(await outbox.claim(mockDb, 'shop-a')).toHaveLength(0);
  await mockDb.collection(outbox.OUTBOX).deleteOne({ _id: queued.id });
  await mockDb.collection(schedules.COLLECTION).updateOne({ _id: row._id }, { $set: { last_status: 'queued', enabled: true } });
  await schedules.reconcileQueued(mockDb, { context });
  expect((await mockDb.collection(schedules.COLLECTION).findOne({ _id: row._id })).last_status).toBe('needs_review');
  expect(await mockDb.collection(outbox.OUTBOX).countDocuments()).toBe(0);
});

test('a failed reservation audit insert refunds the hold before any provider call', async () => {
  const context = { licenseId: 'shop-a' };
  const { Collection } = require('mongodb');
  const insert = Collection.prototype.insertOne;
  const failure = jest.spyOn(Collection.prototype, 'insertOne').mockImplementation(function (...args) {
    if (this.collectionName === credits.RESERVATIONS) throw new Error('Simulated audit insert outage');
    return insert.apply(this, args);
  });
  try { await expect(credits.reserve(context, { maxOutputTokens: 4000 })).rejects.toThrow('audit insert outage'); }
  finally { failure.mockRestore(); }
  expect(await credits.status(context)).toMatchObject({ reserved_minor: 0, used_minor: 0 });
});

test('uncertain calls retain their full reservation until actual usage is known', async () => {
  const context = { licenseId: 'shop-a' };
  const held = await credits.reserve(context, { maxOutputTokens: 4000 });
  await credits.markUncertain(context, held);
  await credits.release(context, held);
  expect(await credits.status(context)).toMatchObject({ reserved_minor: 40, used_minor: 0, pending_reviews: 1 });
  await credits.reconcile(context, held, { tokensIn: 1, tokensOut: 100 });
  expect(await credits.status(context)).toMatchObject({ reserved_minor: 0, used_minor: 1, pending_reviews: 0 });
});

test('paid allowances preserve spend across top-ups, enforce refunds and isolate new billing periods', async () => {
  const entitlements = require('../../src/services/managed-ai-entitlement.service');
  process.env.ASK_POSNIC_BILLING_URL = 'https://billing.example.test/api/managed-ai/entitlement';
  process.env.ASK_POSNIC_BILLING_TOKEN = 'fixture-only';
  const context = { licenseId: 'shop-a' };
  let grant = { active: true, allowance_minor: 100, currency: 'USD', period_id: 'a'.repeat(64), valid_until: new Date(Date.now() + 86400000).toISOString() };
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    expect(JSON.parse(init.body)).toEqual({ tenantDb: mockDb.databaseName });
    return new Response(JSON.stringify(grant));
  };
  const refresh = () => entitlements.get({ force: true });
  try {
    await refresh();
    const held = await credits.reserve(context, { maxOutputTokens: 4000 });
    await credits.reconcile(context, held, { tokensOut: 500 });
    expect(await credits.status(context)).toMatchObject({ used_minor: 5, remaining_minor: 95, funding: 'paid' });
    grant.allowance_minor = 150; await refresh();
    expect(await credits.status(context)).toMatchObject({ used_minor: 5, remaining_minor: 145 });
    grant.allowance_minor = 3; await refresh();
    expect((await credits.reserve(context, { maxOutputTokens: 100 })).ok).toBe(false);
    expect(await credits.status(context)).toMatchObject({ used_minor: 5, remaining_minor: 0 });
    grant = { ...grant, allowance_minor: 100, period_id: 'b'.repeat(64) }; await refresh();
    expect(await credits.status(context)).toMatchObject({ used_minor: 0, remaining_minor: 100 });
    await credits.reconcile(context, held, { tokensOut: 500 });
    expect(await credits.status(context)).toMatchObject({ used_minor: 0, remaining_minor: 100 });
    global.fetch = async () => new Response('{}', { status: 503 });
    await expect(refresh()).rejects.toThrow('unavailable');
    await expect(credits.reserve(context, { maxOutputTokens: 100 })).rejects.toThrow('unavailable');
  } finally { global.fetch = originalFetch; }
});

test('a lost insert acknowledgement never duplicates a confirmed action record', async () => {
  const { ObjectId, Collection } = require('mongodb');
  const identity = require('../../src/services/ask-posnic-action-identity');
  const context = { askPosnicAction: { id: String(new ObjectId()), step: 0 } };
  const collection = mockDb.collection('purchase_orders');
  const doc = { license: new ObjectId(), branch_id: new ObjectId(), po_id: 'PO-000001', status: 'draft' };
  const insert = Collection.prototype.insertOne;
  const failure = jest.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (...args) {
    const result = await insert.apply(this, args);
    if (this.collectionName === 'purchase_orders') throw new Error('Lost insert acknowledgement');
    return result;
  });
  let first;
  try { first = await identity.insertOnce(collection, { ...doc }, context); }
  finally { failure.mockRestore(); }
  const second = await identity.insertOnce(collection, { ...doc, po_id: 'PO-000002' }, context);
  expect(String(first.insertedId)).toBe(String(second.insertedId));
  expect(second.document.po_id).toBe('PO-000001');
  expect(await collection.countDocuments()).toBe(1);
});

test('interrupted action batches report persisted drafts and remain isolated and non-replayable', async () => {
  const { ObjectId } = require('mongodb');
  const identity = require('../../src/services/ask-posnic-action-identity');
  const license = new ObjectId(), branch = new ObjectId(), user = new ObjectId();
  const request = req(String(license), String(branch), String(user));
  const draft = await platform.createDraft(request, 'purchase_order', { orders: [{ supplier_name: 'A' }, { supplier_name: 'B' }] });
  await expect(platform.confirmDraft(request, draft.token, async (_type, _payload, row) => {
    await identity.insertOnce(mockDb.collection('purchase_orders'), { license, branch_id: branch, po_id: 'PO-000001', status: 'draft' }, { askPosnicAction: { id: String(row._id), step: 0 } });
    throw new Error('Interrupted before second supplier');
  })).rejects.toThrow('Interrupted');
  const result = await platform.actionOutcome(request, draft.id);
  expect(result).toMatchObject({ status: 'partial', expected: 2, remaining: 1 });
  expect(result.saved).toHaveLength(1);
  expect(await platform.actionOutcome(req(String(license), String(branch), String(new ObjectId())), draft.id)).toBeNull();
  await expect(platform.confirmDraft(request, draft.token, async () => {})).rejects.toThrow('already used');
  expect(result.resumable).toBe(true);
  await expect(platform.resumeDraft(req(String(license), String(branch), String(new ObjectId())), draft.id, async () => {})).rejects.toThrow('not available');
  const reviews = await Promise.allSettled([1, 2].map(() => platform.resumeDraft(request, draft.id, async (payload) => { expect(payload.orders).toEqual([{ supplier_name: 'B' }]); })));
  expect(reviews.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const recovery = reviews.find((row) => row.status === 'fulfilled').value;
  expect(recovery.recovery).toMatchObject({ remaining: 1 });
  expect(await mockDb.collection('purchase_orders').countDocuments()).toBe(1);
  let calls = 0;
  const execute = async (_type, payload, row) => {
    calls++;
    expect(payload.orders).toEqual([{ supplier_name: 'B' }]);
    expect(row.resume_steps).toEqual([1]);
    await identity.insertOnce(mockDb.collection('purchase_orders'), { license, branch_id: branch, po_id: 'PO-000002', status: 'draft' }, { askPosnicAction: { id: String(row._id), step: row.resume_steps[0] } });
    return {};
  };
  const confirmations = await Promise.allSettled([1, 2].map(() => platform.confirmDraft(request, recovery.token, execute)));
  expect(confirmations.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(calls).toBe(1);
  expect(await platform.actionOutcome(request, draft.id)).toMatchObject({ status: 'completed', remaining: 0, resumable: false });
  expect(await mockDb.collection('purchase_orders').countDocuments()).toBe(2);
});

test('recovery refuses live workers, failed inventory validation and changed saved records', async () => {
  const identity = require('../../src/services/ask-posnic-action-identity');
  const license = new ObjectId(), branch = new ObjectId(), user = new ObjectId();
  const request = req(String(license), String(branch), String(user));
  const draft = await platform.createDraft(request, 'purchase_order', { orders: [{ supplier_name: 'A' }, { supplier_name: 'B' }] });
  await mockDb.collection('ask_posnic_action_drafts').updateOne({ _id: new ObjectId(draft.id) }, { $set: { status: 'executing', confirmed_at: new Date(0) } });
  await identity.insertOnce(mockDb.collection('purchase_orders'), { license, branch_id: branch, po_id: 'PO-000001' }, { askPosnicAction: { id: draft.id, step: 0 } });
  expect((await platform.actionOutcome(request, draft.id)).resumable).toBe(false);
  await expect(platform.resumeDraft(request, draft.id, async () => {})).rejects.toThrow('not available');
  await mockDb.collection('ask_posnic_action_drafts').updateOne({ _id: new ObjectId(draft.id) }, { $set: { status: 'needs_review' } });
  await expect(platform.resumeDraft(request, draft.id, async () => { throw new Error('Inventory changed'); })).rejects.toThrow('Inventory changed');
  expect((await mockDb.collection('ask_posnic_action_drafts').findOne({ _id: new ObjectId(draft.id) })).status).toBe('needs_review');
  const recovery = await platform.resumeDraft(request, draft.id, async () => {});
  await mockDb.collection('purchase_orders').deleteOne({ ask_posnic_action_id: draft.id });
  const execute = jest.fn();
  await expect(platform.confirmDraft(request, recovery.token, execute)).rejects.toThrow('Saved orders changed');
  expect(execute).not.toHaveBeenCalled();
});

test('stored business records recover a failed action settlement without replaying execution', async () => {
  const { ObjectId, Collection } = require('mongodb');
  const identity = require('../../src/services/ask-posnic-action-identity');
  const license = new ObjectId(), branch = new ObjectId(), user = new ObjectId();
  const request = req(String(license), String(branch), String(user));
  const draft = await platform.createDraft(request, 'stock_count', { items: [] });
  const update = Collection.prototype.updateOne;
  const failure = jest.spyOn(Collection.prototype, 'updateOne').mockImplementation(function (...args) {
    if (this.collectionName === 'ask_posnic_action_drafts' && args[1].$set?.status === 'completed') throw new Error('Lost settlement write');
    return update.apply(this, args);
  });
  try {
    await expect(platform.confirmDraft(request, draft.token, async (_type, _payload, row) => {
      const saved = await identity.insertOnce(mockDb.collection('inventory_counts'), { license, branch_id: branch, status: 'draft', items: [] }, { askPosnicAction: { id: String(row._id), step: 0 } });
      return { stock_count: { id: String(saved.insertedId) } };
    })).rejects.toThrow('Lost settlement');
  } finally { failure.mockRestore(); }
  expect(await platform.actionOutcome(request, draft.id)).toMatchObject({ status: 'completed', remaining: 0 });
  await platform.actionOutcome(request, draft.id);
  expect(await mockDb.collection('ask_posnic_audit').countDocuments({ event: 'action_confirmed', 'detail.draft_id': draft.id })).toBe(1);
  expect(await mockDb.collection('inventory_counts').countDocuments()).toBe(1);
  expect((await mockDb.collection('ask_posnic_action_drafts').findOne({ _id: new ObjectId(draft.id) })).status).toBe('completed');
});
