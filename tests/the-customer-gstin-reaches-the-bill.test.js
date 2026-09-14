'use strict';

/*
 * A business buying a meal has to be able to claim the tax back.
 *
 * Owner: "some customer ask bill with their GST details to claim or something.
 * we need provision for that. so customer can have field GST as optional. if
 * they given we can print and give."
 *
 * That is input tax credit, and it turns on one thing: the invoice has to carry
 * the CUSTOMER'S OWN GSTIN. Without it the document is not one the claim can be
 * made against, and the customer does not find out at the counter - they find
 * out months later at filing time, holding a bill that looks perfectly correct.
 *
 * Nearly all of the chain already existed. The customer form validates a GSTIN,
 * the sale copies it onto `customer_gst_number`, and the GSTR reports read it.
 * The only broken link was the last one: the bill never printed it. Everything
 * here is about that step and the company name beside it.
 *
 * NO SETTING GATES IT. Every other optional row on the bill is a switch,
 * because whether a shop wants table numbers on its paper is a decision it
 * makes once. A customer handing over a GSTIN is not a shop decision, and
 * making them wait at the counter while somebody finds a settings page is the
 * failure being fixed. Given means printed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { renderSale } = require(path.join(ROOT, 'src', 'escpos-receipt.js'));
const { buildBillPayload } = require(path.join(ROOT, 'api', 'src', 'helpers', 'bill-payload.js'));

const A_MEAL = {
  sales_id: 'SB1D15-000004',
  date: new Date('2026-09-15T13:20:00Z'),
  items: [{ name: 'Business Lunch', item_quantity: 4, item_base_price: 250, item_tax: 50 }],
  sales_sub_total: 1000,
  tax: 50,
  sales_total: 1050,
};
const THE_SHOP = { branch_name: 'Virundu Restaurant', branch_gstin_number: '33AABCM9561A1ZS' };

/* A real one: two digits of state code, a PAN, an entity digit, Z, a check. */
const A_REAL_GSTIN = '33AAACR5055K1Z5';

function paper(payload) {
  const ARGS = { 0x40: 0, 0x74: 1, 0x61: 1, 0x45: 1, 0x64: 1, 0x70: 3 };
  const GS_ARGS = { 0x21: 1, 0x56: 2 };
  const bytes = renderSale(payload, { paperWidth: '48' });
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x1b || b === 0x1d) {
      const table = b === 0x1b ? ARGS : GS_ARGS;
      const n = table[bytes[i + 1]];
      i += 1 + (n == null ? 1 : n);
      continue;
    }
    if (b === 10) text += '\n';
    else if (b >= 32 && b <= 126) text += String.fromCharCode(b);
  }
  return text;
}

/* ------------------------------------------------------- it reaches the paper */

test('A CUSTOMER WHO GAVE A GSTIN GETS IT ON THE BILL', () => {
  const bill = buildBillPayload(
    { ...A_MEAL, customer_name: 'Ramesh Kumar', customer_gst_number: A_REAL_GSTIN },
    THE_SHOP
  );
  assert.ok(bill.customer.includes('GSTIN: ' + A_REAL_GSTIN), 'the claim cannot be made');
  assert.match(paper({ ...bill, title: 'TAX INVOICE' }), new RegExp('GSTIN: ' + A_REAL_GSTIN));
});

test('and it needs no setting switched on first', () => {
  /* The shop passes an empty branch - nothing configured, nothing turned on -
     and the customer's GSTIN still prints. */
  const bill = buildBillPayload({ ...A_MEAL, customer_gst_number: A_REAL_GSTIN }, {});
  assert.ok(bill.customer.includes('GSTIN: ' + A_REAL_GSTIN));
});

test('the company name goes above it, because the claim is the company', () => {
  /*
   * A GSTIN belongs to an entity and the name printed above it has to be that
   * entity. A customer record is very often the person who walked in, and
   * "Ramesh Kumar" over a company's GSTIN is a defective invoice.
   */
  const bill = buildBillPayload(
    {
      ...A_MEAL,
      customer_name: 'Ramesh Kumar',
      customer_company_name: 'Sri Ram Traders Pvt Ltd',
      customer_gst_number: A_REAL_GSTIN,
    },
    THE_SHOP
  );
  assert.deepStrictEqual(bill.customer, [
    'Ramesh Kumar',
    'Sri Ram Traders Pvt Ltd',
    'GSTIN: ' + A_REAL_GSTIN,
  ]);
});

