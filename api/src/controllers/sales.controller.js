// src/controllers/sales_controller.js
const BaseController = require('./base.controller');
const { currentConnection } = require('../db/tenant-context');
const Sale = require('../models/sale.model');
const BaseModel = require('../models/base.model');
const mongoose = require('mongoose');
const salesService = require('../services/sale.service');
const ItemService = require('../services/item.service');
const LoyaltyService = require('../services/loyalty.service');
const loyaltyService = new LoyaltyService();
const CouponService = require('../services/coupon.service');
const couponService = new CouponService();
const CreditService = require('../services/credit.service');
const creditService = new CreditService();
const CashbackService = require('../services/cashback.service');
const cashbackService = new CashbackService();
const { createActivityLog } = require('../utils/activityLogger');
const { AuditService, AUDIT_EVENTS } = require('../services/audit.service');
const { canPos } = require('../utils/pos-permission.util');
const { isApprovedFor } = require('../utils/approval-token.util');
const sessionFilterUtil = require('../utils/session-filter.util');
const { SALE_STATUS } = require('../constants');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  GRAPH_ALLOWED_SALE_PROCESSES,
} = require('../constants/sales.constants');
const { safeJsonParse, formatDate } = require('../utils/helpers');
const {
  roundToTwo,
  numberOrZero,
  normalizeToMongooseId,
  resolveBranchId,
  parseSaleDate,
  normalizeRangeDate,
  calculateInstantMetrics,
  normalizeSaleItems,
  resolveTimeZonePreference,
  parseSalesFilters,
  parseBranchIdsFromRequest,
  formatSaleListEntry,
  formatDateForTimezone,
} = require('../helpers/sales.helper');
const path = require('path');
const fs = require('fs');
const { getRequestDeviceId } = require('../utils/device-id.util');

const auditNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const auditFirstNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '' || value === 'undefined') continue;
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const auditItems = (payload) => {
  let items = payload?.items || [];
  if (typeof items === 'string') items = safeJsonParse(items, []);
  return Array.isArray(items) ? items : [];
};

const auditItemId = (item) => String(item?.item_id?._id || item?.item_id || item?._id || '');
const auditItemPrice = (item) =>
  auditFirstNumber(
    item?.sale_inline_item_price,
    item?.item_price_total,
    item?.item_price,
    item?.selling_price
  );
const auditItemDiscount = (item) => ({
  amount: auditFirstNumber(
    item?.sale_inline_discount_value,
    item?.item_discount,
    item?.discount_amount
  ),
  percentage: auditFirstNumber(
    item?.sale_inline_discount_pervalue,
    item?.item_discount_percentage,
    item?.discount_percentage
  ),
});

// Best-effort percent estimate of a sale's manual discount, for the role's
// discount_max_percent cap: the larger of (total discount amount / subtotal)
// and any raw percent entered on a line or the extra discount. Mirrors the
// till's estimate (sales.js _manualDiscountPct).
const estimateManualDiscountPct = (payload) => {
  const subtotal = auditFirstNumber(payload?.sales_sub_total, payload?.sales_total);
  let amount = 0;
  let maxPct = 0;
  auditItems(payload).forEach((item) => {
    const d = auditItemDiscount(item);
    amount += d.amount;
    if (d.percentage > maxPct) maxPct = d.percentage;
  });
  const extra = auditNumber(payload?.extra_discount);
  if (extra > 0) {
    if ((payload?.extra_discount_type || 'price') === 'percent') {
      if (extra > maxPct) maxPct = extra;
    } else {
      amount += extra;
    }
  }
  if (subtotal > 0) {
    const pctOfBill = (amount / subtotal) * 100;
    if (pctOfBill > maxPct) maxPct = pctOfBill;
  }
  return maxPct;
};

const collectSaleAuditChanges = async (payload, existingSale = null) => {
  const incoming = auditItems(payload);
  const oldItems = auditItems(existingSale);
  const oldById = new Map(oldItems.map((item) => [auditItemId(item), item]));
  const priceChanges = [];
  const discounts = [];

  incoming.forEach((item) => {
    const id = auditItemId(item);
    const oldItem = oldById.get(id);
    const oldPrice = oldItem
      ? auditItemPrice(oldItem)
      : auditFirstNumber(item?.audit_original_price);
    const newPrice = auditItemPrice(item);
    if (oldPrice > 0 && Math.abs(oldPrice - newPrice) > 0.0001) {
      priceChanges.push({
        type: 'price_change',
        item_id: id,
        item_name: item.item_name || oldItem?.item_name || '',
        old_price: oldPrice,
        new_price: newPrice,
      });
    }

    const newDiscount = auditItemDiscount(item);
    const oldDiscount = oldItem ? auditItemDiscount(oldItem) : { amount: 0, percentage: 0 };
    if (
      (newDiscount.amount > 0 || newDiscount.percentage > 0) &&
      (newDiscount.amount !== oldDiscount.amount ||
        newDiscount.percentage !== oldDiscount.percentage)
    ) {
      discounts.push({
        type: 'inline_discount',
        discount_type: newDiscount.percentage > 0 ? 'percent' : 'price',
        item_id: id,
        item_name: item.item_name || oldItem?.item_name || '',
        old_value: newDiscount.percentage > 0 ? oldDiscount.percentage : oldDiscount.amount,
        new_value: newDiscount.percentage > 0 ? newDiscount.percentage : newDiscount.amount,
        old_amount: oldDiscount.amount,
        new_amount: newDiscount.amount,
        old_percentage: oldDiscount.percentage,
        new_percentage: newDiscount.percentage,
      });
    }
  });

  const oldExtra = auditNumber(existingSale?.extra_discount);
  const newExtra = auditNumber(payload?.extra_discount);
  if (newExtra > 0 && newExtra !== oldExtra) {
    discounts.push({
      type: 'extra_discount',
      old_value: oldExtra,
      new_value: newExtra,
      discount_type: payload?.extra_discount_type || existingSale?.extra_discount_type || 'price',
    });
  }
  return { priceChanges, discounts };
};

// Sensitive sale actions also belong in the canonical accountability trail
// (audit_log) that the shift / payout reports read - separate from the activity
// feed written by createActivityLog. Map the activity action -> AUDIT_EVENTS.
const SALE_AUDIT_EVENT = {
  delete: AUDIT_EVENTS.SALE_VOID,
  cancel: AUDIT_EVENTS.SALE_VOID,
  refund: AUDIT_EVENTS.SALE_REFUND,
  discount: AUDIT_EVENTS.DISCOUNT_APPLIED,
  price_change: AUDIT_EVENTS.PRICE_OVERRIDE,
};

const writeSaleAudit = async (req, action, entityId, description, changes) => {
  const user = req.user || {};
  await createActivityLog({
    user: user._id,
    userName: user.username || user.name || user.email || 'System',
    action,
    entity: 'sale',
    entityId,
    description,
    changes,
    branch: resolveBranchId(user, req.session) || BaseModel.currentBranch,
    license: user.license || user.licenseId || BaseModel.license,
    ipAddress: req.ip,
    userAgent: typeof req.get === 'function' ? req.get('user-agent') : req.headers?.['user-agent'],
  });

  // Mirror sensitive actions into the append-only accountability trail. Actor +
  // tenant are passed explicitly (same source as the activity log) so this does
  // not depend on the per-request context being set. Fail-safe: record() never
  // throws, so an audit failure can never break the sale operation.
  const event = SALE_AUDIT_EVENT[action];
  if (event) {
    await new AuditService().record(event, {
      entity: 'sale',
      entity_id: entityId,
      actor_user_id: user._id,
      actor_name: user.username || user.name || user.email || null,
      license: user.license || user.licenseId || BaseModel.license,
      branch_id: resolveBranchId(user, req.session) || BaseModel.currentBranch,
      amount: changes && typeof changes.total === 'number' ? changes.total : undefined,
      reason: description,
      details: changes && typeof changes === 'object' ? changes : undefined,
    });
  }
};

const duplicateSaleData = (sale) => ({
  _id: sale._id,
  sales_id: sale._id,
  sale_number: sale.sales_id || '',
  duplicate: true,
  sms: false,
  whatsapp: false,
  print: false,
  mail: false,
  waring: 'success',
  name: sale.customer_name || '',
  phone: sale.customer_phone || '',
  customer_balance: 0,
  country_sort: sale.country_sort || 'in',
});

const findSaleByBillingTransaction = async (license, transactionId) => {
  const query = Sale.findOne({
    license,
    billing_transaction_id: transactionId,
  });
  return query && typeof query.lean === 'function' ? query.lean() : query;
};

const dejavuSansCondensedPath = path.join(
  __dirname,
  '../../../Api/src/vendor/mpdf/mpdf/ttfonts/DejaVuSansCondensed.ttf'
);
const windowsFontDir =
  process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts') : '';
const reportUnicodeFontPath = windowsFontDir ? path.join(windowsFontDir, 'segoeui.ttf') : '';
const reportUnicodeBoldFontPath = windowsFontDir ? path.join(windowsFontDir, 'segoeuib.ttf') : '';

class SalesController extends BaseController {
  constructor() {
    super(Sale);
    this.model = Sale;
    this.itemService = new ItemService();
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.getAll = this.getAll.bind(this);
    this.dailySalesReports = this.dailySalesReports.bind(this);
    this.salesGraphicalReports = this.salesGraphicalReports.bind(this);
    this.salesReports = this.salesReports.bind(this);
    this.salesSummaryReports = this.salesSummaryReports.bind(this);
    this.instantSalesReports = this.instantSalesReports.bind(this);
    this.instantSaleDetails = this.instantSaleDetails.bind(this);
    this.categorySalesReportTable = this.categorySalesReportTable.bind(this);
    this.getLatestSales = this.getLatestSales.bind(this);
    this.holdSale = this.holdSale.bind(this);
    this.delete = this.delete.bind(this);
    this.resolveBranchContext = this.resolveBranchContext.bind(this);
  }

  /**
   * Set branch / license / user context on BaseModel so that legacy-
   * style static model methods (sales_model.php parity) can read the same
   * globals as the PHP code did.
   */
  setRequestContext(req) {
    const user = req.user || {};
    const sessionBranch =
      req.tenantContext?.branchId || req.session?.selectedBranchId || req.session?.branch_id;
    const branchAccessEntry = Array.isArray(user.branch_access) ? user.branch_access[0] : null;

    const branchParam =
      sessionBranch ||
      req.query?.branch_id ||
      req.query?.branch ||
      req.body?.branch_id ||
      req.body?.branch ||
      user.branch_id ||
      (user.branch && (user.branch._id || user.branch.id)) ||
      user.default_branch_id ||
      (branchAccessEntry && (branchAccessEntry.branch_id || branchAccessEntry._id)) ||
      null;

    if (branchParam) {
      const raw = Array.isArray(branchParam) ? branchParam[0] : branchParam;
      if (raw instanceof mongoose.Types.ObjectId) {
        BaseModel.currentBranch = raw;
      } else if (mongoose.Types.ObjectId.isValid(String(raw))) {
        BaseModel.currentBranch = new mongoose.Types.ObjectId(String(raw));
      } else {
        BaseModel.currentBranch = raw;
      }
    }

    const licenseParam =
      req.tenantContext?.licenseId ||
      user.license ||
      user.license_id ||
      req.query?.license_id ||
      req.body?.license_id ||
      null;

    if (licenseParam) {
      if (licenseParam instanceof mongoose.Types.ObjectId) {
        BaseModel.license = licenseParam;
      } else if (mongoose.Types.ObjectId.isValid(String(licenseParam))) {
        BaseModel.license = new mongoose.Types.ObjectId(String(licenseParam));
      } else {
        BaseModel.license = licenseParam;
      }
    }

    if (user._id) {
      if (user._id instanceof mongoose.Types.ObjectId) {
        BaseModel.loggedUser = user._id;
      } else if (mongoose.Types.ObjectId.isValid(String(user._id))) {
        BaseModel.loggedUser = new mongoose.Types.ObjectId(String(user._id));
      } else {
        BaseModel.loggedUser = user._id;
      }
    }

    // Prefer login identifier (username/email) for audit trails like stock logs
    const userName = user.username || user.email || user.name;
    if (userName) {
      BaseModel.loggedUserName = userName;
    }

    BaseModel.loggedUserDetails = user;
  }

  async ensureContext(req) {
    this.setRequestContext(req);
  }

  resolveBranchContext(req) {
    const branchId = resolveBranchId(req.user, req.session) || BaseModel.currentBranch;

    let branchName = req.session?.selectedBranchName || null;
    if (!branchName) {
      const branchCandidate = req.user?.branch;
      if (branchCandidate && typeof branchCandidate === 'object') {
        branchName =
          branchCandidate.branch_name || branchCandidate.name || branchCandidate.store_name || null;
      }
    }

    const normalizedBranchId =
      branchId instanceof mongoose.Types.ObjectId
        ? branchId
        : branchId && mongoose.Types.ObjectId.isValid(String(branchId))
          ? new mongoose.Types.ObjectId(String(branchId))
          : null;

    return {
      branch_id: normalizedBranchId,
      branch_name: branchName,
    };
  }

  // Per-request context the loyalty engine needs: which branch, who, and the
  // branch's currency (display-only - the maths is a pure ratio and never looks
  // at the currency). license is already on BaseModel via the tenant middleware.
  buildLoyaltyCtx(req) {
    const u = req.user || {};
    const { branch_id, branch_name } = this.resolveBranchContext(req);
    return {
      branchId: branch_id,
      branchName: branch_name,
      userName: u.username || u.name || u.email || 'System',
      userId: u._id || u.id || null,
      currency: (req.tenantContext && req.tenantContext.currency) || u.currency_type || '',
    };
  }

  /*
   * Turn a redemption request into a validated discount before the sale is
   * priced. The client only says how many points the customer wants to spend;
   * the server decides what that is worth, against this branch's loyalty rules
   * and the customer's real balance, and caps it at the configured share of the
   * bill. An invalid or stale request is dropped (the sale proceeds at full
   * price) rather than allowed to fail the sale.
   */
  async prepareLoyaltyRedemption(req, payload) {
    try {
      const requested = Math.max(
        0,
        parseInt(
          payload.redeem_points != null ? payload.redeem_points : payload.loyalty_redeem_points,
          10
        ) || 0
      );
      // The server owns these fields; never trust a client-sent value.
      payload.loyalty_redeem_points = 0;
      delete payload.loyalty_redeem_value;
      if (!requested || !payload.customer_id) return;
      if (!mongoose.Types.ObjectId.isValid(String(payload.customer_id))) return;

      const ctx = this.buildLoyaltyCtx(req);
      const cfg = await loyaltyService.getConfig(ctx.branchId);
      if (!cfg || !cfg.enabled) return;

      const db = await BaseModel.getDb();
      const cust = await db.collection('customers').findOne({
        _id: new mongoose.Types.ObjectId(String(payload.customer_id)),
        license: BaseModel.license,
      });
      const available = cust && cust.loyalty ? Number(cust.loyalty.points) || 0 : 0;
      const billBasis = Number(payload.loyalty_bill_total || payload.sales_total || 0);
      const r = LoyaltyService.computeRedeem(requested, billBasis, available, cfg);
      if (!r.valid) {
        console.error('[loyalty] redemption ignored:', r.error);
        return;
      }
      payload.loyalty_redeem_points = r.points;
      payload.loyalty_redeem_value = r.value;
    } catch (e) {
      console.error('[loyalty] prepare redemption skipped:', e && e.message);
      payload.loyalty_redeem_points = 0;
      delete payload.loyalty_redeem_value;
    }
  }

  /*
   * Turn a coupon code into a validated discount before the sale is priced. The
   * client sends a code; the server decides what it is worth against this
   * branch's coupons and the customer, and caps it. The validated code and its
   * value ride into processSale as a fixed discount; an invalid or stale code is
   * dropped (the sale proceeds at full price) rather than allowed to fail it.
   */
  async prepareCouponRedemption(req, payload) {
    try {
      const code = String(payload.coupon_code || '').trim();
      // The server owns the applied value; never trust a client-sent amount.
      payload.coupon_discount_value = 0;
      if (!code) {
        payload.coupon_code = '';
        return;
      }
      const ctx = this.buildLoyaltyCtx(req);
      const billBasis = Number(payload.loyalty_bill_total || payload.sales_total || 0);
      const r = await couponService.validate(code, {
        billTotal: billBasis,
        customerId: payload.customer_id || null,
        branchId: ctx.branchId,
      });
      if (!r.valid || !r.data) {
        console.error('[coupon] code ignored:', r.message);
        payload.coupon_code = '';
        return;
      }
      payload.coupon_code = r.data.code;
      payload.coupon_discount_value = r.data.discount;
    } catch (e) {
      console.error('[coupon] prepare redemption skipped:', e && e.message);
      payload.coupon_code = '';
      payload.coupon_discount_value = 0;
    }
  }

  /*
   * Enforce the customer's credit limit before an on-credit sale is priced. Only
   * an explicit credit sale (partial, or the unpaid toggle) counts; a normal paid
   * sale is never touched. Returns { blocked, error } - blocked only when a limit
   * is actually configured and this sale would break it. Fail-open: any error in
   * the check lets the sale through rather than blocking a shop over a glitch.
   */
  async checkCustomerCreditLimit(req, payload) {
    try {
      const customerId = payload.customer_id;
      if (!customerId) return { blocked: false };
      const total = Number(payload.sales_total) || 0;
      let creditAmount = 0;
      if (String(payload.partial_check) === 'true') {
        creditAmount = total - (Number(payload.partial_balance) || 0);
      } else if (String(payload.unpaid) === 'true') {
        creditAmount = total;
      }
      if (creditAmount <= 0) return { blocked: false };
      const ctx = this.buildLoyaltyCtx(req);
      const r = await creditService.checkCreditLimit(customerId, creditAmount, ctx.branchId);
      if (r && !r.allowed) {
        return {
          blocked: true,
          error: `Credit limit exceeded — limit ${r.limit}, already outstanding ${r.outstanding}, this sale would make it ${r.wouldBe}.`,
          data: r,
        };
      }
      return { blocked: false };
    } catch (e) {
      console.error('[credit] limit check skipped:', e && e.message);
      return { blocked: false };
    }
  }

  /*
   * Loyalty is a side effect of a completed sale, not part of saving one. It
   * runs after the sale is safely committed and is wrapped so that a loyalty
   * failure can never fail a sale. Walk-in sales (no customer) do nothing. Both
   * the spend and the earn are idempotent per sale, so a retry or an Edit will
   * not double-spend points or double-credit them.
   */
  async applyLoyaltyEarn(req, saleData) {
    try {
      const saleId = saleData && (saleData._id || saleData.sales_id);
      if (!saleId) return;
      const SaleModel = this.model || Sale;
      const sale = await salesService.getSaleById(saleId, { SaleModel });
      if (!sale || !sale.customer_id) return; // walk-in => no loyalty
      if (sale.status === SALE_STATUS.CANCELLED) return;
      const ctx = this.buildLoyaltyCtx(req);

      // Spend first: the points the customer chose to redeem on this bill.
      const redeemPts = Math.max(0, parseInt(sale.loyalty_redeem_points, 10) || 0);
      if (redeemPts > 0) {
        await loyaltyService.applyRedeemPoints(sale.customer_id, {
          points: redeemPts,
          value: Number(sale.loyalty_redeem_value) || 0,
          saleId: sale._id || saleId,
          reference: sale.sales_id || '',
          ctx,
        });
      }

      // Then earn on what they actually paid (already net of the redemption).
      const amount = Number(sale.sales_total || sale.total || 0);
      if (amount > 0) {
        await loyaltyService.earn(sale.customer_id, {
          amount,
          saleId: sale._id || saleId,
          reference: sale.sales_id || '',
          ctx,
        });
        // If this is the referred customer's first qualifying purchase, reward
        // both them and whoever referred them.
        await loyaltyService.grantReferralIfEligible(sale.customer_id, {
          amount,
          saleId: sale._id || saleId,
          ctx,
        });
      }
    } catch (e) {
      console.error('[loyalty] sale hook skipped:', e && e.message);
    }
  }

  /*
   * Record a coupon redemption once the sale is committed - separate from
   * loyalty because a coupon needs no customer (walk-in sales can use one). The
   * discount was already applied to the bill in processSale; this just books the
   * usage. Idempotent per sale and wrapped so it can never fail a sale.
   */
  async applyCoupon(req, saleData) {
    try {
      const saleId = saleData && (saleData._id || saleData.sales_id);
      if (!saleId) return;
      const SaleModel = this.model || Sale;
      const sale = await salesService.getSaleById(saleId, { SaleModel });
      if (!sale || sale.status === SALE_STATUS.CANCELLED) return;
      const code = (sale.coupon_code || '').toString().trim();
      const discount = Number(sale.coupon_discount_value) || 0;
      if (!code || !(discount > 0)) return;
      await couponService.apply(code, {
        saleId: sale._id || saleId,
        customerId: sale.customer_id || null,
        customerName: sale.customer_name || '',
        billTotal: Number(sale.sales_total || sale.total || 0),
        discount,
        reference: sale.sales_id || '',
        ctx: this.buildLoyaltyCtx(req),
      });
    } catch (e) {
      console.error('[coupon] apply skipped:', e && e.message);
    }
  }

  /*
   * Mint a cashback coupon for a completed sale - a discount the customer can
   * spend on their next visit. Idempotent per sale, and wrapped so it can never
   * fail a sale. Works for walk-in sales too; delivery just needs a phone.
   */
  async applyCashback(req, saleData) {
    try {
      const saleId = saleData && (saleData._id || saleData.sales_id);
      if (!saleId) return;
      const SaleModel = this.model || Sale;
      const sale = await salesService.getSaleById(saleId, { SaleModel });
      if (!sale || sale.status === SALE_STATUS.CANCELLED) return;
      await cashbackService.issueForSale(sale, { ctx: this.buildLoyaltyCtx(req) });
    } catch (e) {
      console.error('[cashback] issue skipped:', e && e.message);
    }
  }

