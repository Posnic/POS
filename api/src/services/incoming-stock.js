'use strict';

/*
 * Incoming stock (PO_LIFECYCLE_DESIGN.md step 3).
 *
 * Incoming(item) = sum over OPEN purchase orders of (ordered - received),
 * computed at read time, returned for display - NEVER stored on the item
 * and NEVER part of stock math. Reads purchase_orders only.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

const store = new BaseModel('purchase_orders');

/**
 * A plain object { itemIdString: incomingQty } for the branch's open POs.
 * itemIds (optional) narrows the answer; an empty result is {}.
 */
async function incomingByItem(context = {}, itemIds = null) {
  try {
    const branchId = context.branchId;
    if (!branchId || !ObjectId.isValid(String(branchId))) return {};
    const collection = await store.getCollection('purchase_orders');
    const filter = {
      branch_id: new ObjectId(String(branchId)),
      status: { $in: ['ordered', 'partial'] },
    };
    if (context.licenseId && ObjectId.isValid(String(context.licenseId))) {
      filter.license = new ObjectId(String(context.licenseId));
    }
    const orders = await collection.find(filter, { projection: { items: 1 } }).toArray();

    const wanted = Array.isArray(itemIds) && itemIds.length ? new Set(itemIds.map(String)) : null;
    const incoming = {};
    for (const po of orders) {
      for (const line of po.items || []) {
        const key = String(line.item_id);
        if (wanted && !wanted.has(key)) continue;
        const outstanding = Math.max(
          (Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0),
          0
        );
        if (outstanding > 0) incoming[key] = (incoming[key] || 0) + outstanding;
      }
    }
    return incoming;
  } catch (error) {
    /* Display-only data: a failure here must never break the read that
       asked for it. */
    console.error('Error in incoming-stock:', error);
    return {};
  }
}

module.exports = { incomingByItem };
