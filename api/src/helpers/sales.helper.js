/**
 * Sales Helper Functions
 * Utility functions for sale-related operations.
 *
 * These are extracted from the legacy sales controller to make them reusable
 * across the service, repository, and controller layers.
 */

const mongoose = require('mongoose');
const BaseModel = require('../models/base.model');
const { safeJsonParse, toObjectId } = require('../utils/helpers');
const User = require('../models/user.model');

// Report type helpers (Daily / Weekly / Monthly / Yearly)
const REPORT_TYPES = ['Daily', 'Weekly', 'Monthly', 'Yearly'];
const DEFAULT_REPORT_TYPE = REPORT_TYPES[0];

const normalizeReportType = (type = DEFAULT_REPORT_TYPE) => {
  if (!type) return DEFAULT_REPORT_TYPE;
  const lowered = String(type).trim().toLowerCase();
  return REPORT_TYPES.find((entry) => entry.toLowerCase() === lowered) || DEFAULT_REPORT_TYPE;
};

const getDateRangeForType = (type) => {
  const normalized = normalizeReportType(type);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);

  switch (normalized) {
    case 'Weekly': {
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      break;
    }
    case 'Monthly': {
      start.setDate(1);
      break;
    }
    case 'Yearly': {
      start.setMonth(0, 1);
      break;
    }
    default:
      break;
  }

  return { start, end, label: normalized };
};

// Numeric helpers
const roundToTwo = (value = 0) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const extractNumericValue = (value) => {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]+/g, '');
    if (
      !cleaned.trim() ||
      cleaned === '-' ||
      cleaned === '.' ||
      cleaned === '-.' ||
      cleaned === '.-'
    ) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const numberOrZero = (value, fallback = 0) => {
  const parsed = extractNumericValue(value);
  return parsed === null ? fallback : parsed;
};

const numberOrNull = (value) => {
  const parsed = extractNumericValue(value);
  return parsed === null ? null : parsed;
};

const toNumberExpression = (expression, fallback = 0) => ({
  $convert: {
    input: expression,
    to: 'double',
    onError: fallback,
    onNull: fallback,
  },
});

// Payment mode helpers
const PAYMENT_MODE_DEFAULT = 'Cash';

const PAYMENT_MODE_CANONICAL_MAP = {
  cash: 'Cash',
  cheque: 'Cheque',
  check: 'Cheque',
  creditcard: 'CreditCard',
  card: 'CreditCard',
  pending: 'Pending',
  qr: 'Qrpay',
  qrpay: 'Qrpay',
  other: 'Other',
};

const PAYMENT_METHOD_LOOKUP = {
  Cash: 'cash',
  Cheque: 'bank_transfer',
  CreditCard: 'card',
  Pending: 'credit',
  Qrpay: 'other',
  Other: 'other',
};

const normalizePaymentMode = (mode = PAYMENT_MODE_DEFAULT) => {
  if (!mode) return PAYMENT_MODE_DEFAULT;
  const normalized = String(mode).trim().toLowerCase();
  return PAYMENT_MODE_CANONICAL_MAP[normalized] || PAYMENT_MODE_DEFAULT;
};

const mapPaymentModeToMethod = (mode) => {
  return PAYMENT_METHOD_LOOKUP[mode] || 'other';
};

// Sale process helpers
const SALE_PROCESS_DEFAULT = 'Add';

const SALE_PROCESS_CANONICAL_MAP = {
  add: 'Add',
  edit: 'Edit',
  hold: 'Hold',
  partialreturn: 'PartialReturn',
  'partial return': 'PartialReturn',
  partial_return: 'PartialReturn',
  return: 'Return',
};

const normalizeSaleProcess = (value = SALE_PROCESS_DEFAULT) => {
  if (!value) return SALE_PROCESS_DEFAULT;
  const key = String(value).trim().toLowerCase();
  return SALE_PROCESS_CANONICAL_MAP[key] || SALE_PROCESS_DEFAULT;
};

// ObjectId / branch helpers
const normalizeToMongooseId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  if (typeof value === 'object') {
    if (typeof value.toString === 'function') {
      const stringValue = value.toString();
      if (mongoose.Types.ObjectId.isValid(stringValue)) {
        return new mongoose.Types.ObjectId(stringValue);
      }
    }
    return (
      normalizeToMongooseId(value._id) ||
      normalizeToMongooseId(value.branch_id) ||
      normalizeToMongooseId(value.id) ||
      null
    );
  }
  const stringValue = String(value).trim();
  if (!stringValue) {
    return null;
  }
  return mongoose.Types.ObjectId.isValid(stringValue)
    ? new mongoose.Types.ObjectId(stringValue)
    : null;
};

