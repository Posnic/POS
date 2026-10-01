'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const COLLECTION = 'supplier_message_drafts';

async function prepare(model, input) {
  if (!model?.branchId || !model?.licenseId) throw new Error('An authenticated shop and outlet are required.');
  const reference = String(input?.purchase_order || '').trim();
  if (!reference || reference.length > 80) throw new Error('Enter a purchase-order number.');
  const query = ObjectId.isValid(reference) ? { _id: new ObjectId(reference) } : { po_id: reference.toUpperCase() };
  const orders = await (await model.getCollection('purchase_orders')).find(model.getContextMatch(query)).limit(2).toArray();
  if (orders.length !== 1) throw new Error('Choose one purchase order in this outlet.');
  const order = orders[0];
  if (!['draft', 'ordered', 'partial'].includes(order.status)) throw new Error('This purchase order is no longer open.');
  if (!Array.isArray(order.items) || order.items.length > 100) throw new Error('Supplier messages support orders with up to 100 lines.');
  const items = order.items.map((line) => {
    const ordered = Number(line.qty_ordered), received = Number(line.qty_received || 0);
    if (!Number.isFinite(ordered) || !Number.isFinite(received) || ordered < 0 || received < 0) throw new Error('Check the purchase-order quantities before preparing a message.');
    return { item_id: String(line.item_id), name: String(line.item_name || 'Unnamed item').slice(0, 200), remaining: Math.max(0, Math.round((ordered - received) * 1000) / 1000) };
  }).filter((line) => line.remaining > 0);
  if (!items.length) throw new Error('This purchase order has no remaining quantities.');
  const supplier = String(order.supplier_name || '').trim().slice(0, 200);
  if (!supplier) throw new Error('Choose a supplier on the purchase order first.');
  const kind = order.status === 'draft' ? 'availability_request' : 'delivery_followup';
  const po = String(order.po_id || reference).slice(0, 80);
  const subject = `${kind === 'availability_request' ? 'Availability request' : 'Delivery follow-up'}: ${po}`;
  const note = String(input.note || '').trim().slice(0, 500);
  const body = `Hello ${supplier},\n\n${kind === 'availability_request' ? `Please confirm availability and delivery timing for this proposed order (${po}).` : `Please confirm the delivery status of the remaining items on purchase order ${po}.`}\n\n${items.map((line) => `- ${line.name}: ${line.remaining}`).join('\n')}\n\n${note ? `${note}\n\n` : ''}Thank you.`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ id: String(order._id), po, supplier_id: String(order.supplier_id || ''), supplier, status: order.status, items })).digest('hex');
  return { purchase_order_id: String(order._id), po_id: po, supplier_name: supplier, kind, subject, body, note, source_fingerprint: fingerprint };
}

async function validate(model, payload) {
  const current = await prepare(model, { purchase_order: payload.purchase_order_id, note: payload.note });
  if (JSON.stringify(current) !== JSON.stringify(payload)) throw new Error('The purchase order changed. Prepare a new supplier message for review.');
}

async function save(payload, context) {
  if (![context?.branchId, context?.licenseId, context?.userId].every((id) => ObjectId.isValid(String(id || '')))) throw new Error('An authenticated shop, outlet and user are required.');
  const doc = { ...payload, license: new ObjectId(String(context.licenseId)), branch_id: new ObjectId(String(context.branchId)), user_id: new ObjectId(String(context.userId)), status: 'draft', created_at: new Date(), updated_at: new Date() };
  const db = await BaseModel.getDb();
  const result = await require('./ask-posnic-action-identity').insertOnce(db.collection(COLLECTION), doc, context);
  return { id: String(result.insertedId), subject: result.document.subject, status: 'draft' };
}

async function list(req) {
  const s = require('./ask-posnic-platform.service').scope(req);
  if (![s.license, s.branch_id, s.user_id].every((id) => ObjectId.isValid(id))) return [];
  const db = await BaseModel.getDb();
  return db.collection(COLLECTION).find({ license: new ObjectId(s.license), branch_id: new ObjectId(s.branch_id), user_id: new ObjectId(s.user_id), status: 'draft' }, { projection: { subject: 1, body: 1, po_id: 1, supplier_name: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(50).toArray();
}

module.exports = { prepare, validate, save, list, COLLECTION };
