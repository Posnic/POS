'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const sales = require('./sale.repository');
const LEASE_MS = 10 * 60 * 1000;

function failure(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

// Never send prices, payments or customer contact details to the kitchen.
function ticket(sale) {
  const pickItems = (items) =>
    (items || []).map((item) => ({
      item_name: String(item.item_name || item.name || ''),
      item_quantity: item.item_quantity ?? item.quantity ?? 1,
      item_note: String(item.item_note || item.item_description || item.note || ''),
      spice_level: item.spice_level ?? item.spice,
    }));
  return {
    _id: String(sale._id),
    sales_id: sale.sales_id,
    created_date: sale.created_date,
    updated_date: sale.updated_date,
    table_number: sale.table_number,
    person_count: sale.person_count,
    dine_type: sale.dine_type,
    sale_process: sale.sale_process,
    sales_description: sale.sales_description,
    channel: sale.channel,
    items: pickItems(sale.items),
    print_jobs: (sale.print_jobs || []).map((job) => ({
      key: require('../utils/kot-job-key').kotJobKey(String(sale._id), job),
      type: job.type,
      timestamp: job.timestamp,
      change_index: job.change_index,
      items: pickItems(job.items),
    })),
  };
}

async function handle(id, request = {}) {
  const branch = String(BaseModel.currentBranch || '');
  if (!ObjectId.isValid(id) || !ObjectId.isValid(branch) || !BaseModel.license) {
    throw failure('Choose a shop and a valid KOT order.', 400);
  }
  const db = await BaseModel.getDb();
  const collection = db.collection('sales');
  const scope = {
    _id: new ObjectId(id),
    branch_id: new ObjectId(branch),
    license: BaseModel.license,
  };
  const sale = await collection.findOne(scope);
  if (!sale || !/kot|cancelled/i.test(String(sale.sale_process))) {
    throw failure('KOT order not found in this shop.', 404);
  }
  const shop = await db.collection('branches').findOne({ _id: new ObjectId(branch) });
  if (![true, 'true', 'enable'].includes(shop?.table_options)) {
    throw failure('Restaurant is not enabled for this shop.', 403);
  }
  const action = request.action || 'prepare';
  if (action !== 'prepare') {
    if (
      !['confirm', 'release', 'renew'].includes(action) ||
      !/^[a-f0-9-]{36}$/.test(request.token || '')
    ) {
      throw failure('Invalid KOT print request.', 400);
    }
    const owned = {
      ...scope,
      kot_claimed_by: 'counter:' + request.token,
      kot_counter_until: { $gt: new Date() },
    };
    const update =
      action === 'renew'
        ? {
            $set: {
              kot_counter_until: new Date(Date.now() + LEASE_MS),
              kot_claimed_at: new Date(),
            },
          }
        : {
            $set: { kot_claimed_by: '', kot_claimed_at: null },
            $unset: { kot_counter_until: '', kot_counter_index: '', kot_counter_keys: '' },
          };
    if (action === 'confirm') {
      if (!Number.isInteger(sale.kot_counter_index))
        throw failure('This ticket is no longer pending.');
      // Only acknowledge the changes handed out, never additions made while
      // the cashier had the print dialog open.
      update.$max = { last_printed_change_index: sale.kot_counter_index };
      update.$set.kitchen_printed = true;
      update.$set.kitchen_printed_at = new Date();
    }
    const result = await collection.updateOne(owned, update);
    if (!result.matchedCount)
      throw failure('This print reservation expired. Check the kitchen before printing again.');
    if (action === 'confirm' && sale.kot_counter_keys?.length) {
      await require('./kot-shadow.repository').markShadowPrinted(sale.kot_counter_keys, {
        branchId: branch,
      });
    }
    return { state: action === 'confirm' ? 'printed' : action };
  }

  const token = crypto.randomUUID();
  const result = await sales.multiKitchenPrintModel(branch, {
    tillId: 'counter:' + token,
    onlySaleId: id,
    counterUntil: new Date(Date.now() + LEASE_MS),
  });
  if (!result.status) throw failure('Could not reserve the KOT. Please try again.', 503);
  if (result.data.length) return { state: 'ready', token, sale: ticket(result.data[0]) };

  const current = await collection.findOne(scope);
  if (!current) throw failure('KOT order not found in this shop.', 404);
  const pending = (current.changes || []).some(
    (change, index) =>
      index > (current.last_printed_change_index ?? -1) &&
      (change.items || []).some((item) => /^(add|cancel)$/i.test(item.process))
  );
  if (pending) return { state: 'busy' };
  if (request.copy === true) {
    const copy = ticket(current);
    copy.print_jobs = [{ type: 'copy', items: copy.items }];
    return { state: 'copy', sale: copy };
  }
  return { state: 'printed' };
}

module.exports = { handle, ticket };
