'use strict';

/*
 * Issuing an invoice = booking its sale (INVOICING_MODULE_DESIGN).
 *
 * The international model: a draft invoice is a proforma, and ISSUING it is
 * the sale - revenue recognised, stock supplied, tax point set. Nobody walks
 * to a till screen for that; the server books the sale itself, through the
 * same engine the till uses (sale.service.processSale, the PHP-parity code
 * that owns stock, tax, the ledger and every report), so an invoiced sale is
 * indistinguishable from a counter sale in the books.
 *
 * What this builds is the payload the sale screen would have built:
 *   - each catalog line at the INVOICED price, its discount and its tax;
 *   - each custom line as an instant item (the quick-sale rail), so it is
 *     counted, taxed and reported rather than parked as a side note;
 *   - each positive named charge as an instant line too, for the same
 *     reason - the sale engine stores charges beside the total, not in it;
 *   - the document discount and named deductions as the sale's extra
 *     discount;
 *   - Unpaid, so the customer's outstanding grows by exactly the invoice.
 * The sale carries source_invoice_id; the engine's own hook mirrors it back
 * (services/invoice-sync), and the sync is run once more here so the caller
 * gets the invoice's new state in the same reply.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Per-unit amount discount, or percent, in the sale engine's own two fields.
   The engine multiplies the amount by the quantity, so a per-line amount is
   spread per unit exactly as the till's convert path does. */
function discountFields(line) {
  const d = line.discount;
  if (!d || !(Number(d.value) > 0)) return { amount: 0, percent: 0 };
  if (d.type === 'percent') return { amount: 0, percent: round2(d.value) };
  const qty = Number(line.qty) || 1;
  return { amount: round2(Number(d.value) / qty), percent: 0 };
}

function saleLine(itemId, line, extra = {}) {
  const disc = discountFields(line);
  const price = round2(line.unit_price);
  return {
    item_id: String(itemId),
    item_quantity: Number(line.qty) || 1,
    sale_inline_item_price: price,
    item_price: price,
    item_price_total: price,
    sale_inline_discount_value: disc.amount,
    sale_inline_discount_pervalue: disc.percent,
    item_discount: disc.amount,
    item_discount_percentage: disc.percent,
    tax: Number(line.tax_value) || 0,
    tax_type: line.tax_type || '',
    item_unit: 'qty',
    item_name: String(line.item_name || ''),
    item_description: String(line.description || ''),
    item_status: '',
    ...extra,
  };
}

/*
 * Custom lines and positive charges become instant items - the catalog row
 * the quick-sale rail creates for "type an amount" sales. Taxed as the
 * invoice line was; never stocked.
 */
async function instantItemFor(itemRepository, spec, context) {
  const r = await itemRepository.createInstantItem(
    {
      items_name: String(spec.name || 'Item').slice(0, 200),
      items_selling_price: round2(spec.unit_price),
      items_mrp_price: round2(spec.unit_price),
      items_tax: Number(spec.tax_value) || 0,
      items_tax_type: spec.tax_type || 'inclusive',
      items_tax_name: String(spec.tax_name || ''),
      items_quantity: 0,
    },
    context
  );
  if (!r || !r.status || !r.data || !r.data._id) {
    throw new Error((r && r.message) || 'Could not create a line item for ' + spec.name);
  }
  return String(r.data._id);
}

/*
 * The customer on the sale. The invoice's own customer wins; a walk-in
 * invoice falls back to the shop's default customer, exactly as the sale
 * screen does. The customer document supplies what the invoice did not
 * carry (state, country, GST type) so inter-state tax splits stay right.
 */
async function resolveCustomer(invoice, branchSettings) {
  const db = await BaseModel.getDb();
  const id = invoice.customer_id || (branchSettings && branchSettings.default_customer);
  if (!id || !ObjectId.isValid(String(id))) return null;
  const doc = await db.collection('customers').findOne({ _id: new ObjectId(String(id)) });
  if (!doc) return null;
  const pick = (own, fromDoc) => {
    const v = String(own || '').trim();
    return v || String(fromDoc || '').trim();
  };
  return {
    customer_id: String(doc._id),
    customer_name: pick(invoice.customer_name, doc.name),
    customer_phone: pick(invoice.customer_phone, doc.phone),
    customer_email: pick(invoice.customer_email, doc.email),
    customer_address: pick(invoice.customer_address, doc.address),
    customer_state: String(doc.state || '').trim(),
    customer_country: String(doc.country || '').trim(),
    customer_gst_type: String(doc.gst_type || '').trim(),
    customer_gst_number: pick(invoice.customer_gstin, doc.gst_number),
  };
}

