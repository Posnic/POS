'use strict';

/*
 * Purchase orders (PO_LIFECYCLE_DESIGN.md, Loyverse study L4 flagship).
 *
 * The governing rule, worth stating where the code lives: A PURCHASE ORDER
 * NEVER TOUCHES STOCK. Only receipts do. This repository must never import
 * the stock-log repository, never write available_quantity, never nudge the
 * movement ledger - a test pins that the only collection it touches is its
 * own. The PO is a plan; the receiving is the event; qty_received is written
 * back AFTER a receiving commits, recomputed from the linked receivings so
 * replays are idempotent (that bridge lives in build step 2).
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

const STATUSES = Object.freeze(['draft', 'ordered', 'partial', 'closed', 'cancelled']);

class PurchaseOrderRepository extends BaseModel {
  constructor() {
    super('purchase_orders');
  }

  _wall(context) {
    const branchId = context && context.branchId;
    const licenseId = context && context.licenseId;
    if (!branchId || !ObjectId.isValid(String(branchId))) return null;
    const wall = { branch_id: new ObjectId(String(branchId)) };
    if (licenseId && ObjectId.isValid(String(licenseId))) {
      wall.license = new ObjectId(String(licenseId));
    }
    return wall;
  }

  /* Next PO number for the branch: PO-000001 style, resilient to holes. */
  async _nextPoId(collection, wall) {
    const rows = await collection
      .find({ branch_id: wall.branch_id }, { projection: { po_id: 1 } })
      .toArray();
    let max = 0;
    for (const r of rows) {
      const n = Number(String((r && r.po_id) || '').replace(/^PO-?/i, ''));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return 'PO-' + String(max + 1).padStart(6, '0');
  }

  _normalizeLines(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { error: 'Add at least one line' };
    if (rows.length > 500) return { error: 'At most 500 lines per order' };
    const lines = [];
    for (const row of rows) {
      if (!row || !ObjectId.isValid(String(row.item_id))) continue;
      const qty = Number(row.qty_ordered);
      const cost = Number(row.unit_cost);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const unitCost = Number.isFinite(cost) && cost >= 0 ? cost : 0;
      lines.push({
        item_id: new ObjectId(String(row.item_id)),
        item_name: String(row.item_name || '').trim(),
        barcode_id: String(row.barcode_id || '').trim(),
        qty_ordered: qty,
        qty_received: 0,
        unit_cost: unitCost,
        line_total: Math.round(qty * unitCost * 100) / 100,
      });
    }
    if (!lines.length) return { error: 'No valid lines - each needs an item and a quantity' };
    return { lines };
  }

  _normalizeAdditionalCosts(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => ({
        label: String((r && r.label) || '')
          .trim()
          .slice(0, 100),
        amount: Number(r && r.amount) || 0,
      }))
      .filter((r) => r.label && Number.isFinite(r.amount) && r.amount >= 0)
      .slice(0, 20);
  }

  /*
   * Create (id empty) or update (draft/ordered only - a partially received
   * order's plan is history, not an editable document).
   */
  async upsertOrder(data = {}, id = '', context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };

      const supplierName = String((data && data.supplier_name) || '').trim();
      if (!supplierName) return { status: false, data: null, message: 'Choose a supplier' };
      const supplierId =
        data.supplier_id && ObjectId.isValid(String(data.supplier_id))
          ? new ObjectId(String(data.supplier_id))
          : null;

      const status = data.status === 'ordered' ? 'ordered' : 'draft';
      const parsed = this._normalizeLines(data.items);
      if (parsed.error) return { status: false, data: null, message: parsed.error };
      const additionalCosts = this._normalizeAdditionalCosts(data.additional_costs);

      const total = Math.round(parsed.lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
      const additionalTotal =
        Math.round(additionalCosts.reduce((s, c) => s + c.amount, 0) * 100) / 100;

      const now = new Date();
      const collection = await this.getCollection(this.collectionName);

      const doc = {
        branch_id: wall.branch_id,
        branch_name: String(context.branchName || '').trim(),
        supplier_id: supplierId,
        supplier_name: supplierName,
        status,
        order_date: now,
        expected_date: data.expected_date ? new Date(data.expected_date) : null,
        notes: String(data.notes || '')
          .trim()
          .slice(0, 500),
        items: parsed.lines,
        additional_costs: additionalCosts,
        total,
        additional_total: additionalTotal,
        grand_total: Math.round((total + additionalTotal) * 100) / 100,
        updated_date: now,
        updated_by: context.userName || '',
        updated_by_id: context.userId || null,
      };
      if (wall.license) doc.license = wall.license;

      if (id && ObjectId.isValid(String(id))) {
        const existing = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
        if (!existing) return { status: false, data: null, message: 'Purchase order not found' };
        if (existing.status !== 'draft' && existing.status !== 'ordered') {
          return {
            status: false,
            data: null,
            message: 'Only draft or ordered purchase orders can be edited',
          };
        }
        /* Editing keeps identity and any received history; the received
           quantities are re-attached by line item_id so an edit cannot
           erase what already arrived. */
        const receivedByItem = new Map(
          (existing.items || []).map((l) => [String(l.item_id), Number(l.qty_received) || 0])
        );
        doc.items = doc.items.map((l) => ({
          ...l,
          qty_received: receivedByItem.get(String(l.item_id)) || 0,
        }));
        await collection.updateOne({ _id: existing._id }, { $set: doc });
        return {
          status: true,
          data: { id: String(existing._id), po_id: existing.po_id },
          message: 'Purchase order updated',
        };
      }

      doc.po_id = await this._nextPoId(collection, wall);
      doc.created_date = now;
      doc.created_by = context.userName || '';
      doc.created_by_id = context.userId || null;
      doc.received_receiving_ids = [];
      const result = await collection.insertOne(doc);
      return {
        status: true,
        data: { id: String(result.insertedId), po_id: doc.po_id },
        message: status === 'draft' ? 'Draft saved' : 'Purchase order created',
      };
    } catch (error) {
      console.error('Error in PurchaseOrderRepository.upsertOrder:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async listOrders({ page = 1, limit = 10, status, supplierId } = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      const filter = { ...wall };
      if (status && STATUSES.includes(status)) filter.status = status;
      if (supplierId && ObjectId.isValid(String(supplierId))) {
        filter.supplier_id = new ObjectId(String(supplierId));
      }
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
      const collection = await this.getCollection(this.collectionName);
      const total = await collection.countDocuments(filter);
      const rows = await collection
        .find(filter)
        .sort({ created_date: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .toArray();
      const list = rows.map((po) => ({
        id: String(po._id),
        po_id: po.po_id,
        order_date: po.order_date,
        expected_date: po.expected_date,
        supplier_name: po.supplier_name,
        status: po.status,
        ordered_qty: (po.items || []).reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0),
        received_qty: (po.items || []).reduce((s, l) => s + (Number(l.qty_received) || 0), 0),
        grand_total: po.grand_total || 0,
      }));
      return {
        status: true,
        data: {
          list,
          total,
          total_pages: Math.ceil(total / parsedLimit) || 1,
          current_page: parsedPage,
          per_page: parsedLimit,
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in PurchaseOrderRepository.listOrders:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getOrder(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid purchase order id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const po = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!po) return { status: false, data: null, message: 'Purchase order not found' };
      return { status: true, data: po, message: 'success' };
    } catch (error) {
      console.error('Error in PurchaseOrderRepository.getOrder:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * Status transitions that are legal WITHOUT a receiving:
   *   draft -> ordered  (commit the plan; it starts counting as Incoming)
   *   draft/ordered/partial -> cancelled/closed via cancel-remaining
   *     (nothing received yet -> cancelled; something received -> closed).
   * Receiving-driven transitions (ordered/partial -> partial/closed) belong
   * to the receive bridge, not this method.
   */
  async transition(id, action, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid purchase order id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const po = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!po) return { status: false, data: null, message: 'Purchase order not found' };

      const now = new Date();
      if (action === 'order') {
        if (po.status !== 'draft') {
          return { status: false, data: null, message: 'Only a draft can be ordered' };
        }
        await collection.updateOne(
          { _id: po._id },
          { $set: { status: 'ordered', order_date: now, updated_date: now } }
        );
        return { status: true, data: { status: 'ordered' }, message: 'Purchase order placed' };
      }

      if (action === 'cancel_remaining') {
        if (!['draft', 'ordered', 'partial'].includes(po.status)) {
          return { status: false, data: null, message: 'Nothing left to cancel on this order' };
        }
        const received = (po.items || []).reduce((s, l) => s + (Number(l.qty_received) || 0), 0);
        const finalStatus = received > 0 ? 'closed' : 'cancelled';
        await collection.updateOne(
          { _id: po._id },
          { $set: { status: finalStatus, updated_date: now } }
        );
        return {
          status: true,
          data: { status: finalStatus },
          message:
            finalStatus === 'closed'
              ? 'Remaining items cancelled - order closed'
              : 'Purchase order cancelled',
        };
      }

      return { status: false, data: null, message: 'Unknown action' };
    } catch (error) {
      console.error('Error in PurchaseOrderRepository.transition:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* Drafts are the only deletable state - an ordered PO was communicated to
     a supplier and gets cancelled, not erased. */
  async deleteOrder(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid purchase order id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const result = await collection.deleteOne({
        _id: new ObjectId(String(id)),
        ...wall,
        status: 'draft',
      });
      if (result.deletedCount !== 1) {
        return { status: false, data: null, message: 'Only drafts can be deleted' };
      }
      return { status: true, data: { deleted: 1 }, message: 'Draft deleted' };
    } catch (error) {
      console.error('Error in PurchaseOrderRepository.deleteOrder:', error);
      return { status: false, data: null, message: error.message };
    }
  }
}

module.exports = PurchaseOrderRepository;
