'use strict';
const { context, allowed, fail } = require('../utils/branch-access');
const { floorEligibility } = require('../helpers/floor-eligibility');
const { snapshotFrom } = require('./guest-bill.service');
const Money = require('../utils/currency');
const { ObjectId } = require('mongodb');

async function read(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Permission is required.', 403);
  const c = await context(req);
  if ([false, 0, '0', 'false'].includes(c.branch.module_captain_enable))
    fail('Captain is disabled.', 403);
  const saleId = req.query?.saleId;
  if (saleId && !/^[a-f0-9]{24}$/i.test(String(saleId))) fail('Open order not found.', 404);
  let table = saleId ? 'Take Away' : req.query?.table;
  if (
    typeof table !== 'string' ||
    !table.trim() ||
    table.length > 40 ||
    Array.from(table).some((ch) => ch.charCodeAt(0) < 32)
  )
    fail('Choose a table.');
  const scope = { branch_id: c.branchId, license: c.license };
  const sales = await req.db
    .collection('sales')
    .find({
      ...scope,
      ...floorEligibility(),
      ...(saleId ? {_id:new ObjectId(saleId),dine_type:/^take[\s_-]*away$/i} : {table_number:table.trim()}),
    })
    .sort({ _id: 1 })
    .limit(201)
    .toArray();
  if (!sales.length) fail('Open order not found.', 404);
  if (saleId) table = 'Take Away ' + (sales[0].sales_id || sales[0].token_id || saleId);
  if (sales.length > 200)
    fail('This table has too many open orders. Ask the cashier for help.', 422);
  const snapshot = snapshotFrom(sales, c.branch, table.trim(), { allowZero: true });
  const monetary = Money.snapshot(snapshot);
  const ids = sales.map((sale) => sale.captain_payment_plan).filter(Boolean);
  const plans = ids.length
    ? await req.db
        .collection('captain_payment_plans')
        .find({ ...scope, _id: { $in: ids } })
        .toArray()
    : [];
  if (plans.some((plan) => plan.purpose === 'order-restructure'))
    fail('This order is being updated. Please retry.', 409);
  let paidMinor = 0;
  for (const sale of sales) {
    const total = snapshotFrom([sale], c.branch, table.trim(), { allowZero: true }).totalMinor;
    let paid;
    if (sale.captain_payment_plan) {
      // The journal is authoritative even if a payment's sale projection was interrupted.
      const plan = plans.find((row) => String(row._id) === String(sale.captain_payment_plan));
      if (!plan)
        fail(
          'Payment status is not confirmed. Retry this request; do not collect the money again.',
          409
        );
      paid = (plan.payments || []).reduce(
        (sum, payment) => sum + Number(payment.allocations?.[String(sale._id)] || 0),
        0
      );
    } else
      paid =
        sale.payment_status === 'Paid'
          ? total
          : Money.toMinor(require('./captain-sale-payment').paidAmount(sale), monetary);
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > total)
      fail('The bill totals do not match. Refresh and try again.', 409);
    paidMinor += paid;
  }
  return {
    ...snapshot,
    paidMinor,
    dueMinor: snapshot.totalMinor - paidMinor,
    collectEnabled: require('./captain-payments').settings(c.branch).enabled,
    orderIds: sales.map((sale) => String(sale._id)),
    serverTime: new Date().toISOString(),
  };
}
module.exports = { read };