test('a sole proprietor billing under their own name gets no empty company line', () => {
  const bill = buildBillPayload(
    { ...A_MEAL, customer_name: 'Ramesh Kumar', customer_gst_number: A_REAL_GSTIN },
    THE_SHOP
  );
  assert.deepStrictEqual(bill.customer, ['Ramesh Kumar', 'GSTIN: ' + A_REAL_GSTIN]);
});

test('it is normalised to upper case, because a GSTIN is upper case', () => {
  const bill = buildBillPayload(
    { ...A_MEAL, customer_gst_number: A_REAL_GSTIN.toLowerCase() },
    THE_SHOP
  );
  assert.ok(bill.customer.includes('GSTIN: ' + A_REAL_GSTIN));
});

/* ---------------------------------------------- and a bad one is not printed */

test('A MALFORMED GSTIN IS NOT PRINTED AT ALL', () => {
  /*
   * Worse than printing none. The customer files the invoice, claims against
   * it, and the claim fails months later - and by then the bill is the only
   * record and it looks right. The form validates on the way in; this is the
   * second gate, for a number that reached an old sale before the form checked
   * anything or arrived from a device that did not.
   */
  for (const bad of [
    '33AABCM', //               too short
    '33AABCM9561A1ZSX', //      too long
    'AA11BBBBB1111A1Z1', //     letters where the state code goes
    '33AABCM9561A1XS', //       no Z in the thirteenth place
    '000000000000000', //       a placeholder
    '  ', //                    whitespace
  ]) {
    const bill = buildBillPayload(
      { ...A_MEAL, customer_name: 'Ramesh Kumar', customer_gst_number: bad },
      THE_SHOP
    );
    assert.deepStrictEqual(bill.customer, ['Ramesh Kumar'], 'printed a GSTIN nobody can claim on: ' + bad);
  }
});

test('and a company name without a valid GSTIN prints nothing either', () => {
  /* The company line exists to name the holder of the GSTIN. With no GSTIN it
     is a second name under the first, which reads as a fault. */
  const bill = buildBillPayload(
    { ...A_MEAL, customer_name: 'Ramesh Kumar', customer_company_name: 'Sri Ram Traders' },
    THE_SHOP
  );
  assert.deepStrictEqual(bill.customer, ['Ramesh Kumar']);
});

test('a walk-in is still a walk-in', () => {
  /* The placeholder-phone rule and the walk-in rule both still hold: this
     added lines to customerLines and must not have disturbed them. */
  const bill = buildBillPayload(
    { ...A_MEAL, customer_name: 'Walk In', customer_phone: '+910000000000' },
    THE_SHOP
  );
  assert.deepStrictEqual(bill.customer, []);
});

/* ------------------------------------------------------ the chain behind it */

test('the sale carries the company name, so a reprint says what it said', () => {
  /*
   * Copied onto the SALE rather than read back off the customer. A bill
   * reprinted in March must say what it said in September, even if the company
   * has been renamed since - which is exactly the kind of difference an audit
   * finds.
   */
  const model = fs.readFileSync(path.join(ROOT, 'api', 'src', 'models', 'sale.model.js'), 'utf8');
  assert.match(model, /customer_company_name: \{/, 'the sale cannot hold it');

  const repo = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );
  assert.match(repo, /doc\.customer_company_name =/, 'nothing copies it onto the sale');
});

test('the customer can be given one, and the controller accepts it', () => {
  const customer = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'models', 'customer.model.js'),
    'utf8'
  );
  assert.match(customer, /company_name: \{/, 'the customer has nowhere to put it');

  const controller = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'customers.controller.js'),
    'utf8'
  );
  assert.match(controller, /company_name: req\.body\.company_name/, 'the save drops it');

  /* And the form has the field, beside the GSTIN it belongs to. */
  const modal = fs.readFileSync(path.join(ROOT, 'frontend', 'modals', 'customer.html'), 'utf8');
  const gstBlock = modal.slice(modal.indexOf('customer-gstr-number'));
  assert.ok(
    gstBlock.indexOf('customer_company_name') > -1 &&
      gstBlock.indexOf('customer_company_name') < gstBlock.indexOf('</div>\n                            </div>'),
    'the company name is not in the GST section'
  );
  assert.match(modal, /name="company_name"/, 'the field would not be posted');
});