async function buildSalePayload(invoice, context, itemRepository) {
  const items = [];
  for (const line of invoice.items || []) {
    if (!line || !(Number(line.qty) > 0)) continue;
    if (line.kind !== 'custom' && line.item_id && ObjectId.isValid(String(line.item_id))) {
      items.push(saleLine(line.item_id, line));
    } else {
      const id = await instantItemFor(
        itemRepository,
        {
          name: line.item_name,
          unit_price: line.unit_price,
          tax_value: line.tax_value,
          tax_type: line.tax_type,
          tax_name: line.tax_name,
        },
        context
      );
      items.push(saleLine(id, line, { item_status: 'instant' }));
    }
  }
  let extraDiscount =
    invoice.discount && invoice.discount.computed > 0 ? round2(invoice.discount.computed) : 0;
  for (const c of invoice.charges || []) {
    if (!c || !(Number(c.computed) > 0)) continue;
    if (Number(c.sign) === -1) {
      extraDiscount = round2(extraDiscount + Number(c.computed));
      continue;
    }
    const id = await instantItemFor(
      itemRepository,
      { name: c.name, unit_price: c.computed, tax_value: 0, tax_type: 'inclusive', tax_name: '' },
      context
    );
    items.push(
      saleLine(
        id,
        { qty: 1, unit_price: c.computed, item_name: c.name },
        { item_status: 'instant' }
      )
    );
  }
  if (!items.length) throw new Error('This invoice has no lines to book');

  const customer = await resolveCustomer(invoice, context.branchSettings);
  if (!customer) {
    throw new Error('Add a customer to the invoice, or set a default customer in Settings');
  }

  return {
    items,
    ...customer,
    sales_total: round2(invoice.total),
    sales_sub_total: round2(invoice.subtotal),
    tax: round2(invoice.tax_total),
    payment_descriptiondiscount: '',
    /* Issued, not paid: the customer owes the whole document from today. */
    unpaid: 'true',
    payment_mode: '',
    partial_check: 'false',
    partial_balance: 0,
    customer_current_balance: 0,
    wallet_check: 'false',
    sales_id: '',
    register_id: '',
    extra_discount: extraDiscount,
    extra_discount_type: 'price',
    charges: [],
    sale_method: 'Live-Order',
    sale_process: 'Add',
    sales_description: (
      'Invoice ' +
      (invoice.invoice_id || '') +
      (invoice.reference ? ' / ' + invoice.reference : '')
    ).slice(0, 200),
    source_invoice_id: String(invoice._id),
  };
}

/*
 * Issue: draft -> the sale exists -> unpaid. Replay-safe: an invoice that
 * already has a sale answers with its current state and books nothing.
 */
async function issueInvoice(invoiceId, context = {}) {
  const InvoiceRepository = require('../repositories/invoice.repository');
  const invoiceSync = require('./invoice-sync');
  const repo = new InvoiceRepository();
  const found = await repo.getInvoice(invoiceId, context);
  if (!found.status) return { status: false, data: null, message: found.message };
  const invoice = found.data;
  if (invoice.sale_id) {
    const again = await invoiceSync.syncSale(invoice.sale_id, { invoiceId: String(invoice._id) });
    return {
      status: true,
      data: {
        sale_id: String(invoice.sale_id),
        sale_number: invoice.sale_number,
        ...(again.data || {}),
        already: true,
      },
      message: 'Invoice already issued as sale ' + (invoice.sale_number || ''),
    };
  }
  if (invoice.status !== 'draft') {
    return { status: false, data: null, message: 'Only a draft can be issued' };
  }

  const salesService = require('./sale.service');
  const ItemRepository = require('../repositories/item.repository');
  const itemRepository = new ItemRepository();

  let saleContext = {
    branchId: context.branchId,
    branchName: context.branchName || '',
    licenseId: context.licenseId,
    userId: context.userId || null,
    userName: context.userName || 'System',
    deviceId: null,
    salesPrefix: 'INV',
    stockManagement: true,
    stockLogStatus: true,
    roundOff: true,
    branchSettings: {},
    branchState: '',
  };
  saleContext = await salesService.enrichSaleContext(saleContext);

  let payload;
  try {
    payload = await buildSalePayload(invoice, saleContext, itemRepository);
  } catch (e) {
    return { status: false, data: null, message: e.message };
  }

  const result = await salesService.processSale(payload, '', 'Add', saleContext);
  if (!result || result.status !== true) {
    return {
      status: false,
      data: (result && result.data) || null,
      message: (result && result.message) || 'The sale could not be booked',
    };
  }
  const saleId = result.data && (result.data._id || result.data.sales_id);
  const synced = await invoiceSync.syncSale(saleId, { invoiceId: String(invoice._id) });
  if (!synced.synced) {
    /* the sale exists; the mirror will catch up on the next sync - say so */
    return {
      status: true,
      data: {
        sale_id: String(saleId),
        sale_number: result.data.sale_number || '',
        mirrored: false,
      },
      message: 'Sale ' + (result.data.sale_number || '') + ' booked; the invoice will refresh',
    };
  }
  return {
    status: true,
    data: {
      sale_id: String(saleId),
      sale_number: result.data.sale_number || '',
      ...(synced.data || {}),
    },
    message: 'Invoice issued - booked as sale ' + (result.data.sale_number || ''),
  };
}

module.exports = { issueInvoice, buildSalePayload, discountFields, _round2: round2 };
