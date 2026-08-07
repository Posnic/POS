// src/models/receiving_model.js
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
// Use ApiV2 model filenames; BaseModel here refers to the legacy static
// context helper (currentBranch, license, etc.), not the simple
// BaseModel wrapper in base.model.js.
const BaseModel = require('./base.model');
const { BranchModel: Branch } = require('./branch.model');
const { toJSON, paginate } = require('./plugins');
const { formatDate } = require('../utils/helpers');

const roundToTwo = (value = 0) => {
  const number = Number(value) || 0;
  return Math.round(number * 100) / 100;
};

// Ensure Supplier schema is registered for Mongoose population and
// post-save hooks that reference mongoose.model("Supplier"). The import is
// for side effects only.
require('./supplier.model');

const receivingItemSchema = new mongoose.Schema({
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
  },
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
  cost_price: {
    type: Number,
    required: true,
    min: 0,
  },
  selling_price: {
    type: Number,
    required: true,
    min: 0,
  },
  total: {
    type: Number,
    required: true,
    min: 0,
  },
});

const receivingSchema = new mongoose.Schema(
  {
    // PHP model exposes both an internal Mongo _id and a human-friendly
    // receiving_id that uses the branch's receiving_prefix (RID) plus a
    // zero‑padded increment. We keep both receiving_id and receiving_number
    // for compatibility, treating receiving_number as an alias.
    receiving_id: {
      type: String,
      unique: true,
    },
    receiving_number: {
      type: String,
      unique: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
    },
    items: [receivingItemSchema],
    // Attachments for supplier bills / receipts, stored as simple
    // name/size objects so the frontend can render and download them.
    image: [
      {
        name: { type: String },
        size: { type: Number },
      },
    ],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    receiving_status: {
      type: String,
      default: 'Open',
    },
    status: {
      type: String,
      enum: ['draft', 'received', 'cancelled'],
      default: 'draft',
    },
    payment_status: {
      type: String,
      enum: ['pending', 'partial', 'paid'],
      default: 'pending',
    },
    payment_method: {
      type: String,
      enum: ['cash', 'credit', 'bank_transfer', 'cheque', 'other'],
      default: 'cash',
    },
    payment_due_date: Date,
    notes: String,
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    // Allow legacy PHP fields (items_return, items_return_total, etc.) to be
    // stored and returned without being defined explicitly in the schema.
    // This keeps view/print compatibility with existing data.
    strict: false,
  }
);

// Add plugins
receivingSchema.plugin(toJSON);
receivingSchema.plugin(paginate);

// Generate receiving_id / receiving_number *before* validation so we mirror
// the PHP behaviour:
//   - Use branch.receiving_prefix (default "RID")
//   - Take the last receiving_id for that branch, strip first 3 chars, then
//     increment and zero‑pad to 6 digits.
//
// We rely on BaseModel.currentBranch / BaseModel.license being wired by the
// controller layer (similar to other models that use plan/branch context).
receivingSchema.pre('validate', async function () {
  // Only assign on first creation; edits keep their existing identifiers.
  if (!this.isNew && (this.receiving_id || this.receiving_number)) {
    return;
  }

  const branchId = BaseModel.currentBranch || this.branch_id;
  const licenseId = BaseModel.license || this.license_id;

  // Fallback prefix when branch/settings are not yet wired
  let prefix = 'RID';

  if (branchId) {
    try {
      const branchDoc = await Branch.findOne({ _id: branchId }).lean();
      if (branchDoc && typeof branchDoc.receiving_prefix === 'string') {
        const trimmed = branchDoc.receiving_prefix.trim();
        if (trimmed.length > 0) {
          prefix = trimmed;
        }
      }
    } catch (e) {
      // Non‑fatal: we still fall back to RID
    }
  }

  // Find the last receiving for this branch/license to compute the next
  // sequence value, just like PHP receiving_model::receivingInsertUpdate.
  const match = {};
  if (branchId) {
    match.branch_id = branchId;
  }
  if (licenseId) {
    match.license = licenseId;
  }

  const lastDoc = await this.constructor.find(match).sort({ _id: -1 }).limit(1).lean();

  let increment = '000001';
  if (Array.isArray(lastDoc) && lastDoc.length && lastDoc[0].receiving_id) {
    const lastId = String(lastDoc[0].receiving_id);
    const numericPart = lastId.slice(3); // strip prefix (RID)
    const n = parseInt(numericPart, 10);
    if (!Number.isNaN(n)) {
      increment = String(n + 1).padStart(6, '0');
    }
  }

  const humanId = `${prefix}${increment}`;

  this.receiving_id = this.receiving_id || humanId;
  this.receiving_number = this.receiving_number || humanId;

  // Keep receiving_status roughly aligned with internal enum status so
  // newly created documents behave like PHP ones.
  if (!this.receiving_status) {
    if (this.status === 'received') {
      this.receiving_status = 'Received';
    } else if (this.status === 'cancelled') {
      this.receiving_status = 'Cancelled';
    } else {
      this.receiving_status = 'Open';
    }
  }

  return;
});

// Update inventory and supplier balance
receivingSchema.post('save', async function (doc) {
  if (doc.status === 'received') {
    const Item = mongoose.model('Item');
    const Supplier = mongoose.model('Supplier');

    // Update item quantities
    for (const item of doc.items) {
      await Item.findByIdAndUpdate(item.item, {
        $inc: { quantity: item.quantity },
        $set: {
          cost_price: item.cost_price,
          selling_price: item.selling_price,
        },
      });
    }

    // Update supplier balance if not paid
    if (doc.payment_status !== 'paid') {
      await Supplier.findByIdAndUpdate(doc.supplier, {
        $inc: { balance: doc.total },
      });
    }
  }
});

