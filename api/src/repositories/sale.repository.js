const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const { formatDate } = require('../utils/helpers');
const StockLogsRepository = require('./stock-log.repository');
const { PAYMENT_STATUS } = require('../constants');

const activeTenantFilter = () => ({
  ...(BaseModel.license ? { license: BaseModel.license } : {}),
  ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
});

const round = (value, decimals = 2) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return value && !Number.isNaN(value) ? Math.round(value * factor) / factor : 0;
};

const toNumberSafe = (value, fallback = 0) => {
  if (value === null || typeof value === 'undefined') {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === 'null' || trimmed === 'nan') {
      return 0;
    }
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : 0;
  }

  const fb = Number(fallback);
  return Number.isFinite(fb) ? fb : 0;
};

const roundQty = (value) => Math.round(toNumberSafe(value, 0) * 1000) / 1000;

const normalizeReturnItemKey = (item = {}) =>
  String(item.item_id || item.item || item.id || item._id || '');

const addQtyToMap = (map, key, qty) => {
  if (!key) return;
  map.set(key, roundQty((map.get(key) || 0) + roundQty(qty)));
};

const buildReturnedQtyMap = (itemsReturnBlocks = []) => {
  const returned = new Map();
  if (!Array.isArray(itemsReturnBlocks)) return returned;

  for (const block of itemsReturnBlocks) {
    const values = block?.returnArray?.returnValue;
    if (!Array.isArray(values)) continue;

    for (const item of values) {
      addQtyToMap(returned, normalizeReturnItemKey(item), item.item_quantity);
    }
  }

  return returned;
};

const buildReturnSignature = (saleObjectId, returnItems = [], payload = {}) => {
  const normalizedItems = (Array.isArray(returnItems) ? returnItems : [])
    .map((item) => ({
      item_id: normalizeReturnItemKey(item),
      qty: roundQty(item.item_quantity),
      price: round(toNumberSafe(item.item_price, 0), 2),
      total: round(toNumberSafe(item.total_amount, 0), 2),
    }))
    .filter((item) => item.item_id && item.qty > 0)
    .sort((a, b) => a.item_id.localeCompare(b.item_id));

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        sale_id: String(saleObjectId),
        items: normalizedItems,
        extra_discount: round(toNumberSafe(payload.extra_discount, 0), 2),
        extra_discount_type: payload.extra_discount_type || '',
        round_off_check: Boolean(payload.round_off_check),
      })
    )
    .digest('hex');
};

class SalesRepository {
  constructor(defaultModel) {
    this.defaultModel = defaultModel || null;
  }

  getModel(SaleModel) {
    if (SaleModel) {
      return SaleModel;
    }

    if (!this.defaultModel) {
      this.defaultModel = require('../models/sale.model');
    }

    return this.defaultModel;
  }

  async create(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    const doc = new Model(data);
    await doc.save();
    return doc;
  }

  async paginate(filter, options, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.paginate(filter, options);
  }

  async getLegacyDetails(id, { SaleModel } = {}) {
    try {
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return { status: false, data: null, message: 'Invalid sale id' };
      }

      const saleObjectId = new mongoose.Types.ObjectId(id);
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');
      const recycleBinCollection = db.collection('recycle_bin');
      const customersCollection = db.collection('customers');
      const branchesCollection = db.collection('branches');

      const filter = {
        _id: saleObjectId,
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
        ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      };

      let saleDoc = await salesCollection.findOne(filter);

      // Fallback for deleted sales: if the sale is not present in the live
      // `sales` collection, try to load a backup copy from the
      // `recycle_bin`. This enables viewing / printing sales that have been
      // moved to the Recycle Bin while keeping the primary behaviour
      // unchanged for active sales.
      if (!saleDoc) {
        const recycleFilter = {
          _id: saleObjectId,
          document_name: 'sales',
          ...(BaseModel.license ? { license: BaseModel.license } : {}),
        };

        const backupDoc = await recycleBinCollection.findOne(recycleFilter);

        if (!backupDoc) {
          return { status: false, data: null, message: 'Sale not found' };
        }

        saleDoc = backupDoc;
      }

      const doc = { ...saleDoc };

      // Normalise legacy extra discount fields so that the sales edit and
      // return screens always receive meaningful values, even for older
      // PHP-created sales that only stored sale_extra_discount.
      const rawExtraDiscValue =
        doc.extra_discount !== undefined && doc.extra_discount !== null
          ? Number(doc.extra_discount)
          : 0;
      const rawSaleExtraDiscValue =
        doc.sale_extra_discount !== undefined && doc.sale_extra_discount !== null
          ? Number(doc.sale_extra_discount)
          : 0;

      const extraDiscNum = Number.isFinite(rawExtraDiscValue) ? rawExtraDiscValue : 0;
      const saleExtraDiscNum = Number.isFinite(rawSaleExtraDiscValue) ? rawSaleExtraDiscValue : 0;

      let extraDiscountTypeRaw =
        typeof doc.extra_discount_type === 'string'
          ? doc.extra_discount_type.toLowerCase().trim()
          : '';

      // Map legacy labels to the values expected by the frontend helpers
      if (extraDiscountTypeRaw === 'percentage') {
        extraDiscountTypeRaw = 'percent';
      } else if (extraDiscountTypeRaw === 'fixed' || extraDiscountTypeRaw === 'amount') {
        extraDiscountTypeRaw = 'price';
      }

      if (extraDiscountTypeRaw) {
        doc.extra_discount_type = extraDiscountTypeRaw;
      }

      // For legacy amount-based discounts that only persisted the final
      // sale_extra_discount, backfill extra_discount so the edit form can
      // display the correct value. Percent-based discounts already store the
      // input percentage in extra_discount, so we leave those untouched.
      if (
        (typeof doc.extra_discount === 'undefined' ||
          doc.extra_discount === null ||
          extraDiscNum === 0) &&
        saleExtraDiscNum > 0 &&
        extraDiscountTypeRaw !== 'percent'
      ) {
        doc.extra_discount = saleExtraDiscNum;
      }

      const rawSaleGst =
        doc.gst !== undefined && doc.gst !== null ? String(doc.gst).toLowerCase() : '';
      const isSaleGstEnabled = rawSaleGst === 'enable' || rawSaleGst === 'gst_on';

      // Backfill legacy note fields for Node-created sales so that
      // sales_view.js can always rely on sales_description and
      // payment_description even when only generic notes + payments
      // were stored by the Node controllers.
      if (
        (typeof doc.sales_description === 'undefined' ||
          doc.sales_description === null ||
          (typeof doc.sales_description === 'string' && !doc.sales_description.trim())) &&
        typeof doc.notes === 'string' &&
        doc.notes.trim()
      ) {
        doc.sales_description = doc.notes;
      }

      if (
        typeof doc.payment_description === 'undefined' ||
        doc.payment_description === null ||
        (typeof doc.payment_description === 'string' && !doc.payment_description.trim())
      ) {
        let paymentNote = '';
        if (Array.isArray(doc.payments) && doc.payments.length > 0) {
          const firstPayment = doc.payments[0] || {};
          if (typeof firstPayment.reference === 'string' && firstPayment.reference.trim()) {
            paymentNote = firstPayment.reference.trim();
          } else if (typeof firstPayment.notes === 'string' && firstPayment.notes.trim()) {
            paymentNote = firstPayment.notes.trim();
          }
        }

        if (paymentNote) {
          doc.payment_description = paymentNote;
        }
      }

      // Legacy screens expect these identifiers
      if (!doc.sales_id && doc.invoice_number) {
        doc.sales_id = doc.invoice_number;
      }
      if (!doc.invoice_number && doc.sales_id) {
        doc.invoice_number = doc.sales_id;
      }
      if (!doc.sale_no) {
        doc.sale_no = doc.sales_id || doc.invoice_number || (doc._id ? doc._id.toString() : '');
      }

      let branchDoc = null;
      let branchHasGstOn = false;
      const branchId = doc.branch_id || doc.branch || BaseModel.currentBranch || null;

      if (branchId) {
        let normalizedBranchId = branchId;
        if (branchId instanceof mongoose.Types.ObjectId) {
          normalizedBranchId = branchId;
        } else if (mongoose.Types.ObjectId.isValid(String(branchId))) {
          normalizedBranchId = new mongoose.Types.ObjectId(String(branchId));
        }

        branchDoc = await branchesCollection.findOne({
          _id: normalizedBranchId,
          ...(BaseModel.license ? { license: BaseModel.license } : {}),
        });
        if (branchDoc && branchDoc._id) {
          doc.branch_id = branchDoc._id;

          // Track whether this branch has Indian GST enabled so that the
          // legacy sales view model can mirror PHP behaviour and always
          // enable the GST card whenever GST is configured for the branch.
          //
          // Primary signal: explicit indian_gst === 'gst_on'.
          const rawIndianGst =
            typeof branchDoc.indian_gst === 'string' ? branchDoc.indian_gst.toLowerCase() : '';
          const hasExplicitGstOn = rawIndianGst === 'gst_on';

          // Fallback signal: Indian branch with a configured GSTIN number.
          // Some historical records or UI flows may persist only the GSTIN
          // without explicitly updating indian_gst. In that scenario PHP
          // still treats the branch as GST-enabled, so we mirror that here.
          const country = (branchDoc.country || '').toString().toLowerCase().trim();
          const rawBranchGstin =
            typeof branchDoc.branch_gstin_number === 'string'
              ? branchDoc.branch_gstin_number.trim()
              : '';
          const hasGstinNumber = rawBranchGstin !== '';

          if (hasExplicitGstOn || (country === 'india' && hasGstinNumber)) {
            branchHasGstOn = true;
          }

          // Expose branch-level GSTIN and printing address on the sale doc so that
          // legacy frontend views (sales_view.js) and print templates can access
          // them without issuing a separate branch query. Only backfill these
          // fields when the sale document itself does not already carry values.
          if (
            hasGstinNumber &&
            (typeof doc.branch_gstin_number === 'undefined' ||
              doc.branch_gstin_number === null ||
              (typeof doc.branch_gstin_number === 'string' && !doc.branch_gstin_number.trim()))
          ) {
            doc.branch_gstin_number = rawBranchGstin;
          }

          if (
            typeof doc.printing_address === 'undefined' ||
            doc.printing_address === null ||
            (typeof doc.printing_address === 'string' && !doc.printing_address.trim())
          ) {
            if (typeof branchDoc.printing_address === 'string') {
              doc.printing_address = branchDoc.printing_address;
            }
          }
        }
      }

      let print_sale_notes = false;
      let customer_print = true;
      let print_logoimg = false;
      let receipt_barcode = true;
      let logo = '';
      if (branchDoc) {
        if (typeof branchDoc.print_sale_notes === 'boolean') {
          print_sale_notes = branchDoc.print_sale_notes;
        }
        if (typeof branchDoc.customer_print === 'boolean') {
          customer_print = branchDoc.customer_print;
        }
        if (typeof branchDoc.print_logoimg === 'boolean') {
          print_logoimg = branchDoc.print_logoimg;
        }
        if (typeof branchDoc.receipt_barcode === 'boolean') {
          receipt_barcode = branchDoc.receipt_barcode;
        }
        if (branchDoc.logo) {
          logo = branchDoc.logo;
        }
      }

      doc.customer_print = customer_print;
      doc.print_logoimg = print_logoimg;
      doc.print_sale_notes = print_sale_notes;
      doc.receipt_barcode = receipt_barcode;
      if (logo && !doc.logo) {
        doc.logo = logo;
      }

      let customerObjectId = null;
      if (doc.customer_id) {
        if (doc.customer_id instanceof mongoose.Types.ObjectId) {
          customerObjectId = doc.customer_id;
        } else if (mongoose.Types.ObjectId.isValid(String(doc.customer_id))) {
          customerObjectId = new mongoose.Types.ObjectId(String(doc.customer_id));
        }
      } else if (doc.customer) {
        if (doc.customer instanceof mongoose.Types.ObjectId) {
          customerObjectId = doc.customer;
        } else if (mongoose.Types.ObjectId.isValid(String(doc.customer))) {
          customerObjectId = new mongoose.Types.ObjectId(String(doc.customer));
        }
        if (customerObjectId && !doc.customer_id) {
          doc.customer_id = customerObjectId;
        }
      }

      if (customerObjectId) {
        const customerFilter = {
          _id: customerObjectId,
          ...(BaseModel.license ? { license: BaseModel.license } : {}),
          ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
        };

        const customerData = await customersCollection.findOne(customerFilter);

        if (customerData) {
          doc.customer_name = doc.customer_name || customerData.name || '';
          doc.customer_phone = doc.customer_phone || customerData.phone || '';
          doc.customer_email = doc.customer_email || customerData.email || '';
          doc.customer_address = doc.customer_address || customerData.address || '';
          doc.customer_state = doc.customer_state || customerData.state || '';
          doc.customer_country = customerData.country || doc.customer_country || '';
          doc.customer_gst_type = doc.customer_gst_type || customerData.gst_type || '';
          doc.customer_gst_number = doc.customer_gst_number || customerData.gst_number || '';
          const balanceValue =
            typeof customerData.balance === 'number'
              ? customerData.balance
              : Number(customerData.balance || 0) || 0;
          doc.customer_balance = balanceValue;

          const rawPartial = customerData.partial_balance;
          let customerPartial = false;
          if (typeof rawPartial === 'boolean') {
            customerPartial = rawPartial;
          } else if (typeof rawPartial === 'string') {
            const trimmed = rawPartial.trim().toLowerCase();
            customerPartial = trimmed === 'true' || trimmed === '1';
          } else if (typeof rawPartial === 'number') {
            customerPartial = rawPartial === 1;
          }
          doc.customer_partial = customerPartial;
        }
      }

      if (typeof doc.customer_balance === 'undefined') {
        doc.customer_balance = 0.0;
      }

      // Normalize nested structures to match legacy PHP Extended JSON expectations
      // used by sales_view.js, particularly for tax fields and return items.

      // Helper to wrap ObjectId/string into { $oid: "..." }
      const wrapObjectIdForLegacy = (value) => {
        if (!value) return value;
        // If already in { $oid: ... } form, keep as-is
        if (typeof value === 'object' && value.$oid) {
          return value;
        }

        let hex = null;
        if (value instanceof mongoose.Types.ObjectId) {
          hex = value.toString();
        } else if (typeof value === 'string') {
          hex = value;
        } else if (
          typeof value === 'object' &&
          value._bsontype === 'ObjectID' &&
          typeof value.toString === 'function'
        ) {
          // Raw BSON ObjectId from mongodb driver
          hex = value.toString();
        }

        if (!hex) return value;
        return { $oid: hex };
      };

      // Helper to wrap Date/number/string into { $date: { $numberLong: "..." } }
      const wrapDateForLegacy = (value) => {
        if (!value) return value;

        // Already in legacy extended JSON
        if (
          typeof value === 'object' &&
          value.$date &&
          typeof value.$date === 'object' &&
          Object.prototype.hasOwnProperty.call(value.$date, '$numberLong')
        ) {
          return value;
        }

        let dateObj = null;
        if (value instanceof Date) {
          dateObj = value;
        } else if (typeof value === 'number') {
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) dateObj = d;
        } else if (typeof value === 'string') {
          const ts = Date.parse(value);
          if (!Number.isNaN(ts)) {
            dateObj = new Date(ts);
          }
        }

        if (!dateObj) return value;

        return {
          $date: {
            $numberLong: String(dateObj.getTime()),
          },
        };
      };

      // Helper to safely coerce discount/tax/amount fields that may be
      // null, empty strings, or legacy string values like "null" into
      // numeric zeros. This prevents the sales_view.js templates from
      // rendering "null%" in the Return Line Item card.
      const toNumberSafeLocal = (value, fallback = 0) => {
        if (value === null || typeof value === 'undefined') {
          return 0;
        }
        if (typeof value === 'number') {
          return Number.isFinite(value) ? value : 0;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim().toLowerCase();
          if (!trimmed || trimmed === 'null' || trimmed === 'nan') {
            return 0;
          }
          const num = Number(trimmed);
          return Number.isFinite(num) ? num : 0;
        }

        const fb = Number(fallback);
        return Number.isFinite(fb) ? fb : 0;
      };

