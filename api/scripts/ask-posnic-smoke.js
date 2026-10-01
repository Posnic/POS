'use strict';

// Isolated, authenticated application test. --live adds one paid Bedrock call
// using the caller's AWS profile. No production database or messaging is used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');

async function main() {
  const live = process.argv.includes('--live');
  const semantic = process.argv.includes('--semantic');
  if (semantic && !live) throw new Error('--semantic requires --live and an explicitly configured synthetic vector namespace.');
  const memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('ask_posnic_smoke');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.ASK_POSNIC_ACTION_SECRET = process.env.SESSION_SECRET;
  process.env.POSNIC_MANAGED_AI_PROVIDER = live ? 'bedrock' : 'off';
  process.env.POSNIC_MANAGED_AI_MODEL = 'global.amazon.nova-2-lite-v1:0';
  process.env.POSNIC_MANAGED_AI_KEY = '';
  process.env.POSNIC_MANAGED_AI_MONTHLY_CAP = '100';
  process.env.ASK_POSNIC_KNOWLEDGE_URL = '';
  process.env.ASK_POSNIC_BILLING_URL = '';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
  const mongoose = require('mongoose');
  let server;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const BaseModel = require('../src/models/base.model');
    BaseModel.mongoClient = mongoose.connection.getClient();
    BaseModel.database = db;
    const license = new ObjectId(), branch = new ObjectId(), owner = new ObjectId(), cashier = new ObjectId();
    await db.collection('branches').insertOne({ _id: branch, license, branch_name: 'Isolated smoke shop', currency: 'USD', ai_enabled: true });
    await db.collection('users').insertMany([
      { _id: owner, license, username: 'smoke-owner', role: 'admin', isActive: true, status: 'active', branch_access: [{ branch_id: branch }] },
      { _id: cashier, license, username: 'smoke-cashier', role: 'cashier', isActive: true, status: 'active', branch_access: [{ branch_id: branch }] },
    ]);
    await db.collection('items').insertOne({ _id: new ObjectId(), license, branch_id: branch, name: 'Smoke test item', available_quantity: 3, track_inventory: true, selling_price: 10, tax: 10, tax_type: 'Exc', item_status: 'active', unit: 'pcs' });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/ask-posnic', require('../src/routes/ask-posnic.routes'));
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ type: 'error', message: error.message }));
    server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const jwt = require('jsonwebtoken');
    const tokens = Object.fromEntries([owner, cashier].map((id) => [String(id), jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: '5m' })]));
    const request = async (path, body, user = owner, method = body ? 'POST' : 'GET') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ask-posnic${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${tokens[String(user)]}`, 'x-branch-id': String(branch) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request('/status', null, null)).status, 401);
    const status = await request('/status');
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.data.mode, live ? 'managed' : 'direct');
    assert.equal(JSON.stringify(status.body).includes(process.env.JWT_SECRET), false);
    assert.equal((await request('/recovery', null, cashier)).status, 403);
    const recoveryExample = await db.collection('ask_posnic_action_drafts').insertOne({ license: String(license), branch_id: String(branch), user_id: String(cashier), type: 'campaign', status: 'needs_review', payload: { message: 'PRIVATE-RECOVERY-PAYLOAD' }, execution_owner: { host: 'PRIVATE-RECOVERY-HOST', pid: 1, instance: 'PRIVATE-RECOVERY-CLAIM' } });
    const attention = await request('/recovery');
    assert.equal(attention.status, 200);
    assert.equal(attention.body.data.rows[0].can_review, false);
    assert.ok(!JSON.stringify(attention.body).includes('PRIVATE-RECOVERY'));
    await db.collection('ask_posnic_action_drafts').deleteOne({ _id: recoveryExample.insertedId });
    const recoveryOwner = new ObjectId();
    await db.collection('users').insertOne({ _id: recoveryOwner, license, username: 'recovery-owner', role: 'admin', isActive: true, status: 'active', branch_access: [{ branch_id: branch }] });
    tokens[String(recoveryOwner)] = jwt.sign({ id: String(recoveryOwner) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const scheduled = await request('/schedules', { report: 'sales', frequency: 'daily', destination: 'nobody@example.invalid', timezone: 'UTC' }, recoveryOwner);
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
    const scheduleId = scheduled.body.data._id;
    await db.collection('ask_posnic_schedules').updateOne({ _id: new ObjectId(scheduleId) }, { $set: { enabled: false, last_status: 'needs_review', execution_owner: { host: 'PRIVATE-RECOVERY-HOST' } } });
    assert.equal((await request('/schedules/' + scheduleId + '/resume', {}, recoveryOwner)).status, 400);
    assert.equal((await request('/schedules/' + scheduleId + '/resume', {}, cashier)).status, 403);
    await require('../src/services/ask-posnic-recovery.service').recoverSchedule(db, { licenseId: String(license), branchId: String(branch) }, scheduleId, { outcome: 'not_accepted', provider_reference: 'synthetic-no-delivery', verified_at: new Date().toISOString() }, { apply: true, operator: 'Smoke test maintainer' });
    const resumedSchedule = await request('/schedules/' + scheduleId + '/resume', {}, recoveryOwner);
    assert.equal(resumedSchedule.status, 200, JSON.stringify(resumedSchedule.body));
    assert.ok(!JSON.stringify(resumedSchedule.body).includes('PRIVATE-RECOVERY-HOST'));
    assert.ok(new Date(resumedSchedule.body.data.next_run_at) > new Date());
    assert.ok(!JSON.stringify((await request('/schedules', null, recoveryOwner)).body).includes('PRIVATE-RECOVERY-HOST'));
    assert.equal((await request('/schedules/' + scheduleId, null, recoveryOwner, 'DELETE')).status, 200);
    await db.collection('sales').insertOne({ license, branch_id: branch, date: new Date(), updated_date: new Date(), sale_process: 'Add', items_total: 42.5 });
    const hourly = await request('/ask', { question: 'Show hourly sales today' });
    assert.equal(hourly.status, 200, JSON.stringify(hourly.body));
    assert.equal(hourly.body.data.mode, 'direct');
    assert.equal(hourly.body.data.metrics[0].value, '42.50');
    assert.equal((await request('/ask', { question: 'Show daily sales this month' }, cashier)).status, 403);
    const secondOutlet = new ObjectId(), deniedOutlet = new ObjectId();
    await db.collection('branches').insertMany([
      { _id: secondOutlet, license, branch_name: 'Second smoke outlet', currency: 'INR' },
      { _id: deniedOutlet, license, branch_name: 'Unassigned smoke outlet', currency: 'USD' },
    ]);
    await db.collection('users').updateOne({ _id: owner }, { $push: { branch_access: { branch_id: secondOutlet } } });
    await db.collection('sales').insertMany([
      { license, branch_id: secondOutlet, date: new Date(), sale_process: 'Add', items_total: 81.75 },
      { license, branch_id: deniedOutlet, date: new Date(), sale_process: 'Add', items_total: 987654 },
    ]);
    const outletReport = await request('/ask', { question: 'Compare sales by outlet this month', branch_ids: [String(deniedOutlet)] });
    assert.equal(outletReport.status, 200, JSON.stringify(outletReport.body));
    assert.equal(outletReport.body.data.intent, 'outlet_comparison');
    assert.equal(outletReport.body.data.scope.outlets.length, 2);
    assert.equal(outletReport.body.data.metrics[1].value, '81.75 · 1 transaction');
    assert.equal(JSON.stringify(outletReport.body).includes('987654'), false);
    assert.equal((await request('/ask', { question: 'Compare sales by outlet this month' }, cashier)).status, 403);
    await db.collection('users').updateOne({ _id: owner }, { $pull: { branch_access: { branch_id: secondOutlet } } });
    const outletHistory = await request('/history');
    assert.equal(outletHistory.status, 200);
    assert.equal(JSON.stringify(outletHistory.body).includes('81.75'), false);
    assert.equal(JSON.stringify(outletHistory.body).includes('Second smoke outlet'), false);
    for (const [question, intent] of [
      ['Show slow-moving products this month', 'slow_items'],
      ['Which products have not sold this month?', 'no_sale_items'],
      ['Show category performance this month', 'category_performance'],
      ['Show customer segments this month', 'customer_segments'],
      ['Show coupon promotion performance this month', 'promotion_performance'],
    ]) {
      const report = await request('/ask', { question });
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.data.intent, intent);
      assert.equal(report.body.data.mode, 'direct');
      assert.equal((await request('/ask', { question }, cashier)).status, 403);
    }
    const source = await request('/documents', { title: 'Archival export format', content: 'Archival export uses CSV files. The export contains catalog entries.', kind: 'faq', status: 'published' });
    assert.equal(source.status, 201, JSON.stringify(source.body));
    if (semantic) {
      const published = { seriesId: 'synthetic-export', version: 1, title: 'Download the product catalog', content: 'To export the item catalog, open Items, choose Export, and download the CSV file.', kind: 'markdown', status: 'published', visibility: 'customer' };
      const bundle = { schema: 'posnic.ask-knowledge.v1', documents: [published] };
      assert.equal((await request('/documents/import-bundle', bundle)).status, 200);
      const semanticSource = await db.collection('ask_posnic_documents').findOne({ central_id: published.seriesId, license: String(license) });
      for (let n = 0; n < 2; n++) {
        const indexed = await require('../src/services/ask-posnic-semantic.service').indexBatch(db, { onError: (error) => console.error('Synthetic indexing diagnostic:', error) });
        assert.equal(indexed.state, 'ready', JSON.stringify(indexed));
      }
      const para = await request('/ask', { question: 'How can I get a spreadsheet containing my product list?' });
      assert.equal(para.status, 200, JSON.stringify(para.body));
      assert.equal(para.body.data.mode, 'rag', JSON.stringify(para.body));
      assert.match(para.body.data.answer, /CSV/i);
      assert.equal(para.body.data.citations[0].document_id, String(semanticSource._id));
      const embeddingFilter = { feature: 'ask_posnic_document_embedding', status: 'reconciled' };
      const embeddingsBefore = await db.collection('managed_ai_reservations').countDocuments(embeddingFilter);
      assert.equal((await request('/documents/import-bundle', { ...bundle, documents: [{ ...published, version: 2 }] })).status, 200);
      assert.equal((await require('../src/services/ask-posnic-semantic.service').indexBatch(db)).state, 'ready');
      assert.equal(await db.collection('managed_ai_reservations').countDocuments(embeddingFilter), embeddingsBefore, 'Unchanged revision content must reuse its stored embedding');
    }
    const exact = await request('/ask', { question: 'Archival export format' });
    assert.equal(exact.body.data.mode, 'exact_faq', JSON.stringify(exact.body));
    const answer = await request('/ask', { question: 'Which archival export format is supported?' });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.data.mode, live ? 'rag' : 'retrieval', JSON.stringify(answer.body));
    assert.match(answer.body.data.answer, /CSV/i);
    assert.equal(answer.body.data.citations.length, 1);
    const workflowSource = await request('/documents', { title: 'How do I create a purchase order?', content: 'Open Purchase Orders and choose New. Review supplier and quantities before saving.', kind: 'faq', status: 'published' });
    assert.equal(workflowSource.status, 201);
    const workflow = await request('/ask', { question: 'How do I create a purchase order?' });
    assert.equal(workflow.body.data.mode, 'exact_faq');
    assert.equal(workflow.body.data.action, undefined);
    assert.equal(workflow.body.data.citations[0].document_id, workflowSource.body.data._id);
    assert.equal((await request(`/documents/${source.body.data._id}`)).status, 200);
    const mappedPdf = require('../src/services/knowledge-page-map').fromPages([{ num: 2, text: 'To connect a receipt printer, open Print settings and choose the connected printer.' }], 3);
    const pdfSource = await request('/documents', { title: 'PDF printer guide', kind: 'pdf', status: 'published', revision: 'pdf-r1', ...mappedPdf });
    assert.equal(pdfSource.status, 201);
    const pdfAnswer = await request('/ask', { question: 'How do I connect a receipt printer?' });
    const pdfCitation = pdfAnswer.body.data.citations.find(citation => citation.document_id === pdfSource.body.data._id);
    assert.deepEqual(pdfCitation.pages, [2]);
    const pdfOpened = await request(`/documents/${pdfSource.body.data._id}?revision=pdf-r1&chunk=${pdfCitation.chunk}`);
    assert.deepEqual(pdfOpened.body.data.sections, [{ page: 2, text: mappedPdf.content }]);
    assert.equal((await request(`/documents/${pdfSource.body.data._id}?revision=old&chunk=0`)).status, 404);
    assert.equal((await request('/actions/draft', { type: 'stock_count' }, cashier)).status, 403);
    assert.equal((await request('/actions/draft', { type: 'purchase_order', payload: { orders: [] } })).status, 400);
    const draft = await request('/actions/draft', { type: 'stock_count' });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(await db.collection('inventory_counts').countDocuments(), 0);
    const confirmed = await request('/actions/confirm', { token: draft.body.data.token });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal((await request('/actions/confirm', { token: draft.body.data.token })).status, 400);
    assert.equal(await db.collection('inventory_counts').countDocuments(), 1);
    const savedOutcome = await request('/actions/' + draft.body.data.id);
    assert.equal(savedOutcome.body.data.status, 'completed');
    assert.equal(savedOutcome.body.data.saved.length, 1);
    assert.equal((await request('/actions/' + draft.body.data.id, null, cashier)).status, 404);
    const campaign = await request('/actions/draft', { type: 'campaign', payload: { name: 'Synthetic campaign', channel: 'sms', message: 'Synthetic draft only. No recipients.' } });
    assert.equal(campaign.status, 201, JSON.stringify(campaign.body));
    const savedCampaign = await request('/actions/confirm', { token: campaign.body.data.token });
    assert.equal(savedCampaign.status, 200, JSON.stringify(savedCampaign.body));
    assert.equal((await request('/actions/' + campaign.body.data.id)).body.data.saved.length, 1);
    const campaignRow = await db.collection('campaigns').findOne({ ask_posnic_action_id: campaign.body.data.id });
    assert.equal(String(campaignRow.license), String(license));
    assert.equal(campaignRow.status, 'draft');
    assert.equal(campaignRow.sent_count, 0);
    const saleDraft = await request('/actions/draft', { type: 'sale_draft', payload: { lines_text: '0.5 x Smoke test item', customer_name: 'Synthetic review', total: 0 } });
    assert.equal(saleDraft.status, 201, JSON.stringify(saleDraft.body));
    assert.equal(saleDraft.body.data.payload.total, 5.5);
    assert.equal(await db.collection('quotes').countDocuments(), 0);
    assert.equal((await request('/actions/draft', { type: 'sale_draft', payload: { lines_text: '1 x Smoke test item' } }, cashier)).status, 403);
    const salesBeforeDraft = await db.collection('sales').countDocuments();
    const confirmedSale = await request('/actions/confirm', { token: saleDraft.body.data.token });
    assert.equal(confirmedSale.status, 200, JSON.stringify(confirmedSale.body));
    const savedQuote = await db.collection('quotes').findOne({ ask_posnic_action_id: saleDraft.body.data.id });
    assert.equal(savedQuote.status, 'draft');
    assert.equal(savedQuote.total, 5.5);
    assert.equal(savedQuote.items[0].qty, 0.5);
    assert.equal(await db.collection('sales').countDocuments(), salesBeforeDraft);
    assert.equal(await db.collection('transaction').countDocuments(), 0);
    assert.equal((await db.collection('items').findOne({ branch_id: branch })).available_quantity, 3);
    assert.equal((await request('/actions/' + saleDraft.body.data.id)).body.data.status, 'completed');
    assert.equal((await request('/actions/confirm', { token: saleDraft.body.data.token })).status, 400);
    assert.equal(await db.collection('quotes').countDocuments(), 1);
    await db.collection('items').updateOne({ branch_id: branch }, { $set: { supplier_name: 'First synthetic supplier', supplier_id: new ObjectId(), cost_price: 5 } });
    await db.collection('items').insertOne({ license, branch_id: branch, name: 'Second reorder item', track_inventory: true, supplier_id: new ObjectId(), supplier_name: 'Second synthetic supplier', cost_price: 8, available_quantity: 4 });
    const batch = await request('/actions/draft', { type: 'purchase_order', payload: { source: 'low_stock' } });
    assert.equal(batch.status, 201, JSON.stringify(batch.body));
    const PoRepository = require('../src/repositories/purchase-order.repository');
    const originalSave = PoRepository.prototype.upsertOrder;
    PoRepository.prototype.upsertOrder = async function (data, id, context) {
      if (context.askPosnicAction?.step === 1) return { status: false, message: 'Synthetic interruption' };
      return originalSave.call(this, data, id, context);
    };
    try { assert.equal((await request('/actions/confirm', { token: batch.body.data.token })).status, 400); }
    finally { PoRepository.prototype.upsertOrder = originalSave; }
    const partial = await request('/actions/' + batch.body.data.id);
    assert.equal(partial.body.data.resumable, true);
    assert.equal(partial.body.data.saved.length, 1);
    assert.equal((await request('/actions/' + batch.body.data.id + '/resume', {}, cashier)).status, 403);
    // Inventory for an already saved order may change without blocking the
    // separate remaining order. Only the reviewed remainder is revalidated.
    await db.collection('items').updateOne({ name: 'Smoke test item' }, { $set: { available_quantity: 5 } });
    const recovery = await request('/actions/' + batch.body.data.id + '/resume', {});
    assert.equal(recovery.status, 201, JSON.stringify(recovery.body));
    assert.equal(recovery.body.data.payload.orders.length, 1);
    assert.equal(recovery.body.data.payload.orders[0].supplier_name, 'Second synthetic supplier');
    assert.equal(await db.collection('purchase_orders').countDocuments(), 1);
    assert.equal((await request('/actions/confirm', { token: recovery.body.data.token })).status, 200);
    assert.equal((await request('/actions/confirm', { token: recovery.body.data.token })).status, 400);
    assert.equal(await db.collection('purchase_orders').countDocuments(), 2);
    assert.equal((await request('/actions/' + batch.body.data.id)).body.data.status, 'completed');
    const supplierActor = new ObjectId();
    await db.collection('users').insertOne({ _id: supplierActor, license, username: 'supplier-draft-manager', role: 'manager', isActive: true, status: 'active', access: { receiving: { write: true } }, branch_access: [{ branch_id: branch }] });
    tokens[String(supplierActor)] = jwt.sign({ id: String(supplierActor) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const supplierDraft = await request('/actions/draft', { type: 'supplier_message', payload: { purchase_order: 'PO-000001', body: 'Forged text' } }, supplierActor);
    assert.equal(supplierDraft.status, 201, JSON.stringify(supplierDraft.body));
    assert.equal(supplierDraft.body.data.payload.body.includes('Forged text'), false);
    assert.equal(await db.collection('supplier_message_drafts').countDocuments(), 0);
    assert.equal((await request('/actions/draft', { type: 'supplier_message', payload: { purchase_order: 'PO-000001' } }, cashier)).status, 403);
    const supplierSaved = await request('/actions/confirm', { token: supplierDraft.body.data.token }, supplierActor);
    assert.equal(supplierSaved.status, 200, JSON.stringify(supplierSaved.body));
    assert.equal((await request('/actions/' + supplierDraft.body.data.id, null, supplierActor)).body.data.status, 'completed');
    assert.equal((await request('/actions/confirm', { token: supplierDraft.body.data.token }, supplierActor)).status, 400);
    assert.equal(await db.collection('supplier_message_drafts').countDocuments(), 1);
    assert.equal((await request('/supplier-messages', null, supplierActor)).body.data[0].body, supplierDraft.body.data.payload.body);
    assert.equal((await request('/supplier-messages')).body.data.length, 0);
    assert.equal((await request('/supplier-messages', null, cashier)).status, 403);
    await db.collection('users').updateOne({ _id: supplierActor }, { $set: { 'access.receiving.write': false } });
    assert.equal((await request('/supplier-messages', null, supplierActor)).status, 403);
    assert.equal(await db.collection('campaign_sends').countDocuments(), 0);
    const planner = new ObjectId(), planningItem = new ObjectId();
    await db.collection('users').insertOne({ _id: planner, license, username: 'reorder-manager', role: 'manager', isActive: true, status: 'active', access: { receiving: { write: true }, dashboard: { financials: true } }, branch_access: [{ branch_id: branch }] });
    tokens[String(planner)] = jwt.sign({ id: String(planner) }, process.env.JWT_SECRET, { expiresIn: '5m' });
    await db.collection('items').insertOne({ _id: planningItem, license, branch_id: branch, name: 'Planning tea', track_inventory: true, available_quantity: 1, cost_price: 3, supplier_id: new ObjectId(), supplier_name: 'Planning supplier', unit: 'pcs' });
    await db.collection('sales').insertOne({ license, branch_id: branch, date: new Date(Date.now() - 86400000), sale_process: 'Add', items: [{ item_id: planningItem, item_quantity: 30 }], items_total: 90 });
    const incomingOrder = { license, branch_id: branch, status: 'ordered', items: [{ item_id: planningItem, qty_ordered: 5, qty_received: 1 }] };
    const incomingId = (await db.collection('purchase_orders').insertOne(incomingOrder)).insertedId;
    const planning = await request('/ask', { question: 'Show reorder suggestions for next 14 days' }, planner);
    assert.equal(planning.status, 200, JSON.stringify(planning.body));
    assert.equal(planning.body.data.intent, 'reorder_suggestions');
    assert.equal(planning.body.data.action.coverage_days, 14);
    assert.match(planning.body.data.metrics[0].value, /Suggest 9 pcs/);
    assert.equal((await request('/ask', { question: 'Show reorder suggestions' }, cashier)).status, 403);
    const demandPayload = { source: 'demand', coverage_days: 14, orders: [{ items: [{ qty_ordered: 9999 }] }] };
    const demandDraft = await request('/actions/draft', { type: 'purchase_order', payload: demandPayload }, planner);
    assert.equal(demandDraft.status, 201, JSON.stringify(demandDraft.body));
    assert.equal(demandDraft.body.data.payload.orders[0].items[0].qty_ordered, 9);
    await db.collection('purchase_orders').updateOne({ _id: incomingId }, { $set: { 'items.0.qty_ordered': 7 } });
    const refusedDemand = await request('/actions/confirm', { token: demandDraft.body.data.token }, planner);
    assert.equal(refusedDemand.status, 400);
    assert.match(refusedDemand.body.message, /incoming orders changed/);
    assert.equal(await db.collection('purchase_orders').countDocuments({ ask_posnic_action_id: demandDraft.body.data.id }), 0);
    const freshDemand = await request('/actions/draft', { type: 'purchase_order', payload: demandPayload }, planner);
    assert.equal(freshDemand.status, 201, JSON.stringify(freshDemand.body));
    assert.equal(freshDemand.body.data.payload.orders[0].items[0].qty_ordered, 7);
    assert.equal((await request('/actions/confirm', { token: freshDemand.body.data.token }, planner)).status, 200);
    assert.equal((await db.collection('purchase_orders').findOne({ ask_posnic_action_id: freshDemand.body.data.id })).items[0].qty_ordered, 7);
    assert.equal((await db.collection('items').findOne({ _id: planningItem })).available_quantity, 1);
    await db.collection('users').updateOne({ _id: planner }, { $set: { 'access.sales.session_filter': true } });
    assert.equal((await request('/ask', { question: 'Show reorder suggestions' }, planner)).status, 403);
    assert.equal((await request('/actions/draft', { type: 'purchase_order', payload: demandPayload }, planner)).status, 400);
    assert.equal(JSON.stringify((await request('/history', null, planner)).body).includes('Planning tea'), false);
    const conversation = await db.collection('ask_posnic_conversations').findOne({ user_id: String(owner) });
    await db.collection('ask_posnic_conversations').updateOne({ _id: conversation._id }, { $push: { messages: { role: 'assistant', at: new Date(), payload: { intent: 'profit', answer: 'Private net profit: 314159.26', metrics: [{ label: 'Profit', value: '314159.26' }] } } } });
    assert.match(JSON.stringify((await request('/history')).body), /314159/);
    await db.collection('users').updateOne({ _id: owner }, { $set: { role: 'cashier' } });
    const restrictedHistory = await request('/history');
    assert.equal(restrictedHistory.status, 200);
    assert.doesNotMatch(JSON.stringify(restrictedHistory.body), /314159/);
    assert.match(JSON.stringify(restrictedHistory.body), /current permissions/);
    await db.collection('users').updateOne({ _id: owner }, { $set: { role: 'admin' } });
    const stale = await request('/actions/draft', { type: 'stock_count' });
    await db.collection('items').updateOne({ branch_id: branch }, { $inc: { available_quantity: 1 } });
    const staleConfirmation = await request('/actions/confirm', { token: stale.body.data.token });
    assert.equal(staleConfirmation.status, 400);
    assert.match(staleConfirmation.body.message, /Inventory changed/);
    assert.equal(await db.collection('inventory_counts').countDocuments(), 1);
    if (!live) {
      // Exercise the real HTTP/controllers/provider adapter with synthetic
      // OpenAI responses. No real customer key or external provider is used.
      const ai = require('../src/services/ai.service'), repo = ai._repo();
      const originalResolve = repo.resolveGroup, originalFetch = global.fetch;
      let embeddingCalls = 0;
      let retireOnCheck = false;
      repo.resolveGroup = async (group) => ({ status: true, data: { values: group === 'secrets' ? { ai_api_key: 'own-key-smoke-synthetic' } : group === 'preferences' ? { ai_provider: 'openai', ai_model: 'gpt-4o-mini' } : { ai_enabled: true } } });
      global.fetch = async (url, options) => {
        if (url === 'https://api.openai.com/v1/embeddings') {
          embeddingCalls++;
          assert.equal(options.headers.Authorization, 'Bearer own-key-smoke-synthetic');
          return { ok: true, json: async () => ({ model: 'text-embedding-3-small', usage: { total_tokens: 20 }, data: [{ index: 0, embedding: Array.from({ length: 256 }, (_, i) => i === 0 ? 1 : 0) }] }) };
        }
        if (url === 'https://api.openai.com/v1/chat/completions') {
          const checking = JSON.parse(options.body).messages.some((message) => message.role === 'system' && message.content.includes('Independently check'));
          if (checking && retireOnCheck) await db.collection('ask_posnic_documents').updateMany({ title: 'Correcting mistaken transactions' }, { $set: { status: 'retired' } });
          const content = checking ? { verdicts: [{ statement: 1, supported: true, relevant: true, conditions_preserved: true, modality_preserved: true }] } : { cannot_answer: false, statements: [{ text: 'Open Sales and choose Return.', evidence: [{ source: 1, quote: 'To reverse a mistaken transaction, open Sales and choose Return.' }] }] };
          return { ok: true, json: async () => ({ model: 'gpt-4o-mini', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }) };
        }
        if (!String(url).startsWith('http://127.0.0.1:')) throw new Error('Unexpected network destination in own-key smoke.');
        return originalFetch(url, options);
      };
      try {
        const prefs = { own_key_semantic: true, own_key_semantic_budget: 1, retention_days: 90 };
        assert.equal((await request('/preferences', prefs, cashier, 'PUT')).status, 403);
        assert.equal((await request('/preferences', { ...prefs, own_key_semantic_budget: -1 }, owner, 'PUT')).status, 400);
        assert.equal((await request('/preferences', { ...prefs, retention_days: 0 }, owner, 'PUT')).status, 400);
        assert.equal((await request('/preferences', prefs, owner, 'PUT')).status, 200);
        assert.equal((await request('/preferences')).body.data.retention_days, 90);
        await db.collection('ask_posnic_documents').updateMany({}, { $set: { status: 'retired' } });
        const ownDoc = await request('/documents', { title: 'Correcting mistaken transactions', kind: 'markdown', content: 'To reverse a mistaken transaction, open Sales and choose Return.', status: 'published' });
        assert.equal(ownDoc.status, 201, JSON.stringify(ownDoc.body));
        const indexed = await require('../src/services/ask-posnic-own-key-semantic.service').indexBatch(db);
        assert.equal(indexed.state, 'ready');
        const answer = await request('/ask', { question: 'How can I give a buyer their money back?' });
        assert.equal(answer.status, 200, JSON.stringify(answer.body));
        assert.equal(answer.body.data.mode, 'rag');
        assert.equal(answer.body.data.citations[0].title, 'Correcting mistaken transactions');
        const ownStatus = await request('/status');
        assert.equal(ownStatus.body.data.mode, 'own_key');
        assert.ok(ownStatus.body.data.own_key_search.spent_minor > 0);
        assert.equal(ownStatus.body.data.own_key_search.pending_calls, 0);
        assert.equal(embeddingCalls, 2);
        assert.ok(!JSON.stringify(ownStatus.body).includes('own-key-smoke-synthetic'));
        assert.equal((await request('/status', null, cashier)).body.data.own_key_search, null);
        retireOnCheck = true;
        const retiredDuringAnswer = await request('/ask', { question: 'How can I give a buyer their money back?' }, recoveryOwner);
        assert.equal(retiredDuringAnswer.status, 200, JSON.stringify(retiredDuringAnswer.body));
        assert.notEqual(retiredDuringAnswer.body.data.mode, 'rag');
        assert.equal(retiredDuringAnswer.body.data.citations.length, 0);
      } finally { repo.resolveGroup = originalResolve; global.fetch = originalFetch; }
    }
    if (live) {
      const credit = await db.collection('managed_ai_credits').findOne({ license: String(license) });
      assert.equal(credit.reserved_minor, 0);
      assert.ok(credit.used_minor > 0);
      const settled = await db.collection('managed_ai_reservations').countDocuments({ status: 'reconciled' });
      if (semantic) {
        assert.ok(settled >= 5);
        assert.ok(await db.collection('managed_ai_reservations').countDocuments({ model: 'amazon.titan-embed-text-v2:0', status: 'reconciled', actual_microminor: { $gt: 0 } }) >= 2);
      } else assert.equal(settled, 2);
    }
    console.log(JSON.stringify({ result: 'PASS', live_bedrock: live, live_semantic: semantic, checks: ['authentication', 'secret isolation', 'exact FAQ', 'cited help', 'source read', 'cashier action refusal', 'server-derived purchase orders', 'confirmed stock-count persistence', 'scoped action status', 'campaign draft without delivery', 'replay refusal', 'stale inventory refusal', 'history permission revocation', ...(live ? ['managed credit reconciliation'] : ['own-key semantic app flow with synthetic provider responses']), ...(semantic ? ['metered embeddings', 'live vector indexing', 'paraphrase retrieval', 'synthetic vector cleanup'] : [])] }));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (semantic && mongoose.connection.db) {
      const sources = await mongoose.connection.db.collection('ask_posnic_documents').find({ 'semantic.keys.0': { $exists: true } }).toArray();
      for (const doc of sources) await require('../src/services/ask-posnic-vector-store').remove(doc.semantic.keys);
    }
    await mongoose.disconnect();
    await memory.stop();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