  // Shared internal implementation for creating or holding a sale (PHP salesInsertUpdate parity)
  // A manual discount (line or extra) detected on this sale is a restricted
  // till action. If this user can't apply discounts on their own, a valid
  // manager-approval token is required - the same server-side gate as
  // void/refund. Coupon and loyalty discounts are validated by their own rules
  // (prepareCouponRedemption / prepareLoyaltyRedemption) and are never counted
  // by collectSaleAuditChanges, so they never trip this. Fails open for
  // unconfigured users so existing tills are never blocked.
  discountNeedsApproval(req, payload, auditChanges) {
    if (!auditChanges || !Array.isArray(auditChanges.discounts) || !auditChanges.discounts.length) {
      return false;
    }
    if (canPos(req.user, 'discount_apply')) {
      // Allowed to discount - but the role may cap how deep (0 = no cap).
      const pos = (req.user && req.user.access && req.user.access.pos) || {};
      const cap = Number(pos.discount_max_percent) || 0;
      if (cap <= 0 || estimateManualDiscountPct(payload) <= cap) return false;
    }
    const token =
      (payload && payload.approval_token) || (req.body && req.body.approval_token) || null;
    return !isApprovedFor(token, 'discount_apply', req.user && req.user._id);
  }

  async createOrHoldInternal(
    req,
    res,
    next,
    { processOverride = null, successMessage = SUCCESS_MESSAGES.SALE_ADDED } = {}
  ) {
    try {
      let payload = req.createSalePayload || req.body;
      if (typeof payload === 'string') {
        payload = safeJsonParse(payload, req.body);
      } else if (payload && typeof payload.data === 'string') {
        // Handle "data" wrapper (legacy PHP structure)
        payload = safeJsonParse(payload.data, payload);
      }

      await this.ensureContext(req); // Ensure BaseModel globals are set
      const { branch_id, branch_name } = this.resolveBranchContext(req);
      const user = req.user || {};
      const billingTransactionId = String(payload.billing_transaction_id || '').trim();
      if (billingTransactionId) {
        payload.billing_transaction_id = billingTransactionId.slice(0, 128);
        const existingSale = await findSaleByBillingTransaction(
          BaseModel.license || user.license || user.license_id,
          payload.billing_transaction_id
        );
        if (existingSale) {
          return this.success(
            res,
            duplicateSaleData(existingSale),
            'Sale already saved. Duplicate billing prevented.',
            200
          );
        }
      }

      // Build Context for Service
      let context = {
        branchId: branch_id,
        branchName: branch_name,
        licenseId: BaseModel.license || user.license || user.license_id,
        userId: user._id,
        userName: user.username || user.name || 'System',
        deviceId: getRequestDeviceId(req),
        salesPrefix: 'INV',
        stockManagement: true,
        stockLogStatus: true,
        roundOff: true,
        branchSettings: {},
        branchState: '',
      };

      // Enrich the context with branch-specific settings via the service
      context = await salesService.enrichSaleContext(context);

      // Delegate core Add / Hold business logic to salesService.processSale,
      // which is a line-by-line port of PHP sales_model::salesInsertUpdate.
      const processValue =
        processOverride != null && processOverride !== undefined ? processOverride : 'Add';
      const auditChanges =
        processValue === 'Hold'
          ? { priceChanges: [], discounts: [] }
          : await collectSaleAuditChanges(payload);

      if (processValue !== 'Hold' && this.discountNeedsApproval(req, payload, auditChanges)) {
        return this.error(res, ERROR_MESSAGES.DISCOUNT_NEEDS_APPROVAL, 403);
      }

      // Validate any loyalty redemption and coupon BEFORE the sale is priced, so
      // the discounts that reach processSale are ones the branch's rules, the
      // customer's balance and the coupon's limits actually allow. A held bill
      // earns and spends nothing.
      if (processValue !== 'Hold') {
        await this.prepareLoyaltyRedemption(req, payload);
        await this.prepareCouponRedemption(req, payload);
        const creditCheck = await this.checkCustomerCreditLimit(req, payload);
        if (creditCheck.blocked) {
          return this.error(res, creditCheck.error, 400, creditCheck.data);
        }
      }

      const result = await salesService.processSale(payload, '', processValue, context);

      if (!result || typeof result !== 'object') {
        return this.error(res, ERROR_MESSAGES.FAILED_TO_SAVE_SALE_UNEXPECTED, 500);
      }

      if (result.status !== true) {
        if (billingTransactionId && /duplicate key|E11000/i.test(result.message || '')) {
          const existingSale = await findSaleByBillingTransaction(
            BaseModel.license || user.license || user.license_id,
            payload.billing_transaction_id
          );
          if (existingSale) {
            return this.success(
              res,
              duplicateSaleData(existingSale),
              'Sale already saved. Duplicate billing prevented.',
              200
            );
          }
        }
        // Mirror PHP controller behaviour: bubble up model message and data
        // when salesInsertUpdate fails.
        return this.error(res, result.message || ERROR_MESSAGES.SALES_NOT_ADDED, 400, result.data);
      }

      const message =
        processValue === 'Hold'
          ? 'Sales has been successfully hold'
          : result.message || successMessage;

      const auditSaleId =
        result.data?.sale_number ||
        result.data?.sales_id ||
        result.data?.sale_id ||
        result.data?._id ||
        result.data?.id ||
        'new-sale';
      if (auditChanges.priceChanges.length) {
        await writeSaleAudit(
          req,
          'price_change',
          auditSaleId,
          'Item price changed during sale',
          auditChanges.priceChanges
        );
      }
      if (auditChanges.discounts.length) {
        await writeSaleAudit(
          req,
          'discount',
          auditSaleId,
          'Discount applied during sale',
          auditChanges.discounts
        );
      }

      // A held bill is not a completed sale, so it earns/redeems nothing yet.
      if (processValue !== 'Hold') {
        await this.applyLoyaltyEarn(req, result.data);
        await this.applyCoupon(req, result.data);
        await this.applyCashback(req, result.data);
      }

      return this.success(res, result.data, message, 200);
    } catch (error) {
      next(error);
    }
  }

  // Create a new sale
  async create(req, res, next) {
    return this.createOrHoldInternal(req, res, next, {
      processOverride: null,
      successMessage: SUCCESS_MESSAGES.SALE_ADDED,
    });
  }

  async update(req, res, next) {
    try {
      if (!this.checkPermission('sales', 'write', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED_UPDATE_SALES, 403);
      }

      const { id } = req.params;
      let payload = req.updateSalePayload;
      let normalizedItems = req.updateSaleItems;

      if (!payload) {
        payload = req.body;
        if (typeof payload === 'string') {
          payload = safeJsonParse(payload, null);
        }

        if (!payload || typeof payload !== 'object') {
          return this.error(res, ERROR_MESSAGES.INVALID_SALE_PAYLOAD, 400);
        }

        let rawItems = payload.items;
        if (typeof rawItems === 'string') {
          rawItems = safeJsonParse(rawItems, []);
        }

        normalizedItems = normalizeSaleItems(rawItems);

        if (!normalizedItems.length) {
          return this.error(res, ERROR_MESSAGES.AT_LEAST_ONE_VALID_SALE_ITEM_REQUIRED, 400);
        }
      }

      await this.ensureContext(req);
      const { branch_id, branch_name } = this.resolveBranchContext(req);
      const user = req.user || {};

      let context = {
        branchId: branch_id,
        branchName: branch_name,
        licenseId: BaseModel.license || user.license || user.license_id,
        userId: user._id,
        userName: user.username || user.name || 'System',
        deviceId: getRequestDeviceId(req),
        salesPrefix: 'INV',
        stockManagement: true,
        stockLogStatus: true,
        roundOff: true,
        branchSettings: {},
        branchState: '',
      };

      if (!branch_id) {
        return this.error(res, ERROR_MESSAGES.BRANCH_CONTEXT_REQUIRED_UPDATE, 400);
      }

      const SaleModel = this.model || Sale;
      // Verify the sale exists via the service helper to keep DB access
      // out of the controller layer while preserving the 404 behaviour.
      const existingSale = await salesService.getSaleById(id, { SaleModel });

      if (!existingSale) {
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }

      const auditChanges = await collectSaleAuditChanges(payload, existingSale);

      if (this.discountNeedsApproval(req, payload, auditChanges)) {
        return this.error(res, ERROR_MESSAGES.DISCOUNT_NEEDS_APPROVAL, 403);
      }

      // Delegate Edit business logic to salesService.processSale (PHP
      // salesInsertUpdate parity for $process = 'Edit').
      // Enrich the context with branch-specific settings via the service
      context = await salesService.enrichSaleContext(context);

      const result = await salesService.processSale(payload, id, 'Edit', context);

      if (!result || typeof result !== 'object') {
        return this.error(res, ERROR_MESSAGES.FAILED_TO_UPDATE_SALE_UNEXPECTED, 500);
      }

      if (result.status !== true) {
        return this.error(
          res,
          result.message || ERROR_MESSAGES.SALES_NOT_UPDATED,
          400,
          result.data
        );
      }

      if (auditChanges.priceChanges.length) {
        await writeSaleAudit(
          req,
          'price_change',
          existingSale.sales_id || id,
          'Item price changed while editing sale',
          auditChanges.priceChanges
        );
      }
      if (auditChanges.discounts.length) {
        await writeSaleAudit(
          req,
          'discount',
          existingSale.sales_id || id,
          'Discount changed while editing sale',
          auditChanges.discounts
        );
      }

      // PHP sales.php::edit() forwards the model message directly.
      return this.success(res, result.data, result.message || SUCCESS_MESSAGES.SALE_UPDATED, 200);
    } catch (error) {
      next(error);
    }
  }

  // Get all sales with filtering and pagination (legacy frontend-compatible)
  async getAll(req, res, next) {
    try {
      if (!this.checkPermission('sales', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED_VIEW_SALES, 403);
      }

      await this.ensureContext(req);

      const { page = 1, limit = 10, filters: rawFilters } = req.query;

      const numericLimit = Math.max(1, parseInt(limit, 10) || 10);
      const numericPage = Math.max(1, parseInt(page, 10) || 1);

      const SaleModel = this.model || Sale;

      // Parse legacy filters coming from the frontend (date range, sale_process, etc.)
      const parsedFilters = parseSalesFilters(rawFilters || {});

      // Apply session filtering to sales filters if user has permission
      const filteredSalesFilters = await sessionFilterUtil.applySessionFilterToSalesFilters(
        req,
        parsedFilters
      );

      console.log('🔍 Sales List - Session filter applied:', {
        original_filters: parsedFilters,
        filtered_filters: filteredSalesFilters,
        session_applied: JSON.stringify(filteredSalesFilters) !== JSON.stringify(parsedFilters),
      });

      // Apply branch scoping similar to PHP behaviour
      const { validBranchIds } = parseBranchIdsFromRequest(req);
      const filter = { ...filteredSalesFilters };
      if (validBranchIds.length) {
        // PHP sales list historically filters on branch_id; mirror that
        // here so we correctly match both legacy PHP documents (which
        // only had branch_id) and new Node sales (where branch_id is
        // synced from branch in the pre-save hook).
        filter.branch_id = { $in: validBranchIds };
      }

      // License scoping: in the PHP code, almost all sales queries
      // include the current license as part of the match filter. The
      // BaseModel.license value is set in ensureContext, so
      // enforce the same constraint here to avoid cross-license or
      // cross-branch bleed-through.
      if (BaseModel.license) {
        filter.license = BaseModel.license;
      }

      // By default, hide cancelled sales in history unless explicitly requested
      if (!Object.prototype.hasOwnProperty.call(filter, 'status')) {
        filter.status = { $ne: SALE_STATUS.CANCELLED };
      }

      // Match PHP salePage default ordering where the latest sales
      // (by business sale date) appear first. PHP's parent::page()
      // effectively sorts by the stored sale date / _id descending.
      // Use date / created_date as the primary keys and fall back to
      // _id so that newly inserted sales and imported legacy records
      // both surface at the top of the Sales History list.
      const options = {
        page: numericPage,
        limit: numericLimit,
        /*
         * Newest rung up, first - ordered by when the sale was recorded,
         * not by the date written on it.
         *
         * These were the other way round, and a shop noticed the way
         * anybody would: took a sale, opened Sales History, and it was not
         * at the top. It was there, second, because an older sale carried a
         * later time of day. `date` is the business date - it can be
         * backdated by hand and, on a till whose clock has drifted, it can
         * simply be wrong. Either way it does not answer "did the sale I
         * just took save?", which is the question this screen gets opened
         * to answer.
         *
         * created_date is when the row was written and nobody edits it. _id
         * settles ties, because ObjectIds increase with creation, so two
         * sales in the same second still come back in the order they
         * happened.
         */
        sortBy: 'created_date:desc,_id:desc',
      };

      const result = await salesService.listSales(filter, options, { SaleModel });

      const docs = Array.isArray(result?.results) ? result.results : [];
      const list = docs.map((doc) => formatSaleListEntry(doc)).filter(Boolean);

      const total = typeof result?.totalResults === 'number' ? result.totalResults : list.length;
      const totalPages =
        typeof result?.totalPages === 'number' && result.totalPages > 0
          ? result.totalPages
          : Math.max(1, Math.ceil(total / numericLimit));

      const payload = {
        list,
        current_page: result?.page || numericPage,
        per_page: result?.limit || numericLimit,
        total_pages: totalPages,
        total,
      };

      return this.success(res, payload, SUCCESS_MESSAGES.SALES_RETRIEVED, 200);
    } catch (error) {
      next(error);
    }
  }

  async getOne(req, res, next) {
    try {
      if (!this.checkPermission('sales', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED_VIEW_SALES, 403);
      }

      const { id } = req.params;

      await this.ensureContext(req);

      const SaleModel = this.model || Sale;
      const result = await salesService.getLegacySaleDetails(id, { SaleModel });

      if (
        result &&
        typeof result === 'object' &&
        Object.prototype.hasOwnProperty.call(result, 'status')
      ) {
        if (result.status === true && result.data != null) {
          return this.success(res, result.data, SUCCESS_MESSAGES.GET_SUCCESSFULLY);
        }
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404, result);
      }

      if (!result) {
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }

      return this.success(res, result, SUCCESS_MESSAGES.GET_SUCCESSFULLY);
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      if (!this.checkPermission('sales', 'delete', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED_DELETE_SALES, 403);
      }

      // A sale delete is a void. If this user can't void on their own, require a
      // valid manager-approval token (minted by /authorizations/verify-pin|card).
      // Fails open for unconfigured users so existing tills are never blocked.
      if (!canPos(req.user, 'void_sale')) {
        const approved = isApprovedFor(
          req.body && req.body.approval_token,
          'void_sale',
          req.user && req.user._id
        );
        if (!approved) {
          return this.error(res, 'Voiding a sale needs manager approval', 403);
        }
      }

      // Ensure BaseModel branch / license / user context is set for
      // deleteSaleCollectionData side-effects (stock, wallet, logs, etc.).
      await this.ensureContext(req);

      const rawBody = req.body || {};

      const extractIds = (body) => {
        if (!body) return [];

        // Most common case (current frontend): { data: ["<_id>", ...] }
        if (Array.isArray(body.data)) {
          return body.data;
        }

        // data might be a JSON stringified array
        if (typeof body.data === 'string') {
          const trimmed = body.data.trim();
          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // fall through to legacy handling
            }
          }
        }

        // Legacy shapes: ids / sales_ids / sale_ids / selected_ids / selected
        const { ids, sales_ids, sale_ids, selected_ids, selected } = body;
        let rawIds = ids || sales_ids || sale_ids || selected_ids || selected;

