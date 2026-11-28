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
const requestIdValid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const originalRequest = payment => ({
  amount: payment.amount === undefined || payment.amount === null || payment.amount === '' ? null : String(payment.amount),
  method: String(payment.method || '').trim().slice(0,40),
  reference: String(payment.reference || '').trim().slice(0,80),
  note: String(payment.note || '').trim().slice(0,200),
});
const sameCashier = (original,context) => original.actorId
  ? String(context.userId || '') === original.actorId
  : context.userName === original.actor;

async function recordPayment(invoice, payment = {}, context = {}) {
  if (payment.commandId !== undefined && !requestIdValid(payment.commandId))
    return {status:false,data:null,message:'Invalid original payment request identity'};
  if (!invoice || !invoice.sale_id) {
    return { status: false, data: null, message: 'Issue the invoice first' };
  }
  const sale = await loadSale(invoice.sale_id);
  if (!sale)
    return { status: false, data: null, message: 'The sale behind this invoice was not found' };

  if (payment.commandId) {
    const completed = (sale.legacy_invoice_payment_results || []).filter(row => row.id === payment.commandId);
    if (completed.length) {
      if (completed.length !== 1 || !sameCashier(completed[0],context) ||
          JSON.stringify(completed[0].request) !== JSON.stringify(originalRequest(payment)))
        return {status:false,data:null,message:'Original payment request differs; review the saved result'};
      return completed[0].result;
    }
    if (sale.legacy_invoice_payment_lock?.id === payment.commandId &&
        (!sameCashier(sale.legacy_invoice_payment_lock,context) ||
         JSON.stringify(sale.legacy_invoice_payment_lock.request) !== JSON.stringify(originalRequest(payment))))
      return {status:false,data:null,message:'Original payment request differs; review the unfinished request'};
  }
  if (sale.books_receipt_lock || sale.legacy_invoice_payment_lock) return { status: false, data: null, message: 'This sale has an unfinished payment; recover the original request' };
  if (sale.captain_payment_plan || sale.payment_correction_pending || sale.return_refund_lock ||
      new Date(sale.captain_edit_until || 0).getTime() >= Date.now()) {
    return { status: false, data: null, message: 'Finish the existing payment, return or sale edit before collecting this invoice' };
  }
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

  // Admit this existing workflow on the same documents Books reserves, before
  // any money write. Interrupted effects retain admission for explicit recovery.
  if (String(sale.source_invoice_id) !== String(invoice._id)) {
    return { status: false, data: null, message: 'Original invoice sale changed' };
  }
  // Bound retained recovery evidence before acquiring either admission.
  const results = sale.legacy_invoice_payment_results;
  if ((results !== undefined && (!Array.isArray(results) || results.length >= 1000)) ||
      require('mongodb').BSON.calculateObjectSize(sale) > 512 * 1024) {
    return { status: false, data: null, message: 'Payment recovery history requires review before another payment' };
  }
  const admission = { id: payment.commandId || require('node:crypto').randomUUID(),
    request: originalRequest(payment), actorId: context.userId ? String(context.userId) : null, invoiceId: String(invoice._id),
    amount, method, reference, note, actor: userName, startedAt: now, before, walletBefore: sale.wallet_amount ?? 0, moneyId: new ObjectId(), allocationId: new ObjectId(),
    source: require('mongodb').BSON.deserialize(require('mongodb').BSON.serialize(sale)), invoiceNumber: String(invoice.invoice_id || '') };
  if(sale.customer_id && ObjectId.isValid(String(sale.customer_id)))
    admission.ledger = await require('./invoice-payment-ledger').capture(db,sale,before);
  const unlocked = { books_receipt_lock: { $exists: false }, legacy_invoice_payment_lock: { $exists: false } };
  const admitted = await sales.updateOne({ _id: sale._id, ...unlocked,
    $expr: { $eq: ['$$ROOT', { $literal: sale }] } }, { $set: { legacy_invoice_payment_lock: admission } });
  if (!admitted.matchedCount) return { status: false, data: null, message: 'Sale changed or has an unfinished payment; check the original request' };
  const customerKey = sale.customer_id && ObjectId.isValid(String(sale.customer_id))
    ? { _id: new ObjectId(String(sale.customer_id)), license: sale.license, branch_id: sale.branch_id } : null;
  if (customerKey) {
    const held = await db.collection('customers').updateOne({ ...customerKey, ...unlocked },
      { $set: { legacy_invoice_payment_lock: admission } });
    if (!held.matchedCount) {
      await sales.updateOne({ _id: sale._id, 'legacy_invoice_payment_lock.id': admission.id }, { $unset: { legacy_invoice_payment_lock: '' } });
      return { status: false, data: null, message: 'Customer unavailable or has an unfinished payment; no money was recorded' };
    }
  }

  return finishPayment(invoice,sale,admission,context,db);
}

