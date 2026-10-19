'use strict';
const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const Money = require('../utils/currency');
const { describeSale } = require('../utils/sales-channels');
const fail = (code, status = 422) => {
  throw Object.assign(Error(code), { code, status });
};
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const objectId = (value) => {
  if (!/^[a-f0-9]{24}$/.test(String(value || ''))) fail('external_sale_scope_invalid', 403);
  return new ObjectId(String(value));
};
const minor = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) fail('external_sale_amount_invalid');
  return value;
};
function writerAllowed(req, approval) {
  return (
    req.isApiKey === true &&
    req.method === 'POST' &&
    req.path === '/external-sales' &&
    approval?.externalSales?.enabled === true &&
    /^[a-f0-9]{24}$/.test(String(approval.externalSales.writerId || '')) &&
    String(approval.externalSales.writerId) !== String(approval.connectorReaderId || '') &&
    String(approval.externalSales.writerId) === String(req.user?._id || req.user?.id || '') &&
    req.user?.apiEndpointScope?.kind === 'extension-sales-writer' &&
    req.user.apiEndpointScope.extensionId === approval.extensionId &&
    req.user?.activate === true &&
    req.user?.active !== false &&
    ![1, '1', true].includes(req.user?.del_status) &&
    String(req.user?.status).toLowerCase() !== 'inactive' &&
    req.user?.access?.extensions?.read === true &&
    req.user?.access?.sales?.write === true
  );
}
function validate(input) {
  const keys = [
    'eventId',
    'sourceReference',
    'provider',
    'currency',
    'recognizedAt',
    'lines',
    'totalMinor',
  ];
  if (
    !input ||
    Object.keys(input).some((k) => !keys.includes(k)) ||
    !/^[a-f0-9]{64}$/.test(input.eventId || '') ||
    typeof input.sourceReference !== 'string' ||
    !input.sourceReference.trim() ||
    input.sourceReference.length > 200 ||
    typeof input.provider !== 'string' ||
    !input.provider.trim() ||
    input.provider.length > 80 ||
    !/^[A-Z]{3}$/.test(input.currency || '') ||
    typeof input.recognizedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.recognizedAt) ||
    !Number.isFinite(Date.parse(input.recognizedAt)) ||
    new Date(input.recognizedAt).toISOString() !== input.recognizedAt ||
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 200
  )
    fail('external_sale_payload_invalid');
  minor(input.totalMinor);
  let total = 0;
  const lines = input.lines.map((line) => {
    if (
      !line ||
      Object.keys(line).some(
        (k) =>
          ![
            'productId',
            'quantity',
            'unitPriceMinor',
            'discountMinor',
            'taxMinor',
            'totalMinor',
          ].includes(k)
      ) ||
      !/^[a-f0-9]{24}$/.test(line.productId || '') ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 100000
    )
      fail('external_sale_line_invalid');
    const gross = line.quantity * minor(line.unitPriceMinor);
    const discount = minor(line.discountMinor),
      tax = minor(line.taxMinor);
    if (
      !Number.isSafeInteger(gross) ||
      gross - discount !== minor(line.totalMinor) ||
      tax > line.totalMinor
    )
      fail('external_sale_amount_invalid');
    // Initial host contract supports tax-free externally priced sales only.
    // Never silently infer the marketplace's tax treatment from local prices.
    if (tax !== 0) fail('external_sale_tax_not_supported');
    total += line.totalMinor;
    if (!Number.isSafeInteger(total)) fail('external_sale_amount_invalid');
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountMinor: discount,
      taxMinor: tax,
      totalMinor: line.totalMinor,
    };
  });
  if (total !== input.totalMinor) fail('external_sale_total_mismatch');
  return {
    eventId: input.eventId,
    sourceReference: input.sourceReference,
    provider: input.provider,
    currency: input.currency,
    recognizedAt: input.recognizedAt,
    lines,
    totalMinor: total,
  };
}

/** The sales document itself is the atomic idempotency receipt. Retrying after
 * lost HTTP responses cannot debit stock, touch a register or create a payment.
 * Existing sales synchronization carries this document; no executable journal
 * is replicated to tills. The caller must verify installation and writer grant.
 */
