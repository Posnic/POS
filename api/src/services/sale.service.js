const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const Sale = require('../models/sale.model');
const BaseModel = require('../models/base.model');
const StockLogsRepository = require('../repositories/stock-log.repository');
const ItemRepository = require('../repositories/item.repository');
const CustomerRepository = require('../repositories/customer.repository');
const RegisterRepository = require('../repositories/register.repository');
const branchesRepository = require('../repositories/branch.repository');
const salesRepository = require('../repositories/sale.repository');
const { ERROR_MESSAGES } = require('../constants/sales.constants');
const { PAYMENT_STATUS, SALE_STATUS } = require('../constants');
const { NotFoundError, BadRequestError } = require('../utils/appError');
const { toNumberExpression } = require('../helpers/sales.helper');

// Helper to get model instance or class
const getModel = (SaleModel) => SaleModel || Sale;

const { computeLineTax } = require('./tax-engine');
const round2 = (value, decimals = 2) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

// Shared aggregation pipeline for daily payment/tender breakdown.
//
// This mirrors the logic used in DashboardModel.getPaymentModes so that
// split payments recorded in multi_payment (e.g. { Upi: 200, Gpay: 300 })
// are counted against each individual tender type instead of a combined
// label like "Upi,Gpay" on the root payment_mode field.
//
// - For documents with a non-empty multi_payment object, we:
//     * $objectToArray it into [ {k, v}, ... ]
//     * group by k and sum v as the tender amount.
// - For documents without multi_payment, we fall back to payment_mode and
//   sum the full sales_total/total as before.
// - Finally we merge both paths and group again by tender name to produce
//   a single { _id: <tender>, total: <amount> } list.
const buildDailyPaymentAggregationPipeline = (match) => [
  { $match: match },
  {
    $project: {
      sales_total: {
        $toDouble: {
          $ifNull: [{ $ifNull: ['$sales_total', '$total'] }, 0],
        },
      },
      items_total: {
        $toDouble: { $ifNull: ['$items_total', 0] },
      },
      multi_payment: 1,
      payment_mode: 1,
      payment_entries: {
        $cond: [
          { $eq: [{ $type: '$multi_payment' }, 'object'] },
          { $objectToArray: '$multi_payment' },
          [],
        ],
      },
    },
  },
  {
    $addFields: {
      has_split: { $gt: [{ $size: '$payment_entries' }, 0] },
    },
  },
  {
    $facet: {
      // Sales with split/multi payment methods
      split_payments: [
        { $match: { has_split: true } },
        { $unwind: '$payment_entries' },
        {
          $group: {
            _id: '$payment_entries.k',
            total: {
              $sum: {
                $toDouble: { $ifNull: ['$payment_entries.v', 0] },
              },
            },
          },
        },
      ],
      // Sales without multi_payment: fall back to single payment_mode
      single_payments: [
        { $match: { has_split: false } },
        {
          $group: {
            _id: { $ifNull: ['$payment_mode', 'Cash'] },
            total: {
              $sum: {
                $toDouble: {
                  $ifNull: ['$sales_total', '$items_total'],
                },
              },
            },
          },
        },
      ],
    },
  },
  {
    $project: {
      combined: { $concatArrays: ['$split_payments', '$single_payments'] },
    },
  },
  { $unwind: '$combined' },
  { $replaceRoot: { newRoot: '$combined' } },
  {
    $group: {
      _id: '$_id',
      total: { $sum: '$total' },
    },
  },
  { $sort: { total: -1 } },
];

// Lightweight helpers for controllers that still need branch metadata
// Delegates to the BranchesRepository so that all branch DB access stays
// inside the repository layer.
const getBranchById = async (id) => {
  if (!id) return null;
  try {
    return await branchesRepository.findById(id, { lean: true });
  } catch (error) {
    console.warn('getBranchById: Branch lookup failed', error);
    return null;
  }
};

/**
 * Enrich a basic sale context with branch-specific settings.
 *
 * This helper centralises the logic for loading a Branch document and
 * populating the derived context fields (roundOff, branchSettings,
 * stockManagement, salesPrefix, branchName, branchState, printingAddress).
 *
 * It is deliberately tolerant: if the branch lookup fails for any reason,
 * the original context is returned unchanged so that callers can fall back
 * to sensible defaults without breaking existing behaviour.
 *
 * @param {Object} context
 * @returns {Promise<Object>} updated context
 */
const enrichSaleContext = async (context = {}) => {
  const updated = { ...context };
  const rawBranchId = updated.branchId;

  if (!rawBranchId) {
    return updated;
  }

  try {
    const branchDoc = await branchesRepository.findById(rawBranchId, {
      lean: true,
    });
    if (!branchDoc) {
      return updated;
    }

    updated.roundOff = branchDoc.roundOff === true;
    updated.branchSettings = branchDoc;
    console.log(branchDoc.stock_management);
    // Use database stock_management setting
    updated.stockManagement = branchDoc.stock_management !== false;
    // The branch's prefix wins, even if it is blank (a shop may want plain
    // numbers); only when it was never set do we keep the prior value or 'S'.
    updated.salesPrefix =
      branchDoc.sales_prefix != null
        ? branchDoc.sales_prefix
        : updated.salesPrefix != null
          ? updated.salesPrefix
          : 'S';
    updated.branchName = branchDoc.branch_name || updated.branchName;
    updated.branchState = (branchDoc.store_state || branchDoc.state || branchDoc.branch_state || '')
      .toString()
      .trim();
    updated.printingAddress = branchDoc.printing_address;

    return updated;
  } catch (error) {
    console.warn('enrichSaleContext: Branch fetch failed', error);
    return updated;
  }
};

/**
 * processSale - Main logic for Add/Edit sale (Equivalent to PHP salesInsertUpdate)
 * @param {Object} data - The payload (items, customer_id, totals, etc.)
 * @param {String} id - Sale ID (empty for Add, present for Edit)
 * @param {String} process - 'Add' | 'Edit' | 'Hold' | 'KOT'
 * @param {Object} context - { branchId, licenseId, userId, userName, ... }
 */
