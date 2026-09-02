'use strict';

/*
 * The seam between an invoice and its sale (INVOICING_MODULE_DESIGN).
 *
 * An invoice never holds money; the sale does. This service is the ONE place
 * that reads a sale's payment state and repeats it onto the invoice, so the
 * two can never be reconciled in two different ways:
 *
 *   - after a sale is saved (created or edited) with source_invoice_id -
 *     including the one services/invoice-booking creates when an invoice
 *     is issued
 *   - after a pending sale is settled from the customer page
 *   - when a payment is recorded on the invoice itself, which pays down the
 *     SALE and its ledger rows, and then mirrors
 *
 * Every entry point is fire-safe: a mirror that fails must never fail the
 * sale it is mirroring. The sale is the truth; a stale invoice heals on the
 * next sync, a lost sale does not.
 *
 * Requires are lazy where they would be circular: sale.repository calls in
 * here after a settlement, and settling calls back into sale.repository.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const firstNumber = (...vals) => {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

/*
 * What a sale says about money, in the invoice's terms.
 *
 * The sale's own vocabulary is PHP-era: payment_status is 'Paid', 'Unpaid'
 * or 'Partialy Paid' (sic), payment_pending is what is still owed and
 * partial_balance what was paid. A parked cart (sale_process 'Hold') is not
 * a sale at all and yields nothing - an invoice must not read "unpaid" off
 * a cart somebody parked to answer the phone.
 */
function snapshotFromSale(sale) {
  if (!sale || !sale._id) return null;
  if (String(sale.sale_process || '') === 'Hold') return null;
  const total = round2(firstNumber(sale.sales_total, sale.total, sale.items_total));
  const status = String(sale.payment_status || 'Paid').trim();
  let paid;
  if (/^paid$/i.test(status)) {
    paid = total;
  } else if (/^unpaid$/i.test(status)) {
    paid = 0;
  } else {
    const pending = Number(sale.payment_pending);
    paid = Number.isFinite(pending) ? total - pending : firstNumber(sale.partial_balance);
  }
  paid = round2(Math.max(0, Math.min(total, paid)));
  return {
    sale_id: String(sale._id),
    sale_number: String(sale.sales_id || ''),
    total,
    paid_amount: paid,
    balance: round2(total - paid),
    payment_status: status,
  };
}

async function loadSale(saleId) {
  if (!saleId || !ObjectId.isValid(String(saleId))) return null;
  const db = await BaseModel.getDb();
  return db.collection('sales').findOne({ _id: new ObjectId(String(saleId)) });
}

const contextOfSale = (sale) => ({
  branchId: sale.branch_id ? String(sale.branch_id) : null,
  licenseId: sale.license ? String(sale.license) : null,
  userName: String(sale.updated_by || sale.created_by || ''),
});

/*
 * Mirror one sale onto its invoice. `invoiceId` may be given (the invoice
 * page asking for a refresh) or read off the sale (the sale-side hooks).
 * Closes the quote chain too: an invoice born from a quote stamps that quote
 * converted with the same sale, so quote -> invoice -> sale reads end to end.
 */
async function syncSale(saleId, { invoiceId } = {}) {
  const sale = await loadSale(saleId);
  if (!sale) return { synced: false, message: 'Sale not found' };
  const invId = invoiceId || sale.source_invoice_id;
  if (!invId || !ObjectId.isValid(String(invId))) {
    return { synced: false, message: 'No invoice on this sale' };
  }
  const snapshot = snapshotFromSale(sale);
  if (!snapshot) return { synced: false, message: 'A parked cart is not a sale' };

  const InvoiceRepository = require('../repositories/invoice.repository');
  const repo = new InvoiceRepository();
  const ctx = contextOfSale(sale);
  const r = await repo.applySaleSnapshot(String(invId), snapshot, ctx);
  if (!r.status) return { synced: false, message: r.message };

  try {
    const inv = await repo.getInvoice(String(invId), ctx);
    if (inv.status && inv.data && inv.data.source_quote_id) {
      const QuoteRepository = require('../repositories/quote.repository');
      await new QuoteRepository().transition(
        String(inv.data.source_quote_id),
        'convert',
        { sale_id: snapshot.sale_id },
        ctx
      );
    }
  } catch (e) {
    /* the quote's stamp is a courtesy; the invoice is already right */
    console.error('invoice-sync: quote chain skipped:', e.message);
  }
  return { synced: true, message: r.message, data: r.data };
}

/* Fire-safe: called from inside the sale save. */
async function afterSaleSaved(saleId) {
  try {
    return await syncSale(saleId);
  } catch (e) {
    console.error('invoice-sync.afterSaleSaved:', e.message);
    return { synced: false, message: e.message };
  }
}

/* Fire-safe: called after the customer page settles pending sales. */
async function afterSaleSettled(saleId) {
  try {
    return await syncSale(saleId);
  } catch (e) {
    console.error('invoice-sync.afterSaleSettled:', e.message);
    return { synced: false, message: e.message };
  }
}

/*
 * Record a payment against an invoice = pay down its SALE.
 *
 * Full or partial: the amount defaults to the balance and may be less. The
 * sale's PHP-era fields move exactly as the customer page's settlement moves
 * them - partial_balance is what has been paid, payment_pending what is
 * still owed, payment_status the word - and with a customer on the sale the
 * ledger gets the two rows that page would have written by hand: a payment
 * received ('in'), and the sale's own row carrying the money consumed and
 * the pending that remains. The customer's balance is then recomputed from
 * the ledger, so their outstanding drops by exactly what was paid. Without
 * a customer (a walk-in invoice) there is no ledger to keep, and the sale
 * alone is written.
 *
 * The invoice keeps a NOTE of the payment (who, when, how, reference); the
 * money lives on the sale, and the mirror repeats it.
 */