async function postExternalSale({
  db,
  scope,
  descriptor,
  actor,
  approval,
  input,
  now = new Date(),
  notify = async () => {},
}) {
  const license = objectId(scope.license),
    branchId = objectId(scope.branchId);
  if (
    !/^[a-z][a-z0-9.-]{2,99}$/.test(descriptor?.id || '') ||
    approval?.externalSales?.enabled !== true ||
    String(approval.license) !== String(license) ||
    String(approval.branch_id) !== String(branchId) ||
    approval.extensionId !== descriptor.id ||
    approval.packageDigest !== descriptor.packageDigest ||
    String(approval.externalSales.writerId) !== String(actor?.userId) ||
    !descriptor.requiredCapabilities?.includes('sales.external-posting.v1')
  )
    fail('external_sale_not_approved', 403);
  const event = validate(input),
    grant = approval.externalSales;
  const activatedAt = new Date(grant.activatedAt);
  if (
    !Number.isFinite(activatedAt.getTime()) ||
    event.recognizedAt < activatedAt.toISOString() ||
    Date.parse(event.recognizedAt) > now.getTime() ||
    event.currency !== grant.currency ||
    event.provider !== grant.provider
  )
    fail('external_sale_outside_grant', 403);
  const id = new ObjectId(
    hash([String(license), String(branchId), descriptor.id, event.eventId]).slice(0, 24)
  );
  const filter = { _id: id, license, branch_id: branchId, extension_id: descriptor.id };
  const payloadHash = hash(event),
    sales = db.collection('sales');
  const receipt = (row) => {
    if (!row || row.external_sale?.payloadHash !== payloadHash) fail('external_sale_conflict', 409);
    return { eventId: event.eventId, saleId: String(row._id), payloadHash, posted: true };
  };
  const existing = await sales.findOne(filter);
  if (existing) return receipt(existing);
  const branch = await db.collection('branches').findOne({ _id: branchId, license });
  if (!branch || Money.policy(branch).currencyCode !== event.currency)
    fail('external_sale_currency_mismatch', 409);
  const products = await db
    .collection('items')
    .find({
      license,
      _id: { $in: [...new Set(event.lines.map((l) => l.productId))].map((id) => new ObjectId(id)) },
    })
    .toArray();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const currency = Money.policy(branch),
    amount = (value) => Money.fromMinor(value, currency);
  let costMinor = 0,
    discountMinor = 0;
  const items = event.lines.map((line) => {
    const product = byId.get(line.productId);
    const branches = new Set(
      [product?.branch_id, ...(product?.branch_access || []).map((b) => b.branch_id)]
        .filter(Boolean)
        .map(String)
    );
    if (
      !product ||
      !branches.has(String(branchId)) ||
      [1, '1', true].includes(product.del_status) ||
      ['inactive', 'draft'].includes(product.item_status)
    )
      fail('external_sale_product_unavailable', 409);
    if (
      product.company_price === undefined ||
      product.company_price === null ||
      product.company_price === ''
    )
      fail('external_sale_cost_required', 409);
    let unitCost;
    try {
      unitCost = Money.toMinor(product.company_price, currency);
    } catch {
      fail('external_sale_cost_invalid', 409);
    }
    const cost = unitCost * line.quantity;
    if (unitCost < 0 || !Number.isSafeInteger(cost) || !Number.isSafeInteger(costMinor + cost))
      fail('external_sale_cost_invalid', 409);
    costMinor += cost;
    discountMinor += line.discountMinor;
    if (!Number.isSafeInteger(discountMinor)) fail('external_sale_amount_invalid');
    return {
      item: product._id,
      item_id: String(product._id),
      name: product.name,
      item_name: product.name,
      item_sku: product.itemid || '',
      barcode_id: product.barcode_id || '',
      item_unit: product.unit || '',
      quantity: line.quantity,
      item_quantity: line.quantity,
      unit_price: amount(line.unitPriceMinor),
      item_price: amount(line.unitPriceMinor),
      total: amount(line.totalMinor),
      total_amount: amount(line.totalMinor),
      discount: amount(line.discountMinor),
      tax: 0,
      tax_rate: 0,
      tax_amount: 0,
      return: false,
      company_price: amount(unitCost),
      company_price_total: amount(cost),
      category_id: product.category_id || '',
      category_name: product.category_name || '',
    };
  });
  const total = amount(event.totalMinor),
    date = new Date(event.recognizedAt);
  const document = {
    ...filter,
    sales_id: 'X-' + String(id).toUpperCase(),
    date,
    created_date: now,
    updated_date: now,
    user_id: String(actor.userId),
    user_name: 'Extension',
    updated_by: 'Extension',
    updated_by_id: objectId(actor.userId),
    sale_process: 'Add',
    payment_status: 'Paid',
    payment_mode: 'Marketplace',
    payment_pending: 0,
    total,
    sales_total: total,
    items_total: total,
    subtotal: total,
    items_subtotal: total,
    sales_sub_total: total,
    total_companyprice: amount(costMinor),
    discount: amount(discountMinor),
    tax: 0,
    items_return_total: 0,
    items_return_subtotal: 0,
    return_tax: 0,
    return_discount: 0,
    sales_round_off: 0,
    round_off: 0,
    items,
    items_return: [],
    number_of_items: items.length,
    del_status: 0,
    cashregister_id: '',
    multi_payment: { Marketplace: total },
    customer_id: null,
    customer_name: '',
    ...describeSale({ channel: 'marketplace', partner: event.provider, fulfilment: 'delivery' }),
    external_sale: {
      eventId: event.eventId,
      payloadHash,
      sourceReference: event.sourceReference,
      currency: event.currency,
      recognitionTimeBasis: 'completion-first-observed',
      settlementStatus: 'unreconciled',
      feeStatus: 'unknown',
      stockEffect: 'none',
      costBasis: 'catalogue-at-posting',
    },
  };
  try {
    await sales.insertOne(document);
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const result = receipt(await sales.findOne(filter));
  // The periodic sales sync scan remains authoritative after process failure.
  await notify(document).catch(() => {});
  return result;
}
module.exports = { writerAllowed, validate, postExternalSale };