// Static method for pending receiving report page (ported from PHP)
receivingSchema.statics.pendingReceivingReportPage = async function (data, options = {}) {
  try {
    const mongoose = require('mongoose');

    // Parse dates - similar to PHP startingDate and endingDate methods
    let fromDate = new Date(0);
    let toDate = new Date();

    if (data.starting_date) {
      fromDate = new Date(data.starting_date);
      if (isNaN(fromDate.getTime())) fromDate = new Date(0);
    }

    if (data.ending_date) {
      toDate = new Date(data.ending_date);
      if (isNaN(toDate.getTime())) toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else {
      toDate.setHours(23, 59, 59, 999);
    }

    // Convert branch IDs to ObjectIds
    const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
    const objectBranchIds = branchIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    // Build filters for pending payments (payment_status != "paid")
    const filters = {
      $and: [
        { branch_id: { $in: objectBranchIds } },
        { payment_status: { $ne: 'paid' } },
        { created_date: { $gte: fromDate, $lte: toDate } },
      ],
    };

    // Calculate pagination
    const limit = parseInt(options.limit) || 5;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;

    // Aggregate pipeline similar to PHP implementation
    const pipeline = [
      { $match: filters },
      {
        $group: {
          _id: {
            id: '$_id',
            date: '$created_date',
            receiving_number: '$receiving_number',
            supplier_name: '$supplier_name',
          },
          total_amount: { $sum: '$total' },
          paid_amount: { $sum: '$paid_amount' },
          balance: { $sum: '$balance' },
          count: { $sum: 1 },
        },
      },
      { $sort: { balance: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const results = await this.aggregate(pipeline);

    // Get total count for pagination
    const countPipeline = [
      { $match: filters },
      {
        $group: {
          _id: {
            id: '$_id',
            date: '$created_date',
            receiving_number: '$receiving_number',
            supplier_name: '$supplier_name',
          },
        },
      },
      { $count: 'total' },
    ];

    const countResult = await this.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    return {
      status: true,
      list: results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error('Error in pendingReceivingReportPage:', error);
    return {
      status: false,
      list: null,
      message: error.message,
    };
  }
};

// Static method for pending supplier report page (ported from PHP)
receivingSchema.statics.pendingSupplierReportPage = async function (data, options = {}) {
  try {
    const mongoose = require('mongoose');

    // Parse dates - similar to PHP startingDate and endingDate methods
    let fromDate = new Date(0);
    let toDate = new Date();

    if (data.starting_date) {
      fromDate = new Date(data.starting_date);
      if (isNaN(fromDate.getTime())) fromDate = new Date(0);
    }

    if (data.ending_date) {
      toDate = new Date(data.ending_date);
      if (isNaN(toDate.getTime())) toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else {
      toDate.setHours(23, 59, 59, 999);
    }

    // Convert branch IDs to ObjectIds
    const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
    const objectBranchIds = branchIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    // Build filters for pending payments (payment_status != "paid")
    const filters = {
      $and: [
        { branch_id: { $in: objectBranchIds } },
        { payment_status: { $ne: 'paid' } },
        { created_date: { $gte: fromDate, $lte: toDate } },
      ],
    };

    // Calculate pagination
    const limit = parseInt(options.limit) || 5;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;

    // Aggregate pipeline similar to PHP implementation
    const pipeline = [
      { $match: filters },
      {
        $group: {
          _id: {
            supplier_id: '$supplier',
            supplier_name: '$supplier_name',
          },
          total_amount: { $sum: '$total' },
          paid_amount: { $sum: '$paid_amount' },
          balance: { $sum: '$balance' },
          receiving_count: { $sum: 1 },
        },
      },
      { $sort: { balance: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const results = await this.aggregate(pipeline);

    // Transform results to match PHP format
    const transformedResults = results.map((c) => ({
      supplier_id: c._id.supplier_id,
      supplier_name: c._id.supplier_name,
      total_amount: c.total_amount,
      paid_amount: c.paid_amount,
      balance: c.balance,
      receiving_count: c.receiving_count,
    }));

    // Get total count for pagination
    const countPipeline = [
      { $match: filters },
      {
        $group: {
          _id: {
            supplier_id: '$supplier',
            supplier_name: '$supplier_name',
          },
        },
      },
      { $count: 'total' },
    ];

    const countResult = await this.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    return {
      status: true,
      list: transformedResults,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error('Error in pendingSupplierReportPage:', error);
    return {
      status: false,
      list: null,
      message: error.message,
    };
  }
};

receivingSchema.statics.returnReceivingReportPage = async function (value = {}, options = {}) {
  try {
    const BaseModel = require('./base.model');
    const baseModel = new BaseModel('receivings');
    const { ObjectId } = require('mongodb');

    const fromDate = baseModel.startingDate(
      value.starting_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const toDate = baseModel.endingDate(
      value.ending_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );

    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) {
          branchIds.push(new ObjectId(id));
        }
      });
    }

    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    const matchFilter = {
      receiving_status: { $in: ['PartialReturn', 'FullReturn'] },
      updated_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
    };
    if (branchIds.length) matchFilter.branch_id = { $in: branchIds };
    if (licenseId) matchFilter.license = licenseId;

    const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
    const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;

    const collection = await baseModel.getCollection('receivings');

    const unwindStages = [
      { $unwind: '$items_return' },
      { $unwind: '$items_return.returnArray' },
      { $unwind: '$items_return.returnArray.returnValue' },
    ];

    const listPipeline = [
      { $match: matchFilter },
      ...unwindStages,
      {
        $group: {
          _id: {
            id: '$_id',
            date: '$updated_date',
            receiving_id: '$receiving_id',
            supplier_name: '$supplier_name',
            payment_mode: '$payment_mode',
            return_total: '$items_return_total',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.return_total': -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const aggResults = await collection.aggregate(listPipeline).toArray();

    const list = (aggResults || []).map((doc) => {
      const id = doc._id || {};
      return {
        date: id.date ? formatDate(id.date) : null,
        id: id.id ? id.id.toString?.() || id.id : '',
        receiving_id: id.receiving_id || '',
        supplier_name: id.supplier_name || '',
        payment_mode: id.payment_mode || '',
        return: roundToTwo(id.return_total || 0),
        count: doc.count || 0,
      };
    });

    const countPipeline = [
      { $match: matchFilter },
      ...unwindStages,
      {
        $group: {
          _id: {
            id: '$_id',
            receiving_id: '$receiving_id',
          },
        },
      },
      { $count: 'total' },
    ];

    const countDocs = await collection.aggregate(countPipeline).toArray();
    const total = (countDocs[0] && countDocs[0].total) || 0;

    return {
      status: true,
      total,
      current_page: page,
      total_pages: limit ? Math.ceil(total / limit) : 0,
      per_page: limit,
      list,
    };
  } catch (error) {
    console.error('Error in returnReceivingReportPage:', error);
    return {
      data: null,
      message: error.message || 'Failed to fetch return receiving product details',
    };
  }
};

/**
 * PHP: returnReceivingProductReportPage()
 * Get product details for a specific receiving return
 * @param {Object} value - { branchid, receiving_id }
 * @param {Object} options - { page, limit }
 * @returns {Promise<Object>}
 */
receivingSchema.statics.returnReceivingProductReportPage = async function (
  value = {},
  options = {}
) {
  try {
    const BaseModel = require('./base.model');
    const baseModel = new BaseModel('receivings');
    const { ObjectId } = require('mongodb');

    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) branchIds.push(new ObjectId(id));
      });
    }

    const filters = [];
    if (branchIds.length) {
      filters.push({ branch_id: { $in: branchIds } });
    }

    // Search for return_id in the returnValue array instead of returnId in returnArray
    if (value.receiving_id) {
      if (ObjectId.isValid(value.receiving_id)) {
        filters.push({ _id: new ObjectId(value.receiving_id) });
      } else {
        filters.push({ 'items_return.returnArray.returnValue.return_id': value.receiving_id });
      }
    }

    if (BaseModel.license) {
      filters.push({ license: BaseModel.license });
    }

    const collection = await baseModel.getCollection('receivings');

    // Debug: Check the filter being used
    console.log('DEBUG - Filters:', JSON.stringify(filters, null, 2));
    console.log('DEBUG - Looking for returnId:', value.receiving_id);

    // Debug: Check if document exists with this returnId
    const testDoc = await collection.findOne({
      'items_return.returnArray.returnValue.return_id': value.receiving_id,
    });
    console.log('DEBUG - Document found:', testDoc ? 'YES' : 'NO');
    if (testDoc) {
      console.log('DEBUG - Document structure:', {
        _id: testDoc._id,
        receiving_id: testDoc.receiving_id,
        items_return_count: testDoc.items_return?.length || 0,
        first_return_returnId: testDoc.items_return?.[0]?.returnArray?.returnId,
        first_returnValue_return_id:
          testDoc.items_return?.[0]?.returnArray?.returnValue?.[0]?.return_id,
      });
    }

    const pipeline = [
      ...(filters.length ? [{ $match: { $and: filters } }] : []),
      { $unwind: '$items_return' },
      { $unwind: '$items_return.returnArray' },
      {
        $unwind: {
          path: '$items_return.returnArray.returnValue',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          temp_return_date: '$items_return.returnArray.returnDate',
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              { $ifNull: ['$items_return.returnArray.returnValue', {}] },
              {
                supplier_name: '$supplier_name',
                supplier_phone: '$supplier_phone',
                supplier_email: '$supplier_email',
                supplier_address: '$supplier_address',
                payment_mode: '$payment_mode',
                return_id: '$items_return.returnArray.returnValue.return_id',
                return_date: { $toDate: '$temp_return_date' },
              },
            ],
          },
        },
      },
    ];

    const docs = await collection.aggregate(pipeline).toArray();

    // Debug: Check what fields are available in the results
    console.log('DEBUG - Aggregated docs count:', docs.length);
    if (docs.length > 0) {
      console.log('DEBUG - First doc keys:', Object.keys(docs[0]));
      console.log('DEBUG - First doc sample:', JSON.stringify(docs[0], null, 2));
    }

    // Get receiving details for custom_details
    let customDetails = {};
    if (docs.length > 0) {
      let receivingDoc = null;
      if (value.receiving_id && ObjectId.isValid(value.receiving_id)) {
        receivingDoc = await collection.findOne({ _id: new ObjectId(value.receiving_id) });
      } else if (value.receiving_id) {
        receivingDoc = await collection.findOne({
          'items_return.returnArray.returnValue.return_id': value.receiving_id,
        });
      }

      if (receivingDoc) {
        customDetails = {
          receiving_id: receivingDoc.receiving_id || '',
          supplier_name: receivingDoc.supplier_name || '',
          supplier_phone: receivingDoc.supplier_phone || '',
          supplier_email: receivingDoc.supplier_email || '',
          supplier_address: receivingDoc.supplier_address || '',
          user_name: receivingDoc.user_name || receivingDoc.created_by || '',
          branch_name: receivingDoc.branch_name || '',
        };
      }
    }

    const list = docs.map((row) => {
      const itemPrice = Number(row.item_price || 0);
      const qty = Number(row.item_quantity || 0);
      const taxRate = Number(row.tax || 0);
      const discountValue = Number(row.item_discount || 0);
      const discountPercent = Number(row.item_discount_percentage || 0);
      const taxType = row.tax_type || 'exclusive';

      let baseSubtotal = itemPrice * qty;
      if (taxType === 'inclusive' && taxRate > 0) {
        const inclusiveTax = (itemPrice * taxRate) / (100 + taxRate);
        baseSubtotal = (itemPrice - inclusiveTax) * qty;
      }

      let discountAmount = 0;
      if (discountValue > 0) {
        discountAmount = discountValue * qty;
      } else if (discountPercent > 0) {
        discountAmount = (baseSubtotal * discountPercent) / 100;
      }

      const subtotal = baseSubtotal - discountAmount;
      const taxAmount =
        taxType === 'exclusive' ? (subtotal * taxRate) / 100 : itemPrice * qty - baseSubtotal;

      // Convert return_date to MongoDB extended JSON format
      let returnDateObj = {};
      if (row.return_date) {
        returnDateObj = {
          $date: {
            $numberLong: row.return_date.getTime().toString(),
          },
        };
      }

      return {
        item_id: row.item_id?.toString() || '',
        item_name: row.item_name || '',
        // Alias used by legacy frontend tables (it reads row.name)
        name: row.item_name || '',
        total_amount: parseFloat((subtotal + taxAmount).toFixed(2)),
        item_quantity: qty,
        item_price: itemPrice,
        item_code: row.item_code || '',
        tax: taxRate,
        tax_type: taxType,
        item_discount: discountValue,
        item_discount_percentage: discountPercent,
        subtotal: parseFloat(subtotal.toFixed(2)),
        receiving_discount: parseFloat(discountAmount.toFixed(2)),
        receiving_tax: parseFloat(taxAmount.toFixed(2)),
        finaltotal: parseFloat((subtotal + taxAmount).toFixed(2)),
        supplier_name: row.supplier_name || '',
        supplier_phone: row.supplier_phone || '',
        supplier_email: row.supplier_email || '',
        supplier_address: row.supplier_address || '',
        payment_mode: row.payment_mode || '',
        return_id: row.return_id || '',
        return_date: returnDateObj,
      };
    });

    return {
      status: true,
      data: list,
      custom_details: customDetails,
      message: 'Return receiving product details fetched successfully',
    };
  } catch (error) {
    console.error('Error in returnReceivingProductReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to fetch return receiving product details',
    };
  }
};

/**
 * PHP equivalent: deleteReceivingCollectionData()
 * Delete multiple receivings by IDs with recycle_bin backup.
 */
receivingSchema.statics.deleteReceivingCollectionData = async function (ids) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { status: false, data: null, message: 'No IDs provided' };
    }

    // Ensure BaseModel has an initialized Mongo connection for recycle_bin
    const base = new BaseModel();
    await base.getCollection('recycle_bin');

    const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

    if (objectIds.length === 0) {
      return { status: false, data: null, message: 'No valid IDs provided' };
    }

    // Backup documents before deletion
    const docs = await this.find({ _id: { $in: objectIds } }).lean();
    for (const doc of docs) {
      await BaseModel.deletedDocumentBackup('receivings', doc);
    }

    const deleteResult = await this.deleteMany({ _id: { $in: objectIds } });

    return {
      status: true,
      data: deleteResult.deletedCount,
      message: 'success',
    };
  } catch (error) {
    console.error('Error in deleteReceivingCollectionData:', error);
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

/**
 * PHP: exportReceivingsOrder()
 * Export receivings data for CSV download
 */
receivingSchema.statics.exportReceivingsOrder = async function (data = []) {
  try {
    const { ObjectId } = require('mongodb');
    const BaseModel = require('./base.model');

    let ids = [];
    if (Array.isArray(data)) {
      ids = data;
    } else if (data && Array.isArray(data.data)) {
      ids = data.data;
    }

    if (!ids.length) {
      return { status: false, data: null, message: 'No IDs provided for export' };
    }

    const objectIds = ids
      .map((id) => (id != null ? String(id).trim() : ''))
      .filter((id) => id && ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    if (!objectIds.length) {
      return { status: false, data: null, message: 'No valid IDs provided for export' };
    }

    const filter = { _id: { $in: objectIds } };
    if (BaseModel.license) {
      filter.license = BaseModel.license;
    }

    const docs = await this.find(filter)
      .select({
        receiving_id: 1,
        supplier_name: 1,
        date: 1,
        items_total: 1,
        receiving_status: 1,
        payment_mode: 1,
        branch_name: 1,
      })
      .sort({ _id: -1 })
      .lean();

    return { status: true, data: docs, message: 'Receivings exported successfully' };
  } catch (error) {
    console.error('Error in exportReceivingsOrder:', error);
    return { status: false, data: null, message: error.message };
  }
};

/**
 * PHP: productBasedReceivingReturnReportPage()
 * Get product-based receiving return report with aggregation
 * @param {Object} value - { branchid, starting_date, ending_date }
 * @param {Object} options - { page, limit }
 * @returns {Promise<Object>}
 */
receivingSchema.statics.productBasedReceivingReturnReportPage = async function (
  value = {},
  options = {}
) {
  try {
    const BaseModel = require('./base.model');
    const baseModel = new BaseModel('receivings');
    const { ObjectId } = require('mongodb');

    const fromDate = baseModel.startingDate(
      value.starting_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const toDate = baseModel.endingDate(
      value.ending_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );

    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) {
          branchIds.push(new ObjectId(id));
        }
      });
    }

    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    const matchFilter = {
      receiving_status: { $in: ['PartialReturn', 'FullReturn'] },
      updated_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
    };
    if (branchIds.length) matchFilter.branch_id = { $in: branchIds };
    if (licenseId) matchFilter.license = licenseId;

    const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
    const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;

    const collection = await baseModel.getCollection('receivings');

    const unwindStages = [
      { $unwind: '$items_return' },
      { $unwind: '$items_return.returnArray' },
      { $unwind: '$items_return.returnArray.returnValue' },
    ];

    const listPipeline = [
      { $match: matchFilter },
      ...unwindStages,
      {
        $group: {
          _id: {
            item_id: '$items_return.returnArray.returnValue.item_id',
            item_name: '$items_return.returnArray.returnValue.item_name',
            item_code: '$items_return.returnArray.returnValue.item_code',
            supplier_id: '$supplier_id',
            supplier_name: '$supplier_name',
            return_id: '$items_return.returnArray.returnValue.return_id',
            return_date: '$updated_date',
          },
          total_quantity: { $sum: '$items_return.returnArray.returnValue.item_quantity' },
          total_amount: {
            $sum: {
              $multiply: [
                '$items_return.returnArray.returnValue.item_price',
                '$items_return.returnArray.returnValue.item_quantity',
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { total_amount: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const aggResults = await collection.aggregate(listPipeline).toArray();

    const list = (aggResults || []).map((doc) => {
      const id = doc._id || {};
      const formatDate = (date) => {
        if (!date) return '';
        const d = new Date(date);
        return (
          d
            .toLocaleDateString('en-US', {
              month: '2-digit',
              day: '2-digit',
              year: 'numeric',
            })
            .replace(/\//g, '/') +
          ' ' +
          d
            .toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
            .toLowerCase()
            .replace(/\s/g, ' ')
        );
      };

      return {
        _id: id.item_id?.toString() || '',
        name: id.item_name || '',
        total_amount: parseFloat((doc.total_amount || 0).toFixed(2)),
        item_quantity: doc.total_quantity || 0,
        item_code: id.item_code || '',
        count: doc.count || 0,
        supplier_id: id.supplier_id?.toString() || '',
        supplier_name: id.supplier_name || '',
        return_id: id.return_id?.toString() || '',
        return_date: formatDate(id.return_date),
      };
    });

    const countPipeline = [
      { $match: matchFilter },
      ...unwindStages,
      {
        $group: {
          _id: {
            item_id: '$items_return.returnArray.returnValue.item_id',
          },
        },
      },
      { $count: 'total' },
    ];

    const countDocs = await collection.aggregate(countPipeline).toArray();
    const total = (countDocs[0] && countDocs[0].total) || 0;

    return {
      status: true,
      total,
      current_page: page,
      total_pages: limit ? Math.ceil(total / limit) : 0,
      per_page: limit,
      list,
    };
  } catch (error) {
    console.error('Error in productBasedReceivingReturnReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to fetch product-based receiving return report',
    };
  }
};

/**
 * PHP: supplierReceivingReportPage()
 * Get supplier-based receiving report with aggregation
 * @param {Object} value - { branchid, starting_date, ending_date, supplier_id }
 * @param {Object} options - { page, limit }
 * @returns {Promise<Object>}
 */
receivingSchema.statics.supplierReceivingReportPage = async function (value, options = {}) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');

    const baseModel = new BaseModel('receivings');

    // Parse dates
    const fromDate = baseModel.startingDate(
      value.starting_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const toDate = baseModel.endingDate(
      value.ending_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );

    // Convert branch IDs to ObjectId
    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) {
          branchIds.push(new ObjectId(id));
        }
      });
    }

    // Build filters - ensure license is ObjectId
    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    const filters = {
      $and: [
        {
          branch_id: { $in: branchIds },
          // Supplier receiving summary should only include fully/partially
          // received documents; exclude Open receivings.
          receiving_status: { $in: ['Received', 'PartialReturn'] },
        },
        {
          updated_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
          license: licenseId,
        },
      ],
    };

    // Add supplier filter if provided
    if (value.supplier_id && value.supplier_id !== '') {
      if (ObjectId.isValid(value.supplier_id)) {
        filters.supplier_id = new ObjectId(value.supplier_id);
      }
    }

    // Pagination
    const limit = parseInt(options.limit) || 5;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;

    const collection = await baseModel.getCollection('receivings');

    // DEBUG: Log filters and check collection
    console.log('🔍 DEBUG - Filters:', JSON.stringify(filters, null, 2));
    console.log('🔍 DEBUG - Branch IDs:', branchIds);
    console.log('🔍 DEBUG - License:', licenseId);
    console.log('🔍 DEBUG - Date Range:', fromDate, 'to', toDate);

    const totalInCollection = await collection.countDocuments({});
    console.log('🔍 DEBUG - Total docs in receivings collection:', totalInCollection);

    const matchingDocs = await collection.countDocuments(filters);
    console.log('🔍 DEBUG - Docs matching filters:', matchingDocs);

    // Get sample doc to check structure
    const sampleDoc = await collection.findOne({});
    if (sampleDoc) {
      console.log('🔍 DEBUG - Sample doc structure:', {
        _id: sampleDoc._id,
        branch_id: sampleDoc.branch_id,
        license: sampleDoc.license,
        receiving_status: sampleDoc.receiving_status,
        updated_date: sampleDoc.updated_date,
        supplier_name: sampleDoc.supplier_name,
      });
    }

    // Aggregation pipeline
    const pipeline = [
      { $match: filters },
      {
        $group: {
          _id: {
            supplier_id: '$supplier_id',
            supplier_name: '$supplier_name',
            supplier_phone: '$supplier_phone',
          },
          receiving_avg: { $avg: { $toDouble: { $ifNull: ['$items_total', 0] } } },
          receiving_total: { $sum: { $toDouble: { $ifNull: ['$items_total', 0] } } },
          receiving_count: { $sum: 1 },
        },
      },
      { $sort: { receiving_total: -1 } },
    ];

    // Get total count
    const countPipeline = [...pipeline];
    const countResult = await collection.aggregate(countPipeline).toArray();
    const total = countResult.length;

    console.log('🔍 DEBUG - Aggregation result count:', total);

    // Get paginated results
    const paginatedPipeline = [...pipeline, { $skip: skip }, { $limit: limit }];
    const results = await collection.aggregate(paginatedPipeline).toArray();

    // Format results
    const receivingValues = results.map((doc) => ({
      supplier_name: doc._id.supplier_name || '',
      supplier_phone: doc._id.supplier_phone || '',
      supplier_id: doc._id.supplier_id ? doc._id.supplier_id.toString() : '',
      receiving_payment: Math.round(doc.receiving_total * 100) / 100,
      receiving_count: doc.receiving_count || 0,
      receiving_avg: Math.round(doc.receiving_avg * 100) / 100,
    }));

    return {
      status: true,
      total: total,
      current_page: page,
      total_pages: Math.ceil(total / limit),
      per_page: limit,
      list: receivingValues,
    };
  } catch (error) {
    console.error('Error in supplierReceivingReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

/**
 * PHP: receivingReportPage()
 * Get receiving report
 * @param {Object} value - { branchid, starting_date, ending_date }
 * @param {Object} options - { page, limit }
 * @returns {Promise<Object>}
 */
receivingSchema.statics.receivingReportPage = async function (value, options = {}) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');
    const baseModel = new BaseModel('receivings');
    const fromDate = baseModel.startingDate(
      value.starting_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const toDate = baseModel.endingDate(
      value.ending_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) branchIds.push(new ObjectId(id));
      });
    }
    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    // Match PHP receivingReportPage behaviour:
    //   - Only include receiving_status in ['Received', 'PartialReturn']
    //   - Filter by primary business date field `date` (not updated_date)
    //   - Exclude rows where all item quantities are zero
    //   - Always scope to current license
    const andConditions = [
      {
        branch_id: { $in: branchIds },
        receiving_status: { $in: ['Received', 'PartialReturn'] },
      },
      {
        date: { $gte: fromDate, $lte: toDate },
        'items.item_quantity': { $gt: 0 },
      },
    ];
    if (licenseId) {
      andConditions[1].license = licenseId;
    }
    const filters = { $and: andConditions };

    const limit = parseInt(options.limit) || 5;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;
    const collection = await baseModel.getCollection('receivings');
    const total = await collection.countDocuments(filters);
    const results = await collection
      .find(filters)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return {
      status: true,
      message: 'success',
      data: {
        total,
        current_page: page,
        total_pages: Math.ceil(total / limit),
        per_page: limit,
        list: results,
      },
    };
  } catch (error) {
    console.error('Error in receivingReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to fetch receiving report',
    };
  }
};

/**
 * PHP: receivingsGraphicalReports()
 * Get graphical receiving reports
 * @param {Object} value - { branchid, starting_date, ending_date }
 * @returns {Promise<Object>}
 */
receivingSchema.statics.receivingsGraphicalReports = async function (value) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');
    const baseModel = new BaseModel('receivings');

    const fromDate = baseModel.startingDate(
      value.starting_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );
    const toDate = baseModel.endingDate(
      value.ending_date,
      BaseModel.currentTimeZone || 'Asia/Kolkata'
    );

    const branchIds = [];
    if (Array.isArray(value.branchid)) {
      value.branchid.forEach((id) => {
        if (id && ObjectId.isValid(id)) branchIds.push(new ObjectId(id));
      });
    }

    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    const collection = await baseModel.getCollection('receivings');
    const timezone = BaseModel.currentTimeZone || 'Asia/Kolkata';

    // Open receivings aggregation
    const openCondition = {
      branch_id: { $in: branchIds },
      receiving_status: 'Open',
      updated_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
    };
    if (licenseId) openCondition.license = licenseId;

    const openReceivingList = await collection
      .aggregate([
        { $match: openCondition },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$updated_date', timezone } },
            receiving_total: { $sum: '$items_total' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const openReceivingData = openReceivingList.map((item) => ({
      date_open: item._id,
      receiving_payment_open: Math.round(item.receiving_total * 100) / 100,
    }));

    // Received/PartialReturn receivings aggregation
    const receivedCondition = {
      branch_id: { $in: branchIds },
      receiving_status: { $in: ['Received', 'PartialReturn'] },
      updated_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
    };
    if (licenseId) receivedCondition.license = licenseId;

    const receivedReceivingList = await collection
      .aggregate([
        { $match: receivedCondition },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$updated_date', timezone } },
            receiving_total: { $sum: '$items_total' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const receivedReceivingValues = receivedReceivingList.map((item) => ({
      date_received: item._id,
      receiving_payment_received: Math.round(item.receiving_total * 100) / 100,
    }));

    const data = [...openReceivingData, ...receivedReceivingValues];

    return {
      status: true,
      data: data,
      message: 'Graphical report successfully',
    };
  } catch (error) {
    console.error('Error in receivingsGraphicalReports:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to fetch graphical report',
    };
  }
};

/**
 * PHP: getReceivingOrder()
 * Get a single receiving order by ID
 * @param {String} receiving_id - Receiving order ID
 * @returns {Promise<Object>}
 */
receivingSchema.statics.getReceivingOrder = async function (receiving_id) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');

    if (!ObjectId.isValid(receiving_id)) {
      return {
        status: false,
        data: null,
        message: 'Invalid receiving ID',
      };
    }

    let licenseId = BaseModel.license;
    if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
      licenseId = new ObjectId(licenseId);
    }

    const filters = {
      _id: new ObjectId(receiving_id),
    };
    if (licenseId) {
      filters.license = licenseId;
    }

    const baseModel = new BaseModel('receivings');
    const collection = await baseModel.getCollection('receivings');

    // Use EJSON serialization to return Extended JSON format for nested objects
    // This matches PHP behavior where nested ObjectIds become {$oid: "..."} and Dates become {$date: {...}}
    const receiving = await collection.findOne(filters, {
      raw: false, // Return JavaScript objects, not BSON
    });

    if (!receiving) {
      return {
        status: false,
        data: null,
        message: 'Receiving not found',
      };
    }

    // Enrich with branch GSTIN and printing address so frontend prints
    // can display GSTIN consistently (mirroring sales behaviour).
    try {
      if (receiving.branch_id) {
        const branchesCollection = await baseModel.getCollection('branches');

        const branchFilter = { _id: receiving.branch_id };
        if (licenseId) {
          branchFilter.license = licenseId;
        }

        const branchDoc = await branchesCollection.findOne(branchFilter);

        if (branchDoc) {
          const rawBranchGstin =
            typeof branchDoc.branch_gstin_number === 'string'
              ? branchDoc.branch_gstin_number.trim()
              : '';

          if (rawBranchGstin) {
            receiving.branch_gstin_number = rawBranchGstin;
          }

          if (
            typeof receiving.printing_address === 'undefined' ||
            receiving.printing_address === null ||
            (typeof receiving.printing_address === 'string' && !receiving.printing_address.trim())
          ) {
            if (typeof branchDoc.printing_address === 'string') {
              receiving.printing_address = branchDoc.printing_address;
            }
          }
        }
      }
    } catch (e) {
      // Non-fatal: if branch lookup fails, continue with original document
    }

    // Manually convert to Extended JSON format using EJSON
    // Use relaxed: false to get $numberLong format for dates
    const EJSON = require('bson').EJSON;
    const receivingEJSON = EJSON.serialize(receiving, { relaxed: false });

    // Helper function to format a date from Extended JSON format
    const formatDateFromEJSON = (field) => {
      const timezone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      let dateObj;
      if (typeof field.$date === 'object' && field.$date !== null && field.$date.$numberLong) {
        dateObj = new Date(parseInt(field.$date.$numberLong));
      } else if (typeof field.$date === 'string') {
        dateObj = new Date(field.$date);
      } else if (typeof field.$date === 'number') {
        dateObj = new Date(field.$date);
      } else {
        dateObj = new Date();
      }

      // Format as: MM/DD/YYYY hh:mm am/pm
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const year = dateObj.getFullYear();
      let hours = dateObj.getHours();
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hoursStr = String(hours).padStart(2, '0');

      return `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
    };

    // Helper to convert Extended JSON numbers to plain numbers
    const convertNumber = (field) => {
      if (field && typeof field === 'object') {
        if (field.$numberInt) return parseInt(field.$numberInt);
        if (field.$numberLong) return parseInt(field.$numberLong);
        if (field.$numberDouble) return parseFloat(field.$numberDouble);
      }
      return field;
    };

    // Recursively convert Extended JSON numbers to plain numbers in nested objects
    const simplifyNumbers = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map((item) => simplifyNumbers(item));
      }

      const result = {};
      for (const key in obj) {
        const value = obj[key];

        // Skip $date objects - keep them in Extended JSON format
        if (key === '$date' || (value && typeof value === 'object' && value.$date)) {
          result[key] = value;
        }
        // Skip $oid objects - keep them in Extended JSON format
        else if (key === '$oid' || (value && typeof value === 'object' && value.$oid)) {
          result[key] = value;
        }
        // Convert number objects to plain numbers
        else if (
          value &&
          typeof value === 'object' &&
          (value.$numberInt || value.$numberLong || value.$numberDouble)
        ) {
          result[key] = convertNumber(value);
        }
        // Recursively process nested objects and arrays
        else if (value && typeof value === 'object') {
          result[key] = simplifyNumbers(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    // Convert to simple values like PHP's simplifyFields()
    // IMPORTANT: PHP only processes TOP-LEVEL fields, NOT nested objects
    const simplifyFields = (document) => {
      if (!document || typeof document !== 'object') return document;

      // Only process top-level fields
      for (const fieldIndex in document) {
        const field = document[fieldIndex];

        // Convert top-level Extended JSON ObjectId to string
        if (field && typeof field === 'object' && field.$oid) {
          document[fieldIndex] = field.$oid;
        }
        // Convert top-level Extended JSON Date to formatted string
        else if (field && typeof field === 'object' && field.$date) {
          document[fieldIndex] = formatDateFromEJSON(field);
        }
        // Do NOT recursively process nested objects - leave them as-is
        // The frontend expects nested ObjectIds and Dates to be in Extended JSON format
      }

      return document;
    };

    // First convert all Extended JSON numbers to plain numbers (recursively)
    const withPlainNumbers = simplifyNumbers(receivingEJSON);

    // Then simplify top-level fields only
    const formattedReceiving = simplifyFields(withPlainNumbers);

    return {
      status: true,
      data: formattedReceiving,
      message: 'Get successfully',
    };
  } catch (error) {
    console.error('Error in getReceivingOrder:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to fetch receiving order',
    };
  }
};

/**
 * PHP: receivingInsertUpdate()
 * Create or update a receiving order
 * @param {Object} data - Receiving data
 * @param {String} id - Receiving ID (null for create, ID for update)
 * @returns {Promise<Object>}
 */
receivingSchema.statics.receivingInsertUpdate = async function (data, id) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');
    const Item = require('./item.model');

    const baseModel = new BaseModel('receivings');
    const collection = await baseModel.getCollection('receivings');

    // Get settings and user info
    let prefixValue = 'RID'; // Default prefix, should come from settings
    const currentBranch = BaseModel.currentBranch;
    const currentBranchName = BaseModel.currentBranchName || '';
    const currentBranchState = BaseModel.currentBranchState || '';
    const loggedUser = BaseModel.loggedUser;
    const loggedUserName = BaseModel.loggedUserName || '';
    const license = BaseModel.license;
    const timezone = BaseModel.currentTimeZone || 'Asia/Kolkata';

    if (currentBranch && license) {
      try {
        const branchesCollection = await baseModel.getCollection('branches');
        const branchDoc = await branchesCollection.findOne({
          _id: new ObjectId(currentBranch),
          license: new ObjectId(license),
        });

        if (branchDoc && typeof branchDoc.receiving_prefix === 'string') {
          const trimmed = branchDoc.receiving_prefix.trim();
          if (trimmed.length === 3) {
            prefixValue = trimmed;
          }
        }
      } catch (e) {
        console.error('Error reading receiving_prefix from branch settings', e);
      }
    }

    // Check plan limits (if applicable)
    // Skipping plan check for now - implement if needed

    // Parse date - for new records use provided date or current time
    // For updates, we'll preserve the original date
    const receivingDate = data.date ? new Date(data.date) : new Date();
    const currentDate = new Date(); // Current timestamp for updated_date
    const noOfItems = data.items ? data.items.length : 0;
    const items = data.items || [];

    const receivingItems = [];
    const discountData = [];
    const taxData = [];
    const subtotalData = [];
    const totalData = [];

    // Get items collection
    const itemsCollection = await baseModel.getCollection('items');
    const taxCollection = await baseModel.getCollection('grouptax');

    // Process each item
    for (const item of items) {
      let itemId = item.item_id;
      if (id && itemId === '[object Object]') {
        const existingRecord = await collection.findOne({
          _id: new ObjectId(id),
          license: new ObjectId(license),
        });
        if (existingRecord && existingRecord.items) {
          const existingItem = existingRecord.items.find((i) => i.item_name === item.item_name);
          if (existingItem) {
            itemId = existingItem.item_id;
            item.item_id = itemId; // Update the item object
          }
        }
      }

      // Validate item exists
      const itemDoc = await itemsCollection.findOne({
        _id: new ObjectId(itemId),
        license: new ObjectId(license),
      });

      if (!itemDoc) {
        return {
          status: false,
          data: null,
          message: 'This product has already been removed, so you can not modify anything.',
        };
      }

      if (itemDoc._id.toString() !== itemId) {
        return {
          status: false,
          data: null,
          message: 'Enter must correct item id',
        };
      }

      const itemQuantity = parseFloat(item.item_quantity) || 0;

      const itemAmount = (itemDoc.company_price || 0) * itemQuantity;

      // Handle tax
      let itemTax, taxFields, taxName;

      if (
        itemDoc.tax_type === 'exclusive' &&
        parseFloat(itemDoc.tax) === parseFloat(item.item_tax || 0)
      ) {
        itemTax = itemDoc.tax;
        taxFields = itemDoc.tax_fields || [];
        taxName = itemDoc.tax_name;
      } else {
        // Find or create tax
        const taxDoc = await taxCollection.findOne({
          branch_id: new ObjectId(currentBranch),
          rate: parseFloat(item.item_tax || 0),
          license: new ObjectId(license),
        });

        if (taxDoc) {
          taxFields = taxDoc.tax_fields || [];
          itemTax = taxDoc.rate;
          taxName = taxDoc.name;
        } else {
          // Create new tax
          const newTaxData = {
            branch_id: new ObjectId(currentBranch),
            branch_name: currentBranchName,
            name: `${item.item_tax}% Tax`,
            rate: parseFloat(item.item_tax || 0),
            tax_fields: [],
            tax_group: 'no',
            created_date: receivingDate,
            created_by: loggedUserName,
            created_by_id: new ObjectId(loggedUser),
            updated_date: receivingDate,
            updated_by: loggedUserName,
            updated_by_id: new ObjectId(loggedUser),
            license: new ObjectId(license),
          };

          const insertResult = await taxCollection.insertOne(newTaxData);
          const taxArrayData = {
            tax_id: insertResult.insertedId,
            tax_name: `${item.item_tax}% Tax`,
            tax_value: parseFloat(item.item_tax || 0),
          };

          await taxCollection.updateOne(
            { _id: insertResult.insertedId, license: new ObjectId(license) },
            { $push: { tax_fields: taxArrayData } }
          );

          taxFields = [taxArrayData];
          itemTax = item.item_tax;
          taxName = `${item.item_tax}% Tax`;
        }
      }

      const itemTaxType = 'exclusive';
      let itemDiscountAmountTotalCalculation, itemSubTaxTotalCalculation, subtotal;

      if (itemTaxType === 'exclusive') {
        itemDiscountAmountTotalCalculation = itemAmount + (itemAmount / 100) * itemTax;
        totalData.push({ total_Amount: itemDiscountAmountTotalCalculation });

        itemSubTaxTotalCalculation = (itemAmount / 100) * itemTax;
        subtotal = itemAmount + itemSubTaxTotalCalculation;

        taxData.push({ tax_amount: itemSubTaxTotalCalculation });
        discountData.push({ discount_amount: 0.0 });
        subtotalData.push({ subtotal_amount: subtotal - itemSubTaxTotalCalculation });
      } else {
        itemDiscountAmountTotalCalculation = itemAmount;
        totalData.push({ total_Amount: itemDiscountAmountTotalCalculation });

        const taxPrice = ((itemDoc.company_price || 0) * itemTax) / (100 + itemTax);
        const taxItemPrice = (itemDoc.company_price || 0) - taxPrice;
        const taxDiscountMultiple = taxItemPrice * itemQuantity;
        const taxQuantityMultiple = taxDiscountMultiple;
        itemSubTaxTotalCalculation = (taxQuantityMultiple / 100) * itemTax;

        taxData.push({ tax_amount: itemSubTaxTotalCalculation });
        discountData.push({ discount_amount: 0.0 });
        subtotalData.push({ subtotal_amount: taxQuantityMultiple });
      }

      // Calculate GST values
      let igstValue = 0.0;
      let csgstValue = 0.0;

      // Assuming indian_gst setting - implement proper check if needed
      const indianGst = 'gst_on'; // Should come from settings
      if (indianGst === 'gst_on') {
        if (data.supplier_state !== currentBranchState) {
          igstValue = parseFloat(item.gst || 0);
        } else {
          csgstValue = parseFloat(item.gst || 0) / 2;
        }
      }

      receivingItems.push({
        item_name: itemDoc.name,
        item_sku: itemDoc.itemid,
        item_price: parseFloat(itemDoc.company_price || 0),
        item_quantity: parseFloat(itemQuantity),
        item_unit: item.item_unit || 'qty',
        item_id: item.item_id,
        total_amount: parseFloat(itemDiscountAmountTotalCalculation),
        barcode_id: itemDoc.itemid,
        tax: parseFloat(itemTax),
        tax_type: itemTaxType,
        tax_name: taxName,
        igst_tax: parseFloat(igstValue),
        cgst_tax: parseFloat(csgstValue),
        sgst_tax: parseFloat(csgstValue),
        tax_fields: taxFields,
      });
    }

    // Calculate totals
    const receivingTotalAmount = totalData.reduce((sum, item) => sum + item.total_Amount, 0);
    const receivingSubtotalAmount = subtotalData.reduce(
      (sum, item) => sum + item.subtotal_amount,
      0
    );
    const receivingTaxAmount = taxData.reduce((sum, item) => sum + item.tax_amount, 0);

    // Handle images
    const multiImage = (data.image || []).map((img) => ({ name: img.name }));

    // Generate a globally unique human-readable ID. The production collection
    // has a unique index on receiving_id (not a compound tenant index), so a
    // branch-local sequence can generate RID000001 for multiple branches.
    let prefixId;
    if (!id) {
      const escapedPrefix = prefixValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lastRecord = await collection.findOne(
        { receiving_id: { $regex: `^${escapedPrefix}\\d+$` } },
        { sort: { receiving_id: -1 } }
      );

      let incrementVal;
      if (lastRecord && lastRecord.receiving_id) {
        const subStringValue = lastRecord.receiving_id.substring(prefixValue.length);
        const countValue = parseInt(subStringValue) + 1;
        incrementVal = String(countValue).padStart(6, '0');
      } else {
        incrementVal = '000001';
      }
      prefixId = prefixValue + incrementVal;
    }

    // Extract supplier_id - handle various formats
    let supplierId = data.supplier_id;

    // Handle corrupted string "[object Object]" - fetch from existing record if updating
    if (id && supplierId === '[object Object]') {
      const existingRecord = await collection.findOne({
        _id: new ObjectId(id),
        license: new ObjectId(license),
      });
      if (existingRecord && existingRecord.supplier_id) {
        supplierId = existingRecord.supplier_id.toString();
      }
    }

    // If it's already an ObjectId instance, convert to string
    if (supplierId && typeof supplierId === 'object') {
      if (supplierId.$oid) {
        supplierId = supplierId.$oid;
      } else if (supplierId._bsontype === 'ObjectId' || supplierId instanceof ObjectId) {
        supplierId = supplierId.toString();
      }
    }

    // Validate supplier_id
    if (!supplierId || !ObjectId.isValid(supplierId)) {
      return {
        status: false,
        data: null,
        message: `Invalid supplier ID: ${supplierId}`,
      };
    }

    // Prepare insert data (for new records)
    const insertData = {
      branch_id: new ObjectId(currentBranch),
      branch_name: currentBranchName,
      receiving_id: prefixId,
      receiving_number: prefixId,
      created_date: receivingDate,
      created_by: loggedUserName.trim(),
      created_by_id: new ObjectId(loggedUser),
      license: new ObjectId(license),
    };

    // Prepare update data (for both new and existing records)
    const updateData = {
      date: receivingDate,
      supplier_id: new ObjectId(supplierId),
      supplier_name: (data.supplier_name || '').trim(),
      supplier_address: (data.supplier_address || '').trim(),
      supplier_phone: (data.supplier_phone || '').trim(),
      supplier_email: (data.supplier_email || '').trim(),
      supplier_state: (data.supplier_state || '').trim(),
      supplier_gst_type: (data.supplier_gst_type || '').trim(),
      supplier_gst_number: (data.supplier_gst_number || '').trim(),
      payment_mode: (data.payment_mode || '').trim(),
      receiving_status: (data.status || '').trim(),
      tax: Math.round(receivingTaxAmount * 100) / 100,
      gst: 'enable', // Should check settings
      return_tax: 0.0,
      payment_description: (data.payment_description || '').trim(),
      subtotal_amount: parseFloat(receivingSubtotalAmount),
      total_amount: parseFloat(receivingTotalAmount),
      items_subtotal: parseFloat(receivingSubtotalAmount),
      items_total: parseFloat(receivingTotalAmount),
      items_return_subtotal: 0.0,
      items_return_total: 0.0,
      printing_address: '', // Should come from settings
      updated_date: currentDate,
      updated_by: loggedUserName.trim(),
      updated_by_id: new ObjectId(loggedUser),
      total_items: noOfItems,
      items: receivingItems,
      items_return: [],
      image: multiImage,
      exclusive_tax: (data.exclusive_tax || '').trim(),
      license: new ObjectId(license),
    };

    if (!id) {
      // INSERT new receiving
      const receivingData = { ...insertData, ...updateData };
      let insertResult;
      // Concurrent creates can read the same last ID. On a duplicate-key race,
      // read the new maximum and retry with the next value.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          insertResult = await collection.insertOne(receivingData);
          break;
        } catch (error) {
          if (error?.code !== 11000 || attempt === 4) throw error;

          /*
           * escapedPrefix is declared in a different block further up, so it
           * was not in scope here: the retry threw ReferenceError instead of
           * retrying. This is the duplicate-key path, which only runs when two
           * purchases are created at the same moment - so the one situation the
           * loop exists to survive was the one that broke it.
           */
          const escapedPrefix = prefixValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const latestRecord = await collection.findOne(
            { receiving_id: { $regex: `^${escapedPrefix}\\d+$` } },
            { sort: { receiving_id: -1 } }
          );
          const latestNumber = latestRecord?.receiving_id
            ? parseInt(String(latestRecord.receiving_id).substring(prefixValue.length), 10)
            : 0;
          const nextNumber = Number.isNaN(latestNumber) ? 1 : latestNumber + 1;
          prefixId = `${prefixValue}${String(nextNumber).padStart(6, '0')}`;
          receivingData.receiving_id = prefixId;
          receivingData.receiving_number = prefixId;
        }
      }

      // Get branch to check stock_management setting (PHP line 411)
      const branchesCollection = await baseModel.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({
        _id: new ObjectId(currentBranch),
      });

      const stockManagement = branchDoc?.stock_management === true;
      const stockLogStatus = branchDoc?.stock_management_log !== false;

      console.log('[RECEIVING MODEL DEBUG] Stock log context:', {
        stockManagement: stockManagement,
        stockLogStatus: stockLogStatus,
        status: data.status,
        itemCount: items.length,
      });

      // Update item quantities and create stock logs if status is 'Received'
      // PHP: if ($_SESSION['PosnicPro']['settings']['stock_management'] === true && $documents['track_inventory'] === true && $data['status'] === 'Received')
      if (data.status === 'Received' && stockManagement) {
        for (const item of items) {
          const itemId = new ObjectId(item.item_id);
          const itemQuantity = parseFloat(item.item_quantity || 0);

          const itemDoc = await itemsCollection.findOne({
            _id: itemId,
            license: new ObjectId(license),
          });

          console.log('[RECEIVING MODEL DEBUG] Item check:', {
            item_id: item.item_id,
            track_inventory: itemDoc?.track_inventory,
            track_inventory_type: typeof itemDoc?.track_inventory,
          });

          // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
          if (itemDoc && (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')) {
            const currentQty = parseFloat(itemDoc.available_quantity || 0);
            const newQty = currentQty + itemQuantity;

            console.log('[RECEIVING MODEL DEBUG] Creating stock log for item:', item.item_id);

            // Create stock log (PHP line 413)
            const stockLogData = {
              stocklog: stockLogStatus,
              branch_id: new ObjectId(currentBranch),
              view_item_id: itemId,
              item_barcode_id: itemDoc.barcode_id || '',
              item_name: item.item_name || itemDoc.name || '',
              item_quantity: itemQuantity,
              process: 'Add Receiving',
              reference: prefixId,
              opening_balance: currentQty,
              closing_balance: newQty,
              count: itemQuantity,
              date: receivingDate,
              action: 'Add',
              changed_by_userid: new ObjectId(loggedUser),
              changed_by: loggedUserName,
              license: new ObjectId(license),
              created_date: receivingDate,
              updated_date: receivingDate,
            };

            const stockLogsCollection = await baseModel.getCollection('stocklogs');
            await stockLogsCollection.insertOne(stockLogData);
            console.log('[RECEIVING MODEL] Stock log created successfully');

            // Update item quantity (PHP line 414)
            await itemsCollection.updateOne(
              { _id: itemId, license: new ObjectId(license) },
              { $set: { available_quantity: newQty } }
            );
          }
        }
      } else if (data.status === 'Received') {
        console.log('[RECEIVING MODEL DEBUG] Stock management disabled, skipping stock logs');

        // Still update quantities even if stock_management is off
        for (const item of items) {
          const itemId = new ObjectId(item.item_id);
          const itemQuantity = parseFloat(item.item_quantity || 0);

          const itemDoc = await itemsCollection.findOne({
            _id: itemId,
            license: new ObjectId(license),
          });

          if (itemDoc && (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')) {
            const currentQty = parseFloat(itemDoc.available_quantity || 0);
            const newQty = currentQty + itemQuantity;

            await itemsCollection.updateOne(
              { _id: itemId, license: new ObjectId(license) },
              { $set: { available_quantity: newQty } }
            );
          }
        }
      }

      return {
        status: true,
        data: {
          print: false, // Should come from settings
          receiving_id: insertResult.insertedId.toString(),
        },
        message: 'Receiving added successfully',
      };
    } else {
      // UPDATE existing receiving
      const receivingId = new ObjectId(id);

      // Fetch existing receiving to preserve original date
      const existingReceiving = await collection.findOne({
        _id: receivingId,
        license: new ObjectId(license),
      });

      if (!existingReceiving) {
        return {
          status: false,
          data: null,
          message: 'Receiving not found',
        };
      }

      // Preserve original date unless explicitly provided in update
      if (!data.date && existingReceiving.date) {
        updateData.date = existingReceiving.date;
      }

      // Get branch to check stock_management setting (PHP line 439)
      const branchesCollection = await baseModel.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({
        _id: new ObjectId(currentBranch),
      });

      const stockManagement = branchDoc?.stock_management === true;
      const stockLogStatus = branchDoc?.stock_management_log !== false;

      console.log('[RECEIVING UPDATE DEBUG] Stock log context:', {
        stockManagement: stockManagement,
        stockLogStatus: stockLogStatus,
        status: data.status,
        itemCount: items.length,
      });

      // Update item quantities and create stock logs if status is 'Received' (PHP line 439-443)
      if (data.status === 'Received') {
        for (const itemUpdate of items) {
          const itemId = new ObjectId(itemUpdate.item_id);
          const itemQuantity = parseFloat(itemUpdate.item_quantity || 0);
          const itemName = itemUpdate.item_name || '';

          const itemDoc = await itemsCollection.findOne({
            _id: itemId,
            license: new ObjectId(license),
          });

          console.log('[RECEIVING UPDATE DEBUG] Item check:', {
            item_id: itemUpdate.item_id,
            track_inventory: itemDoc?.track_inventory,
            track_inventory_type: typeof itemDoc?.track_inventory,
          });

          // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
          if (itemDoc && (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')) {
            const availableQty = parseFloat(itemDoc.available_quantity || 0);
            const newQty = itemQuantity + availableQty;

            // Create stock log for EDIT Receiving (PHP line 439-441)
            // Only if stock_management is enabled
            if (stockManagement) {
              console.log(
                '[RECEIVING UPDATE DEBUG] Creating stock log for item:',
                itemUpdate.item_id
              );

              const stockLogData = {
                stocklog: stockLogStatus,
                branch_id: new ObjectId(currentBranch),
                view_item_id: itemId,
                item_barcode_id: itemDoc.barcode_id || '',
                item_name: itemName || itemDoc.name || '',
                item_quantity: itemQuantity,
                process: 'Edit Receiving',
                reference: data.alternative_id || '',
                opening_balance: availableQty,
                closing_balance: newQty,
                count: itemQuantity,
                date: receivingDate,
                action: 'Add',
                changed_by_userid: new ObjectId(loggedUser),
                changed_by: loggedUserName,
                license: new ObjectId(license),
                created_date: receivingDate,
                updated_date: receivingDate,
              };

              const stockLogsCollection = await baseModel.getCollection('stocklogs');
              await stockLogsCollection.insertOne(stockLogData);
              console.log('[RECEIVING UPDATE] Stock log created successfully');
            } else {
              console.log('[RECEIVING UPDATE DEBUG] Stock management disabled, skipping stock log');
            }

            // Update item quantity (PHP line 442)
            await itemsCollection.updateOne(
              { _id: itemId, license: new ObjectId(license) },
              { $set: { available_quantity: newQty } }
            );
          }
        }
      }

      const updateResult = await collection.updateOne(
        { _id: receivingId, license: new ObjectId(license) },
        { $set: updateData }
      );

      return {
        status: true,
        data: updateResult.modifiedCount,
        message: 'Receiving updated successfully',
      };
    }
  } catch (error) {
    console.error('Error in receivingInsertUpdate:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to process return receiving',
    };
  }
};

/**
 * PHP: deleteReceivingCollectionData()
 * Delete receiving orders and update inventory
 * @param {Array} ids - Array of receiving IDs to delete
 * @returns {Promise<Object>}
 */
receivingSchema.statics.deleteReceivingCollectionData = async function (ids) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');

    const baseModel = new BaseModel('receivings');
    const collection = await baseModel.getCollection('receivings');
    const itemsCollection = await baseModel.getCollection('items');

    const license = BaseModel.license;
    const loggedUser = BaseModel.loggedUser;
    const loggedUserName = BaseModel.loggedUserName || '';
    const currentBranch = BaseModel.currentBranch;

    console.log('🗑️ deleteReceivingCollectionData - Input IDs:', ids);
    console.log('🗑️ deleteReceivingCollectionData - License:', license);
    console.log(
      '🗑️ deleteReceivingCollectionData - License type:',
      typeof license,
      license?.constructor?.name
    );

    // Convert IDs to ObjectId array
    const objectIds = ids.map((id) => {
      if (id instanceof ObjectId) return id;
      if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
      if (id._bsontype === 'ObjectId') return new ObjectId(id.toString());
      return id;
    });

    console.log('🗑️ deleteReceivingCollectionData - ObjectIds:', objectIds);

    // Convert license to ObjectId if needed
    let licenseObjectId;
    if (license instanceof ObjectId) {
      licenseObjectId = license;
    } else if (typeof license === 'string' && ObjectId.isValid(license)) {
      licenseObjectId = new ObjectId(license);
    } else if (license && license._bsontype === 'ObjectId') {
      licenseObjectId = new ObjectId(license.toString());
    } else {
      licenseObjectId = license;
    }

    // Find receivings to delete
    const condition = {
      $and: [{ _id: { $in: objectIds } }, { license: licenseObjectId }],
    };

    console.log(
      '🗑️ deleteReceivingCollectionData - Condition:',
      JSON.stringify(condition, null, 2)
    );

    const receivings = await collection.find(condition).toArray();

    console.log('🗑️ deleteReceivingCollectionData - Found receivings:', receivings.length);

    // Backup receivings to recycle_bin before deletion
    for (const receiving of receivings) {
      await BaseModel.deletedDocumentBackup('receivings', receiving);
    }
    console.log(
      '🗑️ deleteReceivingCollectionData - Backed up',
      receivings.length,
      'receivings to recycle_bin'
    );

    // Get branch to check stock_management setting (PHP line 960)
    const branchesCollection = await baseModel.getCollection('branches');
    const branchDoc = await branchesCollection.findOne({
      _id: new ObjectId(currentBranch),
    });

    const stockManagement = branchDoc?.stock_management === true;
    const stockLogStatus = branchDoc?.stock_management_log !== false;

    console.log('[DELETE RECEIVING DEBUG] Stock log context:', {
      stockManagement: stockManagement,
      stockLogStatus: stockLogStatus,
      receivingCount: receivings.length,
    });

    // Process each receiving
    for (const receiving of receivings) {
      // Update inventory if status is 'Received'
      if (receiving.receiving_status === 'Received' && receiving.items) {
        for (const item of receiving.items) {
          const itemId = new ObjectId(item.item_id);
          const itemQuantity = parseFloat(item.item_quantity || 0);

          const itemDoc = await itemsCollection.findOne({
            _id: itemId,
            license: new ObjectId(license),
          });

          console.log('[DELETE RECEIVING DEBUG] Item check:', {
            item_id: item.item_id,
            track_inventory: itemDoc?.track_inventory,
            track_inventory_type: typeof itemDoc?.track_inventory,
          });

          // PHP checks: $itemdocuments['track_inventory'] === true (boolean or string 'true')
          if (itemDoc && (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')) {
            const openingBalance = parseFloat(itemDoc.available_quantity || 0);
            const newQuantity = openingBalance - itemQuantity;

            // Create stock log for DELETE Receiving (PHP line 960-962)
            // Only if stock_management is enabled
            if (stockManagement) {
              console.log('[DELETE RECEIVING DEBUG] Creating stock log for item:', item.item_id);

              const stockLogData = {
                stocklog: stockLogStatus,
                branch_id: new ObjectId(currentBranch),
                view_item_id: itemId,
                item_barcode_id: item.barcode_id || itemDoc.barcode_id || '',
                item_name: item.item_name || itemDoc.name || '',
                item_quantity: itemQuantity,
                process: 'Delete Receiving',
                reference: receiving.receiving_id || '',
                opening_balance: openingBalance,
                closing_balance: newQuantity,
                count: '-' + itemQuantity,
                date: new Date(),
                action: 'Subtract',
                changed_by_userid: new ObjectId(loggedUser),
                changed_by: loggedUserName,
                license: new ObjectId(license),
                created_date: new Date(),
                updated_date: new Date(),
              };

              const stockLogsCollection = await baseModel.getCollection('stocklogs');
              await stockLogsCollection.insertOne(stockLogData);
              console.log('[DELETE RECEIVING] Stock log created successfully');
            } else {
              console.log('[DELETE RECEIVING DEBUG] Stock management disabled, skipping stock log');
            }

            await itemsCollection.updateOne(
              { _id: itemId, license: new ObjectId(license) },
              { $set: { available_quantity: newQuantity } }
            );
          }
        }
      }
    }

    // Delete the receivings
    const deleteResult = await collection.deleteMany(condition);

    return {
      status: true,
      data: deleteResult.deletedCount,
      message: 'success',
    };
  } catch (error) {
    console.error('Error in deleteReceivingCollectionData:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to delete receiving',
    };
  }
};

/**
 * PHP: exportReceivingsOrder()
 * Export receiving data by IDs with specific fields only
 * @param {Array} ids - Array of receiving IDs to export
 * @returns {Promise<Object>}
 */
receivingSchema.statics.exportReceivingsOrder = async function (ids) {
  try {
    const BaseModel = require('./base.model');
    const { ObjectId } = require('mongodb');

    const baseModel = new BaseModel('receivings');
    const collection = await baseModel.getCollection('receivings');

    const license = BaseModel.license;

    // Convert IDs to ObjectId array
    const objectIds = ids.map((id) => {
      if (id instanceof ObjectId) return id;
      if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
      if (id._bsontype === 'ObjectId') return new ObjectId(id.toString());
      return id;
    });

    // Convert license to ObjectId if needed
    let licenseObjectId;
    if (license instanceof ObjectId) {
      licenseObjectId = license;
    } else if (typeof license === 'string' && ObjectId.isValid(license)) {
      licenseObjectId = new ObjectId(license);
    } else if (license && license._bsontype === 'ObjectId') {
      licenseObjectId = new ObjectId(license.toString());
    } else {
      licenseObjectId = license;
    }

    // Find receivings to export with specific fields only
    const receivings = await collection
      .find(
        {
          _id: { $in: objectIds },
          license: licenseObjectId,
        },
        {
          projection: {
            receiving_id: 1,
            supplier_name: 1,
            supplier_address: 1,
            supplier_phone: 1,
            supplier_email: 1,
            payment_mode: 1,
            payment_description: 1,
            subtotal_amount: 1,
            total_amount: 1,
          },
        }
      )
      .sort({ _id: -1 })
      .toArray();

    return {
      status: true,
      data: receivings,
      message: 'Receiving Data Exported',
    };
  } catch (error) {
    console.error('Error in exportReceivingsOrder:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to export receivings',
    };
  }
};

/**
 * PHP: returnPrintDetailsPage()
 * Get return receiving print details by return ID
 * @param {String} id - Return receiving ID
 * @returns {Promise<Object>}
 */
receivingSchema.statics.returnPrintDetailsPage = async function (id) {
  try {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return { status: false, data: null, message: 'Invalid return id' };
    }

    const returnObjId = new mongoose.Types.ObjectId(id);

    const matchStage = {
      'items_return.returnArray.returnObjId': returnObjId,
    };
    if (BaseModel.license) {
      matchStage.license = BaseModel.license;
    }

    const pipeline = [
      { $match: matchStage },
      { $unwind: '$items_return' },
      { $unwind: '$items_return.returnArray' },
      { $unwind: '$items_return.returnArray.returnValue' },
      { $match: { 'items_return.returnArray.returnObjId': returnObjId } },
      {
        $project: {
          receiving_id: '$receiving_id',
          supplier_name: '$supplier_name',
          supplier_phone: '$supplier_phone',
          supplier_email: '$supplier_email',
          supplier_address: '$supplier_address',
          gst: '$gst',
          return_tax: '$return_tax',
          items_return_subtotal: '$items_return_subtotal',
          items_return_total: '$items_return_total',
          payment_mode: '$payment_mode',
          return_id: '$items_return.returnArray.returnId',
          return_date: '$items_return.returnArray.returnDate',
          item_id: '$items_return.returnArray.returnValue.item_id',
          item_name: '$items_return.returnArray.returnValue.item_name',
          item_price: '$items_return.returnArray.returnValue.item_price',
          item_quantity: '$items_return.returnArray.returnValue.item_quantity',
          item_unit: '$items_return.returnArray.returnValue.item_unit',
          tax: '$items_return.returnArray.returnValue.tax',
          igst_tax: '$items_return.returnArray.returnValue.igst_tax',
          cgst_tax: '$items_return.returnArray.returnValue.cgst_tax',
          sgst_tax: '$items_return.returnArray.returnValue.sgst_tax',
          tax_name: '$items_return.returnArray.returnValue.tax_name',
          tax_type: '$items_return.returnArray.returnValue.tax_type',
          tax_fields: '$items_return.returnArray.returnValue.tax_fields',
          total_amount: '$items_return.returnArray.returnValue.total_amount',
          roundOff: '$items_return.returnArray.roundOff',
          itemsTotalAmount: '$items_return.returnArray.itemsTotalAmount',
        },
      },
    ];

    const docs = await this.aggregate(pipeline);

    if (!docs || !docs.length) {
      return {
        status: false,
        data: null,
        message: 'Receiving Details Not Found',
      };
    }

    const numberOrZero = (value, fallback = 0) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
      const fb = Number(fallback);
      return Number.isFinite(fb) ? fb : 0;
    };

    const normalizeTaxFields = (fields) => {
      if (!Array.isArray(fields)) return [];
      return fields.map((t) => {
        if (!t || typeof t !== 'object') return t;
        const out = { ...t };
        if (out.tax_id && typeof out.tax_id === 'object' && out.tax_id.$oid) {
          return out;
        }
        let hex = null;
        if (out.tax_id instanceof mongoose.Types.ObjectId) {
          hex = out.tax_id.toString();
        } else if (typeof out.tax_id === 'string') {
          hex = out.tax_id;
        } else if (
          out.tax_id &&
          out.tax_id._bsontype === 'ObjectID' &&
          typeof out.tax_id.toString === 'function'
        ) {
          hex = out.tax_id.toString();
        }
        if (hex) {
          out.tax_id = { $oid: hex };
        }
        return out;
      });
    };

    const first = docs[0];
    const tz = BaseModel.currentTimeZone || 'Asia/Kolkata';

    // Format return date - handle MongoDB extended JSON format
    let formattedDate = '';
    if (first.return_date) {
      try {
        let dateObj;

        // Handle MongoDB extended JSON format: { $date: "ISO_STRING" } or { $date: { $numberLong: "timestamp" } }
        if (typeof first.return_date === 'object' && first.return_date !== null) {
          if (first.return_date.$date) {
            if (
              typeof first.return_date.$date === 'object' &&
              first.return_date.$date.$numberLong
            ) {
              dateObj = new Date(parseInt(first.return_date.$date.$numberLong, 10));
            } else if (typeof first.return_date.$date === 'string') {
              dateObj = new Date(first.return_date.$date);
            } else if (typeof first.return_date.$date === 'number') {
              dateObj = new Date(first.return_date.$date);
            }
          } else if (first.return_date instanceof Date) {
            dateObj = first.return_date;
          } else {
            dateObj = new Date(first.return_date);
          }
        }
        // Handle direct Date object or ISO string
        else if (typeof first.return_date === 'string') {
          dateObj = new Date(first.return_date);
        } else if (typeof first.return_date === 'number') {
          dateObj = new Date(first.return_date);
        }

        // Format the date if valid
        if (dateObj && !isNaN(dateObj.getTime())) {
          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
          const day = String(dateObj.getDate()).padStart(2, '0');
          const year = dateObj.getFullYear();
          let hours = dateObj.getHours();
          const minutes = String(dateObj.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'pm' : 'am';
          hours = hours % 12;
          hours = hours ? hours : 12;
          const hoursStr = String(hours).padStart(2, '0');
          formattedDate = `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
        }
      } catch (e) {
        console.error('Error formatting return_date:', e);
      }
    }

    const custom_data = {
      receiving_id: first.receiving_id || '',
      return_id: first.return_id || '',
      date: formattedDate || formatDate(first.date, { timeZone: tz }),
      supplier_name: first.supplier_name || '',
      supplier_phone: first.supplier_phone || '',
      supplier_email: first.supplier_email || '',
      supplier_address: first.supplier_address || '',
      gst: first.gst || '',
      tax: roundToTwo(numberOrZero(first.return_tax, 0)),
      payment_mode: first.payment_mode || '',
      receipt_barcode: true,
    };

    const return_data = docs.map((row) => {
      const taxFields = normalizeTaxFields(row.tax_fields);
      return {
        item_id: row.item_id,
        item_name: row.item_name,
        item_quantity: numberOrZero(row.item_quantity, 0),
        item_price: numberOrZero(row.item_price, 0),
        item_total_amount: numberOrZero(row.total_amount, 0),
        item_tax: numberOrZero(row.tax, 0),
        item_tax_name: row.tax_name || '',
        item_tax_type: row.tax_type || 'exclusive',
        item_tax_fields: taxFields,
        item_igst_tax: numberOrZero(row.igst_tax, 0),
        item_cgst_tax: numberOrZero(row.cgst_tax, 0),
        item_sgst_tax: numberOrZero(row.sgst_tax, 0),
        item_unit: row.item_unit && typeof row.item_unit === 'string' ? row.item_unit : 'qty',
        roundOff: numberOrZero(row.roundOff, 0),
        itemsTotalAmount: numberOrZero(row.itemsTotalAmount, 0),
      };
    });

    return {
      status: true,
      data: { custom_data, return_data },
      message: 'Get detail successfully',
    };
  } catch (error) {
    console.error('Error in returnPrintDetailsPage:', error);
    return { status: false, data: null, message: error.message };
  }
};

const Receiving = mongoose.model('Receiving', receivingSchema);
Receiving.returnReceivingProductReportPage =
  receivingSchema.statics.returnReceivingProductReportPage;
Receiving.productBasedReceivingReturnReportPage =
  receivingSchema.statics.productBasedReceivingReturnReportPage;
Receiving.supplierReceivingReportPage = receivingSchema.statics.supplierReceivingReportPage;
Receiving.receivingReportPage = receivingSchema.statics.receivingReportPage;
Receiving.receivingsGraphicalReports = receivingSchema.statics.receivingsGraphicalReports;
Receiving.getReceivingOrder = receivingSchema.statics.getReceivingOrder;
Receiving.receivingInsertUpdate = receivingSchema.statics.receivingInsertUpdate;
const { returnReceivingOrder } = require('./receiving-return.model');
Receiving.returnReceivingOrder = returnReceivingOrder;
Receiving.deleteReceivingCollectionData = receivingSchema.statics.deleteReceivingCollectionData;
Receiving.exportReceivingsOrder = receivingSchema.statics.exportReceivingsOrder;

/**
 * PHP: gstNineReportPage()
 * Generate GST-9 report
 */
Receiving.gstNineReportPage = async function (data) {
  try {
    const { starting_date, ending_date, branch_id, license } = data;
    const FromDate = new Date(starting_date);
    const ToDate = new Date(ending_date);

    const salesCollection = mongoose.connection.collection('sales');
    const receivingsCollection = mongoose.connection.collection('receivings');

    // Unregister sales details (consumer)
    const filters = {
      $and: [
        { branch_id: new ObjectId(branch_id), customer_gst_type: { $in: ['consumer'] } },
        {
          date: { $gte: FromDate, $lte: ToDate },
          gst: 'enable',
          'items.tax': { $gt: 0 },
          license: new ObjectId(license),
        },
      ],
    };

    const sales_detail = await salesCollection
      .aggregate([
        { $unwind: '$items' },
        { $match: filters },
        {
          $group: {
            _id: {
              subtotal_amount: '$items_subtotal',
              customer_gst_type: '$customer_gst_type',
              igst_tax: '$items.igst_tax',
              cgst_tax: '$items.cgst_tax',
              sgst_tax: '$items.sgst_tax',
            },
            tax: { $sum: '$items.tax' },
            csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    let sale_subamount = 0;
    let sale_igst = 0;
    let sale_cgst = 0;
    let sale_sgst = 0;
    for (const c of sales_detail) {
      const sales_multiple_value = c._id.igst_tax + c.csgst_multiply;
      sale_subamount += Math.round((c._id.subtotal_amount - sales_multiple_value) * 100) / 100;
      sale_cgst += c._id.cgst_tax;
      sale_igst += c._id.igst_tax;
      sale_sgst += c._id.sgst_tax;
    }

    // Register, composite sales
    const register_filters = {
      $and: [
        {
          branch_id: new ObjectId(branch_id),
          customer_gst_type: { $in: ['regular', 'composite'] },
        },
        {
          date: { $gte: FromDate, $lte: ToDate },
          gst: 'enable',
          'items.tax': { $gt: 0 },
          license: new ObjectId(license),
        },
      ],
    };

    const sales_regular_detail = await salesCollection
      .aggregate([
        { $unwind: '$items' },
        { $match: register_filters },
        {
          $group: {
            _id: {
              subtotal_amount: '$items_subtotal',
              customer_gst_type: '$customer_gst_type',
              igst_tax: '$items.igst_tax',
              cgst_tax: '$items.cgst_tax',
              sgst_tax: '$items.sgst_tax',
            },
            tax: { $sum: '$items.tax' },
            csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    let sale_regular_subamount = 0;
    let sale_regular_igst = 0;
    let sale_regular_cgst = 0;
    let sale_regular_sgst = 0;
    for (const c of sales_regular_detail) {
      sale_regular_subamount += Math.round(c._id.subtotal_amount * 100) / 100;
      sale_regular_cgst += c._id.cgst_tax;
      sale_regular_igst += c._id.igst_tax;
      sale_regular_sgst += c._id.sgst_tax;
    }

    // Tax value zero sales
    const tax_filter = {
      $and: [
        { branch_id: new ObjectId(branch_id) },
        {
          date: { $gte: FromDate, $lte: ToDate },
          gst: 'enable',
          'items.tax': { $lte: 0 },
          license: new ObjectId(license),
        },
      ],
    };

    const sales_tax = await salesCollection
      .aggregate([
        { $unwind: '$items' },
        { $match: tax_filter },
        {
          $group: {
            _id: {
              sales_id: '$sales_id',
              sub_amount: '$items_subtotal',
              igst_tax: '$items.igst_tax',
              cgst_tax: '$items.cgst_tax',
              sgst_tax: '$items.sgst_tax',
            },
            tax: { $sum: '$items.tax' },
            csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    let zerotax_subamount = 0;
    let zerotax_igst = 0;
    let zerotax_cgst = 0;
    let zerotax_sgst = 0;
    for (const c of sales_tax) {
      const sales_multiple_value = c._id.igst_tax + c.csgst_multiply;
      zerotax_subamount += Math.round((c._id.sub_amount - sales_multiple_value) * 100) / 100;
      zerotax_cgst += c._id.cgst_tax;
      zerotax_igst += c._id.igst_tax;
      zerotax_sgst += c._id.sgst_tax;
    }

    // Purchase register tax payer details
    const purchase_filters = {
      $and: [
        { branch_id: new ObjectId(branch_id), supplier_gst_type: { $in: ['regular'] } },
        {
          date: { $gte: FromDate, $lte: ToDate },
          receiving_status: 'Received',
          gst: 'enable',
          license: new ObjectId(license),
        },
      ],
    };

    const purchase_detail = await receivingsCollection
      .aggregate([
        { $unwind: '$items' },
        { $match: purchase_filters },
        {
          $group: {
            _id: {
              item_receiving_id: '$receiving_id',
              subtotal_amount: { $sum: '$items.total_amount' },
              item_tax: '$items.tax',
              item_total: '$items.total_amount',
              igst_tax: '$items.igst_tax',
              cgst_tax: '$items.cgst_tax',
              sgst_tax: '$items.sgst_tax',
              csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    let purchase_subtotal = 0;
    let purchase_igst = 0;
    let purchase_cgst = 0;
    let purchase_sgst = 0;
    for (const c of purchase_detail) {
      purchase_igst += c._id.igst_tax;
      purchase_cgst += c._id.cgst_tax;
      purchase_sgst += c._id.sgst_tax;
      const purchase_multiple_value = c._id.igst_tax + c._id.csgst_multiply;
      purchase_subtotal +=
        Math.round((c._id.subtotal_amount - purchase_multiple_value) * 100) / 100;
    }

    // Purchase composite tax payer details
    const composite_filters = {
      $and: [
        { branch_id: new ObjectId(branch_id), supplier_gst_type: { $in: ['composite'] } },
        {
          date: { $gte: FromDate, $lte: ToDate },
          receiving_status: 'Received',
          gst: 'enable',
          license: new ObjectId(license),
        },
      ],
    };

    const purchase_composite_info = await receivingsCollection
      .aggregate([
        { $unwind: '$items' },
        { $match: composite_filters },
        {
          $group: {
            _id: {
              item_receiving_id: '$receiving_id',
              subtotal_amount: { $sum: '$items.total_amount' },
              item_tax: '$items.tax',
              item_total: '$items.total_amount',
              item_igst_tax: '$items.igst_tax',
              item_cgst_tax: '$items.cgst_tax',
              item_sgst_tax: '$items.sgst_tax',
              csgst_multiply: { $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] } },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    let purchase_com_subtotal = 0;
    for (const c of purchase_composite_info) {
      const purchase_multiple_value = c._id.item_igst_tax + c._id.csgst_multiply;
      purchase_com_subtotal +=
        Math.round((c._id.subtotal_amount - purchase_multiple_value) * 100) / 100;
    }

    const arrTableData = {
      sub_amount: sale_subamount,
      igst: sale_igst,
      cgst: sale_cgst,
      sgst: sale_sgst,
      sale_sub_amount: sale_regular_subamount,
      sale_igst: sale_regular_igst,
      sale_cgst: sale_regular_cgst,
      sale_sgst: sale_regular_sgst,
      zero_sub_amount: zerotax_subamount,
      zero_igst: zerotax_igst,
      zero_cgst: zerotax_cgst,
      zero_sgst: zerotax_sgst,
      purchase_igst: purchase_igst,
      purchase_cgst: purchase_cgst,
      purchase_sgst: purchase_sgst,
      purchase_subamount: purchase_subtotal,
      composite_subtotal: purchase_com_subtotal,
    };

    return {
      status: true,
      data: arrTableData,
      message: 'success',
    };
  } catch (error) {
    console.error('Error in gstNineReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

module.exports = Receiving;
