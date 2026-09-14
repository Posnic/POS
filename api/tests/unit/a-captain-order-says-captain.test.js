'use strict';

/*
 * A waiter's order is recorded as a waiter's order, and the bill says the rate.
 *
 * Both of these came off one photograph of two pieces of paper.
 *
 * THE CHANNEL. The kitchen ticket read "From: Customer phone" for an order the
 * owner had just placed on the captain handset himself. `createOnlineOrder` set
 * `channel: ONLINE` for everything that came through it, and two different
 * devices come through it: a customer's own phone on the shop's storefront, and
 * a waiter's handset.
 *
 * So the field was wrong for every tableside order for as long as it had
 * existed, and nothing showed it. Reports by channel were wrong in the same
 * way, quietly. It only became visible the day the source started printing on
 * the paper - which is the argument for printing it.
 *
 * The route already knows. /sales/qrOrder sits behind protectOrKioskKey, so a
 * signed-in user there is staff on a handset; the customer storefront posts to
 * /online-ordering/:storeId/orders and is anonymous. Read from the request,
 * never from the body: a body cannot be allowed to claim it is staff.
 *
 * THE RATE. Owner, holding ours beside the bill the shop printed before: "bill
 * i can see CGST and CSGT. but dont see percentage." The old paper read
 * `CGST :2.50 % 36.00`. A GST bill is expected to state the rate - it is the
 * number a customer checks and an accountant asks for.
 *
 * It has to be DERIVED. A sale line records tax as an amount and never recorded
 * a rate, so storing one now would put the percentage on new bills and leave
 * every reprint of an older sale without it.
 */

const { buildBillPayload } = require('../../src/helpers/bill-payload');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REPO = fs.readFileSync(path.join(ROOT, 'src', 'repositories', 'sale.repository.js'), 'utf8');
const CONTROLLER = fs.readFileSync(
  path.join(ROOT, 'src', 'controllers', 'sales.controller.js'),
  'utf8'
);
const SERVICE = fs.readFileSync(path.join(ROOT, 'src', 'services', 'sale.service.js'), 'utf8');

/* ------------------------------------------------------------- the channel */

test('the channel is decided by who placed it, not hardcoded', () => {
  expect(REPO).toMatch(
    /channel: staffOrder \? salesChannels\.CHANNEL\.TABLESIDE : salesChannels\.CHANNEL\.ONLINE/
  );
  /* The old line said ONLINE for everyone. If it comes back, so does the bug. */
  expect(REPO).not.toMatch(/channel: salesChannels\.CHANNEL\.ONLINE,\s*\n\s*fulfilment/);
});

test('staff is read from the request, never from the body', () => {
  /*
   * The body is written by the device being described. A customer's page that
   * could set this would be a customer's page that could file its orders as a
   * waiter's, which is a reporting hole and a free way to skip approval.
   */
  expect(CONTROLLER).toMatch(/staffOrder: Boolean\(req\.user\)/);
  expect(REPO).not.toMatch(/staffOrder = data\./);
  expect(REPO).not.toMatch(/data\.staffOrder/);
});

test('the flag is carried through the service untouched', () => {
  expect(SERVICE).toMatch(
    /createOnlineOrder: async \(data, \{ SaleModel, staffOrder = false \} = \{\}\)/
  );
  expect(SERVICE).toMatch(/staffOrder,/);
});

test('absent means customer, which is the safe direction', () => {
  /* An order whose origin we cannot establish is a customer's. Guessing the
     other way would file a stranger's order as a member of staff's. */
  expect(REPO).toMatch(/staffOrder = false \} = \{\}\) \{/);
});

/* ---------------------------------------------------------------- the rate */

const line = (base, tax) => ({
  item_name: 'Mutton Ghee Roast',
  item_quantity: 1,
  item_base_price: base,
  item_tax: tax,
  item_total: base + tax,
});

test('the bill states the rate, halved across CGST and SGST', () => {
  /* His actual bill: subtotal 660, CGST 16.50, SGST 16.50. That is 5%, which
     is 2.5 and 2.5 - exactly what the shop's old paper said. */
  const payload = buildBillPayload(
    {
      sales_id: 'SB1D14-000051',
      sales_total: 693,
      tax: 33,
      subtotal: 660,
      items: [line(330, 16.5), line(330, 16.5)],
    },
    { indian_gst: 'gst_on' }
  );
  expect(payload.taxes).toEqual([
    { label: 'CGST 2.5%', amount: 16.5 },
    { label: 'SGST 2.5%', amount: 16.5 },
  ]);
});

test('a rate is written the way a rate is written', () => {
  /* 2.5 rather than 2.50, and 9 rather than 9.00. */
  const at = (base, tax) =>
    buildBillPayload(
      { sales_id: 'x', tax: tax * 2, items: [line(base, tax)] },
      { indian_gst: 'gst_on' }
    ).taxes[0].label;
  expect(at(100, 18)).toBe('CGST 9%');
  expect(at(100, 12)).toBe('CGST 6%');
});

