'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');

function recordId(draftId, step, collectionName) {
  if (!/^[a-f0-9]{24}$/i.test(String(draftId || '')) || !Number.isSafeInteger(step) || step < 0 || step > 1000 || !['purchase_orders', 'inventory_counts', 'campaigns', 'quotes', 'supplier_message_drafts'].includes(collectionName)) throw new Error('Invalid action record identity.');
  return new ObjectId(crypto.createHash('sha256').update(`ask-posnic:${draftId}:${collectionName}:${step}`).digest('hex').slice(0, 24));
}

// Only the authenticated action executor supplies this context. Normal form
// submissions keep the repository's existing creation behavior.
async function insertOnce(collection, doc, context) {
  const action = context?.askPosnicAction;
  if (!action) return { ...await collection.insertOne(doc), document: doc };
  if (!doc.license || !doc.branch_id) throw new Error('Action records require a shop and outlet.');
  const id = recordId(action.id, action.step, collection.collectionName);
  const match = { _id: id, license: doc.license, branch_id: doc.branch_id, ask_posnic_action_id: String(action.id), ask_posnic_step: action.step };
  const existing = await collection.findOne(match);
  if (existing) return { insertedId: existing._id, document: existing, reused: true };
  Object.assign(doc, match);
  try { return { ...await collection.insertOne(doc), document: doc }; }
  catch (error) {
    // A lost acknowledgement can follow a successful insert. The stored identity
    // proves the outcome without issuing a second write or replaying side effects.
    const persisted = await collection.findOne(match).catch(() => null);
    if (persisted) return { insertedId: persisted._id, document: persisted, reused: true };
    throw error;
  }
}

function records(draft) {
  const collection = { purchase_order: 'purchase_orders', stock_count: 'inventory_counts', campaign: 'campaigns', sale_draft: 'quotes', supplier_message: 'supplier_message_drafts' }[draft.type];
  const count = draft.type === 'purchase_order' ? draft.payload?.orders?.length || 0 : 1;
  if (!collection || !count || count > 1000) throw new Error('Invalid action record set.');
  return Array.from({ length: count }, (_, step) => ({ collection, step, id: recordId(String(draft._id), step, collection) }));
}

module.exports = { recordId, insertOnce, records };
