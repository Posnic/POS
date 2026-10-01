'use strict';

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

class InventoryCountRepository extends BaseModel {
  constructor() {
    super('inventory_counts');
  }

  wall(context) {
    if (!context?.branchId || !ObjectId.isValid(String(context.branchId))) return null;
    const wall = { branch_id: new ObjectId(String(context.branchId)) };
    if (context.licenseId && ObjectId.isValid(String(context.licenseId)))
      wall.license = new ObjectId(String(context.licenseId));
    return wall;
  }

  async createDraft(data, context) {
    const wall = this.wall(context);
    if (!wall) return { status: false, message: 'Branch ID not found', data: null };
    const lines = (Array.isArray(data.items) ? data.items : [])
      .filter((item) => ObjectId.isValid(String(item.item_id)))
      .slice(0, 1000)
      .map((item) => ({
        item_id: new ObjectId(String(item.item_id)),
        item_name: String(item.item_name || '').slice(0, 200),
        barcode_id: String(item.barcode_id || '').slice(0, 100),
        expected_quantity: Number(item.expected_quantity || 0),
        counted_quantity: null,
        unit: String(item.unit || '').slice(0, 40),
      }));
    if (!lines.length)
      return { status: false, message: 'Add at least one item to the stock count', data: null };
    const at = new Date();
    const doc = {
      ...wall,
      status: 'draft',
      scope: String(data.scope || 'all').slice(0, 40),
      notes: String(data.notes || '').slice(0, 500),
      items: lines,
      created_at: at,
      updated_at: at,
      created_by: context.userName || '',
      created_by_id: context.userId || null,
    };
    const result = await require('../services/ask-posnic-action-identity').insertOnce(
      await this.getCollection(this.collectionName),
      doc,
      context
    );
    return {
      status: true,
      message: 'Stock count draft created',
      data: { id: String(result.insertedId), item_count: result.document.items.length },
    };
  }

  async list(context) {
    const wall = this.wall(context);
    if (!wall) return { status: false, message: 'Branch ID not found', data: null };
    const rows = await (
      await this.getCollection(this.collectionName)
    )
      .find(wall, { projection: { items: 0 } })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();
    return { status: true, message: 'Stock counts', data: rows };
  }

  async get(id, context) {
    const wall = this.wall(context);
    if (!wall || !ObjectId.isValid(String(id)))
      return { status: false, message: 'Stock count not found', data: null };
    const row = await (
      await this.getCollection(this.collectionName)
    ).findOne({ _id: new ObjectId(String(id)), ...wall });
    return row
      ? { status: true, message: 'Stock count', data: row }
      : { status: false, message: 'Stock count not found', data: null };
  }
}

module.exports = InventoryCountRepository;