const resolveBranchId = (user, session = {}) => {
  const sessionBranch = session?.selectedBranchId;
  if (sessionBranch && mongoose.Types.ObjectId.isValid(String(sessionBranch))) {
    return new mongoose.Types.ObjectId(String(sessionBranch));
  }

  if (!user) return null;
  const branchAccess = Array.isArray(user.branch_access) ? user.branch_access : [];
  const candidates = [
    user.branch_id,
    user.branch?._id,
    user.branch,
    user.default_branch_id,
    branchAccess[0]?.branch_id,
    branchAccess[0]?._id,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (mongoose.Types.ObjectId.isValid(candidate)) {
      return new mongoose.Types.ObjectId(candidate);
    }

    if (
      typeof candidate === 'object' &&
      candidate._id &&
      mongoose.Types.ObjectId.isValid(candidate._id)
    ) {
      return new mongoose.Types.ObjectId(candidate._id);
    }

    if (
      typeof candidate === 'object' &&
      candidate.branch_id &&
      mongoose.Types.ObjectId.isValid(candidate.branch_id)
    ) {
      return new mongoose.Types.ObjectId(candidate.branch_id);
    }
  }
  return null;
};

const resolveRequestBranchId = async (req = {}) => {
  // Priority 1: Session branch (PHP-style primary source)
  if (req.session?.selectedBranchId) {
    const normalized = normalizeToMongooseId(req.session.selectedBranchId);
    if (normalized) {
      return normalized;
    }
  }
  if (req.session?.branch_id) {
    const normalized = normalizeToMongooseId(req.session.branch_id);
    if (normalized) {
      return normalized;
    }
  }

  // Priority 2: Request parameters
  const requestCandidates = [
    req.query?.branch_id,
    req.query?.branchId,
    req.query?.branch,
    req.body?.branch_id,
    req.body?.branchId,
    req.body?.branch,
    req.headers?.['x-branch-id'],
    req.headers?.['x-branch'],
    req.headers?.['branch-id'],
  ];

  for (const candidate of requestCandidates) {
    const normalized = normalizeToMongooseId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  // PHP behavior: always scope to the authenticated user's active branch.
  const userBranch = resolveBranchId(req.user, req.session) || BaseModel.currentBranch;

  if (userBranch) {
    return userBranch;
  }

  // No fallback branch when user context is missing; force error upstream
  return null;
};

// Date parsing
const parseSaleDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf())) {
    return date;
  }
  const timestamp = numberOrNull(value);
  if (timestamp !== null) {
    const numericDate = new Date(timestamp);
    if (!Number.isNaN(numericDate.valueOf())) {
      return numericDate;
    }
  }
  return null;
};

const normalizeRangeDate = (value, { endOfDay = false } = {}) => {
  if (!value) return null;
  const parsed = parseSaleDate(value);
  if (!parsed) return null;
  const normalized = new Date(parsed);
  normalized.setHours(0, 0, 0, 0);
  if (endOfDay) {
    normalized.setHours(23, 59, 59, 999);
  }
  return normalized;
};

// Instant item helpers
const filterInstantItems = (items = []) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const status = String(
      item.item_status || item.status || item.sale_type || item.type || ''
    ).toLowerCase();
    return status === 'instant';
  });
};

const calculateInstantMetrics = (items = []) => {
  const instantItems = filterInstantItems(items);
  const quantity = instantItems.reduce(
    (sum, item) =>
      sum + numberOrZero(item?.quantity ?? item?.item_quantity ?? item?.qty ?? item?.count ?? 0, 0),
    0
  );

  const amount = instantItems.reduce(
    (sum, item) =>
      sum +
      numberOrZero(
        item?.total ??
          item?.total_amount ??
          item?.line_total ??
          item?.items_total ??
          item?.sub_total ??
          item?.subtotal ??
          0,
        0
      ),
    0
  );

  return {
    instantItems,
    quantity,
    amount,
  };
};
// ---------------------------------------------------------------------------
// Helpers moved from sales.controller.js to keep the controller thin
// ---------------------------------------------------------------------------

