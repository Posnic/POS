// src/models/stock_log_model.js
const BaseModel = require('./base.model');

class StockLogModel extends BaseModel {
  constructor() {
    super('stocklogs');
    this.fields = StockLogModel.fields;
  }

  // Field definitions matching PHP model
  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    view_item_id: { type: 'ObjectId', select: true },
    item_barcode_id: { type: 'String', select: true },
    item_name: { type: 'String', select: true },
    item_quantity: { type: 'String', select: true },
    process: { type: 'String', select: true },
    reference: { type: 'String', select: true },
    date: { type: 'Date', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    action: { type: 'String', select: true },
    stocklog: { type: 'Boolean', select: true },
    opening_balance: { type: 'String', select: true },
    closing_balance: { type: 'String', select: true },
    count: { type: 'String', select: true },
    changed_by_userid: { type: 'ObjectId', select: true },
    changed_by: { type: 'String', select: true },
    license: { type: 'ObjectId', select: false },
  };
}

module.exports = StockLogModel;