      // Build a lookup of item_id -> item_price from return line items so that
      // fully returned lines in the main items array (which may have quantity 0
      // and item_price 0) can still display a meaningful price in the Line Item
      // section of sales_view.js.
      const returnPriceByItemId = new Map();
      if (Array.isArray(doc.items_return)) {
        doc.items_return.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return;
          const ra =
            entry.returnArray && typeof entry.returnArray === 'object' ? entry.returnArray : null;
          if (!ra || !Array.isArray(ra.returnValue)) return;

          ra.returnValue.forEach((line) => {
            if (!line || typeof line !== 'object') return;
            const rawId = line.item_id || line.item || line.itemId;
            if (!rawId) return;
            const key = String(rawId);
            const price = toNumberSafeLocal(line.item_price, 0);
            if (price > 0 && !returnPriceByItemId.has(key)) {
              returnPriceByItemId.set(key, price);
            }
          });
        });
      }

      // Build a lookup of item_id -> HSN/tax code from the items collection so
      // that legacy sales that never persisted tax_name on line items (only
      // hsncode on the item master) can still display the correct HSN-like code
      // in the Tax Details block.
      const itemHsnById = new Map();
      if (Array.isArray(doc.items) && doc.items.length) {
        const uniqueItemObjectIds = [];
        const seenItemIds = new Set();

        for (const line of doc.items) {
          if (!line || typeof line !== 'object') continue;
          const rawId = line.item_id || line.item || line.itemId;
          if (!rawId) continue;
          const idStr = String(rawId);
          if (!mongoose.Types.ObjectId.isValid(idStr)) continue;
          if (seenItemIds.has(idStr)) continue;
          seenItemIds.add(idStr);
          uniqueItemObjectIds.push(new mongoose.Types.ObjectId(idStr));
        }

        if (uniqueItemObjectIds.length) {
          const itemsCollection = db.collection('items');
          const itemFilter = { _id: { $in: uniqueItemObjectIds } };
          if (BaseModel.license) {
            itemFilter.license = BaseModel.license;
          }
          if (BaseModel.currentBranch) {
            itemFilter.branch_id = BaseModel.currentBranch;
          }
          if (BaseModel.currentBranchName) {
            itemFilter.branch_name = BaseModel.currentBranchName;
          }

          const itemDocs = await itemsCollection.find(itemFilter).toArray();

          itemDocs.forEach((it) => {
            if (!it || !it._id) return;
            const key = String(it._id);

            // Only treat explicit HSN fields as HSN/tax codes for the
            // purposes of non-GST Tax Details. Falling back to tax_name here
            // would incorrectly classify simple percentage taxes (e.g. "5% Tax")
            // as HSN-based and cause the Tax Details block to appear even when
            // there is no HSN.
            const hsn = (it.hsncode || it.hsn_code || '').toString().trim();
            if (hsn) {
              itemHsnById.set(key, hsn);
            }
          });
        }
      }

      // For legacy PHP parity under non-GST flows we need to selectively
      // expose per-line tax_fields arrays:
      //   - When GST is enabled for the sale, always expose tax_fields so the
      //     GST / Tax Details cards can be built.
      //   - When GST is disabled, expose tax_fields only for:
      //       * HSN-based tax without group (single line in Tax Details)
      //       * Group tax (split component rows).
      //     Plain single-rate tax (no HSN / group) should not produce any Tax
      //     Details rows, so we will normalise tax_fields to a neutral object
      //     for those lines.

      if (Array.isArray(doc.items)) {
        doc.items = doc.items.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const cloned = { ...item };

          // Frontend legacy sales view expects PHP-style keys
          // Map from the Mongoose sale item schema fields if needed.
          if (typeof cloned.item_name === 'undefined' && typeof cloned.name !== 'undefined') {
            cloned.item_name = cloned.name;
          }
          if (
            typeof cloned.item_quantity === 'undefined' &&
            typeof cloned.quantity !== 'undefined'
          ) {
            cloned.item_quantity = cloned.quantity;
          }
          if (
            typeof cloned.item_price === 'undefined' &&
            typeof cloned.unit_price !== 'undefined'
          ) {
            cloned.item_price = cloned.unit_price;
          }
          if (
            typeof cloned.item_discount === 'undefined' &&
            typeof cloned.discount !== 'undefined'
          ) {
            cloned.item_discount = cloned.discount;
          }
          if (typeof cloned.gst === 'undefined' && typeof cloned.tax_amount !== 'undefined') {
            cloned.gst = cloned.tax_amount;
          }
          if (typeof cloned.tax_rate === 'undefined') {
            // keep
            cloned.tax_rate = cloned.item_tax_rate;
          }
          if (typeof cloned.total_amount === 'undefined' && typeof cloned.total !== 'undefined') {
            cloned.total_amount = cloned.total;
          }

          // Provide tax / discount fields used by Frontend sales_view.js.
          // Normalise tax to a pure numeric value (e.g. "0%" -> 0) so that
          // the legacy JS calculations do not end up dividing by NaN, which
          // would render the line price as 0.00 in the view modal.
          const rawTaxValue =
            typeof cloned.tax !== 'undefined'
              ? cloned.tax
              : (cloned.item_tax_rate ?? cloned.tax_rate ?? 0);
          cloned.tax = toNumberSafe(rawTaxValue, 0);

          // Canonicalise tax_type to 'exclusive' | 'inclusive' regardless of
          // how it was stored (e.g. 'Exc', 'Inc', 'exclusive', 'inclusive').
          const taxTypeSource = cloned.tax_type ?? cloned.taxType ?? 'exclusive';
          const taxTypeStr = taxTypeSource.toString().trim().toLowerCase();
          if (taxTypeStr.startsWith('inc')) {
            cloned.tax_type = 'inclusive';
          } else {
            // Default / all other prefixes map to exclusive to match PHP.
            cloned.tax_type = 'exclusive';
          }
          const hasLegacyTaxFields =
            Array.isArray(cloned.tax_fields) && cloned.tax_fields.length > 0;
          const numericTaxValue = toNumberSafe(cloned.tax, 0);

          // Prefer the existing tax_name set at save-time (PHP stores
          // $documents['tax_name'] on each line). Only backfill when
          // the sale document truly has no tax_name/HSN information.
          let currentTaxName = typeof cloned.tax_name === 'string' ? cloned.tax_name.trim() : '';

          let hsnCandidate = '';

          // Only derive HSN labels when either GST is enabled for this sale
          // or when there are no per-line tax_fields to drive the Tax Details
          // breakdown. When GST is off and tax_fields are present (group tax),
          // PHP leaves the HSN blank so the frontend shows each component
          // rate (e.g. "3% Tax", "5% Tax") instead of collapsing them under a
          // single generic "TAX X%" label.
          const shouldApplyHsnLabel = isSaleGstEnabled || !hasLegacyTaxFields;

          if (numericTaxValue > 0 && shouldApplyHsnLabel) {
            // First, prefer HSN/tax_name from the line itself
            hsnCandidate = (cloned.hsncode ?? cloned.hsn_code ?? '').toString().trim();

            if (!hsnCandidate) {
              const rawItemId = cloned.item_id || cloned.item || cloned.itemId;
              const itemKey = rawItemId ? String(rawItemId) : '';
              if (itemKey && itemHsnById.has(itemKey)) {
                hsnCandidate = itemHsnById.get(itemKey) || '';
              }
            }

            // Expose resolved HSN to the frontend so that sales_view.js can
            // reliably display HSN-based Tax Details even when legacy sales
            // never stored hsncode on the line items.
            if (hsnCandidate && !cloned.hsncode && !cloned.hsn_code) {
              cloned.hsncode = hsnCandidate;
            }

            if (!currentTaxName) {
              // No tax_name persisted: mirror PHP by using the HSN code when
              // available, otherwise fall back to a generic TAX <rate>% label.
              currentTaxName = hsnCandidate || `TAX ${numericTaxValue}%`;
            } else if (hsnCandidate) {
              // Whenever we can resolve an HSN/tax code from the item master
              // or item document, prefer that over any existing generic
              // "TAX X%" style labels so the Tax Details block matches the
              // PHP UI which shows the HSN code.
              currentTaxName = hsnCandidate;
            }
          }

          if (typeof cloned.tax_name === 'undefined' || cloned.tax_name === null) {
            cloned.tax_name = (currentTaxName || cloned.taxName || '').toString();
          } else if (currentTaxName && cloned.tax_name !== currentTaxName) {
            // Keep the upgraded HSN label if we resolved one above.
            cloned.tax_name = currentTaxName;
          }
          if (typeof cloned.igst_tax === 'undefined') {
            cloned.igst_tax = Number(cloned.igst_tax ?? cloned.igstTax ?? 0) || 0;
          }
          if (typeof cloned.cgst_tax === 'undefined') {
            cloned.cgst_tax = Number(cloned.cgst_tax ?? cloned.cgstTax ?? 0) || 0;
          }

          // For Indian GST-enabled sales that do not carry an explicit
          // IGST/CGST/SGST breakdown on the stored line item (common in
          // legacy PHP data where only a per-line GST amount was persisted),
          // reconstruct the component amounts so that the GST Tax Details
          // card in sales_view.js can mirror the PHP UI (CGST/SGST for
          // intra-state, IGST for inter-state).
          if (isSaleGstEnabled) {
            const currentIgst = toNumberSafe(cloned.igst_tax, 0);
            const currentCgst = toNumberSafe(cloned.cgst_tax, 0);
            const currentSgst = toNumberSafe(cloned.sgst_tax, 0);

            if (!currentIgst && !currentCgst && !currentSgst) {
              const perLineGstAmount = toNumberSafe(
                cloned.gst ?? cloned.tax_amount ?? cloned.item_tax ?? 0,
                0
              );

              if (perLineGstAmount > 0) {
                const customerState = (doc.customer_state || '').toString().trim();
                const branchState = (branchDoc?.state || '').toString().trim();

                const isInterState =
                  customerState &&
                  branchState &&
                  customerState.toLowerCase() !== branchState.toLowerCase();

                if (isInterState) {
                  cloned.igst_tax = perLineGstAmount;
                  cloned.cgst_tax = 0;
                  cloned.sgst_tax = 0;
                } else {
                  const half = perLineGstAmount / 2;
                  cloned.igst_tax = 0;
                  cloned.cgst_tax = half;
                  cloned.sgst_tax = half;
                }
              }
            }
          }

          // Frontend KOT updateTotalDisplay expects selling_price field
          if (typeof cloned.selling_price === 'undefined') {
            cloned.selling_price =
              Number(cloned.sale_inline_item_price ?? cloned.item_price ?? cloned.price ?? 0) || 0;
          }

          // Normalize discount fields for frontend calculations
          if (typeof cloned.discount_amount === 'undefined') {
            cloned.discount_amount =
              Number(
                cloned.sale_inline_discount_value ?? cloned.item_discount ?? cloned.discount ?? 0
              ) || 0;
          }
          if (typeof cloned.discount_percentage === 'undefined') {
            cloned.discount_percentage =
              Number(
                cloned.sale_inline_discount_pervalue ?? cloned.item_discount_percentage ?? 0
              ) || 0;
          }
          if (typeof cloned.item_discount_percentage === 'undefined') {
            cloned.item_discount_percentage =
              Number(cloned.discount_percentage ?? cloned.sale_inline_discount_pervalue ?? 0) || 0;
          }
          if (typeof cloned.item_discount === 'undefined') {
            cloned.item_discount =
              Number(
                cloned.discount_amount ?? cloned.sale_inline_discount_value ?? cloned.discount ?? 0
              ) || 0;
          }
          if (typeof cloned.item_unit === 'undefined') {
            cloned.item_unit = (
              cloned.item_unit ??
              cloned.unit ??
              cloned.unit_name ??
              'qty'
            ).toString();
          }

          if (typeof cloned.item_id === 'undefined') {
            if (cloned.item) cloned.item_id = cloned.item;
            else if (cloned.itemId) cloned.item_id = cloned.itemId;
            // A third branch assigned item_id to itself. It sat inside a block
            // that only runs when item_id is undefined, so it could never be
            // reached, and it did nothing if it had been.
          }

          if (typeof cloned.item_tax === 'undefined') {
            if (typeof cloned.gst !== 'undefined') cloned.item_tax = cloned.gst;
            else if (typeof cloned.tax_amount !== 'undefined') {
              cloned.item_tax = cloned.tax_amount;
            }
          }

          if (
            typeof cloned.item_discount_amount === 'undefined' &&
            typeof cloned.item_discount !== 'undefined'
          ) {
            cloned.item_discount_amount = cloned.item_discount;
          }

          if (typeof cloned.item_total === 'undefined') {
            if (typeof cloned.total_amount !== 'undefined') {
              cloned.item_total = cloned.total_amount;
            } else if (typeof cloned.total !== 'undefined') {
              cloned.item_total = cloned.total;
            }
          }

          // Additional aliases used by some legacy JS templates
          const qtyNum = toNumberSafe(cloned.item_quantity, 0);
          // Normalise quantity to a number so frontend code that calls
          // item_quantity.toFixed(2) (e.g. in addSalesLineItems for return
          // flows) never throws when we loaded quantities as strings like
          // "1.00" from Mongo.
          cloned.item_quantity = qtyNum;

          let priceNum = toNumberSafe(cloned.item_price, 0);

          // First, try to reconstruct price from total / quantity whenever
          // quantity is positive.
          if ((priceNum === 0 || !Number.isFinite(priceNum)) && qtyNum > 0) {
            const lineTotalCandidate =
              typeof cloned.item_total !== 'undefined'
                ? cloned.item_total
                : typeof cloned.total_amount !== 'undefined'
                  ? cloned.total_amount
                  : cloned.total;
            const lineTotalNum = toNumberSafe(lineTotalCandidate, 0);
            if (lineTotalNum > 0) {
              priceNum = lineTotalNum / qtyNum;
              cloned.item_price = priceNum;
            }
          }

          // If price is still zero (for example, fully returned items where
          // quantity is 0), fall back to the price recorded on the
          // corresponding return line.
          if (priceNum === 0 || !Number.isFinite(priceNum)) {
            let mappedPrice;

            // Primary match: by item id
            const rawItemId = cloned.item_id || cloned.item || cloned.itemId;
            if (rawItemId) {
              mappedPrice = returnPriceByItemId.get(String(rawItemId));
            }

            // Safe fallback: when there is only a single distinct return price
            // recorded (common case: one-line sale with one return), reuse that
            // price even if ids do not line up perfectly.
            if ((!mappedPrice || mappedPrice <= 0) && returnPriceByItemId.size === 1) {
              const first = returnPriceByItemId.values().next().value;
              if (typeof first !== 'undefined') {
                mappedPrice = first;
              }
            }

            if (mappedPrice && mappedPrice > 0) {
              priceNum = mappedPrice;
              cloned.item_price = mappedPrice;
            }
          }

          // At this point, ensure item_price is always a pure number. The
          // legacy sales_view.js code calls price.toFixed(2) on
          // data.items[i].item_price; if we leave item_price as a string such
          // as "25000" the browser will throw a TypeError. Keeping this field
          // numeric also matches the original PHP JSON output.
          cloned.item_price = Number.isFinite(priceNum) ? priceNum : 0;

          if (typeof cloned.price === 'undefined') {
            cloned.price = priceNum;
          }

          if (
            cloned.total_amount === null ||
            typeof cloned.total_amount === 'undefined' ||
            !Number.isFinite(Number(cloned.total_amount))
          ) {
            const effectivePrice = Number.isFinite(priceNum) ? priceNum : 0;
            cloned.total_amount = qtyNum * effectivePrice;
          } else {
            cloned.total_amount = toNumberSafe(cloned.total_amount, 0);
          }

          // Decide how to expose tax_fields to the legacy frontend.
          // When GST is enabled we always expose arrays so the GST / IGST
          // breakdown cards can be built. When GST is disabled we only want
          // Tax Details for HSN-based and group-tax lines:
          //   - Group tax  -> keep component tax_fields array
          //   - HSN single -> expose empty array so sales_view.js uses the
          //                   "length === 0 && tax > 0" branch
          //   - Plain rate -> expose neutral object so `.length` is undefined
          const hasGroupTax = hasLegacyTaxFields;
          const hasHsnLabel = Boolean(hsnCandidate);
          const hasAnyTax = numericTaxValue > 0;
          const hasTaxFieldMatchingTopLevelRate =
            Array.isArray(cloned.tax_fields) &&
            cloned.tax_fields.some((taxItem) => {
              if (!taxItem || typeof taxItem !== 'object') return false;
              const fieldValue =
                typeof taxItem.tax_value !== 'undefined'
                  ? toNumberSafe(taxItem.tax_value, NaN)
                  : toNumberSafe(taxItem.tax, NaN);
              const fieldName = (taxItem.tax_name || '').toString().trim();
              const matchesValue = Number.isFinite(fieldValue) && fieldValue === numericTaxValue;
              const matchesName = !!currentTaxName && fieldName === currentTaxName;
              return matchesValue || matchesName;
            });

          let treatAsGroupTax = hasGroupTax;
          if (
            !isSaleGstEnabled &&
            treatAsGroupTax &&
            hasAnyTax &&
            !hasHsnLabel &&
            hasTaxFieldMatchingTopLevelRate
          ) {
            treatAsGroupTax = false;
          }

          if (isSaleGstEnabled) {
            // GST enabled: keep arrays and wrap tax_id for legacy Extended JSON.
            if (Array.isArray(cloned.tax_fields)) {
              cloned.tax_fields = cloned.tax_fields.map((taxItem) => {
                if (!taxItem || typeof taxItem !== 'object') return taxItem;
                const t = { ...taxItem };
                t.tax_id = wrapObjectIdForLegacy(t.tax_id);
                return t;
              });
            } else {
              // No array stored: normalise to empty array so `.length` checks
              // in sales_view.js remain safe.
              cloned.tax_fields = [];
            }
          } else {
            // GST disabled: mirror PHP behaviour for non-GST sales.
            if (treatAsGroupTax) {
              // Group tax: keep split component breakdown.
              if (Array.isArray(cloned.tax_fields)) {
                cloned.tax_fields = cloned.tax_fields.map((taxItem) => {
                  if (!taxItem || typeof taxItem !== 'object') return taxItem;
                  const t = { ...taxItem };
                  t.tax_id = wrapObjectIdForLegacy(t.tax_id);
                  return t;
                });
              } else {
                cloned.tax_fields = [];
              }
            } else if (hasAnyTax && hasHsnLabel) {
              // HSN-coded tax without group: force an empty array so the
              // frontend uses the HSN fallback branch.
              cloned.tax_fields = [];
            } else if (hasAnyTax) {
              // Plain single tax rate (no HSN / group): neutral object hides
              // the Tax Details card because `.length` is undefined.
              cloned.tax_fields = {};
            } else {
              // No tax at all: still normalise to a neutral object so access is
              // always safe.
              cloned.tax_fields = {};
            }
          }

          return cloned;
        });
      }

      // Ensure items_return[].returnArray fields follow legacy shape and
      // normalise individual return line items early so no consumer ever
      // sees null discount/tax values.
      if (Array.isArray(doc.items_return)) {
        doc.items_return = doc.items_return.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const clonedEntry = { ...entry };

          if (clonedEntry.returnArray && typeof clonedEntry.returnArray === 'object') {
            const ra = { ...clonedEntry.returnArray };
            ra.returnDate = wrapDateForLegacy(ra.returnDate);
            ra.returnObjId = wrapObjectIdForLegacy(ra.returnObjId);

            const values = Array.isArray(ra.returnValue) ? ra.returnValue : [];
            ra.returnValue = values.map((item) => {
              if (!item || typeof item !== 'object') return item;
              const line = { ...item };

              // Coerce legacy string/null values into safe numbers so the
              // frontend never sees "null" or NaN for discount / tax fields.
              line.item_discount = toNumberSafe(line.item_discount, 0);
              line.item_discount_percentage = toNumberSafe(line.item_discount_percentage, 0);
              line.tax = toNumberSafe(line.tax, 0);
              line.igst_tax = toNumberSafe(line.igst_tax, 0);
              line.cgst_tax = toNumberSafe(line.cgst_tax, 0);
              line.sgst_tax = toNumberSafe(line.sgst_tax, 0);

              // Canonicalise tax_type and tax_name to the same shapes used by
              // the main items array so sales_view.js can safely rely on them
              // for price / GST breakdown calculations.
              const taxTypeSource = line.tax_type ?? line.taxType ?? 'exclusive';
              const taxTypeStr = taxTypeSource.toString().trim().toLowerCase();
              if (taxTypeStr.startsWith('inc')) {
                line.tax_type = 'inclusive';
              } else {
                // Default / all other prefixes map to exclusive to match PHP.
                line.tax_type = 'exclusive';
              }

              if (typeof line.tax_name === 'undefined') {
                line.tax_name = (line.tax_name ?? line.taxName ?? '').toString();
              }

              // Decide how to expose tax_fields for return lines. Behaviour
              // mirrors the main items array so that the Tax Details card shows
              // rows only for HSN-based and group-tax returns when GST is
              // disabled.
              const hasGroupTax = Array.isArray(line.tax_fields) && line.tax_fields.length > 0;
              const numericReturnTax = toNumberSafe(line.tax, 0);
              const hasAnyReturnTax = numericReturnTax > 0;
              const taxNameStr = (line.tax_name || '').toString().trim();
              const looksLikeGenericTax = /^tax\s+/i.test(taxNameStr);
              const hasHsnLabel =
                hasAnyReturnTax && !hasGroupTax && !!taxNameStr && !looksLikeGenericTax;

              if (isSaleGstEnabled) {
                if (Array.isArray(line.tax_fields)) {
                  line.tax_fields = line.tax_fields.map((taxItem) => {
                    if (!taxItem || typeof taxItem !== 'object') return taxItem;
                    const t = { ...taxItem };
                    t.tax_id = wrapObjectIdForLegacy(t.tax_id);
                    return t;
                  });
                } else {
                  line.tax_fields = [];
                }
              } else {
                if (hasGroupTax) {
                  if (Array.isArray(line.tax_fields)) {
                    line.tax_fields = line.tax_fields.map((taxItem) => {
                      if (!taxItem || typeof taxItem !== 'object') return taxItem;
                      const t = { ...taxItem };
                      t.tax_id = wrapObjectIdForLegacy(t.tax_id);
                      return t;
                    });
                  } else {
                    line.tax_fields = [];
                  }
                } else if (hasAnyReturnTax && hasHsnLabel) {
                  // HSN-based return line without group
                  line.tax_fields = [];
                } else if (hasAnyReturnTax) {
                  // Plain tax-rate return: hide Tax Details card rows.
                  line.tax_fields = {};
                } else {
                  line.tax_fields = {};
                }
              }

              if (
                line.total_amount === null ||
                typeof line.total_amount === 'undefined' ||
                !Number.isFinite(Number(line.total_amount))
              ) {
                const qty = toNumberSafe(line.item_quantity, 0);
                const price = toNumberSafe(line.item_price, 0);
                line.total_amount = qty * price;
              } else {
                line.total_amount = toNumberSafe(line.total_amount, 0);
              }

              // Normalise item_unit for safety in the return line item table.
              if (typeof line.item_unit === 'undefined' || line.item_unit === null) {
                line.item_unit = 'qty';
              }

              return line;
            });

            clonedEntry.returnArray = ra;
          }

          return clonedEntry;
        });
      }

      const normalized = BaseModel.simplifyFields(doc);

      // Ensure legacy note fields are always strings for frontend checks and
      // mirror PHP behaviour, where Sale Note / Payment Note are stored on the
      // main sales document and reused for partial/full returns.
      if (normalized && typeof normalized === 'object') {
        const firstNonEmptyString = (...values) => {
          for (const value of values) {
            if (typeof value === 'string' && value.trim() !== '') {
              return value;
            }
          }
          return '';
        };

        normalized.sales_description = firstNonEmptyString(
          normalized.sales_description,
          doc.sales_description,
          doc.notes
        );

        normalized.payment_description = firstNonEmptyString(
          normalized.payment_description,
          doc.payment_description
        );

        normalized.discount_description = firstNonEmptyString(
          normalized.discount_description,
          doc.discount_description
        );
      }

      // Ensure expected top-level totals exist for the sales view modal
      if (normalized && typeof normalized === 'object') {
        if (!Array.isArray(normalized.items_return)) {
          normalized.items_return = [];
        }

        // Ensure every items_return entry has the expected legacy shape
        if (Array.isArray(normalized.items_return) && normalized.items_return.length) {
          normalized.items_return = normalized.items_return
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null;
              const cloned = { ...entry };
              const raRaw =
                cloned.returnArray && typeof cloned.returnArray === 'object'
                  ? cloned.returnArray
                  : {};

              const ra = { ...raRaw };

              if (!ra.returnDate) {
                const dt = normalized.date || normalized.createdAt || new Date();
                const t = dt instanceof Date ? dt.getTime() : Date.parse(dt);
                ra.returnDate = {
                  $date: {
                    $numberLong: String(Number.isFinite(t) ? t : Date.now()),
                  },
                };
              }

              if (!ra.returnObjId) {
                const oid =
                  (ra.returnObjId && ra.returnObjId.$oid) ||
                  (normalized._id && normalized._id.$oid) ||
                  normalized._id ||
                  '';
                ra.returnObjId = { $oid: String(oid) };
              }

              if (!ra.returnId) {
                ra.returnId = String(ra.return_id || ra.returnId || '');
              }

              if (!Array.isArray(ra.returnValue)) {
                ra.returnValue = [];
              }

              // Normalise individual return line items so the view never
              // displays `null%` for discount or tax and always has a
              // sensible total_amount.
              ra.returnValue = ra.returnValue.map((item) => {
                if (!item || typeof item !== 'object') return item;
                const line = { ...item };

                // Coerce legacy string/null values into safe numbers so the
                // frontend never sees "null" for discount/tax fields.
                line.item_discount = toNumberSafe(line.item_discount, 0);
                line.item_discount_percentage = toNumberSafe(line.item_discount_percentage, 0);
                line.tax = toNumberSafe(line.tax, 0);

                if (
                  line.total_amount === null ||
                  typeof line.total_amount === 'undefined' ||
                  !Number.isFinite(Number(line.total_amount))
                ) {
                  const qty = toNumberSafe(line.item_quantity, 0);
                  const price = toNumberSafe(line.item_price, 0);
                  line.total_amount = qty * price;
                } else {
                  line.total_amount = toNumberSafe(line.total_amount, 0);
                }

                return line;
              });

              if (typeof ra.roundOff === 'undefined') ra.roundOff = 0;
              if (typeof ra.extraDiscount === 'undefined') ra.extraDiscount = 0;
              if (typeof ra.itemsTotalAmount === 'undefined') ra.itemsTotalAmount = 0;

              cloned.returnArray = ra;
              return cloned;
            })
            .filter(Boolean);
        }

        if (typeof normalized.items_return_total === 'undefined') {
          normalized.items_return_total = 0;
        }
        if (typeof normalized.items_return_subtotal === 'undefined') {
          normalized.items_return_subtotal = 0;
        }
        if (typeof normalized.return_discount === 'undefined') {
          normalized.return_discount = 0;
        }
        if (typeof normalized.return_tax === 'undefined') {
          normalized.return_tax = 0;
        }
        if (typeof normalized.return_round_off === 'undefined') {
          normalized.return_round_off = 0;
        }
        if (typeof normalized.return_extra_discount === 'undefined') {
          normalized.return_extra_discount = 0;
        }
        if (typeof normalized.items_subtotal === 'undefined') {
          normalized.items_subtotal = normalized.subtotal ?? normalized.sales_sub_total ?? 0;
        }

        const gstItems = Array.isArray(normalized.items) ? normalized.items : [];
        if (gstItems.length) {
          let igstTotal = 0;
          let cgstTotal = 0;
          let sgstTotal = 0;

          for (const it of gstItems) {
            if (!it || typeof it !== 'object') continue;
            igstTotal += Number(it.igst_tax || 0);
            cgstTotal += Number(it.cgst_tax || 0);
            sgstTotal += Number(it.sgst_tax || 0);
          }

          if (igstTotal || cgstTotal || sgstTotal) {
            if (typeof normalized.igst === 'undefined') {
              normalized.igst = round(igstTotal, 2);
            }
            if (typeof normalized.cgst === 'undefined') {
              normalized.cgst = round(cgstTotal, 2);
            }
            if (typeof normalized.sgst === 'undefined') {
              normalized.sgst = round(sgstTotal, 2);
            }
          }

          const rawGstDoc =
            doc.gst !== undefined && doc.gst !== null ? String(doc.gst).toLowerCase() : '';
          const rawGstNorm =
            normalized.gst !== undefined && normalized.gst !== null
              ? String(normalized.gst).toLowerCase()
              : '';

          // Detect whether this sale already carries an explicit GST flag
          // ("enable" / "disable" / "gst_on" / "gst_off"). When present,
          // we must respect it exactly as stored so that gst=disable sales
          // continue to show the non-GST Tax Details block, mirroring the
          // original PHP behaviour.
          const hasExplicitGstFlag = Boolean(rawGstDoc || rawGstNorm);

          let gstEnabled = false;

          if (hasExplicitGstFlag) {
            gstEnabled =
              rawGstDoc === 'enable' ||
              rawGstDoc === 'gst_on' ||
              rawGstNorm === 'enable' ||
              rawGstNorm === 'gst_on';
          } else if (igstTotal || cgstTotal || sgstTotal) {
            // Legacy sales that never persisted a gst flag but clearly use
            // IGST / CGST / SGST should behave as GST-enabled in the view
            // modal so the Indian GST card appears.
            gstEnabled = true;
          } else if (branchHasGstOn) {
            // Fallback: very old sales without a gst flag or GST tax values
            // on a branch that is configured for Indian GST. In this narrow
            // case, follow the branch configuration.
            gstEnabled = true;
          }

          normalized.gst = gstEnabled ? 'enable' : 'disable';
        } else if (typeof normalized.gst === 'undefined' || normalized.gst === null) {
          normalized.gst = 'disable';
        }

        if (
          typeof normalized.sales_total !== 'undefined' &&
          typeof normalized.items_total === 'undefined'
        ) {
          normalized.items_total = normalized.sales_total;
        }
        if (
          typeof normalized.total !== 'undefined' &&
          typeof normalized.items_total === 'undefined'
        ) {
          normalized.items_total = normalized.total;
        }
        if (
          typeof normalized.subtotal === 'undefined' &&
          typeof normalized.sales_sub_total !== 'undefined'
        ) {
          normalized.subtotal = normalized.sales_sub_total;
        }

        // Ensure sale_no and status exist
        if (typeof normalized.sale_no === 'undefined') {
          normalized.sale_no =
            normalized.sales_id || normalized.invoice_number || normalized._id || '';
        }
        if (typeof normalized.status === 'undefined') {
          normalized.status = normalized.payment_status || '';
        }

        // PHP-style payment_status label normalization for view modal
        const rawStatus = (normalized.payment_status ?? '').toString().trim().toLowerCase();
        const paidAmt = Number(normalized.paid_amount ?? normalized.paidAmount ?? 0) || 0;
        if (rawStatus === 'completed' || rawStatus === 'paid') {
          normalized.payment_status = 'Paid';
        } else if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
          normalized.payment_status = 'Cancelled';
        } else if (rawStatus === 'pending') {
          normalized.payment_status = paidAmt <= 0 ? 'Unpaid' : 'Pending';
        }

        // As a final safeguard, recompute item totals if the document is missing them.
        const items = Array.isArray(normalized.items) ? normalized.items : [];
        if (items.length) {
          const sum = items.reduce((acc, it) => {
            const line = Number(it?.item_total ?? it?.total_amount ?? it?.total ?? 0) || 0;
            return acc + line;
          }, 0);

          if (
            typeof normalized.items_total === 'undefined' ||
            Number(normalized.items_total) === 0
          ) {
            normalized.items_total = round(sum, 2);
          }
          if (typeof normalized.sales_total === 'undefined') {
            normalized.sales_total = normalized.items_total;
          }
          if (typeof normalized.total === 'undefined') {
            normalized.total = normalized.sales_total;
          }
        }

        // Normalise the primary date fields using the business timezone so
        // that the sale details modal matches the Sales History list. For
        // normal sales we keep the original sale date, but for
        // PartialReturn / FullReturn we prefer the last updated timestamp
        // (the time the return was completed), which is what the Sales
        // History grid displays.
        const tz = BaseModel.currentTimeZone || 'Asia/Kolkata';

        let dateSource = null;
        const process = (doc.sale_process || '').toString();
        if (process === 'PartialReturn' || process === 'FullReturn') {
          dateSource =
            doc.updated_date ||
            doc.updatedAt ||
            doc.date ||
            doc.created_date ||
            doc.createdAt ||
            null;
        } else {
          dateSource =
            doc.date ||
            doc.created_date ||
            doc.createdAt ||
            doc.updated_date ||
            doc.updatedAt ||
            null;
        }

        if (dateSource) {
          const formatted = formatDate(dateSource, { timeZone: tz });
          if (formatted) {
            normalized.date = formatted;
            if (!normalized.created_date) {
              normalized.created_date = formatted;
            }
          }
        }
      }

      return {
        status: true,
        data: normalized,
        message: 'get successfully',
      };
    } catch (error) {
      console.error('Error in getSalesDetailsLegacy:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async deleteSales(ids, { SaleModel } = {}) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: false, data: null, message: 'No IDs provided' };
      }

      // Ensure BaseModel has an initialized Mongo connection for recycle_bin
      // backups and data_change_log.
      const base = new BaseModel('sales');
      await base.getCollection('recycle_bin');

      const objectIds = ids
        .map((id) => {
          if (!id) return null;
          const str = String(id).trim();
          return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
        })
        .filter((oid) => oid);

      if (objectIds.length === 0) {
        return { status: false, data: null, message: 'No valid IDs provided' };
      }

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');
      const transactionCollection = db.collection('transaction');
      const customersCollection = db.collection('customers');
      const cashRegisterCollection = db.collection('cashregister');
      const branchesCollection = db.collection('branches');
      const itemsCollection = db.collection('items');
      const stockLogsRepository = new StockLogsRepository();

      // Write change logs for each sale id (PHP BaseModel::changeLog parity)
      for (const oid of objectIds) {
        try {
          await base.changeLog('sales', BaseModel.loggedUser, oid, 'delete');
        } catch (e) {
          // changeLog is non-throwing by design; ignore failures.
        }
      }

      const licenseFilter = BaseModel.license ? { license: BaseModel.license } : {};

      const salesFilter = {
        _id: { $in: objectIds },
        ...licenseFilter,
        ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      };

      // Clean register_sales references in cashregister collection
      try {
        await cashRegisterCollection.updateMany(
          {
            'register_sales.sales_id': { $in: objectIds },
            ...licenseFilter,
          },
          {
            $pull: {
              register_sales: {
                sales_id: { $in: objectIds },
              },
            },
          }
        );
      } catch (e) {
        // Do not block delete flow on register cleanup issues
        console.error('Error cleaning cashregister for deleted sales:', e);
      }

      const salesDocs = await salesCollection.find(salesFilter).toArray();
      const now = new Date();

      for (const doc of salesDocs) {
        if (!doc) continue;

        const saleId = doc._id;
        const customerId = doc.customer_id || doc.customer || null;
        const branchId = doc.branch_id || doc.branch || BaseModel.currentBranch || null;
        const licenseId = doc.license || BaseModel.license || null;

        // Handle partial customer transactions (wallet) when partial_check is true
        const partialCheck = doc.partial_check === 'true' || doc.partial_check === true;

        if (partialCheck && customerId) {
          try {
            const txFilter = {
              sale_id: saleId,
              customer_id: customerId,
            };
            if (branchId) {
              txFilter.branch_id = branchId;
            }
            if (licenseId) {
              txFilter.license = licenseId;
            }

            const txDocs = await transactionCollection.find(txFilter).toArray();
            for (const tx of txDocs) {
              await BaseModel.deletedDocumentBackup('transaction', tx);
            }

            await transactionCollection.deleteMany(txFilter);

            const customerMatchAnd = [{ customer_id: customerId }];
            if (branchId) {
              customerMatchAnd.push({ branch_id: branchId });
            }
            if (licenseId) {
              customerMatchAnd.push({ license: licenseId });
            }

            const aggregateMatch = customerMatchAnd.length > 0 ? { $and: customerMatchAnd } : {};

            const walletAgg = await transactionCollection
              .aggregate([
                { $match: aggregateMatch },
                {
                  $group: {
                    _id: null,
                    totalInAmount: {
                      $sum: {
                        $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0],
                      },
                    },
                    totalOutAmount: {
                      $sum: {
                        $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0],
                      },
                    },
                  },
                },
                {
                  $addFields: {
                    totalAmountDue: {
                      $subtract: ['$totalInAmount', '$totalOutAmount'],
                    },
                  },
                },
              ])
              .toArray();

            let totalWalletAmount = 0;
            if (walletAgg.length > 0) {
              const row = walletAgg[0];
              totalWalletAmount =
                typeof row.totalAmountDue === 'number'
                  ? row.totalAmountDue
                  : Number(row.totalAmountDue || 0) || 0;
            }

            const customerFilter = {
              _id: customerId,
            };
            if (branchId) {
              customerFilter.branch_id = branchId;
            }
            if (licenseId) {
              customerFilter.license = licenseId;
            }

            await customersCollection.updateOne(customerFilter, {
              $set: { balance: totalWalletAmount },
            });
          } catch (e) {
            console.error('Error updating customer wallet during sale delete:', e);
          }
        }

        // Backup sales document to recycle_bin
        try {
          await BaseModel.deletedDocumentBackup('sales', doc);
        } catch (e) {
          console.error('Error backing up deleted sale document:', e);
        }

        // Restore stock quantities and write stock logs (skip Hold sales)
        const saleProcess = doc.sale_process || null;
        if (saleProcess && String(saleProcess).toLowerCase() === 'hold') {
          continue;
        }

        const branchForStock = branchId || BaseModel.currentBranch || doc.branch_id || doc.branch;
        let branchSettings = null;
        if (branchForStock) {
          try {
            let normalizedBranchId = branchForStock;
            if (branchForStock instanceof mongoose.Types.ObjectId) {
              normalizedBranchId = branchForStock;
            } else if (mongoose.Types.ObjectId.isValid(String(branchForStock))) {
              normalizedBranchId = new mongoose.Types.ObjectId(String(branchForStock));
            }

            branchSettings = await branchesCollection.findOne({
              _id: normalizedBranchId,
            });
          } catch (e) {
            console.error('Error loading branch settings for sale delete stock log:', e);
          }
        }

        const stockLogStatus = !!(branchSettings && branchSettings.stock_management_log);

        const items = Array.isArray(doc.items) ? doc.items : [];
        const salesIdentifier = doc.sales_id || doc.invoice_number || (saleId && saleId.toString());

        for (const item of items) {
          try {
            const rawItemId = item.item_id || item.item || item.id;
            if (!rawItemId) continue;

            const quantity =
              item.item_quantity != null
                ? item.item_quantity
                : item.quantity != null
                  ? item.quantity
                  : 0;
            const itemQty = Number(quantity || 0);
            if (!itemQty || itemQty <= 0) continue;

            let itemObjectId = null;
            if (
              rawItemId &&
              typeof rawItemId === 'object' &&
              rawItemId._bsontype === 'ObjectID' &&
              typeof rawItemId.toString === 'function'
            ) {
              itemObjectId = new mongoose.Types.ObjectId(rawItemId.toString());
            } else if (mongoose.Types.ObjectId.isValid(String(rawItemId))) {
              itemObjectId = new mongoose.Types.ObjectId(String(rawItemId));
            }

            if (!itemObjectId) continue;

            const itemFilter = {
              _id: itemObjectId,
            };
            if (licenseId) {
              itemFilter.license = licenseId;
            }

            const itemDoc = await itemsCollection.findOne(itemFilter);
            if (!itemDoc) continue;

            const openingBalance = Number(itemDoc.available_quantity || 0);
            const availableQuantity = openingBalance + itemQty;

            // PHP checks: $itemdocuments['track_inventory'] === true (boolean or string 'true')
            if (
              stockLogStatus &&
              (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')
            ) {
              const countStr = String(itemQty);

              await stockLogsRepository.createStockLog({
                stocklog: stockLogStatus,
                branch_id: branchForStock,
                view_item_id: itemObjectId,
                item_barcode_id: itemDoc.barcode_id || '',
                item_name: item.item_name || item.name || itemDoc.name || '',
                item_quantity: itemQty,
                process: 'Delete Sale',
                reference: salesIdentifier || '',
                opening_balance: openingBalance,
                closing_balance: availableQuantity,
                count: countStr,
                date: now,
                action: 'Add',
                changed_by_userid: BaseModel.loggedUser,
                changed_by: BaseModel.loggedUserName || 'System',
              });

              await itemsCollection.updateOne(itemFilter, {
                $set: {
                  available_quantity: availableQuantity,
                },
              });
            }
          } catch (e) {
            console.error('Error restoring stock for deleted sale item:', e);
          }
        }
      }

      await salesCollection.deleteMany(salesFilter);

      return {
        status: true,
        data: objectIds.map((oid) => oid.toString()),
        message: 'success',
      };
    } catch (error) {
      console.error('Error in deleteSaleCollectionData:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getById(id, { SaleModel } = {}) {
    if (!id) return null;
    const Model = this.getModel(SaleModel);
    const tenant = activeTenantFilter();
    return Object.keys(tenant).length ? Model.findOne({ _id: id, ...tenant }) : Model.findById(id);
  }

  async findById(id, { projection, populate, SaleModel } = {}) {
    if (!id) return null;
    const Model = this.getModel(SaleModel);

    const tenant = activeTenantFilter();
    let query = Object.keys(tenant).length
      ? Model.findOne({ _id: id, ...tenant })
      : Model.findById(id);

    if (projection) {
      query = query.select(projection);
    }

    if (populate) {
      // Allow single path or array of populate specs
      if (Array.isArray(populate)) {
        populate.forEach((pop) => {
          query = query.populate(pop);
        });
      } else {
        query = query.populate(populate);
      }
    }

    return query.lean();
  }

  async save(sale) {
    if (!sale) return null;
    return sale.save();
  }

  async updateWalletAmount(saleId, walletAmount) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const result = await salesCollection.updateOne(
        {
          _id: new mongoose.Types.ObjectId(saleId),
          license: BaseModel.license,
        },
        {
          $set: {
            wallet_amount: parseFloat(walletAmount),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error updating wallet amount:', error);
      return false;
    }
  }

  async aggregate(pipeline, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.aggregate(pipeline);
  }

  async find(match, projection, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    let query = Model.find(match);
    if (projection) {
      query = query.select(projection);
    }
    return query.lean();
  }

  async findOne(match, projection, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    let query = Model.findOne(match);
    if (projection) {
      query = query.select(projection);
    }
    return query.lean();
  }

  async countDocuments(match, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.countDocuments(match);
  }

  async getSaleForReceipt(id, { SaleModel } = {}) {
    if (!id) return null;
    const Model = this.getModel(SaleModel);
    return Model.findOne({
      $or: [{ _id: id }, { sales_id: id }],
    }).populate('branch_id');
  }

  async getSaleForCustomerPrint(id, { SaleModel } = {}) {
    if (!id) return null;
    const Model = this.getModel(SaleModel);
    return Model.findOne({
      $or: [{ _id: id }, { sales_id: id }],
    })
      .populate('branch_id')
      .populate('items.item_id')
      .lean();
  }

  async userReportPage(data, options, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const branchObjectIds = (branchIds || [])
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [
        { branch_id: { $in: branchObjectIds } },
        { updated_date: { $gte: fromDate, $lte: toDate } },
      ];
      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      /** @type {Record<string, any>} */
      const filters = { $and: andConditions };
      if (data.user_id && mongoose.Types.ObjectId.isValid(data.user_id)) {
        filters.user_id = new mongoose.Types.ObjectId(data.user_id);
      }

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $unwind: '$items' },
        { $match: filters },
        {
          $addFields: {
            sales_total_num: {
              $toDouble: { $ifNull: ['$items_total', 0] },
            },
            tax_num: { $toDouble: { $ifNull: ['$tax', 0] } },
            company_price_total_num: {
              $toDouble: { $ifNull: ['$items.company_price_total', 0] },
            },
          },
        },
        {
          $group: {
            _id: { user_id: '$user_id', user_name: '$user_name', sale_id: '$_id' },
            profit: {
              $sum: {
                $subtract: [
                  {
                    $subtract: ['$sales_total_num', { $add: ['$tax_num'] }],
                  },
                  '$company_price_total_num',
                ],
              },
            },
            sales_total: { $first: '$items_total' },
            refund_total: { $first: '$items_return_total' },
          },
        },
        {
          $group: {
            _id: { user_id: '$_id.user_id', user_name: '$_id.user_name' },
            profit: { $sum: '$profit' },
            sales_total: { $sum: '$sales_total' },
            sales_avg: { $avg: '$sales_total' },
            refund_total: { $sum: '$refund_total' },
            sales_count: { $sum: 1 },
          },
        },
        { $sort: { sales_total: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const salesList = await salesCollection.aggregate(pipeline, { allowDiskUse: true }).toArray();

      const list = salesList.map((doc) => {
        const id = doc._id || {};
        return {
          user_name: id.user_name,
          user_id: id.user_id,
          sales_payment: round(doc.sales_total || 0, 2),
          refund_payment: round(doc.refund_total || 0, 2),
          sales_count: doc.sales_count || 0,
          sales_profit: round(doc.profit || 0, 2),
          sales_avg: round(doc.sales_avg || 0, 2),
        };
      });

      const countPipeline = [
        { $match: filters },
        {
          $group: {
            _id: { user_id: '$user_id' },
          },
        },
      ];

      const salesCountList = await salesCollection.aggregate(countPipeline).toArray();
      const total = salesCountList.length;

      return {
        status: true,
        list,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(Math.ceil(total / (limit || 1)), 1),
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in userReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getUserGraphicalReports(value = {}, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(value.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(value.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      const rawBranch = value.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const branchObjectIds = (branchIds || [])
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [
        {
          branch_id: { $in: branchObjectIds },
          sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
        },
        {
          updated_date: { $gte: fromDate, $lte: toDate },
          ...(BaseModel.license ? { license: BaseModel.license } : {}),
        },
      ];

      const condition = { $and: andConditions };
      if (value.user_id && mongoose.Types.ObjectId.isValid(value.user_id)) {
        condition.user_id = new mongoose.Types.ObjectId(value.user_id);
      }

      const db = await BaseModel.getDb();
      const collection = db.collection('sales');

      const pipeline = [
        { $match: condition },
        {
          $project: {
            items_total: 1,
            h: {
              $dayOfWeek: {
                date: '$updated_date',
                timezone: timeZone,
              },
            },
          },
        },
        {
          $group: {
            _id: '$h',
            totalValue: { $sum: '$items_total' },
          },
        },
      ];

      const salesData = await collection.aggregate(pipeline).toArray();

      if (!Array.isArray(salesData) || salesData.length === 0) {
        return {
          status: true,
          data: [],
          message: '',
        };
      }

      const days = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      const totalsByIndex = new Array(7).fill(0);

      for (const doc of salesData) {
        const dow = typeof doc._id === 'number' ? doc._id : Number(doc._id) || 0;
        if (dow >= 1 && dow <= 7) {
          const idx = dow === 7 ? 0 : dow; // 7 -> 0 (Sat), 1..6 -> 1..6
          totalsByIndex[idx] += Number(doc.totalValue || 0);
        }
      }

      const arrSalesPurchase = [];
      for (let m = 0; m < 7; m++) {
        arrSalesPurchase.push({
          week: days[m],
          sales: round(totalsByIndex[m] || 0, 2),
        });
      }

      return {
        status: true,
        data: arrSalesPurchase,
        message: 'Graphical report successfully',
      };
    } catch (error) {
      console.error('Error in getUserGraphicalReports:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async returnSalesReportPage(data = {}, options = {}, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTs = BaseModel.startingDate
        ? BaseModel.startingDate(data.starting_date, timeZone)
        : Date.parse(data.starting_date || '') || 0;
      const toTs = BaseModel.endingDate
        ? BaseModel.endingDate(data.ending_date, timeZone)
        : Date.parse(data.ending_date || '') || Date.now();

      const fromDate = new Date(fromTs || 0);
      const toDate = new Date(toTs || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }
      andConditions.push({
        sale_process: { $in: ['PartialReturn', 'FullReturn'] },
      });

      const dateAndLicense = {
        updated_date: { $gte: fromDate, $lte: toDate },
      };
      if (BaseModel.license) {
        dateAndLicense.license = BaseModel.license;
      }
      andConditions.push(dateAndLicense);

      const filters = { $and: andConditions };

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $match: filters },
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        {
          $group: {
            _id: {
              id: '$_id',
              date: '$updated_date',
              sales_id: '$sales_id',
              customer_name: '$customer_name',
              payment_mode: '$payment_mode',
              return_value: '$items_return_total',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.return_value': -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      const list = (aggResults || []).map((doc) => {
        const id = doc._id || {};
        const rawDate = id.date;
        const formattedDate = rawDate ? formatDate(rawDate) : null;
        const returnTotal = typeof id.return_value === 'number' ? id.return_value : 0;

        return {
          date: formattedDate,
          id: id.id,
          sale_id: id.sales_id,
          customer_name: id.customer_name,
          payment_mode: id.payment_mode,
          return: round(returnTotal || 0, 2),
          count: doc.count || 0,
        };
      });

      const countPipeline = [
        { $match: filters },
        {
          $group: {
            _id: { sales_id: '$sales_id' },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      return {
        status: true,
        list,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(Math.ceil(total / (limit || 1)), 1),
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in returnSalesReportPage:', error);
      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      return {
        status: false,
        list: null,
        pagination: {
          page: 1,
          limit,
          total: 0,
          pages: 1,
        },
        message: error.message,
      };
    }
  }

  async returnProductReportPage(data = {}, options = {}, { SaleModel } = {}) {
    try {
      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }

      if (data.sales_id && mongoose.Types.ObjectId.isValid(data.sales_id)) {
        andConditions.push({ _id: new mongoose.Types.ObjectId(data.sales_id) });
      }

      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      const filters = andConditions.length ? { $and: andConditions } : {};

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : BaseModel.limit;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        { $match: filters },
        {
          $group: {
            _id: {
              sales_id: '$sales_id',
              item_id: '$items_return.returnArray.returnValue.item_id',
              item_name: '$items_return.returnArray.returnValue.item_name',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
              customer_email: '$customer_email',
              customer_address: '$customer_address',
              user_name: '$user_name',
              branch_name: '$branch_name',
            },
            item_quantity: {
              $sum: '$items_return.returnArray.returnValue.item_quantity',
            },
            total_amount: {
              $sum: '$items_return.returnArray.returnValue.total_amount',
            },
          },
        },
        { $sort: { total_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      const list = [];
      const customDetails = {
        sales_id: null,
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        customer_address: null,
        user_name: null,
        branch_name: null,
      };

      for (const doc of aggResults) {
        const id = doc._id || {};
        list.push({
          _id: id.item_id ? id.item_id.toString() : '',
          name: id.item_name || '',
          total_amount: round(doc.total_amount || 0, 2),
          item_quantity: round(doc.item_quantity || 0, 2),
        });

        if (!customDetails.sales_id && id.sales_id) {
          customDetails.sales_id = id.sales_id;
          customDetails.customer_name = id.customer_name || '';
          customDetails.customer_phone = id.customer_phone || '';
          customDetails.customer_email = id.customer_email || '';
          customDetails.customer_address = id.customer_address || '';
          customDetails.user_name = id.user_name || '';
          customDetails.branch_name = id.branch_name || '';
        }
      }

      const countPipeline = [
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        { $match: filters },
        {
          $group: {
            _id: {
              item_id: '$items_return.returnArray.returnValue.item_id',
            },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      return {
        status: true,
        custom_details: customDetails,
        total,
        current_page: page,
        total_pages: limit ? Math.ceil(total / limit) : 0,
        per_page: limit,
        list,
      };
    } catch (error) {
      console.error('Error in returnProductReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async pendingProductReportPage(data = {}, options = {}, { SaleModel } = {}) {
    try {
      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }

      if (data.sales_id && mongoose.Types.ObjectId.isValid(data.sales_id)) {
        andConditions.push({ _id: new mongoose.Types.ObjectId(data.sales_id) });
      }

      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      const filters = andConditions.length ? { $and: andConditions } : {};

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : BaseModel.limit;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $unwind: '$items' },
        { $match: filters },
        {
          $group: {
            _id: {
              sales_id: '$sales_id',
              item_id: '$items.item_id',
              item_name: '$items.item_name',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
              customer_email: '$customer_email',
              customer_address: '$customer_address',
              user_name: '$user_name',
              branch_name: '$branch_name',
            },
            item_quantity: { $sum: '$items.item_quantity' },
            total_amount: { $sum: '$items.total_amount' },
          },
        },
        { $sort: { total_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      const list = [];
      const customDetails = {
        sales_id: null,
        customer_name: null,
        customer_phone: null,
        customer_email: null,
        customer_address: null,
        user_name: null,
        branch_name: null,
      };

      for (const doc of aggResults) {
        const id = doc._id || {};
        list.push({
          _id: id.item_id ? id.item_id.toString() : '',
          name: id.item_name || '',
          total_amount: round(doc.total_amount || 0, 2),
          item_quantity: round(doc.item_quantity || 0, 2),
        });

        if (!customDetails.sales_id && id.sales_id) {
          customDetails.sales_id = id.sales_id;
          customDetails.customer_name = id.customer_name || '';
          customDetails.customer_phone = id.customer_phone || '';
          customDetails.customer_email = id.customer_email || '';
          customDetails.customer_address = id.customer_address || '';
          customDetails.user_name = id.user_name || '';
          customDetails.branch_name = id.branch_name || '';
        }
      }

      const countPipeline = [
        { $unwind: '$items' },
        { $match: filters },
        {
          $group: {
            _id: { item_id: '$items.item_id' },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      return {
        status: true,
        custom_details: customDetails,
        total,
        current_page: page,
        total_pages: limit ? Math.ceil(total / limit) : 0,
        per_page: limit,
        list,
      };
    } catch (error) {
      console.error('Error in pendingProductReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async productBasedReportPage(data, options, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTs = BaseModel.startingDate
        ? BaseModel.startingDate(data.starting_date, timeZone)
        : Date.parse(data.starting_date || '') || 0;
      const toTs = BaseModel.endingDate
        ? BaseModel.endingDate(data.ending_date, timeZone)
        : Date.parse(data.ending_date || '') || Date.now();

      const fromDate = new Date(fromTs || 0);
      const toDate = new Date(toTs || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const matchFilter = {
        branch_id: { $in: branchObjectIds },
        sale_process: { $in: ['PartialReturn', 'FullReturn'] },
        updated_date: { $gte: fromDate, $lte: toDate },
      };

      if (BaseModel.license) {
        matchFilter.license = BaseModel.license;
      }

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const basePipeline = [
        { $match: matchFilter },
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
      ];

      const aggregationPipeline = [
        ...basePipeline,
        {
          $group: {
            _id: {
              item_id: '$items_return.returnArray.returnValue.item_id',
              item_name: '$items_return.returnArray.returnValue.item_name',
              supplier_id: '$items_return.returnArray.returnValue.supplier_id',
              supplier_name: '$items_return.returnArray.returnValue.supplier_name',
              return_id: '$items_return.returnArray.returnValue.return_id',
              return_date: '$items_return.returnArray.returnValue.return_date',
            },
            total_amount: {
              $sum: '$items_return.returnArray.returnValue.total_amount',
            },
            item_quantity: {
              $sum: '$items_return.returnArray.returnValue.item_quantity',
            },
          },
        },
        { $sort: { '_id.return_date': -1, total_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(aggregationPipeline).toArray();

      const list = (aggResults || []).map((doc) => {
        const id = doc._id || {};
        return {
          supplier_id: id.supplier_id ? id.supplier_id.toString() : '',
          name: id.item_name || '',
          supplier_name: id.supplier_name || '',
          return_id: id.return_id || '',
          return_date: id.return_date ? formatDate(id.return_date) : null,
          total_amount: round(doc.total_amount || 0, 2),
          item_quantity: round(doc.item_quantity || 0, 2),
        };
      });

      const countPipeline = [
        ...basePipeline,
        {
          $group: {
            _id: {
              item_id: '$items_return.returnArray.returnValue.item_id',
              supplier_id: '$items_return.returnArray.returnValue.supplier_id',
              return_id: '$items_return.returnArray.returnValue.return_id',
            },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      return {
        status: true,
        list,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(Math.ceil(total / (limit || 1)), 1),
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in productBasedReportPage:', error);
      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      return {
        status: false,
        list: null,
        pagination: {
          page: 1,
          limit,
          total: 0,
          pages: 1,
        },
        message: error.message,
      };
    }
  }

  async pendingSalesReportPage(data, options, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTs = BaseModel.startingDate
        ? BaseModel.startingDate(data.starting_date, timeZone)
        : Date.parse(data.starting_date || '') || 0;
      const toTs = BaseModel.endingDate
        ? BaseModel.endingDate(data.ending_date, timeZone)
        : Date.parse(data.ending_date || '') || Date.now();

      const fromDate = new Date(fromTs || 0);
      const toDate = new Date(toTs || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }
      andConditions.push({ sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } });

      const dateAndPayment = {
        updated_date: { $gte: fromDate, $lte: toDate },
        $or: [
          { payment_status: 'Partialy Paid' },
          { payment_status: PAYMENT_STATUS.PENDING },
          { payment_pending: { $gt: 0 } },
        ],
      };
      if (BaseModel.license) {
        dateAndPayment.license = BaseModel.license;
      }
      andConditions.push(dateAndPayment);

      const filters = { $and: andConditions };

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $match: filters },
        {
          $group: {
            _id: {
              date: '$updated_date',
              id: '$_id',
              sales_id: '$sales_id',
              user_name: '$user_name',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
              number_of_items: '$number_of_items',
            },
            pending_amount: { $sum: '$items_total' },
            partial_amount: { $sum: '$partial_balance' },
            due_amount: { $sum: '$payment_pending' },
          },
        },
        { $sort: { pending_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      const list = (aggResults || []).map((doc) => {
        const id = doc._id || {};
        const rawDate = id.date;
        const formattedDate = rawDate ? formatDate(rawDate) : null;
        return {
          date: formattedDate,
          id: id.id,
          sale_id: id.sales_id,
          customer_name: id.customer_name,
          customer_phone: id.customer_phone,
          pending_amount: round(doc.pending_amount || 0, 2),
          partial_amount: round(doc.partial_amount || 0, 2),
          due_amount: round(doc.due_amount || 0, 2),
          number_of_items: id.number_of_items,
        };
      });

      const total = await salesCollection.countDocuments(filters);

      return {
        status: true,
        list,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(Math.ceil(total / (limit || 1)), 1),
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in pendingSalesReportPage:', error);
      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      return {
        status: false,
        list: null,
        pagination: {
          page: 1,
          limit,
          total: 0,
          pages: 1,
        },
        message: error.message,
      };
    }
  }

  async pendingCustomerReportPage(data = {}, options = {}, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTs = BaseModel.startingDate
        ? BaseModel.startingDate(data.starting_date, timeZone)
        : Date.parse(data.starting_date || '') || 0;
      const toTs = BaseModel.endingDate
        ? BaseModel.endingDate(data.ending_date, timeZone)
        : Date.parse(data.ending_date || '') || Date.now();

      const fromDate = new Date(fromTs || 0);
      const toDate = new Date(toTs || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }
      andConditions.push({ sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } });

      const dateAndPayment = {
        updated_date: { $gte: fromDate, $lte: toDate },
        $or: [
          { payment_status: 'Partialy Paid' },
          { payment_status: PAYMENT_STATUS.PENDING },
          { payment_pending: { $gt: 0 } },
        ],
      };
      if (BaseModel.license) {
        dateAndPayment.license = BaseModel.license;
      }
      andConditions.push(dateAndPayment);

      const filters = { $and: andConditions };

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $match: filters },
        {
          $group: {
            _id: {
              customer_id: '$customer_id',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
              referrer: { $ifNull: ['$referrer_name', '--'] },
            },
            number_of_items: { $sum: '$number_of_items' },
            pending_amount: { $sum: '$items_total' },
            partial_amount: { $sum: '$partial_balance' },
            due_amount: { $sum: '$payment_pending' },
          },
        },
        { $sort: { pending_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      const list = (aggResults || []).map((doc) => {
        const id = doc._id || {};
        return {
          customer_id: id.customer_id ? id.customer_id.toString() : '',
          customer_name: id.customer_name || '',
          customer_phone: id.customer_phone || '',
          sales_payment: round(doc.pending_amount || 0, 2),
          partial_balance: round(doc.partial_amount || 0, 2),
          due_balance: round(doc.due_amount || 0, 2),
          sales_count: doc.number_of_items || 0,
          referrer: id.referrer || '--',
        };
      });

      const countPipeline = [
        { $match: filters },
        {
          $group: {
            _id: {
              customer_id: '$customer_id',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
            },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      return {
        status: true,
        list,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(Math.ceil(total / (limit || 1)), 1),
        },
        message: 'Get Successfully',
      };
    } catch (error) {
      console.error('Error in pendingCustomerReportPage:', error);
      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 5;
      return {
        status: false,
        list: null,
        pagination: {
          page: 1,
          limit,
          total: 0,
          pages: 1,
        },
        message: error.message,
      };
    }
  }

  async taxSalesReportPage(data, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      // Match legacy PHP BaseModel::startingDate / endingDate behaviour
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      // Convert branch IDs to ObjectIds (same as PHP array_merge of ObjectIDs)
      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      // Build filters for items with tax amount > 0, including license scope
      const firstClause = {
        branch_id: { $in: objectBranchIds },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      };

      const secondClause = {
        updated_date: { $gte: fromDate, $lte: toDate },
        'items.tax_amount': { $gt: 0 },
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
      };

      const filter = {
        $and: [firstClause, secondClause],
      };

      // Aggregate pipeline mirroring PHP implementation
      const pipeline = [
        { $unwind: '$items' },
        { $match: filter },
        {
          $group: {
            _id: { items: '$items' },
          },
        },
        { $sort: { _id: -1 } },
      ];

      const results = await Model.aggregate(pipeline);

      // Transform results using BaseModel.simplifyFields like PHP simplifyFields
      const rawTaxData = Array.isArray(results)
        ? results.map((doc) => BaseModel.simplifyFields(doc))
        : [];

      // Normalize tax_name for legacy frontend expectations:
      // when items.tax_fields === null and items.tax > 0, tax_name must be
      // a non-empty string so existing JS can safely call slice() on it.
      const taxData = rawTaxData.map((doc) => {
        try {
          const items = doc && doc._id && doc._id.items;
          if (!items) return doc;

          const hasNullTaxFields = items.tax_fields === null;
          const hasPositiveTax =
            items.tax !== undefined && items.tax !== null && Number(items.tax) > 0;

          if (hasNullTaxFields && hasPositiveTax) {
            const currentName = items.tax_name;
            const isValidString = typeof currentName === 'string' && currentName.trim().length > 0;

            if (!isValidString) {
              const numericTax = Number(items.tax);
              if (Number.isFinite(numericTax) && numericTax > 0) {
                // e.g. "5% Tax" for tax = 5
                items.tax_name = `${numericTax}% Tax`;
              } else {
                items.tax_name = 'Tax';
              }
            }
          }
        } catch (e) {
          // Keep original doc if normalization fails
        }
        return doc;
      });

      const responseData = {
        tax_details: taxData,
      };

      return {
        status: true,
        data: responseData,
        message: 'Get tax details successfully',
      };
    } catch (error) {
      console.error('Error in taxSalesReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async itemSaleDetailsPage(value, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      // Normalize branch ids (may come as single value or array)
      const rawBranch = value.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const rawItemId = value.item_id;

      // If no item_id is provided at all, mirror PHP shape but return an
      // empty, successful payload instead of an error so the frontend can
      // show an empty Activities table without a toast.
      if (!rawItemId) {
        const limit = parseInt(options.limit, 10) || 5;
        const page = parseInt(options.page, 10) || 1;

        const emptyTable = {
          status: true,
          data: {
            list: [],
            total: 0,
            current_page: page,
            total_pages: 0,
            per_page: limit,
          },
          message: 'Get Successfully',
        };

        return {
          status: true,
          data: {
            sale: [],
            return: [],
            table: emptyTable,
          },
          message: 'get detail successfully',
        };
      }

      // Support both string and ObjectId item_id representations. This keeps
      // compatibility with legacy PHP data (where item_id was often stored as
      // a plain string) and newer Node-created sales (which may use ObjectId).
      const itemIdCandidates = [rawItemId];
      if (mongoose.Types.ObjectId.isValid(rawItemId)) {
        itemIdCandidates.push(new mongoose.Types.ObjectId(rawItemId));
      }

      const branchCondition =
        objectBranchIds.length > 0 ? { branch_id: { $in: objectBranchIds } } : null;

      // Filters used for the main table (sales that have this item either in items or return items)
      const tableFilters = {
        $and: [
          branchCondition,
          {
            $or: [
              { 'items.item_id': { $in: itemIdCandidates } },
              {
                'items_return.returnArray.returnValue.item_id': {
                  $in: itemIdCandidates,
                },
              },
            ],
          },
        ].filter(Boolean),
      };

      // Filters for sales side (items only)
      const filters = {
        $and: [branchCondition, { 'items.item_id': { $in: itemIdCandidates } }].filter(Boolean),
      };

      // Filters for returns side (items_return only)
      const returnFilters = {
        $and: [
          branchCondition,
          {
            'items_return.returnArray.returnValue.item_id': {
              $in: itemIdCandidates,
            },
          },
        ].filter(Boolean),
      };

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);
      const sort = options.sort || { _id: 1 };

      // Fetch paginated list for table (similar to PHP parent::page result)
      const list = await Model.find(tableFilters).sort(sort).skip(skip).limit(limit).lean();

      const totalCount = await Model.countDocuments(tableFilters);

      const tableData = {
        status: true,
        data: {
          list,
          total: totalCount,
          current_page: page,
          total_pages: limit ? Math.ceil(totalCount / limit) : 0,
          per_page: limit,
        },
        message: 'Get Successfully',
      };

      // Aggregate total quantity for sales side
      const salesList = await Model.aggregate([
        { $unwind: '$items' },
        { $match: filters },
        {
          $group: {
            _id: null,
            total_amount: {
              $sum: {
                $ifNull: ['$items.total_amount', { $ifNull: ['$items.total', 0] }],
              },
            },
            total_qty: {
              $sum: {
                $ifNull: ['$items.item_quantity', '$items.quantity'],
              },
            },
          },
        },
      ]);

      const salesValues = salesList.map((doc) =>
        typeof doc.total_qty === 'number' ? doc.total_qty : 0
      );

      // Aggregate total quantity for returns side
      const returnList = await Model.aggregate([
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        { $match: returnFilters },
        {
          $group: {
            _id: null,
            total_amount: {
              $sum: '$items_return.returnArray.returnValue.total_amount',
            },
            total_qty: {
              $sum: '$items_return.returnArray.returnValue.item_quantity',
            },
          },
        },
      ]);

      const returnValues = returnList.map((doc) =>
        typeof doc.total_qty === 'number' ? doc.total_qty : 0
      );

      const arrTableData = {
        sale: salesValues,
        return: returnValues,
        table: tableData,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in itemSaleDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async categorySaleDetailsPage(value, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      // Normalize branch ids (may come as single value or array)
      const rawBranch = value.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (!value.category_id || !mongoose.Types.ObjectId.isValid(value.category_id)) {
        return {
          status: false,
          data: null,
          message: 'Invalid category id',
        };
      }

      const categoryObjectId = new mongoose.Types.ObjectId(value.category_id);

      // Filters used for the main table (sales that have category either in items or return items)
      const tableFilters = {
        $and: [
          { branch_id: { $in: objectBranchIds } },
          {
            $or: [
              { 'items.category_id': categoryObjectId },
              {
                'items_return.returnArray.returnValue.category_id': categoryObjectId,
              },
            ],
          },
        ],
      };

      // Filters for sales side (items only)
      const filters = {
        $and: [{ branch_id: { $in: objectBranchIds } }, { 'items.category_id': categoryObjectId }],
      };

      // Filters for returns side (items_return only)
      const returnFilters = {
        $and: [
          { branch_id: { $in: objectBranchIds } },
          {
            'items_return.returnArray.returnValue.category_id': categoryObjectId,
          },
        ],
      };

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);
      const sort = options.sort || { _id: 1 };

      // Fetch paginated list for table (similar to PHP parent::page result)
      const list = await Model.find(tableFilters).sort(sort).skip(skip).limit(limit).lean();

      const totalCount = await Model.countDocuments(tableFilters);

      const tableData = {
        status: true,
        data: {
          list,
          total: totalCount,
          current_page: page,
          total_pages: limit ? Math.ceil(totalCount / limit) : 0,
          per_page: limit,
        },
        message: 'Get Successfully',
      };

      // Aggregate total quantity for sales side
      const salesList = await Model.aggregate([
        { $unwind: '$items' },
        { $match: filters },
        {
          $group: {
            _id: null,
            total_amount: {
              $sum: {
                $ifNull: ['$items.total_amount', { $ifNull: ['$items.total', 0] }],
              },
            },
            total_qty: {
              $sum: {
                $ifNull: ['$items.item_quantity', '$items.quantity'],
              },
            },
          },
        },
      ]);

      const salesValues = salesList.map((doc) =>
        typeof doc.total_qty === 'number' ? doc.total_qty : 0
      );

      // Aggregate total quantity for returns side
      const returnList = await Model.aggregate([
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        { $match: returnFilters },
        {
          $group: {
            _id: null,
            total_amount: {
              $sum: '$items_return.returnArray.returnValue.total_amount',
            },
            total_qty: {
              $sum: '$items_return.returnArray.returnValue.item_quantity',
            },
          },
        },
      ]);

      const returnValues = returnList.map((doc) =>
        typeof doc.total_qty === 'number' ? doc.total_qty : 0
      );

      const arrTableData = {
        sale: salesValues,
        return: returnValues,
        table: tableData,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in categorySaleDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async userSalesDetailsPage(value, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      const arrayMerge = [];
      if (value.branchid && Array.isArray(value.branchid)) {
        for (let i = 0; i < value.branchid.length; i++) {
          if (mongoose.Types.ObjectId.isValid(value.branchid[i])) {
            arrayMerge.push(new mongoose.Types.ObjectId(value.branchid[i]));
          }
        }
      }

      if (!value.user_id || !mongoose.Types.ObjectId.isValid(value.user_id) || !arrayMerge.length) {
        return {
          status: false,
          data: null,
          message: 'Invalid branch or user id',
        };
      }

      // Match PHP filter structure exactly - user_id and license in same object
      const filters = {
        $and: [
          { branch_id: { $in: arrayMerge } },
          {
            user_id: new mongoose.Types.ObjectId(value.user_id),
            license: new mongoose.Types.ObjectId(options.license || value.license),
          },
        ],
      };

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);
      const sort = options.sort || { _id: 1 };

      const list = await Model.find(filters).sort(sort).skip(skip).limit(limit).lean();

      const totalCount = await Model.countDocuments(filters);

      const tableData = {
        status: true,
        data: {
          list,
          total: totalCount,
          current_page: page,
          total_pages: limit ? Math.ceil(totalCount / limit) : 0,
          per_page: limit,
        },
        message: 'Get Successfully',
      };

      // Aggregation match filter - same structure as find()
      const salesList = await Model.aggregate([
        { $match: filters },
        {
          $group: {
            _id: '$user_id',
            total_amount: { $sum: '$sales_total' },
          },
        },
      ]);

      const total = [];
      for (const doc of salesList) {
        total.push(round(doc.total_amount || 0, 2));
      }

      const arrTableData = {
        table: tableData,
        total,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in userSalesDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async returnProductViewPage(id, { SaleModel } = {}) {
    try {
      if (!id) {
        return {
          status: false,
          data: null,
          message: 'Return id is required',
        };
      }

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const filters = {
        'items_return.returnArray.returnValue.return_id': id,
      };

      const branchId = BaseModel.currentBranch || null;
      if (branchId && mongoose.Types.ObjectId.isValid(String(branchId))) {
        filters.branch_id = new mongoose.Types.ObjectId(String(branchId));
      }

      if (BaseModel.license) {
        filters.license = BaseModel.license;
      }

      const pipeline = [
        { $unwind: '$items_return' },
        { $unwind: '$items_return.returnArray' },
        { $unwind: '$items_return.returnArray.returnValue' },
        { $match: filters },
        {
          $group: {
            _id: {
              return_id: '$items_return.returnArray.returnValue.return_id',
              return_date: '$items_return.returnArray.returnValue.return_date',
              customer_name: '$customer_name',
              customer_phone: '$customer_phone',
              customer_email: '$customer_email',
              customer_address: '$customer_address',
            },
            item_id: {
              $first: '$items_return.returnArray.returnValue.item_id',
            },
            item_name: {
              $first: '$items_return.returnArray.returnValue.item_name',
            },
            item_price: {
              $first: '$items_return.returnArray.returnValue.item_price',
            },
            item_discount: {
              $first: '$items_return.returnArray.returnValue.item_discount',
            },
            item_discount_percentage: {
              $first: '$items_return.returnArray.returnValue.item_discount_percentage',
            },
            item_quantity: {
              $first: '$items_return.returnArray.returnValue.item_quantity',
            },
            tax: {
              $first: '$items_return.returnArray.returnValue.tax',
            },
            tax_type: {
              $first: '$items_return.returnArray.returnValue.tax_type',
            },
            total_amount: {
              $first: '$items_return.returnArray.returnValue.total_amount',
            },
            payment_mode: {
              $first: '$items_return.returnArray.returnValue.payment_mode',
            },
          },
        },
      ];

      const salesList = await salesCollection.aggregate(pipeline).toArray();

      const productValues = [];

      // Local helper to wrap Date/number/string into legacy Extended JSON
      const wrapDateForLegacyLocal = (value) => {
        if (!value) return value;
        if (
          typeof value === 'object' &&
          value.$date &&
          typeof value.$date === 'object' &&
          Object.prototype.hasOwnProperty.call(value.$date, '$numberLong')
        ) {
          return value;
        }
        let dateObj = null;
        if (value instanceof Date) {
          dateObj = value;
        } else if (typeof value === 'number') {
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) dateObj = d;
        } else if (typeof value === 'string') {
          const ts = Date.parse(value);
          if (!Number.isNaN(ts)) {
            dateObj = new Date(ts);
          }
        }
        if (!dateObj) return value;
        return {
          $date: {
            $numberLong: String(dateObj.getTime()),
          },
        };
      };

      for (const doc of salesList) {
        const c = doc._id || {};

        const price = Number(doc.item_price ?? 0);
        const qty = Number(doc.item_quantity ?? 0);
        const discount = Number(doc.item_discount ?? 0);
        const discountPct = Number(doc.item_discount_percentage ?? 0);
        const taxRate = Number(doc.tax ?? 0);
        const taxType = String(doc.tax_type || '').toLowerCase();

        let subPrice;
        if (taxType === 'inclusive') {
          const taxPrice = (price * taxRate) / (100 + taxRate || 1);
          subPrice = (price - taxPrice) * qty;
        } else {
          subPrice = price * qty;
        }

        let itemDiscountAmountMultiple;
        let totalDiscount;
        if (discount > 0) {
          itemDiscountAmountMultiple = subPrice - discount * qty;
          totalDiscount = discount * qty;
        } else if (discountPct > 0) {
          itemDiscountAmountMultiple = subPrice - subPrice * (discountPct / 100);
          totalDiscount = subPrice * (discountPct / 100);
        } else {
          itemDiscountAmountMultiple = subPrice;
          totalDiscount = 0;
        }

        const taxPrice = (itemDiscountAmountMultiple * taxRate) / 100;
        const totalPrice = itemDiscountAmountMultiple + taxPrice;

        productValues.push({
          return_id: c.return_id,
          return_date: wrapDateForLegacyLocal(c.return_date),
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          customer_email: c.customer_email,
          customer_address: c.customer_address,
          subtotal: subPrice,
          sale_discount: totalDiscount,
          sale_tax: taxPrice,
          finaltotal: totalPrice,
          item_id: doc.item_id,
          item_name: doc.item_name,
          item_price: doc.item_price,
          item_discount: doc.item_discount,
          item_discount_percentage: doc.item_discount_percentage,
          item_quantity: doc.item_quantity,
          tax: doc.tax,
          tax_type: doc.tax_type,
          total_amount: doc.total_amount,
          payment_mode: doc.payment_mode,
        });
      }

      return {
        status: true,
        data: productValues,
        message: 'Get detail successfully',
      };
    } catch (error) {
      console.error('Error in returnProductViewPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async paymentSalesTransactionReportPage(data, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const firstClause = {
        branch_id: { $in: objectBranchIds },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
      };

      const secondClause = {
        date: { $gte: fromDate, $lte: toDate },
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
      };

      const filters = {
        $and: [firstClause, secondClause],
      };

      if (data.payment_mode && data.payment_mode !== 'All') {
        filters.payment_mode = data.payment_mode;
      }

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const projection = {
        _id: 1,
        branch_id: 1,
        branch_name: 1,
        user_id: 1,
        user_name: 1,
        sales_id: 1,
        date: 1,
        items: 1,
        items_return: 1,
        sale_process: 1,
        customer_id: 1,
        customer_name: 1,
        customer_address: 1,
        customer_phone: 1,
        customer_email: 1,
        customer_state: 1,
        customer_country: 1,
        customer_gst_type: 1,
        customer_gst_number: 1,
        payment_pending: 1,
        payment_mode: 1,
        partial_balance: 1,
        partial_check: 1,
        payment_description: 1,
        printing_address: 1,
        payment_status: 1,
        sales_description: 1,
        sales_total: 1,
        sales_round_off: 1,
        round_off: 1,
        return_round_off: 1,
        sales_sub_total: 1,
        items_total: 1,
        items_return_total: 1,
        items_subtotal: 1,
        items_return_subtotal: 1,
        total_companyprice: 1,
        tax: 1,
        gst: 1,
        sgst: 1,
        discount: 1,
        return_tax: 1,
        return_discount: 1,
        number_of_items: 1,
        number_of_items_return: 1,
        created_date: 1,
        updated_date: 1,
        created_by: 1,
        updated_by: 1,
        wallet_amount: 1,
        sale_extra_discount: 1,
        extra_discount: 1,
        discount_description: 1,
        return_extra_discount: 1,
        extra_discount_type: 1,
        sale_method: 1,
        order: 1,
        multi_payment: 1,
        table_id: 1,
        table_number: 1,
        dine_type: 1,
        person_count: 1,
        was_kot_proceeded: 1,
        denomination_values: 1,
      };

      const rawList = await Model.find(filters)
        .select(projection)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const list = Array.isArray(rawList) ? rawList : [];

      const total = await Model.countDocuments(filters);

      return {
        status: true,
        data: {
          list,
          pagination: {
            page,
            limit,
            total,
            pages: Math.max(Math.ceil(total / (limit || 1)), 1),
          },
        },
        message: 'Get payment sales transaction details successfully',
      };
    } catch (error) {
      console.error('Error in paymentSalesTransactionReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getPaymentSaleTypeReport(data = {}, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      // Branch ids
      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (objectBranchIds.length) {
        andConditions.push({ branch_id: { $in: objectBranchIds } });
      }
      andConditions.push({ date: { $gte: fromDate, $lte: toDate } });
      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      const filters = { $and: andConditions };

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const cursor = salesCollection.find(filters, {
        projection: {
          payment_mode: 1,
          multi_payment: 1,
          items_total: 1,
          partial_balance: 1,
          payment_pending: 1,
          items_return_total: 1,
        },
        limit: 50000,
        batchSize: 1000,
      });

      const methodTotals = {};

      const docs = await cursor.toArray();

      const round = (value, decimals = 2) => {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return 0;
        const factor = Math.pow(10, decimals);
        return value && !Number.isNaN(value) ? Math.round(value * factor) / factor : 0;
      };

      for (const doc of docs) {
        const saleTotal = Number(doc.items_total || 0);
        const partialBalance = Number(doc.partial_balance || 0);
        const paymentPending = Number(doc.payment_pending || 0);
        const refundTotal = Number(doc.items_return_total || 0);

        let multiPaymentArr = null;
        const raw = doc.multi_payment;
        if (raw !== undefined && raw !== null && raw !== '') {
          if (Array.isArray(raw)) {
            multiPaymentArr = raw;
          } else if (typeof raw === 'object') {
            multiPaymentArr = raw;
          } else if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed !== '') {
              try {
                const decoded = JSON.parse(trimmed);
                if (decoded && typeof decoded === 'object') {
                  multiPaymentArr = decoded;
                }
              } catch (e) {}
            }
          }
        }

        let usedMulti = false;
        if (
          multiPaymentArr &&
          typeof multiPaymentArr === 'object' &&
          Object.keys(multiPaymentArr).length > 0
        ) {
          let sumMulti = 0.0;
          for (const amount of Object.values(multiPaymentArr)) {
            const num = Number(amount) || 0;
            if (num > 0) {
              sumMulti += num;
            }
          }

          if (sumMulti > 0) {
            for (const [method, amount] of Object.entries(multiPaymentArr)) {
              const num = Number(amount) || 0;
              if (num <= 0) continue;

              usedMulti = true;

              let displayName = String(method || '').trim();
              if (!displayName) {
                displayName = 'N/A';
              }
              const methodKey = displayName.replace(/\s+/g, '').toLowerCase();

              if (!methodTotals[methodKey]) {
                methodTotals[methodKey] = {
                  sales_payment_mode: displayName,
                  sales_payment: 0.0,
                  partial_amount: 0.0,
                  outstanding_amount: 0.0,
                  refund_payment: 0.0,
                  sales_count: 0,
                };
              }

              const ratio = sumMulti > 0 ? num / sumMulti : 0.0;

              methodTotals[methodKey].sales_payment += num;
              methodTotals[methodKey].partial_amount += partialBalance * ratio;
              methodTotals[methodKey].outstanding_amount += paymentPending * ratio;
              methodTotals[methodKey].refund_payment += refundTotal * ratio;
              methodTotals[methodKey].sales_count += 1;
            }
          }
        }

        if (!usedMulti) {
          let mode = doc.payment_mode ? String(doc.payment_mode).trim() : '';
          if (!mode) {
            mode = 'N/A';
          }

          const methodKey = mode.replace(/\s+/g, '').toLowerCase();
          if (!methodTotals[methodKey]) {
            methodTotals[methodKey] = {
              sales_payment_mode: mode,
              sales_payment: 0.0,
              partial_amount: 0.0,
              outstanding_amount: 0.0,
              refund_payment: 0.0,
              sales_count: 0,
            };
          }

          methodTotals[methodKey].sales_payment += saleTotal;
          methodTotals[methodKey].partial_amount += partialBalance;
          methodTotals[methodKey].outstanding_amount += paymentPending;
          methodTotals[methodKey].refund_payment += refundTotal;
          methodTotals[methodKey].sales_count += 1;
        }
      }

      const salesValues = Object.values(methodTotals)
        .filter((totals) => {
          const paymentMode = String(totals.sales_payment_mode || '').trim();
          return paymentMode !== '' && paymentMode.toLowerCase() !== 'n/a' && paymentMode !== 'N/A';
        })
        .map((totals) => ({
          sales_payment_mode: totals.sales_payment_mode,
          sales_payment: round(totals.sales_payment || 0, 2),
          partial_amount: round(totals.partial_amount || 0, 2),
          outstanding_amount: round(totals.outstanding_amount || 0, 2),
          refund_payment: round(totals.refund_payment || 0, 2),
          sales_count: Number(totals.sales_count || 0),
        }));

      salesValues.sort((a, b) => {
        const av = a.sales_payment || 0;
        const bv = b.sales_payment || 0;
        if (av === bv) return 0;
        return av < bv ? 1 : -1;
      });

      const graphicalData = {
        payment: salesValues,
      };

      return {
        status: true,
        data: graphicalData,
        message: 'Get payment details successfully',
      };
    } catch (error) {
      console.error('Error in getPaymentSaleTypeReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async paymentReturnSalesTranscationReportTable(data, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const firstClause = {
        branch_id: { $in: objectBranchIds },
        sale_process: { $in: ['PartialReturn', 'FullReturn'] },
      };

      const secondClause = {
        date: { $gte: fromDate, $lte: toDate },
        ...(BaseModel.license ? { license: BaseModel.license } : {}),
      };

      const filters = {
        $and: [firstClause, secondClause],
      };

      if (data.payment_mode && data.payment_mode !== 'All') {
        filters.payment_mode = data.payment_mode;
      }

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const projection = {
        _id: 1,
        branch_id: 1,
        branch_name: 1,
        user_id: 1,
        user_name: 1,
        sales_id: 1,
        date: 1,
        items: 1,
        items_return: 1,
        sale_process: 1,
        customer_id: 1,
        customer_name: 1,
        customer_address: 1,
        customer_phone: 1,
        customer_email: 1,
        customer_state: 1,
        customer_country: 1,
        customer_gst_type: 1,
        customer_gst_number: 1,
        payment_pending: 1,
        payment_mode: 1,
        partial_balance: 1,
        partial_check: 1,
        payment_description: 1,
        printing_address: 1,
        payment_status: 1,
        sales_description: 1,
        sales_total: 1,
        sales_round_off: 1,
        round_off: 1,
        return_round_off: 1,
        sales_sub_total: 1,
        items_total: 1,
        items_return_total: 1,
        items_subtotal: 1,
        items_return_subtotal: 1,
        total_companyprice: 1,
        tax: 1,
        gst: 1,
        sgst: 1,
        discount: 1,
        return_tax: 1,
        return_discount: 1,
        number_of_items: 1,
        number_of_items_return: 1,
        created_date: 1,
        updated_date: 1,
        created_by: 1,
        updated_by: 1,
        wallet_amount: 1,
        sale_extra_discount: 1,
        extra_discount: 1,
        discount_description: 1,
        return_extra_discount: 1,
        extra_discount_type: 1,
        sale_method: 1,
        order: 1,
        multi_payment: 1,
        table_id: 1,
        table_number: 1,
        dine_type: 1,
        person_count: 1,
        was_kot_proceeded: 1,
        denomination_values: 1,
      };

      const rawList = await Model.find(filters)
        .select(projection)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const list = Array.isArray(rawList) ? rawList : [];

      const total = await Model.countDocuments(filters);

      return {
        status: true,
        data: {
          list,
          pagination: {
            page,
            limit,
            total,
            pages: Math.max(Math.ceil(total / (limit || 1)), 1),
          },
        },
        message: 'Get payment return sales transaction details successfully',
      };
    } catch (error) {
      console.error('Error in paymentReturnSalesTranscationReportTable:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getPaymentGraphicalReports(data, { SaleModel } = {}) {
    try {
      // Match legacy PHP BaseModel::startingDate / endingDate behaviour
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTimestamp = BaseModel.startingDate(data.starting_date, timeZone);
      const toTimestamp = BaseModel.endingDate(data.ending_date, timeZone);

      const fromDate = new Date(fromTimestamp || 0);
      const toDate = new Date(toTimestamp || Date.now());

      // Branch ids
      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      if (objectBranchIds.length) {
        andConditions.push({ branch_id: { $in: objectBranchIds } });
      }
      andConditions.push({ date: { $gte: fromDate, $lte: toDate } });
      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      const filters = { $and: andConditions };

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const cursor = salesCollection.find(filters, {
        projection: {
          payment_mode: 1,
          multi_payment: 1,
          items_total: 1,
          items_return_total: 1,
        },
        limit: 50000,
        batchSize: 1000,
      });

      /** @type {Record<string, { sales_payment_mode: string, sales_payment: number, sales_return_total: number }>} */
      const methodTotals = {};

      const docs = await cursor.toArray();

      // Local helper copied from sale.model.js to match legacy rounding behaviour
      const round = (value, decimals = 2) => {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return 0;
        const factor = Math.pow(10, decimals);
        return value && !Number.isNaN(value) ? Math.round(value * factor) / factor : 0;
      };

      for (const doc of docs) {
        const itemsTotal = Number(doc.items_total || 0);
        const itemsReturn = Number(doc.items_return_total || 0);

        let multiPaymentArr = null;
        const raw = doc.multi_payment;
        if (raw !== undefined && raw !== null && raw !== '') {
          if (Array.isArray(raw)) {
            multiPaymentArr = raw;
          } else if (typeof raw === 'object') {
            multiPaymentArr = raw;
          } else if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed !== '') {
              try {
                const decoded = JSON.parse(trimmed);
                if (decoded && typeof decoded === 'object') {
                  multiPaymentArr = decoded;
                }
              } catch (e) {
                // Ignore malformed JSON and fall back to single payment_mode
              }
            }
          }
        }

        let usedMulti = false;
        if (
          multiPaymentArr &&
          typeof multiPaymentArr === 'object' &&
          Object.keys(multiPaymentArr).length > 0
        ) {
          // First compute the sum of positive multi_payment amounts.
          let sumMulti = 0.0;
          for (const amount of Object.values(multiPaymentArr)) {
            const num = Number(amount) || 0;
            if (num > 0) {
              sumMulti += num;
            }
          }

          if (sumMulti > 0) {
            for (const [method, amount] of Object.entries(multiPaymentArr)) {
              const num = Number(amount) || 0;
              if (num <= 0) continue;

              usedMulti = true;

              // Normalise key: lowercase, no spaces; keep first
              // seen variant as display label.
              let displayName = String(method || '').trim();
              if (!displayName) {
                displayName = 'N/A';
              }
              const methodKey = displayName.replace(/\s+/g, '').toLowerCase();

              if (!methodTotals[methodKey]) {
                methodTotals[methodKey] = {
                  sales_payment_mode: displayName,
                  sales_payment: 0.0,
                  sales_return_total: 0.0,
                };
              }

              // Amount actually taken via this method.
              methodTotals[methodKey].sales_payment += num;

              // Allocate returns proportionally to the payment split.
              const ratio = sumMulti > 0 ? num / sumMulti : 0.0;
              methodTotals[methodKey].sales_return_total += itemsReturn * ratio;
            }
          }
        }

        // Fallback: no usable multi_payment found; treat the whole bill
        // as belonging to its single payment_mode value.
        if (!usedMulti) {
          let mode = doc.payment_mode ? String(doc.payment_mode).trim() : '';
          if (!mode) {
            mode = 'N/A';
          }

          const methodKey = mode.replace(/\s+/g, '').toLowerCase();
          if (!methodTotals[methodKey]) {
            methodTotals[methodKey] = {
              sales_payment_mode: mode,
              sales_payment: 0.0,
              sales_return_total: 0.0,
            };
          }

          methodTotals[methodKey].sales_payment += itemsTotal;
          methodTotals[methodKey].sales_return_total += itemsReturn;
        }
      }

      // Normalise into the expected array format; sort by sales_payment
      // descending so the most-used modes appear first.
      const salesValues = Object.values(methodTotals)
        .filter((totals) => {
          const paymentMode = String(totals.sales_payment_mode || '').trim();
          return paymentMode !== '' && paymentMode.toLowerCase() !== 'n/a' && paymentMode !== 'N/A';
        })
        .map((totals) => ({
          sales_payment_mode: totals.sales_payment_mode,
          sales_payment: round(totals.sales_payment || 0, 2),
          sales_return_total: round(totals.sales_return_total || 0, 2),
        }));

      salesValues.sort((a, b) => {
        const av = a.sales_payment || 0;
        const bv = b.sales_payment || 0;
        if (av === bv) return 0;
        return av < bv ? 1 : -1; // descending
      });

      const graphicalData = {
        sales: salesValues,
      };

      return {
        status: true,
        data: graphicalData,
        message: 'Graphical report successfully',
      };
    } catch (error) {
      console.error('Error in getPaymentGraphicalReports:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async customerSaleDetailsPage(value, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      // Normalize branch ids (may come as single value or array)
      const rawBranch = value.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      // Validate customer id & branches
      if (
        !value.customer_id ||
        !mongoose.Types.ObjectId.isValid(value.customer_id) ||
        !objectBranchIds.length
      ) {
        return {
          status: false,
          data: null,
          message: 'Invalid branch or customer id',
        };
      }

      const customerObjectId = new mongoose.Types.ObjectId(value.customer_id);

      // Match legacy PHP fields (branch_id + customer_id) and also support
      // new Mongoose-based sales using the `customer` ref field.
      const matchFilter = {
        $and: [
          { branch_id: { $in: objectBranchIds } },
          {
            $or: [{ customer_id: customerObjectId }, { customer: customerObjectId }],
          },
        ],
      };

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);
      const sort = options.sort || { _id: 1 };

      // Fetch paginated list of sales for this customer
      const list = await Model.find(matchFilter).sort(sort).skip(skip).limit(limit).lean();

      const totalCount = await Model.countDocuments(matchFilter);

      // Build table structure compatible with PHP BaseModel::page
      const tableData = {
        status: true,
        data: {
          list,
          total: totalCount,
          current_page: page,
          total_pages: limit ? Math.ceil(totalCount / limit) : 0,
          per_page: limit,
        },
        message: 'Get Successfully',
      };

      // Aggregate total sales amount for this customer (similar to PHP)
      const saleList = await Model.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$customer_id',
            total_amount: {
              $sum: {
                // Prefer items_total (legacy) but fall back to sales_total/total
                $ifNull: ['$items_total', { $ifNull: ['$sales_total', '$total'] }],
              },
            },
          },
        },
      ]);

      const totals = saleList.map((doc) =>
        typeof doc.total_amount === 'number' ? round(doc.total_amount, 2) : 0
      );

      const arrTableData = {
        table: tableData,
        total: totals,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in customerSaleDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async customerCategorySaleDetailsPage(value, options = {}, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      // Normalize branch ids (may come as single value or array)
      const rawBranch = value.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const objectBranchIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      // Validate category id & branches
      if (
        !value.category_id ||
        !mongoose.Types.ObjectId.isValid(value.category_id) ||
        !objectBranchIds.length
      ) {
        return {
          status: false,
          data: null,
          message: 'Invalid branch or category id',
        };
      }

      const categoryObjectId = new mongoose.Types.ObjectId(value.category_id);

      const matchFilter = {
        $and: [{ branch_id: { $in: objectBranchIds } }, { category_id: categoryObjectId }],
      };

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);
      const sort = options.sort || { _id: 1 };

      // Fetch paginated list of sales for this customer category
      const list = await Model.find(matchFilter).sort(sort).skip(skip).limit(limit).lean();

      const totalCount = await Model.countDocuments(matchFilter);

      const tableData = {
        status: true,
        data: {
          list,
          total: totalCount,
          current_page: page,
          total_pages: limit ? Math.ceil(totalCount / limit) : 0,
          per_page: limit,
        },
        message: 'Get Successfully',
      };

      // Aggregate total sales amount for this customer category
      const saleList = await Model.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$category_id',
            total_amount: {
              $sum: {
                $ifNull: ['$items_total', { $ifNull: ['$sales_total', '$total'] }],
              },
            },
          },
        },
      ]);

      const totals = saleList.map((doc) =>
        typeof doc.total_amount === 'number' ? round(doc.total_amount, 2) : 0
      );

      const arrTableData = {
        table: tableData,
        total: totals,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in customerCategorySaleDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async returnSalesOrder(payload = {}, { SaleModel } = {}) {
    let returnLockContext = null;
    const releaseReturnLock = async () => {
      if (!returnLockContext) return;
      const { salesCollection, saleObjectId, licenseFilter, signature, token } = returnLockContext;
      try {
        await salesCollection.updateOne(
          {
            _id: saleObjectId,
            ...licenseFilter,
            'return_refund_lock.signature': signature,
            'return_refund_lock.token': token,
          },
          { $unset: { return_refund_lock: '' } }
        );
      } catch (unlockError) {
        console.error('Error releasing return/refund lock:', unlockError);
      } finally {
        returnLockContext = null;
      }
    };

    try {
      if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
        return {
          status: false,
          data: null,
          message: 'Return sales value is null',
        };
      }

      const MongooseObjectId = mongoose.Types.ObjectId;

      const partialCheck = String(payload.partial_check) === 'true';
      const paymentPending = Number(payload.payment_pending || 0);

      if (partialCheck && paymentPending > 0) {
        return {
          status: false,
          data: null,
          message: 'Please complete your transaction',
        };
      }

      const rawSaleId =
        payload.sales_id || payload.id || payload.sale_id || payload.sales_document_id || null;

      if (!rawSaleId || !MongooseObjectId.isValid(String(rawSaleId))) {
        return {
          status: false,
          data: null,
          message: 'Sales id is missing or invalid',
        };
      }

      const saleObjectId = new MongooseObjectId(String(rawSaleId));

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');
      const branchesCollection = db.collection('branches');
      const itemsCollection = db.collection('items');

      const licenseFilter = BaseModel.license ? { license: BaseModel.license } : {};

      let saleDocument = await salesCollection.findOne({
        _id: saleObjectId,
        ...activeTenantFilter(),
      });

      if (!saleDocument) {
        return {
          status: false,
          data: null,
          message: 'Sale not found',
        };
      }

      const branchId =
        saleDocument.branch_id || saleDocument.branch || BaseModel.currentBranch || null;

      let branchSettings = null;
      if (branchId) {
        let normalizedBranchId = branchId;
        if (branchId instanceof MongooseObjectId) {
          normalizedBranchId = branchId;
        } else if (MongooseObjectId.isValid(String(branchId))) {
          normalizedBranchId = new MongooseObjectId(String(branchId));
        }

        try {
          branchSettings = await branchesCollection.findOne({
            _id: normalizedBranchId,
            ...(BaseModel.license ? { license: BaseModel.license } : {}),
          });
        } catch (e) {
          console.error('Error loading branch settings for return sales:', e);
        }
      }

      const licenseId = saleDocument.license || BaseModel.license || null;

      const items = Array.isArray(payload.items) ? payload.items : [];
      const returnItems = Array.isArray(payload.items_return) ? payload.items_return : [];
      const now = new Date();

      if (!returnItems.length) {
        return {
          status: false,
          data: null,
          message: 'No return items provided',
        };
      }

      const returnSignature = buildReturnSignature(saleObjectId, returnItems, payload);
      const existingReturnTransactions = Array.isArray(saleDocument.return_refund_transactions)
        ? saleDocument.return_refund_transactions
        : [];

      if (existingReturnTransactions.some((entry) => entry?.signature === returnSignature)) {
        return {
          status: false,
          statusCode: 409,
          data: null,
          message: 'This refund has already been processed for this sale',
        };
      }

      const lockExpiry = new Date(now.getTime() - 2 * 60 * 1000);
      const lockToken = new MongooseObjectId().toHexString();
      const lockResult = await salesCollection.updateOne(
        {
          _id: saleObjectId,
          ...licenseFilter,
          $and: [
            {
              $or: [
                { return_refund_lock: { $exists: false } },
                { 'return_refund_lock.locked_at': { $lt: lockExpiry } },
                { 'return_refund_lock.signature': returnSignature },
              ],
            },
            {
              $or: [
                { return_refund_transactions: { $exists: false } },
                {
                  return_refund_transactions: {
                    $not: { $elemMatch: { signature: returnSignature } },
                  },
                },
              ],
            },
          ],
        },
        {
          $set: {
            return_refund_lock: {
              token: lockToken,
              signature: returnSignature,
              locked_at: now,
              locked_by: BaseModel.loggedUser || null,
              locked_by_name: BaseModel.loggedUserName || 'System',
            },
          },
        }
      );

      if (!lockResult.modifiedCount) {
        return {
          status: false,
          statusCode: 409,
          data: null,
          message: 'Refund is already processing or already completed for this sale',
        };
      }

      returnLockContext = {
        salesCollection,
        saleObjectId,
        licenseFilter,
        signature: returnSignature,
        token: lockToken,
      };

      saleDocument =
        (await salesCollection.findOne({ _id: saleObjectId, ...licenseFilter })) || saleDocument;

      const remainingQtyByItem = new Map();
      for (const item of Array.isArray(saleDocument.items) ? saleDocument.items : []) {
        addQtyToMap(remainingQtyByItem, normalizeReturnItemKey(item), item.item_quantity);
      }

      const previouslyReturnedQtyByItem = buildReturnedQtyMap(saleDocument.items_return);
      const incomingReturnQtyByItem = new Map();
      for (const item of returnItems) {
        addQtyToMap(incomingReturnQtyByItem, normalizeReturnItemKey(item), item.item_quantity);
      }

      const overReturnItems = [];
      for (const [itemId, incomingQty] of incomingReturnQtyByItem.entries()) {
        const remainingQty = roundQty(remainingQtyByItem.get(itemId) || 0);
        const alreadyReturnedQty = roundQty(previouslyReturnedQtyByItem.get(itemId) || 0);
        const originalQty = roundQty(remainingQty + alreadyReturnedQty);

        if (incomingQty <= 0 || incomingQty > remainingQty + 0.0001) {
          const returnLine =
            returnItems.find((item) => normalizeReturnItemKey(item) === itemId) || {};
          overReturnItems.push({
            item_id: itemId,
            item_name: returnLine.item_name || returnLine.name || '',
            original_quantity: originalQty,
            already_returned_quantity: alreadyReturnedQty,
            remaining_quantity: remainingQty,
            requested_quantity: incomingQty,
          });
        }
      }

      if (overReturnItems.length) {
        await releaseReturnLock();
        return {
          status: false,
          statusCode: 409,
          data: {
            items: overReturnItems,
          },
          message: 'Return quantity cannot exceed the remaining sale quantity',
        };
      }

      const firstNonEmptyFromArray = (arr, key) => {
        if (!Array.isArray(arr)) return null;
        for (const entry of arr) {
          if (entry && typeof entry[key] === 'string' && entry[key].trim() !== '') {
            return entry[key];
          }
        }
        return null;
      };

      const salesDescriptionFromPayload =
        firstNonEmptyFromArray(returnItems, 'sales_description') ||
        firstNonEmptyFromArray(items, 'sales_description') ||
        (typeof payload.sales_description === 'string' ? payload.sales_description : null);

      const paymentDescriptionFromPayload =
        firstNonEmptyFromArray(returnItems, 'payment_description') ||
        firstNonEmptyFromArray(items, 'payment_description') ||
        (typeof payload.payment_description === 'string' ? payload.payment_description : null);

      const discountDescriptionFromPayload =
        firstNonEmptyFromArray(returnItems, 'discount_description') ||
        firstNonEmptyFromArray(items, 'discount_description') ||
        (typeof payload.discount_description === 'string' ? payload.discount_description : null);

      const originalSaleItems = Array.isArray(saleDocument.items) ? saleDocument.items : [];

      const itemsSale = [];

      for (const item of items) {
        const rawItemId = item.item_id || item.item || item.id;
        if (!rawItemId || !MongooseObjectId.isValid(String(rawItemId))) {
          continue;
        }

        const itemObjectId = new MongooseObjectId(String(rawItemId));
        const itemFilter = {
          _id: itemObjectId,
          ...(licenseId ? { license: licenseId } : {}),
        };

        const itemDoc = await itemsCollection.findOne(itemFilter);
        if (!itemDoc) {
          continue;
        }

        const qty = toNumberSafe(item.item_quantity, 0);
        if (!qty || qty <= 0) {
          continue;
        }

        const price = toNumberSafe(item.item_price, 0);
        const totalAmount = toNumberSafe(item.total_amount, qty * price);
        const companyPrice = qty * toNumberSafe(itemDoc.company_price, 0);

        const taxType =
          item.tax_type === 'Exc' || item.tax_type === 'exclusive' ? 'exclusive' : 'inclusive';

        let taxRaw = item.tax;
        if (typeof taxRaw === 'string') {
          // The hyphen is last in the class, so it is a literal and needs no escape.
          const cleaned = taxRaw.replace(/[^0-9.-]/g, '');
          taxRaw = cleaned;
        }

        let taxValue = toNumberSafe(taxRaw, 0);
        if (!taxValue && typeof itemDoc.tax === 'number') {
          taxValue = toNumberSafe(itemDoc.tax, 0);
        }

        const igst = toNumberSafe(item.igst_tax, 0);
        const cgst = toNumberSafe(item.cgst_tax, 0);
        const sgst = toNumberSafe(item.sgst_tax, 0);

        const taxAmount = igst > 0 ? igst : cgst > 0 ? cgst * 2 : 0;

        const discountAmount = toNumberSafe(item.item_discount, 0);
        const discountPercentage =
          discountAmount > 0 ? 0 : toNumberSafe(item.item_discount_percentage, 0);

        const availableQty = toNumberSafe(item.item_available_quantity, 0);

        itemsSale.push({
          item_status: 'Add',
          return: false,
          item_name: item.item_name,
          item_sku: itemDoc.itemid || itemDoc.sku || '',
          item_price: price,
          item_discount: discountAmount,
          item_discount_percentage: discountPercentage,
          item_quantity: qty,
          item_available_quantity: availableQty,
          item_id: rawItemId,
          total_amount: totalAmount,
          barcode_id: itemDoc.barcode_id,
          company_price_total: companyPrice,
          category_id: itemDoc.category_id,
          category_name: itemDoc.category_name,
          supplier_id: itemDoc.supplier_id,
          supplier_name: itemDoc.supplier_name,
          tax: taxValue,
          tax_name: itemDoc.tax_name,
          tax_amount: taxAmount,
          tax_type: taxType,
          igst_tax: igst,
          cgst_tax: cgst,
          sgst_tax: sgst,
          tax_fields: itemDoc.tax_fields,
          item_unit: item.item_unit || 'qty',
        });
      }

      const itemsReturn = [];
      let itemsTotalAmount = 0;

      const returnFlag = true;
      const process = 'Return';

      for (const item of returnItems) {
        const rawItemId = item.item_id || item.item || item.id;
        if (!rawItemId || !MongooseObjectId.isValid(String(rawItemId))) {
          continue;
        }

        const itemObjectId = new MongooseObjectId(String(rawItemId));
        const itemFilter = {
          _id: itemObjectId,
          ...(licenseId ? { license: licenseId } : {}),
        };

        const itemDoc = await itemsCollection.findOne(itemFilter);
        if (!itemDoc) {
          continue;
        }

        const qty = toNumberSafe(item.item_quantity, 0);
        const price = toNumberSafe(item.item_price, 0);
        const totalAmount = toNumberSafe(item.total_amount, qty * price);

        const companyPrice = qty * toNumberSafe(itemDoc.company_price, 0);

        const originalLine =
          originalSaleItems.find((line) => {
            if (!line || typeof line !== 'object') return false;
            const srcId = line.item_id || line.item || line.itemId;
            return srcId && String(srcId) === String(rawItemId);
          }) || null;

        const discountAmountRaw = toNumberSafe(originalLine && originalLine.item_discount, 0);
        const discountPercentageRaw = toNumberSafe(
          originalLine && originalLine.item_discount_percentage,
          0
        );
        const discountAmount = discountAmountRaw > 0 ? discountAmountRaw : 0;
        const discountPercentage = discountAmountRaw === 0 ? discountPercentageRaw : 0;

        const taxType =
          item.tax_type === 'Exc' || item.tax_type === 'exclusive' ? 'exclusive' : 'inclusive';

        const taxSource = originalLine
          ? (originalLine.tax ?? originalLine.tax_rate ?? originalLine.item_tax_rate)
          : undefined;

        const payloadIgst = toNumberSafe(item.igst_tax, 0);
        const payloadCgst = toNumberSafe(item.cgst_tax, 0);
        const payloadSgst = toNumberSafe(item.sgst_tax, 0);

        const baseIgst = toNumberSafe(originalLine && originalLine.igst_tax, 0);
        const baseCgst = toNumberSafe(originalLine && originalLine.cgst_tax, 0);
        const baseSgst = toNumberSafe(originalLine && originalLine.sgst_tax, 0);

        const igst = payloadIgst > 0 ? payloadIgst : baseIgst;
        const cgst = payloadCgst > 0 ? payloadCgst : baseCgst;
        const sgst = payloadSgst > 0 ? payloadSgst : baseSgst;

        const taxAmount =
          igst > 0
            ? igst
            : cgst > 0
              ? cgst * 2
              : toNumberSafe(originalLine && originalLine.tax_amount, 0);
        const taxValue = toNumberSafe(taxSource, 0);

        const returnPrefixId = `RFS${formatDate(now, {
          year: '2-digit',
          month: '2-digit',
          day: '2-digit',
        }).replace(/[^0-9]/g, '')}${Math.floor(Math.random() * 1e4)}`;

        itemsReturn.push({
          item_status: process,
          return: returnFlag,
          item_name: item.item_name,
          item_sku:
            (originalLine && (originalLine.item_sku || originalLine.item_code)) ||
            itemDoc.itemid ||
            itemDoc.sku ||
            '',
          item_price: price,
          item_discount: discountAmount,
          item_discount_percentage: discountPercentage,
          item_quantity: qty,
          item_id: rawItemId,
          total_amount: totalAmount,
          barcode_id: itemDoc.barcode_id,
          company_price_total: companyPrice,
          category_id: itemDoc.category_id,
          category_name: itemDoc.category_name,
          supplier_id: itemDoc.supplier_id,
          supplier_name: itemDoc.supplier_name,
          tax: taxValue,
          tax_name: itemDoc.tax_name,
          tax_amount: taxAmount,
          tax_type: taxType,
          return_id: returnPrefixId,
          return_date: now,
          igst_tax: igst,
          cgst_tax: cgst,
          sgst_tax: sgst,
          tax_fields: itemDoc.tax_fields,
          item_unit: item.item_unit || 'qty',
        });

        itemsTotalAmount += totalAmount;
      }

      const extraDiscountRaw =
        payload.extra_discount !== undefined && payload.extra_discount !== null
          ? Number(payload.extra_discount)
          : 0;
      let extraDiscount = Number.isFinite(extraDiscountRaw) ? extraDiscountRaw : 0;

      let itemsTotMinusExtraDisc = itemsTotalAmount - extraDiscount;

      if (payload.extra_discount_type === 'percent') {
        const discAmt = (itemsTotalAmount * extraDiscount) / 100;
        itemsTotMinusExtraDisc = itemsTotalAmount - discAmt;
        extraDiscount = discAmt;
      }

      const roundOffCheck = payload.round_off_check === true;
      const roundOffValue = roundOffCheck
        ? round(itemsTotMinusExtraDisc) - itemsTotMinusExtraDisc
        : 0;
      const returnItemsTotalAmount = roundOffCheck
        ? round(itemsTotMinusExtraDisc)
        : itemsTotMinusExtraDisc;

      const returnObjId = new MongooseObjectId();

      const itemsReturnData = {
        returnArray: {
          returnObjId,
          returnId: `RFS${formatDate(now, {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
          }).replace(/[^0-9]/g, '')}${Math.floor(Math.random() * 1e4)}`,
          returnDate: now,
          returnValue: itemsReturn,
          roundOff: round(roundOffValue, 2),
          itemsTotalAmount: round(returnItemsTotalAmount, 2),
          extraDiscount: round(Math.abs(extraDiscount), 2),
          extraDiscountType: payload.extra_discount_type,
        },
      };

      const pushReturnResult = await salesCollection.updateOne(
        {
          _id: saleObjectId,
          ...licenseFilter,
          'return_refund_lock.token': lockToken,
        },
        {
          $push: {
            items_return: itemsReturnData,
            return_refund_transactions: {
              signature: returnSignature,
              return_obj_id: returnObjId,
              return_id: itemsReturnData.returnArray.returnId,
              amount: round(returnItemsTotalAmount, 2),
              item_count: itemsReturn.length,
              created_at: now,
              created_by: BaseModel.loggedUser || null,
              created_by_name: BaseModel.loggedUserName || 'System',
            },
          },
        }
      );

      if (!pushReturnResult.modifiedCount) {
        await releaseReturnLock();
        return {
          status: false,
          statusCode: 409,
          data: null,
          message: 'Refund could not be saved because another return changed this sale',
        };
      }

      try {
        const stockLogsRepository = new StockLogsRepository();

        for (const item of returnItems) {
          const rawItemId = item.item_id || item.item || item.id;
          if (!rawItemId || !MongooseObjectId.isValid(String(rawItemId))) {
            continue;
          }

          const itemObjectId = new MongooseObjectId(String(rawItemId));
          const itemFilter = {
            _id: itemObjectId,
            ...(licenseId ? { license: licenseId } : {}),
          };

          const itemDoc = await itemsCollection.findOne(itemFilter);
          if (!itemDoc) {
            continue;
          }

          const openingBalance = Number(itemDoc.available_quantity || 0);
          const itemQty = Number(item.item_quantity || 0);
          if (!itemQty || itemQty <= 0) {
            continue;
          }

          const closingBalance = openingBalance + itemQty;

          // PHP checks: $item_documents['track_inventory'] === true (boolean or string 'true')
          if (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true') {
            const countStr = String(itemQty);

            await stockLogsRepository.createStockLog({
              stocklog: true,
              branch_id: branchId,
              view_item_id: itemObjectId,
              item_barcode_id: itemDoc.barcode_id || '',
              item_name: item.item_name || item.name || itemDoc.name || '',
              item_quantity: itemQty,
              process: 'Return Sale',
              reference: payload.alternative_id || saleDocument.alternative_id || saleObjectId,
              opening_balance: openingBalance,
              closing_balance: closingBalance,
              count: countStr,
              date: now,
              action: 'Add',
              changed_by_userid: BaseModel.loggedUser,
              changed_by: BaseModel.loggedUserName || 'System',
            });

            await itemsCollection.updateOne(itemFilter, {
              $set: {
                available_quantity: closingBalance,
              },
            });
          }
        }
      } catch (e) {
        console.error('Error updating stock for return sale:', e);
      }

      try {
        saleDocument =
          (await salesCollection.findOne({ _id: saleObjectId, ...licenseFilter })) || saleDocument;

        const extra_discount = Number(saleDocument.extra_discount || 0);
        let return_extra_discount = 0;
        let return_sale_amount = 0;
        let return_round_off = 0;
        let return_sale_amount_round = 0;
        const returnDiscountData = [];
        const returnTaxData = [];
        const returnSubtotalData = [];
        let return_sale_company_amount = 0;

        const itemsReturnBlocks = Array.isArray(saleDocument.items_return)
          ? saleDocument.items_return
          : [];

        for (const block of itemsReturnBlocks) {
          if (!block || !block.returnArray) continue;
          const ra = block.returnArray;

          return_round_off += Number(ra.roundOff || 0);
          return_sale_amount_round += Number(ra.itemsTotalAmount || 0);
          return_extra_discount += Number(ra.extraDiscount || 0);

          const values = Array.isArray(ra.returnValue) ? ra.returnValue : [];
          for (const documents of values) {
            const itemQuantity = Number(documents.item_quantity || 0);
            const itemPrice = Number(documents.item_price || 0);
            const itemAmount = itemPrice * itemQuantity;
            const itemTax = Number(documents.tax || 0);

            return_sale_company_amount += Number(documents.company_price_total || 0);

            return_sale_amount += Number(documents.total_amount || 0);

            const itemDiscount = Number(documents.item_discount || 0);
            const itemDiscountPercentage = Number(documents.item_discount_percentage || 0);
            const taxTypeDoc = documents.tax_type === 'exclusive' ? 'exclusive' : 'inclusive';

            let itemDiscountAmountMultiple = 0;

            if (itemDiscount > 0 && itemTax > 0) {
              itemDiscountAmountMultiple = itemDiscount * itemQuantity;
              let subTotal = itemAmount - itemDiscountAmountMultiple;
              if (taxTypeDoc === 'exclusive') {
                const itemSubTaxTotalCalculation = (subTotal / 100) * itemTax;
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({
                  discount_amount: itemDiscountAmountMultiple,
                });
                returnSubtotalData.push({
                  subtotal_amount: subTotal + itemDiscountAmountMultiple,
                });
              } else {
                const taxPrice = (itemPrice * itemTax) / (100 + itemTax);
                const taxItemPrice = itemPrice - taxPrice;
                const taxDiscountMultiple = taxItemPrice * itemQuantity;
                const taxQuantityMultiple = taxDiscountMultiple - itemDiscountAmountMultiple;
                subTotal = taxQuantityMultiple;
                const itemSubTaxTotalCalculation = (subTotal / 100) * itemTax;
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({
                  discount_amount: itemDiscountAmountMultiple,
                });
                returnSubtotalData.push({
                  subtotal_amount: subTotal + itemDiscountAmountMultiple,
                });
              }
            } else if (itemDiscountPercentage > 0 && itemTax > 0) {
              const itemDiscountPercentageMultiple = itemDiscountPercentage;
              const itemTaxTotalCalculation =
                itemAmount - itemAmount * (itemDiscountPercentageMultiple / 100);
              if (taxTypeDoc === 'exclusive') {
                const itemSubTaxTotalCalculation = (itemTaxTotalCalculation / 100) * itemTax;
                itemDiscountAmountMultiple = itemAmount * (itemDiscountPercentageMultiple / 100);
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({
                  discount_amount: itemDiscountAmountMultiple,
                });
                returnSubtotalData.push({
                  subtotal_amount: itemTaxTotalCalculation + itemDiscountAmountMultiple,
                });
              } else {
                const taxPrice = (itemPrice * itemTax) / (100 + itemTax);
                const taxItemPrice = itemPrice - taxPrice;
                const taxDiscountMultiple = taxItemPrice * itemQuantity;
                itemDiscountAmountMultiple =
                  taxDiscountMultiple * (itemDiscountPercentageMultiple / 100);
                const taxQuantityMultiple = taxDiscountMultiple - itemDiscountAmountMultiple;
                const itemSubTaxTotalCalculation = (taxQuantityMultiple / 100) * itemTax;
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({
                  discount_amount: itemDiscountAmountMultiple,
                });
                returnSubtotalData.push({
                  subtotal_amount: taxQuantityMultiple + itemDiscountAmountMultiple,
                });
              }
              itemDiscountAmountMultiple = 0;
            } else if (itemTax > 0) {
              if (taxTypeDoc === 'exclusive') {
                const itemSubTaxTotalCalculation = (itemAmount / 100) * itemTax;
                const subtotal = itemAmount + itemSubTaxTotalCalculation;
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({ discount_amount: 0 });
                returnSubtotalData.push({
                  subtotal_amount: subtotal - itemSubTaxTotalCalculation,
                });
              } else {
                const taxPrice = (itemPrice * itemTax) / (100 + itemTax);
                const taxItemPrice = itemPrice - taxPrice;
                const taxDiscountMultiple = taxItemPrice * itemQuantity;
                const taxQuantityMultiple = taxDiscountMultiple;
                const itemSubTaxTotalCalculation = (taxQuantityMultiple / 100) * itemTax;
                returnTaxData.push({ tax_amount: itemSubTaxTotalCalculation });
                returnDiscountData.push({ discount_amount: 0 });
                returnSubtotalData.push({ subtotal_amount: itemAmount });
              }
            } else if (itemDiscount > 0) {
              itemDiscountAmountMultiple = itemDiscount * itemQuantity;
              returnTaxData.push({ tax_amount: 0 });
              returnDiscountData.push({
                discount_amount: itemDiscountAmountMultiple,
              });
              returnSubtotalData.push({ subtotal_amount: itemAmount });
            } else if (itemDiscountPercentage > 0) {
              const itemDiscountPercentageMultiple = itemDiscountPercentage;
              returnTaxData.push({ tax_amount: 0 });
              returnDiscountData.push({
                discount_amount: itemAmount * (itemDiscountPercentageMultiple / 100),
              });
              returnSubtotalData.push({ subtotal_amount: itemAmount });
            } else {
              returnTaxData.push({ tax_amount: 0 });
              returnDiscountData.push({ discount_amount: 0 });
              returnSubtotalData.push({ subtotal_amount: itemAmount });
            }
          }
        }

        const return_sale_subtotal_amount = returnSubtotalData.reduce(
          (sum, row) => sum + Number(row.subtotal_amount || 0),
          0
        );
        const return_sale_discount_amount = returnDiscountData.reduce(
          (sum, row) => sum + Number(row.discount_amount || 0),
          0
        );
        const return_sale_tax_amount = returnTaxData.reduce(
          (sum, row) => sum + Number(row.tax_amount || 0),
          0
        );

        const itemsArray = Array.isArray(itemsSale) ? itemsSale : [];
        let sale_total_amount = itemsArray.reduce((sum, row) => {
          if (!row || typeof row !== 'object') return sum;

          const lineTotal = toNumberSafe(row.total_amount ?? row.total ?? row.items_total, 0);

          return sum + lineTotal;
        }, 0);

        if (!itemsArray.length) {
          sale_total_amount = 0;
        }

        const base_sale_subtotal = Number(
          saleDocument.sales_sub_total ?? saleDocument.items_subtotal ?? sale_total_amount
        );
        const base_sale_discount = Number(saleDocument.discount || 0);
        const base_sale_tax = Number(saleDocument.tax || 0);
        let base_sale_company = Number(saleDocument.total_companyprice || 0);

        if (!base_sale_company && Array.isArray(originalSaleItems)) {
          base_sale_company = originalSaleItems.reduce(
            (sum, line) =>
              sum + Number(line && line.company_price_total ? line.company_price_total : 0),
            0
          );
        }

        const sale_subtotal_amount = Math.max(base_sale_subtotal - return_sale_subtotal_amount, 0);
        const sale_discount_amount = Math.max(base_sale_discount - return_sale_discount_amount, 0);
        const sale_tax_amount = Math.max(base_sale_tax - return_sale_tax_amount, 0);

        let sale_company_amount = itemsArray.reduce((sum, row) => {
          if (!row || typeof row !== 'object') return sum;
          const cp = toNumberSafe(row.company_price_total, 0);
          return sum + cp;
        }, 0);

        if (!Number.isFinite(sale_company_amount)) {
          sale_company_amount = 0;
        }

        const updatedRoundOffValue = roundOffCheck
          ? round(sale_total_amount) - sale_total_amount
          : 0;
        const updatedItemsTotalAmount = roundOffCheck
          ? round(sale_total_amount)
          : sale_total_amount;

        let extraDiscSubReturnExtradisc = extra_discount - return_extra_discount;
        if (payload.extra_discount_type === 'percent') {
          extraDiscSubReturnExtradisc = sale_total_amount * (extra_discount / 100);
        }

        if (return_sale_amount_round !== 0) {
          return_sale_amount = return_sale_amount_round;
        }

        const updatedSaleProcess = sale_total_amount > 0 ? 'PartialReturn' : 'FullReturn';

        const finalItemsArray = updatedSaleProcess === 'FullReturn' ? [] : itemsArray;
        const finalNumberOfItems = updatedSaleProcess === 'FullReturn' ? 0 : itemsArray.length || 0;

        const updateData = {
          sale_process: updatedSaleProcess,
          gst: branchSettings && branchSettings.indian_gst === 'gst_on' ? 'enable' : 'disable',
          multi_payment:
            saleDocument &&
            saleDocument.multi_payment !== undefined &&
            saleDocument.multi_payment !== null
              ? saleDocument.multi_payment
              : [],
          updated_date: now,
          updated_by: BaseModel.loggedUserName,
          updated_by_id: BaseModel.loggedUser,
          items: finalItemsArray,
          number_of_items: finalNumberOfItems,
          tax: round(sale_tax_amount, 2),
          discount: round(sale_discount_amount, 2),
          items_total: round(updatedItemsTotalAmount - extraDiscSubReturnExtradisc, 2),
          items_subtotal: sale_subtotal_amount,
          return_tax: round(return_sale_tax_amount, 2),
          return_discount: round(return_sale_discount_amount, 2),
          items_return_total: round(return_sale_amount, 2),
          return_round_off: round(return_round_off, 2),
          items_return_subtotal: return_sale_subtotal_amount,
          sales_description:
            salesDescriptionFromPayload &&
            typeof salesDescriptionFromPayload === 'string' &&
            salesDescriptionFromPayload.trim() !== ''
              ? salesDescriptionFromPayload
              : saleDocument.sales_description || '',
          payment_description:
            paymentDescriptionFromPayload &&
            typeof paymentDescriptionFromPayload === 'string' &&
            paymentDescriptionFromPayload.trim() !== ''
              ? paymentDescriptionFromPayload
              : saleDocument.payment_description || '',
          discount_description:
            discountDescriptionFromPayload &&
            typeof discountDescriptionFromPayload === 'string' &&
            discountDescriptionFromPayload.trim() !== ''
              ? discountDescriptionFromPayload
              : saleDocument.discount_description || '',
          notes:
            salesDescriptionFromPayload &&
            typeof salesDescriptionFromPayload === 'string' &&
            salesDescriptionFromPayload.trim() !== ''
              ? salesDescriptionFromPayload
              : saleDocument.notes || saleDocument.sales_description || '',
          round_off: round(updatedRoundOffValue, 2),
          sale_extra_discount: round(Math.abs(extraDiscSubReturnExtradisc), 2),
          return_extra_discount: round(Math.abs(return_extra_discount), 2),
          total_companyprice: sale_company_amount,
        };

        await salesCollection.updateOne(
          {
            _id: saleObjectId,
            ...licenseFilter,
            'return_refund_lock.token': lockToken,
          },
          {
            $set: updateData,
          }
        );

        try {
          const cashregisterCollection = db.collection('cashregister');
          await cashregisterCollection.updateOne(
            {
              'register_sales.sales_id': saleObjectId,
              ...licenseFilter,
            },
            {
              $set: {
                'register_sales.$.sale_process': updatedSaleProcess,
                'register_sales.$.register_amount': sale_total_amount,
                'register_sales.$.registerItems_return_total': return_sale_amount,
              },
            }
          );
        } catch (err) {
          console.error('Error updating cashregister for return sale:', err);
        }
      } catch (aggErr) {
        console.error('Error updating sale aggregates for return:', aggErr);
      }

      const printFlag =
        payload.print === 'on' ||
        payload.print === true ||
        payload.print === 'true' ||
        (branchSettings && branchSettings.printall === true);

      await releaseReturnLock();

      return {
        status: true,
        data: {
          print: printFlag,
          sale_id: String(returnObjId || saleObjectId),
          return_id: itemsReturnData.returnArray.returnId,
          return_amount: round(returnItemsTotalAmount, 2),
          returned_items: itemsReturn.map((item) => ({
            item_id: item.item_id,
            item_name: item.item_name,
            quantity: item.item_quantity,
            total_amount: item.total_amount,
          })),
          refund_reason:
            salesDescriptionFromPayload ||
            paymentDescriptionFromPayload ||
            discountDescriptionFromPayload ||
            payload.reason ||
            '',
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in returnSalesOrder:', error);
      await releaseReturnLock();
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async exportSalesOrder(data = [], { SaleModel } = {}) {
    try {
      let ids = [];

      if (Array.isArray(data)) {
        ids = data;
      } else if (data && Array.isArray(data.data)) {
        ids = data.data;
      } else if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            ids = parsed;
          }
        } catch (e) {}
      }

      if (!ids.length) {
        return {
          status: false,
          data: null,
          message: 'No IDs provided',
        };
      }

      const objectIds = ids
        .map((id) => (id != null ? String(id).trim() : ''))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (!objectIds.length) {
        return {
          status: false,
          data: null,
          message: 'No valid IDs provided',
        };
      }

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const filter = {
        _id: { $in: objectIds },
      };

      if (BaseModel.license) {
        filter.license = BaseModel.license;
      }

      const cursor = salesCollection.find(filter, {
        sort: { _id: -1 },
        projection: {
          sales_id: 1,
          customer_name: 1,
          customer_address: 1,
          customer_phone: 1,
          customer_email: 1,
          payment_mode: 1,
          payment_description: 1,
          sales_description: 1,
          sales_sub_total: 1,
          sales_total: 1,
        },
      });

      const docs = await cursor.toArray();

      return {
        status: true,
        data: docs,
        message: 'Sale Data Exported',
      };
    } catch (error) {
      console.error('Error in exportSalesOrder:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async getSalesDataChanges(from, { SaleModel } = {}) {
    const collectionName = 'sales';
    const base = new BaseModel(collectionName);

    // Mirror legacy BaseModel::getAllDataChanges behaviour used in the
    // Sale model static getDataChanges, but keep the logic in the
    // repository layer instead of the Mongoose model.
    return base.getAllDataChanges(collectionName, 'sales', from, null);
  }

  async getReturnSalesDetails(salesId, { SaleModel } = {}) {
    try {
      if (!salesId || !mongoose.Types.ObjectId.isValid(salesId)) {
        return { status: false, data: null, message: 'Invalid sale id' };
      }

      const saleObjectId = new mongoose.Types.ObjectId(salesId);
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const filter = {
        _id: saleObjectId,
        ...activeTenantFilter(),
      };

      const saleDoc = await salesCollection.findOne(filter);

      if (!saleDoc) {
        return { status: false, data: null, message: 'Sale not found' };
      }

      const normalized = BaseModel.simplifyFields(saleDoc);

      return {
        status: true,
        data: normalized,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in getReturnSalesDetails:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getReturnPrintDetails(id, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

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
            sales_id: '$sales_id',
            customer_name: '$customer_name',
            customer_phone: '$customer_phone',
            customer_email: '$customer_email',
            customer_address: '$customer_address',
            customer_print: '$customer_print',
            print_sale_notes: '$print_sale_notes',
            sales_description: '$sales_description',
            gst: '$gst',
            return_tax: '$return_tax',
            return_discount: '$return_discount',
            items_return_subtotal: '$items_return_subtotal',
            items_return_total: '$items_return_total',
            payment_mode: '$payment_mode',
            return_id: '$items_return.returnArray.returnId',
            return_date: '$items_return.returnArray.returnDate',
            item_id: '$items_return.returnArray.returnValue.item_id',
            item_name: '$items_return.returnArray.returnValue.item_name',
            item_price: '$items_return.returnArray.returnValue.item_price',
            item_discount: '$items_return.returnArray.returnValue.item_discount',
            item_discount_percentage:
              '$items_return.returnArray.returnValue.item_discount_percentage',
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
            extraDiscount: '$items_return.returnArray.extraDiscount',
          },
        },
      ];

      const docs = await Model.aggregate(pipeline);

      if (!docs || !docs.length) {
        return {
          status: false,
          data: null,
          message: 'Sales Details Not Found',
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

      const custom_data = {
        sales_id: first.sales_id || '',
        return_id: first.return_id || '',
        date: formatDate(first.return_date || first.date, { timeZone: tz }),
        customer_name: first.customer_name || '',
        customer_phone: first.customer_phone || '',
        customer_email: first.customer_email || '',
        customer_address: first.customer_address || '',
        customer_print: typeof first.customer_print === 'boolean' ? first.customer_print : true,
        print_sale_notes: first.print_sale_notes === true,
        sales_description: first.sales_description || '',
        gst: first.gst || '',
        tax: round(numberOrZero(first.return_tax, 0), 2),
        discount: round(numberOrZero(first.return_discount, 0), 2),
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
          item_discount: numberOrZero(row.item_discount, 0),
          item_discount_percentage: numberOrZero(row.item_discount_percentage, 0),
          item_return_discount: numberOrZero(row.item_discount, 0),
          item_tax: numberOrZero(row.tax, 0),
          item_tax_name: row.tax_name || '',
          item_tax_type: row.tax_type || 'exclusive',
          item_tax_fields: taxFields,
          item_igst_tax: numberOrZero(row.igst_tax, 0),
          item_cgst_tax: numberOrZero(row.cgst_tax, 0),
          item_sgst_tax: numberOrZero(row.sgst_tax, 0),
          item_unit: row.item_unit && typeof row.item_unit === 'string' ? row.item_unit : 'qty',
          roundOff: numberOrZero(row.roundOff, 0),
          extraDiscount: numberOrZero(row.extraDiscount, 0),
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
  }

  async getSalesAjaxList(query, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.getSalesAjaxList(query);
  }

  async getSaleQtyDetail(id, { SaleModel } = {}) {
    try {
      const ObjectId = mongoose.Types.ObjectId;

      if (!id || !ObjectId.isValid(String(id))) {
        return {
          status: false,
          data: null,
          message: 'Invalid sale id',
        };
      }

      const saleObjectId = new ObjectId(String(id));
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');
      const itemsCollection = db.collection('items');

      const condition = {
        _id: saleObjectId,
      };

      if (BaseModel.currentBranch) {
        let branchId = BaseModel.currentBranch;
        if (!(branchId instanceof ObjectId) && ObjectId.isValid(String(branchId))) {
          branchId = new ObjectId(String(branchId));
        }
        condition.branch_id = branchId;
      }
      if (BaseModel.license) {
        condition.license = BaseModel.license;
      }

      const pipeline = [
        { $unwind: '$items' },
        { $match: condition },
        {
          $group: {
            _id: {
              item_id: '$items.item_id',
              sale_quantity: '$items.item_quantity',
              sale_available_quantity: '$items.item_available_quantity',
            },
          },
        },
      ];

      const cursor = salesCollection.aggregate(pipeline);
      const saleData = [];

      for await (const doc of cursor) {
        const groupId = doc && doc._id;
        if (!groupId) continue;

        saleData.push({
          item_id: groupId.item_id,
          sale_quantity: Number(groupId.sale_quantity || 0),
          sale_available_quantity: Number(groupId.sale_available_quantity || 0),
        });
      }

      let saleQuantity = 0;
      let itemQuantity = 0;

      // Mirror PHP behaviour: iterate over grouped items and keep the
      // last pair of saleQuantity / itemQuantity encountered.
      for (const item of saleData) {
        saleQuantity = Number(item.sale_quantity || 0);

        const rawItemId = item.item_id;
        if (!rawItemId || !ObjectId.isValid(String(rawItemId))) {
          continue;
        }

        const itemObjectId = new ObjectId(String(rawItemId));
        const itemFilter = {
          _id: itemObjectId,
        };
        if (BaseModel.license) {
          itemFilter.license = BaseModel.license;
        }

        const itemDoc = await itemsCollection.findOne(itemFilter);
        if (!itemDoc) {
          continue;
        }

        itemQuantity = Number(itemDoc.available_quantity || 0);
      }

      if (saleQuantity <= itemQuantity) {
        return {
          status: true,
          data: null,
          message: 'Available',
        };
      }

      return {
        status: false,
        data: null,
        message: 'Not available instock',
      };
    } catch (error) {
      console.error('Error in getSaleQtyDetailModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async gstOneReportPage(data, { SaleModel } = {}) {
    try {
      // Parse dates
      const fromDate = new Date(data.starting_date);
      const toDate = new Date(data.ending_date);

      // Get current branch and license from session/context
      // This should be passed from the controller
      const branchId = data.branch_id ? new ObjectId(data.branch_id) : null;
      const license = data.license ? new ObjectId(data.license) : null;
      const branchState = data.branch_state || '';

      if (!branchId || !license) {
        return {
          status: false,
          data: null,
          message: 'Branch ID and License are required',
        };
      }

      // Main filter for registered customers (regular/composite)
      const filters = {
        $and: [
          {
            branch_id: branchId,
            customer_gst_type: { $in: ['regular', 'composite'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            gst: 'enable',
            license,
          },
        ],
      };

      const salesCollection = mongoose.connection.collection('sales');

      // 1. Sales details (registered customers)
      const salesList = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: filters },
          {
            $group: {
              _id: {
                item_sales_id: '$sales_id',
                item_date: '$date',
                item_customer_state: '$customer_state',
                item_customer_gst_number: '$customer_gst_number',
                item_tax: '$items.tax',
                item_subtotal: '$items_subtotal',
                total_amount: '$items.total_amount',
                item_igst_tax: '$items.igst_tax',
                item_cgst_tax: '$items.cgst_tax',
                item_sgst_tax: '$items.sgst_tax',
                csgst_multiply: {
                  $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const salesValues = salesList.map((item) => {
        const multipleValue =
          item._id.item_igst_tax > 0 ? item._id.item_igst_tax : item._id.csgst_multiply;

        return {
          item_sales_id: item._id.item_sales_id || '',
          item_date: item._id.item_date
            ? new Date(item._id.item_date).toLocaleDateString('en-GB')
            : '',
          item_customer_state: item._id.item_customer_state || '',
          item_customer_gst_number: item._id.item_customer_gst_number || '',
          item_total: Math.round(item._id.total_amount * 100) / 100,
          item_tax: Math.round(item._id.item_tax * 100) / 100,
          item_subtotal: Math.round((item._id.total_amount - multipleValue) * 100) / 100,
          item_igst_tax: Math.round(item._id.item_igst_tax * 100) / 100,
          item_cgst_tax: Math.round(item._id.item_cgst_tax * 100) / 100,
          item_sgst_tax: Math.round(item._id.item_sgst_tax * 100) / 100,
        };
      });

      // 2. Return details
      const returnSalesList = await salesCollection
        .aggregate([
          { $unwind: '$items_return' },
          { $unwind: '$items_return.returnArray' },
          { $unwind: '$items_return.returnArray.returnValue' },
          { $match: filters },
          {
            $group: {
              _id: {
                return_sales_id: '$sales_id',
                return_sales_date: '$date',
                return_customer_state: '$customer_state',
                return_id: '$items_return.returnArray.returnValue.return_id',
                return_date: '$items_return.returnArray.returnValue.return_date',
                return_tax: '$items_return.returnArray.returnValue.tax',
                return_subtotal: '$items_return_subtotal',
                return_total: '$items_return.returnArray.returnValue.total_amount',
                return_igst_tax: '$items_return.returnArray.returnValue.igst_tax',
                return_cgst_tax: '$items_return.returnArray.returnValue.cgst_tax',
                return_sgst_tax: '$items_return.returnArray.returnValue.sgst_tax',
                return_csgst_multiply: {
                  $sum: {
                    $add: [
                      '$items_return.returnArray.returnValue.cgst_tax',
                      '$items_return.returnArray.returnValue.sgst_tax',
                    ],
                  },
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const returnSalesValues = returnSalesList.map((item) => {
        const returnMultipleValue =
          item._id.return_igst_tax > 0 ? item._id.return_igst_tax : item._id.return_csgst_multiply;

        return {
          return_id: item._id.return_id || '',
          return_date: item._id.return_date
            ? new Date(item._id.return_date).toLocaleDateString('en-GB')
            : '',
          return_sales_id: item._id.return_sales_id || '',
          return_sales_date: item._id.return_sales_date
            ? new Date(item._id.return_sales_date).toLocaleDateString('en-GB')
            : '',
          return_customer_state: item._id.return_customer_state || '',
          return_total: Math.round(item._id.return_total * 100) / 100,
          return_tax: Math.round(item._id.return_tax * 100) / 100,
          return_subtotal: Math.round((item._id.return_total - returnMultipleValue) * 100) / 100,
          return_igst_tax: Math.round(item._id.return_igst_tax * 100) / 100,
          return_cgst_tax: Math.round(item._id.return_cgst_tax * 100) / 100,
          return_sgst_tax: Math.round(item._id.return_sgst_tax * 100) / 100,
        };
      });

      // 3. Product details
      const productList = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: filters },
          {
            $group: {
              _id: {
                item_name: '$items.item_name',
                tax_name: '$items.tax_name',
                tax_fields: '$items.tax_fields',
              },
              total_amount: { $sum: '$items.total_amount' },
              subtotal_amount: { $sum: '$items.total_amount' },
              tax: { $sum: '$items.tax' },
              igst_tax: { $sum: '$items.igst_tax' },
              cgst_tax: { $sum: '$items.cgst_tax' },
              sgst_tax: { $sum: '$items.sgst_tax' },
              total_qty: { $sum: '$items.item_quantity' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const productValues = productList.map((item) => {
        const hsn =
          (!item._id.tax_fields || item._id.tax_fields.length === 0) && item.tax > 0
            ? item._id.tax_name
            : '';
        const productMultipleValue = item.igst_tax + item.csgst_multiply;

        return {
          product_name: item._id.item_name || '',
          product_hsn: hsn,
          product_qty: item.total_qty || 0,
          product_total: Math.round(item.total_amount * 100) / 100,
          product_subtotal: Math.round((item.subtotal_amount - productMultipleValue) * 100) / 100,
          product_tax: Math.round(item.tax * 100) / 100,
          product_igst: Math.round(item.igst_tax * 100) / 100,
          product_cgst: Math.round(item.cgst_tax * 100) / 100,
          product_sgst: Math.round(item.sgst_tax * 100) / 100,
        };
      });

      // 4. Interstate unregistered sales details (consumer)
      const interFilter = {
        $and: [
          {
            branch_id: branchId,
            customer_state: { $not: { $eq: branchState } },
            customer_gst_type: { $in: ['consumer'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            gst: 'enable',
            license,
          },
        ],
      };

      const salesInterList = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: interFilter },
          {
            $group: {
              _id: {
                item_sales_id: '$sales_id',
                item_date: '$date',
                item_customer_state: '$customer_state',
                item_customer_gst_number: '$customer_gst_number',
                item_tax: '$items.tax',
                item_subtotal: '$items_subtotal',
                item_total: '$items.total_amount',
                item_igst_tax: '$items.igst_tax',
                item_cgst_tax: '$items.cgst_tax',
                item_sgst_tax: '$items.sgst_tax',
                csgst_multiply: {
                  $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const salesUnregValues = salesInterList.map((item) => {
        const multipleValue =
          item._id.item_igst_tax > 0 ? item._id.item_igst_tax : item._id.csgst_multiply;

        return {
          customer_state: item._id.item_customer_state || '',
          item_total: Math.round(item._id.item_subtotal * 100) / 100,
          item_tax: Math.round(item._id.item_tax * 100) / 100,
          item_subtotal: Math.round((item._id.item_total - multipleValue) * 100) / 100,
          item_igst_tax: Math.round(item._id.item_igst_tax * 100) / 100,
          item_cgst_tax: Math.round(item._id.item_cgst_tax * 100) / 100,
          item_sgst_tax: Math.round(item._id.item_sgst_tax * 100) / 100,
        };
      });

      const arrTableData = {
        sales_data: salesValues,
        intersales_data: salesUnregValues,
        returns_data: returnSalesValues,
        product_data: productValues,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in gstOneReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async gstThreeReportPage(data, { SaleModel } = {}) {
    try {
      const { starting_date, ending_date, branch_id, license, branch_state } = data;
      const FromDate = new Date(starting_date);
      const ToDate = new Date(ending_date);

      const salesCollection = mongoose.connection.collection('sales');
      const receivingsCollection = mongoose.connection.collection('receivings');

      const filters = {
        $and: [
          { branch_id: new ObjectId(branch_id) },
          {
            date: { $gte: FromDate, $lte: ToDate },
            gst: 'enable',
            'items.tax': { $gt: 0 },
            license: new ObjectId(license),
          },
        ],
      };

      // Sale details with tax > 0
      const sales_list = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: filters },
          {
            $group: {
              _id: {
                sales_id: '$sales_id',
                subtotal_amount: '$items_subtotal',
                igst_tax: '$items.igst_tax',
                cgst_tax: '$items.cgst_tax',
                sgst_tax: '$items.sgst_tax',
              },
              tax: { $sum: '$items.tax' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      let sale_subamount = 0;
      let sale_igst = 0;
      let sale_cgst = 0;
      let sale_sgst = 0;
      for (const c of sales_list) {
        sale_subamount += Math.round(c._id.subtotal_amount * 100) / 100;
        sale_cgst += c._id.cgst_tax;
        sale_igst += c._id.igst_tax;
        sale_sgst += c._id.sgst_tax;
      }

      // Tax value zero sales
      const tax_filters = {
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

      const sales_tax_list = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: tax_filters },
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
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      let saletax_subamount = 0;
      let saletax_igst = 0;
      let saletax_cgst = 0;
      let saletax_sgst = 0;
      for (const c of sales_tax_list) {
        const sales_multiple_value = c._id.igst_tax + c.csgst_multiply;
        saletax_subamount += Math.round((c._id.sub_amount - sales_multiple_value) * 100) / 100;
        saletax_cgst += c._id.cgst_tax;
        saletax_igst += c._id.igst_tax;
        saletax_sgst += c._id.sgst_tax;
      }

      // Purchase details
      const purchase_filters = {
        $and: [
          {
            branch_id: new ObjectId(branch_id),
            supplier_gst_type: { $in: ['regular'] },
          },
          {
            date: { $gte: FromDate, $lte: ToDate },
            receiving_status: 'Received',
            gst: 'enable',
            license: new ObjectId(license),
          },
        ],
      };

      const purchase_list = await receivingsCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: purchase_filters },
          {
            $group: {
              _id: {
                igst_tax: '$items.igst_tax',
                cgst_tax: '$items.cgst_tax',
                sgst_tax: '$items.sgst_tax',
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      let purchase_igst = 0;
      let purchase_cgst = 0;
      let purchase_sgst = 0;
      for (const c of purchase_list) {
        purchase_igst += c._id.igst_tax;
        purchase_cgst += c._id.cgst_tax;
        purchase_sgst += c._id.sgst_tax;
      }

      // Unregister, Composite interstate sales details
      const inter_filter = {
        $and: [
          {
            branch_id: new ObjectId(branch_id),
            customer_state: { $not: { $eq: branch_state } },
            customer_gst_type: { $in: ['consumer', 'composite'] },
          },
          {
            date: { $gte: FromDate, $lte: ToDate },
            gst: 'enable',
            license: new ObjectId(license),
          },
        ],
      };

      const interstate_list = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: inter_filter },
          {
            $group: {
              _id: {
                item_customer_state: '$customer_state',
                customer_gst_type: '$customer_gst_type',
              },
              total_amount: { $sum: '$items_subtotal' },
              subtotal_amount: { $sum: '$items.total_amount' },
              tax: { $sum: '$items.tax' },
              igst_tax: { $sum: '$items.igst_tax' },
              cgst_tax: { $sum: '$items.cgst_tax' },
              sgst_tax: { $sum: '$items.sgst_tax' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      const intersales_values = [];
      for (const c of interstate_list) {
        const sales_multiple_value = c.igst_tax + c.csgst_multiply;
        intersales_values.push({
          taxable_total: Math.round((c.subtotal_amount - sales_multiple_value) * 100) / 100,
          customer_state: c._id.item_customer_state,
          customer_gsttype: c._id.customer_gst_type,
          sales_igst: c.igst_tax,
        });
      }

      // Unregister, Composite interstate purchase details
      const inter_purchase_filter = {
        $and: [
          {
            supplier_state: { $not: { $eq: branch_state } },
            supplier_gst_type: { $in: ['consumer', 'composite'] },
          },
          {
            date: { $gte: FromDate, $lte: ToDate },
            receiving_status: 'Received',
            gst: 'enable',
            license: new ObjectId(license),
          },
        ],
      };

      const interstate_purchase_list = await receivingsCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: inter_purchase_filter },
          {
            $group: {
              _id: { supplier_gst_type: '$supplier_gst_type' },
              subtotal_amount: { $sum: '$items.total_amount' },
              tax: { $sum: '$items.tax' },
              igst_tax: { $sum: '$items.igst_tax' },
              cgst_tax: { $sum: '$items.cgst_tax' },
              sgst_tax: { $sum: '$items.sgst_tax' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      let interpurchase_subamount = 0;
      for (const c of interstate_purchase_list) {
        const sales_multiple_value = c.igst_tax + c.csgst_multiply;
        interpurchase_subamount +=
          Math.round((c.subtotal_amount - sales_multiple_value) * 100) / 100;
      }

      // Unregister, Composite Intrastate purchase details
      const intra_filter = {
        $and: [
          {
            supplier_state: { $eq: branch_state },
            supplier_gst_type: { $in: ['consumer', 'composite'] },
          },
          {
            date: { $gte: FromDate, $lte: ToDate },
            receiving_status: 'Received',
            gst: 'enable',
            license: new ObjectId(license),
          },
        ],
      };

      const intrastate_list = await receivingsCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: intra_filter },
          {
            $group: {
              _id: { supplier_gst_type: '$supplier_gst_type' },
              subtotal_amount: { $sum: '$items.total_amount' },
              tax: { $sum: '$items.tax' },
              igst_tax: { $sum: '$items.igst_tax' },
              cgst_tax: { $sum: '$items.cgst_tax' },
              sgst_tax: { $sum: '$items.sgst_tax' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      let intrapurchase_subamount = 0;
      for (const c of intrastate_list) {
        const sales_multiple_value = c.igst_tax + c.csgst_multiply;
        intrapurchase_subamount +=
          Math.round((c.subtotal_amount - sales_multiple_value) * 100) / 100;
      }

      const arrTableData = {
        sub_amount: sale_subamount,
        igst: sale_igst,
        cgst: sale_cgst,
        sgst: sale_sgst,
        salestax_subamount: saletax_subamount,
        salestax_igst: saletax_igst,
        salestax_cgst: saletax_cgst,
        salestax_sgst: saletax_sgst,
        purchasetax_igst: purchase_igst,
        purchasetax_cgst: purchase_cgst,
        purchasetax_sgst: purchase_sgst,
        sales_interdata: intersales_values,
        purchase_interstatedata: interpurchase_subamount,
        intra_state_purchase: intrapurchase_subamount,
      };

      return {
        status: true,
        data: arrTableData,
        message: 'success',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async gstOneReportPageJson(data, { SaleModel } = {}) {
    try {
      // Parse dates
      const fromDate = new Date(data.starting_date);
      const toDate = new Date(data.ending_date);

      // Get current branch and license from session/context
      const branchId = data.branch_id ? new ObjectId(data.branch_id) : null;
      const license = data.license ? new ObjectId(data.license) : null;

      if (!branchId || !license) {
        return {
          status: false,
          data: null,
          message: 'Branch ID and License are required',
        };
      }

      // Filter for registered customers (regular/composite)
      const filters = {
        $and: [
          {
            branch_id: branchId,
            customer_gst_type: { $in: ['regular', 'composite'] },
          },
          {
            date: { $gte: fromDate, $lte: toDate },
            gst: 'enable',
            license,
          },
        ],
      };

      const salesCollection = mongoose.connection.collection('sales');

      // Sales details aggregation
      const salesList = await salesCollection
        .aggregate([
          { $unwind: '$items' },
          { $match: filters },
          {
            $group: {
              _id: {
                item_sales_id: '$sales_id',
                item_date: '$date',
                item_customer_gst_number: '$customer_gst_number',
                tax_amount: '$items.tax_amount',
                total_amount: '$items.total_amount',
                item_price: '$items.item_price',
              },
              total_amount: { $sum: '$items.total_amount' },
              tax_value: { $sum: '$items.tax' },
              item_igst_tax: { $sum: '$items.igst_tax' },
              csgst_multiply: {
                $sum: { $add: ['$items.cgst_tax', '$items.sgst_tax'] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();

      // Format data for GST-1 JSON format
      const gstOne = salesList.map((item) => {
        const multipleValue = item.item_igst_tax > 0 ? item.item_igst_tax : item.csgst_multiply;

        return {
          ctin: item._id.item_customer_gst_number || '',
          inv: [
            {
              inum: item._id.item_sales_id || '',
              idt: item._id.item_date
                ? new Date(item._id.item_date)
                    .toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })
                    .replace(/\//g, '-')
                : '',
              val: Math.round(item._id.total_amount * 100) / 100,
              pos: '27',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [
                {
                  num: 151,
                  itm_det: {
                    rt: item.tax_value || 0,
                    txval: Math.round((item._id.total_amount - multipleValue) * 100) / 100,
                    iamt: Math.round(item.item_igst_tax * 100) / 100,
                    csamt: Math.round(item.csgst_multiply * 100) / 100,
                  },
                },
              ],
            },
          ],
        };
      });

      return {
        status: true,
        data: gstOne,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in gstOneReportPageJson:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async sendDailySalesMail(input, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.sendDailySalesMail(input);
  }

  async salesPaymentCloseModel(data, { SaleModel } = {}) {
    try {
      if (!data.sales || data.sales.length === 0) {
        return {
          status: false,
          data: null,
          message: 'empty value',
        };
      }

      const db = await BaseModel.getDb();
      const saleCollection = db.collection('sales');
      const transactionCollection = db.collection('transaction');
      const customerCollection = db.collection('customers');

      // Get context from value
      const license = data.license;
      const branch_id = data.branch_id;
      const loggedUserName = data.loggedUserName;
      const loggedUserId = data.loggedUserId;

      // Process each sale
      for (const saleData of data.sales) {
        // Build query filter
        const saleQuery = {
          _id: new ObjectId(saleData.id),
          license,
        };

        // Only add branch_id if it's valid
        if (branch_id && ObjectId.isValid(branch_id)) {
          saleQuery.branch_id = new ObjectId(branch_id);
        }

        // Get sale details first
        const saleDetails = await saleCollection.findOne(saleQuery);
        if (!saleDetails) continue;

        // Build update filter (same as query filter)
        const updateFilter = {
          _id: new ObjectId(saleData.id),
          license,
        };

        if (branch_id && ObjectId.isValid(branch_id)) {
          updateFilter.branch_id = new ObjectId(branch_id);
        }

        // Update sale to mark as paid
        await saleCollection.updateMany(updateFilter, {
          $set: {
            partial_balance: parseFloat(saleData.amount) + parseFloat(saleData.paidamount || 0),
            payment_status: 'Paid',
            payment_pending: 0.0,
            updated_date: new Date(),
            updated_by: loggedUserName,
            updated_by_id: loggedUserId ? new ObjectId(loggedUserId) : undefined,
          },
        });

        // Build transaction filter
        const transactionFilter = {
          sale_id: new ObjectId(saleData.id),
          license,
        };

        if (branch_id && ObjectId.isValid(branch_id)) {
          transactionFilter.branch_id = new ObjectId(branch_id);
        }

        // Update transaction
        await transactionCollection.updateOne(transactionFilter, {
          $set: {
            description: 'Edit sale',
            amount: parseFloat(saleData.amount),
            type: 'out',
            pending: 0.0,
            updated_date: new Date(),
          },
        });

        // Update wallet amount
        await saleCollection.updateOne(updateFilter, {
          $set: {
            wallet_amount: (saleDetails.wallet_amount || 0) + parseFloat(saleData.amount),
          },
        });
      }

      // Recalculate customer balance
      const filters = {
        customer_id: new ObjectId(data.id),
        license,
      };

      if (branch_id && ObjectId.isValid(branch_id)) {
        filters.branch_id = new ObjectId(branch_id);
      }

      const aggregateResult = await transactionCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: null,
              totalInAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] },
              },
              totalOutAmount: {
                $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] },
              },
            },
          },
          {
            $addFields: {
              totalAmountDue: {
                $subtract: ['$totalInAmount', '$totalOutAmount'],
              },
            },
          },
        ])
        .toArray();

      const totalWalletAmount = aggregateResult.length > 0 ? aggregateResult[0].totalAmountDue : 0;

      // Build customer update filter
      const customerFilter = {
        _id: new ObjectId(data.id),
        license,
      };

      if (branch_id && ObjectId.isValid(branch_id)) {
        customerFilter.branch_id = new ObjectId(branch_id);
      }

      // Update customer balance
      await customerCollection.updateOne(customerFilter, {
        $set: {
          balance: totalWalletAmount,
        },
      });

      return {
        status: true,
        data: totalWalletAmount,
        message: 'Sales settled successfully',
      };
    } catch (error) {
      console.error('Error in salesPaymentCloseModel:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /*
   * qrCodeCloseModel was defined twice in this class. A later definition
   * replaces an earlier one, so this first version never ran - the live one
   * follows immediately below. Removed rather than merged.
   */

  async qrSalePayementUpdateModel(id, saleid, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.qrSalePayementUpdateModel(id, saleid);
  }

  async generateQrCodeModel(amount, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.generateQrCodeModel(amount);
  }

  async getQrStatusModel(id, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.getQrStatusModel(id);
  }

  async qrCodeCloseModel(id, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.qrCodeCloseModel(id);
  }

  async kioskOrderModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.kioskOrderModel(data);
  }

  async generateRazorPayQrCodekioskModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.generateRazorPayQrCodekioskModel(data);
  }

  async getRazorPayQrStatusModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.getRazorPayQrStatusModel(data);
  }

  async razorPayQrCodeCloseModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.razorPayQrCodeCloseModel(data);
  }

  async phonepeQrModel({ SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.phonepeQrModel();
  }

  async phonepeQrStatusModel({ SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.phonepeQrStatusModel();
  }

  async createRazorPayMobileModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.createRazorPayMobileModel(data);
  }

  async fetchRazorPayQrStatusMobileModel(data, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.fetchRazorPayQrStatusMobileModel(data);
  }

  async fetchLastSaleModel(branchId, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.fetchLastSaleModel(branchId);
  }

  async kitchenPrintModel(branchId, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.kitchenPrintModel(branchId);
  }

  async multiKitchenPrintModel(branchId) {
    try {
      const db = await BaseModel.getDb();
      const branchCollection = db.collection('branches');
      const salesCollection = db.collection('sales');

      // Accept ObjectId or kiosk.store_id
      let branchData = null;
      if (mongoose.Types.ObjectId.isValid(String(branchId))) {
        branchData = await branchCollection.findOne({
          _id: new mongoose.Types.ObjectId(String(branchId)),
        });
      }
      if (!branchData) {
        branchData = await branchCollection.findOne({ 'kiosk.store_id': branchId });
      }
      if (!branchData) {
        return {
          status: false,
          message: 'Branch not found for the given branch/store ID.',
          data: null,
        };
      }

      const branchObjectId = branchData._id;
      const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
      const todayEnd = new Date(new Date().setHours(0, 0, 0, 0) + 86400000);

      const kotSales = await salesCollection
        .find(
          {
            branch_id: branchObjectId,
            sale_process: { $regex: 'KOT', $options: 'i' },
            created_date: { $gte: todayStart, $lt: todayEnd },
          },
          { sort: { created_date: 1, _id: 1 }, limit: 50 }
        )
        .toArray();

      const cancelledSales = await salesCollection
        .find(
          {
            branch_id: branchObjectId,
            sale_process: { $regex: 'cancelled', $options: 'i' },
            created_date: { $gte: todayStart, $lt: todayEnd },
          },
          { sort: { created_date: 1 }, limit: 20 }
        )
        .toArray();

      const allSales = [...kotSales, ...cancelledSales];

      if (allSales.length === 0) {
        return {
          status: true,
          message: 'No unprinted KOT sales found for the specified branch.',
          data: [],
        };
      }

      const processedSales = [];

      for (const sale of allSales) {
        const changes = Array.isArray(sale.changes) ? sale.changes : [];
        const lastPrintedChangeIndex =
          sale.last_printed_change_index !== undefined && sale.last_printed_change_index !== null
            ? parseInt(sale.last_printed_change_index, 10)
            : -1;

        const printJobs = [];
        let hasNewChanges = false;
        let highestPrintedIndex = lastPrintedChangeIndex;

        for (let i = 0; i < changes.length; i++) {
          if (i <= lastPrintedChangeIndex) continue;

          hasNewChanges = true;
          const change = changes[i];
          const items = Array.isArray(change.items) ? change.items : [];
          const addItems = items.filter((it) => String(it.process || '').toLowerCase() === 'add');
          const cancelItems = items.filter(
            (it) => String(it.process || '').toLowerCase() === 'cancel'
          );

          if (addItems.length > 0) {
            printJobs.push({
              type: i === 0 ? 'new' : 'modified',
              timestamp: change.timestamp || null,
              items: addItems,
              change_index: i + 1,
            });
            highestPrintedIndex = i;
          }
          if (cancelItems.length > 0) {
            printJobs.push({
              type: 'cancel',
              timestamp: change.timestamp || null,
              items: cancelItems,
              change_index: i + 1,
            });
            highestPrintedIndex = i;
          }
        }

        if (hasNewChanges && printJobs.length > 0) {
          sale.print_jobs = printJobs;
          sale.new_last_printed_change_index = highestPrintedIndex;
          processedSales.push(sale);
        }
      }

      return { status: true, message: 'Get unprinted sales successfully', data: processedSales };
    } catch (error) {
      console.error('Error in multiKitchenPrintModel:', error);
      return {
        status: false,
        message: 'Error fetching unprinted sales: ' + error.message,
        data: [],
      };
    }
  }

  async markKitchenPrintedModel(saleIds, printedIndexes) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      if (!Array.isArray(saleIds) || saleIds.length === 0) {
        return { status: false, message: 'Invalid saleIds provided.', data: null };
      }

      const validIds = saleIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
      if (validIds.length === 0) {
        return { status: false, message: 'No valid sale IDs to mark as printed.', data: null };
      }

      const now = new Date();
      let modifiedCount = 0;

      for (const saleId of validIds) {
        const saleIdStr = String(saleId);
        const saleObjId = new mongoose.Types.ObjectId(saleIdStr);
        const indexes = printedIndexes || {};

        let lastChangeIndex;

        if (indexes[saleIdStr] !== undefined) {
          lastChangeIndex = parseInt(indexes[saleIdStr], 10);
        } else {
          const sale = await salesCollection.findOne({
            _id: saleObjId,
            ...activeTenantFilter(),
          });
          if (!sale) continue;
          const changes = Array.isArray(sale.changes) ? sale.changes : [];
          lastChangeIndex = changes.length > 0 ? changes.length - 1 : -1;
        }

        const result = await salesCollection.updateOne(
          { _id: saleObjId, ...activeTenantFilter() },
          {
            $set: {
              kitchen_printed: true,
              kitchen_printed_at: now,
              last_printed_change_index: lastChangeIndex,
            },
          }
        );
        if (result.modifiedCount > 0) modifiedCount++;
      }

      return {
        status: true,
        message: 'Sales marked as printed successfully.',
        data: { matched_count: validIds.length, modified_count: modifiedCount },
      };
    } catch (error) {
      console.error('Error in markKitchenPrintedModel:', error);
      return {
        status: false,
        message: 'Error marking sales as printed: ' + error.message,
        data: null,
      };
    }
  }

  async qrOrderModel(data, { SaleModel } = {}) {
    try {
      const db = await BaseModel.getDb();

      const {
        branch,
        items = [],
        customerMobile,
        transactionId,
        tokenId: clientTokenId,
        sale_method,
        order,
        note,
        kiosk_discount_amount,
        kiosk_discount_description,
        kiosk_table_no,
        kiosk_table_id,
        dine_type,
        person_count,
      } = data;

      if (!branch) {
        return { status: false, message: 'Branch is required', data: null };
      }

      const branchCollection = db.collection('branches');
      const branchSelector = ObjectId.isValid(String(branch))
        ? { $or: [{ _id: new ObjectId(String(branch)) }, { 'kiosk.store_id': branch }] }
        : { 'kiosk.store_id': branch };
      if (BaseModel.license) branchSelector.license = BaseModel.license;
      const branchDoc = await branchCollection.findOne(branchSelector);

      if (!branchDoc) {
        return { status: false, message: 'Branch not found', data: null };
      }
      const branchObjectId = branchDoc._id;

      // Generate token ID
      const tokenId = String(clientTokenId || String(Math.floor(Math.random() * 900) + 100));

      // Map items — use raw shape (no Mongoose ObjectId for item ref to avoid validation errors)
      const itemCollection = db.collection('items');
      const saleItems = [];
      for (const item of items) {
        const qty = Number(item.item_quantity) || 1;
        const itemId = String(item.item_id || '');
        if (!ObjectId.isValid(itemId)) {
          return { status: false, message: 'Enter must correct item id', data: null };
        }
        const itemDoc = await itemCollection.findOne({
          _id: new ObjectId(itemId),
          license: branchDoc.license || BaseModel.license,
          $or: [{ branch_id: branchObjectId }, { 'branch_access.branch_id': branchObjectId }],
        });
        if (!itemDoc) {
          return {
            status: false,
            data: null,
            message: 'This product has already been removed, so you can not modify anything.',
          };
        }

        const sellingPrice = Number(itemDoc.selling_price || 0);
        const taxRate = Number(itemDoc.tax || 0);
        const discountAmount = Number(itemDoc.discount_amount || 0);
        const discountPercentage = Number(itemDoc.discount_percentage || 0);
        const isInclusive = itemDoc.tax_type === 'inclusive';
        const baseUnitPrice =
          isInclusive && taxRate > 0 ? sellingPrice / (1 + taxRate / 100) : sellingPrice;
        const discountUnit =
          discountAmount > 0 ? discountAmount : baseUnitPrice * (discountPercentage / 100);
        const taxableUnit = baseUnitPrice - discountUnit;
        const taxUnit = taxableUnit * (taxRate / 100);
        const finalUnit = isInclusive ? taxableUnit * (1 + taxRate / 100) : taxableUnit + taxUnit;
        const taxAmt = round(taxUnit * qty);
        const itemTotal = round(finalUnit * qty);

        saleItems.push({
          item_id: itemId,
          item_name: itemDoc.name || item.item_name || '',
          name: itemDoc.name || item.item_name || '',
          quantity: qty,
          unit_price: round(baseUnitPrice),
          tax_amount: taxAmt,
          total: itemTotal,
          item_description: itemDoc.description || item.item_description || '',
          // receipt-facing fields
          item_base_price: round(baseUnitPrice),
          item_quantity: qty,
          item_tax: taxAmt,
          item_discount: round(discountUnit * qty),
          item_discount_percentage: discountPercentage,
          item_total: itemTotal,
        });
      }

      const subtotal = round(saleItems.reduce((s, i) => s + round(i.unit_price * i.quantity), 0));
      const totalTax = round(saleItems.reduce((s, i) => s + i.tax_amount, 0));
      const discountAmt = round(Number(kiosk_discount_amount) || 0);
      const itemDiscountTotal = round(
        saleItems.reduce((s, i) => s + Number(i.item_discount || 0), 0)
      );
      const finalTotal = round(saleItems.reduce((s, i) => s + i.total, 0) - discountAmt);
      const branchName = branchDoc.name || branchDoc.branch_name || '';

      const now = new Date();
      // Generate a human-readable sales_id for kiosk/QR orders using the
      // same branch-prefix + running-number logic as normal sales inserts.
      // If anything fails, fall back to SID+timestamp so the KOT log
      // still has a stable identifier.
      let salesId;
      try {
        salesId = await this.generateSalesIdForBranch(branchObjectId);
      } catch (e) {
        console.error(
          'Failed to generate sequential sales_id for qrOrder; using fallback SID timestamp:',
          e.message
        );
        salesId = `SID${now.getTime()}`;
      }

      // Seed initial changes array so multiKitchenPrintModel can detect
      // this brand-new KOT order and send it to the KOT printers.
      // This mirrors the structure used by updateOrder/cancel flows,
      // but marks every line as an "add" change.
      const changesItems = saleItems
        .map((si) => {
          const qty = Number(si.item_quantity || si.quantity || 0);
          const price = Number(si.unit_price || 0);
          const total = round(price * qty);
          return {
            item_id: String(si.item_id || ''),
            item_name: String(si.item_name || ''),
            item_quantity: qty,
            process: 'add',
            item_code: '',
            unit: 'qty',
            price,
            total,
          };
        })
        .filter((it) => it.item_id && it.item_quantity > 0);

      // Use raw MongoDB insert to bypass Mongoose schema validators
      const salesCollection = db.collection('sales');
      const insertResult = await salesCollection.insertOne({
        branch: branchObjectId,
        branch_id: branchObjectId,
        branch_name: branchName,
        license: branchDoc.license || BaseModel.license,
        sales_id: salesId,
        sale_process: 'KOT',
        payment_status: data.payment_status || 'Paid',
        payment_mode: data.payment_status || 'Cash',
        sale_method: sale_method || 'Table-Order',
        dine_type: dine_type || 'Dine-in',
        table_number: kiosk_table_no || '',
        table_id: kiosk_table_id || '',
        person_count: person_count || 0,
        items: saleItems,
        subtotal,
        total: finalTotal,
        sales_total: finalTotal,
        sales_sub_total: subtotal,
        tax: totalTax,
        discount: round(itemDiscountTotal + discountAmt),
        extra_discount: discountAmt,
        extra_discount_type: 'price',
        discount_description: kiosk_discount_description || '',
        customer_phone: customerMobile || '',
        notes: note || '',
        order: order || '',
        date: now,
        created_date: now,
        updated_date: now,
        transaction_id: transactionId || '',
        token_id: tokenId,
        // Initial change log entry for KOT printing
        changes: changesItems.length ? [{ timestamp: now, items: changesItems }] : [],
      });

      const insertedId = insertResult.insertedId.toString();

      return {
        status: true,
        message: 'Order placed successfully',
        data: {
          tokenId,
          sale_id: insertedId,
          sales_id: salesId,
          branch_name: branchName,
          items: saleItems,
          subtotal,
          discount: round(itemDiscountTotal + discountAmt),
          tax: totalTax,
          total: finalTotal,
          payment_status: data.payment_status || 'Paid',
        },
      };
    } catch (error) {
      console.error('Error in qrOrderModel:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async getNewSaleModel({ SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.getNewSaleModel();
  }

  async getOrderHistoryModel(branchId, limit, page, status, userId, { SaleModel } = {}) {
    try {
      const { ObjectId } = require('mongodb');
      const Model = this.getModel(SaleModel);

      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;

      const query = { branch_id: branchObjectId };

      if (status === 'completed') {
        query.payment_status = { $in: ['Completed', 'completed', 'Paid', 'paid'] };
      } else if (status === 'cancelled') {
        query.sale_process = { $in: ['Cancel', 'cancel', 'Cancelled', 'cancelled'] };
      } else if (status === 'pending') {
        query.payment_status = { $nin: ['Completed', 'completed', 'Paid', 'paid'] };
        query.sale_process = { $nin: ['Cancel', 'cancel', 'Cancelled', 'cancelled'] };
      }

      const safeLimit = parseInt(limit, 10) || 50;
      const safePage = parseInt(page, 10) || 1;
      const skip = (safePage - 1) * safeLimit;

      const docs = await Model.find(query)
        .sort({ created_date: -1, date: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean();

      const orders = docs.map((doc) => {
        let derivedStatus = 'pending';
        const ps = (doc.payment_status || '').toLowerCase();
        const sp = (doc.sale_process || '').toLowerCase();
        if (sp === 'cancel' || sp === 'cancelled') {
          derivedStatus = 'cancelled';
        } else if (ps === 'completed' || ps === 'paid') {
          derivedStatus = 'completed';
        }

        const items = (Array.isArray(doc.items) ? doc.items : []).map((item) => ({
          id: item.item_id || '',
          item_id: item.item_id || '',
          name: item.item_name || item.name || '',
          item_name: item.item_name || item.name || '',
          quantity: item.item_quantity || item.quantity || 1,
          item_quantity: item.item_quantity || item.quantity || 1,
          price: item.item_price || item.unit_price || 0,
          unit_price: item.item_price || item.unit_price || 0,
          tax_price: item.tax_amount || item.tax || 0,
          discount_price: item.item_discount || item.discount || 0,
          item_description: item.item_description || '',
        }));

        return {
          _id: String(doc._id),
          order_id: doc.token_id || doc.sales_id || String(doc._id).slice(-6),
          table_number: doc.table_number || '',
          table_id: doc.table_id || '',
          dine_type: doc.dine_type || 'Dine-in',
          status: derivedStatus,
          created_at: doc.created_date || doc.date,
          total_amount: doc.sales_total || doc.total || 0,
          subtotal: doc.sales_sub_total || doc.subtotal || 0,
          tax: doc.tax || 0,
          discount: doc.discount || 0,
          extra_discount: doc.extra_discount || 0,
          extra_discount_type: doc.extra_discount_type || 'price',
          customer_name: doc.customer_name || '',
          person_count: doc.person_count || '',
          kiosk_table_no: doc.table_number || '',
          kiosk_table_id: doc.table_id || '',
          items,
        };
      });

      return { status: true, message: 'Order history fetched', data: { orders } };
    } catch (error) {
      console.error('Error in getOrderHistoryModel:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async updateOrderModel(
    orderId,
    items,
    totalAmount,
    status,
    extraDiscountType,
    extraDiscount,
    discountDescription,
    newTableNo,
    dineType,
    personCount,
    { SaleModel } = {}
  ) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');
      const itemCollection = db.collection('items');

      const orderObjectId = new mongoose.Types.ObjectId(orderId);
      const orderDoc = await salesCollection.findOne({
        _id: orderObjectId,
        ...activeTenantFilter(),
      });

      if (!orderDoc) {
        return { status: false, message: 'Order not found', data: [] };
      }

      // Get license from order document for proper multi-tenant filtering

      // ---------- CANCEL FLOW ----------
      if (status && status === 'cancelled') {
        const mongoDate = new Date();
        const updateFields = {
          sale_process: 'cancelled',
          payment_status: 'Cancelled',
          payment_pending: 0.0,
          updated_date: mongoDate,
          updated_by: 'System',
          updated_by_id: null,
        };

        const existingItems = Array.isArray(orderDoc.items) ? orderDoc.items : [];
        const existingChanges = Array.isArray(orderDoc.changes) ? orderDoc.changes : [];
        const changesItems = [];

        for (const ex of existingItems) {
          const idStr = ex.item_id ? String(ex.item_id) : '';
          if (!idStr) continue;
          const qty = parseFloat(ex.item_quantity || 0);
          if (qty <= 0) continue;
          const price = parseFloat(ex.item_price || 0);
          changesItems.push({
            item_id: idStr,
            item_name: String(ex.item_name || ''),
            item_quantity: qty,
            process: 'cancel',
            item_code: String(ex.item_sku || ''),
            unit: String(ex.item_unit || 'qty'),
            price,
            total: price * qty,
          });
        }

        if (changesItems.length > 0) {
          existingChanges.push({ timestamp: mongoDate, items: changesItems });
          updateFields.changes = existingChanges;
        }

        const updateResult = await salesCollection.updateOne(
          { _id: orderObjectId },
          { $set: updateFields }
        );

        return updateResult.modifiedCount > 0
          ? {
              status: true,
              message: 'Order cancelled successfully',
              data: { order_id: orderId },
            }
          : {
              status: false,
              message: 'No changes made to the order',
              data: [],
            };
      }

      // ---------- EDIT FLOW ----------
      const existingItems = Array.isArray(orderDoc.items) ? orderDoc.items : [];
      const oldItemsData = {};

      for (const ex of existingItems) {
        const idStr = ex.item_id ? String(ex.item_id) : '';
        if (!idStr) continue;
        oldItemsData[idStr] = {
          quantity: parseFloat(ex.item_quantity || 0),
          name: String(ex.item_name || ''),
          item_code: String(ex.item_sku || ''),
          price: parseFloat(ex.item_price || 0),
          unit: String(ex.item_unit || 'qty'),
        };
      }

      const changesItems = [];
      const existingChanges = Array.isArray(orderDoc.changes) ? orderDoc.changes : [];
      const existingIndex = {};
      existingItems.forEach((ex, idx) => {
        const key = ex.item_id ? String(ex.item_id) : '';
        if (key) existingIndex[key] = idx;
      });

      const incomingProductIds = [];
      const updatedItems = [...existingItems];

      for (const item of items) {
        // Accept item_id as fallback when product_id is absent (KOT / kiosk items)
        const rawId = item.product_id || item.item_id || '';
        if (!rawId) continue;
        const productId = String(rawId);
        const qty = parseFloat(item.quantity || item.item_quantity || 0);
        const price = parseFloat(item.price || item.unit_price || item.item_base_price || 0);
        if (!productId || qty <= 0 || price < 0) continue;

        const oldQty = oldItemsData[productId] ? parseFloat(oldItemsData[productId].quantity) : 0;
        if (oldItemsData[productId]) delete oldItemsData[productId];

        let itemDoc = null;
        if (mongoose.Types.ObjectId.isValid(productId)) {
          itemDoc = await itemCollection.findOne({
            _id: new mongoose.Types.ObjectId(productId),
          });
        }
        if (!itemDoc) {
          // Item not in catalog (e.g. KOT order item) — update in-place using existing data
          if (existingIndex[productId] !== undefined) {
            const i = existingIndex[productId];
            updatedItems[i] = {
              ...updatedItems[i],
              item_quantity: qty,
              ...(item.item_description != null
                ? { item_description: String(item.item_description) }
                : {}),
            };
            incomingProductIds.push(productId);
          }
          continue;
        }

        let changeQty = 0;
        let changeProcess = '';
        if (qty > oldQty) {
          changeProcess = 'add';
          changeQty = qty - oldQty;
        } else if (qty < oldQty) {
          changeProcess = 'cancel';
          changeQty = oldQty - qty;
        }

        if (changeQty > 0) {
          changesItems.push({
            item_id: productId,
            item_name: String(itemDoc.name || item.name || ''),
            item_quantity: changeQty,
            process: changeProcess,
            item_code: String(itemDoc.itemid || ''),
            unit: String(itemDoc.item_unit || itemDoc.unit || 'qty'),
            price,
            total: price * changeQty,
          });
        }

        incomingProductIds.push(productId);
        const itemTaxRate = parseFloat(itemDoc.tax || 0);
        const taxType = itemDoc.tax_type || 'exclusive';

        if (existingIndex[productId] !== undefined) {
          const i = existingIndex[productId];
          const existing = updatedItems[i];
          const itemAmount = qty * price;
          const itemDiscountPer = parseFloat(existing.item_discount_percentage || 0);
          const itemDiscountVal = parseFloat(existing.sale_inline_discount_value || 0);
          const lineDiscount = (itemAmount * itemDiscountPer) / 100 + itemDiscountVal * qty;
          const taxableAmount = itemAmount - lineDiscount;
          let taxAmount = 0;
          let lineTotal = taxableAmount;

          if (itemTaxRate > 0 && taxType === 'exclusive') {
            taxAmount = (taxableAmount * itemTaxRate) / 100;
            lineTotal = taxableAmount + taxAmount;
          } else if (itemTaxRate > 0 && taxType === 'inclusive') {
            lineTotal = taxableAmount;
            taxAmount = (lineTotal * itemTaxRate) / (100 + itemTaxRate);
          }

          updatedItems[i] = {
            ...existing,
            item_quantity: qty,
            item_price: price,
            item_discount: lineDiscount,
            total_amount: lineTotal,
            tax: itemTaxRate,
            tax_type: taxType,
            tax_amount: taxAmount,
            cgst_tax: taxAmount / 2,
            sgst_tax: taxAmount / 2,
          };
          if (item.item_description)
            updatedItems[i].item_description = String(item.item_description);
        } else {
          const itemQuantity = qty;
          const sellingPrice = price;
          const discountAmt = parseFloat(itemDoc.discount_amount || 0);
          const discountPer = parseFloat(itemDoc.discount_percentage || 0);
          const itemAmount = sellingPrice * itemQuantity;
          const companyPriceTotal = (itemDoc.company_price || 0) * itemQuantity;
          const lineDiscount = (itemAmount * discountPer) / 100 + discountAmt * itemQuantity;
          const taxableAmount = itemAmount - lineDiscount;
          let taxAmount = 0;
          let lineTotal = taxableAmount;

          if (itemTaxRate > 0 && taxType === 'exclusive') {
            taxAmount = (taxableAmount * itemTaxRate) / 100;
            lineTotal = taxableAmount + taxAmount;
          } else if (itemTaxRate > 0 && taxType === 'inclusive') {
            lineTotal = taxableAmount;
            taxAmount = (lineTotal * itemTaxRate) / (100 + itemTaxRate);
          }

          updatedItems.push({
            sale_inline_item_price: sellingPrice,
            sale_inline_discount_value: discountAmt,
            sale_inline_discount_pervalue: discountPer,
            item_discount: lineDiscount,
            item_discount_percentage: discountPer,
            item_status: 'Add',
            return: false,
            item_name: itemDoc.name || item.name || '',
            item_sku: itemDoc.itemid || '',
            item_price: sellingPrice,
            item_quantity: itemQuantity,
            item_available_quantity: parseFloat(itemDoc.available_quantity || 0),
            item_id: productId,
            item_unit: itemDoc.unit || 'qty',
            total_amount: lineTotal,
            barcode_id: itemDoc.barcode_id || '',
            company_price_total: companyPriceTotal,
            category_id: itemDoc.category_id || null,
            category_name: itemDoc.category_name || '',
            supplier_id: itemDoc.supplier_id || null,
            supplier_name: itemDoc.supplier_name || '',
            tax: itemTaxRate,
            tax_type: taxType,
            igst_tax: 0,
            cgst_tax: taxAmount / 2,
            sgst_tax: taxAmount / 2,
            tax_name: itemDoc.tax_name || '',
            tax_amount: taxAmount,
            tax_fields: itemDoc.tax_fields || [],
            item_description: String(item.item_description || itemDoc.description || ''),
            track_inventory: itemDoc.track_inventory || false,
            negative_stock: itemDoc.negative_stock || false,
          });
        }
      }

      for (const [remItemId, remItemData] of Object.entries(oldItemsData)) {
        const remQty = parseFloat(remItemData.quantity || 0);
        if (remQty <= 0) continue;
        const remPrice = parseFloat(remItemData.price || 0);
        changesItems.push({
          item_id: String(remItemId),
          item_name: String(remItemData.name || ''),
          item_quantity: remQty,
          process: 'cancel',
          item_code: String(remItemData.item_code || ''),
          unit: String(remItemData.unit || 'qty'),
          price: remPrice,
          total: remPrice * remQty,
        });
      }

      const finalItems = updatedItems.filter((ex) => {
        if (!ex.item_id) return false;
        return incomingProductIds.includes(String(ex.item_id));
      });

      let itemsSub = 0;
      let taxTotal = 0;
      let itemDiscountTotal = 0;
      let grossSubtotal = 0;
      for (const it of finalItems) {
        itemsSub += parseFloat(it.total_amount || 0);
        taxTotal += parseFloat(it.tax_amount || 0);
        itemDiscountTotal += parseFloat(it.item_discount || 0);
        grossSubtotal += parseFloat(it.item_quantity || 0) * parseFloat(it.item_price || 0);
      }

      const baseSubtotal = grossSubtotal;
      const discountType = extraDiscountType || null;
      const discountVal = parseFloat(extraDiscount || 0);
      let extraDiscountAmount = 0;

      if (discountType === 'percent' && discountVal > 0) {
        extraDiscountAmount = ((baseSubtotal - itemDiscountTotal) * discountVal) / 100;
      } else if (discountType === 'amount' && discountVal > 0) {
        extraDiscountAmount = discountVal;
      }
      if (extraDiscountAmount > itemsSub) extraDiscountAmount = itemsSub;

      const salesTotal = itemsSub - extraDiscountAmount;
      const mongoDate = new Date();
      if (changesItems.length > 0) {
        existingChanges.push({ timestamp: mongoDate, items: changesItems });
      }

      const updateFields = {
        items: finalItems,
        changes: existingChanges,
        sales_sub_total: baseSubtotal,
        items_subtotal: baseSubtotal,
        sales_total: Math.round(salesTotal * 100) / 100,
        items_total: salesTotal,
        tax: taxTotal,
        discount: itemDiscountTotal,
        return_tax: 0,
        return_discount: 0,
        number_of_items: finalItems.length,
        updated_date: mongoDate,
        updated_by: 'System',
        sale_process: 'KOT',
      };

      if (extraDiscountType !== null) updateFields.extra_discount_type = String(extraDiscountType);
      if (extraDiscount !== null) {
        updateFields.extra_discount = parseFloat(extraDiscount);
        updateFields.sale_extra_discount = extraDiscountAmount;
      }
      if (discountDescription !== null)
        updateFields.discount_description = String(discountDescription);
      if (newTableNo !== null && newTableNo !== '') updateFields.table_number = String(newTableNo);
      if (dineType !== null && dineType !== '') updateFields.dine_type = String(dineType);
      if (personCount !== null && personCount !== '')
        updateFields.person_count = parseInt(personCount, 10);

      const updateResult = await salesCollection.updateOne(
        { _id: orderObjectId },
        { $set: updateFields }
      );

      return updateResult.modifiedCount > 0
        ? {
            status: true,
            message: 'Order updated successfully',
            data: {
              order_id: orderId,
              items_updated: finalItems.length,
              total_amount: totalAmount,
            },
          }
        : {
            status: false,
            message: 'No changes made to the order',
            data: [],
          };
    } catch (error) {
      console.error('Error in updateOrderModel:', error);
      return {
        status: false,
        message: error.message || 'Failed to update order',
        data: [],
      };
    }
  }

  async getFrequentItemsForBranch(branchId, limit, { SaleModel } = {}) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const branchObjectId = mongoose.Types.ObjectId.isValid(String(branchId))
        ? new mongoose.Types.ObjectId(String(branchId))
        : branchId;

      const pipeline = [
        {
          $match: {
            branch_id: branchObjectId,
            sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
            license: BaseModel.license,
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.item_id',
            name: { $first: '$items.item_name' },
            count: { $sum: 1 },
            price: { $first: '$items.item_price' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: Number(limit) || 10 },
        {
          $project: {
            _id: 0,
            item_id: '$_id',
            name: 1,
            count: 1,
            price: 1,
          },
        },
      ];

      const items = await salesCollection.aggregate(pipeline).toArray();
      return { status: true, message: 'Frequent items fetched', data: items };
    } catch (error) {
      console.error('Error in getFrequentItemsForBranch:', error);
      return { status: false, message: error.message, data: [] };
    }
  }

  async getKotDiscountReports(data, options, { SaleModel } = {}) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const FromDate = BaseModel.startingDate(data.starting_date, BaseModel.currentTimeZone);
      const ToDate = BaseModel.endingDate(data.ending_date, BaseModel.currentTimeZone);

      const branchObjectIds = (data.branchid || []).map(
        (id) => new mongoose.Types.ObjectId(String(id))
      );

      const discountFilter = {
        $or: [
          { sale_extra_discount: { $gt: 0 } },
          { 'items.item_discount': { $gt: 0 } },
          { 'items.item_discount_percentage': { $gt: 0 } },
        ],
      };

      const filters = {
        $and: [
          { branch_id: { $in: branchObjectIds } },
          { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
          { was_kot_proceeded: true },
          { updated_date: { $gte: FromDate, $lte: ToDate } },
          { license: BaseModel.license },
          discountFilter,
        ],
      };

      const limit = options.limit || 5;
      const page = options.page || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const pipeline = [
        { $match: filters },
        { $unwind: '$items' },
        {
          $addFields: {
            price_num: {
              $let: {
                vars: {
                  taxPct: { $ifNull: ['$items.tax', 0] },
                  line: {
                    $multiply: [
                      { $toDouble: { $ifNull: ['$items.item_price', 0] } },
                      { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                    ],
                  },
                },
                in: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $add: [1, { $divide: ['$$taxPct', 100] }],
                        },
                        0,
                      ],
                    },
                    {
                      $divide: ['$$line', { $add: [1, { $divide: ['$$taxPct', 100] }] }],
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: {
              id: '$_id',
              sales_id: '$sales_id',
              date: '$date',
              updated_date: '$updated_date',
              table_number: '$table_number',
            },
            item_discount_total: {
              $sum: {
                $cond: [
                  { if: { $gt: ['$items.item_discount', 0] } },
                  {
                    then: {
                      $multiply: [
                        { $toDouble: { $ifNull: ['$items.item_discount', 0] } },
                        { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                      ],
                    },
                  },
                  {
                    else: {
                      $cond: [
                        {
                          if: {
                            $and: [
                              {
                                $gt: ['$items.item_discount_percentage', 0],
                              },
                              { $eq: ['$items.tax_type', 'exclusive'] },
                            ],
                          },
                        },
                        {
                          then: {
                            $divide: [
                              {
                                $multiply: [
                                  {
                                    $toDouble: {
                                      $ifNull: ['$items.total_amount', 0],
                                    },
                                  },
                                  {
                                    $toDouble: {
                                      $ifNull: ['$items.item_discount_percentage', 0],
                                    },
                                  },
                                ],
                              },
                              100,
                            ],
                          },
                        },
                        {
                          else: {
                            $cond: [
                              {
                                if: {
                                  $and: [
                                    {
                                      $gt: ['$items.item_discount_percentage', 0],
                                    },
                                    { $eq: ['$items.tax_type', 'inclusive'] },
                                  ],
                                },
                              },
                              {
                                then: {
                                  $divide: [
                                    {
                                      $multiply: [
                                        '$price_num',
                                        {
                                          $toDouble: {
                                            $ifNull: ['$items.item_discount_percentage', 0],
                                          },
                                        },
                                      ],
                                    },
                                    100,
                                  ],
                                },
                              },
                              { else: 0 },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            extra_discount_total: {
              $first: { $toDouble: { $ifNull: ['$sale_extra_discount', 0] } },
            },
            net_amount: {
              $first: { $toDouble: { $ifNull: ['$sales_total', 0] } },
            },
            extra_discount_type: {
              $first: { $ifNull: ['$extra_discount_type', ''] },
            },
            extra_discount: {
              $first: { $toDouble: { $ifNull: ['$extra_discount', 0] } },
            },
            has_item_percent: {
              $max: {
                $cond: [
                  { if: { $gt: ['$items.item_discount_percentage', 0] } },
                  { then: 1 },
                  { else: 0 },
                ],
              },
            },
          },
        },
        { $sort: { '_id.updated_date': -1, '_id.sales_id': -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const results = await salesCollection
        .aggregate(pipeline, {
          allowDiskUse: true,
        })
        .toArray();

      const salesValues = [];
      let totalAmount = 0;
      let totalDiscountPrice = 0;
      let totalNetAmount = 0;

      for (const c of results) {
        const updatedDate = c._id?.updated_date || c._id?.date || null;
        const itemDisc = c.item_discount_total || 0;
        const extraDisc = c.extra_discount_total || 0;
        const netAmount = c.net_amount || 0;
        const tableNumber = String(c._id?.table_number || '').trim();
        const extraDiscountType = c.extra_discount_type || '';
        const extraDiscountRaw = c.extra_discount || 0;
        const hasItemPercent = c.has_item_percent || 0;

        let formattedTable = 'TA';
        if (tableNumber !== '') {
          const lowerTable = tableNumber.toLowerCase();
          if (lowerTable === 'take away' || lowerTable === 'takeaway') {
            formattedTable = 'TA';
          } else {
            formattedTable = tableNumber;
          }
        }

        const totalDiscount = itemDisc + extraDisc;
        const totalAmountValue = netAmount + totalDiscount;

        salesValues.push({
          id: c._id.id,
          sales_id: c._id.sales_id,
          table_number: formattedTable,
          string_date: updatedDate ? formatDate(updatedDate) : null,
          total_amount: Math.round(totalAmountValue * 100) / 100,
          item_discount_total: Math.round(itemDisc * 100) / 100,
          extra_discount_total: Math.round(extraDisc * 100) / 100,
          total_discount: Math.round(totalDiscount * 100) / 100,
          net_amount: Math.round(netAmount * 100) / 100,
          extra_discount_type: extraDiscountType,
          extra_discount_value: Math.round(extraDiscountRaw * 100) / 100,
          has_item_percent: hasItemPercent,
        });

        totalAmount += totalAmountValue;
        totalDiscountPrice += totalDiscount;
        totalNetAmount += netAmount;
      }

      const countPipeline = [{ $match: filters }, { $group: { _id: { id: '$_id' } } }];
      const countResults = await salesCollection.aggregate(countPipeline).toArray();
      const total = countResults.length;

      return {
        status: true,
        total,
        current_page: page,
        total_pages: Math.ceil(total / limit),
        per_page: limit,
        list: salesValues,
        totals: {
          total_amount: Math.round(totalAmount * 100) / 100,
          total_discount_price: Math.round(totalDiscountPrice * 100) / 100,
          total_net_amount: Math.round(totalNetAmount * 100) / 100,
          total_count: salesValues.length,
        },
        message: 'Get successfully',
      };
    } catch (error) {
      console.error('Error in getKotDiscountReports:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to fetch KOT discount reports',
      };
    }
  }

  async kotTablewiseDetailsPage(data, { SaleModel } = {}) {
    try {
      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const FromDate = BaseModel.startingDate(data.starting_date, BaseModel.currentTimeZone);
      const ToDate = BaseModel.endingDate(data.ending_date, BaseModel.currentTimeZone);

      const branchId = new mongoose.Types.ObjectId(String(data.branchid));

      const filters = {
        $and: [
          { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
          { date: { $gte: FromDate, $lte: ToDate } },
          { branch_id: branchId },
          { license: BaseModel.license },
          { was_kot_proceeded: true },
        ],
      };

      let tablesParam = data.tables || [];
      if (!Array.isArray(tablesParam)) {
        tablesParam = [tablesParam];
      }
      const tableNumbers = [];
      for (const t of tablesParam) {
        if (t !== null && t !== undefined) {
          const tStr = String(t).trim();
          if (tStr !== '') {
            tableNumbers.push(tStr);
          }
        }
      }
      if (tableNumbers.length > 0) {
        filters.$and.push({ table_number: { $in: tableNumbers } });
      }

      /*
       * $nin, not two $ne keys.
       *
       * This was `{ $exists: true, $ne: null, $ne: "" }`. The two $ne are the
       * same key in one object literal, so the second silently replaced the
       * first and only the empty string was excluded - every row with a null
       * table_number passed a filter written to exclude exactly those.
       */
      filters.$and.push({
        table_number: { $exists: true, $nin: [null, ''] },
      });

      const pipeline = [
        { $match: filters },
        { $unwind: '$items' },
        {
          $addFields: {
            price_num: {
              $let: {
                vars: {
                  taxPct: { $ifNull: ['$items.tax', 0] },
                  line: {
                    $multiply: [
                      { $toDouble: { $ifNull: ['$items.item_price', 0] } },
                      { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                    ],
                  },
                },
                in: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $add: [1, { $divide: ['$$taxPct', 100] }],
                        },
                        0,
                      ],
                    },
                    {
                      $divide: ['$$line', { $add: [1, { $divide: ['$$taxPct', 100] }] }],
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: {
              id: '$_id',
              sales_id: '$sales_id',
              date: '$date',
              updated_date: '$updated_date',
              table_number: '$table_number',
              dine_type: '$dine_type',
              person_count: '$person_count',
              item_id: '$items.item_id',
              item_name: '$items.item_name',
              item_price: '$items.item_price',
            },
            qty: {
              $sum: { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
            },
            line_total: {
              $sum: { $toDouble: { $ifNull: ['$items.total_amount', 0] } },
            },
            base_total: {
              $sum: {
                $multiply: [
                  { $toDouble: { $ifNull: ['$items.item_price', 0] } },
                  { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                ],
              },
            },
            pre_tax_total: {
              $sum: '$price_num',
            },
            tax_total: {
              $sum: {
                $let: {
                  vars: {
                    priceTotal: {
                      $multiply: [
                        { $toDouble: { $ifNull: ['$items.item_price', 0] } },
                        { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                      ],
                    },
                    itemDiscount: {
                      $cond: {
                        if: { $gt: ['$items.item_discount', 0] },
                        then: {
                          $multiply: [
                            {
                              $toDouble: {
                                $ifNull: ['$items.item_discount', 0],
                              },
                            },
                            {
                              $toDouble: {
                                $ifNull: ['$items.item_quantity', 0],
                              },
                            },
                          ],
                        },
                        else: 0,
                      },
                    },
                    taxRate: { $toDouble: { $ifNull: ['$items.tax', 0] } },
                  },
                  in: {
                    $cond: {
                      if: { $eq: ['$items.tax_type', 'inclusive'] },
                      then: {
                        $divide: [
                          {
                            $multiply: [
                              {
                                $subtract: ['$$priceTotal', '$$itemDiscount'],
                              },
                              '$$taxRate',
                            ],
                          },
                          { $add: [100, '$$taxRate'] },
                        ],
                      },
                      else: {
                        $divide: [
                          {
                            $multiply: [
                              {
                                $subtract: ['$$priceTotal', '$$itemDiscount'],
                              },
                              '$$taxRate',
                            ],
                          },
                          100,
                        ],
                      },
                    },
                  },
                },
              },
            },
            item_discount_total: {
              $sum: {
                $cond: {
                  if: { $gt: ['$items.item_discount', 0] },
                  then: {
                    $multiply: [
                      { $toDouble: { $ifNull: ['$items.item_discount', 0] } },
                      { $toDouble: { $ifNull: ['$items.item_quantity', 0] } },
                    ],
                  },
                  else: {
                    $cond: {
                      if: {
                        $and: [
                          { $gt: ['$items.item_discount_percentage', 0] },
                          { $eq: ['$items.tax_type', 'exclusive'] },
                        ],
                      },
                      then: {
                        $divide: [
                          {
                            $multiply: [
                              {
                                $toDouble: {
                                  $ifNull: ['$items.total_amount', 0],
                                },
                              },
                              {
                                $toDouble: {
                                  $ifNull: ['$items.item_discount_percentage', 0],
                                },
                              },
                            ],
                          },
                          100,
                        ],
                      },
                      else: {
                        $cond: {
                          if: {
                            $and: [
                              {
                                $gt: ['$items.item_discount_percentage', 0],
                              },
                              { $eq: ['$items.tax_type', 'inclusive'] },
                            ],
                          },
                          then: {
                            $divide: [
                              {
                                $multiply: [
                                  '$price_num',
                                  {
                                    $toDouble: {
                                      $ifNull: ['$items.item_discount_percentage', 0],
                                    },
                                  },
                                ],
                              },
                              100,
                            ],
                          },
                          else: 0,
                        },
                      },
                    },
                  },
                },
              },
            },
            extra_discount_total: {
              $first: { $toDouble: { $ifNull: ['$sale_extra_discount', 0] } },
            },
            sales_total: {
              $first: { $toDouble: { $ifNull: ['$sales_total', 0] } },
            },
            payment_mode: {
              $first: { $ifNull: ['$payment_mode', ''] },
            },
            multi_payment: {
              $first: { $ifNull: ['$multi_payment', null] },
            },
          },
        },
        {
          $sort: {
            '_id.table_number': 1,
            '_id.updated_date': 1,
            '_id.sales_id': 1,
            '_id.item_name': 1,
          },
        },
      ];

      const results = await salesCollection
        .aggregate(pipeline, {
          allowDiskUse: true,
        })
        .toArray();

      const list = results.map((row) => {
        const id = row._id || {};
        const updatedDate = id.updated_date || id.date || null;
        const personCount = parseInt(id.person_count) || 0;

        let qty = row.qty || 0;
        const lineTotal = row.line_total || 0;
        const baseTotal = row.base_total || 0;
        const preTaxTotal = row.pre_tax_total || 0;
        let taxTotal = row.tax_total || 0;
        let itemDisc = row.item_discount_total || 0;
        let extraDisc = row.extra_discount_total || 0;

        if (qty < 0) qty = 0;
        if (taxTotal < 0) taxTotal = 0;
        if (itemDisc < 0) itemDisc = 0;
        if (extraDisc < 0) extraDisc = 0;

        let salesTotal = row.sales_total || 0;
        if (salesTotal < 0) salesTotal = 0;

        let baseLineAmount = preTaxTotal;
        if (baseLineAmount <= 0) baseLineAmount = baseTotal;
        if (baseLineAmount <= 0) baseLineAmount = lineTotal - taxTotal + itemDisc;
        if (baseLineAmount < 0) baseLineAmount = 0;

        const amountDisplay = Math.round(baseLineAmount * 100) / 100;
        let amountWithoutTax = amountDisplay - itemDisc;
        if (amountWithoutTax < 0) amountWithoutTax = 0;

        let taxRecalc = lineTotal - amountWithoutTax;
        if (taxRecalc < 0) taxRecalc = 0;

        return {
          id: id.id,
          sales_id: id.sales_id || '',
          table_number: id.table_number || '',
          string_date: updatedDate ? formatDate(updatedDate) : null,
          item_name: id.item_name || '',
          qty: qty,
          amount: Math.round(amountDisplay * 100) / 100,
          tax: Math.round(taxRecalc * 100) / 100,
          discount: Math.round(itemDisc * 100) / 100,
          extra_discount: Math.round(extraDisc * 100) / 100,
          total: Math.round(lineTotal * 100) / 100,
          order_type: id.dine_type || '',
          pax: personCount,
          sales_total: Math.round(salesTotal * 100) / 100,
          payment_mode: row.payment_mode || '',
          multi_payment: row.multi_payment || null,
        };
      });

      return {
        status: true,
        data: {
          list,
          total: list.length,
        },
        message: 'Get successfully',
      };
    } catch (error) {
      console.error('Error in kotTablewiseDetailsPage:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to fetch KOT table-wise details',
      };
    }
  }

  async pendingCustomerCategoryReportPage(data, options, { SaleModel } = {}) {
    try {
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';
      const fromTs = BaseModel.startingDate
        ? BaseModel.startingDate(data.starting_date, timeZone)
        : Date.parse(data.starting_date || '') || 0;
      const toTs = BaseModel.endingDate
        ? BaseModel.endingDate(data.ending_date, timeZone)
        : Date.parse(data.ending_date || '') || Date.now();

      const fromDate = new Date(fromTs || 0);
      const toDate = new Date(toTs || Date.now());

      const rawBranch = data.branchid;
      const branchIds = Array.isArray(rawBranch) ? rawBranch : rawBranch ? [rawBranch] : [];

      const branchObjectIds = branchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const andConditions = [];
      andConditions.push({ sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } });
      if (branchObjectIds.length) {
        andConditions.push({ branch_id: { $in: branchObjectIds } });
      }
      andConditions.push({
        updated_date: { $gte: fromDate, $lte: toDate },
      });
      andConditions.push({ category_id: { $ne: '' } });
      andConditions.push({
        $or: [
          { payment_status: 'Partialy Paid' },
          { payment_status: PAYMENT_STATUS.PENDING },
          { payment_pending: { $gt: 0 } },
        ],
      });
      if (BaseModel.license) {
        andConditions.push({ license: BaseModel.license });
      }

      const filters = { $and: andConditions };

      console.log(
        '🔍 pendingCustomerCategoryReportPage filters:',
        JSON.stringify(filters, null, 2)
      );
      console.log('🔍 Date range:', { fromDate, toDate });
      console.log('🔍 Branch IDs:', branchObjectIds);

      const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : BaseModel.limit;
      const page = parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
      const skip = Math.max(0, (page - 1) * limit);

      const db = await BaseModel.getDb();
      const salesCollection = db.collection('sales');

      const pipeline = [
        { $match: filters },
        {
          $group: {
            _id: {
              category_id: '$category_id',
              category_name: '$category_name',
            },
            number_of_items: { $sum: '$number_of_items' },
            pending_amount: { $sum: '$items_total' },
            partial_amount: { $sum: '$partial_balance' },
            due_amount: { $sum: '$payment_pending' },
          },
        },
        { $sort: { pending_amount: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const aggResults = await salesCollection.aggregate(pipeline).toArray();

      console.log('🔍 Aggregation results count:', aggResults.length);
      console.log('🔍 First result:', aggResults[0]);

      const list = (aggResults || []).map((doc) => {
        const id = doc._id || {};
        return {
          category_id: id.category_id ? id.category_id.toString() : '',
          category_name: id.category_name || '',
          sales_payment: round(doc.pending_amount || 0, 2),
          partial_balance: round(doc.partial_amount || 0, 2),
          due_balance: round(doc.due_amount || 0, 2),
          sales_count: doc.number_of_items || 0,
        };
      });

      const countPipeline = [
        { $match: filters },
        {
          $group: {
            _id: {
              category_id: '$category_id',
              category_name: '$category_name',
            },
          },
        },
        { $count: 'total' },
      ];

      const countDocs = await salesCollection.aggregate(countPipeline).toArray();
      const total = (countDocs[0] && countDocs[0].total) || 0;

      console.log('🔍 Total count:', total);
      console.log('🔍 List length:', list.length);

      return {
        status: true,
        total,
        current_page: page,
        total_pages: limit ? Math.ceil(total / limit) : 0,
        per_page: limit,
        list,
      };
    } catch (error) {
      console.error('Error in pendingCustomerCategoryReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async kioskReportPage(value, options, { SaleModel } = {}) {
    try {
      const baseModel = new BaseModel('sales');

      const FromDate = baseModel.startingDate(
        value.starting_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );
      const ToDate = baseModel.endingDate(
        value.ending_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );

      const branchIds = [];
      if (Array.isArray(value.branchid)) {
        value.branchid.forEach((id) => {
          if (id && mongoose.Types.ObjectId.isValid(String(id))) {
            branchIds.push(new mongoose.Types.ObjectId(String(id)));
          }
        });
      }

      let methodFilter = {};
      if (value.kiosk_method) {
        methodFilter = { sale_method: value.kiosk_method };
      } else {
        methodFilter = { sale_method: { $in: ['Kiosk', 'Self-Order'] } };
      }

      const filters = {
        $and: [
          { branch_id: { $in: branchIds } },
          { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
          methodFilter,
          {
            updated_date: { $gte: new Date(FromDate), $lte: new Date(ToDate) },
            license: BaseModel.license,
          },
        ],
      };

      const checkResponse = await baseModel.checkPlan('sales', 'report');
      const limitCheck = { limit: checkResponse };

      const fields = BaseModel.getSelectFields(
        SaleModel?.LegacySaleModel?.fields || SaleModel?.fields || {}
      );

      const pageOptions = {
        limit: parseInt(options.limit, 10) || 5,
        page: parseInt(options.page, 10) || 1,
        sort: { updated_date: -1 },
      };

      const response = await baseModel.page('sales', limitCheck, filters, pageOptions, fields);
      return response;
    } catch (error) {
      console.error('Error in kioskReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  async kiosksSummaryReportsPage(value, { SaleModel } = {}) {
    try {
      const baseModel = new BaseModel('sales');

      const FromDate = baseModel.startingDate(
        value.starting_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );
      const ToDate = baseModel.endingDate(
        value.ending_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );

      const branchIds = [];
      if (Array.isArray(value.branchid)) {
        value.branchid.forEach((id) => {
          if (id && mongoose.Types.ObjectId.isValid(String(id))) {
            branchIds.push(new mongoose.Types.ObjectId(String(id)));
          }
        });
      }

      let methodFilter = {};
      if (value.kiosk_method) {
        methodFilter = { sale_method: value.kiosk_method };
      } else {
        methodFilter = { sale_method: { $in: ['Kiosk', 'Self-Order'] } };
      }

      const condition = {
        branch_id: { $in: branchIds },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn', 'FullReturn'] },
        ...methodFilter,
        date: { $gte: new Date(FromDate), $lte: new Date(ToDate) },
        license: BaseModel.license,
      };

      const collection = await baseModel.getCollection('sales');

      const salesSummary = await collection
        .aggregate(
          [
            { $match: condition },
            {
              $addFields: {
                sales_total_num: {
                  $toDouble: { $ifNull: ['$items_total', 0] },
                },
                tax_num: { $toDouble: { $ifNull: ['$tax', 0] } },
                items_return_total_num: {
                  $toDouble: {
                    $ifNull: [
                      {
                        $cond: {
                          if: { $isArray: '$items_return_total' },
                          then: { $arrayElemAt: ['$items_return_total', 0] },
                          else: '$items_return_total',
                        },
                      },
                      0,
                    ],
                  },
                },
                discount_num: {
                  $toDouble: { $ifNull: ['$discount', 0] },
                },
                company_price_total_num: {
                  $toDouble: {
                    $ifNull: [
                      {
                        $cond: {
                          if: { $isArray: '$total_companyprice' },
                          then: { $arrayElemAt: ['$total_companyprice', 0] },
                          else: '$total_companyprice',
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                sales_include_tax: { $sum: '$sales_total_num' },
                sales_exclude_tax: {
                  $sum: {
                    $subtract: ['$sales_total_num', '$tax_num'],
                  },
                },
                net_sales: {
                  $sum: {
                    $subtract: ['$sales_total_num', { $add: ['$tax_num'] }],
                  },
                },
                net_sales_tax: { $sum: '$tax_num' },
                discounts: { $sum: '$discount_num' },
                gross_profit: {
                  $sum: {
                    $subtract: [
                      {
                        $subtract: ['$sales_total_num', { $add: ['$tax_num'] }],
                      },
                      '$company_price_total_num',
                    ],
                  },
                },
                refunds: { $sum: '$items_return_total_num' },
                cogs: { $sum: '$company_price_total_num' },
              },
            },
          ],
          { allowDiskUse: true }
        )
        .toArray();

      const result = salesSummary[0] || {};

      const paymentModeSummary = await collection
        .aggregate([
          { $match: condition },
          {
            $addFields: {
              sales_total_num: {
                $toDouble: { $ifNull: ['$items_total', 0] },
              },
            },
          },
          {
            $group: {
              _id: '$payment_mode',
              amount: { $sum: '$sales_total_num' },
            },
          },
        ])
        .toArray();

      const paymentModeTotals = {};
      paymentModeSummary.forEach((row) => {
        const mode = row._id || 'Unknown';
        paymentModeTotals[mode] = Math.round(row.amount * 100) / 100;
      });

      return {
        status: true,
        data: {
          sales_include_tax: result.sales_include_tax || 0,
          sales_exclude_tax: result.sales_exclude_tax || 0,
          net_sales: result.net_sales || 0,
          net_sales_tax: result.net_sales_tax || 0,
          discounts: result.discounts || 0,
          gross_profit: result.gross_profit || 0,
          refunds: result.refunds || 0,
          cogs: result.cogs || 0,
          payment_mode_totals: paymentModeTotals,
        },
        message: 'Sales summary report retrieved successfully',
      };
    } catch (error) {
      console.error('Error in kiosksSummaryReportsPage:', error);
      return {
        status: false,
        data: null,
        message: 'Error: ' + error.message,
      };
    }
  }

  async kiosksGraphicalReportsPage(value, { SaleModel } = {}) {
    try {
      const baseModel = new BaseModel('sales');

      const FromDate = baseModel.startingDate(
        value.starting_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );
      const ToDate = baseModel.endingDate(
        value.ending_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );

      const branchIds = [];
      if (Array.isArray(value.branchid)) {
        value.branchid.forEach((id) => {
          if (id && mongoose.Types.ObjectId.isValid(String(id))) {
            branchIds.push(new mongoose.Types.ObjectId(String(id)));
          }
        });
      }

      let methodFilter = {};
      if (value.kiosk_method) {
        methodFilter = { sale_method: value.kiosk_method };
      } else {
        methodFilter = { sale_method: { $in: ['Kiosk', 'Self-Order'] } };
      }

      const condition = {
        branch_id: { $in: branchIds },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
        ...methodFilter,
        date: { $gte: new Date(FromDate), $lte: new Date(ToDate) },
        license: BaseModel.license,
      };

      const collection = await baseModel.getCollection('sales');

      const pipeline = [
        { $match: condition },
        {
          $project: {
            payment_mode: 1,
            amount: { $toDouble: { $ifNull: ['$items_total', 0] } },
            datetime: {
              $dateToString: {
                format: '%Y-%m-%d %H:00',
                date: { $toDate: '$updated_date' },
                timezone: BaseModel.currentTimeZone || 'Asia/Kolkata',
              },
            },
          },
        },
        {
          $group: {
            _id: {
              datetime: '$datetime',
              payment_mode: '$payment_mode',
            },
            total: { $sum: '$amount' },
          },
        },
        {
          $group: {
            _id: '$_id.datetime',
            payments: {
              $push: {
                mode: '$_id.payment_mode',
                amount: '$total',
              },
            },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ];

      const results = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

      const data = {
        labels: [],
        cash: [],
        upi: [],
      };

      results.forEach((entry) => {
        const hourLabel = entry._id;
        data.labels.push(hourLabel);

        let cashAmount = 0;
        let upiAmount = 0;

        entry.payments.forEach((payment) => {
          if (payment.mode && payment.mode.toLowerCase() === 'cash') {
            cashAmount = Math.round(payment.amount * 100) / 100;
          } else if (payment.mode && payment.mode.toLowerCase() === 'upi') {
            upiAmount = Math.round(payment.amount * 100) / 100;
          }
        });

        data.cash.push(cashAmount);
        data.upi.push(upiAmount);
      });

      return {
        status: true,
        data,
        message: 'Kiosk hourly payment chart data fetched successfully',
      };
    } catch (error) {
      console.error('Error in kiosksGraphicalReportsPage:', error);
      return {
        status: false,
        data: null,
        message: 'Error: ' + error.message,
      };
    }
  }

  async itemExpiryReportPage(data, options, { SaleModel } = {}) {
    try {
      // Mirror legacy Sale.itemExpiryReportPage behaviour but keep logic in
      // the repository layer instead of on the Mongoose model.
      const baseModel = new BaseModel('items');

      const fromDate = baseModel.startingDate(
        data.starting_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );
      const toDate = baseModel.endingDate(
        data.ending_date,
        BaseModel.currentTimeZone || 'Asia/Kolkata'
      );

      let branchId = data.branchid;
      if (Array.isArray(branchId)) {
        branchId = branchId[0];
      }
      if (branchId && typeof branchId === 'string' && mongoose.Types.ObjectId.isValid(branchId)) {
        branchId = new mongoose.Types.ObjectId(branchId);
      }

      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const collection = await baseModel.getCollection('items');

      // items_expiry_date may be stored as a BSON Date (PHP legacy) or as a
      // string "YYYY-MM-DD" (Node.js created items).  Use $or to match both.
      const fromDateObj = new Date(fromDate);
      const toDateObj = new Date(toDate);
      const fromDateStr = fromDateObj.toISOString().split('T')[0];
      const toDateStr = toDateObj.toISOString().split('T')[0];

      const filters = {
        $or: [
          { items_expiry_date: { $gte: fromDateObj, $lte: toDateObj } },
          { items_expiry_date: { $gte: fromDateStr, $lte: toDateStr } },
        ],
        available_quantity: { $gt: 0 },
        'branch_access.branch_id': branchId,
      };

      const total = await collection.countDocuments(filters);

      const expiredItems = await collection
        .find(filters, {
          projection: {
            name: 1,
            available_quantity: 1,
            category_name: 1,
            items_expiry_date: 1,
          },
          skip,
          limit,
        })
        .toArray();

      const itemData = expiredItems.map((item) => {
        const expiryDate =
          item.items_expiry_date instanceof Date
            ? item.items_expiry_date.toISOString().split('T')[0]
            : new Date(item.items_expiry_date).toISOString().split('T')[0];

        return {
          item_name: item.name || '',
          available_quantity: item.available_quantity || 0,
          category_name: item.category_name || '',
          expiry_date: expiryDate,
        };
      });

      return {
        status: true,
        total,
        current_page: page,
        total_pages: Math.ceil(total / limit),
        per_page: limit,
        list: itemData,
      };
    } catch (error) {
      console.error('Error in itemExpiryReportPage:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to fetch item expiry report',
      };
    }
  }

  async salePage(filters, options, branchId, { SaleModel } = {}) {
    try {
      const Model = this.getModel(SaleModel);

      const limit = parseInt(options?.limit, 10) || 10;
      const page = parseInt(options?.page, 10) || 1;
      const skip = (page - 1) * limit;
      const sort = options?.sort || { _id: -1 };

      const query = {};

      // Apply branchId filter
      if (branchId) {
        const { ObjectId } = require('mongodb');
        if (ObjectId.isValid(String(branchId))) {
          query.branch_id = new mongoose.Types.ObjectId(String(branchId));
        } else {
          query.branch_id = branchId;
        }
      }

      // Apply filters
      if (filters && typeof filters === 'object') {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'branch_id') continue; // already handled
          query[key] = value;
        }
      }

      // Add license filter
      if (BaseModel.license) {
        query.license = BaseModel.license;
      }

      const [docs, total] = await Promise.all([
        Model.find(query).sort(sort).skip(skip).limit(limit).lean(),
        Model.countDocuments(query),
      ]);

      return {
        status: true,
        message: docs.length ? 'Records fetched' : 'No records found',
        data: {
          list: docs,
          total,
          per_page: limit,
          current_page: page,
          total_pages: Math.max(Math.ceil(total / limit), 1),
        },
      };
    } catch (error) {
      console.error('Error in salePage:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async generateSalesIdForBranch(branchIdRaw) {
    if (!branchIdRaw) {
      throw new Error('branchId is required to generate sales_id');
    }

    const db = await BaseModel.getDb();
    const branches = db.collection('branches');
    const salesCollection = db.collection('sales');

    const branchId =
      branchIdRaw instanceof mongoose.Types.ObjectId
        ? branchIdRaw
        : mongoose.Types.ObjectId.isValid(String(branchIdRaw))
          ? new mongoose.Types.ObjectId(String(branchIdRaw))
          : branchIdRaw;

    const branchDoc = await branches.findOne({
      _id: branchId,
      ...(BaseModel.license ? { license: BaseModel.license } : {}),
    });
    const prefix =
      (branchDoc?.sales_prefix || branchDoc?.salesPrefix || 'SID').toString().trim() || 'SID';
    const prefixLength = prefix.length;

    const filter = { branch_id: branchId };
    if (BaseModel.license) {
      filter.license = BaseModel.license;
    }

    const lastRecord = await salesCollection.findOne(filter, {
      projection: { sales_id: 1 },
      sort: { _id: -1 },
      limit: 1,
    });

    let incrementVal;
    if (lastRecord && lastRecord.sales_id) {
      const lastSalesId = lastRecord.sales_id.toString();
      const subStringValue = lastSalesId.substring(prefixLength);

      if (subStringValue.length <= 6 && /^\d+$/.test(subStringValue)) {
        const countValue = parseInt(subStringValue, 10) + 1;
        incrementVal = String(countValue).padStart(6, '0');
      } else {
        incrementVal = '000001';
      }
    } else {
      incrementVal = '000001';
    }

    return prefix + incrementVal;
  }

  async getLastSaleForBranch(branchId, licenseId, { SaleModel } = {}) {
    const Model = this.getModel(SaleModel);
    return Model.findOne({ branch_id: branchId, license: licenseId }).sort({
      _id: -1,
    });
  }
}

module.exports = new SalesRepository();