const normalizeSaleItems = (rawItems) => {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .map((raw) => {
      const itemIdSource = raw?.item_id ?? raw?.item ?? raw?.id ?? raw?.itemid ?? raw?._id;
      const itemId = itemIdSource ? toObjectId(String(itemIdSource).trim()) : null;

      const name = raw?.item_name || raw?.name || raw?.title;

      const quantity = numberOrNull(raw?.item_quantity ?? raw?.quantity ?? raw?.qty ?? raw?.count);

      // Frontend sends either sale_inline_item_price or item_price_total/selling_price
      // In some flows sale_inline_item_price can be the literal string "undefined" or
      // an empty string. Treat those as missing and fall back to the other numeric
      // price fields instead of discarding the item.
      let rawUnitPriceCandidate = raw?.sale_inline_item_price;

      if (
        rawUnitPriceCandidate === undefined ||
        rawUnitPriceCandidate === null ||
        (typeof rawUnitPriceCandidate === 'string' && !rawUnitPriceCandidate.trim()) ||
        (typeof rawUnitPriceCandidate === 'string' &&
          ['undefined', 'null', 'nan'].includes(rawUnitPriceCandidate.trim().toLowerCase()))
      ) {
        rawUnitPriceCandidate =
          raw?.item_price_total ??
          raw?.item_price ??
          raw?.unit_price ??
          raw?.price ??
          raw?.selling_price ??
          raw?.mrp_price;
      }

      const rawUnitPrice = rawUnitPriceCandidate;
      const unitPrice = numberOrNull(rawUnitPrice);

      const totalInput = numberOrNull(
        raw?.total_amount ?? raw?.total ?? raw?.line_total ?? raw?.items_total
      );

      if (
        !itemId ||
        !name ||
        quantity === null ||
        quantity <= 0 ||
        unitPrice === null ||
        unitPrice < 0
      ) {
        return null;
      }

      const discountValue = Math.max(
        0,
        numberOrZero(
          raw?.item_discount ??
            raw?.discount ??
            raw?.item_discount_amount ??
            raw?.item_discount_percentage ??
            raw?.discount_amount ??
            raw?.discount_value ??
            raw?.sale_inline_discount_value,
          0
        )
      );

      const taxAmount = Math.max(0, numberOrZero(raw?.gst ?? raw?.tax_amount ?? raw?.tax, 0));

      const taxRate = Math.max(0, numberOrZero(raw?.tax_rate ?? raw?.item_tax_rate, 0));

      const computedTotal =
        totalInput ??
        (quantity !== null && unitPrice !== null
          ? roundToTwo(quantity * unitPrice - discountValue + taxAmount)
          : null);

      if (computedTotal === null || computedTotal < 0) {
        return null;
      }

      // Map to Mongoose saleItemSchema (core fields)
      const base = {
        item: itemId,
        name: String(name).trim(),
        barcode: raw?.barcode_id || raw?.barcode || undefined,
        sku: raw?.item_sku || raw?.sku || undefined,
        quantity,
        unit_price: roundToTwo(unitPrice),
        discount: roundToTwo(discountValue),
        tax_amount: roundToTwo(taxAmount),
        tax_rate: taxRate,
        total: roundToTwo(computedTotal),
      };

      // Attach PHP-compatible mirrors exactly as defined in saleItemSchema
      return {
        ...base,
        sale_inline_item_price: numberOrZero(raw?.sale_inline_item_price ?? rawUnitPrice, 0),
        sale_inline_discount_value: numberOrZero(
          raw?.sale_inline_discount_value ?? raw?.item_discount ?? 0,
          0
        ),
        sale_inline_discount_pervalue: numberOrZero(
          raw?.sale_inline_discount_pervalue ?? raw?.item_discount_percentage ?? 0,
          0
        ),
        item_status: raw?.item_status || raw?.status || raw?.sale_type || undefined,
        return: Boolean(raw?.return) || false,
        item_sku: raw?.item_sku || raw?.sku || undefined,
        item_discount: numberOrZero(raw?.item_discount ?? 0, 0),
        item_discount_percentage: numberOrZero(raw?.item_discount_percentage ?? 0, 0),
        item_available_quantity: numberOrZero(raw?.item_available_quantity ?? 0, 0),
        item_id: raw?.item_id ? String(raw?.item_id) : '',
        item_unit: raw?.item_unit || 'qty',
        total_amount: roundToTwo(numberOrZero(raw?.total_amount ?? computedTotal, computedTotal)),
        barcode_id: raw?.barcode_id || undefined,
        company_price_total: numberOrZero(raw?.company_price_total ?? 0, 0),
        category_id: raw?.category_id ? toObjectId(String(raw?.category_id)) : undefined,
        category_name: raw?.category_name || undefined,
        supplier_id: raw?.supplier_id ? toObjectId(String(raw?.supplier_id)) : undefined,
        supplier_name: raw?.supplier_name || undefined,
        tax: numberOrZero(raw?.gst ?? raw?.tax ?? 0, 0),
        tax_type: raw?.tax_type || undefined,
        igst_tax: numberOrZero(raw?.igst_tax ?? 0, 0),
        cgst_tax: numberOrZero(raw?.cgst_tax ?? 0, 0),
        sgst_tax: numberOrZero(raw?.sgst_tax ?? 0, 0),
        tax_name: raw?.tax_name || undefined,
        tax_fields: raw?.tax_fields ?? undefined,
        track_inventory:
          String(raw?.track_inventory).toLowerCase() === 'true' || raw?.track_inventory === true,
        negative_stock:
          String(raw?.negative_stock).toLowerCase() === 'true' || raw?.negative_stock === true,
        item_description:
          typeof raw?.item_description === 'string' ? raw.item_description : undefined,
      };
    })
    .filter(Boolean);
};

