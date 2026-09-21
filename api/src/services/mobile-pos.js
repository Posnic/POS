'use strict';

// Mobile writes have a durable intent before any effects. Each effect has its
// own stable identity, so a lost response or process restart can resume safely
// on standalone MongoDB as well as a replica set.
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { computeLineTax } = require('./tax-engine');
const id = (v) => String(v || '');
const oid = (v) => new ObjectId(id(v));
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const { allowed, fail } = require('../utils/branch-access');
const minor = (n) => Math.round(Number(n || 0) * 100);
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
function settings(branch) {
  const s = branch.mobile_pos || {};
  return {
    enabled:
      branch.module_mobile_pos_enable === undefined
        ? s.enabled === true
        : branch.module_mobile_pos_enable === true,
    offlineHours: s.offlineHours || 24,
    quickSale: s.quickSale !== false,
    quickTaxBps: s.quickTaxBps || 0,
    quickTaxInclusive: s.quickTaxInclusive !== false,
    tillId: s.tillId || '',
    upiAccounts: (branch.payment_settings || s).upiAccounts || [],
    defaultUpiAccountId: (branch.payment_settings || s).defaultUpiAccountId || '',
  };
}
function currency(branch) {
  const value = branch.currency_value;
  const code =
    (Array.isArray(value) ? value[0]?.currency_text : '') ||
    String(branch.currency_text || '').match(/\b[A-Z]{3}\b/)?.[0] ||
    'INR';
  if (
    new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits !== 2
  )
    fail('This currency is not supported by Mobile POS yet.');
  return code;
}
async function context(req, requireEnabled = true) {
  const t = req.tenantContext;
  if (!t?.branchId || !t?.licenseId) fail('Choose a branch before connecting Mobile POS.', 403);
  const branch = await req.db
    .collection('branches')
    .findOne({ _id: oid(t.branchId), license: oid(t.licenseId) });
  if (!branch) fail('Branch not found.', 403);
  const config = settings(branch);
  if (requireEnabled && !config.enabled)
    fail('Enable Mobile POS in Settings → Features on the desktop.', 403);
  return {
    branch,
    config,
    license: oid(t.licenseId),
    branchId: oid(t.branchId),
    userId: oid(req.user._id),
    shopId: hash(id(t.licenseId)).slice(0, 24),
  };
}
function mapItem(row) {
  const taxBps = Math.round(Number(row.tax || 0) * 100);
  const price = minor(row.selling_price);
  const code = String(row.plu_code || '');
  return {
    id: id(row._id),
    name: String(row.name || row.item_name || 'Item'),
    price: Number.isSafeInteger(price) && price >= 0 && price <= 99999999999 ? price : 0,
    code: /^\d{1,6}$/.test(code) ? code : '',
    barcode: String(row.barcode_id || ''),
    category: String(row.category_name || 'Items'),
    visual: typeof row.icon === 'string' && row.icon ? row.icon : '■',
    taxBps: Number.isInteger(taxBps) ? Math.min(10000, Math.max(0, taxBps)) : 0,
    taxInclusive: row.tax_type === 'inclusive',
    active:
      row.activate !== false &&
      row.active !== false &&
      row.status !== 'inactive' &&
      !row.channel_off?.includes('pos'),
    requiresConfiguration:
      !Number.isSafeInteger(price) ||
      price > 99999999999 ||
      !Number.isInteger(taxBps) ||
      price < 0 ||
      taxBps < 0 ||
      taxBps > 10000 ||
      Number(row.discount_amount || 0) > 0 ||
      Number(row.discount_percentage || 0) > 0 ||
      Boolean(
        row.modifiers?.length ||
        row.variants?.length ||
        row.modifier_groups?.length ||
        row.modifier_group_ids?.length ||
        row.item_weight_machine_based
      ),
  };
}
async function bootstrap(req) {
  const c = await context(req);
  if (!allowed(req.user, 'sales')) fail('This account cannot sell.', 403);
  if (!req.handsetDevice)
    fail('Update the mobile app and sign in again to register this device.', 403);
  await req.db.collection('handsets').updateOne(
    { device_id: req.handsetDevice },
    {
      $set: {
        app: 'mobile-pos',
        branch_id: id(c.branchId),
        branch_name: c.branch.branch_name,
        last_seen: new Date(),
      },
    }
  );
  const rows = await req.db
    .collection('items')
    .find({ branch_id: c.branchId, license: c.license, is_deleted: { $ne: true } })
    .toArray();
  const items = rows.map(mapItem);
  const version = hash(
    canonical({
      items,
      config: c.config,
      currency: currency(c.branch),
      access: req.user.access || {},
      role: req.user.usertype || req.user.role || '',
    })
  );
  const now = new Date();
  const until = new Date(+now + c.config.offlineHours * 3600000);
  const key = hash(
    [id(c.license), id(c.branchId), id(c.userId), req.handsetDevice, version].join(':')
  );
  const shop = {
    id: c.shopId,
    branchId: id(c.branchId),
    name: c.branch.company_name || c.branch.branch_name || 'Posnic',
    branchName: c.branch.branch_name || '',
    currency: currency(c.branch),
    staffId: id(c.userId),
    staffName: req.user.username || req.user.name || '',
    snapshotVersion: key,
    offlineUntil: until.toISOString(),
    quickTaxBps: c.config.quickTaxBps,
    quickTaxInclusive: c.config.quickTaxInclusive,
    permissions: {
      sell: true,
      quickSale:
        c.config.quickSale &&
        require('../utils/pos-permission.util').canPos(req.user, 'quick_sale'),
      customerWrite: allowed(req.user, 'customer'),
      itemWrite: false,
      priceOverride: false,
      manualUpi: c.config.upiAccounts.length > 0,
    },
    upiAccounts: c.config.upiAccounts,
    defaultUpiAccountId: c.config.defaultUpiAccountId || undefined,
    capabilities: { saleSync: true, devicePairing: true, tillPrint: true, terminal: false },
  };
  await req.db.collection('mobile_grants').updateOne(
    { _id: key },
    {
      $set: { until, shop },
      $setOnInsert: {
        license: c.license,
        branchId: c.branchId,
        userId: c.userId,
        device: req.handsetDevice,
        items,
        facts: Object.fromEntries(
          rows.map((r) => [
            id(r._id),
            {
              hsncode: r.hsncode || '',
              company_price: Number(r.company_price || 0),
              barcode_id: r.barcode_id || '',
              category_name: r.category_name || '',
              supplier_name: r.supplier_name || '',
            },
          ])
        ),
        issued: now,
      },
    },
    { upsert: true }
  );
  return { shop, items };
}
function validateSale(sale, grant, c, grants = new Map()) {
  if (
    !sale ||
    sale.training !== false ||
    sale.shopId !== c.shopId ||
    sale.branchId !== id(c.branchId) ||
    sale.staffId !== id(c.userId)
  )
    fail('Sale belongs to another shop, branch or staff member.', 403);
  const at = Date.parse(sale.createdAt);
  if (
    !Number.isFinite(at) ||
    at < +grant.issued - 60000 ||
    at > +grant.until ||
    at > Date.now() + 300000
  )
    fail('Sale is outside its offline permission period.', 409);
  if (sale.currency !== grant.shop.currency) fail('Currency does not match the branch.');
  if (!Array.isArray(sale.cart?.lines) || !sale.cart.lines.length || sale.cart.lines.length > 500)
    fail('A sale needs 1–500 lines.');
  let total = 0,
    tax = 0;
  const lines = sale.cart.lines.map((line) => {
    if (
      !Number.isSafeInteger(line.price) ||
      line.price < 0 ||
      line.price > 99999999999 ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 100000
    )
      fail('Invalid price or quantity.');
    if (typeof line.name !== 'string' || !line.name.trim() || line.name.length > 200)
      fail('Invalid item name.');
    const lineGrant = line.snapshotVersion
      ? grants.get(line.snapshotVersion) || (line.snapshotVersion === grant._id ? grant : null)
      : grant;
    if (!lineGrant || at > +lineGrant.until || at < +lineGrant.issued - 60000)
      fail('This cart line has expired. Review its catalogue price.', 409);
    const item = line.itemId ? lineGrant.items.find((i) => i.id === line.itemId) : null;
    if (
      line.itemId &&
      (!item ||
        !item.active ||
        item.requiresConfiguration ||
        item.price !== line.price ||
        item.taxBps !== line.taxBps ||
        item.taxInclusive !== line.taxInclusive)
    )
      fail('Item does not match the downloaded catalogue.', 409);
    if (
      !line.itemId &&
      (!grant.shop.permissions.quickSale ||
        !lineGrant.shop.permissions.quickSale ||
        line.taxBps !== lineGrant.shop.quickTaxBps ||
        line.taxInclusive !== lineGrant.shop.quickTaxInclusive)
    )
      fail('Quick sale is not permitted.', 403);
    const result = computeLineTax({
      itemAmount: (line.price * line.quantity) / 100,
      sellingPrice: line.price / 100,
      itemQuantity: line.quantity,
      itemTax: line.taxBps / 100,
      taxType: line.taxInclusive ? 'inclusive' : 'exclusive',
      discountAmount: 0,
      discountPercentage: 0,
    });
    const part = minor(result.tax),
      amount = line.price * line.quantity + (line.taxInclusive ? 0 : part);
    if (!Number.isSafeInteger(amount)) fail('Sale amount is too large.');
    total += amount;
    tax += part;
    return {
      ...line,
      name: item?.name || line.name.trim(),
      amount,
      taxAmount: part,
      facts: lineGrant.facts?.[line.itemId] || {},
    };
  });
  if (total <= 0 || total > 99999999999 || total !== sale.total || tax !== sale.tax)
    fail('Sale totals do not match.', 409);
  const p = sale.payment;
  if (p?.method === 'cash') {
    if (!Number.isSafeInteger(p.received) || p.received < total || p.change !== p.received - total)
      fail('Cash payment does not match.');
  } else if (p?.method === 'upi') {
    const account = grant.shop.upiAccounts.find(
      (a) =>
        a.id === p.account?.id &&
        a.vpa === p.account?.vpa &&
        a.active &&
        a.verification === 'manual'
    );
    if (!account || p.status !== 'staff-confirmed') fail('UPI account or confirmation is invalid.');
  } else fail('Unsupported payment method.');
  if (sale.cart.customer && !grant.shop.permissions.customerWrite)
    fail('Customer creation is not permitted.', 403);
  const customer = sale.cart.customer;
  if (
    customer &&
    (typeof customer.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(customer.id) ||
      typeof customer.name !== 'string' ||
      typeof customer.phone !== 'string' ||
      customer.name.length > 200 ||
      customer.phone.length > 40)
  )
    fail('Invalid customer.');
  return lines;
}
async function ingest(req, dependencies = {}) {
  const c = await context(req);
  if (!allowed(req.user, 'sales') || !req.handsetDevice) fail('This device cannot sell.', 403);
  const sale = req.body?.sale,
    localId = req.body?.idempotencyKey;
  if (typeof localId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(localId) || sale?.id !== localId)
    fail('Invalid sale identity.');
  const key = hash([id(c.license), id(c.branchId), req.handsetDevice, localId].join(':'));
  const immutable = { ...sale };
  delete immutable.sync;
  delete immutable.serverId;
  const digest = hash(canonical(immutable));
  const journal = req.db.collection('mobile_sales');
  let intent = await journal.findOne({ _id: key });
  if (intent && id(intent.userId) !== id(c.userId))
    fail('Sale belongs to another staff member.', 403);
  if (intent && intent.digest !== digest)
    fail('This sale identity was already used for different data.', 409);
  if (intent?.state === 'complete') return intent.ack;
  if (!intent) {
    if (typeof sale.snapshotVersion !== 'string' || !/^[a-f0-9]{64}$/.test(sale.snapshotVersion))
      fail('Refresh the catalogue before selling.', 409);
    const grant = await req.db.collection('mobile_grants').findOne({
      _id: sale.snapshotVersion,
      license: c.license,
      branchId: c.branchId,
      userId: c.userId,
      device: req.handsetDevice,
    });
    if (!grant)
      fail('The sale has no valid catalogue permission. Sign in and refresh the catalogue.', 409);
    const versions = Array.isArray(sale.cart?.lines)
      ? [
          ...new Set(
            sale.cart.lines
              .map((l) => l.snapshotVersion)
              .filter((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
          ),
        ].slice(0, 500)
      : [];
    const previous = await req.db
      .collection('mobile_grants')
      .find({
        _id: { $in: versions },
        license: c.license,
        branchId: c.branchId,
        userId: c.userId,
        device: req.handsetDevice,
      })
      .toArray();
    const lines = validateSale(sale, grant, c, new Map(previous.map((g) => [g._id, g])));
    const serverId = new ObjectId();
    const ack = {
      saleId: localId,
      serverId: id(serverId),
      shopId: c.shopId,
      branchId: id(c.branchId),
    };
    intent = {
      _id: key,
      digest,
      sale: immutable,
      lines,
      serverId,
      ack,
      state: 'pending',
      created: new Date(),
      userName: req.user.username || req.user.name || '',
      license: c.license,
      branchId: c.branchId,
      userId: c.userId,
    };
    try {
      await journal.insertOne(intent);
    } catch (e) {
      if (e.code !== 11000) throw e;
      intent = await journal.findOne({ _id: key });
      if (intent.digest !== digest) fail('Sale identity conflict.', 409);
    }
  }
  await finish(req.db, intent, c, dependencies);
  return intent.ack;
}
async function finish(db, intent, c, deps = {}) {
  const Sale = deps.Sale || require('../models/sale.model');
  const repository = deps.repository || require('../repositories/sale.repository');
  const sale = intent.sale;
  // Stable customer ids prevent a replay creating another customer. A phone
  // number is not silently treated as identity (family members can share one).
  let customerId;
  const customer = sale.cart.customer;
  if (customer) {
    if (
      typeof customer.id !== 'string' ||
      typeof customer.name !== 'string' ||
      typeof customer.phone !== 'string' ||
      customer.name.length > 200 ||
      customer.phone.length > 40
    )
      fail('Invalid customer.');
    customerId = new ObjectId(hash(id(c.license) + ':' + customer.id).slice(0, 24));
    await db.collection('customers').updateOne(
      { _id: customerId, license: c.license },
      {
        $setOnInsert: {
          name: customer.name,
          phone: customer.phone,
          branch_id: c.branchId,
          license: c.license,
          created_date: new Date(),
          balance: 0,
        },
      },
      { upsert: true }
    );
  }
  let document = await Sale.findById(intent.serverId).lean();
  if (!document) {
    const items = intent.lines.map((line) => ({
      item: line.itemId
        ? oid(line.itemId)
        : new ObjectId(hash(intent._id + ':' + line.id).slice(0, 24)),
      name: line.name,
      quantity: line.quantity,
      unit_price: line.price / 100,
      total: line.amount / 100,
      item_id: line.itemId || '',
      item_name: line.name,
      item_status: line.itemId ? '' : 'instant',
      item_quantity: line.quantity,
      item_price: line.price / 100,
      sale_inline_item_price: line.price / 100,
      total_amount: line.amount / 100,
      item_unit: 'qty',
      tax: line.taxBps / 100,
      tax_type: line.taxInclusive ? 'inclusive' : 'exclusive',
      tax_amount: line.taxAmount / 100,
      hsncode: line.facts.hsncode || '',
      barcode_id: line.facts.barcode_id || '',
      category_name: line.facts.category_name || '',
      supplier_name: line.facts.supplier_name || '',
      company_price_total: (line.facts.company_price || 0) * line.quantity,
      tax_components: require('./tax-profiles').buildTaxComponents(
        require('./tax-profiles').profileForBranch(c.branch).profile,
        line.taxAmount / 100,
        false
      ),
      cgst_tax: c.branch.indian_gst === 'gst_on' ? line.taxAmount / 200 : 0,
      sgst_tax: c.branch.indian_gst === 'gst_on' ? line.taxAmount / 200 : 0,
    }));
    const amount = sale.total / 100,
      tax = sale.tax / 100,
      at = new Date(sale.createdAt);
    const number = await repository.generateSalesIdForBranch(c.branchId);
    const doc = new Sale({
      _id: intent.serverId,
      license: c.license,
      branch_id: c.branchId,
      branch_name: c.branch.branch_name,
      sales_id: number,
      billing_transaction_id: 'mobile:' + intent._id,
      sale_method: 'Live-Order',
      sale_process: 'Add',
      channel: 'pos',
      items,
      number_of_items: items.length,
      date: at,
      created_date: at,
      updated_date: new Date(),
      created_by: intent.userName || sale.staffId,
      created_by_id: c.userId,
      updated_by: intent.userName || sale.staffId,
      updated_by_id: c.userId,
      user_id: sale.staffId,
      user_name: intent.userName || sale.staffId,
      customer_id: customerId,
      customer_name: customer?.name || 'Walk-in',
      customer_phone: customer?.phone || '',
      sales_total: amount,
      items_total: amount,
      sales_sub_total: amount - tax,
      items_subtotal: amount - tax,
      tax,
      payment_status: 'Paid',
      payment_mode: sale.payment.method === 'cash' ? 'Cash' : 'Upi',
      partial_balance: amount,
      payment_pending: 0,
      paid_amount: amount,
      balance: 0,
      discount: 0,
      round_off: 0,
      sales_round_off: 0,
      gst: c.branch.indian_gst === 'gst_on' ? 'enable' : 'disable',
      total_companyprice: intent.lines.reduce(
        (sum, line) => sum + (line.facts.company_price || 0) * line.quantity,
        0
      ),
      payment_description:
        sale.payment.method === 'upi'
          ? 'Staff-confirmed UPI: ' +
            sale.payment.account.vpa +
            ' ' +
            String(sale.payment.reference || '').slice(0, 100)
          : '',
      sales_description: 'Mobile POS ' + sale.receipt,
      printing_address: c.branch.printing_address || '',
    });
    try {
      await doc.save();
    } catch (e) {
      if (e.code !== 11000 || !(await Sale.findById(intent.serverId).lean())) throw e;
    }
    document = await Sale.findById(intent.serverId).lean();
  }
  // Money has already been collected offline. Stock may go negative; record the
  // fact instead of rejecting a paid sale or asking for money again. The marker
  // and decrement are ONE Mongo update, surviving crashes between effects.
  const quantities = new Map();
  for (const line of intent.lines)
    if (line.itemId)
      quantities.set(line.itemId, (quantities.get(line.itemId) || 0) + line.quantity);
  for (const [itemId, quantity] of quantities) {
    const marker = 'mobile_effects.' + intent._id;
    const filter = {
      _id: oid(itemId),
      license: c.license,
      branch_id: c.branchId,
      track_inventory: { $in: [true, 'true'] },
      [marker]: { $exists: false },
    };
    const opening = {
      $convert: { input: '$available_quantity', to: 'double', onError: 0, onNull: 0 },
    };
    await db.collection('items').updateOne(filter, [
      {
        $set: {
          [marker]: { opening, closing: { $subtract: [opening, quantity] } },
          available_quantity: { $subtract: [opening, quantity] },
          updated_date: '$$NOW',
        },
      },
    ]);
    const item = await db
      .collection('items')
      .findOne({ _id: oid(itemId), license: c.license, branch_id: c.branchId });
    const effect = item?.mobile_effects?.[intent._id];
    if (!item || effect?.closing < 0)
      await db.collection('mobile_sales').updateOne(
        { _id: intent._id },
        {
          $addToSet: {
            issues: !item ? 'Sold item was removed: ' + itemId : 'Stock below zero: ' + item.name,
          },
        }
      );
    if (effect && c.branch.stock_management !== false) {
      const StockLogs = require('../repositories/stock-log.repository');
      const logged = await new StockLogs().createStockLog({
        operationId: hash(intent._id + ':' + itemId).slice(0, 24),
        branch_id: c.branchId,
        view_item_id: item._id,
        item_name: item.name,
        item_barcode_id: item.barcode_id || '',
        item_quantity: quantity,
        process: 'Add Sale',
        reference: document.sales_id,
        date: new Date(sale.createdAt),
        action: 'subtract',
        count: '-' + quantity,
        changed_by: sale.staffId,
        changed_by_userid: c.userId,
        opening_balance: effect.opening,
        closing_balance: effect.closing,
        stocklog: true,
      });
      if (!logged.status) throw new Error('Stock log could not be saved.');
    }
  }
  if (deps.afterEffects) await deps.afterEffects();
  await db
    .collection('mobile_sales')
    .updateOne({ _id: intent._id }, { $set: { state: 'complete', completed: new Date() } });
  try {
    require('../sync/outbox').enqueue({
      collection: 'sales',
      documentId: intent.serverId,
      reason: 'sale',
    });
    require('../sync/nudge').nudgeSyncAgent();
  } catch {
    /* periodic scanner remains available */
  }
}
module.exports = {
  bootstrap,
  ingest,
  finish,
  context,
  settings,
  currency,
  mapItem,
  validateSale,
  allowed,
  hash,
  fail,
  canonical,
};