const processSale = async (data, id = '', process = 'Add', context = {}) => {
  try {
    // 1. Basic Validation
    if ((parseFloat(data.sales_total) || 0) < 0) {
      // PHP checks < 1, but let's say 0 for safety, PHP said < 1
      // PHP: if ((int) $data['sales_total'] < 1) ... 'Pay Total cannot be zero or less than zero.'
      // However, some businesses allow 0 cost sales. I'll stick to PHP parity strictly.
      if (parseInt(data.sales_total) < 1) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.PAY_TOTAL_INVALID,
        };
      }
    }

    const branchId = context.branchId ? new ObjectId(context.branchId) : null;
    const licenseId = context.licenseId ? new ObjectId(context.licenseId) : null;
    const userId = context.userId ? new ObjectId(context.userId) : null;
    const userName = context.userName || 'System';

    if (!branchId || !licenseId) {
      return { status: false, message: ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED };
    }

    // 2. Check Plan / Max Sales (Skipped for now, assuming valid plan)
    // In strict PHP parity, we would check collection count.

    // Repositories for dependent modules to keep DB access out of services
    const itemRepository = new ItemRepository();
    const customerRepository = new CustomerRepository();
    const registerRepository = new RegisterRepository();

    if (data.register_id) {
      const registerSession = await registerRepository.validateSessionOwner(
        data.register_id,
        context.userId,
        context.deviceId
      );
      if (!registerSession.status) {
        return {
          status: false,
          data: null,
          message:
            registerSession.message ||
            'This cash register session is locked by another user or device.',
        };
      }
    }

    // 3. Process Items & Calculations
    const items = data.items || [];

    // Robust numeric parser for legacy string values that may contain
    // commas or currency/percent symbols.
    const parseLegacyNumber = (value) => {
      if (value === undefined || value === null) return null;
      const sanitized = String(value)
        .replace(/,/g, '')
        .replace(/[^0-9+\-.]/g, '')
        .trim();
      if (!sanitized) return null;
      const num = parseFloat(sanitized);
      return Number.isFinite(num) ? num : null;
    };

    const total_data = [];
    const total_company_data = [];
    const discount_data = [];
    const tax_data = [];
    const subtotal_data = [];

    // Inventory Change Tracking
    const changes_items = [];
    const existing_changes = [];
    const oldItemsData = {};

    // Fetch Existing Sale if Edit
    let existingSale = null;
    if (id !== '') {
      existingSale = await salesRepository.getById(id);
      if (existingSale) {
        if (existingSale.items) {
          existingSale.items.forEach((oldItem) => {
            if (oldItem.item_id) {
              oldItemsData[String(oldItem.item_id)] = {
                quantity: parseFloat(oldItem.item_quantity),
                name: oldItem.item_name || '',
                item_code: oldItem.item_sku || '', // PHP uses item_code/item_id inconsistent naming sometimes
                price: parseFloat(oldItem.item_price || 0),
                unit: oldItem.item_unit || 'qty',
                status: oldItem.item_status || '',
              };
            }
          });
        }
        if (existingSale.changes) {
          existing_changes.push(...existingSale.changes);
        }
      }
    }

    const itemsale = [];
    const total_available_qty_map = {}; // To track simulated deductions within this batch

    // Iterate Items (Validation + Calc)
    for (const item of items) {
      const itemQuantity = parseFloat(item.item_quantity);
      const itemId = item.item_id;

      // Fetch Item from DB via repository
      const document = await itemRepository.findItemById(itemId);

      if (!document) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.ITEM_REMOVED,
        };
      }

      // Validate ID match (PHP does this)
      if (document._id.toString() !== itemId) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.INVALID_ITEM_ID,
        };
      }

      // Determine Values (Logic from PHP)
      // Prefer numeric overrides from payload, then per-item discount fields,
      // then legacy item master. All values may arrive as formatted strings.
      const discountAmount =
        parseLegacyNumber(item.sale_inline_discount_value) ??
        parseLegacyNumber(item.item_discount) ??
        parseLegacyNumber(document.discount_amount) ??
        0;

      const discountPercentage =
        parseLegacyNumber(item.sale_inline_discount_pervalue) ??
        parseLegacyNumber(item.item_discount_percentage) ??
        parseLegacyNumber(document.discount_percentage) ??
        0;

      // Selling Price Resolution
      const sellingPrice =
        parseLegacyNumber(item.sale_inline_item_price) ??
        parseLegacyNumber(item.item_price_total) ??
        parseLegacyNumber(document.selling_price) ??
        0;

      const itemAmount = sellingPrice * itemQuantity;

      // Prefer payload-provided company_price_total when available, otherwise
      // fall back to legacy item company_price * quantity.
      const companyPrice =
        parseLegacyNumber(item.company_price_total) ??
        itemQuantity * (parseLegacyNumber(document.company_price) ?? 0);

      total_company_data.push({ company_amount: companyPrice });

      // Tax percentage: prefer per-line tax rate from payload (item.tax),
      // then fall back to the item master tax when not provided. The
      // separate GST amount from the legacy frontend is handled via
      // `gstValue` below.
      const itemTax = parseLegacyNumber(item.tax) ?? parseLegacyNumber(document.tax) ?? 0;

      let itemDiscountAmountMultiple = 0;
      let itemDiscountPercentageMultiple = 0;
      let itemDiscountAmountTotalCalculation = 0;
      let itemSubTaxTotalCalculation = 0;
      let itemTaxAmountForItem = 0;
      let effectiveItemTax = itemTax;
      let effectiveTaxType = item.tax_type || document.tax_type || '';

      /*
       * T1: the ONE tax engine computes this line. tax-engine.js carries
       * the six branches verbatim from the block that used to live here,
       * contract-locked by its vector suite - and the PHP-quirk locals the
       * code below reads are reproduced exactly: the per-line discount
       * field stays 0 for percentage branches (PHP reset it), the stored
       * per-line tax rounds to 2dp while the header sums keep the raw
       * value, and only the legacy GST-amount fallback may override the
       * item's declared tax rate and type.
       */
      const gstAmountForFallback =
        typeof item.gst === 'number' ? item.gst : parseFloat(item.gst || 0) || 0;
      const engineLine = computeLineTax({
        itemAmount,
        sellingPrice,
        itemQuantity,
        itemTax,
        taxType: document.tax_type,
        discountAmount,
        discountPercentage,
        gstAmount: gstAmountForFallback,
      });
      itemDiscountAmountTotalCalculation = engineLine.total;
      itemSubTaxTotalCalculation = engineLine.tax;
      itemTaxAmountForItem = engineLine.taxForItem;
      effectiveItemTax = engineLine.effectiveTax;
      const legacyGstFallbackFired =
        itemTax <= 0 && gstAmountForFallback > 0 && discountPercentage > 0 && !(discountAmount > 0);
      if (legacyGstFallbackFired) {
        effectiveTaxType = 'inclusive';
      }
      itemDiscountAmountMultiple = discountAmount > 0 ? discountAmount * itemQuantity : 0;
      itemDiscountPercentageMultiple =
        !(discountAmount > 0) && discountPercentage > 0 ? discountPercentage : 0;
      total_data.push({ totalsales_Amount: engineLine.total });
      tax_data.push({ tax_amount: engineLine.tax });
      discount_data.push({ discount_amount: engineLine.discount });
      subtotal_data.push({ subtotal_amount: engineLine.subtotal });

      // Inventory check
      const availablequatity = parseFloat(document.available_quantity || 0);
      const total_available_qty = availablequatity - itemQuantity;

      // Calculate Changes (Old Item logic)
      let changeQty = 0;
      let changeProcess = '';
      let finalStatus = item.item_status || '';

      if (id === '') {
        // Add Mode
        changeProcess = 'add';
        changeQty = itemQuantity;
      } else {
        // Edit Mode
        const itemIdStr = String(itemId);
        let oldQty = 0;
        let oldStatus = '';

        if (oldItemsData[itemIdStr]) {
          oldQty = oldItemsData[itemIdStr].quantity;
          oldStatus = oldItemsData[itemIdStr].status;
          delete oldItemsData[itemIdStr]; // Mark as processed
        }

        if (String(oldStatus).toLowerCase() === 'instant') {
          finalStatus = 'instant';
        }

        if (itemQuantity > oldQty) {
          changeProcess = 'add';
          changeQty = itemQuantity - oldQty;
        } else if (itemQuantity < oldQty) {
          changeProcess = 'cancel';
          changeQty = oldQty - itemQuantity;
        }
      }

      if (changeQty > 0) {
        changes_items.push({
          item_id: itemId,
          item_name: document.name,
          item_quantity: changeQty,
          process: changeProcess,
          item_code: document.itemid,
          unit: item.item_unit || 'qty',
          price: sellingPrice,
          total: sellingPrice * changeQty,
        });
      }

      // GST/IGST (Indian GST Logic)
      let igst_value = 0;
      let csgst_value = 0;

      // In PHP, $gstValue comes from the incoming item payload (per-line GST),
      // not from the calculated tax amount. However, some modern flows may
      // omit this dedicated `gst` field and only send percentage + totals.
      // To keep the sales view Tax Details card correct in those cases, we
      // fall back to the server-computed per-line tax amount when needed.
      const gstValueRaw = typeof item.gst === 'number' ? item.gst : parseFloat(item.gst || 0) || 0;

      const fallbackGst = typeof itemTaxAmountForItem === 'number' ? itemTaxAmountForItem : 0;

      // Prefer explicit payload gst when provided; otherwise, reuse the
      // computed tax amount so IGST/CGST/SGST are still populated for
      // GST-enabled branches.
      const gstValue = gstValueRaw > 0 ? gstValueRaw : fallbackGst;

      const indianGstSetting = context.branchSettings?.indian_gst || 'gst_off';

      const interPlace = (data.customer_state || '').trim() !== (context.branchState || '').trim();
      if (indianGstSetting === 'gst_on' && gstValue > 0) {
        if (interPlace) {
          igst_value = gstValue;
        } else {
          csgst_value = gstValue / 2;
        }
      }

      /*
       * T2 dual-write: the generalised component list beside the legacy
       * igst/cgst/sgst fields. For an IN profile with GST on this stores
       * exactly what those fields say, under their names; for everyone
       * else, one component under the profile's label - the receipt and
       * report phases read THIS, and the legacy fields retire later via
       * a straggler audit, never by surprise.
       */
      let tax_components;
      if (gstValue > 0) {
        const taxProfiles = require('./tax-profiles');
        const { profile } = taxProfiles.profileForBranch(context.branchSettings || {});
        const splitApplies = indianGstSetting === 'gst_on';
        tax_components = taxProfiles.buildTaxComponents(
          splitApplies ? profile : { label: profile.label, components: { mode: 'single' } },
          gstValue,
          interPlace
        );
      }

      // Determine available quantity mirror (PHP: item_available_quantity)
      const itemAvailableQty =
        item.item_status !== 'instant' ? total_available_qty : availablequatity;

      // Resolve a per-line tax_name for this sale item.
      // Priority:
      //  1) Explicit item.tax_name stored on the product
      //  2) Name/code from the first entry in item.tax_fields (when present)
      //  3) HSN code from the item master (hsncode / hsn_code)
      // This ensures that the sales view Tax Details block always has a
      // meaningful label even for legacy items that never persisted
      // tax_name directly.
      let lineTaxName = '';
      if (typeof document.tax_name === 'string' && document.tax_name.trim()) {
        lineTaxName = document.tax_name.trim();
      } else if (Array.isArray(document.tax_fields) && document.tax_fields.length) {
        const primaryField = document.tax_fields[0] || {};
        const candidate = (
          primaryField.tax_name ||
          primaryField.name ||
          primaryField.code ||
          primaryField.hsncode ||
          primaryField.hsn_code ||
          ''
        )
          .toString()
          .trim();
        if (candidate) {
          lineTaxName = candidate;
        }
      }

      if (!lineTaxName) {
        const hsnFromDoc = (document.hsncode || document.hsn_code || '').toString().trim();
        if (hsnFromDoc) {
          lineTaxName = hsnFromDoc;
        }
      }

      // Add to itemsale (Mongoose core fields + full PHP $itemsale mirror)
      // Also propagate HSN metadata so the frontend sales_view.js can
      // distinguish HSN-based tax rows from simple one-rate taxes when
      // Indian GST is disabled.
      itemsale.push({
        // Mongoose Schema Required Fields (Node-native)
        item: new ObjectId(itemId),
        name: document.name,
        quantity: itemQuantity,
        unit_price: sellingPrice,
        tax_rate: effectiveItemTax,
        // tax_amount is defined below in the PHP-legacy block to avoid
        // duplicate keys and to mirror PHP's stored per-line tax amount.
        discount: itemDiscountAmountMultiple,
        total: itemDiscountAmountTotalCalculation,

        // Legacy Fields (strict PHP parity with $itemsale structure)
        sale_inline_item_price: sellingPrice,
        sale_inline_discount_value: discountAmount,
        sale_inline_discount_pervalue: discountPercentage,
        item_status: finalStatus,
        return: false,
        item_name: document.name,
        item_sku: document.itemid,
        item_price: sellingPrice,
        item_discount: discountAmount,
        item_discount_percentage: discountPercentage,
        item_quantity: itemQuantity,
        item_available_quantity: itemAvailableQty,
        item_id: itemId || '',
        item_unit: item.item_unit || 'qty',
        total_amount: itemDiscountAmountTotalCalculation,
        barcode_id: document.barcode_id || '',
        company_price_total: companyPrice,
        category_id: document.category_id || undefined,
        category_name: document.category_name || '',
        supplier_id: document.supplier_id || undefined,
        supplier_name: document.supplier_name || '',
        item_description: typeof item.item_description === 'string' ? item.item_description : '',
        // HSN metadata (optional, mirrors Item document fields). These are
        // used only for display in the sales view; they do not affect the
        // core tax calculation, which continues to rely on tax/tax_fields.
        hsncode: (document.hsncode || document.hsn_code || '')?.toString().trim() || '',
        hsndescription:
          (document.hsndescription || document.hsn_description || '')?.toString().trim() || '',
        tax: effectiveItemTax,
        tax_type: effectiveTaxType,
        igst_tax: igst_value,
        cgst_tax: csgst_value,
        sgst_tax: csgst_value,
        ...(tax_components && tax_components.length ? { tax_components } : {}),
        tax_name: lineTaxName,
        tax_amount: itemTaxAmountForItem,
        tax_fields: Array.isArray(document.tax_fields)
          ? document.tax_fields
          : document.tax_fields || [],
        track_inventory: Boolean(document.track_inventory),
        negative_stock:
          typeof document.negative_stock === 'boolean' ? document.negative_stock : false,
      });
    } // End Item Loop

    // Summing Totals (base on PHP-style item calculations)
    let sale_tot_amount = total_data.reduce((acc, i) => acc + i.totalsales_Amount, 0);
    let sale_subtotal_amount = subtotal_data.reduce((acc, i) => acc + i.subtotal_amount, 0);
    let sale_discount_amount = discount_data.reduce((acc, i) => acc + i.discount_amount, 0);
    let sale_tax_amount = tax_data.reduce((acc, i) => acc + i.tax_amount, 0);
    let sale_company_amount = total_company_data.reduce((acc, i) => acc + i.company_amount, 0);

    // The legacy frontend also sends aggregate totals
    // (sales_total, sales_sub_total, tax, discount, sales_total_company_price).
    // To fully mirror PHP's behaviour and preserve precision, we treat those
    // payload values only as a **fallback** when our server-side sums are
    // missing/invalid, not as the primary source of truth.
    const parsePayloadNumber = (value) => {
      if (value === undefined || value === null) return null;
      const str = String(value).replace(/,/g, '').trim();
      if (!str) return null;
      const num = parseFloat(str);
      return Number.isFinite(num) ? num : null;
    };

    const preferServerValue = (serverValue, payloadRaw) => {
      const payloadNum = parsePayloadNumber(payloadRaw);
      if ((serverValue === null || !Number.isFinite(serverValue)) && payloadNum !== null) {
        return payloadNum;
      }
      return serverValue;
    };

    sale_tot_amount = preferServerValue(sale_tot_amount, data.sales_total);
    sale_subtotal_amount = preferServerValue(sale_subtotal_amount, data.sales_sub_total);
    sale_tax_amount = preferServerValue(sale_tax_amount, data.tax);
    sale_discount_amount = preferServerValue(
      sale_discount_amount,
      data.payment_descriptiondiscount ?? data.discount ?? data.discount_amount
    );
    sale_company_amount = preferServerValue(
      sale_company_amount,
      data.sales_total_company_price ?? data.sales_total_companyprice
    );

    // Date
    const dateInput = data.date || new Date();
    const mongo_date = new Date(dateInput);

    // Cancelled Items (Remaining in oldItemsData)
    if (id !== '' && Object.keys(oldItemsData).length > 0) {
      Object.keys(oldItemsData).forEach((remItemId) => {
        const remItem = oldItemsData[remItemId];
        changes_items.push({
          item_id: remItemId,
          item_name: remItem.name,
          item_quantity: remItem.quantity,
          process: 'cancel',
          item_code: remItem.item_code,
          unit: remItem.unit,
          price: remItem.price,
          total: remItem.price * remItem.quantity,
        });
      });
    }

    if (changes_items.length > 0) {
      existing_changes.push({
        timestamp: mongo_date, // Node Date object
        items: changes_items,
      });
    }

    // Generate Sales ID if New.
    //
    // Allocated from the atomic per-branch counter rather than by reading the
    // last sale and adding one: two simultaneous saves used to both read the
    // same "last" and mint the same bill number, and the old parse also
    // assumed every prefix was three characters, which corrupted the sequence
    // for any shop with a custom prefix of another length.
    let prefixId = '';
    if (id === '') {
      const prefixValue = context.salesPrefix != null ? context.salesPrefix : 'S';
      const n = await salesRepository.nextSalesNumberForBranch(branchId, licenseId);
      // Readable scheme (SB1D1-000045) once this till has its branch and its
      // gateway-assigned device code; until then a till-tagged number that is
      // already collision-free. Either way, two tills can never clash.
      prefixId = await salesRepository.buildDocNumber('S', branchId, n, {
        fallbackPrefix: prefixValue,
      });
    }

    // Extra Discount & Round Off
    const extraDiscountRaw = data.extra_discount ? Math.abs(parseFloat(data.extra_discount)) : 0;
    const extraDiscount = round2(extraDiscountRaw, 2);
    let itemsTotAmount = sale_tot_amount - extraDiscount;
    let salesExtraDiscount = extraDiscount;

    if (data.extra_discount_type === 'percent') {
      const discAmt = sale_tot_amount * (extraDiscount / 100);
      itemsTotAmount = sale_tot_amount - discAmt;
      salesExtraDiscount = discAmt;
    }

    /*
     * Coupon discount - a code the cashier applied. Validated in the controller
     * against this branch's coupons (active, in date, within its usage limits,
     * over its minimum spend), so here it is simply a fixed amount that reduces
     * the payable total. A coupon and a loyalty redemption may both apply to one
     * bill; each is clamped so the running total can never go below zero.
     */
    const couponCode = (data.coupon_code || '').toString().trim().toUpperCase();
    const couponDiscountValue = round2(
      Math.min(Math.abs(parseFloat(data.coupon_discount_value) || 0), itemsTotAmount),
      2
    );
    if (couponDiscountValue > 0) {
      itemsTotAmount = itemsTotAmount - couponDiscountValue;
    }

    /*
     * Loyalty redemption - a discount the cashier chose to spend points on.
     *
     * The points and the currency value were already validated in the
     * controller against this branch's loyalty rules and the customer's
     * balance, so here it is simply a fixed amount that reduces the payable
     * total, exactly like the extra discount above, and then rides the same
     * round-off and payment logic below. It is a plain number in the branch's
     * own currency, so it carries no assumption about symbol or country. Clamped
     * so a redemption can never push a bill below zero.
     */
    const loyaltyRedeemValue = round2(
      Math.min(Math.abs(parseFloat(data.loyalty_redeem_value) || 0), itemsTotAmount),
      2
    );
    const loyaltyRedeemPoints = Math.max(0, parseInt(data.loyalty_redeem_points, 10) || 0);
    if (loyaltyRedeemValue > 0) {
      itemsTotAmount = itemsTotAmount - loyaltyRedeemValue;
    }

    // Fetch Branch Settings for Round Off
    const roundOffSetting = context.roundOff === true;

    let roundOffValue = 0;
    let finalSaleTotAmount = itemsTotAmount;

    if (roundOffSetting) {
      finalSaleTotAmount = Math.round(itemsTotAmount);
      roundOffValue = finalSaleTotAmount - itemsTotAmount;
    }

    const salesTotalForDoc = round2(finalSaleTotAmount, 2);
    const roundOffForDoc = round2(roundOffValue, 2);
    const itemsTotalForDoc = roundOffSetting
      ? Math.round(itemsTotAmount)
      : round2(itemsTotAmount, 2);

    // PHP-like helper functions for exact logic parity
    const isset = (value) => value !== undefined && value !== null;
    const empty = (value) => !value || (typeof value === 'string' && value.trim() === '');

    // Partial / payment status (PHP parity - exact match to salesInsertUpdate lines 544-579)
    let partialCheck = false;
    let partialBalance = finalSaleTotAmount;
    let paymentStatus = 'Paid';
    let paymentPending = 0.0;

    // PHP line 547-552: Check if partial_check is 'true'
    /*
     * Tip in the bill (TIP_IN_TOTAL_DESIGN.md, revised): India default keeps
     * the tip OUT of the payable; when the till ticked "add to bill"
     * (tip_in_total), the amount due grows by the tip. Flag absent =>
     * effectiveDue === finalSaleTotAmount and every comparison below is
     * byte-identical to before.
     */
    const tipInTotal = String(data.tip_in_total) === 'true' && parseFloat(data.tip_amount || 0) > 0;
    const effectiveDue =
      finalSaleTotAmount +
      (tipInTotal ? Math.max(0, round2(parseFloat(data.tip_amount) || 0, 2)) : 0);

    if (isset(data.partial_check) && String(data.partial_check) === 'true') {
      // PHP line 548: $partialCheck = $data['partial_check']; (stores string 'true', not boolean)
      partialCheck = data.partial_check;
      // PHP line 549: $partialBalance = ($data['partial_check'] === 'true') ? (float) $data['partial_balance'] : 0.00;
      partialBalance =
        String(data.partial_check) === 'true' ? parseFloat(data.partial_balance || 0) : 0.0;
      // PHP line 550: $paymentStatus = ($process === 'Hold') ? 'Unpaid' : ($sale_tot_amount <= $data['partial_balance'] ? 'Paid' : 'Partialy Paid');
      paymentStatus =
        process === 'Hold'
          ? 'Unpaid'
          : effectiveDue <= parseFloat(data.partial_balance)
            ? 'Paid'
            : 'Partialy Paid';
      // PHP line 551: $paymentPending = ($process === 'Hold') ? 0.00 : ($sale_tot_amount <= $data['partial_balance'] ? 0.00 : $sale_tot_amount - (float) $data['partial_balance']);
      paymentPending =
        process === 'Hold'
          ? 0.0
          : effectiveDue <= parseFloat(data.partial_balance)
            ? 0.0
            : effectiveDue - parseFloat(data.partial_balance);
    }

    // PHP line 571-579: If unpaid toggle is set or payment_mode is empty, force Unpaid status
    if (!empty(data.unpaid) && String(data.unpaid) === 'true') {
      paymentStatus = 'Unpaid';
      paymentPending = effectiveDue;
    } else if (empty(data.payment_mode) || String(data.payment_mode).trim() === '') {
      paymentStatus = 'Unpaid';
      paymentPending = effectiveDue;
    }

    // Derive paid_amount and balance so Mongoose pre-save hook preserves PHP semantics
    let paidAmount = 0;
    let balance = 0;

    if (partialCheck) {
      // In PHP partial sale, customer has paid partialBalance and pending = paymentPending
      paidAmount = partialBalance;
      balance = paymentPending;
    } else {
      if (paymentStatus === 'Paid') {
        paidAmount = finalSaleTotAmount;
        balance = 0;
      } else if (paymentStatus === 'Unpaid') {
        paidAmount = 0;
        balance = finalSaleTotAmount;
      } else if (paymentStatus === 'Partialy Paid') {
        paidAmount = finalSaleTotAmount - paymentPending;
        balance = paymentPending;
      }
    }

    // KOT Logic
    // Preserve existing KOT status when editing
    let wasKotProceeded = data.was_kot_proceeded === true || data.was_kot_proceeded === 'true';
    if (!wasKotProceeded && existingSale && existingSale.was_kot_proceeded) {
      wasKotProceeded = existingSale.was_kot_proceeded;
    }

    let saleProcess = process;
    const saleMethod = data.sale_method || existingSale?.sale_method || 'Live-Order';

    // PHP Line 9956-9960: Table-Order automatically becomes KOT with Unpaid status
    if (saleMethod === 'Table-Order') {
      saleProcess = 'KOT';
      wasKotProceeded = true;
      // Override payment status for Table-Order
      paymentStatus = 'Unpaid';
      paymentPending = finalSaleTotAmount;
      paidAmount = 0;
      balance = finalSaleTotAmount;
    } else if (data.sale_process === 'KOT') {
      saleProcess = 'KOT';
    } else if (existingSale && existingSale.sale_process === 'KOT' && !data.sale_process) {
      // Preserve existing KOT status if not explicitly changed
      saleProcess = 'KOT';
    }

    // Customer
    // In Node we don't fetch and store full customer object redundantly usually, but PHP does.
    // We will stick to schema which has separate fields for customer_*
    const customer = data.customer_id ? await customerRepository.findById(data.customer_id) : null;

    // Insert block: mirror PHP $insertData field order as closely as possible.
    const insertData = {
      // PHP: branch_id, branch_name, printing_address, sales_id, wallet_amount,
      // created_date, created_by, created_by_id, license
      branch_id: branchId,
      branch_name: context.branchName || '',
      printing_address: context.printingAddress || '',
      sales_id: prefixId,
      billing_transaction_id: data.billing_transaction_id || undefined,
      wallet_amount: 0.0,
      created_date: mongo_date,
      // PHP stores username/email in created_by; mirror that while
      // keeping the ObjectId in created_by_id for internal usage.
      created_by: userName,
      created_by_id: userId,
      license: licenseId,

      // Node-only field (not present in PHP) appended after core PHP keys
      // branch field intentionally omitted to keep collection shape PHP-identical
    };

    // Top-level GST flag mirrors PHP: 'enable' when branch GST is on
    const gstFlag = context.branchSettings?.indian_gst === 'gst_on' ? 'enable' : 'disable';

    // Country sort: prefer incoming payload; otherwise, derive from branch
    // settings (sortname or country name) to mirror PHP behaviour.
    const normalizeCountrySort = (sortRaw, countryRaw) => {
      const direct = (sortRaw ?? '').toString().trim();
      if (direct) {
        return direct.toUpperCase();
      }

      const country = (countryRaw ?? '').toString().trim();
      if (!country) return '';

      const key = country.toLowerCase();
      const map = {
        india: 'IN',
        'united states': 'US',
        'united states of america': 'US',
        'united kingdom': 'GB',
        uae: 'AE',
        'united arab emirates': 'AE',
      };

      if (map[key]) {
        return map[key];
      }

      // Generic fallback: first two letters uppercased (e.g. "India" -> "IN").
      // Generic fallback: first two letters uppercased (e.g. "India" -> "IN").
      return key.length >= 2 ? key.substring(0, 2).toUpperCase() : key.toUpperCase();
    };

    const incomingCountrySort = (data.country_sort ?? '').toString().trim();
    const finalCountrySort = incomingCountrySort
      ? incomingCountrySort.toUpperCase()
      : normalizeCountrySort(
          context.branchSettings?.sortname,
          context.branchSettings?.country || data.customer_country
        );

    // Update block: mirror PHP $updateData field order and contents as much as possible.
    const updateData = {
      // Core PHP ordering
      date: mongo_date,
      sale_process: saleProcess,
      user_id: String(userId),
      user_name: userName,
      category_id: customer ? customer.category_id : '',
      category_name: customer ? customer.category_name : '',
      referrer_id: customer ? customer.referrer_id : '',
      referrer_name: customer ? customer.referrer_name : '',
      customer_id: new ObjectId(data.customer_id),
      customer_name: (data.customer_name || '').trim(),
      customer_address: (data.customer_address || '').trim(),
      customer_phone: (data.customer_phone || '').trim(),
      customer_email: (data.customer_email || '').trim(),
      customer_state: (data.customer_state || '').trim(),
      customer_country: (data.customer_country || '').trim(),
      country_sort: finalCountrySort,
      customer_gst_type: (data.customer_gst_type || '').trim(),
      customer_gst_number: (data.customer_gst_number || '').trim(),
      partial_check: partialCheck,
      partial_balance: partialBalance,
      payment_status: paymentStatus,
      payment_pending: paymentPending,
      payment_mode: (data.payment_mode || '').trim(),
      sales_description: (data.sales_description || '').trim(),
      payment_description: (data.payment_description || '').trim(),
      discount_description: (data.discount_description || '').trim(),
      // Use full precision values to mirror PHP's stored doubles
      sales_total: salesTotalForDoc,
      sales_round_off: roundOffForDoc,
      round_off: roundOffForDoc,
      sales_sub_total: sale_subtotal_amount,
      items_total: itemsTotalForDoc, // Mirrors PHP items_total
      items_return_total: 0.0,
      return_round_off: 0.0,
      items_subtotal: sale_subtotal_amount,
      items_return_subtotal: 0.0,
      total_companyprice: sale_company_amount,
      tax: sale_tax_amount,
      gst: gstFlag,
      return_tax: 0.0,
      discount: sale_discount_amount,
      return_discount: 0.0,
      updated_date: mongo_date,
      // PHP stores username/email in updated_by; mirror that while
      // keeping the ObjectId in updated_by_id.
      updated_by: userName,
      updated_by_id: userId,
      number_of_items: itemsale.length,
      items: itemsale,
      changes: existing_changes,
      items_return: [],
      cashregister_id: data.register_id || '',
      license: licenseId,
      sale_extra_discount: round2(salesExtraDiscount, 2),
      extra_discount_type: data.extra_discount_type,
      extra_discount: round2(extraDiscount, 2),
      loyalty_redeem_points: loyaltyRedeemPoints,
      loyalty_redeem_value: loyaltyRedeemValue,
      coupon_code: couponCode,
      coupon_discount_value: couponDiscountValue,
      // Tip captured at tender (standard POS tip line). Metadata beside the
      // bill: never part of sales_total, tax or drawer expectations (tip-jar
      // model); reported per employee via the labour report. An Edit that does
      // not send the field preserves the recorded tip.
      tip_amount:
        data.tip_amount !== undefined && data.tip_amount !== null
          ? Math.max(0, round2(parseFloat(data.tip_amount) || 0, 2))
          : existingSale?.tip_amount || 0,
      // Presence-gated: only an explicit tick ever sets it; edits keep it.
      tip_in_total:
        data.tip_in_total !== undefined
          ? String(data.tip_in_total) === 'true'
          : existingSale?.tip_in_total || false,
      // A sale born from a quote remembers its origin and whether the
      // quoted prices were honoured (QUOTED_PRICE_ON_CONVERT_DESIGN).
      // Presence-gated on create; an edit that does not resend them keeps
      // the recorded lineage, same rule as the tip fields above.
      ...(data.source_quote_id && ObjectId.isValid(String(data.source_quote_id))
        ? { source_quote_id: new ObjectId(String(data.source_quote_id)) }
        : existingSale?.source_quote_id
          ? { source_quote_id: existingSale.source_quote_id }
          : {}),
      ...(data.quote_price_honoured !== undefined
        ? { quote_price_honoured: String(data.quote_price_honoured) === 'true' }
        : existingSale?.quote_price_honoured !== undefined
          ? { quote_price_honoured: existingSale.quote_price_honoured }
          : {}),
      // Document-level charges (parcel, service, freight - owner spec):
      // stored as sent, capped and cleaned; an edit that does not resend
      // them keeps them, and a sale that HAS them stays editable even
      // when the shop toggle is off (common software practice).
      ...(Array.isArray(data.charges)
        ? {
            charges: data.charges.slice(0, 20).flatMap((c) => {
              const name = String((c && c.name) || '')
                .trim()
                .slice(0, 60);
              const amount = round2(parseFloat(c && c.amount) || 0, 2);
              if (!name || !(amount > 0)) return [];
              const taxed = !!(c && (c.taxed === true || c.taxed === 'true'));
              return [
                {
                  name,
                  amount,
                  taxed,
                  // Tax on the charge (queue #5): stored only while taxed,
                  // so a flag flipped off can never leave a stale figure.
                  tax_name: taxed
                    ? String((c && c.tax_name) || '')
                        .trim()
                        .slice(0, 40)
                    : '',
                  tax_amount: taxed ? round2(parseFloat(c && c.tax_amount) || 0, 2) : 0,
                  source: c && c.source === 'quote' ? 'quote' : 'manual',
                },
              ];
            }),
          }
        : existingSale?.charges
          ? { charges: existingSale.charges }
          : {}),

      // ...
      sale_method: saleMethod,
      was_kot_proceeded: wasKotProceeded,
      // Cash register / multi-payment mirrors.
      // cashregister_id is set above; it was written twice in this one object
      // literal, with the same value both times, so the duplicate changed
      // nothing and has been removed rather than reconciled.
      multi_payment:
        Array.isArray(data.multi_payment) ||
        (data.multi_payment && typeof data.multi_payment === 'object')
          ? data.multi_payment
          : [],
      // Dine/table metadata mirrors - preserve existing values for Edit
      table_id:
        data.table_id !== undefined && data.table_id !== null
          ? data.table_id
          : existingSale?.table_id || '',
      table_number:
        data.table_number !== undefined && data.table_number !== null
          ? String(data.table_number).trim()
          : existingSale?.table_number || '',
      dine_type:
        data.dine_type !== undefined && data.dine_type !== null
          ? String(data.dine_type).trim()
          : existingSale?.dine_type || 'Dine-in',
      person_count:
        data.person_count !== undefined && data.person_count !== null
          ? data.person_count
          : (existingSale?.person_count ?? ''),
      denomination_values: data.denomination_values ?? (existingSale?.denomination_values || []),
    };

    const finalSaleData = id === '' ? { ...insertData, ...updateData } : updateData;

    // Inventory Verification BEFORE Insert (PHP lines 653-690)
    if (id === '') {
      const insufficientItems = [];
      for (const item of items) {
        const doc = await itemRepository.findItemById(item.item_id);
        if (doc && doc.track_inventory && !doc.negative_stock) {
          if (doc.available_quantity < parseFloat(item.item_quantity)) {
            insufficientItems.push({
              item_id: String(doc._id),
              item_quantity: doc.available_quantity,
            });
          }
        }
      }
      if (insufficientItems.length > 0) {
        return {
          status: false,
          data: insufficientItems,
          message: 'Your sales item quantity is mismatched.',
        };
      }
    }

    // Reserve tracked stock atomically before creating the sale. A normal
    // read-then-update allows two counters to sell the same final quantity.
    const stockReservations = new Map();
    if (id === '') {
      const stockRequests = new Map();
      for (const item of items) {
        const doc = await itemRepository.findItemById(item.item_id);
        const qty = parseFloat(item.item_quantity);
        const isTracked = doc && (doc.track_inventory === true || doc.track_inventory === 'true');
        if (!isTracked || doc.negative_stock === true) continue;
        const key = String(doc._id);
        const request = stockRequests.get(key) || { doc, quantity: 0, itemName: '' };
        request.quantity += qty;
        request.itemName = request.itemName || item.item_name || doc.name || '';
        stockRequests.set(key, request);
      }

      for (const request of stockRequests.values()) {
        const reserved = await itemRepository.deductStockIfAvailable(
          request.doc._id,
          request.quantity
        );
        if (!reserved) {
          for (const reservation of stockReservations.values()) {
            await itemRepository.updateStock(reservation.itemId, reservation.quantity);
          }
          const latest = await itemRepository.findItemById(request.doc._id);
          return {
            status: false,
            data: [
              {
                item_id: String(request.doc._id),
                item_name: request.itemName,
                requested_quantity: request.quantity,
                item_quantity: Number(latest?.available_quantity || 0),
              },
            ],
            message:
              'Stock changed at another billing counter. Please refresh the item and try again.',
          };
        }
        stockReservations.set(String(request.doc._id), {
          itemId: request.doc._id,
          quantity: request.quantity,
          opening: Number(reserved.available_quantity) + request.quantity,
          closing: Number(reserved.available_quantity),
        });
      }
    }

    // --- DB OPERATIONS ---
    let result;
    if (id === '') {
      // ADD: create a new Sale document so that the pre-save hook can
      // normalize the payload into a PHP-style 1:1 document.
      try {
        // If the unique bill-number index catches a one-in-a-million clash,
        // take the next number and retry rather than fail the sale.
        result = await salesRepository.createSaleUnique(finalSaleData, async () => {
          const pv = context.salesPrefix || 'INV';
          const nn = await salesRepository.nextSalesNumberForBranch(branchId, licenseId);
          return salesRepository.buildDocNumber('S', branchId, nn, { fallbackPrefix: pv });
        });
      } catch (error) {
        for (const reservation of stockReservations.values()) {
          await itemRepository.updateStock(reservation.itemId, reservation.quantity);
        }
        throw error;
      }
    } else {
      // EDIT: load the existing document and apply the PHP-compatible
      // updateData via .save() so that the same pre-save hook used for
      // Add (including Live-Order item rewriting) also runs here.
      const doc = await salesRepository.getById(id);
      if (!doc) {
        return {
          status: false,
          data: null,
          message: 'Sale not found for update',
        };
      }
      doc.set(updateData);
      result = await salesRepository.save(doc);
    }

    const saleId = id === '' ? result._id : new ObjectId(id);
    // For new sales use generated prefixId; for edits, keep the existing sales_id if available
    const salePrefixedId =
      id === '' ? prefixId : existingSale && existingSale.sales_id ? existingSale.sales_id : '';

    /*
     * The sale is committed - tell the sync agent NOW, not on the 15s scan.
     * The marker is an event row (never deduplicated) and the agent's
     * critical lane pushes sales before the stock they changed, so the shop's
     * record that money was taken reaches the cloud in ~2s. Fire-safe both
     * halves: the sale is done whatever happens here, and in the cloud both
     * are no-ops (see sync/outbox.js isEnabled).
     */
    try {
      const { enqueue, REASONS } = require('../sync/outbox');
      enqueue({ collection: 'sales', documentId: saleId, reason: REASONS.SALE });
      require('../sync/nudge').nudgeSyncAgent();
    } catch (e) {
      /* accelerator only - the periodic scan still delivers */
    }

    // Update Stock & Logs (PHP lines 696-710 for Add, 753-778 for Edit)
    const stockLogsRepository = new StockLogsRepository();
    const stockLogStatus = context.stockLogStatus || true; // Default true

    if (id === '') {
      // ADD

      for (const item of items) {
        const doc = await itemRepository.findItemById(item.item_id);
        if (!doc) continue;

        const qty = parseFloat(item.item_quantity);
        const reservation = stockReservations.get(String(doc._id));
        const opening = reservation ? reservation.opening : doc.available_quantity;
        const newAvailable = reservation ? reservation.closing : opening - qty;
        const count = `-${qty}`;
        const isTracked = doc.track_inventory === true || doc.track_inventory === 'true';

        // Always update item stock for tracked items, even if branch
        // stock_management is disabled. The branch setting only controls
        // whether detailed stock logs are written.
        if (isTracked) {
          // Non-negative tracked stock was already reserved atomically above.
          // Negative-stock items retain the legacy unrestricted decrement.
          if (!reservation) await itemRepository.updateStock(doc._id, -qty);

          if (context.stockManagement) {
            const stockLogResult = await stockLogsRepository.createStockLog({
              stocklog: stockLogStatus,
              branch_id: branchId,
              view_item_id: doc._id,
              item_barcode_id: doc.barcode_id || '',
              item_quantity: qty,
              item_name: item.item_name || '',
              process: 'Add Sale',
              date: mongo_date,
              action: 'subtract',
              changed_by_userid: userId,
              opening_balance: opening,
              closing_balance: newAvailable,
              count: count,
              reference: prefixId,
              changed_by: userName || 'System',
            });

            if (!stockLogResult.status) {
              console.error('[SALES] Stock log creation failed:', stockLogResult.message);
            }
          }
        }
      }
    } else {
      // EDIT
      // PHP Logic: loop through new items, calculate diff against old items carried in logic?
      // Actually PHP loop says `foreach (($data['items']) as $items_update)`
      // And compares with `old_item_quantity`.
      // In Node we are reprocessing. Logic is complex.
      // Simplified approach for Edit:
      // Since we already calculated 'changes_items' which has the delta (add/cancel), we can use that?
      // PHP Lines 753: iterates input items again.
      // It calculates `quantity = oldQuantity - item_quantity`.
      // `available_quantity = quantity + opening_balance`.
      // Wait, `quantity` here diff.

      // Let's rely on `changes_items` we built.
      // If `process` is 'add' (qty increased), we subtract from stock.
      // If `process` is 'cancel' (qty decreased), we add to stock.

      for (const change of changes_items) {
        const doc = await itemRepository.findItemById(change.item_id);
        const isTracked = doc && (doc.track_inventory === true || doc.track_inventory === 'true');
        if (!isTracked) continue;

        const qtyChange = change.item_quantity;
        const opening = doc.available_quantity;
        let newAvailable = opening;
        let action = '';
        let count = '';

        if (change.process === 'add') {
          // Added more items -> Reduce Stock
          newAvailable = opening - qtyChange;
          action = 'Subtract';
          count = `-${qtyChange}`;
          // Apply the same numeric delta via repository
          await itemRepository.updateStock(doc._id, -qtyChange);
        } else {
          // Cancelled/Reduced items -> Increase Stock
          newAvailable = opening + qtyChange;
          action = 'Add';
          count = `+${qtyChange}`;
          await itemRepository.updateStock(doc._id, qtyChange);
        }

        if (context.stockManagement) {
          const stockLogResult = await stockLogsRepository.createStockLog({
            stocklog: stockLogStatus,
            branch_id: branchId,
            view_item_id: doc._id,
            item_barcode_id: doc.barcode_id || '',
            item_quantity: qtyChange,
            item_name: change.item_name || '',
            process: 'Edit Sale',
            date: mongo_date,
            action: action,
            changed_by_userid: userId,
            opening_balance: opening,
            closing_balance: newAvailable,
            count: count,
            reference: data.alternative_id || existingSale.sales_id || id,
            changed_by: userName || 'System',
          });

          if (!stockLogResult.status) {
            console.error('[SALES] Edit Sale stock log creation failed:', stockLogResult.message);
          }
        }
      }
    }
    // Update Register (PHP lines 713 (Add), 781 (Edit))
    if (data.register_id) {
      const registerData = {
        // Internal Mongo ObjectId reference for cleanup / linkage
        sales_id: saleId,
        // Human-readable sale number for UI (e.g. SDS000123)
        sale_no: salePrefixedId,
        date: mongo_date,
        register_amount: parseFloat(finalSaleTotAmount),
        register_discount: parseFloat(sale_discount_amount),
        register_tax: parseFloat(sale_tax_amount),
        registerItems_return_total: 0.0,
        register_paymentmode: data.payment_mode,
        multi_payment: data.multi_payment || [],
      };

      if (id === '') {
        // ADD: push new register_sales entry
        await registerRepository.addSaleRegisterEntry({
          registerId: data.register_id,
          licenseId,
          registerData,
        });
      } else {
        // EDIT: update existing register_sales entry for this sale
        await registerRepository.updateSaleRegisterEntry({
          saleId: id,
          licenseId,
          registerData,
        });
      }
    }

    // Handle Partial Payment Transaction (PHP lines 822-876, 877-934)
    // Create/Update transaction collection record for partial payment customers
    if (partialCheck && String(partialCheck) === 'true') {
      const db = await BaseModel.getDb();
      const transactionCollection = db.collection('transaction');

      // Common transaction data (PHP $commonTransactionData)
      const commonTransactionData = {
        updated_date: mongo_date,
        customer_id: new ObjectId(data.customer_id),
        customer_name: (data.customer_name || '').trim(),
        transaction_image: 'category.svg',
        license: licenseId,
        branch_id: branchId,
      };

      if (id === '') {
        // ADD: Insert new transaction record (PHP lines 822-876)
        let transactionInsertData = {};
        const walletCheck = data.wallet_check === 'true' || data.wallet_check === true;
        const customerCurrentBalance = parseFloat(data.customer_current_balance || 0);

        if (walletCheck && customerCurrentBalance >= finalSaleTotAmount) {
          // Customer wallet covers full sale amount
          transactionInsertData = {
            sale_id: saleId,
            amount: finalSaleTotAmount,
            type: 'out',
            pending: finalSaleTotAmount - partialBalance,
            sale_total: finalSaleTotAmount,
            description: 'Add sale wallet',
          };

          // Update sale wallet_amount
          await salesRepository.updateWalletAmount(saleId, finalSaleTotAmount);
        } else if (walletCheck && customerCurrentBalance < finalSaleTotAmount) {
          // Customer wallet partially covers sale amount
          transactionInsertData = {
            sale_id: saleId,
            amount: customerCurrentBalance,
            type: 'out',
            pending: finalSaleTotAmount - partialBalance,
            sale_total: finalSaleTotAmount,
            description: 'Add sale',
          };

          // Update sale wallet_amount
          await salesRepository.updateWalletAmount(saleId, customerCurrentBalance);
        } else {
          // No wallet usage
          transactionInsertData = {
            sale_id: saleId,
            amount: 0.0,
            type: 'out',
            pending: finalSaleTotAmount - partialBalance,
            sale_total: finalSaleTotAmount,
            description: 'Add sale',
          };
        }

        const transactionCollectionData = { ...commonTransactionData, ...transactionInsertData };
        await transactionCollection.insertOne(transactionCollectionData);

        console.log('[SALES TRANSACTION] Created transaction record for partial payment:', {
          sale_id: saleId,
          customer_id: data.customer_id,
          amount: transactionInsertData.amount,
          pending: transactionInsertData.pending,
        });
      } else {
        // EDIT: Update existing transaction record (PHP lines 877-934)
        const existingTransaction = await transactionCollection.findOne({
          sale_id: saleId,
        });

        const walletCheck = data.wallet_check === 'true' || data.wallet_check === true;
        const customerCurrentBalance = parseFloat(data.customer_current_balance || 0);

        if (walletCheck && customerCurrentBalance >= finalSaleTotAmount) {
          // Customer wallet covers full sale amount
          await transactionCollection.updateOne(
            {
              sale_id: saleId,
              customer_id: new ObjectId(data.customer_id),
            },
            {
              $set: {
                amount: finalSaleTotAmount,
                type: 'out',
                updated_date: mongo_date,
                pending: finalSaleTotAmount - partialBalance,
                sale_total: finalSaleTotAmount,
                description: 'Edit sale',
              },
            }
          );

          await salesRepository.updateWalletAmount(saleId, finalSaleTotAmount);
        } else if (walletCheck && customerCurrentBalance < finalSaleTotAmount) {
          // Customer wallet partially covers sale amount
          await transactionCollection.updateOne(
            {
              sale_id: saleId,
              customer_id: new ObjectId(data.customer_id),
            },
            {
              $set: {
                amount: customerCurrentBalance,
                type: 'out',
                updated_date: mongo_date,
                pending: finalSaleTotAmount - partialBalance,
                sale_total: finalSaleTotAmount,
                description: 'Edit sale',
              },
            }
          );

          await salesRepository.updateWalletAmount(saleId, customerCurrentBalance);
        } else {
          // No wallet usage
          await transactionCollection.updateOne(
            {
              sale_id: saleId,
              customer_id: new ObjectId(data.customer_id),
            },
            {
              $set: {
                amount: 0.0,
                type: 'out',
                updated_date: mongo_date,
                pending: finalSaleTotAmount - partialBalance,
                sale_total: finalSaleTotAmount,
                description: 'Edit sale',
              },
            }
          );
        }

        console.log('[SALES TRANSACTION] Updated transaction record for partial payment:', {
          sale_id: saleId,
          customer_id: data.customer_id,
        });
      }
    }

    return {
      status: true,
      data: {
        _id: saleId,
        sales_id: saleId,
        sale_number: salePrefixedId,
        sms: context.branchSettings?.sales_sms || false,
        whatsapp: context.branchSettings?.whatsapp_receipt || false,
        print: context.branchSettings?.printall || false,
        mail: context.branchSettings?.sales_mail || false,
        waring: 'success', // Matches PHP misspelled field name
        name: (data.customer_name || '').trim(),
        phone: (data.customer_phone || '').trim(),
        customer_balance: customer ? customer.balance || 0 : 0,
        country_sort: context.branchSettings?.sortname || 'in',
      },
      message: 'Sale saved successfully',
    };
  } catch (error) {
    console.error('processSale Error:', error);
    return { status: false, message: error.message, data: null };
  }
};