test('a mixed-rate bill says NO rate rather than an average', () => {
  /*
   * THE ONE THAT MATTERS ON A TAX DOCUMENT. Five percent and eighteen percent
   * together average to a number that was never charged on anything. The
   * amounts stay right; only the claim about the rate is withheld.
   */
  const payload = buildBillPayload(
    { sales_id: 'x', tax: 75.9, items: [line(330, 16.5), line(330, 59.4)] },
    { indian_gst: 'gst_on' }
  );
  expect(payload.taxes.map((t) => t.label)).toEqual(['CGST', 'SGST']);
  expect(payload.taxes[0].amount).toBeCloseTo(37.95, 2);
});

test('nonsense arithmetic prints no rate at all', () => {
  /* A line with no base to charge tax on, or a rate no regime charges. Both
     mean the sum found something that is not a rate. */
  for (const items of [[line(0, 16.5)], [line(10, 900)]]) {
    const labels = buildBillPayload(
      { sales_id: 'x', tax: 33, items },
      { indian_gst: 'gst_on' }
    ).taxes.map((t) => t.label);
    expect(labels).toEqual(['CGST', 'SGST']);
  }
});

test('a shop with no GST still gets one plain Tax row', () => {
  const payload = buildBillPayload(
    { sales_id: 'x', tax: 33, items: [line(330, 16.5)] },
    { indian_gst: 'disable' }
  );
  expect(payload.taxes).toEqual([{ label: 'Tax', amount: 33 }]);
});

test('no tax at all means no tax rows, not a row saying zero', () => {
  expect(
    buildBillPayload({ sales_id: 'x', tax: 0, items: [line(330, 0)] }, { indian_gst: 'gst_on' })
      .taxes
  ).toEqual([]);
});

test('a returned line is not counted when working out the rate', () => {
  /* It is not part of what this bill charges. */
  const payload = buildBillPayload(
    { sales_id: 'x', tax: 33, items: [line(330, 16.5), { ...line(10, 900), return: true }] },
    { indian_gst: 'gst_on' }
  );
  expect(payload.taxes[0].label).toBe('CGST 2.5%');
});

/* -------------------------------------------------- and the customer's line */

/*
 * A bill came back with `+910000000000` printed under the customer line, for a
 * walk-in who had never given a number. Owner: "+9100000 comes from where? if
 * cstomer is walking customer we show like this? not make sense. as per
 * international standard do that."
 *
 * The placeholder is sent by the device that needed the field filled in, and
 * stopping it there is worth doing separately - but a bill is a document
 * somebody keeps, and printing a number nobody can ring is worse than printing
 * nothing, because it looks like information.
 *
 * Judged the way E.164 judges one - 7 to 15 digits - rather than against an
 * Indian pattern. Refusing a real customer's number because it did not match a
 * shape we guessed at is the worse mistake, so the test is "could this be
 * dialled", not "is this Indian".
 */

const withPhone = (phone) =>
  buildBillPayload({ sales_id: 'x', customer_phone: phone, items: [] }, {}).customer;

test('a placeholder number is not printed', () => {
  expect(withPhone('+910000000000')).toEqual([]);
  expect(withPhone('0000000000')).toEqual([]);
  expect(withPhone('9999999999')).toEqual([]);
});

test('a real number still is, wherever the customer is from', () => {
  /* The failure mode of this fix is deleting real data quietly, so it is
     tested against a number that is not Indian as well as one that is. */
  expect(withPhone('+919688365318')).toEqual(['+919688365318']);
  expect(withPhone('9688365318')).toEqual(['9688365318']);
  expect(withPhone('+44 20 7946 0958')).toEqual(['+44 20 7946 0958']);
  expect(withPhone('+1 (415) 555-0132')).toEqual(['+1 (415) 555-0132']);
});

test('the repeated-digit test needs its backreference', () => {
  /*
   * Written once without it by accident, which reads as "any seven digits"
   * and refuses EVERY real number. It passed a casual glance and would have
   * silently dropped the phone number from every bill in the estate.
   *
   * Compared as plain text rather than with a regex, because a regex that
   * has to match a regex is exactly where the backslash went missing in the
   * first place.
   */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'helpers', 'bill-payload.js'), 'utf8');
  expect(src).toContain('/(\\d)\\1{7,}/');
  expect(src).not.toContain('/(\\d){7,}/');
});

test('too short or too long to dial is not printed', () => {
  expect(withPhone('123')).toEqual([]);
  expect(withPhone('1234567890123456')).toEqual([]);
});

test('a walk-in with nothing to show gets no customer line at all', () => {
  /* A blank line under the header reads as a bill that failed. */
  expect(withPhone('')).toEqual([]);
  expect(
    buildBillPayload({ sales_id: 'x', customer_name: 'Walk-in', items: [] }, {}).customer
  ).toEqual([]);
});