// Compute PHP-style payment metadata (status label + pending/partial values)
// to mirror sales_model.php::salesInsertUpdate behaviour.
const computePhpPaymentMeta = (total, saleProcess, payload = {}) => {
  const saleTotal = roundToTwo(total || 0);
  const rawProcess = (saleProcess || '').toString().toLowerCase();
  const isHold = rawProcess === 'hold';

  const rawPaymentMode = payload.payment_mode;
  const paymentModeStr =
    rawPaymentMode === undefined || rawPaymentMode === null ? '' : String(rawPaymentMode);
  const hasPaymentMode = paymentModeStr.trim().length > 0;

  const partialCheck = String(payload.partial_check) === 'true';

  let partialBalance = saleTotal;
  if (partialCheck) {
    const pbCandidate = numberOrNull(payload.partial_balance);
    partialBalance = pbCandidate !== null ? roundToTwo(pbCandidate) : 0;
  }

  let paymentStatus = 'Paid';
  let paymentPending = 0;

  if (partialCheck) {
    if (isHold) {
      // Hold + partial => mark as Unpaid but keep pending 0 until overridden
      paymentStatus = 'Unpaid';
      paymentPending = 0;
    } else if (saleTotal <= partialBalance) {
      paymentStatus = 'Paid';
      paymentPending = 0;
    } else {
      paymentStatus = 'Partialy Paid';
      paymentPending = roundToTwo(Math.max(0, saleTotal - partialBalance));
    }
  }

  const unpaidToggle = String(payload.unpaid) === 'true';

  let paymentModeForDoc = hasPaymentMode ? paymentModeStr.trim() : '';

  // Mirror PHP override: unpaid toggle OR empty payment_mode => Unpaid + full pending
  if (unpaidToggle || !hasPaymentMode) {
    paymentStatus = 'Unpaid';
    paymentPending = saleTotal;
    partialBalance = 0;
    paymentModeForDoc = '';
  }

  const paidAmount = partialBalance;
  const balance = paymentPending;

  return {
    partialCheck,
    partialBalance,
    paymentStatus,
    paymentPending,
    paidAmount,
    balance,
    paymentModeForDoc,
  };
};

// Build PHP-style changes array for newly created sales (all items are treated as added)
const buildChangesForCreate = (items = [], saleDate) => {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const changesItems = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const qty = numberOrZero(item.quantity, 0);
    if (qty <= 0) continue;

    const price = numberOrZero(
      item.sale_inline_item_price ??
        item.unit_price ??
        item.item_price ??
        item.item_price_total ??
        0,
      0
    );

    const itemId = item.item_id || (item.item && item.item.toString && item.item.toString()) || '';
    const itemName = item.name || item.item_name || '';
    const itemCode = item.item_sku || item.sku || item.barcode || item.barcode_id || '';
    const unit = item.item_unit || 'qty';
    const total = roundToTwo(price * qty);

    changesItems.push({
      item_id: itemId,
      item_name: itemName,
      item_quantity: qty,
      process: 'add',
      item_code: itemCode,
      unit,
      price,
      total,
    });
  }

  if (!changesItems.length) {
    return [];
  }

  const timestamp = saleDate instanceof Date ? saleDate : new Date();

  return [
    {
      timestamp,
      items: changesItems,
    },
  ];
};