const getTablesWithActiveOrders = async (branchId) => {
  try {
    if (!branchId) {
      return { status: false, message: 'Branch ID is required', data: [] };
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Matches PHP getTablesWithActiveOrdersModel logic
    // PHP: branch_id, sale_process='KOT', payment_status='Unpaid'
    // It uses aggregate to group by table_number and dine_type.

    let branchObjectId;
    try {
      if (branchId instanceof mongoose.Types.ObjectId) {
        branchObjectId = branchId;
      } else {
        branchObjectId = new ObjectId(String(branchId));
      }
    } catch (e) {
      console.error('Invalid branchId for ObjectId:', branchId);
      return { status: false, message: 'Invalid Branch ID format', data: [] };
    }

    const pipeline = [
      {
        $match: {
          branch_id: branchObjectId,
          sale_process: 'KOT',
          payment_status: 'Unpaid',
        },
      },
      {
        $group: {
          _id: {
            table_number: '$table_number',
            dine_type: '$dine_type',
          },
        },
      },
      {
        $project: {
          _id: 0,
          table_number: '$_id.table_number',
          dine_type: '$_id.dine_type',
        },
      },
    ];

    const results = await salesRepository.aggregate(pipeline);

    const tables = [];
    let hasTakeaway = false;

    results.forEach((res) => {
      const dType = res.dine_type || '';
      const tNum = res.table_number || '';

      if (dType === 'Take away' || dType === 'Takeaway') {
        hasTakeaway = true;
      } else if (tNum !== '') {
        tables.push(tNum);
      }
    });

    // Unique & Sort (Natural sort like PHP natsort)
    const uniqueTables = [...new Set(tables)];
    uniqueTables.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    return {
      status: true,
      data: {
        tables: uniqueTables,
        has_takeaway: hasTakeaway,
      },
      message: 'Tables with active orders loaded',
    };
  } catch (error) {
    console.error('getTablesWithActiveOrders Error:', error);
    return { status: false, message: error.message, data: [] };
  }
};

/**
 * Fetch a single sale document by id using the provided model or the
 * default Sale model. This keeps controllers from calling the model
 * layer directly while preserving existing behaviour.
 *
 * @param {string|ObjectId} id
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<mongoose.Document|null>}
 */
const getSaleById = async (id, { SaleModel } = {}) => {
  if (!id) return null;
  // Delegate to repository so that all DB access for Sale documents
  // goes through a single abstraction layer.
  return salesRepository.getById(id, { SaleModel: getModel(SaleModel) });
};

/**
 * Update the status field for a sale document.
 * Throws NotFoundError / BadRequestError for invalid state transitions.
 *
 * @param {{ id: string|ObjectId, status: string }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<mongoose.Document>}
 */
const updateSaleStatus = async ({ id, status }, { SaleModel } = {}) => {
  const sale = await salesRepository.getById(id, {
    SaleModel: getModel(SaleModel),
  });
  if (!sale) {
    throw new NotFoundError('Sale not found');
  }

  if (sale.status === SALE_STATUS.CANCELLED) {
    throw new BadRequestError('Cannot update a cancelled sale');
  }

  sale.status = status;
  await salesRepository.save(sale);

  return sale;
};

/**
 * Append a payment to a sale and update payment-related fields.
 * Throws NotFoundError / BadRequestError if the sale is missing or
 * already fully paid.
 *
 * @param {{ id: string|ObjectId, amount: number|string, method: string, reference?: string, notes?: string }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<mongoose.Document>}
 */
const processSalePayment = async ({ id, amount, method, reference, notes }, { SaleModel } = {}) => {
  const sale = await salesRepository.getById(id, {
    SaleModel: getModel(SaleModel),
  });
  if (!sale) {
    throw new NotFoundError('Sale not found');
  }

  if (sale.payment_status === PAYMENT_STATUS.PAID) {
    throw new BadRequestError('Sale is already paid in full');
  }

  const payment = {
    amount: parseFloat(amount),
    method,
    reference,
    notes,
  };

  sale.payments.push(payment);
  sale.paid_amount = (sale.paid_amount || 0) + payment.amount;
  sale.balance = sale.total - sale.paid_amount;
  sale.payment_status = sale.balance <= 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIAL;

  await salesRepository.save(sale);

  return sale;
};

/**
 * Aggregate a high-level sales summary for a single branch over an
 * optional date range. Mirrors the logic previously in
 * sales.controller#getSummary to preserve behaviour.
 *
 * @param {{ branchId: any, startDate?: string, endDate?: string }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<Object>} summary document
 */
const getSalesSummary = async ({ branchId, startDate, endDate }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);

  const match = {
    status: SALE_STATUS.COMPLETED,
    branch: branchId,
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  const summary = await salesRepository.aggregate(
    [
      { $match: match },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalAmount: { $sum: '$total' },
          totalPaid: { $sum: '$paid_amount' },
          totalBalance: { $sum: '$balance' },
          byPaymentMethod: { $push: '$payments.method' },
        },
      },
      {
        $project: {
          _id: 0,
          totalSales: 1,
          totalAmount: 1,
          totalPaid: 1,
          totalBalance: 1,
          // Flatten nested payment method arrays into a single array
          paymentMethods: {
            $reduce: {
              input: '$byPaymentMethod',
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] },
            },
          },
        },
      },
    ],
    { SaleModel: Model }
  );

  const defaultSummary = {
    totalSales: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalBalance: 0,
    paymentMethods: { count: 0, methods: {} },
  };

  if (!Array.isArray(summary) || summary.length === 0) {
    return defaultSummary;
  }

  return summary[0] || defaultSummary;
};

