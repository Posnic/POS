'use strict';

/*
 * THE SHOP'S OWN WORDS, AT THE BOTTOM OF ITS OWN BILL.
 *
 * `footer_print` is a box on the printing settings screen. A restaurant had
 * "Thanking You / Visit Again" saved in it, and every bill it handed a guest
 * said "Thank you, please visit again" instead - the generic line the renderer
 * falls back to.
 *
 * Nothing had failed. `escpos-receipt` reads `sale.footer` and has done all
 * along. `bill-payload` never set it. The word "footer" did not appear in that
 * file at all. A setting written, stored, offered on a screen, and read by
 * nobody.
 *
 * That is the fourth of this shape found in a day, which is why the last test
 * here checks the OTHER fields the renderer reads - so the next one is found
 * by a test rather than by a shop.
 */

const { buildBillPayload } = require('../../src/helpers/bill-payload');

const bill = (branch) => buildBillPayload({ items: [] }, branch);

describe('the footer a shop typed', () => {
  test('REACHES THE BILL', () => {
    expect(bill({ footer_print: 'Thanking You / Visit Again' }).footer).toBe(
      'Thanking You / Visit Again'
    );
  });

  test('and a shop that typed nothing gets nothing, not a blank line', () => {
    expect(bill({}).footer).toBe('');
    expect(bill({ footer_print: '' }).footer).toBe('');
    expect(bill({ footer_print: '   ' }).footer).toBe('');
    expect(bill(undefined).footer).toBe('');
  });

  test('keeps the shop’s own line breaks, however its browser wrote them', () => {
    /* A textarea on Windows sends CRLF. Splitting on the newline and trimming
       each line handles both without caring which arrived. */
    const crlf = 'Line one\r\nLine two';
    expect(bill({ footer_print: crlf }).footer).toBe('Line one\nLine two');
    expect(bill({ footer_print: 'Line one\nLine two' }).footer).toBe('Line one\nLine two');
  });

  test('drops the empty lines somebody left behind', () => {
    expect(bill({ footer_print: 'Top\n\n\nBottom' }).footer).toBe('Top\nBottom');
  });

  test('A PASTE ACCIDENT COSTS A LINE, NOT A ROLL OF PAPER', () => {
    /* Free text on a document a customer keeps, printed on a roll that does
       not stop. Four lines of sixty-four characters is a footer; nine hundred
       is a fault. */
    const huge = ('x'.repeat(200) + '\n').repeat(9);
    const out = bill({ footer_print: huge }).footer;
    const lines = out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(64);
  });

  test('and it is a string whatever the database holds', () => {
    for (const value of [null, 0, 42, true, ['a'], { a: 1 }]) {
      expect(typeof bill({ footer_print: value }).footer).toBe('string');
    }
  });
});

describe('what else the renderer reads and nobody sets', () => {
  test('every field escpos-receipt reads off the sale is one the payload provides', () => {
    /*
     * This is the test that would have caught the footer. It reads the
     * renderer for `sale.<field>` and asks the payload for each one, because
     * the gap between those two files is where this keeps happening.
     *
     * A field listed here and absent from the payload is not necessarily a
     * bug - the desktop bill manager composes some of it - so the known ones
     * are named rather than the check being dropped.
     */
    const fs = require('fs');
    const path = require('path');
    const renderer = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'escpos-receipt.js'),
      'utf8'
    );

    const read = new Set(
      [...renderer.matchAll(/sale\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1])
    );

    /* Composed by src/bill-manager.js rather than by the payload, or set per
       print job rather than per sale. */
    const COMPOSED_ELSEWHERE = new Set([
      'shopName',
      'address',
      'phone',
      'email',
      'gstin',
      'logo',
      'showThanks',
      'openDrawer',
      'copies',
      'paperWidth',
      'kot',
      'notes',
      'header',
    ]);

    /*
     * READ BY THE RENDERER AND FED BY NOTHING, today. Listed rather than
     * quietly allowed, because that is the difference between a known gap and
     * the footer - which was exactly this and went unnoticed for months.
     *
     * Two of them are honestly conditional: this document is a BILL, nobody
     * has paid, so `payments` and `change` have nothing to say. The other four
     * are branches waiting for a caller. Shrink this list, never grow it.
     */
    const KNOWN_UNFED = new Set([
      'cashier',
      'branch',
      'payments',
      'change',
      'itemCount',
      'totalWeight',
    ]);

    const payload = bill({ footer_print: 'x' });
    const missing = [...read].filter(
      (field) => !COMPOSED_ELSEWHERE.has(field) && !KNOWN_UNFED.has(field) && !(field in payload)
    );

    expect(missing).toEqual([]);
  });
});

describe('and which money the numbers are in', () => {
  /*
   * The till learned to print the symbol by reading it back off the rendered
   * receipt. A queued bill has no rendered receipt to read, so it comes from
   * the branch - and without it the two doors onto the same printer disagree
   * about the same sale: the counter receipt says one thing and the bill the
   * waiter carries to the table says another.
   *
   * Caught by the field test above rather than by a customer, which is what
   * that test is for.
   */
  test('REACHES THE BILL', () => {
    expect(bill({ currency: '€' }).currency).toBe('€');
  });

  test('and a shop that has not set one prints bare numbers, as it always has', () => {
    expect(bill({}).currency).toBe('');
    expect(bill({ currency: null }).currency).toBe('');
  });

  test('and it is a short string whatever the database holds', () => {
    /* A symbol, not a sentence: it is prefixed to every amount on a
       48-character line, and something long would eat the item column. */
    expect(bill({ currency: 12 }).currency).toBe('12');
    expect(bill({ currency: '   Rs.   ' }).currency).toBe('Rs.');
    expect(bill({ currency: 'x'.repeat(50) }).currency).toHaveLength(4);
  });
});
