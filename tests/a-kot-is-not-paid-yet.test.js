/*
 * A kitchen ticket is not a settled bill.
 *
 * Owner, describing the flow this is supposed to follow:
 *
 *   "First captain orders. it goes to print to kitchen also service department
 *    to notify one new order. once service complete reception will take bill
 *    print. even that time bill is not paid. after giving to customer customer
 *    pays with cash or preferred method in his table. after paid now user able
 *    to take the bill."
 *
 * Three things were wrong against that, and they shared one cause: the order
 * endpoint wrote the caller's PAYMENT METHOD into the payment STATUS field.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'src', 'repositories', 'sale.repository.js'),
  'utf8'
);

/** Just createOnlineOrder, which is what both order doors land in. */
const fn = (() => {
  const at = source.indexOf('async createOnlineOrder');
  const end = source.indexOf('\n  /**', at + 100);
  return source.slice(at, end);
})();

test('an order taken at a table is UNPAID', () => {
  /*
   * It was `data.payment_status || 'Paid'`. The captain app sends "cash" and
   * the QR page sends "Upi" - both methods - so every table order was stored
   * with a payment_status of "cash" or "Upi", and anything that did not send
   * one defaulted to settled. A bill could be closed before anybody had handed
   * over money.
   */
  assert.match(fn, /payment_status: paidUpFront \? 'Paid' : 'Unpaid'/, 'a KOT still defaults to paid');
  assert.ok(!/payment_status: data\.payment_status \|\| 'Paid'/.test(fn), 'the old default is back');
});

test('the method goes in the method field', () => {
  assert.match(fn, /payment_mode: paymentMethod/, 'the payment method is not recorded as one');
  assert.match(fn, /const paymentMethod =/, 'nothing separates the method from the status');
});

test('a genuinely prepaid order is still paid', () => {
  /* The separation must not cost the case it was always right for. */
  assert.match(
    fn,
    /said === 'paid' \|\| said === 'completed'/,
    'an explicitly paid order is no longer honoured'
  );
});

test('handsets already in the field keep working', () => {
  /*
   * The split happens HERE rather than at every caller, so a phone that has
   * not been updated - still sending "cash" in payment_status - lands as
   * Unpaid with Cash as the method, which is what it always meant.
   */
  assert.match(fn, /String\(data\.payment_status \|\| ''\)/, 'the old field is no longer read');
});

test('the table now appears on the handset home screen', () => {
  /*
   * THE BUG THIS EXPLAINS. getTablesWithActiveOrders filters on
   * payment_status 'Unpaid'. A captain order stored "cash", which is not that,
   * so a waiter took an order and the floor showed nothing at all - the screen
   * has never worked for a captain order since the feature shipped.
   */
  const service = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'src', 'services', 'sale.service.js'),
    'utf8'
  );
  const tables = service.slice(service.indexOf('const getTablesWithActiveOrders'));
  assert.match(tables, /payment_status: 'Unpaid'/, 'the floor query no longer looks for unpaid');
  /* And the writer now produces exactly that word. */
  assert.match(fn, /: 'Unpaid'/, 'the writer does not produce the word the reader looks for');
});

test('the receipt echoes what was written, not what was asked for', () => {
  /* The confirmation screen said "Paid" on an order nobody had paid for. */
  const echoed = fn.slice(fn.indexOf('deliver_to: deliverTo'));
  assert.match(echoed, /payment_status: paidUpFront \? 'Paid' : 'Unpaid'/, 'the receipt still claims paid');
});

test('the sales list counts the items that are on the sale', () => {
  /*
   * The list read 0 items on an order that opened to show two. The model sets
   * number_of_items in a PRE-SAVE HOOK, and this path inserts through the raw
   * driver - which runs no mongoose hooks - so the field was never written.
   */
  assert.match(fn, /number_of_items: numberOfItems/, 'the item count is not written');
  assert.match(
    fn,
    /saleItems\.reduce\(\(sum, line\) => sum \+ \(Number\(line\.quantity\) \|\| 0\), 0\)/,
    'the count is not the sum of the quantities'
  );
});

test('it counts the same way a counter sale does', () => {
  /* The hook sums quantities rather than counting lines, so a sale taken at a
     table and one taken at the counter read the same in the same column. */
  const model = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'models', 'sale.model.js'), 'utf8');
  assert.match(model, /itemCount \+= qty/, 'the model no longer sums quantities');
});