/**
 * Aggregate sales by product for a single branch over an optional
 * date range. Mirrors the logic previously in
 * sales.controller#getSalesByProduct.
 *
 * @param {{ branchId: any, startDate?: string, endDate?: string }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<Array>} list of product-level aggregates
 */
const getSalesByProduct = async ({ branchId, startDate, endDate }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);

  const match = {
    status: SALE_STATUS.COMPLETED,
    branch: branchId,
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      match.createdAt.$lte = end;
    }
  }

  const salesByProduct = await salesRepository.aggregate(
    [
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.item',
          name: { $first: '$items.name' },
          sku: { $first: '$items.sku' },
          quantitySold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.total' },
        },
      },
      { $sort: { quantitySold: -1 } },
    ],
    { SaleModel: Model }
  );

  return salesByProduct;
};

/**
 * Fetch the latest 6 sales for a branch, mirroring the legacy
 * getLatestSales controller behaviour but keeping DB access in
 * the service/repository layers.
 *
 * @param {{ branchId: any, licenseId?: any }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<Array>} list of simplified latest sale rows
 */
const getLatestSales = async ({ branchId, licenseId, holdOnly }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);

  const branchMatch = [];
  if (branchId) {
    let normalized = null;
    if (branchId instanceof mongoose.Types.ObjectId) {
      normalized = branchId;
    } else if (mongoose.Types.ObjectId.isValid(String(branchId))) {
      normalized = new mongoose.Types.ObjectId(String(branchId));
    }

    if (normalized) {
      branchMatch.push({ branch_id: normalized });
      branchMatch.push({ branch: normalized });
    }
  }

  const baseFilter = {
    // Include 'Hold' so parked sales surface in the New Sale "Recent Sales" tab
    // for one-click retrieval, without leaving the billing screen.
    // The Parked tab asks for holds alone and gets a longer list.
    sale_process: holdOnly ? { $in: ['Hold'] } : { $in: ['Add', 'Edit', 'Hold'] },
  };

  if (branchMatch.length) {
    baseFilter.$or = branchMatch;
  }

  if (licenseId) {
    baseFilter.license = licenseId;
  }

  const pipeline = [{ $match: baseFilter }, { $sort: { _id: -1 } }, { $limit: holdOnly ? 20 : 6 }];

  const sales = await salesRepository.aggregate(pipeline, { SaleModel: Model });

  const latestSales = sales.map((sale) => {
    const numberOfItems =
      typeof sale.number_of_items === 'number'
        ? sale.number_of_items
        : Array.isArray(sale.items)
          ? sale.items.length
          : 0;

    return {
      sales_document_id: sale._id?.toString?.() || '',
      sales_id: sale.sales_id || sale.invoice_number || '',
      customer_name: sale.customer_name || '',
      sale_process: sale.sale_process || 'Add',
      number_of_items: numberOfItems,
      total_amount:
        typeof sale.sales_total === 'number'
          ? sale.sales_total
          : Number(sale.sales_total || sale.total || 0) || 0,
      payment_status: sale.payment_status || 'Paid',
      /* When this was parked, so the Parked tab can say how long it has been
         waiting. updated first: re-holding a sale touches it, and "waiting
         since the last time anyone looked at it" is the useful figure. */
      parked_at: sale.updated_date || sale.updatedAt || sale.date || sale.created_date || null,
    };
  });

  return latestSales;
};