// Build PHP-style changes array for updated sales by diffing existing items with incoming items
const buildChangesForUpdate = (existingSale, items = [], saleDate) => {
  const existingItems = Array.isArray(existingSale?.items) ? existingSale.items : [];

  const oldMap = new Map();

  for (const old of existingItems) {
    if (!old || typeof old !== 'object') continue;
    const key = old.item_id || (old.item && old.item.toString && old.item.toString()) || '';
    if (!key) continue;

    const qty = numberOrZero(old.quantity ?? old.item_quantity ?? 0, 0);
    if (qty <= 0) continue;

    oldMap.set(key, {
      raw: old,
      quantity: qty,
    });
  }

  const changesItems = [];

  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const key = item.item_id || (item.item && item.item.toString && item.item.toString()) || '';
      if (!key) continue;

      const newQty = numberOrZero(item.quantity, 0);
      if (newQty < 0) continue;

      const oldEntry = oldMap.get(key);
      let changeQty = 0;
      let process = '';

      if (!oldEntry) {
        if (newQty > 0) {
          changeQty = newQty;
          process = 'add';
        }
      } else {
        const oldQty = oldEntry.quantity;
        oldMap.delete(key);

        if (newQty > oldQty) {
          changeQty = newQty - oldQty;
          process = 'add';
        } else if (newQty < oldQty) {
          changeQty = oldQty - newQty;
          process = 'cancel';
        }
      }

      if (changeQty > 0) {
        const price = numberOrZero(
          item.sale_inline_item_price ??
            item.unit_price ??
            item.item_price ??
            item.item_price_total ??
            0,
          0
        );

        const itemId =
          item.item_id || (item.item && item.item.toString && item.item.toString()) || '';
        const itemName = item.name || item.item_name || '';
        const itemCode = item.item_sku || item.sku || item.barcode || item.barcode_id || '';
        const unit = item.item_unit || 'qty';
        const total = roundToTwo(price * changeQty);

        changesItems.push({
          item_id: itemId,
          item_name: itemName,
          item_quantity: changeQty,
          process,
          item_code: itemCode,
          unit,
          price,
          total,
        });
      }
    }
  }

  // Items that were completely removed => full cancellation
  for (const [key, oldEntry] of oldMap.entries()) {
    const old = oldEntry.raw;
    const qty = oldEntry.quantity;
    if (qty <= 0) continue;

    const price = numberOrZero(
      old.sale_inline_item_price ?? old.unit_price ?? old.item_price ?? old.item_price_total ?? 0,
      0
    );

    const itemId = old.item_id || (old.item && old.item.toString && old.item.toString()) || key;
    const itemName = old.name || old.item_name || '';
    const itemCode = old.item_sku || old.sku || old.barcode || old.barcode_id || '';
    const unit = old.item_unit || 'qty';
    const total = roundToTwo(price * qty);

    changesItems.push({
      item_id: itemId,
      item_name: itemName,
      item_quantity: qty,
      process: 'cancel',
      item_code: itemCode,
      unit,
      price,
      total,
    });
  }

  if (!changesItems.length) {
    return Array.isArray(existingSale?.changes) ? existingSale.changes : [];
  }

  const timestamp = saleDate instanceof Date ? saleDate : new Date();
  const existingChanges = Array.isArray(existingSale?.changes) ? existingSale.changes : [];

  return [
    ...existingChanges,
    {
      timestamp,
      items: changesItems,
    },
  ];
};

const resolveTimeZonePreference = (user = {}) => {
  return (
    user?.preferences?.time_zone ||
    user?.time_zone ||
    user?.timezone ||
    process.env.APP_TIMEZONE ||
    'UTC'
  );
};

const SALES_FILTER_MAP = {
  branch_id: 'branch',
  // Use canonical PHP-style identifier field for new and legacy sales
  sales_id: 'sales_id',
  // Date filters should operate on the explicit business dates stored
  // in the sales documents, not the removed Mongoose timestamps.
  created_date: 'created_date',
  updated_date: 'updated_date',
  date: 'date',
  customer_id: 'customer',
  customer_name: 'customer_name',
  customer_phone: 'customer_phone',
  customer_email: 'customer_email',
};

