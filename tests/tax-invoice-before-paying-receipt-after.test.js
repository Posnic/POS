'use strict';

/*
 * What the paper calls itself, before and after the customer pays.
 *
 * Owner: "before pay customer that print out called what? what to name? as per
 * international standard. second after customer pay we give receipt what to
 * call?" Then, on the answer: "okay fine tax invoice and recotp okay... i am
 * okay with within india Bill. up to you and standards."
 *
 * A receipt is proof that money changed hands. Nothing handed over BEFORE
 * payment may be called one, and both prints were headed SALES RECEIPT - the
 * shop's configurable default - so the customer got a "receipt" for a meal
 * they had not paid for, then another one after paying. The bill a waiter
 * carries from the floor had no heading at all, because that path sends the
 * raw sale and a sale carries no title.
 *
 * The rule, which is law and not taste: a GST-registered shop issues a TAX
 * INVOICE for the supply, and in a restaurant that is the document presented
 * for payment. A shop with no GST issues a BILL. Either way it says UNPAID,
 * because it is a demand for payment. What follows payment is a RECEIPT,
 * carrying the SAME invoice number - one sale, one number.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales_view.js'), 'utf8');
const BILL = fs.readFileSync(path.join(ROOT, 'src', 'bill-manager.js'), 'utf8');
const { renderSale } = require(path.join(ROOT, 'src', 'escpos-receipt.js'));

const titleBlock = VIEW.slice(VIEW.indexOf('var gstShop = !!branchGstin'), VIEW.indexOf("$('.print_date').text(data.created_date);"));

test('before paying it is a tax invoice, or a bill without GST, and never a receipt', () => {
  assert.match(titleBlock, /var beforePaying = !!isKotPrint;/, 'nothing distinguishes the two prints');
  assert.match(titleBlock, /lang_tax_invoice', 'TAX INVOICE'/, 'a GST shop does not issue a tax invoice');
  assert.match(titleBlock, /lang_bill_title', 'BILL'/, 'a shop without GST has no heading of its own');
  assert.match(titleBlock, /gstShop\s*\?[\s\S]{0,120}TAX INVOICE[\s\S]{0,120}BILL/,
    'GST is not what decides between them');
});

test('after paying it is a receipt', () => {
  assert.match(titleBlock, /lang_receipt_title', 'RECEIPT'/);
  /* And the old default, which called both of them the same thing, is gone
     from this decision. */
  assert.ok(!/print-title'\)\.html\(PosnicPro\.local\.get\('sale_title'\)\)/.test(VIEW),
    'the configurable sale title still overrides the document name');
});

test('the pre-payment print says UNPAID, and the receipt does not', () => {
  assert.match(titleBlock, /beforePaying[\s\S]{0,200}lang_unpaid_2', 'UNPAID'/,
    'the bill does not say it is unpaid');
  const after = titleBlock.slice(titleBlock.indexOf('beforePaying'));
  assert.match(after, /:\s*''\)/, 'a paid receipt would also be stamped UNPAID');
});

test('the bill a waiter carries from the floor names itself too', () => {
  assert.match(BILL, /title: \(gstin \? 'TAX INVOICE' : 'BILL'\) \+ ' - UNPAID'/,
    'the floor bill still reaches the roll with no heading');
  /* It reads the GSTIN off the sale, because this runs in the main process
     with no access to the shop settings the screen has. */
  assert.match(BILL, /sale\.branch_gstin_number \|\| sale\.gstin/);
});

test('the heading actually reaches the paper', () => {
  /* renderSale prints sale.title and nothing else names the document, so a
     title that never arrives is a blank slip - which is what the floor bill
     was. */
  const bytes = renderSale({ title: 'TAX INVOICE - UNPAID', billNo: 'SB1D9-000032', items: [], total: 0 },
    { paperWidth: '48' });
  let text = '';
  for (const b of bytes) { if (b === 10) text += '\n'; else if (b >= 32 && b <= 126) text += String.fromCharCode(b); }
  assert.match(text, /TAX INVOICE - UNPAID/, 'the heading is not printed');
  assert.match(text, /SB1D9-000032/, 'the invoice number is missing, so the receipt cannot match it');
});