/**
 * Core data fetch for daily sales reports. This helper runs the same
 * MongoDB queries that dailySalesReports used previously in the
 * controller, so that controllers no longer talk to the Sale model
 * directly.
 *
 * @param {{ match: Object, cancellationMatch: Object }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<{productAgg: Array, paymentAgg: Array, salesPayments: Array, taxAgg: Array, cancellationAgg: Array}>}
 */
const getDailySalesReportAggregates = async ({ match, cancellationMatch }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);

  const productPipeline = [
    { $match: match },
    { $unwind: '$items' },
    {
      $addFields: {
        // Support both field name formats
        'items.name': { $ifNull: ['$items.name', '$items.item_name'] },
        'items.sku': { $ifNull: ['$items.sku', '$items.item_sku'] },
        'items.quantity': { $ifNull: ['$items.quantity', '$items.item_quantity'] },
        'items.unit_price': { $ifNull: ['$items.unit_price', '$items.item_price'] },
        'items.total': { $ifNull: ['$items.total', '$items.total_amount'] },
        'items.tax_rate': { $ifNull: ['$items.tax_rate', '$items.tax'] },
        'items.discount': { $ifNull: ['$items.discount', '$items.item_discount'] },
        'items.company_price': { $ifNull: ['$items.company_price', 0] },
        'items.tax_amount': { $ifNull: ['$items.tax_amount', 0] },
      },
    },
    {
      $group: {
        _id: {
          name: '$items.name',
          sku: '$items.sku',
          tax_rate: '$items.tax_rate',
        },
        totalQty: {
          $sum: {
            $toDouble: { $ifNull: ['$items.quantity', 0] },
          },
        },
        totalAmount: {
          $sum: {
            $toDouble: { $ifNull: ['$items.total', 0] },
          },
        },
        subtotal: {
          $sum: {
            $subtract: [
              { $toDouble: { $ifNull: ['$items.total', 0] } },
              { $toDouble: { $ifNull: ['$items.tax_amount', 0] } },
            ],
          },
        },
        totalCompanyPrice: {
          $sum: {
            $multiply: [
              { $toDouble: { $ifNull: ['$items.quantity', 0] } },
              { $toDouble: { $ifNull: ['$items.company_price', 0] } },
            ],
          },
        },
        totalTax: {
          $sum: {
            $toDouble: { $ifNull: ['$items.tax_amount', 0] },
          },
        },
        totalDiscount: {
          $sum: {
            $toDouble: { $ifNull: ['$items.discount', 0] },
          },
        },
      },
    },
    { $sort: { totalQty: -1, totalAmount: -1 } },
  ];

  const paymentPipeline = buildDailyPaymentAggregationPipeline(match);

  const taxPipeline = [
    { $match: match },
    { $unwind: '$items' },
    {
      $addFields: {
        'items.tax_amount': { $ifNull: ['$items.tax_amount', 0] },
        'items.tax_rate': { $ifNull: ['$items.tax_rate', '$items.tax'] },
        'items.tax_name': { $ifNull: ['$items.tax_name', ''] },
        'items.tax_type': { $ifNull: ['$items.tax_type', 'inclusive'] },
      },
    },
    {
      $match: {
        'items.tax_amount': { $gt: 0 },
      },
    },
    {
      $group: {
        _id: {
          tax_rate: '$items.tax_rate',
          tax_name: '$items.tax_name',
          tax_type: '$items.tax_type',
        },
        tax_amount: {
          $sum: {
            $toDouble: { $ifNull: ['$items.tax_amount', 0] },
          },
        },
      },
    },
    { $sort: { tax_amount: -1 } },
  ];

  const cancellationPipeline = [
    { $match: cancellationMatch },
    { $unwind: '$changes' },
    { $unwind: '$changes.items' },
    {
      $match: {
        'changes.items.process': 'cancel',
      },
    },
    {
      $group: {
        _id: {
          table_number: { $ifNull: ['$table_number', ''] },
          item_name: { $ifNull: ['$changes.items.item_name', ''] },
        },
        cancel_count: {
          $sum: {
            $toDouble: { $ifNull: ['$changes.items.item_quantity', 0] },
          },
        },
        cancel_amount: {
          $sum: {
            $toDouble: { $ifNull: ['$changes.items.total', 0] },
          },
        },
      },
    },
    {
      $match: {
        '_id.table_number': { $ne: '' },
      },
    },
    { $sort: { cancel_amount: -1 } },
  ];

  const [productAgg, paymentAgg, salesPayments, taxAgg, cancellationAgg] = await Promise.all([
    salesRepository.aggregate(productPipeline, { SaleModel: Model }),
    salesRepository.aggregate(paymentPipeline, { SaleModel: Model }),
    salesRepository.find(
      match,
      'dine_type table_id table_number person_count extra_discount sale_extra_discount extra_discount_type items total sales_total',
      { SaleModel: Model }
    ),
    salesRepository.aggregate(taxPipeline, { SaleModel: Model }),
    salesRepository.aggregate(cancellationPipeline, { SaleModel: Model }),
  ]);

  return { productAgg, paymentAgg, salesPayments, taxAgg, cancellationAgg };
};

/**
 * Aggregation helper for the PDF variant of the daily sales report.
 * Mirrors the pipelines previously in sales.controller#dailyReportPdf
 * while keeping controllers free of direct model access.
 *
 * @param {{ match: Object }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<{ productAgg: Array, paymentAgg: Array, taxAgg: Array }>}
 */
const getDailyReportPdfAggregates = async ({ match }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);

  const productAgg = await salesRepository.aggregate(
    [
      { $match: match },
      { $unwind: '$items' },
      {
        $addFields: {
          'items.name': { $ifNull: ['$items.name', '$items.item_name'] },
          'items.sku': { $ifNull: ['$items.sku', '$items.item_sku'] },
          'items.quantity': { $ifNull: ['$items.quantity', '$items.item_quantity'] },
          'items.unit_price': { $ifNull: ['$items.unit_price', '$items.item_price'] },
          'items.total': { $ifNull: ['$items.total', '$items.total_amount'] },
          'items.discount': { $ifNull: ['$items.discount', '$items.item_discount'] },
        },
      },
      {
        $group: {
          _id: {
            name: '$items.name',
            sku: '$items.sku',
          },
          totalQty: {
            $sum: { $toDouble: { $ifNull: ['$items.quantity', 0] } },
          },
          totalAmount: {
            $sum: { $toDouble: { $ifNull: ['$items.total', 0] } },
          },
          unitPrice: {
            $first: { $toDouble: { $ifNull: ['$items.unit_price', 0] } },
          },
          totalDiscount: {
            $sum: { $toDouble: { $ifNull: ['$items.discount', 0] } },
          },
          totalTax: {
            $sum: { $toDouble: { $ifNull: ['$items.tax_amount', 0] } },
          },
        },
      },
      { $sort: { totalQty: -1 } },
    ],
    { SaleModel: Model }
  );

  const paymentAgg = await salesRepository.aggregate(buildDailyPaymentAggregationPipeline(match), {
    SaleModel: Model,
  });

  const taxAgg = await salesRepository.aggregate(
    [
      { $match: match },
      { $unwind: '$items' },
      {
        $addFields: {
          'items.tax_amount': { $ifNull: ['$items.tax_amount', 0] },
          'items.tax_rate': { $ifNull: ['$items.tax_rate', '$items.tax'] },
          'items.tax_name': { $ifNull: ['$items.tax_name', ''] },
        },
      },
      {
        $match: {
          'items.tax_amount': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: {
            tax_rate: '$items.tax_rate',
            tax_name: '$items.tax_name',
          },
          tax_amount: {
            $sum: {
              $toDouble: { $ifNull: ['$items.tax_amount', 0] },
            },
          },
        },
      },
      { $sort: { tax_amount: -1 } },
    ],
    { SaleModel: Model }
  );

  // Aggregate extra discount for PDF (mirrors dailySalesReports logic)
  const salesPayments = await salesRepository.find(
    match,
    'extra_discount sale_extra_discount extra_discount_type',
    { SaleModel: Model }
  );

  let totalExtraDiscount = 0;
  let totalSaleExtraDiscount = 0;
  const discountByType = new Map();

  salesPayments.forEach((saleDoc) => {
    const extraDiscount = Number(saleDoc.extra_discount) || 0;
    const saleExtraDiscount = Number(saleDoc.sale_extra_discount) || 0;
    const discountType = saleDoc.extra_discount_type || 'price';

    if (extraDiscount > 0 || saleExtraDiscount > 0) {
      totalExtraDiscount += extraDiscount;
      totalSaleExtraDiscount += saleExtraDiscount;

      const existing = discountByType.get(discountType) || {
        type: discountType,
        extra_discount_total: 0,
        sale_extra_discount_total: 0,
        count_sales: 0,
      };

      existing.extra_discount_total += extraDiscount;
      existing.sale_extra_discount_total += saleExtraDiscount;
      existing.count_sales += 1;

      discountByType.set(discountType, existing);
    }
  });

  const extraDiscountByType = Array.from(discountByType.values()).map((data) => ({
    type: data.type,
    extra_discount_total: round2(data.extra_discount_total),
    sale_extra_discount_total: round2(data.sale_extra_discount_total),
    count_sales: data.count_sales,
  }));

  const extraDiscountSummary = {
    total_extra_discount: round2(totalExtraDiscount),
    total_sale_extra_discount: round2(totalSaleExtraDiscount),
    by_type: extraDiscountByType,
  };

  return { productAgg, paymentAgg, taxAgg, extraDiscountSummary };
};