async function recordPayment(invoice, payment = {}, context = {}) {
  if (!invoice || !invoice.sale_id) {
    return { status: false, data: null, message: 'Issue the invoice first' };
  }
  const sale = await loadSale(invoice.sale_id);
  if (!sale)
    return { status: false, data: null, message: 'The sale behind this invoice was not found' };

  const before = snapshotFromSale(sale);
  if (!before) return { status: false, data: null, message: 'A parked cart cannot be paid' };
  if (before.balance <= 0) {
    await syncSale(sale._id, { invoiceId: String(invoice._id) });
    return { status: true, data: { already: true }, message: 'This invoice is already paid' };
  }
  const requested =
    payment.amount === undefined || payment.amount === null || payment.amount === ''
      ? before.balance
      : round2(payment.amount);
  if (!(requested > 0)) {
    return { status: false, data: null, message: 'Enter the amount received' };
  }
  if (requested > before.balance + 0.005) {
    return {
      status: false,
      data: null,
      message: 'That is more than the ' + before.balance.toFixed(2) + ' still owed on this invoice',
    };
  }
  const amount = Math.min(requested, before.balance);
  const paidAfter = round2(before.paid_amount + amount);
  const pendingAfter = round2(Math.max(0, before.total - paidAfter));
  const statusWord = pendingAfter > 0 ? 'Partialy Paid' : 'Paid';
  const now = new Date();
  const method = String(payment.method || '')
    .trim()
    .slice(0, 40);
  const reference = String(payment.reference || '')
    .trim()
    .slice(0, 80);
  const note = String(payment.note || '')
    .trim()
    .slice(0, 200);
  const userName = String(context.userName || '');
  const db = await BaseModel.getDb();
  const sales = db.collection('sales');

  const saleSet = {
    partial_balance: paidAfter,
    payment_pending: pendingAfter,
    payment_status: statusWord,
    updated_date: now,
    updated_by: userName,
  };

  if (sale.customer_id && ObjectId.isValid(String(sale.customer_id))) {
    const customerId = new ObjectId(String(sale.customer_id));
    const transactions = db.collection('transaction');
    const description =
      'Invoice ' +
      (invoice.invoice_id || '') +
      (pendingAfter > 0 ? ' part payment' : ' paid') +
      (method ? ' - ' + method : '') +
      (reference ? ' (' + reference + ')' : '');
    /* Payment received: the row the customer page's "add transaction" writes. */
    await transactions.insertOne({
      sale_id: '',
      customer_id: customerId,
      customer_name: String(sale.customer_name || ''),
      customer_phone: String(sale.customer_phone || ''),
      branch_id: sale.branch_id || null,
      branch_name: String(sale.branch_name || ''),
      amount,
      type: 'in',
      pending: 0,
      description,
      transaction_image: '',
      date: now,
      created_date: now,
      updated_date: now,
      license: sale.license,
      invoice_id: invoice._id,
    });
    /* The sale's own row exists only for sales tendered as partial; an
       unpaid sale never wrote one. It must exist to carry the money
       consumed and the pending that remains. */
    const own = await transactions.findOne({ sale_id: sale._id, license: sale.license });
    if (!own) {
      await transactions.insertOne({
        sale_id: sale._id,
        customer_id: customerId,
        customer_name: String(sale.customer_name || ''),
        transaction_image: 'category.svg',
        branch_id: sale.branch_id || null,
        license: sale.license,
        amount: 0,
        type: 'out',
        pending: before.balance,
        sale_total: before.total,
        description: 'Add sale',
        date: now,
        created_date: now,
        updated_date: now,
      });
    }
    await transactions.updateOne(
      { sale_id: sale._id, license: sale.license },
      {
        $inc: { amount },
        $set: { pending: pendingAfter, type: 'out', updated_date: now },
      }
    );
    await sales.updateOne({ _id: sale._id }, { $set: saleSet, $inc: { wallet_amount: amount } });
    /* customer balance = money in - money out, the same sum the customer
       page and the transaction endpoint compute */
    const filter = { customer_id: customerId, license: sale.license };
    if (sale.branch_id) filter.branch_id = sale.branch_id;
    const agg = await transactions
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalIn: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$amount', 0] } },
            totalOut: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$amount', 0] } },
          },
        },
      ])
      .toArray();
    const balance = agg.length ? round2((agg[0].totalIn || 0) - (agg[0].totalOut || 0)) : 0;
    await db
      .collection('customers')
      .updateOne({ _id: customerId }, { $set: { balance, updated_date: now } });
  } else {
    await sales.updateOne({ _id: sale._id }, { $set: saleSet });
  }

  const InvoiceRepository = require('../repositories/invoice.repository');
  const repo = new InvoiceRepository();
  await repo.recordPayment(
    String(invoice._id),
    { amount, method, reference, note, date: now, by: userName },
    context
  );
  const synced = await syncSale(sale._id, { invoiceId: String(invoice._id) });
  /* the word comes from what was just written, not from the mirror's reply -
     the reply is the same truth a moment later, but the message must not
     depend on a round trip */
  const word = pendingAfter > 0 ? 'partial' : 'paid';
  return {
    status: true,
    data: { amount, balance: pendingAfter, ...(synced.data || {}) },
    message:
      'Payment of ' +
      amount.toFixed(2) +
      ' recorded - invoice ' +
      (word === 'partial' ? 'partially paid, ' + pendingAfter.toFixed(2) + ' still due' : word),
  };
}

module.exports = {
  snapshotFromSale,
  syncSale,
  afterSaleSaved,
  afterSaleSettled,
  recordPayment,
  _round2: round2,
};
