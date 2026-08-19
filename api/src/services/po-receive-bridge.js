'use strict';

/*
 * The ONE bridge between purchase orders and receipts
 * (PO_LIFECYCLE_DESIGN.md step 2).
 *
 * Direction matters: receivings are the source of truth and the PO is the
 * mirror. This module READS receivings and WRITES purchase_orders - never
 * the other way, and never stock. qty_received is recomputed from scratch
 * from every receiving linked by source_po_id, so calling this twice, ten
 * times, or after a sync replay always lands on the same numbers - the
 * idempotence the sync rules demand. A blind += would double-count on the
 * first replay.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

const store = new BaseModel('purchase_orders');

async function syncPoFromReceivings(poId, context = {}) {
  try {
    if (!poId || !ObjectId.isValid(String(poId))) return { status: false, message: 'no po' };
    const branchId = context.branchId;
    if (!branchId || !ObjectId.isValid(String(branchId))) {
      return { status: false, message: 'no branch' };
    }

    const poCollection = await store.getCollection('purchase_orders');
    const receivingsCollection = await store.getCollection('receivings');

    const wall = { _id: new ObjectId(String(poId)), branch_id: new ObjectId(String(branchId)) };
    if (context.licenseId && ObjectId.isValid(String(context.licenseId))) {
      wall.license = new ObjectId(String(context.licenseId));
    }
    const po = await poCollection.findOne(wall);
    if (!po) return { status: false, message: 'purchase order not found' };

    const receivings = await receivingsCollection
      .find({ source_po_id: po._id, branch_id: po.branch_id }, { projection: { items: 1 } })
      .toArray();

    // Received per item, from scratch - the idempotent recompute.
    const receivedByItem = new Map();
    for (const receiving of receivings) {
      for (const line of receiving.items || []) {
        const key = String(line.item);
        receivedByItem.set(key, (receivedByItem.get(key) || 0) + (Number(line.quantity) || 0));
      }
    }

    let outstanding = 0;
    let anyReceived = false;
    const items = (po.items || []).map((line) => {
      const received = receivedByItem.get(String(line.item_id)) || 0;
      // Over-delivery is recorded as delivered, but fulfilment never
      // exceeds the plan - the PO closes, it does not go negative.
      const counted = Math.min(received, Number(line.qty_ordered) || 0);
      if (counted > 0) anyReceived = true;
      outstanding += Math.max((Number(line.qty_ordered) || 0) - counted, 0);
      return { ...line, qty_received: counted };
    });

    /* Terminal states stay terminal: a cancelled or closed order's history
       may re-sync (replays), but its status never reopens. */
    let status = po.status;
    if (!['cancelled', 'closed'].includes(po.status)) {
      status = outstanding === 0 ? 'closed' : anyReceived ? 'partial' : po.status;
    }

    await poCollection.updateOne(
      { _id: po._id },
      {
        $set: {
          items,
          status,
          received_receiving_ids: receivings.map((r) => r._id),
          updated_date: new Date(),
        },
      }
    );
    return { status: true, data: { status, outstanding } };
  } catch (error) {
    /* The bridge must never fail the receiving that triggered it - the
       receipt is real whatever happens to the mirror. */
    console.error('Error in po-receive-bridge:', error);
    return { status: false, message: error.message };
  }
}

module.exports = { syncPoFromReceivings };