const parseSalesFilters = (rawFilters = {}) => {
  const parsed = typeof rawFilters === 'string' ? safeJsonParse(rawFilters, {}) : rawFilters || {};

  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  // PHP behavior: "All Time" means no date filtering.
  // Frontend sometimes keeps stale date range fields inside `filters`.
  // If we detect no meaningful date range, strip all date keys to avoid
  // the list unexpectedly shrinking (e.g. 32 -> 2 entries).
  const isEmptyRange = (v) => {
    if (!v || typeof v !== 'object') return true;
    const keys = Object.keys(v);
    if (keys.length === 0) return true;
    return keys.every((k) => v[k] === '' || v[k] === null || v[k] === undefined);
  };

  const dateKeys = ['date', 'created_date', 'updated_date', 'createdAt', 'updatedAt'];
  const hasAnyDateKey = dateKeys.some((k) => Object.prototype.hasOwnProperty.call(parsed, k));
  const hasMeaningfulDate = dateKeys.some((k) => {
    if (!Object.prototype.hasOwnProperty.call(parsed, k)) return false;
    const v = parsed[k];
    if (typeof v === 'string') return String(v).trim() !== '';
    if (typeof v === 'object') return !isEmptyRange(v);
    return false;
  });

  if (hasAnyDateKey && !hasMeaningfulDate) {
    for (const k of dateKeys) {
      delete parsed[k];
    }
  }

  const filter = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    const mappedKey = SALES_FILTER_MAP[key] || key;

    // Frontend "All Time" filter sometimes sends an empty object for date ranges.
    // Treat that as no-op (PHP behavior), otherwise it can unexpectedly shrink results.
    if (
      (mappedKey === 'createdAt' || mappedKey === 'date') &&
      typeof value === 'object' &&
      value !== null
    ) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return;
      }
      if (keys.every((k) => value[k] === '' || value[k] === null || value[k] === undefined)) {
        return;
      }
    }

    // Normalize legacy keys used by frontend filters.
    if (mappedKey === 'branch') {
      return;
    }
    if (mappedKey === 'sale_process') {
      // Stored field is typically sale_process; keep as-is.
    }

    if (
      mappedKey === 'createdAt' ||
      mappedKey === 'updatedAt' ||
      mappedKey === 'date' ||
      mappedKey === 'updated_date'
    ) {
      const range = typeof value === 'object' && value !== null ? value : undefined;
      if (range) {
        // For sales history we want updated_date to reflect the
        // business-side sale date (PHP's updated_date column), not
        // the internal Mongoose updatedAt timestamp.
        const finalKey = mappedKey;

        filter[finalKey] = {};
        if (range.$gte) {
          const start = parseSaleDate(range.$gte);
          if (start) filter[finalKey].$gte = start;
        }
        if (range.$lte) {
          const end = parseSaleDate(range.$lte);
          if (end) {
            // Set to end of day
            end.setHours(23, 59, 59, 999);
            filter[finalKey].$lte = end;
          }
        }
        if (!Object.keys(filter[finalKey]).length) {
          delete filter[finalKey];
        }
      }
      return;
    }

    if (typeof value === 'object' && value !== null) {
      const query = {};
      if (value.$regex) {
        query.$regex = value.$regex;
        query.$options = value.$options || 'i';
      }
      if (value.$in) {
        query.$in = value.$in;
      }
      if (Object.keys(query).length) {
        filter[mappedKey] = query;
        return;
      }
    }

    filter[mappedKey] = value;
  });
  return filter;
};

const parseBranchIdsFromRequest = (req) => {
  const parseValue = (value) => {
    if (!value && value !== 0) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => parseValue(entry));
    }
    if (typeof value === 'object') {
      // Handle common Mongo-style filter shapes like { $in: [...] }
      if (Array.isArray(value.$in)) {
        return value.$in.flatMap((entry) => parseValue(entry));
      }

      const candidates = [
        value.branch_id,
        value.branchId,
        value._id,
        value.id,
        value.$oid,
        value?.toString?.(),
      ];
      return candidates.filter(Boolean).flatMap((entry) => parseValue(entry));
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.flatMap((entry) => parseValue(entry));
          }
        } catch {
          return trimmed
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
        }
      }
      return [trimmed];
    }
    return [String(value)];
  };

  const branchInputs = [
    req.query?.branch,
    req.query?.['branch[]'],
    req.query?.branch_id,
    req.query?.branchId,
    req.query?.['branch_id[]'],
    req.body?.branch,
    req.body?.['branch[]'],
    req.body?.branch_id,
    req.body?.branchId,
    req.body?.['branch_id[]'],
  ];

  // Also consider branch information that may be embedded inside the
  // legacy `filters` payload from the frontend (e.g. filters.branch_id).
  const rawFilterPayload =
    typeof req.query?.filters !== 'undefined' ? req.query.filters : req.body?.filters;

  if (rawFilterPayload) {
    const parsedFilters =
      typeof rawFilterPayload === 'string'
        ? safeJsonParse(rawFilterPayload, {})
        : rawFilterPayload || {};

    if (parsedFilters && typeof parsedFilters === 'object') {
      branchInputs.push(
        parsedFilters.branch,
        parsedFilters['branch[]'],
        parsedFilters.branch_id,
        parsedFilters.branchId,
        parsedFilters['branch_id[]']
      );
    }
  }

  let branchIds = branchInputs
    .flatMap((value) => parseValue(value))
    .filter((value) => typeof value === 'string' && value.trim());

  if (!branchIds.length) {
    const fallbackBranch = resolveBranchId(req.user, req.session);
    if (fallbackBranch) {
      branchIds = [String(fallbackBranch)];
    }
  }

  const uniqueBranchIds = [...new Set(branchIds.map((id) => id.trim()).filter(Boolean))];

  const validBranchIds = uniqueBranchIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  return { uniqueBranchIds, validBranchIds };
};