/**
 * Aggregation helper for the graphical sales report.
 * Mirrors the pipelines and debug queries previously in
 * sales.controller#salesGraphicalReports while keeping controllers
 * free of direct model access.
 *
 * @param {{ match: Object, validBranchIds: Array }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<Array>} chart data for the graphical report
 */
const getSalesGraphicalReportData = async ({ match, validBranchIds }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);
  let timezone = process.env.DEFAULT_TIMEZONE || 'UTC';
  if (Array.isArray(validBranchIds) && validBranchIds.length === 1) {
    try {
      const branchDoc = await branchesRepository.findById(validBranchIds[0], {
        select: 'time_zone',
        lean: true,
      });
      if (branchDoc?.time_zone) {
        timezone = branchDoc.time_zone;
      }
    } catch (error) {
      console.warn('getSalesGraphicalReportData: Branch lookup failed', error);
    }
  }

  const normalizedItemTotalExpr = toNumberExpression({
    $ifNull: ['$items.total', { $ifNull: ['$items.total_amount', 0] }],
  });
  const normalizedQuantityExpr = toNumberExpression({
    $ifNull: ['$items.quantity', { $ifNull: ['$items.item_quantity', 0] }],
  });
  const normalizedUnitCompanyPriceExpr = toNumberExpression({
    $ifNull: ['$items.company_price', { $ifNull: ['$item_info.company_price', 0] }],
  });
  const normalizedCompanyPriceExpr = {
    $cond: [
      {
        $and: [
          { $ne: ['$items.company_price_total', null] },
          { $ne: ['$items.company_price_total', ''] },
        ],
      },
      toNumberExpression('$items.company_price_total'),
      {
        $multiply: [normalizedQuantityExpr, normalizedUnitCompanyPriceExpr],
      },
    ],
  };

  const pipeline = [
    { $match: match },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'items',
        localField: 'items.item',
        foreignField: '_id',
        as: 'item_info',
      },
    },
    {
      $unwind: {
        path: '$item_info',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $set: {
        normalizedDate: {
          $ifNull: ['$date', { $ifNull: ['$updatedAt', '$createdAt'] }],
        },
        normalizedItemTotal: normalizedItemTotalExpr,
        normalizedCompanyPrice: normalizedCompanyPriceExpr,
      },
    },
    {
      $match: { normalizedDate: { $ne: null } },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$normalizedDate',
            timezone,
          },
        },
        totalSales: { $sum: '$normalizedItemTotal' },
        averageSale: { $avg: '$normalizedItemTotal' },
        totalTax: { $sum: { $ifNull: ['$items.tax', 0] } },
        totalCompanyPrice: { $sum: '$normalizedCompanyPrice' },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        date: '$_id',
        sales: { $round: ['$totalSales', 2] },
        avg: { $round: ['$averageSale', 2] },
        profit: {
          $round: [
            {
              $subtract: [
                { $subtract: ['$totalSales', '$totalTax'] }, // Net sales (sales - tax)
                '$totalCompanyPrice', // Subtract COGS
              ],
            },
            2,
          ],
        },
      },
    },
  ];

  const chartData = await salesRepository.aggregate(pipeline, {
    SaleModel: Model,
  });
  return chartData;
};

/**
 * Aggregation helper for legacy /sales/salesSummaryReports.
 * Runs the same diagnostics and aggregation pipelines that
 * sales.controller#salesSummaryReports previously executed,
 * and returns the final shaped summary object.
 *
 * @param {{ match: Object, branchObjectIds: Array }} params
 * @param {Object} options
 * @param {mongoose.Model} [options.SaleModel]
 * @returns {Promise<Object>} summary result
 */
const getSalesSummaryReportsData = async ({ match, branchObjectIds }, { SaleModel } = {}) => {
  const Model = getModel(SaleModel);
  const salesAgg = await salesRepository.aggregate(
    [
      { $match: match },
      {
        $group: {
          _id: null,
          sales_include_tax: {
            $sum: {
              $toDouble: {
                $ifNull: ['$sales_total', { $ifNull: ['$total', 0] }],
              },
            },
          },
          total_tax: {
            $sum: {
              $toDouble: {
                $ifNull: ['$tax', { $ifNull: ['$sales_tax', 0] }],
              },
            },
          },
          total_discount: {
            $sum: {
              $toDouble: {
                $ifNull: ['$discount', { $ifNull: ['$sales_discount', 0] }],
              },
            },
          },
          total_cogs: {
            $sum: {
              $toDouble: {
                $ifNull: ['$total_companyprice', { $ifNull: ['$sales_total_company_price', 0] }],
              },
            },
          },
          refunds: {
            $sum: {
              $toDouble: {
                $ifNull: ['$items_return_total', { $ifNull: ['$return_total', 0] }],
              },
            },
          },
          sale_count: { $sum: 1 },
        },
      },
    ],
    { SaleModel: Model }
  );

  // Aggregate order type summary (dine_type)
  const orderTypeAgg = await salesRepository.aggregate(
    [
      { $match: match },
      {
        $group: {
          _id: '$dine_type',
          total_sales: {
            $sum: {
              $toDouble: {
                $ifNull: ['$sales_total', { $ifNull: ['$total', 0] }],
              },
            },
          },
          sale_count: { $sum: 1 },
        },
      },
      { $sort: { total_sales: -1 } },
    ],
    { SaleModel: Model }
  );

  const summary =
    salesAgg.length > 0
      ? salesAgg[0]
      : {
          sales_include_tax: 0,
          total_tax: 0,
          total_discount: 0,
          total_cogs: 0,
          refunds: 0,
          sale_count: 0,
        };

  const sales_include_tax = summary.sales_include_tax || 0;
  const total_tax = summary.total_tax || 0;
  const sales_exclude_tax = sales_include_tax - total_tax;
  const discounts = summary.total_discount || 0;
  const refunds = summary.refunds || 0;

  // Net Sales = Sales (Exclude Tax) − Discounts − Refunds
  const net_sales = sales_exclude_tax - discounts - refunds;

  // COGS is already aggregated as Σ(Qty Sold × Cost Price) into total_companyprice
  const cogs = summary.total_cogs || 0;

  // Profit (Gross Profit) = Net Sales − COGS
  const gross_profit = net_sales - cogs;

  const order_type_summary = orderTypeAgg.map((item) => ({
    dine_type: item._id || 'Unknown',
    total_sales: round2(item.total_sales || 0),
    sale_count: item.sale_count || 0,
  }));

  return {
    sales_include_tax: round2(sales_include_tax),
    sales_exclude_tax: round2(sales_exclude_tax),
    net_sales: round2(net_sales),
    net_sales_tax: round2(total_tax),
    discounts: round2(discounts),
    gross_profit: round2(gross_profit),
    refunds: round2(refunds),
    cogs: round2(cogs),
    order_type_summary,
  };
};

