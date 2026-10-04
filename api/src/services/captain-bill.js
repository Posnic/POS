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
  const receipt = req.query?.receipt === 'true';
  if (receipt && !saleId) fail('Choose an order.', 422);
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
      ...(receipt ? {sale_process: {$ne: 'cancelled'}, payment_status: {$ne: 'Cancelled'}} : floorEligibility()),
      ...(saleId
        ? { _id: new ObjectId(saleId), ...(receipt ? {} : {dine_type: /^take[\s_-]*away$/i}) }
        : { table_number: table.trim() }),
    })
    .sort({ _id: 1 })
    .limit(201)
    .toArray();
  if (!sales.length) fail('Open order not found.', 404);
  if (saleId) table = /^take[\s_-]*away$/i.test(sales[0].dine_type || '') ? 'Take Away ' + (sales[0].takeaway_number || sales[0].token_id || sales[0].sales_id || saleId) : String(sales[0].table_number || sales[0].sales_id || saleId);
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
    collectEnabled: !receipt && require('./captain-payments').settings(c.branch).enabled,
    orderIds: sales.map((sale) => String(sale._id)),
    serverTime: new Date().toISOString(),
  };
}
async function reprint(req) {
  const body = req.body || {};
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id || '')) fail('Choose a valid print request.');
  const bill = await read({...req, query:{saleId:body.saleId,receipt:'true'}});
  const c = await context(req);
  const sale = await req.db.collection('sales').findOne({_id:new ObjectId(body.saleId),branch_id:c.branchId,license:c.license});
  const payload = require('../helpers/bill-payload').buildBillPayload(sale,c.branch);
  const monetary = Money.policy(c.branch);
  payload.title = bill.dueMinor === 0 ? 'PAID RECEIPT - COPY' : 'BILL - COPY';
  payload.payments = [{label:'Paid',amount:Money.fromMinor(bill.paidMinor,monetary)}, {label:'Remaining balance',amount:Money.fromMinor(bill.dueMinor,monetary)}];
  if (payload.receiptDocument) Object.assign(payload.receiptDocument, {
    sales_id: sale.sales_id || String(sale._id),
    payment_mode: bill.dueMinor === 0 ? 'Paid (receipt copy)' : 'Payment pending (bill copy)',
    partial_check: 'true',
    partial_balance: Money.fromMinor(bill.paidMinor, monetary),
    payment_pending: Money.fromMinor(bill.dueMinor, monetary)
  });
  const copies = Math.max(1,Math.min(3,Math.floor(Number(body.copies || c.branch.bill_print_copies) || 1)));
  for(let copy=1;copy<=copies;copy++) {
    const result = await require('../repositories/print-job.repository').queuePrintJob({branchId:c.branchId,saleId:sale._id,kind:'bill',label:'Receipt copy',payload,ticketKey:'captain-receipt:'+sale._id+':'+body.request_id+':'+copy});
    if(!result.status) fail('Could not queue the bill. Please retry.',503);
  }
  require('../helpers/bill-notify').notifyBillRequested({branchId:c.branchId,count:copies});
  return {type:'success',status:'queued'};
}
module.exports = { read, reprint };