const formatSaleListEntry = (saleDoc) => {
  if (!saleDoc) return null;
  const doc = typeof saleDoc.toObject === 'function' ? saleDoc.toObject() : saleDoc;

  const mapPaymentStatusForUi = (status) => {
    const raw = (status ?? '').toString().trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'completed' || raw === 'paid') return 'Paid';
    if (
      raw === 'pending' ||
      raw === 'partial' ||
      raw === 'partially_paid' ||
      raw === 'partialy paid'
    ) {
      // Use partial_balance to determine if payment was made
      const partialBalance = Number(doc?.partial_balance ?? 0) || 0;
      const paid = Number(doc?.paid_amount ?? doc?.paidAmount ?? partialBalance) || 0;
      if (paid <= 0) return 'Unpaid';
      // Return original status to preserve "Partialy Paid" spelling from database
      return status;
    }
    if (raw === 'cancelled' || raw === 'canceled') return 'Cancelled';
    if (raw === 'refunded') return 'Refunded';
    if (raw === 'partially_refunded') return 'Partially Refunded';
    return status;
  };

  const id = doc._id?.toString?.() || doc.id;
  const saleDate =
    parseSaleDate(doc.updated_date) ||
    parseSaleDate(doc.date) ||
    parseSaleDate(doc.createdAt) ||
    parseSaleDate(doc.created_date) ||
    new Date();

  // Derive a timezone-aware string representation so the frontend can
  // display date + time consistently regardless of branch changes.
  const stringDate = saleDate ? saleDate.toISOString() : '';

  const salesTotal = Number(doc.sales_total ?? doc.total ?? doc.items_total ?? 0);
  const subtotal = Number(doc.sales_sub_total ?? doc.subtotal ?? salesTotal);

  const customer = doc.customer && typeof doc.customer === 'object' ? doc.customer : undefined;

  return {
    _id: id,
    id,
    sales_id: doc.sales_id || doc.invoice_number || doc.alternative_id || '',
    customer_id: customer?._id?.toString?.() || doc.customer_id || doc.customer || null,
    customer_name: doc.customer_name || customer?.name || '',
    customer_phone: doc.customer_phone || customer?.phone || '',
    customer_email: doc.customer_email || customer?.email || '',
    sale_process: doc.sale_process || doc.status || 'Add',
    payment_mode: doc.payment_mode || '',
    payment_status: mapPaymentStatusForUi(doc.payment_status || ''),
    payment_description: doc.payment_description || doc.notes || '',
    sales_description: doc.sales_description || doc.notes || '',
    sales_total: roundToTwo(salesTotal),
    sales_sub_total: roundToTwo(subtotal),
    items_total: roundToTwo(doc.items_total ?? salesTotal),
    items_return_total: roundToTwo(doc.items_return_total ?? 0),
    items_subtotal: roundToTwo(doc.items_subtotal ?? subtotal),
    tax: roundToTwo(doc.tax ?? 0),
    discount: roundToTwo(doc.discount ?? 0),
    number_of_items: doc.number_of_items ?? (Array.isArray(doc.items) ? doc.items.length : 0),
    string_date: stringDate,
    date: saleDate,
    created_date: saleDate,
    updated_date: parseSaleDate(doc.updatedAt) || parseSaleDate(doc.updated_date) || null,
    created_by: doc.created_by || doc.user_name || undefined,
    branch_name: doc.branch_name,
    // KOT-specific fields required by frontend kot.js
    items: Array.isArray(doc.items)
      ? doc.items.map((item) => {
          if (!item || typeof item !== 'object') return item;
          return {
            item_id: item.item_id || item.item || item.itemId || '',
            item_name: item.item_name || item.name || item.itemName || '',
            item_description: item.item_description || item.description || '',
            item_price: Number(item.item_price || item.price || item.selling_price || 0) || 0,
            item_quantity: Number(item.item_quantity || item.quantity || item.qty || 0) || 0,
            item_unit: item.item_unit || item.unit || item.unit_name || 'qty',
            tax: Number(item.tax || item.item_tax_rate || item.tax_rate || 0) || 0,
            tax_type: item.tax_type || item.taxType || 'exclusive',
            discount_amount:
              Number(item.discount_amount || item.item_discount || item.discount || 0) || 0,
            discount_percentage:
              Number(item.discount_percentage || item.item_discount_percentage || 0) || 0,
            total_amount: Number(item.total_amount || item.item_total || item.total || 0) || 0,
          };
        })
      : [],
    person_count: doc.person_count ?? null,
    table_number: doc.table_number || null,
    table_id: doc.table_id || null,
    dine_type: doc.dine_type || null,
    sale_status: doc.sale_status || doc.payment_status || '',
    discount_percentage: roundToTwo(doc.discount_percentage ?? 0),
    discount_amount: roundToTwo(doc.discount_amount ?? 0),
    extra_discount: roundToTwo(doc.extra_discount ?? doc.extraDiscount ?? 0),
    round_off: roundToTwo(doc.round_off ?? doc.roundOff ?? 0),
  };
};