module.exports = {
  processSale,
  getTablesWithActiveOrders,
  enrichSaleContext,
  getSaleById,
  updateSaleStatus,
  processSalePayment,
  getSalesSummary,
  getSalesByProduct,
  getLatestSales,
  getBranchById,
  getDailySalesReportAggregates,
  getDailyReportPdfAggregates,
  getSalesGraphicalReportData,
  getSalesSummaryReportsData,
  getSalesReportsData: async ({ match, page, limit, branch }, { SaleModel } = {}) => {
    const Model = getModel(SaleModel);

    /*
     * How this shop reads dates, and what clock its day runs on.
     *
     * Passed in rather than looked up here, because the caller already has the
     * branch and a service that fetches its own settings is a service that does
     * it once per row. With no branch given this falls back to the documented
     * defaults rather than to whatever the server happens to be set to.
     */
    const display = require('../utils/date-preference').dateDisplay(branch);

    const pipeline = [
      { $match: match },
      {
        $facet: {
          metadata: [
            { $count: 'total' },
            {
              $addFields: {
                current_page: page,
                per_page: limit,
                total_pages: {
                  $ceil: {
                    $divide: ['$total', limit],
                  },
                },
              },
            },
          ],
          data: [
            { $sort: { updated_date: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $addFields: {
                dateValue: { $ifNull: ['$date', '$updated_date'] },
              },
            },
            {
              /*
               * The date as this shop asked to see it.
               *
               * This printed month-first whatever the setting said, so a report
               * dated 08/03/2026 in a Goa shop read as 8 March and meant 3
               * August - five months out, on a document used for accounting and
               * for settling arguments with customers. The timezone was fixed
               * too, which is worse: it decides which day a 9:30pm sale lands
               * on, and getting it wrong moves the last hours of trade onto
               * tomorrow's sheet.
               */
              $addFields: {
                string_date: {
                  $dateToString: {
                    format: display.format,
                    date: '$dateValue',
                    timezone: display.timezone,
                  },
                },
              },
            },
            {
              $project: {
                _id: 1,
                sales_id: 1,
                customer_name: 1,
                customer_phone: 1,
                items_total: 1,
                extra_discount: 1,
                number_of_items: 1,
                updated_date: 1,
                string_date: 1,
                items: 1,
                tax: 1,
                discount: 1,
              },
            },
          ],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
          current_page: {
            $ifNull: [{ $arrayElemAt: ['$metadata.current_page', 0] }, page],
          },
          per_page: {
            $ifNull: [{ $arrayElemAt: ['$metadata.per_page', 0] }, limit],
          },
          total_pages: {
            $ifNull: [{ $arrayElemAt: ['$metadata.total_pages', 0] }, 0],
          },
          list: '$data',
        },
      },
    ];

    const [result] = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });

    return (
      result || {
        list: [],
        total: 0,
        current_page: page,
        per_page: limit,
        total_pages: 0,
      }
    );
  },
  getInstantSalesReportsData: async ({ match, page, limit }, { SaleModel } = {}) => {
    const Model = getModel(SaleModel);
    const skip = (page - 1) * limit;

    const itemsPipeline = [
      { $match: match },
      { $unwind: '$items' },
      { $match: { 'items.item_status': 'instant' } },
      { $sort: { date: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          sales_id: 1,
          date: 1,
          string_date: 1,
          customer_name: 1,
          user_name: 1,
          item_name: '$items.item_name',
          item_quantity: '$items.item_quantity',
          total_amount: '$items.total_amount',
          item_status: '$items.item_status',
        },
      },
    ];

    const countPipeline = [
      { $match: match },
      { $unwind: '$items' },
      { $match: { 'items.item_status': 'instant' } },
      { $count: 'total' },
    ];

    const [itemsList, countResult] = await Promise.all([
      salesRepository.aggregate(itemsPipeline, { SaleModel: Model }),
      salesRepository.aggregate(countPipeline, { SaleModel: Model }),
    ]);

    const total =
      Array.isArray(countResult) && countResult.length > 0 ? countResult[0].total || 0 : 0;

    return { itemsList, total };
  },
  /*
   * groupByFamily (V1 tail): an optional READING view - the same per-line
   * numbers, rolled up by variant_group_id where one exists. Per the
   * reporting invariant, this changes no stored number and no default:
   * off, every variant is its own row exactly as always; exports never
   * pass the flag.
   */
  /*
   * Tax summary by rate (T3): the filing shape for the whole single-VAT
   * family - period totals per rate class, net/tax/gross, with untaxed
   * lines in their own zero bucket. Reads the SAME stored per-line values
   * every other report reads; per the reporting rules nothing here
   * recomputes tax, it only sums what the sale wrote.
   */
  getTaxSummaryReportData: async ({ match }, { SaleModel } = {}) => {
    const Model = getModel(SaleModel);
    const pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $set: {
          _tax_amount: { $toDouble: { $ifNull: ['$items.tax_amount', 0] } },
          _gross: { $toDouble: { $ifNull: ['$items.total_amount', 0] } },
          _rate: { $toDouble: { $ifNull: ['$items.tax_rate', { $ifNull: ['$items.tax', 0] }] } },
          _name: { $ifNull: ['$items.tax_name', ''] },
        },
      },
      {
        $group: {
          _id: { rate: '$_rate', name: '$_name' },
          tax: { $sum: '$_tax_amount' },
          gross: { $sum: '$_gross' },
          lines: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          rate: '$_id.rate',
          tax_name: '$_id.name',
          tax: 1,
          gross: 1,
          net: { $subtract: ['$gross', '$tax'] },
          lines: 1,
        },
      },
      { $sort: { rate: -1, tax_name: 1 } },
    ];
    const rows = await salesRepository.aggregate(pipeline, { SaleModel: Model });
    return { rows: Array.isArray(rows) ? rows : [] };
  },

  getItemSalesReportTableData: async (
    { match, skip, limit, groupByFamily },
    { SaleModel } = {}
  ) => {
    const Model = getModel(SaleModel);

    const normalizedItemTotalExpr = toNumberExpression({
      $ifNull: [
        '$items.total',
        {
          $ifNull: ['$items.total_amount', { $ifNull: ['$items.items_total', 0] }],
        },
      ],
    });

    const normalizedQuantityExpr = toNumberExpression({
      $ifNull: [
        '$items.quantity',
        {
          $ifNull: [
            '$items.item_quantity',
            {
              $ifNull: ['$items.qty', { $ifNull: ['$items.number_of_items', 0] }],
            },
          ],
        },
      ],
    });

    const normalizedUnitCompanyPriceExpr = toNumberExpression({
      $ifNull: [
        // For Node-style sales, the frontend sends per-unit company price in
        // `company_price_total`. Treat it as a unit cost and multiply by
        // quantity. When that is missing, fall back to line/company master
        // fields.
        '$items.company_price_total',
        {
          $ifNull: ['$items.company_price', { $ifNull: ['$item_info.company_price', 0] }],
        },
      ],
    });

    // Company cost needs to support both legacy PHP sales documents and
    // new Node-based sales:
    //
    // - Legacy PHP sales typically stored `items.company_price_total` as an
    //   already-total cost and did not use the Mongoose `quantity` field.
    // - New Node sales use the Mongoose `quantity` field and receive
    //   per-unit company price from the frontend (or fall back to the item
    //   master company_price).
    //
    // We treat rows without `items.quantity` as legacy PHP and trust the
    // stored total. For all other rows we compute
    //   total_company_price = quantity * unit_company_price.
    const normalizedCompanyPriceExpr = {
      $cond: [
        {
          $and: [
            { $ne: ['$items.company_price_total', null] },
            { $ne: ['$items.company_price_total', ''] },
            { $eq: ['$items.quantity', null] },
          ],
        },
        toNumberExpression('$items.company_price_total'),
        {
          $multiply: [normalizedQuantityExpr, normalizedUnitCompanyPriceExpr],
        },
      ],
    };

    const normalizedNameExpr = {
      $ifNull: [
        '$items.name',
        {
          $ifNull: [
            '$items.item_name',
            {
              $ifNull: [
                '$item_info.name',
                {
                  $ifNull: ['$item_info.item_name', '$item_info.label'],
                },
              ],
            },
          ],
        },
      ],
    };

    const normalizedItemIdExpr = {
      $ifNull: ['$items.item', { $ifNull: ['$items.item_id', '$item_info._id'] }],
    };

    // Normalised per-line tax amount so we can derive a tax-exclusive
    // base from the stored line total:
    //   net_line = line_total - tax_amount
    // This works for both inclusive and exclusive tax types because the
    // underlying sale calculation always stores `total_amount` including
    // tax and `tax_amount` as the corresponding tax component.
    const normalizedTaxAmountExpr = toNumberExpression({
      $ifNull: ['$items.tax_amount', 0],
    });

    const pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'items',
          localField: 'items.item',
          foreignField: '_id',
          as: 'item_info',
        },
      },
      {
        $unwind: {
          path: '$item_info',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $set: {
          normalizedItemTotal: normalizedItemTotalExpr,
          normalizedQuantity: normalizedQuantityExpr,
          normalizedCompanyPrice: normalizedCompanyPriceExpr,
          normalizedItemName: normalizedNameExpr,
          normalizedItemId: normalizedItemIdExpr,
          tax_amount: normalizedTaxAmountExpr,
        },
      },
      {
        $group: groupByFamily
          ? {
              // Family members share their group id as the key; everything
              // else keys exactly as before. The summed inputs are the SAME
              // per-line values the default view sums.
              _id: {
                $ifNull: [
                  '$item_info.variant_group_id',
                  { $ifNull: ['$normalizedItemId', '$normalizedItemName'] },
                ],
              },
              name: {
                $first: { $ifNull: ['$item_info.variant_parent_name', '$normalizedItemName'] },
              },
              family_members: {
                $addToSet: { $ifNull: ['$normalizedItemId', '$normalizedItemName'] },
              },
              total_amount: { $sum: '$normalizedItemTotal' },
              item_quantity: { $sum: '$normalizedQuantity' },
              total_company_price: { $sum: '$normalizedCompanyPrice' },
              total_tax_amount: { $sum: '$tax_amount' },
              sales_avg: { $avg: '$normalizedItemTotal' },
              sales_count: { $sum: 1 },
            }
          : {
              _id: { $ifNull: ['$normalizedItemId', '$normalizedItemName'] },
              name: { $first: '$normalizedItemName' },
              total_amount: { $sum: '$normalizedItemTotal' },
              item_quantity: { $sum: '$normalizedQuantity' },
              total_company_price: { $sum: '$normalizedCompanyPrice' },
              total_tax_amount: { $sum: '$tax_amount' },
              sales_avg: { $avg: '$normalizedItemTotal' },
              sales_count: { $sum: 1 },
            },
      },
      ...(groupByFamily ? [{ $set: { family_members: { $size: '$family_members' } } }] : []),
      {
        $set: {
          sales_profit: {
            $subtract: [
              { $subtract: ['$total_amount', '$total_tax_amount'] },
              '$total_company_price',
            ],
          },
          item_id: {
            $cond: [
              {
                $and: [{ $ne: ['$_id', null] }, { $ne: ['$_id', ''] }],
              },
              {
                $cond: [{ $eq: [{ $type: '$_id' }, 'objectId'] }, { $toString: '$_id' }, '$_id'],
              },
              null,
            ],
          },
        },
      },
      { $sort: { item_quantity: -1, total_amount: -1, name: 1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
          list: '$data',
        },
      },
    ];

    const [result] = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });
    const total = result?.total || 0;
    const list = Array.isArray(result?.list) ? result.list : [];

    return { total, list };
  },
  getCategorySalesReportTableData: async (
    { match, skip, limit, requestedCategoryId },
    { SaleModel } = {}
  ) => {
    const Model = getModel(SaleModel);

    const normalizedItemTotalExpr = toNumberExpression({
      $ifNull: [
        '$items.total',
        {
          $ifNull: ['$items.total_amount', { $ifNull: ['$items.items_total', 0] }],
        },
      ],
    });

    const normalizedQuantityExpr = toNumberExpression({
      $ifNull: [
        '$items.quantity',
        {
          $ifNull: [
            '$items.item_quantity',
            {
              $ifNull: ['$items.qty', { $ifNull: ['$items.number_of_items', 0] }],
            },
          ],
        },
      ],
    });

    const normalizedUnitCompanyPriceExpr = toNumberExpression({
      $ifNull: [
        '$items.company_price_total',
        {
          $ifNull: ['$items.company_price', { $ifNull: ['$items.item_company_price', 0] }],
        },
      ],
    });

    const normalizedCompanyPriceExpr = {
      $cond: [
        {
          $and: [
            { $ne: ['$items.company_price_total', null] },
            { $ne: ['$items.company_price_total', ''] },
            { $eq: ['$items.quantity', null] },
          ],
        },
        toNumberExpression('$items.company_price_total'),
        {
          $multiply: ['$normalizedQuantity', '$normalizedUnitCompanyPrice'],
        },
      ],
    };

    // Normalised per-line tax amount so that we can
    // compute profit using totals **excluding** tax
    // at the category level. This mirrors the logic
    // used in getItemSalesReportTableData.
    const normalizedTaxAmountExpr = toNumberExpression({
      $ifNull: ['$items.tax_amount', 0],
    });

    const normalizedCategoryIdExpr = {
      $let: {
        vars: {
          candidate: {
            $ifNull: [
              '$items.category_id',
              {
                $ifNull: [
                  '$items.categoryId',
                  {
                    $ifNull: ['$items.category._id', { $ifNull: ['$items.category.id', null] }],
                  },
                ],
              },
            ],
          },
        },
        in: {
          $cond: [
            {
              $and: [{ $ne: ['$$candidate', null] }, { $ne: ['$$candidate', ''] }],
            },
            {
              $cond: [
                { $eq: [{ $type: '$$candidate' }, 'objectId'] },
                { $toString: '$$candidate' },
                '$$candidate',
              ],
            },
            null,
          ],
        },
      },
    };

    const normalizedCategoryNameExpr = {
      $ifNull: [
        '$items.category_name',
        {
          $ifNull: [
            '$items.categoryName',
            {
              $ifNull: ['$items.category.name', { $ifNull: ['$items.category', ''] }],
            },
          ],
        },
      ],
    };

    const pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $addFields: {
          normalizedCategoryId: normalizedCategoryIdExpr,
          normalizedCategoryName: normalizedCategoryNameExpr,
          normalizedItemTotal: normalizedItemTotalExpr,
          normalizedQuantity: normalizedQuantityExpr,
          normalizedUnitCompanyPrice: normalizedUnitCompanyPriceExpr,
          tax_amount: normalizedTaxAmountExpr,
        },
      },
      {
        $addFields: {
          normalizedCompanyPrice: normalizedCompanyPriceExpr,
        },
      },
    ];

    if (requestedCategoryId) {
      pipeline.push({
        $match: { normalizedCategoryId: requestedCategoryId },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            category_id: '$normalizedCategoryId',
            category_name: '$normalizedCategoryName',
          },
          total_amount: { $sum: '$normalizedItemTotal' },
          item_quantity: { $sum: '$normalizedQuantity' },
          total_company_price: { $sum: '$normalizedCompanyPrice' },
          total_tax_amount: { $sum: '$tax_amount' },
          sales_count: { $sum: 1 },
        },
      },
      {
        $set: {
          // Profit should **exclude** tax. We derive a
          // tax-exclusive category total as
          //   total_amount_without_tax = total_amount - total_tax_amount
          // and subtract the aggregated company cost.
          sales_profit: {
            $subtract: [
              { $subtract: ['$total_amount', '$total_tax_amount'] },
              '$total_company_price',
            ],
          },
          // Option A: Avg.Sale = Total Sale / Total No. Of Item Sold
          sales_avg: {
            $cond: [
              { $gt: ['$item_quantity', 0] },
              { $divide: ['$total_amount', '$item_quantity'] },
              0,
            ],
          },
          category_id: '$_id.category_id',
          category_name: '$_id.category_name',
        },
      },
      {
        $sort: {
          total_amount: -1,
          item_quantity: -1,
          category_name: 1,
        },
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
          list: '$data',
        },
      }
    );

    const [result] = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });
    const total = result?.total || 0;
    const list = Array.isArray(result?.list) ? result.list : [];

    return { total, list };
  },
  getSupplierSalesReportTableData: async (
    { match, skip, limit, requestedSupplierId },
    { SaleModel } = {}
  ) => {
    const Model = getModel(SaleModel);

    const normalizedItemTotalExpr = toNumberExpression({
      $ifNull: [
        '$items.total',
        {
          $ifNull: ['$items.total_amount', { $ifNull: ['$items.items_total', 0] }],
        },
      ],
    });

    const normalizedQuantityExpr = toNumberExpression({
      $ifNull: [
        '$items.quantity',
        {
          $ifNull: [
            '$items.item_quantity',
            {
              $ifNull: ['$items.qty', { $ifNull: ['$items.number_of_items', 0] }],
            },
          ],
        },
      ],
    });

    const normalizedUnitCompanyPriceExpr = toNumberExpression({
      $ifNull: ['$items.company_price', { $ifNull: ['$items.item_company_price', 0] }],
    });

    const normalizedCompanyPriceExpr = {
      $cond: [
        {
          $and: [
            { $ne: ['$items.company_price_total', null] },
            { $ne: ['$items.company_price_total', ''] },
          ],
        },
        toNumberExpression('$items.company_price_total'),
        {
          $multiply: ['$normalizedQuantity', '$normalizedUnitCompanyPrice'],
        },
      ],
    };

    const normalizedSupplierIdExpr = {
      $let: {
        vars: {
          candidate: {
            $ifNull: [
              '$items.supplier_id',
              {
                $ifNull: [
                  '$items.supplierId',
                  {
                    $ifNull: ['$items.supplier._id', { $ifNull: ['$items.supplier.id', null] }],
                  },
                ],
              },
            ],
          },
        },
        in: {
          $cond: [
            {
              $and: [{ $ne: ['$$candidate', null] }, { $ne: ['$$candidate', ''] }],
            },
            {
              $cond: [
                { $eq: [{ $type: '$$candidate' }, 'objectId'] },
                { $toString: '$$candidate' },
                '$$candidate',
              ],
            },
            null,
          ],
        },
      },
    };

    const normalizedSupplierNameExpr = {
      $ifNull: [
        '$items.supplier_name',
        {
          $ifNull: [
            '$items.supplierName',
            {
              $ifNull: ['$items.supplier.name', { $ifNull: ['$items.supplier', ''] }],
            },
          ],
        },
      ],
    };

    const pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $addFields: {
          normalizedSupplierId: normalizedSupplierIdExpr,
          normalizedSupplierName: normalizedSupplierNameExpr,
          normalizedItemTotal: normalizedItemTotalExpr,
          normalizedQuantity: normalizedQuantityExpr,
          normalizedUnitCompanyPrice: normalizedUnitCompanyPriceExpr,
          // Sale-level fields for profit calculation (matches PHP)
          salesTotalNum: toNumberExpression({ $ifNull: ['$items_total', 0] }),
          taxNum: toNumberExpression({ $ifNull: ['$tax', 0] }),
          companyPriceTotalNum: toNumberExpression({ $ifNull: ['$items.company_price_total', 0] }),
        },
      },
      {
        $addFields: {
          normalizedCompanyPrice: normalizedCompanyPriceExpr,
        },
      },
    ];

    if (requestedSupplierId) {
      pipeline.push({
        $match: { normalizedSupplierId: requestedSupplierId },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            supplier_id: '$normalizedSupplierId',
            supplier_name: '$normalizedSupplierName',
          },
          total_amount: { $sum: '$normalizedItemTotal' },
          item_quantity: { $sum: '$normalizedQuantity' },
          total_company_price: { $sum: '$normalizedCompanyPrice' },
          // Gross profit matching PHP: (sales_total - tax) - company_price per item
          profit: {
            $sum: {
              $subtract: [
                { $subtract: ['$salesTotalNum', { $add: ['$taxNum'] }] },
                '$companyPriceTotalNum',
              ],
            },
          },
          sales_avg: { $avg: '$normalizedItemTotal' },
          sales_count: { $sum: 1 },
        },
      },
      {
        $set: {
          sales_profit: '$profit',
          supplier_id: '$_id.supplier_id',
          supplier_name: '$_id.supplier_name',
        },
      },
      {
        $sort: {
          total_amount: -1,
          item_quantity: -1,
          supplier_name: 1,
        },
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
          list: '$data',
        },
      }
    );

    const [result] = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });
    const total = result?.total || 0;
    const list = Array.isArray(result?.list) ? result.list : [];

    return { total, list };
  },
  getCustomerSalesReportTableData: async ({ match, skip, limit }, { SaleModel } = {}) => {
    const Model = getModel(SaleModel);

    const normalizedSaleTotalExpr = toNumberExpression({
      $ifNull: ['$sales_total', { $ifNull: ['$total', { $ifNull: ['$items_total', 0] }] }],
    });

    const normalizedRefundExpr = toNumberExpression({
      $ifNull: ['$items_return_total', { $ifNull: ['$return_total', 0] }],
    });

    const normalizedCustomerIdExpr = {
      $let: {
        vars: {
          candidate: {
            $ifNull: [
              '$customer',
              { $ifNull: ['$customer_id', { $ifNull: ['$customerId', null] }] },
            ],
          },
        },
        in: {
          $cond: [
            {
              $and: [{ $ne: ['$$candidate', null] }, { $ne: ['$$candidate', ''] }],
            },
            {
              $cond: [
                { $eq: [{ $type: '$$candidate' }, 'objectId'] },
                { $toString: '$$candidate' },
                '$$candidate',
              ],
            },
            null,
          ],
        },
      },
    };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          normalizedSaleTotal: normalizedSaleTotalExpr,
          normalizedRefundTotal: normalizedRefundExpr,
          normalizedCustomerId: normalizedCustomerIdExpr,
          normalizedCustomerName: {
            $ifNull: ['$customer_name', ''],
          },
          normalizedCustomerPhone: {
            $ifNull: ['$customer_phone', ''],
          },
        },
      },
      {
        $group: {
          _id: {
            customer_id: '$normalizedCustomerId',
            customer_name: '$normalizedCustomerName',
            customer_phone: '$normalizedCustomerPhone',
          },
          sales_payment: { $sum: '$normalizedSaleTotal' },
          refund_payment: { $sum: '$normalizedRefundTotal' },
          sales_count: { $sum: 1 },
          sales_avg: { $avg: '$normalizedSaleTotal' },
        },
      },
      {
        $sort: {
          sales_payment: -1,
          sales_count: -1,
          '_id.customer_name': 1,
        },
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
          list: '$data',
        },
      },
    ];

    const [result] = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });
    const total = result?.total || 0;
    const list = Array.isArray(result?.list) ? result.list : [];

    return { total, list };
  },
  getItemGraphicalReportsData: async ({ match }, { SaleModel } = {}) => {
    const Model = getModel(SaleModel);

    const normalizedItemTotalExpr = toNumberExpression({
      $ifNull: [
        '$items.total',
        {
          $ifNull: ['$items.total_amount', { $ifNull: ['$items.items_total', 0] }],
        },
      ],
    });

    const normalizedQuantityExpr = toNumberExpression({
      $ifNull: [
        '$items.quantity',
        {
          $ifNull: [
            '$items.item_quantity',
            {
              $ifNull: ['$items.qty', { $ifNull: ['$items.number_of_items', 0] }],
            },
          ],
        },
      ],
    });

    const normalizedNameExpr = {
      $let: {
        vars: {
          base: {
            $ifNull: [
              '$items.name',
              {
                $ifNull: [
                  '$items.item_name',
                  {
                    $ifNull: [
                      '$items.title',
                      {
                        $cond: [
                          { $isArray: '$items.item' },
                          { $arrayElemAt: ['$items.item', 0] },
                          '$items.item',
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        in: {
          $cond: [
            {
              $and: [{ $ne: ['$$base', null] }, { $ne: ['$$base', ''] }],
            },
            {
              $cond: [
                { $eq: [{ $type: '$$base' }, 'object'] },
                {
                  $ifNull: ['$$base.name', { $ifNull: ['$$base.title', 'Unnamed Item'] }],
                },
                '$$base',
              ],
            },
            'Unnamed Item',
          ],
        },
      },
    };

    const pipeline = [
      { $match: match },
      { $unwind: '$items' },
      {
        $set: {
          normalizedItemTotal: normalizedItemTotalExpr,
          normalizedQuantity: normalizedQuantityExpr,
          normalizedItemName: normalizedNameExpr,
        },
      },
      {
        $group: {
          _id: '$normalizedItemName',
          total_amount: { $sum: '$normalizedItemTotal' },
          total_qty: { $sum: '$normalizedQuantity' },
        },
      },
      { $sort: { total_qty: -1, total_amount: -1, _id: 1 } },
      { $limit: 5 },
    ];

    const results = await salesRepository.aggregate(pipeline, {
      SaleModel: Model,
    });
    return results;
  },
  // Thin wrappers around legacy Sale model static report methods so that
  // controllers do not talk to the model layer directly. These preserve
  // the existing return shapes entirely and simply delegate the work to
  // the underlying model implementation.
  userReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.userReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  getUserGraphicalReports: async (data, { SaleModel } = {}) =>
    salesRepository.getUserGraphicalReports(data, {
      SaleModel: getModel(SaleModel),
    }),
  returnSalesReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.returnSalesReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  returnProductReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.returnProductReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  pendingProductReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.pendingProductReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  productBasedReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.productBasedReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  pendingSalesReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.pendingSalesReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  pendingCustomerReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.pendingCustomerReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  taxSalesReportPage: async (data, { SaleModel } = {}) =>
    salesRepository.taxSalesReportPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  customerSaleDetailsPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.customerSaleDetailsPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  customerCategorySaleDetailsPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.customerCategorySaleDetailsPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  itemSaleDetailsPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.itemSaleDetailsPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  categorySaleDetailsPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.categorySaleDetailsPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  userSalesDetailsPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.userSalesDetailsPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  paymentSalesTransactionReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.paymentSalesTransactionReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  getPaymentSaleTypeReport: async (data, { SaleModel } = {}) =>
    salesRepository.getPaymentSaleTypeReport(data, {
      SaleModel: getModel(SaleModel),
    }),
  paymentReturnSalesTranscationReportTable: async (data, options, { SaleModel } = {}) =>
    salesRepository.paymentReturnSalesTranscationReportTable(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  getPaymentGraphicalReports: async (data, { SaleModel } = {}) =>
    salesRepository.getPaymentGraphicalReports(data, {
      SaleModel: getModel(SaleModel),
    }),
  // Generic helpers to fetch a sale by either Mongo _id or legacy sales_id,
  // used by email/print endpoints to keep DB access in the service layer.
  getSaleForReceipt: async (id, { SaleModel } = {}) => {
    if (!id) return null;
    return salesRepository.getSaleForReceipt(id, {
      SaleModel: getModel(SaleModel),
    });
  },
  getSaleForCustomerPrint: async (id, { SaleModel } = {}) => {
    if (!id) return null;
    return salesRepository.getSaleForCustomerPrint(id, {
      SaleModel: getModel(SaleModel),
    });
  },
  getSaleForPdf: async (id, { SaleModel } = {}) => {
    if (!id) return null;

    const Model = getModel(SaleModel);

    // Primary path: look up by MongoDB _id using the generic findById helper.
    let sale = await salesRepository.findById(id, {
      SaleModel: Model,
    });

    if (sale) {
      return sale;
    }

    // Backward-compatible fallback: allow legacy string-based sales_id
    // values that may be passed from older frontends.
    sale = await salesRepository.findOne({ sales_id: id }, null, { SaleModel: Model });

    return sale;
  },
  // Thin wrappers around additional legacy static helpers used by
  // the controller outside of the main reporting endpoints.
  returnSalesOrder: async (data, { SaleModel } = {}) =>
    salesRepository.returnSalesOrder(data, {
      SaleModel: getModel(SaleModel),
    }),
  exportSalesOrder: async (ids, { SaleModel } = {}) =>
    salesRepository.exportSalesOrder(ids, {
      SaleModel: getModel(SaleModel),
    }),
  getSalesDataChanges: async (from, { SaleModel } = {}) =>
    salesRepository.getSalesDataChanges(from, {
      SaleModel: getModel(SaleModel),
    }),
  getReturnSalesDetails: async (salesId, { SaleModel } = {}) =>
    salesRepository.getReturnSalesDetails(salesId, {
      SaleModel: getModel(SaleModel),
    }),
  getReturnPrintDetails: async (id, { SaleModel } = {}) =>
    salesRepository.getReturnPrintDetails(id, {
      SaleModel: getModel(SaleModel),
    }),
  returnProductViewPage: async (id, { SaleModel } = {}) =>
    salesRepository.returnProductViewPage(id, {
      SaleModel: getModel(SaleModel),
    }),
  getSalesAjaxList: async (query, { SaleModel } = {}) =>
    salesRepository.getSalesAjaxList(query, {
      SaleModel: getModel(SaleModel),
    }),
  getSaleQtyDetail: async (id, { SaleModel } = {}) =>
    salesRepository.getSaleQtyDetail(id, {
      SaleModel: getModel(SaleModel),
    }),
  gstOneReportPage: async (data, { SaleModel } = {}) =>
    salesRepository.gstOneReportPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  gstThreeReportPage: async (data, { SaleModel } = {}) =>
    salesRepository.gstThreeReportPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  taxPayablePage: async (data) => salesRepository.taxPayablePage(data),
  taxPayableRegisterPage: async (data) => salesRepository.taxPayableRegisterPage(data),
  gstOneReportPageJson: async (data, { SaleModel } = {}) =>
    salesRepository.gstOneReportPageJson(data, {
      SaleModel: getModel(SaleModel),
    }),
  sendDailySalesMail: async (input, { SaleModel, shopTransport } = {}) =>
    salesRepository.sendDailySalesMail(input, {
      SaleModel: getModel(SaleModel),
      shopTransport,
    }),
  salesPaymentCloseModel: async (data, { SaleModel } = {}) =>
    salesRepository.salesPaymentCloseModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  generateQrCodeModel: async (amount, { SaleModel } = {}) =>
    salesRepository.generateQrCodeModel(amount, {
      SaleModel: getModel(SaleModel),
    }),
  getQrStatusModel: async (id, { SaleModel } = {}) =>
    salesRepository.getQrStatusModel(id, {
      SaleModel: getModel(SaleModel),
    }),
  qrCodeCloseModel: async (id, { SaleModel } = {}) =>
    salesRepository.qrCodeCloseModel(id, {
      SaleModel: getModel(SaleModel),
    }),
  kioskOrderModel: async (data, { SaleModel } = {}) =>
    salesRepository.kioskOrderModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  generateRazorPayQrCodekioskModel: async (data, { SaleModel } = {}) =>
    salesRepository.generateRazorPayQrCodekioskModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  getRazorPayQrStatusModel: async (data, { SaleModel } = {}) =>
    salesRepository.getRazorPayQrStatusModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  razorPayQrCodeCloseModel: async (data, { SaleModel } = {}) =>
    salesRepository.razorPayQrCodeCloseModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  phonepeQrModel: async ({ SaleModel } = {}) =>
    salesRepository.phonepeQrModel({
      SaleModel: getModel(SaleModel),
    }),
  phonepeQrStatusModel: async ({ SaleModel } = {}) =>
    salesRepository.phonepeQrStatusModel({
      SaleModel: getModel(SaleModel),
    }),
  createRazorPayMobileModel: async (data, { SaleModel } = {}) =>
    salesRepository.createRazorPayMobileModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  fetchRazorPayQrStatusMobileModel: async (data, { SaleModel } = {}) =>
    salesRepository.fetchRazorPayQrStatusMobileModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  fetchLastSaleModel: async (branchId, { SaleModel } = {}) =>
    salesRepository.fetchLastSaleModel(branchId, {
      SaleModel: getModel(SaleModel),
    }),
  kitchenPrintModel: async (branchId, { SaleModel } = {}) =>
    salesRepository.kitchenPrintModel(branchId, {
      SaleModel: getModel(SaleModel),
    }),
  multiKitchenPrintModel: async (branchId) => salesRepository.multiKitchenPrintModel(branchId),
  markKitchenPrintedModel: async (saleIds, printedIndexes) =>
    salesRepository.markKitchenPrintedModel(saleIds, printedIndexes),
  qrOrderModel: async (data, { SaleModel } = {}) =>
    salesRepository.qrOrderModel(data, {
      SaleModel: getModel(SaleModel),
    }),
  getNewSaleModel: async ({ SaleModel } = {}) =>
    salesRepository.getNewSaleModel({
      SaleModel: getModel(SaleModel),
    }),
  getOrderHistoryModel: async (branchId, limit, page, status, userId, { SaleModel } = {}) =>
    salesRepository.getOrderHistoryModel(branchId, limit, page, status, userId, {
      SaleModel: getModel(SaleModel),
    }),
  updateOrderModel: async (
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
  ) =>
    salesRepository.updateOrderModel(
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
      {
        SaleModel: getModel(SaleModel),
      }
    ),
  getFrequentItemsForBranch: async (branchId, limit, { SaleModel } = {}) =>
    salesRepository.getFrequentItemsForBranch(branchId, limit, {
      SaleModel: getModel(SaleModel),
    }),
  getKotDiscountReports: async (data, options, { SaleModel } = {}) =>
    salesRepository.getKotDiscountReports(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  kotTablewiseDetailsPage: async (data, { SaleModel } = {}) =>
    salesRepository.kotTablewiseDetailsPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  pendingCustomerCategoryReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.pendingCustomerCategoryReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  kioskReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.kioskReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  kiosksSummaryReportsPage: async (data, { SaleModel } = {}) =>
    salesRepository.kiosksSummaryReportsPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  kiosksGraphicalReportsPage: async (data, { SaleModel } = {}) =>
    salesRepository.kiosksGraphicalReportsPage(data, {
      SaleModel: getModel(SaleModel),
    }),
  itemExpiryReportPage: async (data, options, { SaleModel } = {}) =>
    salesRepository.itemExpiryReportPage(data, options, {
      SaleModel: getModel(SaleModel),
    }),
  salePage: async (filters, options, branchId, { SaleModel } = {}) =>
    salesRepository.salePage(filters, options, branchId, {
      SaleModel: getModel(SaleModel),
    }),
  // Keep existing methods to avoid breaking other routes (though createSale is superceded)
  createSale: async (data, { SaleModel } = {}) =>
    salesRepository.create(data, { SaleModel: getModel(SaleModel) }),
  listSales: async (filter, options, { SaleModel } = {}) =>
    salesRepository.paginate(filter, options, { SaleModel: getModel(SaleModel) }),
  getLegacySaleDetails: async (id, { SaleModel } = {}) =>
    salesRepository.getLegacyDetails(id, { SaleModel: getModel(SaleModel) }),
  deleteSales: async (ids, { SaleModel } = {}) =>
    salesRepository.deleteSales(ids, { SaleModel: getModel(SaleModel) }),
};
