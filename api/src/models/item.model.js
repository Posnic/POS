const mongoose = require('mongoose');
const { defineModel } = require('../db/model-registry');
const { toJSON, paginate } = require('./plugins');

// Mongoose-based Item model used by new code (sales, inventory, categories)
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    barcode_id: String,
    sku: String,
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    category_name: { type: String, trim: true },
    supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    supplier_name: { type: String, trim: true },
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    branch_name: { type: String, trim: true },
    quantity: { type: Number, default: 0 },
    available_quantity: { type: Number, default: 0 },
    cost_price: { type: Number, default: 0 },
    company_price: { type: Number, default: 0 },
    selling_price: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    discount_percentage: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    tax_type: { type: String, trim: true },
    tax_name: { type: String, trim: true },
    tax_fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    hsncode: { type: String, trim: true },
    hsndescription: { type: String, trim: true },
    itemid: { type: String, trim: true },
    item_status: { type: String, trim: true },
    track_inventory: { type: Boolean, default: false },
    negative_stock: { type: Boolean, default: false },
    image: { type: String, trim: true },
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    is_active: { type: Boolean, default: true },
  },
  {
    collection: 'items',
    timestamps: { createdAt: 'created_date', updatedAt: 'updated_date' },
  }
);

itemSchema.plugin(toJSON);
itemSchema.plugin(paginate);

const Item = defineModel('Item', itemSchema);

// Attach the legacy BaseModel-based implementation so callers can import
// both the Mongoose model and the legacy class from a single module
// (item.model.js).
// NOTE: ItemModel now primarily exists for backward compatibility. The
// authoritative implementations for all item DB operations live in
// ItemRepository. Most instance methods below are legacy-only and should
// not be used by new code.
//
// Usage examples (legacy only – new code should NOT use these directly):
//   const Item = require("../models/item.model");          // Mongoose
//   const LegacyItem = Item.LegacyItemModel;               // Legacy class alias
//   const { LegacyItemModel } = require("../models/item.model");

class ItemModel {
  static collectionName = 'items';

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    name: { type: 'String', select: true },
    itemid: { type: 'String', select: true },
    barcode_id: { type: 'String', select: true },
    image: { type: 'String', select: true },
    multi_image: { type: 'Array', select: true },
    category_id: { type: 'ObjectId', select: true },
    category_name: { type: 'String', select: true },
    supplier_id: { type: 'ObjectId', select: true },
    supplier_name: { type: 'String', select: true },
    mrp_price: { type: 'Number', select: true },
    company_price: { type: 'Number', select: true },
    selling_price: { type: 'Number', select: true },
    available_quantity: { type: 'Number', select: true },
    item_status: { type: 'String', select: true },
    description: { type: 'String', select: true },
    tax: { type: 'Number', select: true },
    tax_id: { type: 'ObjectId', select: true },
    tax_name: { type: 'String', select: true },
    tax_type: { type: 'String', select: true },
    tax_method: { type: 'String', select: true },
    tax_fields: { type: 'Array', select: true },
    hsncode: { type: 'String', select: true },
    hsndescription: { type: 'String', select: true },
    discount_amount: { type: 'Number', select: true },
    discount_percentage: { type: 'Number', select: true },
    unit: { type: 'String', select: true },
    unit_id: { type: 'String', select: true },
    track_inventory: { type: 'Boolean', select: true },
    sales_channel: { type: 'Boolean', select: true },
    ecommerce: { type: 'Boolean', select: true },
    isAvailable: { type: 'Boolean', select: true },
    negative_stock: { type: 'Boolean', select: true },
    sort_order: { type: 'Number', select: true },
    // Variant family link (V1) - the edit page's family strip reads these.
    variant_group_id: { type: 'ObjectId', select: true },
    variant_axis: { type: 'String', select: true },
    variant_value: { type: 'String', select: true },
    variant_parent_name: { type: 'String', select: true },
    branch_access: { type: 'Array', select: false },
    branch_id: { type: 'ObjectId', select: true },
    branch_name: { type: 'String', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by: { type: 'String', select: false },
    created_by_id: { type: 'ObjectId', select: false },
    updated_by: { type: 'String', select: false },
    updated_by_id: { type: 'ObjectId', select: false },
    license: { type: 'ObjectId', select: false },
  };
}

Item.LegacyItemModel = ItemModel;

module.exports = Item;