const formatDateForTimezone = (date, timeZone = 'UTC') => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  } catch (error) {
    return date.toISOString();
  }
};

const normalizeObjectIdCandidate = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) {
    return value._id;
  }
  return value;
};

const isValidObjectId = (value) => {
  const candidate = normalizeObjectIdCandidate(value);
  if (!candidate) return false;
  return mongoose.Types.ObjectId.isValid(candidate);
};

const tryGetModel = (name) => {
  try {
    return mongoose.model(name);
  } catch (error) {
    if (error.name !== 'MissingSchemaError') {
      // eslint-disable-next-line no-console
      console.warn(`Unable to load model ${name}:`, error.message);
    }
    return null;
  }
};

const resolveUserSummary = async (value) => {
  const candidate = normalizeObjectIdCandidate(value);
  if (isValidObjectId(candidate)) {
    try {
      const userDoc = await User.findById(candidate).select('name username email').lean();
      if (userDoc) {
        return {
          _id: userDoc._id?.toString?.(),
          name: userDoc.name || userDoc.username || userDoc.email || '',
          username: userDoc.username,
          email: userDoc.email,
        };
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to resolve user summary:', error.message);
    }
  }

  if (value && typeof value === 'object') {
    return {
      _id: value._id?.toString?.(),
      name: value.name || value.username || '',
    };
  }

  if (typeof value === 'string') {
    return { name: value };
  }

  return null;
};

const resolveCustomerSummary = async (value, fallbackName = '', fallbackPhone = '') => {
  const candidate = normalizeObjectIdCandidate(value);
  if (isValidObjectId(candidate)) {
    const CustomerModel = tryGetModel('Customer');
    if (CustomerModel) {
      try {
        const customerDoc = await CustomerModel.findById(candidate)
          .select('name phone email')
          .lean();
        if (customerDoc) {
          return {
            _id: customerDoc._id?.toString?.(),
            name: customerDoc.name || fallbackName,
            phone: customerDoc.phone || fallbackPhone,
            email: customerDoc.email || '',
          };
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to resolve customer summary:', error.message);
      }
    }
  }

  if (value && typeof value === 'object') {
    return {
      _id: value._id?.toString?.(),
      name: value.name || fallbackName,
      phone: value.phone || fallbackPhone,
      email: value.email || '',
    };
  }

  return {
    name: fallbackName,
    phone: fallbackPhone,
  };
};

module.exports = {
  REPORT_TYPES,
  DEFAULT_REPORT_TYPE,
  normalizeReportType,
  getDateRangeForType,
  roundToTwo,
  extractNumericValue,
  numberOrZero,
  numberOrNull,
  toNumberExpression,
  PAYMENT_MODE_DEFAULT,
  PAYMENT_MODE_CANONICAL_MAP,
  PAYMENT_METHOD_LOOKUP,
  normalizePaymentMode,
  mapPaymentModeToMethod,
  SALE_PROCESS_DEFAULT,
  SALE_PROCESS_CANONICAL_MAP,
  normalizeSaleProcess,
  normalizeToMongooseId,
  resolveBranchId,
  resolveRequestBranchId,
  parseSaleDate,
  normalizeRangeDate,
  filterInstantItems,
  calculateInstantMetrics,
  normalizeSaleItems,
  computePhpPaymentMeta,
  buildChangesForCreate,
  buildChangesForUpdate,
  resolveTimeZonePreference,
  SALES_FILTER_MAP,
  parseSalesFilters,
  parseBranchIdsFromRequest,
  formatSaleListEntry,
  formatDateForTimezone,
  resolveUserSummary,
  resolveCustomerSummary,
};