async function releasePayment(db,sale,admission){
 const targets=[];
 if(sale.customer_id&&ObjectId.isValid(String(sale.customer_id)))targets.push(['customers',{_id:new ObjectId(String(sale.customer_id)),license:sale.license,branch_id:sale.branch_id}]);
 targets.push(['sales',{_id:sale._id}]);
 for(const [name,key] of targets){
  const collection=db.collection(name);
  await collection.updateOne({...key,'legacy_invoice_payment_lock.id':admission.id},{$unset:{legacy_invoice_payment_lock:''}});
  const remaining=await collection.findOne(key);
  if(remaining?.legacy_invoice_payment_lock?.id===admission.id)throw new Error('Payment completion release requires retry');
 }
}
async function finishPayment(invoice,sale,admission,context,db){
 const {amount,method,reference,note,before}=admission,now=new Date(admission.startedAt),userName=admission.actor;
 const paidAfter=round2(before.paid_amount+amount),pendingAfter=round2(Math.max(0,before.total-paidAfter)),statusWord=pendingAfter>0?'Partialy Paid':'Paid';
 const sales=db.collection('sales');
 const customerKey=sale.customer_id&&ObjectId.isValid(String(sale.customer_id))?{_id:new ObjectId(String(sale.customer_id)),license:sale.license,branch_id:sale.branch_id}:null;
 const current=await sales.findOne({_id:sale._id});
 if(current?.legacy_invoice_payment_lock?.id!==admission.id)throw new Error('Original payment admission unavailable');
 const unchanged=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['legacy_invoice_payment_lock','legacy_invoice_payment_effects','legacy_invoice_payment_results','partial_balance','payment_pending','payment_status','wallet_amount','updated_date','updated_by'].includes(key)));
 const canonical=require('./invoice-payment-effects').canonical;
 if(canonical(unchanged(current))!==canonical(unchanged(sale)))throw new Error('Original payment sale source changed');

 if(customerKey){const customer=await db.collection('customers').findOne(customerKey);if(customer?.legacy_invoice_payment_lock?.id!==admission.id)throw new Error('Original customer admission unavailable');}
 if(customerKey)await require('./invoice-payment-ledger').verify(db,sale,admission);
  const requireWrite = async operation => { const result = await operation; if (!result.matchedCount) throw new Error('Payment admission changed; recover the original request'); return result; };
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
    await require('./invoice-payment-effects').insertOriginal(transactions, {
      _id: admission.moneyId, legacy_invoice_payment_id: admission.id,
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
    const own = await transactions.findOne({ sale_id: sale._id, license: sale.license, customer_id: customerId, branch_id: sale.branch_id });
    if (!own) {
      await require('./invoice-payment-effects').insertOriginal(transactions, {
        _id: admission.allocationId, legacy_invoice_payment_id: admission.id,
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
    const effects = require('./invoice-payment-effects');
    await effects.allocation(transactions, { sale_id: sale._id, license: sale.license, customer_id: customerId, branch_id: sale.branch_id }, admission);
    await effects.sale(sales, sale._id, admission, saleSet, true);
    /* customer balance = money in - money out, the same sum the customer
       page and the transaction endpoint compute */
    const balance = await require('./invoice-payment-ledger').verify(db,sale,admission,true);
    await requireWrite(db
      .collection('customers')
      .updateOne({ ...customerKey, 'legacy_invoice_payment_lock.id': admission.id }, { $set: { balance, updated_date: now } }));
  } else {
    await require('./invoice-payment-effects').sale(sales, sale._id, admission, saleSet, false);
  }

  const InvoiceRepository = require('../repositories/invoice.repository');
  const repo = new InvoiceRepository();
  const noted = await repo.recordPayment(
    String(invoice._id),
    { amount, method, reference, note, date: now, by: userName, commandId: admission.id },
    context
  );
  if (!noted.status) throw new Error('Payment requires original-result recovery: invoice note was not confirmed');
  const synced = await syncSale(sale._id, { invoiceId: String(invoice._id) });
  if (!synced.synced) throw new Error('Payment requires original-result recovery: invoice balance was not confirmed');
  /* the word comes from what was just written, not from the mirror's reply -
     the reply is the same truth a moment later, but the message must not
     depend on a round trip */
  const word = pendingAfter > 0 ? 'partial' : 'paid';
  const result = {
    status: true,
    data: { amount, balance: pendingAfter, ...(synced.data || {}), commandId: admission.id },
    message:
      'Payment of ' +
      amount.toFixed(2) +
      ' recorded - invoice ' +
      (word === 'partial' ? 'partially paid, ' + pendingAfter.toFixed(2) + ' still due' : word),
  };
  if(customerKey)await require('./invoice-payment-ledger').verify(db,sale,admission,true);
  await sales.updateOne({ _id:sale._id, 'legacy_invoice_payment_lock.id':admission.id,
    'legacy_invoice_payment_results.id':{$ne:admission.id} },
    {$push:{legacy_invoice_payment_results:{id:admission.id,result,request:admission.request,actor:admission.actor,actorId:admission.actorId}}});
  const saved=await sales.findOne({_id:sale._id});
  const originals=(saved.legacy_invoice_payment_results||[]).filter(row=>row.id===admission.id);
  if(originals.length!==1)throw new Error('Original completion was not saved; recover the original payment');
  await releasePayment(db,sale,admission);
  return originals[0].result;
}

async function recoverPayment(invoice,commandId,context={}){
 if(typeof commandId!=='string'||!ObjectId.isValid(String(invoice?.sale_id)))throw new Error('Original payment identity required');
 const db=await BaseModel.getDb(),sale=await loadSale(invoice.sale_id);
 if(!sale||String(sale.license)!==String(context.licenseId)||String(sale.branch_id)!==String(context.branchId)||
    String(sale.source_invoice_id)!==String(invoice._id))throw new Error('Original payment unavailable');
 const completed=(sale.legacy_invoice_payment_results||[]).filter(row=>row.id===commandId);
 if(completed.length>1)throw new Error('Original payment completion differs');
 if(completed.length){
  if(sale.legacy_invoice_payment_lock?.id===commandId)await releasePayment(db,sale,sale.legacy_invoice_payment_lock);
  return completed[0].result;
 }
 const admission=sale.legacy_invoice_payment_lock;
 if(!admission||admission.id!==commandId||!admission.source||admission.invoiceId!==String(invoice._id))throw new Error('Original payment admission unavailable');
 if(!sameCashier(admission,context))throw new Error('Original cashier recovery required');
 return finishPayment({...invoice,invoice_id:admission.invoiceNumber},admission.source,admission,context,db);
}

// Status must never recover effects or release admission: it is a read only query.
async function paymentRequestStatus(invoice,commandId,context={}) {
 if(!requestIdValid(commandId))throw new Error('Original payment identity required');
 if(!invoice?.sale_id)return {state:'absent',commandId};
 const sale=await loadSale(invoice.sale_id);
 if(!sale||String(sale.license)!==String(context.licenseId)||String(sale.branch_id)!==String(context.branchId)||
    String(sale.source_invoice_id)!==String(invoice._id))throw new Error('Original payment unavailable');
 const completed=(sale.legacy_invoice_payment_results||[]).filter(row=>row.id===commandId);
 if(completed.length>1)throw new Error('Original payment completion differs');
 if(completed.length)return {state:'saved',commandId,result:completed[0].result,releasePending:sale.legacy_invoice_payment_lock?.id===commandId};
 const admission=sale.legacy_invoice_payment_lock;
 if(admission?.id===commandId)return {
  state:'pending',commandId,amount:admission.amount,method:admission.method,
  reference:admission.reference,startedAt:admission.startedAt,
  canRecover:!!admission.source&&sameCashier(admission,context)&&
    (!admission.source.customer_id||!!admission.ledger),
 };
 return {state:admission||sale.books_receipt_lock?'other_pending':'absent',commandId};
}

module.exports = {
  snapshotFromSale,
  syncSale,
  afterSaleSaved,
  afterSaleSettled,
  recordPayment,
  recoverPayment,
  paymentRequestStatus,
  _round2: round2,
};