        if (typeof rawIds === 'string') {
          const parsed = safeJsonParse(rawIds, null);
          if (Array.isArray(parsed)) {
            rawIds = parsed;
          } else {
            rawIds = rawIds
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean);
          }
        } else if (rawIds && typeof rawIds === 'object' && !Array.isArray(rawIds)) {
          rawIds = Object.values(rawIds);
        }

        if (Array.isArray(rawIds)) {
          return rawIds;
        }

        // Fallback: body itself may be an array or an object like
        // { "0": "id1", "1": "id2" } – treat all string values as IDs.
        if (Array.isArray(body)) {
          return body;
        }

        const values = Object.values(body);
        if (values.length && values.every((v) => typeof v === 'string')) {
          return values;
        }

        return [];
      };

      const rawIds = extractIds(rawBody);

      const validIds = rawIds
        .map((value) => (value && value._id ? value._id : value))
        .map((value) => (value != null ? String(value).trim() : ''))
        .filter((value) => !!value && mongoose.Types.ObjectId.isValid(value));

      if (!validIds.length) {
        return this.error(res, ERROR_MESSAGES.NO_VALID_SALE_IDS_FOR_DELETE, 400);
      }

      const SaleModel = this.model || Sale;
      const deletedSales = await Promise.all(
        validIds.map((id) => salesService.getSaleById(id, { SaleModel }))
      );
      const result = await salesService.deleteSales(validIds, { SaleModel });

      // Mirror PHP sales.php::delete behaviour, which calls
      // SalesModel::deleteSaleCollectionData and forwards its
      // status + data into response('success', 'Sales deleted successfully', $data, 200)
      // or response('error', 'Sales Not deleted', $data, 404).
      if (!result || typeof result !== 'object') {
        return this.error(res, ERROR_MESSAGES.SALES_NOT_DELETED, 500);
      }

      if (result.status === true) {
        await Promise.all(
          validIds.map((id, index) =>
            writeSaleAudit(req, 'delete', deletedSales[index]?.sales_id || id, 'Sale deleted', {
              sales_id: deletedSales[index]?.sales_id || '',
              total: deletedSales[index]?.sales_total || deletedSales[index]?.total || 0,
            })
          )
        );
        return this.success(res, result.data, SUCCESS_MESSAGES.SALES_DELETED, 200);
      }

      return this.error(res, ERROR_MESSAGES.SALES_NOT_DELETED, 404, result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Legacy endpoint: GET /sales/getLatestSales
   * Returns the latest 6 sales for the current branch.
   */
  async getLatestSales(req, res) {
    try {
      // PHP controller uses sales write access for this endpoint
      // (Sales::getLatestSales) and returns
      //   response('success', 'Recent Sales Retrived', $data, 200)
      // or
      //   response('error', 'Recent Sales Not Retrived ', $data, 404).
      if (!this.checkPermission('sales', 'write', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Ensure BaseModel context (license, branch) is initialised
      await this.ensureContext(req);

      const SaleModel = this.model || Sale;

      // Resolve branch similar to PHP: use current branch / branch_id
      const branchId = resolveBranchId(req.user, req.session) || BaseModel.currentBranch;

      const latestSales = await salesService.getLatestSales(
        {
          branchId,
          licenseId: BaseModel.license,
        },
        { SaleModel }
      );

      // PHP model encodes the array as JSON string or returns 0
      const latestSaleJson = latestSales.length > 0 ? JSON.stringify(latestSales) : 0;

      return res.status(200).json({
        type: 'success',
        message: SUCCESS_MESSAGES.RECENT_SALES_RETRIEVED,
        data: latestSaleJson,
      });
    } catch (error) {
      console.error('Error in getLatestSales:', error);
      return res.status(500).json({
        type: 'error',
        message: ERROR_MESSAGES.RECENT_SALES_NOT_RETRIEVED,
        data: null,
      });
    }
  }

  async dailySalesReports(req, res) {
    try {
      // ---- Access check (null-safe) ----
      const hasReportAccess = this.checkPermission('report', 'read', req.user);

      if (!hasReportAccess) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // ---- Read & sanitize inputs ----
      const { branch, type, starting_date, ending_date } = req.query;

      // Normalize type to allowlist
      const allowedTypes = ['VIEW', 'CSV', 'PDF'];
      let normalizedType = type ? type.toUpperCase().trim() : 'VIEW';
      if (!allowedTypes.includes(normalizedType)) {
        normalizedType = 'VIEW';
      }

      // ---- Verify branch exists ----
      const branchDoc = await salesService.getBranchById(branch);
      if (!branchDoc) {
        return this.error(res, ERROR_MESSAGES.BRANCH_NOT_FOUND, 404);
      }

      // ---- Parse dates ----
      const start = parseSaleDate(starting_date);
      const end = parseSaleDate(ending_date);

      if (!start || !end) {
        return this.error(res, ERROR_MESSAGES.INVALID_DATE_FORMAT, 400);
      }

      // Apply session filtering if user has permission
      const originalDateRange = { start_date: start, end_date: end };
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Daily Sales Reports - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      // Use filtered dates
      const filteredStart = filteredDateRange.start_date;
      const filteredEnd = filteredDateRange.end_date;

      // Set proper time boundaries
      filteredStart.setHours(0, 0, 0, 0);
      filteredEnd.setHours(23, 59, 59, 999);

      const SaleModel = this.model || Sale;
      const branchObjectId = new mongoose.Types.ObjectId(branch);

      // PHP uses ONLY date field and specific sale_process - sales_model.php:7088-7095
      const match = {
        $and: [
          { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
          { date: { $gte: filteredStart, $lte: filteredEnd } },
          { branch_id: branchObjectId },
        ],
      };

      // Separate filters without sale_process restriction to catch ALL cancelled items
      const cancellationMatch = {
        $and: [{ date: { $gte: filteredStart, $lte: filteredEnd } }, { branch_id: branchObjectId }],
      };

      const { productAgg, paymentAgg, salesPayments, taxAgg, cancellationAgg } =
        await salesService.getDailySalesReportAggregates(
          { match, cancellationMatch },
          { SaleModel }
        );

      const productDetails = productAgg.map((item) => {
        const subtotal = item.subtotal ?? 0;
        const totalAmount = item.totalAmount ?? 0;
        const totalQty = item.totalQty ?? 0;
        const totalCompanyPrice = item.totalCompanyPrice ?? 0;
        const taxRate = item._id?.tax_rate ?? 0;
        return {
          product_name: item._id?.name || item._id?.item_name || 'Unknown',
          product_sku: item._id?.sku || '',
          product_qty: totalQty,
          product_total: roundToTwo(totalAmount),
          product_subtotal: roundToTwo(subtotal),
          product_profit: roundToTwo(subtotal - totalCompanyPrice),
          product_discount: roundToTwo(item.totalDiscount ?? 0),
          product_tax: roundToTwo(item.totalTax ?? 0),
          product_avg: roundToTwo(totalQty ? subtotal / totalQty : 0),
          tax_type: 'inclusive',
          tax_rate: taxRate,
        };
      });

      const paymentDetails = paymentAgg.map((item) => ({
        payment_mode: item._id || 'Cash',
        sale_payment: roundToTwo(item.total ?? 0),
      }));

      // Payment aggregation, dine/table and tax aggregations are provided
      // via salesService.getDailySalesReportAggregates above.

      const taxDetails = taxAgg.map((taxDoc) => {
        const taxRate = taxDoc._id?.tax_rate ?? 0;
        const taxName = taxDoc._id?.tax_name || `Tax${taxRate}%`;
        const taxType = taxDoc._id?.tax_type || 'inclusive';
        return {
          tax_name: taxName,
          tax_rate: taxRate,
          tax_type: taxType,
          total_tax: roundToTwo(taxDoc.tax_amount ?? 0),
        };
      });

      // Build dine_details
      const dineMap = new Map();
      salesPayments.forEach((saleDoc) => {
        const dineType = saleDoc.dine_type || null;
        if (dineType) {
          const existing = dineMap.get(dineType) || { count: 0, pax: 0, amount: 0 };
          existing.count += 1;
          existing.pax += Number(saleDoc.person_count) || 0;
          existing.amount += Number(saleDoc.sales_total || saleDoc.total) || 0;
          dineMap.set(dineType, existing);
        }
      });

      const dineDetails = Array.from(dineMap.entries()).map(([type, data]) => ({
        dine_type: type,
        dine_count: data.count,
        dine_pax: data.pax,
        dine_amount: roundToTwo(data.amount),
      }));

      // Build table_summary
      const tableMap = new Map();
      salesPayments.forEach((saleDoc) => {
        const tableNumber = saleDoc.table_number || '';
        if (tableNumber) {
          const existing = tableMap.get(tableNumber) || {
            table_id: '',
            table_number: tableNumber,
            name: tableNumber,
            total_amount: 0,
            total_qty: 0,
            table_pax: 0,
            payment_modes: new Set(),
            tax_amount: 0,
            amount_without_tax: 0,
            round_off_total: 0,
            payment_modes_with_amounts: [],
          };

          const saleTotal = Number(saleDoc.sales_total || saleDoc.total) || 0;
          existing.total_amount += saleTotal;
          existing.table_pax += Number(saleDoc.person_count) || 0;

          // Calculate quantities and tax
          if (Array.isArray(saleDoc.items)) {
            saleDoc.items.forEach((item) => {
              const qty = Number(item.quantity || item.item_quantity) || 0;
              const unitPrice = Number(item.unit_price || item.item_price) || 0;
              const taxAmount = Number(item.tax_amount) || 0;

              existing.total_qty += qty;
              existing.tax_amount += taxAmount;
              existing.amount_without_tax += qty * unitPrice;
            });
          }

          // Track payment modes
          if (saleDoc.multi_payment && typeof saleDoc.multi_payment === 'object') {
            for (const method of Object.keys(saleDoc.multi_payment)) {
              existing.payment_modes.add(method);
            }
          } else if (Array.isArray(saleDoc.payments) && saleDoc.payments.length) {
            saleDoc.payments.forEach((payment) => {
              const method = payment?.method || 'other';
              const displayMode =
                method === 'cash'
                  ? 'Cash'
                  : method === 'card'
                    ? 'Card'
                    : method === 'bank_transfer'
                      ? 'Bank Transfer'
                      : method === 'credit'
                        ? 'Credit'
                        : 'Other';
              existing.payment_modes.add(displayMode);
            });
          } else if (saleDoc.payment_mode) {
            existing.payment_modes.add(saleDoc.payment_mode);
          }

          tableMap.set(tableNumber, existing);
        }
      });

      const tableSummary = Array.from(tableMap.entries()).map(([tableNum, data]) => ({
        table_id: data.table_id,
        table_number: data.table_number,
        name: data.name,
        total_amount: roundToTwo(data.total_amount),
        total_qty: data.total_qty,
        table_pax: data.table_pax,
        payment_modes: Array.from(data.payment_modes),
        tax_amount: roundToTwo(data.tax_amount),
        amount_without_tax: roundToTwo(data.amount_without_tax),
        round_off_total: 0,
        payment_modes_with_amounts: Array.from(data.payment_modes).map(
          (mode) => `${mode} ₹ ${roundToTwo(data.total_amount).toFixed(2)}`
        ),
      }));

      // Build extra_discount
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
        extra_discount_total: roundToTwo(data.extra_discount_total),
        sale_extra_discount_total: roundToTwo(data.sale_extra_discount_total),
        count_sales: data.count_sales,
      }));

      const timeZone = branchDoc.time_zone || process.env.DEFAULT_TIMEZONE || 'UTC';

      const branchDetails = {
        date: formatDateForTimezone(new Date(), timeZone),
        from_date: formatDateForTimezone(start, timeZone),
        to_date: formatDateForTimezone(end, timeZone),
        branch_name: branchDoc.branch_name,
        branch_address: branchDoc.store_address || '',
        branch_phone: branchDoc.store_telephone || '',
        branch_email: branchDoc.store_email || '',
        sales_type: normalizedType,
      };

      // ---- Build response data ----
      const responseData = {
        branch_details: branchDetails,
        product_details: productDetails,
        payment_details: paymentDetails,
        dine_details: dineDetails,
        tax_details: taxDetails,
        extra_discount: {
          total_extra_discount: roundToTwo(totalExtraDiscount),
          total_sale_extra_discount: roundToTwo(totalSaleExtraDiscount),
          by_type: extraDiscountByType,
        },
        table_summary: tableSummary,
        cancellation_summary: [],
      };

      const cancellationSummary = cancellationAgg.map((row) => ({
        table_number: row._id?.table_number || '',
        item_name: row._id?.item_name || '',
        cancel_count: roundToTwo(row.cancel_count ?? 0),
        cancel_amount: roundToTwo(row.cancel_amount ?? 0),
      }));

      responseData.cancellation_summary = cancellationSummary;

      // ---- Return success response ----
      return this.success(res, responseData, SUCCESS_MESSAGES.GET_SUCCESSFULLY_LOWER, 200);
    } catch (error) {
      // Last-resort safety net
      console.error('Error generating daily sales report:', error);
      return this.error(res, ERROR_MESSAGES.SERVER_ERROR, 500, error.message);
    }
  }

  /**
   * PHP: returnProductDetails()
   * Get return product details for a single sale (used by return report sidebar)
   */
  async returnProductDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
      const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        sales_id: req.query.sales_id,
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.returnProductReportPage(data, options, {
        SaleModel,
      });

      if (result.status === true) {
        const { status: _ignoredStatus, ...payload } = result;
        return this.success(res, payload, SUCCESS_MESSAGES.GET_SUCCESSFULLY, 200);
      }

      return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
    } catch (error) {
      console.error('Error in SalesController.returnProductDetails:', error);
      return this.error(res, error.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 500);
    }
  }

  /**
   * PHP: returnProductViewPage()
   * Get detailed view data for a specific return (used by Return Reports modal)
   */
  async returnProductView(req, res) {
    try {
      // Permissions: same as other report endpoints
      const hasReportAccess = this.checkPermission('report', 'read', req.user);
      if (!hasReportAccess) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      await this.ensureContext(req);

      const id = req.query.id || req.body?.id || null;
      if (!id) {
        return this.error(res, 'Return id is required', 400);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.returnProductViewPage(id, { SaleModel });

      if (result && result.status === true) {
        // Frontend expects data to be the raw productValues array
        return this.success(res, result.data, result.message || SUCCESS_MESSAGES.GET_SUCCESSFULLY);
      }

      return this.error(
        res,
        (result && result.message) || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND,
        404,
        result && result.data
      );
    } catch (error) {
      console.error('Error in SalesController.returnProductView:', error);
      return this.error(res, error.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 500);
    }
  }

  /**
   * Daily Sales Report PDF Generation
   * GET /sales/dailyReportPdf
   */
  async dailyReportPdf(req, res) {
    try {
      // ---- Access check (null-safe) ----
      const hasReportAccess = this.checkPermission('report', 'read', req.user);

      if (!hasReportAccess) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // ---- Read & sanitize inputs ----
      const { branch, type, starting_date, ending_date } = req.query;

      // Parse dates
      const start = parseSaleDate(starting_date);
      const end = parseSaleDate(ending_date);

      if (!start || !end) {
        return this.error(res, ERROR_MESSAGES.INVALID_DATE_FORMAT, 400);
      }

      // Apply session filtering if user has permission
      const originalDateRange = { start_date: start, end_date: end };
      const filteredDateRange = await sessionFilterUtil.applySessionFilter(req, originalDateRange);

      console.log('🔍 Daily Report PDF - Date range:', {
        original: originalDateRange,
        filtered: filteredDateRange,
        session_applied: filteredDateRange?.session_applied || false,
      });

      // Use filtered dates
      const filteredStart = filteredDateRange.start_date;
      const filteredEnd = filteredDateRange.end_date;

      // Set proper time boundaries
      filteredStart.setHours(0, 0, 0, 0);
      filteredEnd.setHours(23, 59, 59, 999);

      // ---- Verify branch exists ----
      const branchDoc = await salesService.getBranchById(branch);
      if (!branchDoc) {
        return this.error(res, ERROR_MESSAGES.BRANCH_NOT_FOUND, 404);
      }

      const SaleModel = this.model || Sale;
      const branchObjectId = new mongoose.Types.ObjectId(branch);
      const match = {
        $and: [
          {
            $or: [{ branch: branchObjectId }, { branch_id: branchObjectId }],
          },
          {
            $or: [
              { date: { $gte: filteredStart, $lte: filteredEnd } },
              { createdAt: { $gte: filteredStart, $lte: filteredEnd } },
              { updatedAt: { $gte: filteredStart, $lte: filteredEnd } },
              { updated_date: { $gte: filteredStart, $lte: filteredEnd } },
            ],
          },
        ],
        status: { $ne: SALE_STATUS.CANCELLED },
      };

      const { productAgg, paymentAgg, taxAgg, extraDiscountSummary } =
        await salesService.getDailyReportPdfAggregates({ match }, { SaleModel });

      const timeZone = branchDoc.time_zone || process.env.DEFAULT_TIMEZONE || 'UTC';

      // Get currency symbol from branch settings. Some legacy data contains
      // mojibake for the rupee sign, so normalize it before writing the PDF.
      const normalizeCurrency = (value) => {
        const raw = (value || '₹').toString().trim();
        if (!raw || raw === 'â‚¹' || raw === 'â¹') return '₹';
        return raw;
      };
      const currency = normalizeCurrency(branchDoc.currency_type || branchDoc.currency_symbol);

      // Generate PDF using pdfkit
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
      });

      // Try to register DejaVuSansCondensed so phone/email icons match PHP
      let hasDejavu = false;
      if (fs.existsSync(dejavuSansCondensedPath)) {
        try {
          doc.registerFont('DejaVuSansCondensed', dejavuSansCondensedPath);
          hasDejavu = true;
        } catch (e) {
          console.log('DejaVuSansCondensed font load failed:', e.message);
        }
      } else {
        console.log(
          'DejaVuSansCondensed font not found, using Helvetica fallback:',
          dejavuSansCondensedPath
        );
      }

      let currencyFont = 'Helvetica';
      let currencyBoldFont = 'Helvetica-Bold';
      if (reportUnicodeFontPath && fs.existsSync(reportUnicodeFontPath)) {
        try {
          doc.registerFont('ReportCurrency', reportUnicodeFontPath);
          currencyFont = 'ReportCurrency';
        } catch (e) {
          console.log('Report currency font load failed:', e.message);
        }
      }
      if (reportUnicodeBoldFontPath && fs.existsSync(reportUnicodeBoldFontPath)) {
        try {
          doc.registerFont('ReportCurrencyBold', reportUnicodeBoldFontPath);
          currencyBoldFont = 'ReportCurrencyBold';
        } catch (e) {
          console.log('Report currency bold font load failed:', e.message);
        }
      }

      const formatMoney = (value) => `${currency} ${(Number(value) || 0).toFixed(2)}`;
      const writeMoney = (value, x, y, options = {}, isBold = false) => {
        doc.font(isBold ? currencyBoldFont : currencyFont).text(formatMoney(value), x, y, {
          align: 'right',
          lineBreak: false,
          ...options,
        });
      };

      // Set response headers for PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=daily-sales-report-${Date.now()}.pdf`
      );

      // Pipe PDF to response
      doc.pipe(res);

      // Pre-resolve logo paths used in header/footer
      const defaultStoreLogo = path.join(__dirname, '../img/store.png');
      const defaultPosnicLogo = path.join(__dirname, '../img/posnicicon.png');
      // Footer branding: the white-label brand logo when this install has one,
      // so a shop's daily report never carries our mark; posnic only as a last
      // resort for an unbranded install.
      const footerBrandLogo = require('../helpers/brand').brandLogoPath() || defaultPosnicLogo;

      // Match the logo resolution behaviour used by the shared
      // pdfGenerator utilities so branch logos load reliably for
      // values such as "uploads/branches/logo.png", full URLs, or
      // absolute filesystem paths. When anything goes wrong we fall
      // back to the bundled store.png.
      const resolveBranchLogoPath = () => {
        let branchImagePath = defaultStoreLogo;

        if (branchDoc && typeof branchDoc.logo === 'string') {
          const rawLogo = branchDoc.logo.trim();

          if (rawLogo && rawLogo !== 'store.png') {
            if (rawLogo.startsWith('http://') || rawLogo.startsWith('https://')) {
              branchImagePath = rawLogo;
            } else if (path.isAbsolute(rawLogo)) {
              branchImagePath = rawLogo;
            } else {
              // Relative path such as "uploads/branches/logo.png" -
              // resolve from ApiV2/src to keep parity with other PDFs.
              branchImagePath = path.join(__dirname, '..', rawLogo);
            }
          }
        }

        return branchImagePath;
      };

      let currentPageNumber = 1;

      const drawHeader = () => {
        // Layout similar to PHP header: 3 columns inside [50, 50 + 515]
        const contentLeft = 50;
        const contentWidth = 515;

        const leftWidth = 180; // ~30%
        const middleWidth = 200; // ~40%
        const rightWidth = contentWidth - leftWidth - middleWidth; // rest

        const leftX = contentLeft;
        const middleX = leftX + leftWidth;
        const rightX = middleX + middleWidth;

        // Branch name and address block (left column)
        doc
          .fontSize(16)
          .font('Helvetica-Bold')
          .text(branchDoc.branch_name, leftX, 50, { width: leftWidth });
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(branchDoc.store_address || 'nagapattinam', leftX, 70, {
            width: leftWidth,
          });

        const phoneFont = hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica';
        doc
          .fontSize(9)
          .font(phoneFont)
          .text(`\u260E ${branchDoc.store_telephone || '+919999999999'}`, leftX, 85, {
            width: leftWidth,
          });

        const emailFont = hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica';
        doc
          .fontSize(9)
          .font(emailFont)
          .text(`\u0040 ${branchDoc.store_email || 'example@gmail.com'}`, leftX, 100, {
            width: leftWidth,
          });

        // Date range in the middle column (center-aligned)
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(`From date : ${formatDateForTimezone(start, timeZone)}`, middleX, 50, {
            width: middleWidth,
            align: 'center',
          });
        doc.text(`To date : ${formatDateForTimezone(end, timeZone)}`, middleX, 65, {
          width: middleWidth,
          align: 'center',
        });

        // Branch shop icon/logo on the right column (top-right). Use a
        // slightly smaller icon and drop it a little below the top margin so
        // it matches the clean spacing of the legacy PHP PDF and never looks
        // cropped against the page edge.
        const branchImagePath = resolveBranchLogoPath();
        try {
          const logoSize = 40;
          const logoX = contentLeft + contentWidth - logoSize; // right edge
          const logoY = 45;
          doc.image(branchImagePath, logoX, logoY, {
            width: logoSize,
            height: logoSize,
          });
        } catch (err) {
          // Fallback to default store logo if the branch-specific logo fails
          try {
            const logoSize = 40;
            const logoX = contentLeft + contentWidth - logoSize;
            const logoY = 45;
            doc.image(defaultStoreLogo, logoX, logoY, {
              width: logoSize,
              height: logoSize,
            });
          } catch (fallbackErr) {
            // Suppress logo errors entirely to avoid breaking the PDF
          }
        }

        // Title and report date in the right half (middle + right columns),
        // aligned to the right so the text does not wrap awkwardly.
        const titleAreaX = middleX;
        const titleAreaWidth = middleWidth + rightWidth;
        const titleY = 80;

        doc
          .fontSize(14)
          .font('Helvetica-Bold')
          .text(`${type || 'This Year'} Sale Report`, titleAreaX, titleY, {
            width: titleAreaWidth,
            align: 'right',
          });

        doc
          .fontSize(9)
          .font('Helvetica')
          .text(
            `Date: ${new Date().toLocaleString('en-US', {
              month: '2-digit',
              day: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })}`,
            titleAreaX,
            titleY + 18,
            {
              width: titleAreaWidth,
              align: 'right',
            }
          );
      };

      const drawFooter = () => {
        const page = doc.page || {};
        const pageWidth = page.width || 595.28; // A4 default width
        const pageHeight = page.height || 841.89;
        const margins = page.margins || { left: 40, right: 40, bottom: 40 };

        const contentBottomY = pageHeight - margins.bottom;
        const footerHeight = 24; // total vertical space reserved for footer
        const footerTopY = contentBottomY - footerHeight;
        const footerLineY = footerTopY;
        const footerContentY = footerTopY + 6;

        // Horizontal line above footer
        doc
          .moveTo(margins.left, footerLineY)
          .lineTo(pageWidth - margins.right, footerLineY)
          .stroke();

        try {
          doc.image(footerBrandLogo, margins.left, footerContentY, {
            width: 35,
            height: 15,
          });
        } catch (err) {
          // Fallback to text when logo image is not available
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#0066CC')
            /*
             * The brand this installation goes by, never the product name.
             *
             * This is a receipt the shop hands to its own customers, so a
             * white-labelled install printing "Posnic" here is the most visible
             * leak there is - worse than an error message, because it leaves
             * the building. Blank when there is no brand: an empty space is
             * right for every brand, and a wrong name is right for none.
             */
            .text(require('../helpers/brand').brandName(), margins.left, footerContentY + 2, {
              lineBreak: false,
            });
        }

        // Page number on the right side, same line as logo
        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#000000')
          .text(`Page ${currentPageNumber}`, pageWidth - margins.right - 80, footerContentY + 2, {
            width: 80,
            align: 'right',
            lineBreak: false,
          });
      };

      // Draw the initial header on the first page
      drawHeader();

      // -------------------------------------------------------------------
      // Items table
      // -------------------------------------------------------------------
      const tableLeft = 40;
      const tableWidth = 515;
      const tableTop = 214;
      const headerHeight = 24;
      const rowHeight = 24;
      const colWidths = [30, 138, 58, 38, 62, 68, 54, 67];
      const cellPad = 5;
      let xPos = tableLeft;

      const getContentMaxY = () => {
        const page = doc.page || {};
        const pageHeight = page.height || 841.89;
        const margins = page.margins || { bottom: 40 };
        return pageHeight - margins.bottom - 48;
      };

      const cleanCellText = (value, maxChars) => {
        const text = (value || '')
          .toString()
          .replace(/[\r\n\t]+/g, ' ')
          .trim();
        return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
      };

      const drawItemsHeader = () => {
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .fillColor('#1f2937')
          .text('Items Sold', tableLeft, tableTop - 24, { width: tableWidth });

        const columns = [
          ['#', 'center'],
          ['Item', 'left'],
          ['SKU', 'left'],
          ['Qty', 'center'],
          ['Price', 'right'],
          ['Discount', 'right'],
          ['Tax', 'right'],
          ['Amount', 'right'],
        ];

        let headerX = tableLeft;
        doc.rect(tableLeft, tableTop, tableWidth, headerHeight).fillAndStroke('#e8eef7', '#7f8ea3');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#111827');
        columns.forEach(([label, align], idx) => {
          doc.text(label, headerX + cellPad, tableTop + 8, {
            width: colWidths[idx] - cellPad * 2,
            align,
            lineBreak: false,
          });
          headerX += colWidths[idx];
        });
      };

      drawItemsHeader();

      // Helper to format quantity
      const formatQty = (value) => {
        const num = Number(value) || 0;
        return Number.isInteger(num) ? num.toString() : num.toFixed(2);
      };

      // Item rows
      let yPos = tableTop + headerHeight;
      let totalQty = 0;
      let totalUnitPrice = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      let totalAmount = 0;

      productAgg.forEach((item, index) => {
        if (yPos + rowHeight > getContentMaxY()) {
          drawFooter();
          doc.addPage();
          currentPageNumber += 1;
          drawHeader();
          drawItemsHeader();
          yPos = tableTop + headerHeight;
        }

        xPos = tableLeft;
        const qty = item.totalQty || 0;
        const unitPrice = item.unitPrice || 0;
        const discount = item.totalDiscount || 0;
        const tax = item.totalTax || 0;
        const amount = item.totalAmount || 0;

        totalQty += qty;
        totalUnitPrice += unitPrice;
        totalDiscount += discount;
        totalTax += tax;
        totalAmount += amount;

        const rowFill = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(tableLeft, yPos, tableWidth, rowHeight).fillAndStroke(rowFill, '#d8dee8');
        doc.fontSize(8).font('Helvetica').fillColor('#111827');
        doc.text(String(index + 1), xPos + cellPad, yPos + 8, {
          width: colWidths[0] - cellPad * 2,
          align: 'center',
          lineBreak: false,
        });
        xPos += colWidths[0];

        // Description: single line, truncated
        const rawName = (item._id.name || 'Unknown').toString();
        const maxNameChars = 30;
        const displayName =
          rawName.length > maxNameChars ? `${rawName.slice(0, maxNameChars - 1)}…` : rawName;
        doc.text(cleanCellText(rawName, 26), xPos + cellPad, yPos + 8, {
          width: colWidths[1] - cellPad * 2,
          lineBreak: false,
        });
        xPos += colWidths[1];

        // SKU: sanitized single line, truncated
        const rawSku = (item._id.sku || '').toString();
        const sanitizedSku = rawSku.replace(/[\r\n\t]+/g, ' ').trim();
        const maxSkuChars = 12;
        const displaySku =
          sanitizedSku.length > maxSkuChars
            ? `${sanitizedSku.slice(0, maxSkuChars - 1)}…`
            : sanitizedSku;
        doc.text(cleanCellText(rawSku, 12), xPos + cellPad, yPos + 8, {
          width: colWidths[2] - cellPad * 2,
          lineBreak: false,
        });
        xPos += colWidths[2];

        // QTY, PRICE, DISCOUNT, TAX, AMOUNT
        doc.text(formatQty(qty), xPos + cellPad, yPos + 8, {
          width: colWidths[3] - cellPad * 2,
          align: 'center',
          lineBreak: false,
        });
        xPos += colWidths[3];

        writeMoney(unitPrice, xPos + cellPad, yPos + 8, { width: colWidths[4] - cellPad * 2 });
        xPos += colWidths[4];

        writeMoney(discount, xPos + cellPad, yPos + 8, { width: colWidths[5] - cellPad * 2 });
        xPos += colWidths[5];

        writeMoney(tax, xPos + cellPad, yPos + 8, { width: colWidths[6] - cellPad * 2 });
        xPos += colWidths[6];

        writeMoney(amount, xPos + cellPad, yPos + 8, { width: colWidths[7] - cellPad * 2 });

        yPos += rowHeight;
      });

      // Totals row
      if (yPos + rowHeight > getContentMaxY()) {
        drawFooter();
        doc.addPage();
        currentPageNumber += 1;
        drawHeader();
        drawItemsHeader();
        yPos = tableTop + headerHeight;
      }

      xPos = tableLeft;
      doc.fontSize(8).font('Helvetica-Bold');
      doc.rect(tableLeft, yPos, tableWidth, rowHeight).fillAndStroke('#e8eef7', '#7f8ea3');
      doc.fillColor('#111827').text('Total', xPos + cellPad, yPos + 8, {
        width: colWidths[0] + colWidths[1] + colWidths[2],
        align: 'center',
        lineBreak: false,
      });
      xPos += colWidths[0] + colWidths[1] + colWidths[2];
      doc.text(formatQty(totalQty), xPos + cellPad, yPos + 8, {
        width: colWidths[3] - cellPad * 2,
        align: 'center',
        lineBreak: false,
      });
      xPos += colWidths[3];
      writeMoney(
        totalUnitPrice,
        xPos + cellPad,
        yPos + 8,
        { width: colWidths[4] - cellPad * 2 },
        true
      );
      xPos += colWidths[4];
      writeMoney(
        totalDiscount,
        xPos + cellPad,
        yPos + 8,
        { width: colWidths[5] - cellPad * 2 },
        true
      );
      xPos += colWidths[5];
      writeMoney(totalTax, xPos + cellPad, yPos + 8, { width: colWidths[6] - cellPad * 2 }, true);
      xPos += colWidths[6];
      writeMoney(
        totalAmount,
        xPos + cellPad,
        yPos + 8,
        { width: colWidths[7] - cellPad * 2 },
        true
      );

      // Determine if we actually have any summary content to show. If there
      // is no Extra Discount, Tender Type, or Tax Type data, we keep the
      // report to the items pages only and avoid adding an extra blank page.
      const totalSaleExtraDiscount =
        extraDiscountSummary && typeof extraDiscountSummary.total_sale_extra_discount === 'number'
          ? extraDiscountSummary.total_sale_extra_discount
          : 0;

      const hasTenderRows = Array.isArray(paymentAgg) && paymentAgg.length > 0;
      const hasTaxRows = Array.isArray(taxAgg) && taxAgg.length > 0;
      const hasSummarySections = totalSaleExtraDiscount > 0 || hasTenderRows || hasTaxRows;

      // After finishing the items table, either finalize the current page
      // (when there is no summary content) or start a dedicated summary page
      // that begins below the header area.
      if (!hasSummarySections) {
        drawFooter();
        doc.end();
        return;
      }

      drawFooter();
      doc.addPage();
      currentPageNumber += 1;
      drawHeader();
      yPos = 200; // start summaries below the header + title row

      // -------------------------------------------------------------------
      // Extra Discount (only when there is a non-zero total)
      // -------------------------------------------------------------------

      if (totalSaleExtraDiscount > 0) {
        yPos += 20;
        doc.fontSize(11).font('Helvetica-Bold').text('Extra Discount', 50, yPos);

        yPos += 20;
        const extraTableTop = yPos;

        doc.fontSize(9);
        doc.rect(50, extraTableTop, 515, 20).fillAndStroke('#e0e0e0', '#000');
        doc.fillColor('#000').text('Extra Discount', 55, extraTableTop + 5, {
          width: 360,
          lineBreak: false,
        });
        doc.text('Amount', 425, extraTableTop + 5, {
          width: 130,
          align: 'right',
          lineBreak: false,
        });

        yPos = extraTableTop + 20;
        doc.font('Helvetica');

        // For now mirror the legacy PDF: single row with total extra discount
        doc.rect(50, yPos, 515, 20).stroke();
        doc.text('Amount Discount', 55, yPos + 5, {
          width: 360,
          lineBreak: false,
        });
        writeMoney(totalSaleExtraDiscount, 425, yPos + 5, { width: 130 });

        yPos += 20;
        doc.font('Helvetica-Bold');
        doc.rect(50, yPos, 515, 20).fillAndStroke('#f0f0f0', '#000');
        doc.fillColor('#000').text('Total', 55, yPos + 5, {
          width: 360,
          lineBreak: false,
        });
        writeMoney(totalSaleExtraDiscount, 425, yPos + 5, { width: 130 }, true);

        yPos += 40; // space before Tender Type section
      }

      const summaryRowHeight = 20;

      const getSummaryContentMaxY = () => {
        const page = doc.page || {};
        const pageHeight = page.height || 841.89;
        const margins = page.margins || {
          top: 40,
          bottom: 40,
          left: 40,
          right: 40,
        };

        // Reserve vertical space for the footer plus a little breathing room
        // so that summary rows never push the implicit text cursor beyond the
        // bottom margin (which would cause pdfkit to auto-start new pages).
        const footerReserve = 40;
        return pageHeight - margins.bottom - footerReserve;
      };

      const renderTenderHeader = () => {
        doc.fontSize(11).font('Helvetica-Bold').text('Tender Type', 50, yPos);
        yPos += 20;
        const tenderTableTop = yPos;

        doc.fontSize(9);
        doc.rect(50, tenderTableTop, 515, 20).fillAndStroke('#e0e0e0', '#000');
        doc.fillColor('#000').text('S.No.', 55, tenderTableTop + 5, {
          width: 60,
          align: 'center',
          lineBreak: false,
        });
        doc.text('TENDER TYPE', 120, tenderTableTop + 5, {
          width: 300,
          lineBreak: false,
        });
        doc.text('AMOUNT', 425, tenderTableTop + 5, {
          width: 130,
          align: 'right',
          lineBreak: false,
        });

        yPos = tenderTableTop + 20;
        doc.font('Helvetica');
      };

      // -------------------------------------------------------------------
      // Tender Type
      // -------------------------------------------------------------------
      if (hasTenderRows) {
        yPos += 50;
        renderTenderHeader();

        let tenderTotal = 0;
        paymentAgg.forEach((payment, index) => {
          // When the next row would collide with the reserved footer space,
          // finish the current page and continue the Tender table on a fresh
          // page with a repeated header.
          if (yPos + summaryRowHeight > getSummaryContentMaxY()) {
            drawFooter();
            doc.addPage();
            currentPageNumber += 1;
            drawHeader();
            yPos = 200;
            renderTenderHeader();
          }

          const amount = payment.total || 0;
          tenderTotal += amount;

          doc.rect(50, yPos, 515, 20).stroke();
          doc.text(String(index + 1), 55, yPos + 5, {
            width: 60,
            align: 'center',
            lineBreak: false,
          });

          const tenderRaw = (payment._id || 'Cash').toString();
          const maxTenderChars = 25;
          const tenderName =
            tenderRaw.length > maxTenderChars
              ? `${tenderRaw.slice(0, maxTenderChars - 1)}…`
              : tenderRaw;
          doc.text(tenderName, 120, yPos + 5, {
            width: 300,
            lineBreak: false,
          });

          writeMoney(amount, 425, yPos + 5, { width: 130 });

          yPos += summaryRowHeight;
        });

        doc.font('Helvetica-Bold');
        doc.rect(50, yPos, 515, 20).fillAndStroke('#f0f0f0', '#000');
        doc.fillColor('#000').text('Total', 120, yPos + 5, {
          width: 300,
          align: 'center',
          lineBreak: false,
        });
        writeMoney(tenderTotal, 425, yPos + 5, { width: 130 }, true);
      }

      const renderTaxHeader = () => {
        yPos += 50;
        doc.fontSize(11).font('Helvetica-Bold').text('Tax Type', 50, yPos);

        yPos += 20;
        const taxTableTop = yPos;

        doc.fontSize(9);
        doc.rect(50, taxTableTop, 515, 20).fillAndStroke('#e0e0e0', '#000');
        doc.fillColor('#000').text('S.No.', 55, taxTableTop + 5, {
          width: 60,
          align: 'center',
          lineBreak: false,
        });
        doc.text('TAX TYPE', 120, taxTableTop + 5, {
          width: 300,
          lineBreak: false,
        });
        doc.text('AMOUNT', 425, taxTableTop + 5, {
          width: 130,
          align: 'right',
          lineBreak: false,
        });

        yPos = taxTableTop + 20;
        doc.font('Helvetica');
      };

      // -------------------------------------------------------------------
      // Tax Type
      // -------------------------------------------------------------------
      if (hasTaxRows) {
        renderTaxHeader();

        let taxTotal = 0;
        taxAgg.forEach((tax, index) => {
          // Similar to Tender Type, ensure that each Tax row fits comfortably
          // above the footer. If not, move to a new page and redraw the
          // section header so the table looks continuous.
          if (yPos + summaryRowHeight > getSummaryContentMaxY()) {
            drawFooter();
            doc.addPage();
            currentPageNumber += 1;
            drawHeader();
            yPos = 200;
            renderTaxHeader();
          }

          const amount = tax.tax_amount || 0;
          taxTotal += amount;
          const taxName = tax._id?.tax_name || `Tax${tax._id?.tax_rate || 0}%`;

          doc.rect(50, yPos, 515, 20).stroke();
          doc.text(String(index + 1), 55, yPos + 5, {
            width: 60,
            align: 'center',
            lineBreak: false,
          });

          const rawTaxName = taxName.toString();
          const maxTaxChars = 25;
          const displayTaxName =
            rawTaxName.length > maxTaxChars
              ? `${rawTaxName.slice(0, maxTaxChars - 1)}…`
              : rawTaxName;
          doc.text(displayTaxName, 120, yPos + 5, {
            width: 300,
            lineBreak: false,
          });

          writeMoney(amount, 425, yPos + 5, { width: 130 });

          yPos += summaryRowHeight;
        });

        doc.font('Helvetica-Bold');
        doc.rect(50, yPos, 515, 20).fillAndStroke('#f0f0f0', '#000');
        doc.fillColor('#000').text('Total', 120, yPos + 5, {
          width: 300,
          align: 'center',
          lineBreak: false,
        });
        writeMoney(taxTotal, 425, yPos + 5, { width: 130 }, true);
      }

      // Finalize PDF with footer on the last page
      drawFooter();
      doc.end();
    } catch (error) {
      console.error('Error generating daily sales PDF:', error);

      if (!res.headersSent) {
        return this.error(res, ERROR_MESSAGES.SERVER_ERROR, 500, error.message);
      }
    }
  }

  /**
   * Legacy endpoint: GET /sales/salesReports
   * Returns paginated sales summary filtered by branch and date range.
   */
  async salesGraphicalReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const parseBranchValue = (value) => {
        if (!value && value !== 0) {
          return [];
        }
        if (Array.isArray(value)) {
          return value.flatMap((entry) => parseBranchValue(entry));
        }
        if (typeof value === 'object') {
          const candidates = [value.branch_id, value.branchId, value._id, value.id, value.$oid];
          return candidates.filter(Boolean).map((entry) => String(entry));
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
                return parsed.flatMap((entry) => parseBranchValue(entry));
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
        req.query.branch,
        req.query['branch[]'],
        req.query.branch_id,
        req.query.branchId,
      ];

      let branchIds = branchInputs
        .flatMap((value) => parseBranchValue(value))
        .filter((value) => typeof value === 'string' && value.trim());

      if (!branchIds.length) {
        const fallbackBranch = resolveBranchId(req.user, req.session);
        if (fallbackBranch) {
          branchIds = [String(fallbackBranch)];
        }
      }

      const uniqueBranchIds = [...new Set(branchIds.map((id) => id.trim()).filter(Boolean))];

      if (!uniqueBranchIds.length) {
        return this.error(res, ERROR_MESSAGES.AT_LEAST_ONE_BRANCH_ID_REQUIRED, 400);
      }

      const validBranchIds = uniqueBranchIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (!validBranchIds.length) {
        return this.error(res, ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED, 400);
      }

      const startDate = normalizeRangeDate(req.query.starting_date);
      const endDate = normalizeRangeDate(req.query.ending_date, {
        endOfDay: true,
      });

      // Initialize match variable outside the if block
      const match = {
        branch_id: { $in: validBranchIds },
        sale_process: { $in: GRAPH_ALLOWED_SALE_PROCESSES },
        status: { $ne: SALE_STATUS.CANCELLED },
      };

      // Apply session filtering if user has permission (same as salesSummaryReports)
      if (startDate || endDate) {
        console.log('🔍 Sales Graphical Reports - Before filter:', { startDate, endDate });

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 Sales Graphical Reports - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Sales Graphical Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Use filtered dates
        const filteredStartDate = filteredDateRange.start_date;
        const filteredEndDate = filteredDateRange.end_date;

        if (filteredStartDate || filteredEndDate) {
          match.date = {};
          if (filteredStartDate) {
            match.date.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            match.date.$lte = filteredEndDate;
          }
          if (!match.date.$gte && !match.date.$lte) {
            delete match.date;
          }
        }
      }

      const SaleModel = this.model || Sale;

      const chartData = await salesService.getSalesGraphicalReportData(
        { match, validBranchIds },
        { SaleModel }
      );

      return this.success(
        res,
        chartData,
        chartData.length
          ? 'Graphical report generated successfully'
          : 'No sales data found for the selected range'
      );
    } catch (error) {
      console.error('Error generating sales graphical report:', error);
      return this.error(res, 'Failed to generate sales graphical report', 500, error.message);
    }
  }

  /**
   * Legacy endpoint: GET /sales/salesSummaryReports
   * Returns aggregate totals for the selected branches/date range.
   */
  async salesSummaryReports(req, res) {
    try {
      const role = (req.user?.usertype || req.user?.role || '').toLowerCase();
      const hasPermission =
        req.user?.access?.report?.read === true ||
        ['super_admin', 'admin', 'manager', 'api'].includes(role);

      if (!hasPermission) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const startingDate = req.query.starting_date ? parseSaleDate(req.query.starting_date) : null;
      const endingDate = req.query.ending_date ? parseSaleDate(req.query.ending_date) : null;

      let uniqueBranchIds;
      let validBranchIds;

      if (
        req.salesSummaryBranchContext &&
        Array.isArray(req.salesSummaryBranchContext.uniqueBranchIds) &&
        Array.isArray(req.salesSummaryBranchContext.validBranchIds)
      ) {
        ({ uniqueBranchIds, validBranchIds } = req.salesSummaryBranchContext);
      } else {
        ({ uniqueBranchIds, validBranchIds } = parseBranchIdsFromRequest(req));

        if (!uniqueBranchIds.length) {
          return this.error(res, ERROR_MESSAGES.AT_LEAST_ONE_BRANCH_ID_REQUIRED, 400);
        }

        if (!validBranchIds.length) {
          return this.error(res, ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED, 400);
        }
      }

      // Convert branch IDs to ObjectId for MongoDB matching
      const { ObjectId } = require('mongodb');
      const branchObjectIds = validBranchIds.map((id) =>
        typeof id === 'string' ? new ObjectId(id) : id
      );

      const match = {
        branch_id: { $in: branchObjectIds },
      };

      // Apply session filtering if user has permission and dates are provided
      if (startingDate || endingDate) {
        const originalDateRange = {
          start_date: startingDate || new Date(0),
          end_date: endingDate || new Date(),
        };

        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Sales Summary Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        match.date = {};

        if (filteredDateRange.start_date && !Number.isNaN(filteredDateRange.start_date.valueOf())) {
          match.date.$gte = filteredDateRange.start_date;
        }
        if (filteredDateRange.end_date && !Number.isNaN(filteredDateRange.end_date.valueOf())) {
          const end = new Date(filteredDateRange.end_date);
          end.setHours(23, 59, 59, 999);
          match.date.$lte = end;
        }
        if (!Object.keys(match.date).length) {
          delete match.date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.getSalesSummaryReportsData(
        { match, branchObjectIds },
        { SaleModel }
      );

      return this.success(res, result, 'Sales summary report retrieved successfully');
    } catch (error) {
      console.error('Error in salesSummaryReports:', error);
      return this.error(res, 'Failed to load sales summary report. Please try again later.', 500);
    }
  }

  async salesReports(req, res) {
    try {
      console.log('🔍 Sales Reports - METHOD CALLED!');
      console.log('🔍 Sales Reports - Query params:', req.query);

      // Permission check matching PHP controller line 445
      console.log('🔍 Sales Reports - About to check permission...');
      const role = (req.user?.usertype || req.user?.role || '').toLowerCase();
      console.log('🔍 Sales Reports - User role:', role);
      console.log('🔍 Sales Reports - User access:', req.user?.access);

      const hasPermission =
        req.user?.access?.report?.read === true ||
        ['super_admin', 'admin', 'manager', 'api'].includes(role);

      console.log('🔍 Sales Reports - Permission check:', { role, hasPermission });

      if (!hasPermission) {
        console.log('🔍 Sales Reports - No permission - returning 403');
        return res.status(403).json({
          type: 'error',
          message: ERROR_MESSAGES.UNAUTHORIZED,
          data: null,
        });
      }

      console.log('🔍 Sales Reports - Permission granted - continuing...');
      const { ObjectId } = require('mongodb');

      // Parse query params matching PHP controller lines 439-444
      const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
      const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;

      console.log('🔍 Sales Reports - Parsed params:', { limit, page });

      let branchObjectIds;
      let startDate;
      let endDate;

      console.log('🔍 Sales Reports - Checking filters:', {
        hasSalesReportsFilters: !!req.salesReportsFilters,
        branchObjectIds: req.salesReportsFilters?.branchObjectIds,
      });

      console.log('🔍 Sales Reports - Pre-parsed filters content:', req.salesReportsFilters);

      if (req.salesReportsFilters && Array.isArray(req.salesReportsFilters.branchObjectIds)) {
        console.log('🔍 Sales Reports - Using pre-parsed filters');
        console.log('🔍 Sales Reports - Pre-parsed dates:', {
          startDate: req.salesReportsFilters.startDate,
          endDate: req.salesReportsFilters.endDate,
        });
        branchObjectIds = req.salesReportsFilters.branchObjectIds;
        startDate = req.salesReportsFilters.startDate;
        endDate = req.salesReportsFilters.endDate;

        console.log('🔍 Sales Reports - After pre-parsed filters:', { startDate, endDate });

        // Apply session filtering if user has permission (same as salesSummaryReports)
        if (startDate || endDate) {
          console.log('🔍 Sales Reports - Before filter (pre-parsed):', { startDate, endDate });

          const originalDateRange = {
            start_date: startDate,
            end_date: endDate,
          };

          console.log('🔍 Sales Reports - About to apply session filter (pre-parsed)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Sales Reports - Date range (pre-parsed):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          startDate = filteredDateRange.start_date;
          endDate = filteredDateRange.end_date;

          console.log('🔍 Sales Reports - Date comparison (pre-parsed):', {
            before: {
              start: req.salesReportsFilters.startDate,
              end: req.salesReportsFilters.endDate,
            },
            after: { start: startDate, end: endDate },
            changed:
              req.salesReportsFilters.startDate !== startDate ||
              req.salesReportsFilters.endDate !== endDate,
          });
        }
      } else {
        console.log('🔍 Sales Reports - Parsing branch IDs from query');
        // Parse branch IDs (can be single string or array)
        let branchIds = req.query.branch || req.query.branchid;
        console.log('🔍 Sales Reports - Branch IDs from query:', branchIds);

        if (!branchIds) {
          console.log('🔍 Sales Reports - No branch IDs found - returning 400');
          return res.status(400).json({
            type: 'error',
            message: 'Branch ID is required',
            data: null,
          });
        }

        // Convert to array if single string
        if (!Array.isArray(branchIds)) {
          branchIds = [branchIds];
        }

        // Convert to ObjectIds
        branchObjectIds = branchIds
          .filter((id) => id && ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        if (!branchObjectIds.length) {
          return res.status(400).json({
            type: 'error',
            message: ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED,
            data: null,
          });
        }

        // Parse dates matching PHP model lines 1054-1055
        const startingDate = req.query.starting_date;
        const endingDate = req.query.ending_date;

        if (!startingDate || !endingDate) {
          return res.status(400).json({
            type: 'error',
            message: 'Date range is required',
            data: null,
          });
        }

        // Create date range (assuming dates come as 'YYYY-MM-DD' from frontend)
        startDate = new Date(startingDate);
        startDate.setHours(0, 0, 0, 0);

        endDate = new Date(endingDate);
        endDate.setHours(23, 59, 59, 999);

        // Apply session filtering if user has permission (same as salesSummaryReports)
        console.log('🔍 Sales Reports - Before filter:', { startDate, endDate });

        const originalDateRange = {
          start_date: startDate,
          end_date: endDate,
        };

        console.log('🔍 Sales Reports - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Sales Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Use filtered dates
        const oldStartDate = startDate;
        const oldEndDate = endDate;
        startDate = filteredDateRange.start_date;
        endDate = filteredDateRange.end_date;

        console.log('🔍 Sales Reports - Date comparison:', {
          before: { start: oldStartDate, end: oldEndDate },
          after: { start: startDate, end: endDate },
          changed: oldStartDate !== startDate || oldEndDate !== endDate,
        });
      }

      // Build filter matching PHP model lines 1062-1068
      const match = {
        $and: [
          { branch_id: { $in: branchObjectIds } },
          { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
          {
            updated_date: { $gte: startDate, $lte: endDate },
            license: new ObjectId(req.user.license || req.user.licenseId),
          },
        ],
      };

      /*
       * The branch whose report this is, for its date order and its clock.
       *
       * Read once here rather than per row. A failure to find it is not worth
       * failing the report over - the defaults are the ones nearly every shop
       * would have chosen anyway.
       */
      let branch = null;
      try {
        branch = await currentConnection(mongoose.connection)
          .db.collection('branches')
          .findOne(
            { _id: branchObjectIds[0] },
            { projection: { client_dateformat: 1, time_zone: 1 } }
          );
      } catch (err) {
        console.warn('Sales report: could not read branch date settings:', err.message);
      }

      const SaleModel = this.model || Sale;
      const responseData = await salesService.getSalesReportsData(
        { match, page, limit, branch },
        { SaleModel }
      );

      // Return PHP-compatible response structure
      return res.status(200).json({
        type: 'success',
        message: SUCCESS_MESSAGES.GENERIC_SUCCESS_LOWER,
        data: responseData,
      });
    } catch (error) {
      console.error('Error in salesReports:', error);
      return res.status(500).json({
        type: 'error',
        message: error.message || 'Failed to generate sales report',
        data: null,
      });
    }
  }

  async instantSalesReports(req, res) {
    try {
      const role = (req.user?.usertype || req.user?.role || '').toLowerCase();
      const hasPermission =
        req.user?.access?.report?.read === true ||
        ['super_admin', 'admin', 'manager', 'api'].includes(role);

      if (!hasPermission) {
        return this.error(res, 'Unauthorized', 403);
      }

      let limit;
      let page;

      if (req.reportParams && typeof req.reportParams.limit === 'number') {
        ({ limit, page } = req.reportParams);
      } else {
        const limitCandidate = parseInt(req.query.limit, 10);
        const pageCandidate = parseInt(req.query.page, 10);

        limit = limitCandidate > 0 ? limitCandidate : 5;
        page = pageCandidate > 0 ? pageCandidate : 1;
      }

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      const dateFilter = {};

      if (req.reportParams && (req.reportParams.startDate || req.reportParams.endDate)) {
        // Apply session filtering if user has permission and dates are provided
        if (req.reportParams.startDate || req.reportParams.endDate) {
          console.log('🔍 Instant Sales Reports - Before filter (reportParams):', {
            startDate: req.reportParams.startDate,
            endDate: req.reportParams.endDate,
          });

          const originalDateRange = {
            start_date: req.reportParams.startDate || new Date(0),
            end_date: req.reportParams.endDate || new Date(),
          };

          console.log('🔍 Instant Sales Reports - About to apply session filter (reportParams)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Instant Sales Reports - Date range (reportParams):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          if (filteredDateRange.start_date) {
            dateFilter.$gte = filteredDateRange.start_date;
          }
          if (filteredDateRange.end_date) {
            dateFilter.$lte = filteredDateRange.end_date;
          }
        } else {
          if (req.reportParams.startDate) {
            dateFilter.$gte = req.reportParams.startDate;
          }
          if (req.reportParams.endDate) {
            dateFilter.$lte = req.reportParams.endDate;
          }
        }
      } else {
        const startDate = parseSaleDate(req.query.starting_date);
        const endDate = parseSaleDate(req.query.ending_date);

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Instant Sales Reports - Before filter (query):', {
            starting_date: req.query.starting_date,
            ending_date: req.query.ending_date,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Instant Sales Reports - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Instant Sales Reports - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          if (filteredDateRange.start_date) {
            const start = new Date(filteredDateRange.start_date);
            start.setHours(0, 0, 0, 0);
            dateFilter.$gte = start;
          }
          if (filteredDateRange.end_date) {
            const end = new Date(filteredDateRange.end_date);
            end.setHours(23, 59, 59, 999);
            dateFilter.$lte = end;
          }
        } else {
          if (startDate && !Number.isNaN(startDate.valueOf())) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            dateFilter.$gte = start;
          }
          if (endDate && !Number.isNaN(endDate.valueOf())) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            dateFilter.$lte = end;
          }
        }
      }

      // PHP uses ONLY 'date' field - NOT createdAt or other fields
      // Match PHP sales_model.php:2312-2322
      const matchConditions = [
        { branch_id: { $in: branchIds } },
        { 'items.item_status': 'instant' }, // Exact match, not regex
        { sale_process: { $in: ['Add', 'Edit', 'PartialReturn', 'Partial'] } },
      ];

      if (Object.keys(dateFilter).length) {
        matchConditions.push({ date: dateFilter }); // ONLY date field
      }

      const match = { $and: matchConditions };

      const SaleModel = this.model || Sale;
      const timeZone = resolveTimeZonePreference(req.user);
      console.log('🕐 instantSalesReports - Resolved timezone:', timeZone);
      console.log('🕐 instantSalesReports - User timezone sources:', {
        preferences_time_zone: req.user?.preferences?.time_zone,
        user_time_zone: req.user?.time_zone,
        user_timezone: req.user?.timezone,
        env_timezone: process.env.APP_TIMEZONE,
      });
      const { itemsList, total } = await salesService.getInstantSalesReportsData(
        { match, page, limit },
        { SaleModel }
      );

      // Map to match PHP response format (sales_model.php:2366-2386)
      // PHP line 2368: isset($doc->string_date) ? $doc->string_date : formatDate($doc->date)
      const list = itemsList.map((doc) => {
        const formattedDate = doc.string_date || formatDate(doc.date);

        return {
          _id: doc._id ? String(doc._id) : '',
          sales_id: doc.sales_id || '',
          date: formattedDate,
          item_name: doc.item_name || '',
          customer_name: doc.customer_name || '',
          user_name: doc.user_name || '',
          item_quantity: doc.item_quantity || 0,
          total_qty: doc.item_quantity || 0, // PHP maps item_quantity to total_qty
          total_amount: doc.total_amount || 0,
        };
      });

      return this.success(
        res,
        {
          total,
          total_pages: Math.ceil(total / limit) || 0,
          current_page: page,
          per_page: limit,
          list,
        },
        'Instant sales report retrieved successfully'
      );
    } catch (error) {
      console.error('Error in instantSalesReports:', error);
      return this.error(res, 'Unable to load instant sales report. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  async instantSaleDetails(req, res) {
    try {
      const role = (req.user?.usertype || req.user?.role || '').toLowerCase();
      const hasPermission =
        req.user?.access?.report?.read === true ||
        ['super_admin', 'admin', 'manager', 'api'].includes(role);

      if (!hasPermission) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const limitCandidate = parseInt(req.query.limit, 10);
      const pageCandidate = parseInt(req.query.page, 10);

      const limit = limitCandidate > 0 ? limitCandidate : 5;
      const page = pageCandidate > 0 ? pageCandidate : 1;

      const instantId = req.query.instant_id || req.query.sale_id || req.query.id;

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      const SaleModel = this.model || Sale;
      const sale = await salesService.getSaleById(instantId, { SaleModel });

      if (!sale) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND, 404);
      }

      const saleBranchCandidate =
        (sale.branch && (sale.branch._id || sale.branch.id)) || sale.branch;
      const saleBranchId =
        saleBranchCandidate && saleBranchCandidate.toString
          ? saleBranchCandidate.toString()
          : saleBranchCandidate
            ? String(saleBranchCandidate)
            : null;

      if (
        saleBranchId &&
        branchIds.length &&
        !branchIds.some((branchId) => branchId.toString() === saleBranchId)
      ) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND_FOR_SELECTED_BRANCH, 404);
      }

      const { instantItems } = calculateInstantMetrics(sale.items || []);
      const sortedItems = [...instantItems].sort((a, b) => {
        const amountA = numberOrZero(
          a?.total ?? a?.total_amount ?? a?.line_total ?? a?.items_total ?? 0,
          0
        );
        const amountB = numberOrZero(
          b?.total ?? b?.total_amount ?? b?.line_total ?? b?.items_total ?? 0,
          0
        );
        return amountB - amountA;
      });

      const total = sortedItems.length;
      const perPage = limit;
      const totalPages = perPage ? Math.ceil(total / perPage) : 0;
      const startIndex = (page - 1) * perPage;
      const pagedItems =
        perPage > 0 ? sortedItems.slice(startIndex, startIndex + perPage) : sortedItems;

      const saleIdentifier =
        sale.sales_id ||
        sale.invoice_number ||
        sale.alternative_id ||
        (sale._id && sale._id.toString ? sale._id.toString() : '');

      const list = pagedItems.map((item) => {
        const amount = roundToTwo(
          numberOrZero(
            item?.total ?? item?.total_amount ?? item?.line_total ?? item?.items_total ?? 0,
            0
          )
        );
        const quantity = numberOrZero(
          item?.quantity ?? item?.item_quantity ?? item?.qty ?? item?.count ?? 0,
          0
        );
        const itemIdCandidate =
          (item.item && (item.item._id || item.item.id)) ||
          item.item ||
          item.item_id ||
          item._id ||
          null;
        const itemId =
          itemIdCandidate && itemIdCandidate.toString
            ? itemIdCandidate.toString()
            : itemIdCandidate;

        return {
          _id: itemId,
          name: item.name || item.item_name || item.description || '',
          sales_id: saleIdentifier,
          total_amount: amount,
          item_quantity: quantity,
        };
      });

      return this.success(
        res,
        {
          total,
          current_page: page,
          total_pages: totalPages,
          per_page: perPage,
          list,
        },
        'Instant sale details retrieved successfully'
      );
    } catch (error) {
      console.error('Error in instantSaleDetails:', error);
      return this.error(res, 'Unable to load instant sale details. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  async itemSalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let limit;
      let page;
      let skip;
      const dateFilter = {};

      if (req.reportParams && typeof req.reportParams.limit === 'number') {
        ({ limit, page, skip } = req.reportParams);
        const { startDate, endDate } = req.reportParams;

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Item Sales Report Table - Before filter (reportParams):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Item Sales Report Table - About to apply session filter (reportParams)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Item Sales Report Table - Date range (reportParams):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      } else {
        const limitCandidate = parseInt(req.query.limit, 10);
        const pageCandidate = parseInt(req.query.page, 10);
        limit = limitCandidate > 0 ? limitCandidate : 5;
        page = pageCandidate > 0 ? pageCandidate : 1;
        skip = (page - 1) * limit;

        const startDate = normalizeRangeDate(req.query.starting_date);
        const endDate = normalizeRangeDate(req.query.ending_date, {
          endOfDay: true,
        });

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Item Sales Report Table - Before filter (query):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Item Sales Report Table - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Item Sales Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      }

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      // PHP uses ONLY branch_id and updated_date - sales_model.php:3867-3874
      const matchConditions = [
        { branch_id: { $in: branchIds } },
        { sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } },
      ];

      // PHP uses ONLY updated_date field (line 3871)
      if (Object.keys(dateFilter).length) {
        matchConditions.push({ updated_date: dateFilter });
      }

      const match = { $and: matchConditions };

      const SaleModel = this.model || Sale;

      const { total, list: rawList } = await salesService.getItemSalesReportTableData(
        { match, skip, limit },
        { SaleModel }
      );

      const formatId = (value) => {
        if (!value && value !== 0) {
          return null;
        }
        if (typeof value === 'string') {
          return value;
        }
        if (value && typeof value === 'object' && value.toString) {
          return value.toString();
        }
        return String(value);
      };

      const list = rawList.map((entry) => ({
        _id: formatId(entry.item_id || entry._id || null),
        name: entry.name || '',
        total_amount: roundToTwo(entry.total_amount || 0),
        sales_avg: roundToTwo(entry.sales_avg || 0),
        sales_count: entry.sales_count || 0,
        item_quantity: roundToTwo(entry.item_quantity || 0),
        sales_profit: roundToTwo(entry.sales_profit || 0),
      }));

      return this.success(
        res,
        {
          total,
          total_pages: Math.ceil(total / limit) || 0,
          current_page: page,
          per_page: limit,
          list,
        },
        'Item sales report retrieved successfully'
      );
    } catch (error) {
      console.error('Error in itemSalesReportTable:', error);
      return this.error(res, 'Unable to load item sales report. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  async categorySalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let limit;
      let page;
      let skip;
      const dateFilter = {};

      if (req.reportParams && typeof req.reportParams.limit === 'number') {
        ({ limit, page, skip } = req.reportParams);
        const { startDate, endDate } = req.reportParams;

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Category Sales Report Table - Before filter (reportParams):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Category Sales Report Table - About to apply session filter (reportParams)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Category Sales Report Table - Date range (reportParams):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      } else {
        const limitCandidate = parseInt(req.query.limit, 10);
        const pageCandidate = parseInt(req.query.page, 10);
        limit = limitCandidate > 0 ? limitCandidate : 5;
        page = pageCandidate > 0 ? pageCandidate : 1;
        skip = (page - 1) * limit;

        const startDate = normalizeRangeDate(req.query.starting_date);
        const endDate = normalizeRangeDate(req.query.ending_date, {
          endOfDay: true,
        });

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Category Sales Report Table - Before filter (query):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Category Sales Report Table - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Category Sales Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      }

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      const matchConditions = [
        {
          $or: [
            { branch: { $in: branchIds } },
            { branch_id: { $in: branchIds } },
            { branchId: { $in: branchIds } },
            { 'branch._id': { $in: branchIds } },
          ],
        },
        { sale_process: { $in: GRAPH_ALLOWED_SALE_PROCESSES } },
        { status: { $ne: SALE_STATUS.CANCELLED } },
      ];

      if (Object.keys(dateFilter).length) {
        matchConditions.push({
          $or: [
            { updatedAt: dateFilter },
            { createdAt: dateFilter },
            { updated_date: dateFilter },
            { date: dateFilter },
          ],
        });
      }

      const requestedCategoryIdInput = normalizeToMongooseId(
        req.query.field_input || req.query.category_id || req.query.categoryId
      );
      const requestedCategoryId =
        requestedCategoryIdInput && requestedCategoryIdInput.toString
          ? requestedCategoryIdInput.toString()
          : null;

      const SaleModel = this.model || Sale;

      const match = { $and: matchConditions };

      const { total, list: rawList } = await salesService.getCategorySalesReportTableData(
        { match, skip, limit, requestedCategoryId },
        { SaleModel }
      );

      const list = rawList.map((entry) => ({
        category_id: entry.category_id || null,
        name: entry.category_name || '',
        total_amount: roundToTwo(entry.total_amount || 0),
        sales_avg: roundToTwo(entry.sales_avg || 0),
        sales_count: entry.sales_count || 0,
        item_quantity: roundToTwo(entry.item_quantity || 0),
        sales_profit: roundToTwo(entry.sales_profit || 0),
      }));

      return this.success(
        res,
        {
          total,
          total_pages: Math.ceil(total / limit) || 0,
          current_page: page,
          per_page: limit,
          list,
        },
        'Category sales report retrieved successfully'
      );
    } catch (error) {
      console.error('Error in categorySalesReportTable:', error);
      return this.error(res, 'Unable to load category sales report. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  async supplierSalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let limit;
      let page;
      let skip;
      const dateFilter = {};

      if (req.reportParams && typeof req.reportParams.limit === 'number') {
        ({ limit, page, skip } = req.reportParams);
        const { startDate, endDate } = req.reportParams;

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Supplier Sales Report Table - Before filter (reportParams):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Supplier Sales Report Table - About to apply session filter (reportParams)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Supplier Sales Report Table - Date range (reportParams):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      } else {
        const limitCandidate = parseInt(req.query.limit, 10);
        const pageCandidate = parseInt(req.query.page, 10);
        limit = limitCandidate > 0 ? limitCandidate : 5;
        page = pageCandidate > 0 ? pageCandidate : 1;
        skip = (page - 1) * limit;

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

        const startDate = normalizeRangeDate(req.query.starting_date);
        const endDate = normalizeRangeDate(req.query.ending_date, {
          endOfDay: true,
        });

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Supplier Sales Report Table - Before filter (query):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Supplier Sales Report Table - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Supplier Sales Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      }

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      const matchConditions = [
        { branch_id: { $in: branchIds } },
        { sale_process: { $in: GRAPH_ALLOWED_SALE_PROCESSES } },
      ];

      if (Object.keys(dateFilter).length) {
        matchConditions.push({ updated_date: dateFilter });
      }

      const licenseId = req.user?.license || req.user?.licenseId;
      if (licenseId) {
        matchConditions.push({
          license: mongoose.Types.ObjectId.isValid(String(licenseId))
            ? new mongoose.Types.ObjectId(String(licenseId))
            : licenseId,
        });
      }

      const requestedSupplierIdInput = normalizeToMongooseId(
        req.query.field_input || req.query.supplier_id || req.query.supplierId
      );
      const requestedSupplierId =
        requestedSupplierIdInput && requestedSupplierIdInput.toString
          ? requestedSupplierIdInput.toString()
          : null;

      const match = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

      const SaleModel = this.model || Sale;

      const { total, list: rawList } = await salesService.getSupplierSalesReportTableData(
        { match, skip, limit, requestedSupplierId },
        { SaleModel }
      );

      const list = rawList.map((entry) => ({
        supplier_id: entry.supplier_id || null,
        name: entry.supplier_name || '',
        total_amount: roundToTwo(entry.total_amount || 0),
        sales_avg: roundToTwo(entry.sales_avg || 0),
        sales_count: entry.sales_count || 0,
        item_quantity: roundToTwo(entry.item_quantity || 0),
        sales_profit: roundToTwo(entry.sales_profit || 0),
      }));

      return this.success(
        res,
        {
          total,
          total_pages: Math.ceil(total / limit) || 0,
          current_page: page,
          per_page: limit,
          list,
        },
        'Supplier sales report retrieved successfully'
      );
    } catch (error) {
      console.error('Error in supplierSalesReportTable:', error);
      return this.error(res, 'Unable to load supplier sales report. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  async customerSalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let limit;
      let page;
      let skip;
      const dateFilter = {};

      if (req.reportParams && typeof req.reportParams.limit === 'number') {
        ({ limit, page, skip } = req.reportParams);
        const { startDate, endDate } = req.reportParams;

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Customer Sales Report Table - Before filter (reportParams):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Customer Sales Report Table - About to apply session filter (reportParams)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Customer Sales Report Table - Date range (reportParams):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      } else {
        const limitCandidate = parseInt(req.query.limit, 10);
        const pageCandidate = parseInt(req.query.page, 10);
        limit = limitCandidate > 0 ? limitCandidate : 5;
        page = pageCandidate > 0 ? pageCandidate : 1;
        skip = (page - 1) * limit;

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

        const startDate = normalizeRangeDate(req.query.starting_date);
        const endDate = normalizeRangeDate(req.query.ending_date, {
          endOfDay: true,
        });

        // Apply session filtering if user has permission and dates are provided
        if (startDate || endDate) {
          console.log('🔍 Customer Sales Report Table - Before filter (query):', {
            startDate,
            endDate,
          });

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Customer Sales Report Table - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Customer Sales Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Use filtered dates
          const filteredStartDate = filteredDateRange.start_date;
          const filteredEndDate = filteredDateRange.end_date;

          if (filteredStartDate) {
            dateFilter.$gte = filteredStartDate;
          }
          if (filteredEndDate) {
            dateFilter.$lte = filteredEndDate;
          }
        } else {
          if (startDate) {
            dateFilter.$gte = startDate;
          }
          if (endDate) {
            dateFilter.$lte = endDate;
          }
        }
      }

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      const matchConditions = [
        {
          $or: [
            { branch: { $in: branchIds } },
            { branch_id: { $in: branchIds } },
            { branchId: { $in: branchIds } },
            { 'branch._id': { $in: branchIds } },
          ],
        },
        { sale_process: { $in: GRAPH_ALLOWED_SALE_PROCESSES } },
        { status: { $ne: SALE_STATUS.CANCELLED } },
      ];

      if (Object.keys(dateFilter).length) {
        matchConditions.push({
          $or: [
            { updatedAt: dateFilter },
            { createdAt: dateFilter },
            { updated_date: dateFilter },
            { date: dateFilter },
          ],
        });
      }

      const requestedCustomerId = normalizeToMongooseId(
        req.query.field_input || req.query.customer_id
      );
      if (requestedCustomerId) {
        matchConditions.push({
          $or: [
            { customer: requestedCustomerId },
            { customer_id: requestedCustomerId },
            { customerId: requestedCustomerId },
            { 'customer._id': requestedCustomerId },
          ],
        });
      }

      const match = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

      const SaleModel = this.model || Sale;

      const { total, list: rawList } = await salesService.getCustomerSalesReportTableData(
        { match, skip, limit },
        { SaleModel }
      );

      const formatId = (value) => {
        if (!value && value !== 0) {
          return null;
        }
        if (typeof value === 'string') {
          return value;
        }
        if (value && typeof value === 'object' && value.toString) {
          return value.toString();
        }
        return String(value);
      };

      const list = rawList.map((entry) => ({
        customer_id: formatId(entry._id?.customer_id || null),
        customer_name: entry._id?.customer_name || '',
        customer_phone: entry._id?.customer_phone || '',
        sales_payment: roundToTwo(entry.sales_payment || 0),
        refund_payment: roundToTwo(entry.refund_payment || 0),
        sales_count: entry.sales_count || 0,
        sales_avg: roundToTwo(entry.sales_avg || 0),
      }));

      return this.success(
        res,
        {
          total,
          total_pages: Math.ceil(total / limit) || 0,
          current_page: page,
          per_page: limit,
          list,
        },
        'Customer sales report retrieved successfully'
      );
    } catch (error) {
      console.error('Error in customerSalesReportTable:', error);
      return this.error(res, 'Unable to load customer sales report. Please try again later.', 500, {
        error: error.message,
      });
    }
  }

  /**
   * Legacy endpoint: GET /sales/itemGraphicalReports
   * Returns top 5 selling items (quantity + amount string) for the date range.
   */
  async itemGraphicalReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const statuses = [...GRAPH_ALLOWED_SALE_PROCESSES, 'FullReturn'];

      const { branchIds, error: branchError } = this.extractBranchObjectIds(req);
      if (branchError) {
        return this.error(res, branchError, 400);
      }

      let startDate;
      let endDate;

      if (req.reportParams && (req.reportParams.startDate || req.reportParams.endDate)) {
        startDate = req.reportParams.startDate || null;
        endDate = req.reportParams.endDate || null;
      } else {
        startDate = normalizeRangeDate(req.query.starting_date);
        endDate = normalizeRangeDate(req.query.ending_date, {
          endOfDay: true,
        });
      }

      // Apply session filtering if user has permission and dates are provided
      if (startDate || endDate) {
        console.log('🔍 Item Graphical Reports - Before filter:', { startDate, endDate });

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 Item Graphical Reports - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Item Graphical Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Use filtered dates
        startDate = filteredDateRange.start_date;
        endDate = filteredDateRange.end_date;
      }

      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = startDate;
      }
      if (endDate) {
        dateFilter.$lte = endDate;
      }

      const matchConditions = [
        {
          $or: [
            { branch: { $in: branchIds } },
            { branch_id: { $in: branchIds } },
            { branchId: { $in: branchIds } },
            { 'branch._id': { $in: branchIds } },
          ],
        },
        { sale_process: { $in: statuses } },
        { status: { $ne: SALE_STATUS.CANCELLED } },
      ];

      if (Object.keys(dateFilter).length) {
        matchConditions.push({
          $or: [
            { updatedAt: dateFilter },
            { createdAt: dateFilter },
            { updated_date: dateFilter },
            { date: dateFilter },
          ],
        });
      }

      const match = matchConditions.length > 1 ? { $and: matchConditions } : matchConditions[0];

      const SaleModel = this.model || Sale;

      const results = await salesService.getItemGraphicalReportsData({ match }, { SaleModel });

      const currencySymbol =
        req.user?.settings?.currency_symbol ||
        req.user?.settings?.currency ||
        req.user?.branch?.currency ||
        req.user?.branch?.currency_type ||
        '₹';

      const formatted = results.map((entry) => {
        const total = roundToTwo(entry.total_amount || 0);
        const qty = roundToTwo(entry.total_qty || 0);
        return {
          name: entry._id || 'Unnamed Item',
          amount: `${currencySymbol} ${total.toFixed(2)} (Qty : ${qty})`,
        };
      });

      return this.success(res, formatted, 'Item graphical report retrieved successfully');
    } catch (error) {
      console.error('Error in itemGraphicalReports:', error);
      return this.error(res, 'Failed to load item graphical report. Please try again later.', 500);
    }
  }

  extractBranchObjectIds(req) {
    const parseBranchValue = (value) => {
      if (value === undefined || value === null || value === '') {
        return [];
      }
      if (Array.isArray(value)) {
        return value.flatMap((entry) => parseBranchValue(entry));
      }
      if (typeof value === 'object') {
        const candidates = [
          value.branch_id,
          value.branchId,
          value._id,
          value.id,
          value.$oid,
        ].filter(Boolean);
        return candidates.map((entry) => String(entry));
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
              return parsed.flatMap((entry) => parseBranchValue(entry));
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
      req?.query?.branch,
      req?.query?.['branch[]'],
      req?.query?.branch_id,
      req?.query?.branchId,
    ];

    let branchIds = branchInputs
      .flatMap((value) => parseBranchValue(value))
      .filter((value) => typeof value === 'string' && value.trim());

    if (!branchIds.length) {
      const fallbackBranch = resolveBranchId(req.user, req.session);
      if (fallbackBranch) {
        branchIds = [String(fallbackBranch)];
      }
    }

    const normalized = [...new Set(branchIds.map((id) => id.trim()).filter(Boolean))];

    if (!normalized.length) {
      return { branchIds: [], error: 'At least one branch id is required' };
    }

    const validBranchIds = normalized
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!validBranchIds.length) {
      return { branchIds: [], error: 'No valid branch ids provided' };
    }

    return { branchIds: validBranchIds };
  }

  async holdSale(req, res, next) {
    try {
      if (!this.checkPermission('sales', 'write', req.user)) {
        return this.error(res, 'You do not have permission to hold sales', 403);
      }

      const { customer_name: customerName, items } = req.body || {};

      if (!customerName || !customerName.trim()) {
        return this.error(res, ERROR_MESSAGES.CUSTOMER_NAME_REQUIRED, 400);
      }

      if (!Array.isArray(items) || items.length === 0) {
        return this.error(res, 'At least one item is required to put a sale on hold', 400);
      }

      return this.createOrHoldInternal(req, res, next, {
        processOverride: 'Hold',
        successMessage: SUCCESS_MESSAGES.SALE_HOLD_SUCCESS,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Get user sales report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async userReportTable(req, res) {
    try {
      console.log('🔍 User Report Table - METHOD CALLED!');
      console.log('🔍 User Report Table - Full Query Params:', req.query);
      console.log('🔍 User Report Table - User Info:', {
        _id: req.user?._id,
        usertype: req.user?.usertype,
        access: req.user?.access,
      });

      if (!this.checkPermission('report', 'read', req.user)) {
        console.log('❌ User Report Table - Permission Denied');
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      console.log('✅ User Report Table - Permission Granted');

      let options;
      let data;

      if (req.userReportParams && req.userReportParams.options && req.userReportParams.data) {
        console.log('🔍 User Report Table - Using pre-parsed params');
        options = req.userReportParams.options;
        data = req.userReportParams.data;

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 User Report Table - Before filter (pre-parsed):', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 User Report Table - About to apply session filter (pre-parsed)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 User Report Table - Date range (pre-parsed):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log('🔍 User Report Table - Final Data After Filter (pre-parsed):', data);
        } else {
          console.log(
            '🔍 User Report Table - No dates provided in pre-parsed params, skipping session filter'
          );
        }
      } else {
        console.log('🔍 User Report Table - Building data from query params');
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
          user_id: req.query.field_input || '',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 User Report Table - Before filter (query):', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 User Report Table - About to apply session filter (query)...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 User Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log('🔍 User Report Table - Final Data After Filter (query):', data);
        } else {
          console.log('🔍 User Report Table - No dates provided, skipping session filter');
        }
      }

      const SaleModel = this.model || Sale;

      // Delegate to service wrapper so controller does not talk to model directly
      const result = await salesService.userReportPage(data, options, {
        SaleModel,
      });

      if (result.status === true) {
        // Model already returns properly formatted data, no need for mongoIDFilter
        const list = result.list || [];

        // Ensure pagination has proper values (no NaN)
        const pagination = result.pagination || {};
        const total = pagination.total || 0;
        // limit and page are const-declared inside an else block further up, so
        // they are not in scope here - this fell back to a ReferenceError
        // rather than to a default. options carries the same two values and
        // is declared in the enclosing scope.
        const currentLimit = pagination.limit || options?.limit || 5;
        const safePages = Math.max(Math.ceil(total / currentLimit), 1);

        // PHP format: flatten pagination to top level
        return this.success(
          res,
          {
            total,
            current_page: pagination.page || options?.page || 1,
            total_pages: safePages,
            per_page: currentLimit,
            list,
          },
          list.length > 0 ? SUCCESS_MESSAGES.GET_SUCCESSFULLY : SUCCESS_MESSAGES.NO_RECORDS_FOUND
        );
      } else {
        // Even on error, return empty list with PHP format
        return this.success(
          res,
          {
            total: 0,
            current_page: options.page,
            total_pages: 0,
            per_page: options.limit,
            list: [],
          },
          SUCCESS_MESSAGES.NO_RECORDS_FOUND
        );
      }
    } catch (error) {
      console.error('Error in SalesController.userReportTable:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_USER_SALES_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get user graphical reports data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async userGraphicalReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
        user_id: req.query.field_input || '',
      };

      // Apply session filtering if user has permission and dates are provided
      if (data.starting_date || data.ending_date) {
        console.log('🔍 User Graphical Reports - Before filter:', {
          starting_date: data.starting_date,
          ending_date: data.ending_date,
        });

        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 User Graphical Reports - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 User Graphical Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Update data with filtered dates
        data.starting_date = filteredDateRange.start_date;
        data.ending_date = filteredDateRange.end_date;
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.getUserGraphicalReports(data, {
        SaleModel,
      });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in SalesController.userGraphicalReports:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_USER_GRAPHICAL_REPORTS_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get return sales report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async returnSalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let options;
      let data;

      if (
        req.branchPaginatedReportParams &&
        req.branchPaginatedReportParams.options &&
        req.branchPaginatedReportParams.data
      ) {
        ({ options, data } = req.branchPaginatedReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Return Sales Report Table - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Return Sales Report Table - About to apply session filter...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Return Sales Report Table - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.returnSalesReportPage(data, options, {
        SaleModel,
      });
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in SalesController.returnSalesReportTable:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_RETURN_SALES_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get product based return details data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async productBasedReturnDetails(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      const SaleModel = this.model || Sale;
      const result = await salesService.productBasedReportPage(data, options, {
        SaleModel,
      });

      if (result.status === true) {
        const pagination = result.pagination || {};
        const list = this.mongoIDFilter(result.list || []);
        const payload = {
          status: true,
          total: pagination.total || 0,
          current_page: pagination.page || page,
          total_pages:
            pagination.pages ||
            Math.max(Math.ceil((pagination.total || 0) / (pagination.limit || limit || 1)), 1),
          per_page: pagination.limit || limit,
          list,
        };

        return this.success(
          res,
          payload,
          list.length ? SUCCESS_MESSAGES.GET_SUCCESSFULLY : SUCCESS_MESSAGES.NO_RECORDS_FOUND
        );
      } else {
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404, result);
      }
    } catch (error) {
      console.error('Error in SalesController.productBasedReturnDetails:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_PRODUCT_BASED_RETURN_DETAILS_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Filter MongoDB ObjectIDs to strings (similar to PHP MongoIDFilter)
   * @param {Array} data - Array of documents to filter
   * @returns {Array} - Filtered array with ObjectIDs converted to strings
   */
  mongoIDFilter(data) {
    if (!Array.isArray(data)) return data;

    const serializeValue = (value) => {
      if (value === null || value === undefined) {
        return value;
      }

      // Dates -> Mongo extended JSON
      if (value instanceof Date) {
        return {
          $date: {
            $numberLong: value.getTime().toString(),
          },
        };
      }

      // ObjectId-like instances
      if (
        value &&
        typeof value === 'object' &&
        value.constructor &&
        value.constructor.name === 'ObjectId' &&
        typeof value.toString === 'function'
      ) {
        return value.toString();
      }

      if (Array.isArray(value)) {
        return value.map((entry) => serializeValue(entry));
      }

      if (typeof value === 'object') {
        const output = {};
        Object.keys(value).forEach((key) => {
          if (key === '_id' && value[key] && typeof value[key].toString === 'function') {
            output[key] = value[key].toString();
          } else {
            output[key] = serializeValue(value[key]);
          }
        });
        return output;
      }

      return value;
    };

    return data.map((item) => serializeValue({ ...item }));
  }

  /**
   * Get pending sales report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async pendingSalesReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let options;
      let data;

      if (
        req.branchPaginatedReportParams &&
        req.branchPaginatedReportParams.options &&
        req.branchPaginatedReportParams.data
      ) {
        ({ options, data } = req.branchPaginatedReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Pending Sales Report Table - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Pending Sales Report Table - About to apply session filter...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Pending Sales Report Table - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.pendingSalesReportPage(data, options, {
        SaleModel,
      });
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in SalesController.pendingSalesReportTable:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_PENDING_SALES_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get pending customer report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async pendingCustomerReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let options;
      let data;

      if (
        req.branchPaginatedReportParams &&
        req.branchPaginatedReportParams.options &&
        req.branchPaginatedReportParams.data
      ) {
        ({ options, data } = req.branchPaginatedReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Pending Customer Report Table - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Pending Customer Report Table - About to apply session filter...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Pending Customer Report Table - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.pendingCustomerReportPage(data, options, { SaleModel });
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in SalesController.pendingCustomerReportTable:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_PENDING_CUSTOMER_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get tax sales report data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async taxSalesReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let data;

      if (req.branchReportParams && req.branchReportParams.data) {
        ({ data } = req.branchReportParams);
      } else {
        // Handle both 'branch' and 'branch[]' query params
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Tax Sales Reports - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Tax Sales Reports - About to apply session filter...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Tax Sales Reports - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.taxSalesReportPage(data, { SaleModel });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in SalesController.taxSalesReports:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_TAX_SALES_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get payment sales transaction report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async paymentSalesTranscationReportTable(req, res) {
    try {
      console.log('🔍 Payment Sales Transaction Report Table - METHOD CALLED!');
      console.log('🔍 Payment Sales Transaction Report Table - Full Query Params:', req.query);
      console.log('🔍 Payment Sales Transaction Report Table - User Info:', {
        _id: req.user?._id,
        usertype: req.user?.usertype,
        access: req.user?.access,
      });

      if (!this.checkPermission('report', 'read', req.user)) {
        console.log('❌ Payment Sales Transaction Report Table - Permission Denied');
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      console.log('✅ Payment Sales Transaction Report Table - Permission Granted');

      let options;
      let data;

      if (
        req.paymentReportParams &&
        req.paymentReportParams.options &&
        req.paymentReportParams.data
      ) {
        console.log('🔍 Payment Sales Transaction Report Table - Using pre-parsed params');
        ({ options, data } = req.paymentReportParams);

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Payment Sales Transaction Report Table - Before filter (pre-parsed):', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Payment Sales Transaction Report Table - About to apply session filter (pre-parsed)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Payment Sales Transaction Report Table - Date range (pre-parsed):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log(
            '🔍 Payment Sales Transaction Report Table - Final Data After Filter (pre-parsed):',
            data
          );
        } else {
          console.log(
            '🔍 Payment Sales Transaction Report Table - No dates provided in pre-parsed params, skipping session filter'
          );
        }
      } else {
        console.log('🔍 Payment Sales Transaction Report Table - Building data from query params');
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        // Handle both 'branch' and 'branch[]' query params
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
          payment_mode: req.query.payment_mode || 'All',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Payment Sales Transaction Report Table - Before filter (query):', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Payment Sales Transaction Report Table - About to apply session filter (query)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Payment Sales Transaction Report Table - Date range (query):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log(
            '🔍 Payment Sales Transaction Report Table - Final Data After Filter (query):',
            data
          );
        } else {
          console.log(
            '🔍 Payment Sales Transaction Report Table - No dates provided, skipping session filter'
          );
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.paymentSalesTransactionReportPage(data, options, {
        SaleModel,
      });
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in SalesController.paymentSalesTranscationReportTable:', error);
      return this.error(
        res,
        'Failed to retrieve payment sales transaction report: ' + error.message,
        500
      );
    }
  }

  /**
   * Get payment sale type report data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async paymentSaleTypeReport(req, res) {
    try {
      console.log('🔍 Payment Sale Type Report - METHOD CALLED!');
      console.log('🔍 Payment Sale Type Report - Full Query Params:', req.query);
      console.log('🔍 Payment Sale Type Report - User Info:', {
        _id: req.user?._id,
        usertype: req.user?.usertype,
        access: req.user?.access,
      });

      if (!this.checkPermission('report', 'read', req.user)) {
        console.log('❌ Payment Sale Type Report - Permission Denied');
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      console.log('✅ Payment Sale Type Report - Permission Granted');

      let data;

      if (req.branchReportParams && req.branchReportParams.data) {
        console.log('🔍 Payment Sale Type Report - Using pre-parsed params');
        ({ data } = req.branchReportParams);

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Payment Sale Type Report - Before filter (pre-parsed):', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Payment Sale Type Report - About to apply session filter (pre-parsed)...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Payment Sale Type Report - Date range (pre-parsed):', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log('🔍 Payment Sale Type Report - Final Data After Filter (pre-parsed):', data);
        } else {
          console.log(
            '🔍 Payment Sale Type Report - No dates provided in pre-parsed params, skipping session filter'
          );
        }
      } else {
        console.log('🔍 Payment Sale Type Report - Building data from query params');
        // Handle both 'branch' and 'branch[]' query params
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
        };

        console.log('🔍 Payment Sale Type Report - Initial Data:', data);

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Payment Sale Type Report - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log('🔍 Payment Sale Type Report - About to apply session filter...');
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Payment Sale Type Report - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log('🔍 Payment Sale Type Report - Final Data After Filter:', data);
        } else {
          console.log('🔍 Payment Sale Type Report - No dates provided, skipping session filter');
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.getPaymentSaleTypeReport(data, {
        SaleModel,
      });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in SalesController.paymentSaleTypeReport:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_PAYMENT_SALE_TYPE_REPORT_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * Get payment return sales transaction report table data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async paymentReturnSalesTranscationReportTable(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      let options;
      let data;

      if (
        req.paymentReportParams &&
        req.paymentReportParams.options &&
        req.paymentReportParams.data
      ) {
        ({ options, data } = req.paymentReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        // Handle both 'branch' and 'branch[]' query params
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date || '',
          ending_date: req.query.ending_date || '',
          payment_mode: req.query.payment_mode || 'All',
        };

        // Apply session filtering if user has permission and dates are provided
        if (data.starting_date || data.ending_date) {
          console.log('🔍 Payment Return Sales Transaction Report Table - Before filter:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });

          const startDate = data.starting_date ? new Date(data.starting_date) : null;
          const endDate = data.ending_date ? new Date(data.ending_date) : null;

          const originalDateRange = {
            start_date: startDate || new Date(0),
            end_date: endDate || new Date(),
          };

          console.log(
            '🔍 Payment Return Sales Transaction Report Table - About to apply session filter...'
          );
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 Payment Return Sales Transaction Report Table - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;
        }
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.paymentReturnSalesTranscationReportTable(data, options, {
        SaleModel,
      });
      return this.formatReportResponse(res, result, options);
    } catch (error) {
      console.error('Error in SalesController.paymentReturnSalesTranscationReportTable:', error);
      return this.error(
        res,
        'Failed to retrieve payment return sales transaction report: ' + error.message,
        500
      );
    }
  }

  /**
   * Get payment graphical reports data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async paymentGraphicalReports(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date || '',
        ending_date: req.query.ending_date || '',
      };

      // Apply session filtering if user has permission and dates are provided
      if (data.starting_date || data.ending_date) {
        console.log('🔍 Payment Graphical Reports - Before filter:', {
          starting_date: data.starting_date,
          ending_date: data.ending_date,
        });

        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 Payment Graphical Reports - About to apply session filter...');
        const filteredDateRange = await sessionFilterUtil.applySessionFilter(
          req,
          originalDateRange
        );

        console.log('🔍 Payment Graphical Reports - Date range:', {
          original: originalDateRange,
          filtered: filteredDateRange,
          session_applied: filteredDateRange?.session_applied || false,
        });

        // Update data with filtered dates
        data.starting_date = filteredDateRange.start_date;
        data.ending_date = filteredDateRange.end_date;
      }

      const SaleModel = this.model || Sale;

      const result = await salesService.getPaymentGraphicalReports(data, {
        SaleModel,
      });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404, result.data);
      }
    } catch (error) {
      console.error('Error in SalesController.paymentGraphicalReports:', error);
      return this.error(
        res,
        ERROR_MESSAGES.FAILED_TO_RETRIEVE_PAYMENT_GRAPHICAL_REPORTS_PREFIX + error.message,
        500
      );
    }
  }

  /**
   * PHP: salesReceipt()
   * Send sales receipt via email
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async salesReceipt(req, res) {
    try {
      // Validate email
      const email = req.body.email || req.query.email;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return this.error(res, ERROR_MESSAGES.VALID_EMAIL_REQUIRED, 400);
      }

      const saleId = req.body.sale_id || req.body.id || req.query.id;
      if (!saleId) {
        return this.error(res, ERROR_MESSAGES.SALE_ID_REQUIRED, 400);
      }

      const SaleModel = this.model || Sale;

      // Get sale details via service helper to keep DB access out of controller
      const sale = await salesService.getSaleForReceipt(saleId, { SaleModel });

      if (!sale) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND, 404);
      }

      // Send email receipt (basic implementation - enhance based on email service)
      const nodemailer = require('nodemailer');

      // Configure email transporter
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      });

      // Email content
      const emailContent = {
        from: process.env.EMAIL_FROM || 'noreply@posnic.com',
        to: email,
        subject: `Receipt - ${sale.sales_id}`,
        html: `
          <h2>Sale Receipt</h2>
          <p><strong>Invoice #:</strong> ${sale.sales_id}</p>
          <p><strong>Date:</strong> ${new Date(sale.date).toLocaleDateString()}</p>
          <p><strong>Customer:</strong> ${sale.customer_name}</p>
          <p><strong>Total:</strong> ${sale.items_total}</p>
          <p><strong>Payment Mode:</strong> ${sale.payment_mode}</p>
          <p>Thank you for your business!</p>
        `,
      };

      try {
        await transporter.sendMail(emailContent);
        return this.success(res, { sent: true }, 'Receipt sent successfully');
      } catch (emailError) {
        console.error('Email error:', emailError);
        return this.error(
          res,
          ERROR_MESSAGES.FAILED_TO_SEND_EMAIL_PREFIX + emailError.message,
          500
        );
      }
    } catch (error) {
      console.error('Error in salesReceipt:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getCustomerPrint()
   * Get customer print details for receipt/invoice
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getCustomerPrint(req, res) {
    try {
      let salesId = req.query.customer_id || req.query.id || req.params.id;

      if (!salesId) {
        return this.error(res, ERROR_MESSAGES.SALES_ID_REQUIRED, 400);
      }

      // The customer receipt link (customersMailPrint.html?id=...) carries an
      // AES-encrypted id (matching PHP getCustomerPrintDetails). Decrypt it back
      // to the real Mongo ObjectId before lookup. A plain ObjectId is passed
      // through unchanged so direct calls still work.
      if (!mongoose.Types.ObjectId.isValid(salesId)) {
        try {
          const Encryption = require('../utils/encryption');
          const decrypted = Encryption.decryptId(salesId);
          if (decrypted) salesId = decrypted;
        } catch (e) {
          console.error('getCustomerPrint: failed to decrypt id:', e.message);
        }
      }

      const SaleModel = this.model || Sale;

      // Get sale with full details via service helper
      const sale = await salesService.getSaleForCustomerPrint(salesId, {
        SaleModel,
      });

      if (!sale) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND, 404);
      }

      // Format print details — must match PHP getCustomerPrintDetails() exactly,
      // because the frontend (customer_mail.js) reads these precise field names
      // and calls .toFixed()/loops on them. A missing field (e.g. sales_sub_total)
      // throws in the browser and blanks the whole receipt below the header.
      const moment = require('moment-timezone');
      const branch = sale.branch_id || {};
      const tz = branch.time_zone || 'Asia/Kolkata';
      const saleMoment = sale.date ? moment(sale.date).tz(tz) : null;
      const num = (v) => (v === undefined || v === null || v === '' ? 0 : parseFloat(v) || 0);

      const branchDetails = {
        branch_image: branch.logo,
        branch_name: branch.branch_name,
        branch_address: branch.store_address,
        branch_phone: branch.store_telephone,
        branch_email: branch.store_email,
        branch_currency: branch.currency_type,
      };

      const salesDetails = {
        sales_id: sale.sales_id,
        customer_name: sale.customer_name,
        customer_address: sale.customer_address,
        customer_phone: sale.customer_phone,
        customer_email: sale.customer_email,
        date: saleMoment ? saleMoment.format('DD-MMM-YYYY') : '',
        time: saleMoment ? saleMoment.format('hh:mm a') : '',
        payment_mode: sale.payment_mode,
        total_amount: num(sale.sales_total),
        sales_sub_total: num(sale.sales_sub_total),
        total_items: parseInt(sale.number_of_items, 10) || (sale.items || []).length,
        tax: num(sale.tax),
        discount: num(sale.discount),
        items: sale.items || [], // raw items, exactly as PHP returns $sale['items']
        payment_status: sale.payment_status,
        partial_balance: num(sale.partial_balance),
        payment_pending: num(sale.payment_pending),
        partial_check: sale.partial_check,
        gst: sale.gst,
        round_off: Math.round(num(sale.round_off) * 100) / 100,
      };

      const printDetails = { ...branchDetails, ...salesDetails };

      return this.success(res, printDetails, 'success');
    } catch (error) {
      console.error('Error in getCustomerPrint:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: salesPdf()
   * Generate PDF invoice for viewing/downloading
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async salesPdf(req, res) {
    try {
      if (!this.checkPermission('sales', 'read', req.user)) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const id = req.query?.id;
      if (!id) {
        return this.error(res, ERROR_MESSAGES.SALE_ID_IS_REQUIRED, 400);
      }

      const { generateInvoicePDF } = require('../utils/pdfGenerator');

      const SaleModel = this.model || Sale;

      // Get sale details via service helper
      const sale = await salesService.getSaleForPdf(id, { SaleModel });

      if (!sale) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND, 404);
      }

      // Get branch/store details via existing service helper
      const branchId = sale.branch || sale.branch_id || sale.branchId;
      const branch = branchId ? await salesService.getBranchById(branchId) : null;

      // Generate PDF using reusable utility
      generateInvoicePDF({
        data: sale,
        branch: branch,
        res: res,
        config: {
          title: 'Sales Invoice.',
          idField: 'sales_id',
          itemsField: 'items',
          customerField: 'customer',
          dateField: 'date',
        },
      });
    } catch (error) {
      console.error('Error in salesPdf:', error);
      return this.error(res, ERROR_MESSAGES.UNABLE_TO_GENERATE_PDF, 500, { error: error.message });
    }
  }

  /**
   * PHP: salesMailPdf()
   * Generate PDF invoice and email to customer
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async salesMailPdf(req, res) {
    try {
      const salesId = req.query.customer_id || req.query.id;
      const email = req.query.email || req.body.email;

      if (!salesId) {
        return this.error(res, ERROR_MESSAGES.SALES_ID_REQUIRED, 400);
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return this.error(res, ERROR_MESSAGES.VALID_EMAIL_REQUIRED, 400);
      }

      const SaleModel = this.model || Sale;

      // Get sale details (same shape as getCustomerPrint) via service helper
      const sale = await salesService.getSaleForCustomerPrint(salesId, {
        SaleModel,
      });

      if (!sale) {
        return this.error(res, ERROR_MESSAGES.SALE_NOT_FOUND, 404);
      }

      // Generate PDF
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margin: 50 });

      // Create PDF buffer
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));

      doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(chunks);

        // Send email with PDF attachment
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: process.env.SMTP_PORT || 587,
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        });

        try {
          await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'noreply@posnic.com',
            to: email,
            subject: `Invoice - ${sale.sales_id}`,
            html: `
              <h2>Invoice</h2>
              <p>Dear ${sale.customer_name},</p>
              <p>Please find attached your invoice.</p>
              <p><strong>Invoice #:</strong> ${sale.sales_id}</p>
              <p><strong>Amount:</strong> ${sale.items_total}</p>
              <p>Thank you for your business!</p>
            `,
            attachments: [
              {
                filename: `invoice-${sale.sales_id}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
              },
            ],
          });

          return this.success(res, { sent: true, email }, 'PDF invoice emailed successfully');
        } catch (emailError) {
          console.error('Email error:', emailError);
          return this.error(
            res,
            ERROR_MESSAGES.FAILED_TO_SEND_EMAIL_PREFIX + emailError.message,
            500
          );
        }
      });

      // Generate PDF content
      doc.fontSize(20).text('INVOICE', { align: 'center' });
      doc.moveDown();

      // Branch details
      if (sale.branch_id) {
        doc.fontSize(10);
        doc.text(sale.branch_id.branch_name || 'Store Name');
        doc.text(sale.branch_id.store_address || '');
        doc.text(sale.branch_id.store_telephone || '');
      }
      doc.moveDown();

      // Invoice details
      doc.fontSize(12);
      doc.text(`Invoice #: ${sale.sales_id}`);
      doc.text(`Date: ${new Date(sale.date).toLocaleDateString()}`);
      doc.text(`Customer: ${sale.customer_name}`);
      doc.moveDown();

      // Items table header
      doc.fontSize(10);
      let y = doc.y;
      doc.text('Item', 50, y);
      doc.text('Qty', 250, y);
      doc.text('Price', 350, y);
      doc.text('Total', 450, y);
      doc.moveDown();

      // Items
      sale.items.forEach((item) => {
        y = doc.y;
        doc.text(item.item_name || 'Item', 50, y);
        doc.text(item.quantity.toString(), 250, y);
        doc.text(item.price.toFixed(2), 350, y);
        doc.text((item.quantity * item.price).toFixed(2), 450, y);
        doc.moveDown();
      });

      // Totals
      doc.moveDown();
      doc.fontSize(12);
      if (sale.subtotal) {
        doc.text(`Subtotal: ${sale.subtotal.toFixed(2)}`, { align: 'right' });
      }
      if (sale.discount) {
        doc.text(`Discount: ${sale.discount.toFixed(2)}`, { align: 'right' });
      }
      if (sale.tax) {
        doc.text(`Tax: ${sale.tax.toFixed(2)}`, { align: 'right' });
      }
      doc.text(`Total: ${sale.items_total.toFixed(2)}`, { align: 'right' });

      // Footer
      doc.moveDown(2);
      doc.fontSize(10);
      doc.text('Thank you for your business!', { align: 'center' });

      // Finalize PDF
      doc.end();
    } catch (error) {
      console.error('Error in salesMailPdf:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnSales()
   * Process sales return
   */
  async returnSales(req, res) {
    try {
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Refund enforcement (mirrors the void gate). Require a valid manager
      // approval token when this user can't refund on their own; fails open for
      // unconfigured users so existing tills keep working.
      if (!canPos(req.user, 'refund')) {
        const approved = isApprovedFor(
          req.body && req.body.approval_token,
          'refund',
          req.user && req.user._id
        );
        if (!approved) {
          return this.error(res, 'A refund needs manager approval', 403);
        }
      }

      await this.ensureContext(req);

      const data = req.body;
      const SaleModel = this.model || Sale;
      const result = await salesService.returnSalesOrder(data, { SaleModel });

      if (result.status === true) {
        const returnedItems = Array.isArray(result.data?.returned_items)
          ? result.data.returned_items
          : [];
        const refundAmount = auditNumber(result.data?.return_amount);
        const refundReason =
          result.data?.refund_reason ||
          data.reason ||
          data.sales_description ||
          data.payment_description ||
          '';
        const auditSaleId =
          data.sales_id ||
          data.id ||
          data.sale_id ||
          data.sales_document_id ||
          result.data?.sale_id ||
          '';

        await writeSaleAudit(
          req,
          'refund',
          auditSaleId,
          `Refund processed${result.data?.return_id ? ` (${result.data.return_id})` : ''}`,
          {
            return_id: result.data?.return_id || '',
            amount: refundAmount,
            reason: refundReason,
            items: returnedItems,
          }
        );

        return this.success(res, result.data, SUCCESS_MESSAGES.RETURN_SALES_UPDATED_SUCCESSFULLY);
      } else {
        return this.error(res, result.message, result.statusCode || 404);
      }
    } catch (error) {
      console.error('Error in returnSales:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: exportSales()
   * Export sales data
   */
  async exportSales(req, res) {
    try {
      const userAccess = req.user?.access?.sales?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      await this.ensureContext(req);

      // Frontend sends JSON.stringify(selectedTableRow) which is an array: ["id1", "id2", "id3"]
      // Express body-parser with application/json parses this into req.body as an array
      let ids;

      if (req.method === 'POST') {
        // Check if body is array FIRST (most common case from frontend)
        if (Array.isArray(req.body)) {
          ids = req.body;
        } else if (req.body?.data) {
          ids = Array.isArray(req.body.data) ? req.body.data : [req.body.data];
        } else if (typeof req.body === 'string') {
          // In case body-parser didn't parse it
          try {
            ids = JSON.parse(req.body);
          } catch (e) {
            ids = req.body;
          }
        } else if (req.body && typeof req.body === 'object') {
          // Body is an object but not array - might be single ID or wrapped format
          const keys = Object.keys(req.body);
          if (keys.length > 0) {
            // Try to extract IDs from object values
            ids = Object.values(req.body);
          } else {
            ids = [];
          }
        } else {
          ids = [];
        }
      } else if (req.method === 'GET' && req.query) {
        // GET: parse from query params
        if (req.query.data) {
          try {
            ids = typeof req.query.data === 'string' ? JSON.parse(req.query.data) : req.query.data;
          } catch (e) {
            ids = req.query.data;
          }
        } else if (req.query.ids) {
          try {
            ids = typeof req.query.ids === 'string' ? JSON.parse(req.query.ids) : req.query.ids;
          } catch (e) {
            ids = req.query.ids;
          }
        }
      }

      if (!ids || (Array.isArray(ids) && ids.length === 0)) {
        return this.error(res, ERROR_MESSAGES.NO_SALES_IDS_FOR_EXPORT, 400);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.exportSalesOrder(ids, { SaleModel });

      if (result.status === true) {
        // Frontend expects an array of objects and generates CSV client-side.
        return this.success(res, result.data, SUCCESS_MESSAGES.SALES_EXPORTED);
      }

      return this.error(res, ERROR_MESSAGES.SALES_EXPORTED_UNSUCCESSFULLY, 404);
    } catch (error) {
      console.error('Error in exportSales:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getDataChanges()
   * Get data changes for synchronization
   */
  async getDataChanges(req, res) {
    try {
      const from = req.query.from || '';
      const SaleModel = this.model || Sale;
      const result = await salesService.getSalesDataChanges(from, { SaleModel });

      if (result.status === true) {
        return this.success(res, result.data, SUCCESS_MESSAGES.CHANGES_RETRIEVED);
      } else {
        return res.status(200).json({
          type: 'error',
          message: ERROR_MESSAGES.NOT_VALID_INPUT,
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in getDataChanges:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getReturnSalesDetails()
   * Get return sales details
   */
  async getReturnSalesDetails(req, res) {
    try {
      const userAccess = req.user?.access?.sales?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      await this.ensureContext(req);

      const salesId = req.query.id;
      const SaleModel = this.model || Sale;
      const result = await salesService.getReturnSalesDetails(salesId, {
        SaleModel,
      });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in getReturnSalesDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: returnPrintDetails()
   * Get return print details
   */
  async returnPrintDetails(req, res) {
    try {
      await this.ensureContext(req);

      const id = req.query.id;
      const SaleModel = this.model || Sale;
      const result = await salesService.getReturnPrintDetails(id, { SaleModel });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in returnPrintDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getSalesAjaxList()
   * Get sales list for autocomplete
   */
  async getSalesAjaxList(req, res) {
    try {
      const query = req.query.query || '';
      const SaleModel = this.model || Sale;
      const result = await salesService.getSalesAjaxList(query, { SaleModel });

      if (result.status === true) {
        return res.status(200).json({
          query: query,
          suggestions: result.data,
        });
      } else {
        return this.error(res, ERROR_MESSAGES.SALES_NOT_FOUND_ALT, 404);
      }
    } catch (error) {
      console.error('Error in getSalesAjaxList:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getSaleQtyDetail()
   * Get sale quantity detail
   */
  async getSaleQtyDetail(req, res) {
    try {
      const id = req.query.sale_id;
      if (!id) {
        return this.error(res, ERROR_MESSAGES.SALE_ID_REQUIRED_CAP, 400);
      }

      const userAccess = req.user?.access?.sales?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.getSaleQtyDetail(id, { SaleModel });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, result.message, 404);
      }
    } catch (error) {
      console.error('Error in getSaleQtyDetail:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: ServerStatus()
   * Server status check
   */
  async ServerStatus(req, res) {
    return res.status(200).json({
      type: 'success',
      message: SUCCESS_MESSAGES.SERVER_IS_RUNNING,
      data: true,
    });
  }

  /**
   * PHP: customerSaleDetails()
   * Get customer sale details
   */
  async customerSaleDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page, sort: { _id: 1 } };

      // Legacy frontend sends branch as `branch[]=`; newer code may send `branch` or `branch_id`
      const branchParam =
        req.query.branch ||
        req.query['branch[]'] ||
        req.query.branch_id ||
        req.query['branch_id[]'] ||
        null;

      const branchIds = Array.isArray(branchParam) ? branchParam : branchParam ? [branchParam] : [];

      const data = {
        customer_id: req.query.customer_id,
        branchid: branchIds,
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.customerSaleDetailsPage(data, options, { SaleModel });

      if (result.status === true) {
        // PHP line 2767-2768: Apply MongoIDFilter + MongoDateFilter
        if (result.data?.table?.data?.list) {
          result.data.table.data.list = this.mongoDateFilter(result.data.table.data.list);
        }
        return this.success(res, result.data, result.message);
      } else {
        // Preserve model message when available for easier debugging
        const message = result.message || ERROR_MESSAGES.DETAILS_NOT_FOUND;
        return this.error(res, message, 404);
      }
    } catch (error) {
      console.error('Error in customerSaleDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: customerCategorySaleDetails()
   * Get customer category sale details
   */
  async customerCategorySaleDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page, sort: { _id: 1 } };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        category_id: req.query.category_id,
        branchid: Array.isArray(branches) ? branches : [branches],
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.customerCategorySaleDetailsPage(data, options, {
        SaleModel,
      });

      if (result.status === true) {
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in customerCategorySaleDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: itemSaleDetails()
   * Get item sale details
   */
  async itemSaleDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page, sort: { _id: 1 } };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        item_id: req.query.item_id,
        branchid: Array.isArray(branches) ? branches : [branches],
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.itemSaleDetailsPage(data, options, {
        SaleModel,
      });

      if (result.status === true) {
        // Normalize string_date for frontend Item Details Activities table,
        // similar to categorySaleDetails. Use the stored sale date when
        // available instead of any fallback/current time.
        if (result.data?.table?.data?.list) {
          result.data.table.data.list = result.data.table.data.list.map((sale) => {
            const saleDate = sale.date || sale.updated_date || new Date();
            const dateObj = saleDate instanceof Date ? saleDate : new Date(saleDate);

            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const year = dateObj.getFullYear();
            let hours = dateObj.getHours();
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12 || 12;

            return {
              ...sale,
              string_date: `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`,
            };
          });
        }
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in itemSaleDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: categorySaleDetails()
   * Get category sale details
   */
  async categorySaleDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page, sort: { _id: 1 } };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        category_id: req.query.category_id,
        branchid: Array.isArray(branches) ? branches : [branches],
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const result = await salesService.categorySaleDetailsPage(data, options, { SaleModel });

      if (result.status === true) {
        // Format the list dates to use stored date instead of current time
        if (result.data?.table?.data?.list) {
          result.data.table.data.list = result.data.table.data.list.map((sale) => {
            const saleDate = sale.date || sale.updated_date || new Date();
            const dateObj = saleDate instanceof Date ? saleDate : new Date(saleDate);

            // Format as MM/DD/YYYY HH:mm am/pm
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const year = dateObj.getFullYear();
            let hours = dateObj.getHours();
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12 || 12;

            return {
              ...sale,
              string_date: `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`,
            };
          });
        }

        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in categorySaleDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: userSalesDetails()
   * Get user sales details
   */
  async userSalesDetails(req, res) {
    try {
      // PHP lines 2839-2843: Parse limit, page, and data
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = {
        limit,
        page,
        license: req.user.license,
      };

      // Ensure branch is an array - handle both branch[] and branch formats
      let branchArray = [];

      // Check for branch[] format (e.g., branch[]=id1&branch[]=id2)
      if (req.query['branch[]']) {
        branchArray = Array.isArray(req.query['branch[]'])
          ? req.query['branch[]']
          : [req.query['branch[]']];
      }
      // Check for branch format (e.g., branch=id1 or branch=id1,id2)
      else if (req.query.branch) {
        branchArray = Array.isArray(req.query.branch) ? req.query.branch : [req.query.branch];
      }

      const data = {
        user_id: req.query.user_id,
        branchid: branchArray,
      };

      // PHP line 2844-2845: Check permission
      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // PHP line 2846: Call model method
      const SaleModel = this.model || Sale;
      const result = await salesService.userSalesDetailsPage(data, options, { SaleModel });

      // PHP lines 2847-2850: Apply filters and return success
      if (result.status === true) {
        // PHP line 2848: Apply MongoIDFilter
        if (result.data?.table?.data?.list) {
          result.data.table.data.list = this.mongoIDFilter(result.data.table.data.list);
          // PHP line 2849: Apply MongoDateFilter
          result.data.table.data.list = this.mongoDateFilter(result.data.table.data.list);
        }
        return this.success(res, result.data, result.message, 200);
      } else {
        // PHP line 2852: Return error
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404, result.data);
      }
    } catch (error) {
      console.error('Error in userSalesDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: pendingProductDetails()
   * Get pending product details
   */
  async pendingProductDetails(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        sales_id: req.query.sales_id,
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.pendingProductReportPage(data, options, { SaleModel });

      if (response.status === true) {
        const { status: _ignoredStatus, ...payload } = response;
        return this.success(res, payload, SUCCESS_MESSAGES.GET_SUCCESSFULLY, 200);
      } else {
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in pendingProductDetails:', error);
      return this.error(res, error.message, 500);
    }
  }
  async gstOneReportTable(req, res) {
    try {
      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Prefer context prepared by middleware; fall back to legacy inline logic
      let data = req.gstOneReportParams?.data;

      if (!data) {
        // Get branch_id from session (selectedBranchId or branch_id)
        let branchId = req.session?.selectedBranchId || req.session?.branch_id;
        if (!branchId && req.user?.branch_access && req.user.branch_access.length > 0) {
          branchId = req.user.branch_access[0].branch_id;
        }

        // Get branch details for branch_state via service helper
        let branchState = '';
        if (branchId) {
          const branch = await salesService.getBranchById(branchId);
          if (branch) {
            branchState = branch.store_state || branch.state || '';
          }
        }

        data = {
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          branch_id: branchId,
          license: req.user?.license,
          branch_state: branchState,
        };
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.gstOneReportPage(data, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, SUCCESS_MESSAGES.GET_SUCCESSFULLY);
      } else {
        return this.error(res, response.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in gstOneReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: gstThreeReportTable()
   * Get GST-3 report
   */
  async gstThreeReportTable(req, res) {
    try {
      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Prefer context prepared by middleware; fall back to session-based logic
      let data = req.gstThreeReportParams?.data;

      if (!data) {
        data = {
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          branch_id: req.session?.branch_id,
          license: req.user?.license,
          branch_state: req.session?.branch_state,
        };
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.gstThreeReportPage(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, SUCCESS_MESSAGES.GET_SUCCESSFULLY);
      } else {
        return this.error(res, ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in gstThreeReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: gstOneReportTableJson()
   * Get GST-1 report as JSON
   */
  async gstOneReportTableJson(req, res) {
    try {
      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Prefer context prepared by middleware; fall back to legacy inline logic
      let data = req.gstOneReportParams?.data;

      if (!data) {
        // Get branch_id from session (selectedBranchId or branch_id)
        let branchId = req.session?.selectedBranchId || req.session?.branch_id;
        if (!branchId && req.user?.branch_access && req.user.branch_access.length > 0) {
          branchId = req.user.branch_access[0].branch_id;
        }

        data = {
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          branch_id: branchId,
          license: req.user?.license,
        };
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.gstOneReportPageJson(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, SUCCESS_MESSAGES.GET_SUCCESSFULLY);
      } else {
        return this.error(res, response.message || ERROR_MESSAGES.SALES_DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in gstOneReportTableJson:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: dailySalesMail()
   * Send daily sales report email
   */
  async dailySalesMail(req, res) {
    try {
      const input = req.body;

      // Validate email
      if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        return this.error(res, ERROR_MESSAGES.VALID_EMAIL_REQUIRED, 400);
      }

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, 'Unauthorized', 403);
      }

      if (!input.data || typeof input.data !== 'object') {
        return this.error(res, ERROR_MESSAGES.MISSING_REPORT_PAYLOAD_DATA, 400);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.sendDailySalesMail(input, {
        SaleModel,
      });

      if (response.status) {
        return this.success(res, response.data, response.message || 'Mail sent');
      } else {
        return this.error(res, response.message || 'Mail failed', 502);
      }
    } catch (error) {
      console.error('Error in dailySalesMail:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: salesPaymentClose()
   * Close sales payment
   */
  async salesPaymentClose(req, res) {
    try {
      const userAccess = req.user?.access?.customer?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Add context to request body
      const dataWithContext = {
        ...req.body,
        license: req.user?.license,
        branch_id: req.user?.branch_id,
        loggedUserName: req.user?.name,
        loggedUserId: req.user?._id,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.salesPaymentCloseModel(dataWithContext, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in salesPaymentClose:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: qrCodeClose()
   * Close QR code payment
   */
  async qrCodeClose(req, res) {
    try {
      const id = req.query.id;
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Set BaseModel context for branch and license
      const branchId = resolveBranchId(req.user, req.session) || BaseModel.currentBranch;
      const license = req.user?.license || req.user?.licenseId;

      if (branchId) {
        BaseModel.currentBranch =
          branchId instanceof mongoose.Types.ObjectId
            ? branchId
            : new mongoose.Types.ObjectId(branchId);
      }
      if (license) {
        BaseModel.license =
          license instanceof mongoose.Types.ObjectId
            ? license
            : new mongoose.Types.ObjectId(license);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.qrCodeCloseModel(id, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in qrCodeClose:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: qrSalePayementUpdate()
   * Update QR sale payment
   */
  async qrSalePayementUpdate(req, res) {
    try {
      const id = req.query.paymentid;
      const saleid = req.query.salesid;
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.qrSalePayementUpdateModel(id, saleid, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in qrSalePayementUpdate:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: generateQrCode()
   * Generate QR code for payment
   */
  async generateQrCode(req, res) {
    try {
      const amount = req.query.amount;
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      // Set BaseModel context for branch and license
      const branchId = resolveBranchId(req.user, req.session) || BaseModel.currentBranch;
      const license = req.user?.license || req.user?.licenseId;

      console.log('Controller - Resolved branchId:', branchId);
      console.log('Controller - req.user.branch_id:', req.user?.branch_id);
      console.log('Controller - req.session.selectedBranchId:', req.session?.selectedBranchId);

      if (branchId) {
        BaseModel.currentBranch =
          branchId instanceof mongoose.Types.ObjectId
            ? branchId
            : new mongoose.Types.ObjectId(branchId);
      }
      if (license) {
        BaseModel.license =
          license instanceof mongoose.Types.ObjectId
            ? license
            : new mongoose.Types.ObjectId(license);
      }

      console.log('Controller - Set BaseModel.currentBranch to:', BaseModel.currentBranch);

      const SaleModel = this.model || Sale;
      const response = await salesService.generateQrCodeModel(amount, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in generateQrCode:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getQrStatus()
   * Get QR code status
   */
  async getQrStatus(req, res) {
    try {
      const id = req.query.id;
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.getQrStatusModel(id, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in getQrStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kioskOrder()
   * Process kiosk order
   */
  async kioskOrder(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.kioskOrderModel(req.body, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kioskOrder:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: generateRazorPayQrCodekiosk()
   * Generate RazorPay QR for kiosk
   */
  async generateRazorPayQrCodekiosk(req, res) {
    try {
      const data = {
        branchId: req.body.branchId,
        amount: req.body.amount,
        number: req.body.number,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.generateRazorPayQrCodekioskModel(data, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in generateRazorPayQrCodekiosk:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getRazorPayQrStatus()
   * Get RazorPay QR status
   */
  async getRazorPayQrStatus(req, res) {
    try {
      const data = {
        branchId: req.body.branchId,
        qr_code_id: req.body.qr_code_id,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.getRazorPayQrStatusModel(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in getRazorPayQrStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: razorPayQrCodeClose()
   * Close RazorPay QR code
   */
  async razorPayQrCodeClose(req, res) {
    try {
      const data = {
        branchId: req.body.branchId,
        qr_code_id: req.body.qr_code_id,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.razorPayQrCodeCloseModel(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in razorPayQrCodeClose:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: phonepeQr()
   * Generate PhonePe QR
   */
  async phonepeQr(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.phonepeQrModel({ SaleModel });

      if (response.status === 'success') {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in phonepeQr:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: phonepeQrStatus()
   * Get PhonePe QR status
   */
  async phonepeQrStatus(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.phonepeQrStatusModel({ SaleModel });

      if (response.status === 'success') {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 400);
      }
    } catch (error) {
      console.error('Error in phonepeQrStatus:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: createRazorPayMobile()
   * Create RazorPay for mobile
   */
  async createRazorPayMobile(req, res) {
    try {
      const data = {
        branchId: req.body.branchId,
        amount: req.body.amount,
        number: req.body.number,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.createRazorPayMobileModel(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in createRazorPayMobile:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: fetchRazorPayQrStatusMobile()
   * Fetch RazorPay QR status for mobile
   */
  async fetchRazorPayQrStatusMobile(req, res) {
    try {
      const data = {
        branchId: req.body.branchId,
        qr_code_id: req.body.qr_code_id,
      };

      const SaleModel = this.model || Sale;
      const response = await salesService.fetchRazorPayQrStatusMobileModel(data, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in fetchRazorPayQrStatusMobile:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: fetchLastSale()
   * Fetch last sale for kiosk
   */
  async fetchLastSale(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.fetchLastSaleModel(req.body.branchId, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in fetchLastSale:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kitchenPrint()
   * Kitchen print for kiosk
   */
  async kitchenPrint(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.kitchenPrintModel(req.body.branchId, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kitchenPrint:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: multiKitchenPrint()
   * Multi-printer KOT polling — returns pending print_jobs per sale
   */
  async multiKitchenPrint(req, res) {
    try {
      const response = await salesService.multiKitchenPrintModel(req.body.branchId);
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in multiKitchenPrint:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Mark KOT orders as printed and update last_printed_change_index
   */
  async markKitchenPrinted(req, res) {
    try {
      const { saleIds = [], printedIndexes = {} } = req.body;
      const response = await salesService.markKitchenPrintedModel(saleIds, printedIndexes);
      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 400);
      }
    } catch (error) {
      console.error('Error in markKitchenPrinted:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: qrOrder()
   * Process QR order
   */
  async qrOrder(req, res) {
    try {
      const SaleModel = this.model || Sale;
      const response = await salesService.qrOrderModel(req.body, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in qrOrder:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getNewSale()
   * Get new sale
   */
  async getNewSale(req, res) {
    try {
      const userAccess = req.user?.access?.sales?.write;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.getNewSaleModel({ SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, SUCCESS_MESSAGES.RECENT_SALE_RETRIEVED);
      } else {
        return this.error(res, ERROR_MESSAGES.RECENT_SALE_NOT_RETRIEVED, 404);
      }
    } catch (error) {
      console.error('Error in getNewSale:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getOrderHistory()
   * Get order history for table orders
   */
  async getOrderHistory(req, res) {
    try {
      const branchId = req.body.branch_id;
      const userId = req.body.user_id;
      const limit = req.body.limit || 50;
      const page = req.body.page || 1;
      const status = req.body.status;

      if (!branchId) {
        return this.error(res, ERROR_MESSAGES.BRANCH_ID_REQUIRED, 400);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.getOrderHistoryModel(
        branchId,
        limit,
        page,
        status,
        userId,
        { SaleModel }
      );

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in getOrderHistory:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: updateOrder()
   * Update order items
   */
  async updateOrder(req, res) {
    try {
      const orderId = req.body.order_id;
      const items = req.body.items || [];
      const totalAmount = req.body.total_amount || 0;
      const status = req.body.status;

      if (!orderId || items.length === 0) {
        return this.error(res, ERROR_MESSAGES.ORDER_ID_AND_ITEMS_REQUIRED, 400);
      }

      const extraDiscountType = req.body.extra_discount_type;
      const extraDiscount = req.body.extra_discount;
      const discountDescription = req.body.discount_description;
      const newTableNo = req.body.table_number;
      const dineType = req.body.dine_type;
      const personCount = req.body.person_count;

      const SaleModel = this.model || Sale;
      const response = await salesService.updateOrderModel(
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
        { SaleModel }
      );

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in updateOrder:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: searchProducts()
   * Search products for adding to orders
   */
  async searchProducts(req, res) {
    try {
      await this.ensureContext(req);

      const branchId = req.body.branch_id;
      const query = req.body.query || '';
      const rawLimit = req.body.limit;
      const limit =
        Number.isFinite(Number(rawLimit)) && Number(rawLimit) > 0 ? Number(rawLimit) : 10;

      if (!branchId || !query) {
        return this.error(res, ERROR_MESSAGES.BRANCH_ID_AND_SEARCH_QUERY_REQUIRED, 400);
      }

      const user = req.user || {};
      const licenseId = BaseModel.license || user.license || user.license_id || null;

      const response = await this.itemService.getCustomerSearchItems(query, {
        branchId,
        licenseId,
        limit,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      }

      return this.error(res, response.message, 404);
    } catch (error) {
      console.error('Error in searchProducts:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getFrequentItems()
   * Get frequent items for branch
   */
  async getFrequentItems(req, res) {
    try {
      const branchId = req.body.branch_id;
      const limit = req.body.limit || 10;

      if (!branchId) {
        return this.error(res, ERROR_MESSAGES.BRANCH_ID_REQUIRED, 400);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.getFrequentItemsForBranch(branchId, limit, { SaleModel });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      }

      return this.error(res, response.message, 404);
    } catch (error) {
      console.error('Error in getFrequentItems:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kotDiscountReports()
   * Get KOT discount reports
   */
  async kotDiscountReports(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.getKotDiscountReports(data, options, { SaleModel });

      if (response.status === true) {
        return this.success(res, response, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kotDiscountReports:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kotTablewiseDetails()
   * Get KOT table-wise detailed item report
   */
  async kotTablewiseDetails(req, res) {
    try {
      if (req.user?.license) {
        BaseModel.license = req.user.license;
      }

      // Handle both 'branch' and 'branch[]' query params
      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
        tables: req.query.tables || [],
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.kotTablewiseDetailsPage(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, ERROR_MESSAGES.KOT_TABLEWISE_DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in kotTablewiseDetails:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: getListKot()
   * Get list of KOT sales with pagination and filters
   */
  async getListKot(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;

      let filters = {};
      if (req.query.filters) {
        try {
          filters =
            typeof req.query.filters === 'string'
              ? JSON.parse(req.query.filters)
              : req.query.filters;
        } catch (e) {
          return this.error(res, ERROR_MESSAGES.INCORRECT_FILTER_FORMAT, 400);
        }
      }

      const branchId = req.query.branchId || null;
      const options = { limit, page, sort: { _id: -1 } };

      const SaleModel = this.model || Sale;
      const result = await salesService.salePage(filters, options, branchId, {
        SaleModel,
      });

      if (result.status === true) {
        result.data.list = this.mongoIDFilter(result.data.list);
        result.data.list = this.mongoDateFilter(result.data.list);
        return this.success(res, result.data, result.message);
      } else {
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in getListKot:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: pendingCustomerCategoryReportTable()
   * Get pending customer category report
   */
  async pendingCustomerCategoryReportTable(req, res) {
    try {
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 5;
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const options = { limit, page };

      const branches = req.query['branch[]'] || req.query.branch || [];
      const data = {
        branchid: Array.isArray(branches) ? branches : [branches],
        starting_date: req.query.starting_date,
        ending_date: req.query.ending_date,
        category_id: req.query.field_input || '',
      };

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.pendingCustomerCategoryReportPage(data, options, {
        SaleModel,
      });

      if (response.status === true) {
        const list = this.mongoIDFilter(response.list || []);
        return this.success(
          res,
          {
            total: response.total || 0,
            current_page: response.current_page || page,
            total_pages:
              response.total_pages ||
              Math.max(Math.ceil((response.total || 0) / (response.per_page || limit)), 1),
            per_page: response.per_page || limit,
            list,
          },
          list.length ? SUCCESS_MESSAGES.GET_SUCCESSFULLY : SUCCESS_MESSAGES.NO_RECORDS_FOUND
        );
      } else {
        return this.error(res, ERROR_MESSAGES.DETAILS_NOT_FOUND, 404);
      }
    } catch (error) {
      console.error('Error in pendingCustomerCategoryReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kioskReports()
   * Get kiosk reports
   */
  async kioskReports(req, res) {
    try {
      this.setRequestContext(req);
      let options;
      let data;

      if (req.kioskReportParams && req.kioskReportParams.options && req.kioskReportParams.data) {
        ({ options, data } = req.kioskReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          kiosk_method: req.query.kiosk_method || '',
        };
      }

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.kioskReportPage(data, options, {
        SaleModel,
      });

      if (response.status === true) {
        if (response.data && Array.isArray(response.data.list)) {
          response.data.list = response.data.list.map((item) => ({
            string_date: item.updated_date || item.date || '',
            kiosks_id: item.sales_id || '',
            ...item,
          }));
        }
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kioskReports:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kiosksSummaryReports()
   * Get kiosk summary reports
   */
  async kiosksSummaryReports(req, res) {
    try {
      this.setRequestContext(req);
      let data;

      if (req.kioskBranchReportParams && req.kioskBranchReportParams.data) {
        ({ data } = req.kioskBranchReportParams);
      } else {
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          kiosk_method: req.query.kiosk_method || '',
        };
      }

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.kiosksSummaryReportsPage(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kiosksSummaryReports:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: kiosksGraphicalReports()
   * Get kiosk graphical reports
   */
  async kiosksGraphicalReports(req, res) {
    try {
      this.setRequestContext(req);
      let data;

      if (req.kioskBranchReportParams && req.kioskBranchReportParams.data) {
        ({ data } = req.kioskBranchReportParams);
      } else {
        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
          kiosk_method: req.query.kiosk_method || '',
        };
      }

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.kiosksGraphicalReportsPage(data, {
        SaleModel,
      });

      if (response.status === true) {
        return this.success(res, response.data, response.message);
      } else {
        return this.error(res, response.message, 404);
      }
    } catch (error) {
      console.error('Error in kiosksGraphicalReports:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * PHP: itemExpiryReportTable()
   * Get item expiry report
   */
  async itemExpiryReportTable(req, res) {
    try {
      // Build data/options from pre-normalised middleware output when present,
      // otherwise fall back to the legacy inline construction to avoid any
      // behaviour changes for direct/internal callers.
      let data;
      let options;

      if (
        req.itemExpiryReportParams &&
        req.itemExpiryReportParams.data &&
        req.itemExpiryReportParams.options
      ) {
        ({ data, options } = req.itemExpiryReportParams);
      } else {
        const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 5;
        const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
        options = { limit, page };

        const branches = req.query['branch[]'] || req.query.branch || [];
        data = {
          branchid: Array.isArray(branches) ? branches : [branches],
          starting_date: req.query.starting_date,
          ending_date: req.query.ending_date,
        };
      }

      // Apply session filtering if user has permission and dates are provided
      if (data.starting_date || data.ending_date) {
        console.log('🔍 Item Expiry Report Table - Before filter:', {
          starting_date: data.starting_date,
          ending_date: data.ending_date,
        });

        // Debug user permissions
        console.log('🔍 DEBUG - User session filter permission:', {
          user_id: req.user?._id,
          session_filter_permission: req.user?.access?.sales?.session_filter,
          user_access: req.user?.access,
        });

        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        console.log('🔍 DEBUG - Parsed dates:', { startDate, endDate });

        const originalDateRange = {
          start_date: startDate || new Date(0),
          end_date: endDate || new Date(),
        };

        console.log('🔍 DEBUG - Original date range:', originalDateRange);
        console.log('🔍 Item Expiry Report Table - About to apply session filter...');

        try {
          const filteredDateRange = await sessionFilterUtil.applySessionFilter(
            req,
            originalDateRange
          );

          console.log('🔍 DEBUG - Filtered date range result:', filteredDateRange);
          console.log('🔍 Item Expiry Report Table - Date range:', {
            original: originalDateRange,
            filtered: filteredDateRange,
            session_applied: filteredDateRange?.session_applied || false,
          });

          // Debug date comparison
          console.log('🔍 DEBUG - Date comparison:', {
            original_start: originalDateRange.start_date,
            original_end: originalDateRange.end_date,
            filtered_start: filteredDateRange.start_date,
            filtered_end: filteredDateRange.end_date,
            start_changed: originalDateRange.start_date !== filteredDateRange.start_date,
            end_changed: originalDateRange.end_date !== filteredDateRange.end_date,
          });

          // Update data with filtered dates
          data.starting_date = filteredDateRange.start_date;
          data.ending_date = filteredDateRange.end_date;

          console.log('🔍 DEBUG - Final data dates:', {
            starting_date: data.starting_date,
            ending_date: data.ending_date,
          });
        } catch (error) {
          console.log('🔍 DEBUG - Session filter error:', error);
          throw error;
        }
      } else {
        console.log('🔍 DEBUG - No dates provided, skipping session filter');
      }

      const userAccess = req.user?.access?.report?.read;
      if (userAccess !== true) {
        return this.error(res, ERROR_MESSAGES.UNAUTHORIZED, 403);
      }

      const SaleModel = this.model || Sale;
      const response = await salesService.itemExpiryReportPage(data, options, { SaleModel });

      if (response.status === true) {
        return res.status(200).json({
          type: 'success',
          message: SUCCESS_MESSAGES.GET_SUCCESSFULLY,
          data: {
            total: response.total,
            current_page: response.current_page,
            total_pages: response.total_pages,
            per_page: response.per_page,
            list: response.list,
          },
        });
      }
    } catch (error) {
      console.error('Error in itemExpiryReportTable:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Cancel a KOT sale
   * Frontend: PosnicPro.get('sales/cancel/' + saleId)
   * Sets the sale status to 'Cancelled' and reverses stock/wallet changes
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async cancel(req, res) {
    try {
      const saleId = req.params.id;

      if (!this.checkPermission('sales', 'delete', req.user)) {
        return this.error(res, 'You do not have permission to cancel sales', 403);
      }

      await this.ensureContext(req);

      const SaleModel = this.model || Sale;
      const sale = await salesService.getSaleById(saleId, { SaleModel });

      if (!sale) {
        return this.error(res, 'Sale not found', 404);
      }

      if (sale.status === SALE_STATUS.CANCELLED) {
        return this.error(res, 'Sale is already cancelled', 400);
      }

      // Use the delete service which handles stock reversal and wallet updates
      const result = await salesService.deleteSales([saleId], { SaleModel });

      if (result && result.status === true) {
        await writeSaleAudit(req, 'cancel', sale.sales_id || saleId, 'Sale cancelled', {
          sales_id: sale.sales_id || '',
          total: sale.sales_total || sale.total || 0,
          sale_process: sale.sale_process || '',
        });
        // Undo any loyalty this sale earned or redeemed, and free any coupon it
        // used, back up (neither ever blocks the cancel).
        try {
          await loyaltyService.reverse(sale._id || saleId, this.buildLoyaltyCtx(req));
        } catch (e) {
          console.error('[loyalty] reverse skipped:', e && e.message);
        }
        try {
          await couponService.reverse(sale._id || saleId);
        } catch (e) {
          console.error('[coupon] reverse skipped:', e && e.message);
        }
        try {
          await cashbackService.reverseForSale(sale._id || saleId);
        } catch (e) {
          console.error('[cashback] reverse skipped:', e && e.message);
        }
        return this.success(res, result.data, 'Sale cancelled successfully');
      } else {
        return this.error(res, result?.message || 'Failed to cancel sale', 500);
      }
    } catch (error) {
      console.error('Error in cancel:', error);
      return this.error(res, error.message, 500);
    }
  }

  /**
   * Get tables with active KOT orders
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getTablesWithActiveOrders(req, res) {
    try {
      // Skip permission check for unauthenticated kiosk/mobile requests
      if (req.user && !this.checkPermission('sales', 'read', req.user)) {
        return res.status(403).json({
          status: false,
          message: 'You do not have permission to view active orders',
          data: [],
        });
      }

      if (req.user) await this.ensureContext(req);

      // Resolve branch from request or context; fall back to body for kiosk
      const branchContext = req.user ? this.resolveBranchContext(req) : null;
      const branchId = branchContext?.branch_id || req.body?.branch_id || req.query?.branch_id;

      if (!branchId) {
        return res.status(400).json({
          status: false,
          message: 'Branch context required',
          data: [],
        });
      }

      // getTablesWithActiveOrders is in sales.service.js which is required as salesService
      const result = await salesService.getTablesWithActiveOrders(branchId);

      if (result.status) {
        return res.status(200).json({
          type: 'success',
          status: true,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(404).json({
          type: 'error',
          status: false,
          message: result.message,
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error in getTablesWithActiveOrders:', error);
      return res.status(500).json({
        type: 'error',
        status: false,
        message: 'An error occurred while fetching active orders',
        data: [],
      });
    }
  }
}

module.exports = new SalesController();
