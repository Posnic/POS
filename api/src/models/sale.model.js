// src/models/sale_model.js
const mongoose = require('mongoose');
const { currentConnection } = require('../db/tenant-context');
const { toJSON, paginate } = require('./plugins');
const { PAYMENT_STATUS } = require('../constants');
const { SALE_PROCESS_VALUES } = require('../constants/sales.constants');
const BaseModel = require('./base.model');
const { sendEmail } = require('../utils/email');

// Helper to match legacy PHP round() behavior

// Helper to safely coerce discount/tax/amount fields that may be null, empty
// strings, or legacy string values like "null" into numeric zeros. This is
// used across sales detail views and returnSalesOrder to prevent NaN from
// leaking into stored documents or frontend calculations.

// Register Item model before using it in references
require('./item.model');

// Repository singletons used by Mongoose hooks. These are intentionally
// lightweight and rely on BaseModel's static context (license, branch, etc.).

const saleItemSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    barcode: String,
    sku: String,
    quantity: {
      type: Number,
      required: true,
      /*
       * A gram, not a unit.
       *
       * This was 1, which is a whole kilo for anything sold by weight: a 300g
       * sale was refused outright with "less than minimum allowed value (1)"
       * after the till had already taken payment. Three decimals is what the
       * scale reports, so 0.001 is the smallest quantity that can mean anything.
       */
      min: 0.001,
    },
    unit_price: {
      type: Number,
      required: true,
      min: 0,
    },
    tax_rate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    tax_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      min: 0,
    },

    // PHP-compatible item-level mirror fields (from Api/src/model/sales_model.php::$itemsale)
    sale_inline_item_price: {
      type: Number,
      default: 0,
      min: 0,
    },
    sale_inline_discount_value: {
      type: Number,
      default: 0,
      min: 0,
    },
    sale_inline_discount_pervalue: {
      type: Number,
      default: 0,
      min: 0,
    },
    item_status: {
      type: String,
      trim: true,
    },
    return: {
      type: Boolean,
      default: false,
    },
    item_sku: {
      type: String,
      trim: true,
    },
    item_discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    item_discount_percentage: {
      type: Number,
      default: 0,
      min: 0,
    },
    item_available_quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    item_id: {
      type: String,
      trim: true,
    },
    item_unit: {
      type: String,
      trim: true,
    },
    total_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    barcode_id: {
      type: String,
      trim: true,
    },
    company_price_total: {
      type: Number,
      default: 0,
      min: 0,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
    },
    category_name: {
      type: String,
      trim: true,
    },
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
    },
    supplier_name: {
      type: String,
      trim: true,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax_type: {
      type: String,
      trim: true,
    },
    igst_tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    cgst_tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    sgst_tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax_name: {
      type: String,
      trim: true,
    },
    tax_fields: {
      type: mongoose.Schema.Types.Mixed,
    },
    track_inventory: {
      type: Boolean,
      default: true,
    },
    negative_stock: {
      type: Boolean,
      default: false,
    },
    item_description: {
      type: String,
      trim: true,
    },
  },
  { _id: false, strict: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    method: {
      type: String,
      enum: ['cash', 'card', 'bank_transfer', 'credit', 'other'],
      required: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    // ---- PHP-compatible legacy fields (mirroring Api/src/model/sales_model.php::$fields) ----

    // Branch & document identity
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    branch_name: {
      type: String,
      trim: true,
    },
    printing_address: {
      type: String,
      trim: true,
    },
    sales_id: {
      type: String,
      trim: true,
      index: true,
    },
    billing_transaction_id: {
      type: String,
      trim: true,
    },
    wallet_amount: {
      type: Number,
      default: 0,
    },

    created_date: {
      type: Date,
    },
    // PHP stores username/email in created_by. We mirror that here and
    // keep the actual User ObjectId in created_by_id.
    created_by: {
      type: String,
      trim: true,
    },
    created_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    license: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Core sales fields
    date: {
      type: Date,
      default: Date.now,
    },
    sale_process: {
      type: String,
      enum: SALE_PROCESS_VALUES,
      default: 'Add',
      trim: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    user_name: {
      type: String,
      trim: true,
    },

    category_id: {
      type: String,
      trim: true,
    },
    category_name: {
      type: String,
      trim: true,
    },
    referrer_id: {
      type: String,
      trim: true,
    },
    referrer_name: {
      type: String,
      trim: true,
    },

    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
    },
    customer_name: {
      type: String,
      trim: true,
    },
    customer_address: {
      type: String,
      trim: true,
    },
    customer_city: {
      type: String,
      trim: true,
    },
    customer_phone: String,
    customer_email: {
      type: String,
      trim: true,
    },
    customer_state: {
      type: String,
      trim: true,
    },
    customer_country: {
      type: String,
      trim: true,
    },
    country_sort: {
      type: String,
      trim: true,
    },
    customer_gst_type: {
      type: String,
      trim: true,
    },
    customer_gst_number: {
      type: String,
      trim: true,
    },
    customer_balance: {
      type: Number,
      default: 0,
    },

    // Partial / payment status
    // Mirrors legacy PHP partial_check flag; can be stored as boolean or
    // string "true"/"false" depending on source.
    partial_check: {
      type: mongoose.Schema.Types.Mixed,
      default: false,
    },
    partial_balance: {
      type: Number,
      default: 0,
    },
    payment_status: {
      type: String,
      default: PAYMENT_STATUS.COMPLETED,
    },
    payment_pending: {
      type: Number,
      default: 0,
    },
    payment_mode: {
      type: String,
      default: 'Cash',
      trim: true,
    },

    // PHP-style payment/sales descriptions
    payment_description: {
      type: String,
      trim: true,
    },
    sales_description: {
      type: String,
      trim: true,
    },
    discount_description: {
      type: String,
      trim: true,
    },

    // Totals and aggregates
    sales_total: {
      type: Number,
      default: 0,
    },
    sales_round_off: {
      type: Number,
      default: 0,
    },
    round_off: {
      type: Number,
      default: 0,
    },
    sales_sub_total: {
      type: Number,
      default: 0,
    },
    items_total: {
      type: Number,
      default: 0,
    },
    items_return_total: {
      type: Number,
      default: 0,
    },
    return_round_off: {
      type: Number,
      default: 0,
    },
    items_subtotal: {
      type: Number,
      default: 0,
    },
    items_return_subtotal: {
      type: Number,
      default: 0,
    },
    total_companyprice: {
      type: Number,
      default: 0,
    },

    sgst: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    gst: {
      type: String,
      trim: true,
    },
    return_tax: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    return_discount: {
      type: Number,
      default: 0,
    },
    number_of_items_return: {
      type: Number,
      default: 0,
    },

    updated_date: {
      type: Date,
    },
    // PHP stores username/email in updated_by. We mirror that here and
    // keep the actual User ObjectId in updated_by_id.
    updated_by: {
      type: String,
      trim: true,
    },
    updated_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    number_of_items: {
      type: Number,
      default: 0,
    },

    items: [saleItemSchema],
    // Changes array for tracking cancellations and modifications
    changes: {
      type: Array,
      default: [],
    },
    // Return / aggregate fields
    items_return: {
      type: Array,
      default: [],
    },
    cashregister_id: {
      type: String,
      trim: true,
    },

    // Extra discount fields
    extra_discount: {
      type: Number,
      default: 0,
    },
    sale_extra_discount: {
      type: Number,
      default: 0,
    },
    extra_discount_type: {
      type: String,
      enum: ['price', 'percentage', 'percent'],
      default: 'price',
      trim: true,
    },
    return_extra_discount: {
      type: Number,
      default: 0,
    },
    // Multi-payment support
    multi_payment: {
      type: mongoose.Schema.Types.Mixed, // Object with payment methods as keys
    },

    // Restaurant/Table specific fields
    // dine_type, table_number already defined below
    table_id: {
      type: String,
      trim: true,
    },
    table_number: {
      type: String,
      trim: true,
      default: '',
    },
    dine_type: {
      type: String,
      trim: true,
      default: '',
    },
    person_count: {
      type: mongoose.Schema.Types.Mixed, // Can be string or number
    },
    sale_method: {
      type: String,
      trim: true,
    },
    denomination_values: {
      type: mongoose.Schema.Types.Mixed,
    },
    was_kot_proceeded: {
      type: Boolean,
      default: false,
    },

    // ---- Node-only / extended fields (no strict PHP order) ----

    // Keep branch as an optional reference only; PHP documents only store branch_id.
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    logo: {
      type: String,
      trim: true,
    },
    order: {
      type: String,
      trim: true,
    },

    // For strict PHP parity we do not require subtotal/total on the document;
    // they may be omitted entirely when saving via the legacy sales service.
    subtotal: {
      type: Number,
      min: 0,
    },
    // For PHP 1:1 parity, do not require a Node-only 'total' field; it may
    // be omitted entirely when using the legacy sales.service processSale.
    total: {
      type: Number,
      min: 0,
    },
    payments: [paymentSchema],
    // Do not auto-create paid_amount/balance for PHP-mirrored documents;
    // they will be present only when explicitly set by non-legacy flows.
    paid_amount: {
      type: Number,
      min: 0,
    },
    balance: {
      type: Number,
    },
    notes: {
      type: String,
      trim: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      // Keep as raw ObjectId; this codebase uses a legacy CustomerModel (not a registered Mongoose model).
    },
  },
  {
    timestamps: false,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add plugins
saleSchema.plugin(toJSON);
saleSchema.plugin(paginate);

// Pre-save hook: Generate sales_id and sync fields
saleSchema.pre('save', async function () {
  const isLegacyPhpSale = this.sale_method === 'Live-Order';

  // STEP 1: Generate sales_id for new sales (PHP-style)
  if (this.isNew && !this.sales_id) {
    if (!this.branch && this.branch_id && !isLegacyPhpSale) {
      this.branch = this.branch_id;
    }

    // Fallback, non-DB-based sales_id generation for flows that do not
    // provide an explicit sales_id (service layer remains the primary
    // source of truth for sequential/prefixed IDs).
    if (!this.sales_id) {
      const fallbackId = `SID${Date.now()}`;
      this.sales_id = fallbackId;
    }
  }

  // STEP 2: Sync branch_id with branch
  if (this.branch && (!this.branch_id || this.isNew || this.isModified('branch'))) {
    this.branch_id = this.branch;
  }

  const items = Array.isArray(this.items) ? this.items : [];
  let itemsTotal = 0;
  let itemsSubtotal = 0;
  let itemCount = 0;

  for (const item of items) {
    const qty = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity) || 0;
    const lineTotal = typeof item.total === 'number' ? item.total : Number(item.total) || 0;
    itemsTotal += lineTotal;
    itemsSubtotal += lineTotal;
    itemCount += qty;
  }

  if (this.subtotal != null) {
    this.items_subtotal = this.subtotal;
  } else if (!this.items_subtotal) {
    this.items_subtotal = itemsSubtotal;
  }

  if (this.total != null) {
    this.items_total = this.total;
  } else if (!this.items_total) {
    this.items_total = itemsTotal;
  }

  if (!this.number_of_items || this.isNew || this.isModified('items')) {
    // PHP stores number_of_items as the number of item lines (sizeof($itemsale)),
    // not the total quantity. For legacy Live-Order sales, mirror that exactly.
    if (isLegacyPhpSale) {
      this.number_of_items = items.length;
    } else {
      this.number_of_items = itemCount;
    }
  }

  const totalAmount = typeof this.total === 'number' ? this.total : Number(this.total) || 0;
  const paidAmount =
    typeof this.paid_amount === 'number' ? this.paid_amount : Number(this.paid_amount) || 0;
  let balance = typeof this.balance === 'number' ? this.balance : Number(this.balance) || 0;

  // If legacy/ PHP-style flows (processSale) have already provided
  // explicit partial_balance and payment_pending, do not overwrite them
  // here. Only recompute when they are missing.
  const hasIncomingPartial =
    typeof this.partial_balance === 'number' && !Number.isNaN(this.partial_balance);
  const hasIncomingPending =
    typeof this.payment_pending === 'number' && !Number.isNaN(this.payment_pending);

  if (!hasIncomingPartial && !hasIncomingPending) {
    if (!balance && totalAmount && paidAmount <= totalAmount) {
      balance = totalAmount - paidAmount;
    }

    this.partial_balance = paidAmount;
    this.payment_pending = balance > 0 ? balance : 0;
  }

  // Sync PHP-style created_date/updated_date audit fields
  if (this.isModified('date') || !this.updated_date) {
    const baseDate = this.date || this.updated_date || this.created_date || new Date();
    this.updated_date = baseDate;
    if (!this.created_date) {
      this.created_date = baseDate;
    }
  } else if (!this.created_date) {
    this.created_date = this.date || this.updated_date || new Date();
  }

  // Sync PHP-style user/audit identifiers from created_by/updated_by when available
  // For legacy documents where created_by/updated_by were stored as ObjectIds,
  // keep backward compatibility by deriving *_id and user_id. For new
  // PHP-parity sales, created_by/updated_by are plain strings (username/email),
  // so these guards will safely skip.
  if (this.created_by && !this.created_by_id && mongoose.Types.ObjectId.isValid(this.created_by)) {
    this.created_by_id = this.created_by;
  }
  if (this.updated_by && !this.updated_by_id && mongoose.Types.ObjectId.isValid(this.updated_by)) {
    this.updated_by_id = this.updated_by;
  }
  if (!this.user_id && this.created_by && mongoose.Types.ObjectId.isValid(this.created_by)) {
    this.user_id = this.created_by;
  }

  if (!this.license && BaseModel && BaseModel.license) {
    this.license = BaseModel.license;
  }

  // For legacy PHP-style "Live-Order" sales, strip Node-only fields that
  // do not exist in the original PHP sales collection so that new
  // documents in Mongo are 1:1 replicas of PHP add-sale documents.
  if (isLegacyPhpSale) {
    // These fields are useful for extended Node flows but are not part of
    // the legacy PHP schema; remove them for Live-Order parity.
    this.set('customer_balance', undefined);
    this.set('sgst', undefined);
    this.set('number_of_items_return', undefined);
    this.set('payments', undefined);

    // Ensure optional PHP header fields are always present, even if blank.
    if (this.category_id === undefined || this.category_id === null) {
      this.set('category_id', '');
    }
    if (this.category_name === undefined || this.category_name === null) {
      this.set('category_name', '');
    }
    if (this.referrer_id === undefined || this.referrer_id === null) {
      this.set('referrer_id', '');
    }
    if (this.referrer_name === undefined || this.referrer_name === null) {
      this.set('referrer_name', '');
    }
    if (this.customer_email === undefined || this.customer_email === null) {
      this.set('customer_email', '');
    }

    // For Live-Order parity, rewrite each items[] entry to only contain
    // the PHP $itemsale structure fields, dropping all Node-only keys.
    const currentItems = Array.isArray(this.items) ? this.items : [];
    const phpItems = currentItems.map((item) => {
      const src = item && typeof item.toObject === 'function' ? item.toObject() : item || {};

      return {
        sale_inline_item_price: src.sale_inline_item_price != null ? src.sale_inline_item_price : 0,
        sale_inline_discount_value:
          src.sale_inline_discount_value != null ? src.sale_inline_discount_value : 0,
        sale_inline_discount_pervalue:
          src.sale_inline_discount_pervalue != null ? src.sale_inline_discount_pervalue : 0,
        item_status: src.item_status != null ? src.item_status : '',
        return: src.return === true,
        item_name: src.item_name != null ? src.item_name : '',
        item_sku: src.item_sku != null ? src.item_sku : '',
        item_price: src.item_price != null ? src.item_price : 0,
        item_discount: src.item_discount != null ? src.item_discount : 0,
        item_discount_percentage:
          src.item_discount_percentage != null ? src.item_discount_percentage : 0,
        item_quantity: src.item_quantity != null ? src.item_quantity : 0,
        item_available_quantity:
          src.item_available_quantity != null ? src.item_available_quantity : 0,
        item_id: src.item_id != null ? src.item_id : '',
        item_unit: src.item_unit != null ? src.item_unit : 'qty',
        total_amount: src.total_amount != null ? src.total_amount : 0,
        barcode_id: src.barcode_id != null ? src.barcode_id : '',
        company_price_total: src.company_price_total != null ? src.company_price_total : 0,
        category_id: src.category_id != null ? src.category_id : undefined,
        category_name: src.category_name != null ? src.category_name : '',
        supplier_id: src.supplier_id != null ? src.supplier_id : undefined,
        supplier_name: src.supplier_name != null ? src.supplier_name : '',
        item_description: src.item_description != null ? src.item_description : '',
        tax: src.tax != null ? src.tax : 0,
        tax_type: src.tax_type != null ? src.tax_type : '',
        igst_tax: src.igst_tax != null ? src.igst_tax : 0,
        cgst_tax: src.cgst_tax != null ? src.cgst_tax : 0,
        sgst_tax: src.sgst_tax != null ? src.sgst_tax : 0,
        tax_name: src.tax_name != null ? src.tax_name : '',
        tax_amount: src.tax_amount != null ? src.tax_amount : 0,
        tax_fields: src.tax_fields != null ? src.tax_fields : undefined,
        track_inventory: src.track_inventory === true,
        negative_stock: src.negative_stock === true,
      };
    });

    this.set('items', phpItems);

    const normalizedItems = Array.isArray(this.items) ? this.items : [];
    for (const itemDoc of normalizedItems) {
      if (itemDoc && typeof itemDoc.set === 'function') {
        itemDoc.set('tax_rate', undefined);
        itemDoc.set('discount', undefined);
      }
    }
  }

  const changesArr = Array.isArray(this.changes) ? this.changes : [];
  if (changesArr.length) {
    const itemSkuMap = new Map();
    const itemsForMap = Array.isArray(this.items) ? this.items : [];

    for (const it of itemsForMap) {
      if (!it) continue;
      const src = it && typeof it.toObject === 'function' ? it.toObject() : it || {};

      const key = src && src.item_id != null ? String(src.item_id) : '';
      if (!key) continue;
      if (!itemSkuMap.has(key)) {
        const sku =
          src.item_sku != null ? src.item_sku : src.item_code != null ? src.item_code : '';
        itemSkuMap.set(key, sku);
      }
    }

    for (const change of changesArr) {
      const changeItems = Array.isArray(change && change.items) ? change.items : [];
      for (const changeItem of changeItems) {
        if (!changeItem) continue;
        if (changeItem.item_code === undefined || changeItem.item_code === null) {
          const id = changeItem.item_id != null ? String(changeItem.item_id) : '';
          let code = '';
          if (id && itemSkuMap.has(id)) {
            code = itemSkuMap.get(id) || '';
          }
          changeItem.item_code = code;
        }
      }
    }

    this.set('changes', changesArr);
  }
});

// PHP: getSaleQtyDetailModel
// Validate that the original sale quantities are still available in stock
// for the given sale id. Mirrors Api/src/model/sales_model.php::getSaleQtyDetailModel.
// Static method for exporting sales data (ported from PHP exportSalesOrder)
saleSchema.index(
  { license: 1, billing_transaction_id: 1 },
  {
    unique: true,
    partialFilterExpression: { billing_transaction_id: { $type: 'string' } },
    name: 'unique_billing_transaction_per_license',
  }
);

const Sale = mongoose.model('Sale', saleSchema);

class LegacySaleModel {
  static collectionName = 'sales';

  static fields = {
    _id: { type: 'ObjectId', select: true, name: 'id' },
    branch_id: { type: 'ObjectId', select: true },
    logo: { type: 'String', select: true },
    branch_name: { type: 'String', select: true },
    user_id: { type: 'String', select: true },
    user_name: { type: 'String', select: true },
    sales_id: { type: 'String', select: true },
    date: { type: 'Date', select: true },
    items: { type: 'Array', select: true },
    items_return: { type: 'Array', select: true },
    sale_process: { type: 'String', select: true },
    customer_id: { type: 'ObjectId', select: true },
    customer_name: { type: 'String', select: true },
    customer_address: { type: 'String', select: true },
    customer_phone: { type: 'String', select: true },
    customer_email: { type: 'String', select: true },
    customer_state: { type: 'String', select: true },
    customer_country: { type: 'String', select: true },
    customer_gst_type: { type: 'String', select: true },
    customer_gst_number: { type: 'String', select: true },
    payment_pending: { type: 'String', select: true },
    payment_mode: { type: 'String', select: true },
    partial_balance: { type: 'String', select: true },
    partial_check: { type: 'String', select: true },
    payment_description: { type: 'String', select: true },
    printing_address: { type: 'String', select: true },
    payment_status: { type: 'String', select: true },
    sales_description: { type: 'String', select: true },
    sales_total: { type: 'Number', select: true },
    sales_round_off: { type: 'Number', select: true },
    round_off: { type: 'Number', select: true },
    return_round_off: { type: 'Number', select: true },
    sales_sub_total: { type: 'Number', select: true },
    items_total: { type: 'Number', select: true },
    items_return_total: { type: 'Number', select: true },
    items_subtotal: { type: 'Number', select: true },
    items_return_subtotal: { type: 'Number', select: true },
    total_companyprice: { type: 'Number', select: true },
    tax: { type: 'Number', select: true },
    gst: { type: 'String', select: true },
    sgst: { type: 'Number', select: true },
    discount: { type: 'Number', select: true },
    return_tax: { type: 'Number', select: true },
    return_discount: { type: 'Number', select: true },
    number_of_items: { type: 'Number', select: true },
    number_of_items_return: { type: 'Number', select: true },
    created_date: { type: 'Date', select: true },
    updated_date: { type: 'Date', select: true },
    created_by_id: { type: 'ObjectId', select: false },
    created_by: { type: 'String', select: true },
    updated_by_id: { type: 'ObjectId', select: false },
    updated_by: { type: 'String', select: true },
    license: { type: 'ObjectId', select: false },
    wallet_amount: { type: 'Number', select: true },
    sale_extra_discount: { type: 'Number', select: true },
    extra_discount: { type: 'Number', select: true },
    discount_description: { type: 'String', select: true },
    return_extra_discount: { type: 'Number', select: true },
    extra_discount_type: { type: 'String', select: true },
    sale_method: { type: 'String', select: true },
    order: { type: 'String', select: true },
    multi_payment: { type: 'Array', select: true },
    table_id: { type: 'String', select: true },
    table_number: { type: 'String', select: true },
    dine_type: { type: 'String', select: true },
    person_count: { type: 'String', select: true },
    was_kot_proceeded: { type: 'Boolean', select: true },
    denomination_values: { type: 'Array', select: true },
  };
}

Sale.LegacySaleModel = LegacySaleModel;

/**
 * PHP: kioskReportPage()
 * Get kiosk sales report with pagination
 * @param {Object} value - { branchid, starting_date, ending_date, kiosk_method }
 * @param {Object} options - { page, limit }
 * @returns {Promise<Object>}
 */

/**
 * PHP: kioskSummaryReports()
 * Get kiosk sales summary with aggregation
 * @param {Object} value - { branchid, starting_date, ending_date, kiosk_method }
 * @returns {Promise<Object>}
 */

/**
 * PHP: kiosksGraphicalReportModel()
 * Get kiosk hourly payment chart data
 * @param {Object} value - { branchid, starting_date, ending_date, kiosk_method }
 * @returns {Promise<Object>}
 */

/**
 * PHP: kotDiscountReportPage($value, $options = [])
 * Get KOT discount reports - settled sales that originated from KOT with discounts
 *
 * @param {Object} data - Filter data with branchid array, starting_date, ending_date
 * @param {Object} options - Pagination options with limit and page
 * @returns {Promise<{status: boolean, total: number, list: Array, totals: Object}>}
 */

/**
 * PHP: kotTablewiseDetailsPage($value)
 * Get KOT table-wise detailed items report
 *
 * Returns one row per (sale, item) for the selected branch, date range
 * and optional list of table numbers.
 *
 * @param {Object} value - Filter data with branchid, starting_date, ending_date, tables[]
 * @returns {Promise<{status: boolean, data: Object, message: string}>}
 */
/**
 * PHP: updateOrderModel()
 * Update KOT order items and recalculate totals
 */
/**

/**
 * PHP: gstOneReportPage()
 * Generate GST-1 report with sales, returns, and product details
 */

/**
 * PHP: gstOneReportPageJson()
 * Generate GST-1 report in JSON format for GST portal
 */

/**
 * PHP: gstThreeReportPage()
 * Generate GST-3 report
 */

/**
 * Close sales payment
 * PHP: salesPaymentCloseModel()
 */

/**
 * PHP: sendDailySalesMail()
 * Send daily sales report email. Prefer Brevo when configured, otherwise
 * fall back to the generic email utility so the feature still works when
 * Sendinblue/Brevo is not set up.
 * @param {Object} input - { email, data: { product_details, payment_details, tax_details, branch_details, dine_details, table_summary, extra_discount } }
 * @returns {Promise<Object>}
 */
Sale.sendDailySalesMail = async function (input) {
  try {
    const { BrevoClient } = require('@getbrevo/brevo');
    const config = require('../config');

    // Currency sign (fallback)
    const currency = '₹'; // You can get this from settings if needed

    // Totals + product rows
    const product_values = [];
    let qty_total = 0;
    let price_total = 0; // subtotal sum
    let amount_total = 0; // grand total (incl tax)
    let profit_total = 0;
    let tax_total = 0;

    if (input.data?.product_details && Array.isArray(input.data.product_details)) {
      input.data.product_details.forEach((val, idx) => {
        const pQty = parseFloat(val.product_qty || 0);
        const pSubtotal = parseFloat(val.product_subtotal || 0);
        const pTotal = parseFloat(val.product_total || 0);
        const pProfit = parseFloat(val.product_profit || 0);
        const pTax = parseFloat(val.product_tax || 0);
        const pDiscount = parseFloat(val.product_discount || 0);

        qty_total += pQty;
        price_total += pSubtotal;
        amount_total += pTotal;
        profit_total += pProfit;
        tax_total += pTax;

        product_values[idx] = {
          product_name: val.product_name || '',
          product_sku: val.product_sku || '',
          product_qty: pQty,
          product_total: `${currency} ${pTotal.toFixed(2)}`,
          product_price: `${currency} ${pSubtotal.toFixed(2)}`,
          product_profit: `${currency} ${pProfit.toFixed(2)}`,
          product_discount: `-${currency} ${pDiscount.toFixed(2)}`,
          product_tax: `${currency} ${pTax.toFixed(2)}`,
        };
      });
    }

    // Payment rows + tender total
    const payment_values = [];
    let tender_total = 0;

    if (input.data?.payment_details && Array.isArray(input.data.payment_details)) {
      input.data.payment_details.forEach((c, i) => {
        const sale_payment = parseFloat(c.sale_payment || 0);
        tender_total += sale_payment;

        payment_values[i] = {
          payment_mode: c.payment_mode || '',
          sale_payment: `${currency} ${sale_payment.toFixed(2)}`,
        };
      });
    }

    // Taxes: use aggregated tax_details directly
    const taxValues = [];
    if (input.data?.tax_details && Array.isArray(input.data.tax_details)) {
      input.data.tax_details.forEach((row, j) => {
        const tax_name = row.tax_name || '';
        const total_tax = parseFloat(row.total_tax || 0);

        taxValues[j] = {
          tax_name: tax_name,
          amount: `${currency} ${total_tax.toFixed(2)}`,
        };
      });
    }

    // Table options flag
    const tableOptionsEnabled = false; // Set based on your settings

    // Dine Type (aggregated from API, with Pax)
    const dineValues = [];
    let dine_count_total = 0;
    let dine_amount_total = 0;
    let dine_pax_total = 0;

    if (tableOptionsEnabled && input.data?.dine_details && Array.isArray(input.data.dine_details)) {
      input.data.dine_details.forEach((drow, k) => {
        const dType = drow.dine_type || 'Unknown';
        const dCount = parseInt(drow.dine_count || 0);
        const dAmount = parseFloat(drow.dine_amount || 0);

        let rawPax = 0;
        if (drow.dine_pax !== undefined) {
          rawPax = parseFloat(drow.dine_pax);
        } else if (drow.pax !== undefined) {
          rawPax = parseFloat(drow.pax);
        } else if (drow.person_count !== undefined) {
          rawPax = parseFloat(drow.person_count);
        }

        const paxDisplay = rawPax > 0 ? rawPax : '';
        if (rawPax > 0) {
          dine_pax_total += rawPax;
        }

        dine_count_total += dCount;
        dine_amount_total += dAmount;

        dineValues[k] = {
          dine_type: dType,
          dine_count: dCount,
          dine_pax: paxDisplay,
          dine_amount: `${currency} ${dAmount.toFixed(2)}`,
        };
      });
    }

    // Table-wise summary
    const tableValues = [];
    let table_amount_total = 0;
    let table_pax_total = 0;

    if (
      tableOptionsEnabled &&
      input.data?.table_summary &&
      Array.isArray(input.data.table_summary)
    ) {
      input.data.table_summary.forEach((trow, idx) => {
        const tableNumber = trow.name || (trow.table_number ? String(trow.table_number) : '');
        if (!tableNumber) return;

        const tAmount = parseFloat(trow.total_amount || 0);
        const rawTablePax = parseFloat(trow.table_pax || 0);

        const tablePaxDisplay = rawTablePax > 0 ? rawTablePax : '';
        if (rawTablePax > 0) {
          table_pax_total += rawTablePax;
        }

        table_amount_total += tAmount;

        tableValues[idx] = {
          table_name: tableNumber,
          table_pax: tablePaxDisplay,
          table_amount: `${currency} ${tAmount.toFixed(2)}`,
        };
      });
    }

    // Branch details
    const branch = input.data?.branch_details || {};
    const from_date = branch.from_date || '';
    const to_date = branch.to_date || '';
    const sales_type = branch.sales_type || 'Daily';

    // Brevo / Sendinblue setup
    const apiKey =
      config.sendinblue_key || process.env.SENDINBLUE_KEY || process.env.BREVO_API_KEY || '';

    if (apiKey) {
      // Preferred path: use Brevo transactional template
      const client = new BrevoClient({ apiKey });

      const emailData = {
        to: [{ email: input.email || '' }],
        templateId: 6, // Brevo template ID
        params: {
          fromdate: from_date,
          todate: to_date,
          heading: (sales_type ? sales_type + ' ' : '') + 'sales report',

          qty_total: qty_total,
          price_total: `${currency} ${price_total.toFixed(2)}`,
          amount_total: `${currency} ${amount_total.toFixed(2)}`,
          profit_total: `${currency} ${profit_total.toFixed(2)}`,
          tender_total: `${currency} ${tender_total.toFixed(2)}`,
          tax_total: `${currency} ${tax_total.toFixed(2)}`,
          dine_count_total: dine_count_total,
          dine_amount_total: `${currency} ${dine_amount_total.toFixed(2)}`,
          dine_pax_total: dine_pax_total > 0 ? dine_pax_total : '',
          table_amount_total: `${currency} ${table_amount_total.toFixed(2)}`,
          table_pax_total: table_pax_total > 0 ? table_pax_total : '',

          store: branch,
          product: product_values,
          tax: taxValues,
          tender: payment_values,
          dine: dineValues,
          tables: tableValues,
          extra_discount: `${currency} ${parseFloat(
            input.data?.extra_discount?.total_sale_extra_discount || 0
          ).toFixed(2)}`,
        },
        headers: {
          'X-Mailin-custom': 'custom_header_1:custom_value_1|custom_header_2:custom_value_2',
        },
      };

      const result = await client.transactionalEmails.sendTransacEmail(emailData);
      return {
        status: true,
        data: result,
        message: 'Mail sent successfully',
      };
    }

    // Fallback: no Brevo key configured. Use the generic email helper which
    // itself falls back to a safe transport in development when SMTP is
    // missing, so we do not block the Quick Sale report feature.
    const subject = ((sales_type ? sales_type + ' ' : '') + 'sales report').trim();
    const messageLines = [
      `Sales report from ${from_date || '-'} to ${to_date || '-'}`,
      '',
      `Total quantity: ${qty_total}`,
      `Subtotal: ${currency} ${price_total.toFixed(2)}`,
      `Grand total: ${currency} ${amount_total.toFixed(2)}`,
      `Profit: ${currency} ${profit_total.toFixed(2)}`,
      `Tax total: ${currency} ${tax_total.toFixed(2)}`,
      `Tender total: ${currency} ${tender_total.toFixed(2)}`,
    ];

    await sendEmail({
      email: input.email,
      subject,
      message: messageLines.join('\n'),
    });

    return {
      status: true,
      data: null,
      message: 'Mail sent successfully',
    };
  } catch (error) {
    console.error('Error in sendDailySalesMail:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Mail failed',
    };
  }
};

/**
 * Generate Razorpay QR code for payment
 * @param {number} amount - Payment amount
 * @returns {Promise<Object>} Response with QR code data
 */
Sale.generateQrCodeModel = async function (amount) {
  try {
    const Razorpay = require('razorpay');
    const config = require('../config');
    const moment = require('moment-timezone');

    // Get payment gateway credentials from branch settings
    const branchId = BaseModel.currentBranch;
    const license = BaseModel.license;

    console.log('branchId:', branchId, 'type:', typeof branchId);
    console.log('license:', license, 'type:', typeof license);

    if (!branchId || !license) {
      throw new Error('Branch ID and license are required');
    }

    // Get branch settings to retrieve Razorpay credentials
    // Use raw collection because payment_gateway is stored as object but schema defines it as array
    const ObjectId = mongoose.Types.ObjectId;
    const queryId = branchId instanceof ObjectId ? branchId : new ObjectId(branchId);

    console.log('Querying branch with _id:', queryId);

    // Try 'branches' collection first (plural)
    let branchCollection = currentConnection(mongoose.connection).collection('branches');
    let branch = await branchCollection.findOne({ _id: queryId });

    // If not found, try 'branch' (singular)
    if (!branch) {
      console.log('Not found in branches, trying branch collection');
      branchCollection = currentConnection(mongoose.connection).collection('branch');
      branch = await branchCollection.findOne({ _id: queryId });
    }

    console.log('Branch found:', branch ? 'yes' : 'no');

    if (!branch) {
      throw new Error('Branch not found');
    }

    // Nothing about the gateway configuration is logged here, and that is
    // deliberate.
    //
    // This block used to dump `branch.payment_gateway` and `branch.settings`
    // whole, then print the Razorpay key id on its own line - while carefully
    // masking the secret two lines further down. The mask was pointless: the
    // object dumped above it contained the same secret in full. Every payment
    // wrote a live gateway credential into a log file that sits on a shop
    // counter and travels to us in support bundles.
    //
    // If this needs debugging again, log which source won - `payment_gateway`
    // or `settings` - and never the values.

    // payment_gateway can be an object, or might be in settings
    let paymentGatewayConfig = branch.payment_gateway || {};

    // If payment_gateway is empty array or object, check settings
    if (
      (!paymentGatewayConfig ||
        (Array.isArray(paymentGatewayConfig) && paymentGatewayConfig.length === 0) ||
        Object.keys(paymentGatewayConfig).length === 0) &&
      branch.settings?.payment_gateway
    ) {
      paymentGatewayConfig = branch.settings.payment_gateway;
    }
    /* Stored encrypted; decryptField passes through anything written before
       that change, so a shop configured on an older build still works. */
    const { decryptField } = require('../utils/secret-field');
    const paymentKey = decryptField(paymentGatewayConfig.key) || config.razorpay.keyId;
    const paymentSecret = decryptField(paymentGatewayConfig.secret) || config.razorpay.keySecret;

    if (!paymentKey || !paymentSecret) {
      throw new Error('Razorpay credentials not configured');
    }

    const api = new Razorpay({
      key_id: paymentKey,
      key_secret: paymentSecret,
    });

    // Calculate close_by timestamp (15 minutes from now)
    const timeZone = branch.time_zone || BaseModel.currentTimeZone || 'Asia/Kolkata';
    const now = moment().tz(timeZone);
    const closeBy = now.add(15, 'minutes').unix();

    // Create QR code
    const qrCodeResponse = await api.qrCode.create({
      type: 'upi_qr',
      name: 'Store Front Display',
      usage: 'single_use',
      fixed_amount: 1,
      payment_amount: parseFloat(amount) * 100, // Convert to paise
      description: 'For Store 1',
      close_by: closeBy,
      notes: { purpose: 'Test UPI QR code notes' },
    });

    // Store QR data in payment collection
    const Payment = currentConnection(mongoose.connection).collection('payment');
    const qrData = {
      id: qrCodeResponse.id,
      entity: qrCodeResponse.entity,
      created_at: qrCodeResponse.created_at,
      name: qrCodeResponse.name,
      usage: qrCodeResponse.usage,
      type: qrCodeResponse.type,
      image_url: qrCodeResponse.image_url,
      payment_amount: qrCodeResponse.payment_amount,
      status: qrCodeResponse.status,
      description: qrCodeResponse.description,
      fixed_amount: qrCodeResponse.fixed_amount,
      payments_amount_received: qrCodeResponse.payments_amount_received,
      payments_count_received: qrCodeResponse.payments_count_received,
      notes: qrCodeResponse.notes,
      customer_id: qrCodeResponse.customer_id,
      close_by: qrCodeResponse.close_by,
      payment_status: 'active',
      branch_id: branchId,
      license: license,
    };

    await Payment.insertOne(qrData);

    const responseData = {
      id: qrCodeResponse.id,
      image_url: qrCodeResponse.image_url,
    };

    return {
      status: true,
      data: responseData,
      message: 'QR Code Generate successfully',
    };
  } catch (error) {
    console.error('Error in generateQrCodeModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to generate QR code',
    };
  }
};

const resolveKioskBranch = async (branchId) => {
  if (!branchId) return null;
  const ObjectId = mongoose.Types.ObjectId;
  const queryId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : null;
  const collections = ['branches', 'branch'];

  for (const name of collections) {
    const collection = currentConnection(mongoose.connection).collection(name);
    const query = queryId
      ? { $or: [{ 'kiosk.store_id': branchId }, { _id: queryId }] }
      : { 'kiosk.store_id': branchId };
    const branch = await collection.findOne(query);
    if (branch) return branch;
  }

  return null;
};

const withBranchContext = async (branch, handler) => {
  const previous = {
    currentBranch: BaseModel.currentBranch,
    license: BaseModel.license,
    currentTimeZone: BaseModel.currentTimeZone,
  };

  BaseModel.currentBranch = branch?._id || previous.currentBranch;
  BaseModel.license = branch?.license || previous.license;
  if (branch?.time_zone) {
    BaseModel.currentTimeZone = branch.time_zone;
  }

  try {
    return await handler();
  } finally {
    BaseModel.currentBranch = previous.currentBranch;
    BaseModel.license = previous.license;
    BaseModel.currentTimeZone = previous.currentTimeZone;
  }
};

Sale.generateRazorPayQrCodekioskModel = async function (data = {}) {
  try {
    const branch = await resolveKioskBranch(data.branchId);
    if (!branch) {
      return { status: false, data: null, message: 'Branch not found' };
    }

    return await withBranchContext(branch, () => Sale.generateQrCodeModel(data.amount));
  } catch (error) {
    console.error('Error in generateRazorPayQrCodekioskModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to generate QR code',
    };
  }
};

Sale.getRazorPayQrStatusModel = async function (data = {}) {
  try {
    const branch = await resolveKioskBranch(data.branchId);
    if (!branch) {
      return { status: false, data: null, message: 'Branch not found' };
    }
    if (!data.qr_code_id) {
      return { status: false, data: null, message: 'QR code ID is required' };
    }

    return await withBranchContext(branch, () => Sale.getQrStatusModel(data.qr_code_id));
  } catch (error) {
    console.error('Error in getRazorPayQrStatusModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to get QR status',
    };
  }
};

Sale.razorPayQrCodeCloseModel = async function (data = {}) {
  try {
    const branch = await resolveKioskBranch(data.branchId);
    if (!branch) {
      return { status: false, data: null, message: 'Branch not found' };
    }
    if (!data.qr_code_id) {
      return { status: false, data: null, message: 'QR code ID is required' };
    }

    return await withBranchContext(branch, () => Sale.qrCodeCloseModel(data.qr_code_id));
  } catch (error) {
    console.error('Error in razorPayQrCodeCloseModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to close QR code',
    };
  }
};

/**
 * Close Razorpay QR code
 * @param {string} id - QR code ID
 * @returns {Promise<Object>} Response with close status
 */
Sale.qrCodeCloseModel = async function (id) {
  try {
    const Razorpay = require('razorpay');
    const config = require('../config');

    // Get payment gateway credentials from branch settings
    const branchId = BaseModel.currentBranch;
    const license = BaseModel.license;

    if (!branchId || !license) {
      throw new Error('Branch ID and license are required');
    }

    // Get branch settings to retrieve Razorpay credentials
    let branchCollection = currentConnection(mongoose.connection).collection('branches');
    const ObjectId = mongoose.Types.ObjectId;
    const queryId = branchId instanceof ObjectId ? branchId : new ObjectId(branchId);

    let branch = await branchCollection.findOne({ _id: queryId });

    if (!branch) {
      branchCollection = currentConnection(mongoose.connection).collection('branch');
      branch = await branchCollection.findOne({ _id: queryId });
    }

    if (!branch) {
      throw new Error('Branch not found');
    }

    // Get payment gateway config
    let paymentGatewayConfig = branch.payment_gateway || {};
    if (
      (!paymentGatewayConfig ||
        (Array.isArray(paymentGatewayConfig) && paymentGatewayConfig.length === 0) ||
        Object.keys(paymentGatewayConfig).length === 0) &&
      branch.settings?.payment_gateway
    ) {
      paymentGatewayConfig = branch.settings.payment_gateway;
    }

    /* Stored encrypted; decryptField passes through anything written before
       that change, so a shop configured on an older build still works. */
    const { decryptField } = require('../utils/secret-field');
    const paymentKey = decryptField(paymentGatewayConfig.key) || config.razorpay.keyId;
    const paymentSecret = decryptField(paymentGatewayConfig.secret) || config.razorpay.keySecret;

    if (!paymentKey || !paymentSecret) {
      throw new Error('Razorpay credentials not configured');
    }

    const api = new Razorpay({
      key_id: paymentKey,
      key_secret: paymentSecret,
    });

    // Close the QR code using Razorpay API
    // The close method is available on the fetched QR code object
    const qrCodeInstance = await api.qrCode.fetch(id);

    // Make a PATCH request to close the QR code
    const axios = require('axios');
    const auth = Buffer.from(`${paymentKey}:${paymentSecret}`).toString('base64');

    await axios({
      method: 'POST',
      url: `https://api.razorpay.com/v1/payments/qr_codes/${id}/close`,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    return {
      status: true,
      data: 'ok',
      message: 'QR code closed successfully',
    };
  } catch (error) {
    console.error('Error in qrCodeCloseModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to close QR code',
    };
  }
};

/**
 * Get QR code payment status from webhook
 * @param {string} id - QR code ID
 * @returns {Promise<Object>} Response with payment status
 */
Sale.getQrStatusModel = async function (id) {
  try {
    const RazorpayWebhook = currentConnection(mongoose.connection).collection('razorpay_webhook');

    const responseData = await RazorpayWebhook.findOne(
      { 'payload.qr_code.entity.id': id },
      { sort: { _id: -1 } }
    );

    const Payment = currentConnection(mongoose.connection).collection('payment');
    const paymentDoc = await Payment.findOne({ id });
    const paymentTransactionId = paymentDoc?._id?.toString() || null;

    // If webhook data exists, return it
    if (responseData) {
      // Check for payment data (may not exist in QR-only webhooks)
      const paymentEntity = responseData.payload?.payment?.entity || null;
      const paymentStatus = paymentEntity?.status || null;
      const transactionId = paymentTransactionId || responseData._id?.toString() || null;
      const items = paymentEntity
        ? [paymentEntity]
        : paymentStatus
          ? [{ status: paymentStatus }]
          : [];

      const status = {
        id: transactionId,
        transactionId,
        items,
        payment_status: paymentStatus,
        qr_status: responseData.payload?.qr_code?.entity?.status || null,
        event: responseData.event || null,
      };

      return {
        status: true,
        data: status,
        message: 'QR status retrieved successfully',
      };
    }

    // If no webhook data, fetch directly from Razorpay API
    const Razorpay = require('razorpay');
    const config = require('../config');

    // Get payment gateway credentials from branch settings
    const branchId = BaseModel.currentBranch;
    const license = BaseModel.license;

    if (!branchId || !license) {
      return {
        status: false,
        data: null,
        message: 'No webhook data found for this QR code',
      };
    }

    // Get branch settings to retrieve Razorpay credentials
    let branchCollection = currentConnection(mongoose.connection).collection('branches');
    const ObjectId = mongoose.Types.ObjectId;
    const queryId = branchId instanceof ObjectId ? branchId : new ObjectId(branchId);

    let branch = await branchCollection.findOne({ _id: queryId });

    if (!branch) {
      branchCollection = currentConnection(mongoose.connection).collection('branch');
      branch = await branchCollection.findOne({ _id: queryId });
    }

    if (!branch) {
      return {
        status: false,
        data: null,
        message: 'No webhook data found for this QR code',
      };
    }

    // Get payment gateway config
    let paymentGatewayConfig = branch.payment_gateway || {};
    if (
      (!paymentGatewayConfig ||
        (Array.isArray(paymentGatewayConfig) && paymentGatewayConfig.length === 0) ||
        Object.keys(paymentGatewayConfig).length === 0) &&
      branch.settings?.payment_gateway
    ) {
      paymentGatewayConfig = branch.settings.payment_gateway;
    }

    /* Stored encrypted; decryptField passes through anything written before
       that change, so a shop configured on an older build still works. */
    const { decryptField } = require('../utils/secret-field');
    const paymentKey = decryptField(paymentGatewayConfig.key) || config.razorpay.keyId;
    const paymentSecret = decryptField(paymentGatewayConfig.secret) || config.razorpay.keySecret;

    if (!paymentKey || !paymentSecret) {
      return {
        status: false,
        data: null,
        message: 'No webhook data found for this QR code',
      };
    }

    const api = new Razorpay({
      key_id: paymentKey,
      key_secret: paymentSecret,
    });

    // Fetch QR code details from Razorpay
    const qrCode = await api.qrCode.fetch(id);

    const paymentStatus = qrCode.payments_count_received > 0 ? 'captured' : null;
    const status = {
      id: qrCode.id,
      transactionId: paymentTransactionId,
      items: paymentStatus ? [{ status: paymentStatus }] : [],
      payment_status: paymentStatus,
      qr_status: qrCode.status,
      event: null,
      payments_amount_received: qrCode.payments_amount_received,
      payments_count_received: qrCode.payments_count_received,
    };

    return {
      status: true,
      data: status,
      message: 'QR status retrieved successfully',
    };
  } catch (error) {
    console.error('Error in getQrStatusModel:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to get QR status',
    };
  }
};

/**
 * PHP: kioskOrderModel($data)
 * Process a kiosk order — calculate item totals, generate sales_id,
 * find/create customer, insert sale document, return receipt data.
 * Ported from Api/src/model/sales_model.php lines 8297-8764.
 */
Sale.kioskOrderModel = async function (data) {
  try {
    const ObjectId = mongoose.Types.ObjectId;
    const branchCollection = currentConnection(mongoose.connection).collection('branches');
    const branchDoc = await branchCollection.findOne({
      'kiosk.store_id': data.branch,
    });
    if (!branchDoc) {
      return { status: false, data: null, message: 'Branch not found' };
    }

    const items = data.items;
    const itemResponse = [];
    const itemsale = [];
    const total_data = [];
    const total_company_data = [];
    const discount_data = [];
    const tax_data = [];
    const subtotal_data = [];

    const itemCollection = currentConnection(mongoose.connection).collection('items');

    for (const item of items) {
      let itemSubTaxTotalCalculation = 0.0;
      let itemDiscountAmountMultiple = 0.0;
      let itemDiscountPercentageMultiple = 0.0;
      const itemQuantity = parseFloat(item.item_quantity);

      const doc = await itemCollection.findOne({
        _id: new ObjectId(item.item_id),
        license: branchDoc.license,
      });
      if (!doc) {
        return {
          status: false,
          data: null,
          message: 'This product has already been removed, so you can not modify anything.',
        };
      }

      const discountAmount = parseFloat(doc.discount_amount) || 0;
      const discountPercentage = parseFloat(doc.discount_percentage) || 0;
      const sellingPrice = parseFloat(doc.selling_price) || 0;
      const itemAmount = sellingPrice * itemQuantity;
      const companyPrice = itemQuantity * (parseFloat(doc.company_price) || 0);
      total_company_data.push({ company_amount: companyPrice });

      const itemTax = parseFloat(doc.tax) || 0;
      let itemDiscountAmountTotalCalculation = 0;

      if (discountAmount > 0 && itemTax > 0) {
        itemDiscountAmountMultiple = discountAmount * itemQuantity;
        const subTotal = itemAmount - itemDiscountAmountMultiple;
        if (doc.tax_type === 'exclusive') {
          itemSubTaxTotalCalculation = (subTotal / 100) * itemTax;
          itemDiscountAmountTotalCalculation = subTotal + itemSubTaxTotalCalculation;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: itemDiscountAmountMultiple });
          subtotal_data.push({
            subtotal_amount: subTotal + itemDiscountAmountMultiple,
          });
        } else {
          const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
          const tax_itemprice = sellingPrice - tax_price;
          const tax_discount_multiple = tax_itemprice * itemQuantity;
          const tax_quantity_multiple = tax_discount_multiple - itemDiscountAmountMultiple;
          itemDiscountAmountTotalCalculation =
            tax_quantity_multiple + (tax_quantity_multiple / 100) * itemTax;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          const incSubTotal = tax_quantity_multiple;
          itemSubTaxTotalCalculation = (incSubTotal / 100) * itemTax;
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: itemDiscountAmountMultiple });
          subtotal_data.push({
            subtotal_amount: incSubTotal + itemDiscountAmountMultiple,
          });
        }
        itemDiscountPercentageMultiple = 0.0;
      } else if (discountPercentage > 0 && itemTax > 0) {
        itemDiscountPercentageMultiple = discountPercentage;
        const itemTaxTotalCalculation =
          itemAmount - (itemAmount * itemDiscountPercentageMultiple) / 100;
        if (doc.tax_type === 'exclusive') {
          itemDiscountAmountTotalCalculation =
            itemTaxTotalCalculation + (itemTaxTotalCalculation / 100) * itemTax;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          itemSubTaxTotalCalculation = (itemTaxTotalCalculation / 100) * itemTax;
          itemDiscountAmountMultiple = (itemAmount * itemDiscountPercentageMultiple) / 100;
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: itemDiscountAmountMultiple });
          subtotal_data.push({
            subtotal_amount: itemTaxTotalCalculation + itemDiscountAmountMultiple,
          });
        } else {
          itemDiscountAmountTotalCalculation = itemTaxTotalCalculation;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
          const tax_itemprice = sellingPrice - tax_price;
          const tax_discount_multiple = tax_itemprice * itemQuantity;
          itemDiscountAmountMultiple =
            (tax_discount_multiple * itemDiscountPercentageMultiple) / 100;
          const tax_quantity_multiple = tax_discount_multiple - itemDiscountAmountMultiple;
          itemSubTaxTotalCalculation = (tax_quantity_multiple / 100) * itemTax;
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: itemDiscountAmountMultiple });
          subtotal_data.push({
            subtotal_amount: tax_quantity_multiple + itemDiscountAmountMultiple,
          });
        }
        itemDiscountAmountMultiple = 0;
      } else if (itemTax > 0) {
        if (doc.tax_type === 'exclusive') {
          itemDiscountAmountTotalCalculation = itemAmount + (itemAmount / 100) * itemTax;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          itemSubTaxTotalCalculation = (itemAmount / 100) * itemTax;
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: 0.0 });
          subtotal_data.push({
            subtotal_amount: itemAmount,
          });
        } else {
          itemDiscountAmountTotalCalculation = itemAmount;
          total_data.push({
            totalsales_Amount: itemDiscountAmountTotalCalculation,
          });
          const tax_price = (sellingPrice * itemTax) / (100 + itemTax);
          const tax_itemprice = sellingPrice - tax_price;
          const tax_discount_multiple = tax_itemprice * itemQuantity;
          const tax_quantity_multiple = tax_discount_multiple;
          itemSubTaxTotalCalculation = (tax_quantity_multiple / 100) * itemTax;
          tax_data.push({ tax_amount: itemSubTaxTotalCalculation });
          discount_data.push({ discount_amount: 0.0 });
          subtotal_data.push({ subtotal_amount: tax_quantity_multiple });
        }
      } else if (discountAmount > 0) {
        itemDiscountAmountMultiple = discountAmount * itemQuantity;
        const itemTaxTotalCalc = itemAmount - itemDiscountAmountMultiple;
        itemDiscountAmountTotalCalculation = itemTaxTotalCalc;
        total_data.push({
          totalsales_Amount: itemDiscountAmountTotalCalculation,
        });
        itemDiscountPercentageMultiple = 0.0;
        tax_data.push({ tax_amount: 0.0 });
        discount_data.push({ discount_amount: itemDiscountAmountMultiple });
        subtotal_data.push({ subtotal_amount: itemAmount });
      } else if (discountPercentage > 0) {
        itemDiscountPercentageMultiple = discountPercentage;
        const itemTaxTotalCalc = itemAmount - (itemAmount * itemDiscountPercentageMultiple) / 100;
        itemDiscountAmountTotalCalculation = itemTaxTotalCalc;
        total_data.push({
          totalsales_Amount: itemDiscountAmountTotalCalculation,
        });
        itemDiscountAmountMultiple = 0;
        tax_data.push({ tax_amount: 0.0 });
        discount_data.push({
          discount_amount: (itemAmount * itemDiscountPercentageMultiple) / 100,
        });
        subtotal_data.push({ subtotal_amount: itemAmount });
      } else {
        itemDiscountAmountMultiple = 0;
        itemDiscountPercentageMultiple = 0.0;
        itemDiscountAmountTotalCalculation = itemAmount;
        total_data.push({ totalsales_Amount: itemAmount });
        tax_data.push({ tax_amount: 0.0 });
        discount_data.push({ discount_amount: 0.0 });
        subtotal_data.push({ subtotal_amount: itemAmount });
      }

      // Running totals
      const sale_tot_amount = total_data.reduce((s, i) => s + i.totalsales_Amount, 0);
      const sale_subtotal_amount = subtotal_data.reduce((s, i) => s + i.subtotal_amount, 0);
      const sale_discount_amount = discount_data.reduce((s, i) => s + i.discount_amount, 0);
      const sale_tax_amount = tax_data.reduce((s, i) => s + i.tax_amount, 0);
      const sale_company_amount = total_company_data.reduce((s, i) => s + i.company_amount, 0);

      const availableQty = parseFloat(doc.available_quantity) || 0;
      const igst_value = 0.0;
      let csgst_value = (parseFloat(item.gst) || 0) / 2;
      if (branchDoc.indian_gst === 'gst_on') {
        csgst_value = (parseFloat(item.gst) || 0) / 2;
      }

      // Base price for inclusive tax
      let basePrice = sellingPrice;
      if (doc.tax_type === 'inclusive' && itemTax > 0) {
        basePrice = (sellingPrice * 100) / (100 + itemTax);
      }

      let discount_percentage_value = 0.0;
      if (discountPercentage > 0) {
        discount_percentage_value = (basePrice * discountPercentage) / 100;
      }

      itemResponse.push({
        item_name: doc.name,
        item_quantity: parseFloat(item.item_quantity),
        item_price: basePrice * parseFloat(item.item_quantity),
        item_base_price: basePrice,
        item_discount: discountAmount * parseFloat(item.item_quantity),
        item_discount_percentage: discount_percentage_value * parseFloat(item.item_quantity),
        item_tax: parseFloat(itemSubTaxTotalCalculation),
        item_total: parseFloat(itemDiscountAmountTotalCalculation),
        total_amount: parseFloat(itemDiscountAmountTotalCalculation),
        tax_type: doc.tax_type,
      });

      itemsale.push({
        sale_inline_item_price: sellingPrice,
        sale_inline_discount_value: discountAmount,
        sale_inline_discount_pervalue: discountPercentage,
        item_status: 'Add',
        return: false,
        item_name: doc.name,
        item_sku: doc.itemid,
        item_price: sellingPrice,
        item_discount: parseFloat(discountAmount),
        item_discount_percentage: parseInt(discountPercentage),
        item_quantity: parseFloat(item.item_quantity),
        item_available_quantity: parseFloat(availableQty),
        item_id: item.item_id || '',
        item_unit: doc.item_unit || 'qty',
        total_amount: parseFloat(itemDiscountAmountTotalCalculation),
        barcode_id: doc.barcode_id,
        company_price_total: parseFloat(companyPrice),
        category_id: doc.category_id,
        category_name: doc.category_name,
        supplier_id: doc.supplier_id,
        supplier_name: doc.supplier_name,
        tax: parseFloat(doc.tax) || 0,
        tax_type: doc.tax_type,
        igst_tax: parseFloat(igst_value),
        cgst_tax: parseFloat(csgst_value),
        sgst_tax: parseFloat(csgst_value),
        tax_name: doc.tax_name,
        tax_amount: parseFloat(item.gst) || 0,
        tax_fields: doc.tax_fields,
        track_inventory: doc.track_inventory,
        negative_stock: doc.negative_stock ?? false,
      });
    }

    // Final totals after all items
    const sale_tot_amount_final = total_data.reduce((s, i) => s + i.totalsales_Amount, 0);
    const sale_subtotal_amount = subtotal_data.reduce((s, i) => s + i.subtotal_amount, 0);
    const sale_discount_amount = discount_data.reduce((s, i) => s + i.discount_amount, 0);
    const sale_tax_amount = tax_data.reduce((s, i) => s + i.tax_amount, 0);
    const sale_company_amount = total_company_data.reduce((s, i) => s + i.company_amount, 0);

    // Generate date
    const now = new Date();
    const mongoDate = now;

    // Generate sales_id
    const saleCollection = currentConnection(mongoose.connection).collection('sales');
    const lastRecord = await saleCollection.findOne(
      { branch_id: branchDoc._id, license: branchDoc.license },
      { sort: { _id: -1 }, limit: 1 }
    );

    const prefixValue = branchDoc.sales_prefix || 'INV';
    let incrementVal = '000001';
    if (lastRecord && lastRecord.sales_id) {
      const subStringValue = lastRecord.sales_id.substring(3);
      const countValue = parseInt(subStringValue, 10) + 1;
      incrementVal = String(countValue).padStart(6, '0');
    }
    const prefixId = prefixValue + incrementVal;

    const insertData = {
      branch_id: branchDoc._id,
      branch_name: branchDoc.branch_name,
      printing_address: (branchDoc.printing_address || '').trim(),
      sales_id: prefixId,
      wallet_amount: 0.0,
      created_date: mongoDate,
      created_by: branchDoc.created_by,
      created_by_id: branchDoc.created_by_id,
      license: branchDoc.license,
    };

    const extraDiscount = 0.0;
    const salesExtraDiscount = extraDiscount;
    const itemsTotAmount = sale_tot_amount_final - extraDiscount;
    const roundOffValue =
      branchDoc.roundOff === true ? Math.round(itemsTotAmount) - itemsTotAmount : 0;
    const saleTotAmount = branchDoc.roundOff === true ? Math.round(itemsTotAmount) : itemsTotAmount;
    const partialCheck = false;
    const partialBalance = saleTotAmount;
    const paymentStatus = 'Paid';
    const paymentPending = 0.0;

    // Find or create customer
    const mobile = data.customerMobile || '';
    const last10 = mobile.replace(/\D/g, '').slice(-10);
    const customerCollection = currentConnection(mongoose.connection).collection('customers');
    let customerDetails = null;
    if (last10) {
      customerDetails = await customerCollection.findOne({
        phone: { $regex: new RegExp('^(\\+91)?' + last10 + '$') },
        license: branchDoc.license,
        branch_id: branchDoc._id,
      });
    }

    const customerCategoryId = customerDetails?.category_id || '';
    const customerCategoryName = customerDetails?.category_name || '';
    const customerReferrerId = customerDetails?.referrer_id || '';
    const customerReferrerName = customerDetails?.referrer_name || '';
    const customer_name = customerDetails?.name || 'Kiosk customer';
    const customer_address = customerDetails?.address || '';
    const customer_phone = customerDetails?.phone || data.customerMobile || '';
    const customer_email = customerDetails?.email || '';
    const customer_city = customerDetails?.city || branchDoc.city || '';
    const customer_state = customerDetails?.state || branchDoc.state || '';
    const customer_country = customerDetails?.country || branchDoc.country || '';
    const country_sort = branchDoc.sortname || 'IN';
    const customer_gst_type = customerDetails?.gst_type || 'consumer';
    const customer_gst_number = customerDetails?.gst_number || '';
    const customer_gst = branchDoc.indian_gst === 'gst_on' ? 'enable' : 'disable';

    let customer_id;
    if (!customerDetails) {
      const insertResult = await customerCollection.insertOne({
        branch_id: branchDoc._id,
        branch_name: branchDoc.branch_name,
        created_date: mongoDate,
        created_by: branchDoc.created_by,
        created_by_id: branchDoc.created_by_id,
        name: customer_name,
        date: mongoDate,
        email: customer_email,
        phone: customer_phone,
        address: customer_address,
        country: customer_country,
        city: customer_city,
        category_id: customerCategoryId,
        category_name: customerCategoryName,
        referrer_id: customerReferrerId,
        referrer_name: customerReferrerName,
        state: customer_state,
        partial_balance: false,
        gst_type: customer_gst_type,
        gst_number: customer_gst_number,
        gst: customer_gst,
        updated_date: mongoDate,
        updated_by: branchDoc.updated_by,
        updated_by_id: branchDoc.updated_by_id,
        license: branchDoc.license,
      });
      customer_id = insertResult.insertedId;
    } else {
      customer_id = customerDetails._id;
    }

    const updateData = {
      date: mongoDate,
      sale_process: 'Add',
      user_id: branchDoc.kiosk && branchDoc.kiosk[0] ? branchDoc.kiosk[0].user_id || null : null,
      user_name:
        branchDoc.kiosk && branchDoc.kiosk[0] ? branchDoc.kiosk[0].user_name || null : null,
      category_id: customerCategoryId,
      category_name: customerCategoryName,
      referrer_id: customerReferrerId,
      referrer_name: customerReferrerName,
      customer_id: customer_id,
      customer_name: customer_name,
      customer_address: customer_address,
      customer_phone: customer_phone,
      customer_email: customer_email,
      customer_state: customer_state,
      customer_country: customer_country,
      country_sort: country_sort,
      customer_gst_type: customer_gst_type,
      customer_gst_number: customer_gst_number,
      partial_check: partialCheck,
      partial_balance: partialBalance,
      payment_status: paymentStatus,
      payment_pending: paymentPending,
      payment_mode: data.payment_status,
      sale_method: data.sale_method,
      sales_description: '',
      payment_description: '',
      sales_total: Math.round(saleTotAmount * 100) / 100,
      sales_round_off: Math.round(roundOffValue * 100) / 100,
      round_off: Math.round(roundOffValue * 100) / 100,
      sales_sub_total: parseFloat(sale_subtotal_amount),
      items_total:
        branchDoc.roundOff === true
          ? Math.round(itemsTotAmount)
          : Math.round(itemsTotAmount * 100) / 100,
      items_return_total: 0.0,
      return_round_off: 0.0,
      items_subtotal: parseFloat(sale_subtotal_amount),
      items_return_subtotal: 0.0,
      total_companyprice: parseFloat(sale_company_amount),
      tax: parseFloat(sale_tax_amount),
      gst: customer_gst,
      return_tax: 0.0,
      discount: parseFloat(sale_discount_amount),
      return_discount: 0.0,
      updated_date: mongoDate,
      updated_by: branchDoc.updated_by,
      updated_by_id: branchDoc.updated_by_id,
      number_of_items: itemsale.length,
      items: itemsale,
      items_return: [],
      cashregister_id: '',
      sale_extra_discount: Math.round(Math.abs(salesExtraDiscount) * 100) / 100,
      extra_discount_type: '',
      extra_discount: 0.0,
      return_extra_discount: 0.0,
      transaction_id: data.transactionId ? new ObjectId(data.transactionId) : null,
      token_id: data.tokenId,
      order: data.order,
    };

    const saleCollectionData = { ...insertData, ...updateData };
    const insertOneResult = await saleCollection.insertOne(saleCollectionData);

    const saleAddData = {
      sales_id: insertOneResult.insertedId.toString(),
      branch_name: branchDoc.branch_name,
      items: itemResponse,
      subtotal: parseFloat(sale_subtotal_amount),
      discount: parseFloat(sale_discount_amount),
      tax: parseFloat(sale_tax_amount),
      total: parseFloat(itemsTotAmount),
      tokenId: data.tokenId,
      payment_mode: data.payment_status,
    };

    return {
      status: true,
      data: saleAddData,
      message: 'Sale added successfully',
    };
  } catch (error) {
    console.error('Error in kioskOrderModel:', error);
    return { status: false, data: null, message: error.message };
  }
};

module.exports = Sale;
