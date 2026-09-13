/*
 * A CANCELLED DISH, STRUCK THROUGH, ON PAPER.
 *
 * Owner sent a picture of struck-out text: "text should be like. i am ok with
 * any workaround."
 *
 * ESC/POS has no strikethrough. There is no bit for it in ESC ! and no command
 * that draws one, so it is made: print the line, return the head to the start
 * of the SAME line with a bare carriage return, and print hyphens over the
 * name. The hyphen sits on the middle of the character cell, so a rule comes
 * out through the words.
 *
 * CR WITHOUT LF is the trick and the risk. A printer that treats CR as a new
 * line prints the hyphens underneath instead of through - which still reads as
 * struck out, so the bad case is legible rather than wrong. That is the whole
 * reason this approach was chosen over a bitmap: it degrades into something a
 * person can still act on.
 *
 * The lines themselves were already being recorded and were never read.
 * `updateOrder` writes every removed line into `changes` as `process: cancel`,
 * with its name, quantity and price.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { renderSale, Receipt } = require(path.join(__dirname, '..', 'src', 'escpos-receipt'));
const {
  buildBillPayload,
} = require(path.join(__dirname, '..', 'api', 'src', 'helpers', 'bill-payload'));

const CR = 0x0d;
const LF = 0x0a;

/** The bytes as text, with the control codes left visible. */
const seen = (bytes) => Buffer.from(bytes).toString('latin1');

/* ------------------------------------------------------- the renderer */

test('a struck row prints the line, a carriage return, then hyphens', () => {
  const out = seen(
    renderSale(
      {
        items: [
          { name: 'Chicken Biryani', qty: '2', amount: 440 },
          { name: 'Coffee', qty: '1', amount: 40, cancelled: true },
        ],
        total: 440,
      },
      { paperWidth: '48' }
    )
  );

  const at = out.indexOf('Coffee');
  assert.notStrictEqual(at, -1, 'the cancelled dish is not on the paper at all');

  const row = out.slice(at, out.indexOf(String.fromCharCode(LF), at) + 1);
  assert.ok(row.includes(String.fromCharCode(CR)), 'no carriage return, so nothing overprints');
  assert.match(row, /------/, 'no hyphens to draw the rule with');
});

test('the rule stops where the name stops', () => {
  /*
   * The numbers beside it have to print clean. A rule through the amount
   * reads as an alteration to the price rather than as a dish taken off, and
   * somebody checking a bill has to be able to read what they are charged.
   */
  const out = seen(
    renderSale(
      { items: [{ name: 'Coffee', qty: '1', amount: 40, cancelled: true }], total: 0 },
      { paperWidth: '48' }
    )
  );

  const at = out.indexOf('Coffee');
  const row = out.slice(at, out.indexOf(String.fromCharCode(LF), at));
  const dashes = row.slice(row.indexOf(String.fromCharCode(CR)) + 1);
  assert.equal(dashes.length, 'Coffee'.length,
    `the rule is ${dashes.length} long for a 6 character name`);
});

test('a live dish is not struck', () => {
  const out = seen(
    renderSale(
      { items: [{ name: 'Chicken Biryani', qty: '2', amount: 440 }], total: 440 },
      { paperWidth: '48' }
    )
  );
  const at = out.indexOf('Chicken Biryani');
  const row = out.slice(at, out.indexOf(String.fromCharCode(LF), at));
  assert.ok(!row.includes(String.fromCharCode(CR)), 'an ordinary dish was struck through');
});

test('strikeLine leaves an empty line alone', () => {
  /* A blank line with a carriage return and no characters would send the head
     back for nothing and, on some printers, eat the line. */
  const r = new Receipt({ width: 32 });
  const out = seen(r.strikeLine('   ').build());
  assert.ok(!out.includes(String.fromCharCode(CR)));
});

/* --------------------------------------------------- the lines themselves */

test('a cancelled line reaches the bill from the sale it was recorded on', () => {
  /*
   * updateOrder has always written this and nothing ever read it, so a guest
   * asking "you took the biryani off, didn't you?" had a bill that did not
   * mention it.
   */
  const payload = buildBillPayload({
    items: [{ name: 'Coffee', quantity: 1, unit_price: 40, total: 40 }],
    changes: [
      {
        timestamp: new Date(),
        items: [
          { item_name: 'Chicken Biryani', item_quantity: 2, price: 220, total: 440, process: 'cancel' },
        ],
      },
    ],
    sales_total: 40,
  });

  const names = payload.items.map((i) => i.name);
  assert.deepEqual(names, ['Coffee', 'Chicken Biryani'], 'the cancelled dish is missing');

  const struck = payload.items.find((i) => i.name === 'Chicken Biryani');
  assert.equal(struck.cancelled, true, 'it is on the bill but not marked as cancelled');
});

test('a cancelled line is worth nothing on the paper', () => {
  /*
   * It is there to be seen, not paid for. Printing what it would have cost
   * would make the column stop adding up against the total.
   */
  const payload = buildBillPayload({
    items: [],
    changes: [
      { items: [{ item_name: 'Coffee', item_quantity: 1, price: 40, total: 40, process: 'cancel' }] },
    ],
    sales_total: 0,
  });

  assert.equal(payload.items[0].amount, 0);
});

test('an added line in the change log is not printed as cancelled', () => {
  /* `changes` records additions too, with process: add. Striking those would
     put a rule through half the bill. */
  const payload = buildBillPayload({
    items: [{ name: 'Coffee', quantity: 1, unit_price: 40, total: 40 }],
    changes: [
      { items: [{ item_name: 'Coffee', item_quantity: 1, price: 40, total: 40, process: 'add' }] },
    ],
    sales_total: 40,
  });

  assert.equal(payload.items.length, 1, 'an addition was printed as a cancellation');
});

test('the same dish cancelled twice is one line', () => {
  /* Added and cancelled twice in a sitting leaves two identical entries, and
     one line is the honest picture of one dish that is not coming. */
  const one = { item_name: 'Coffee', item_quantity: 1, price: 40, total: 40, process: 'cancel' };
  const payload = buildBillPayload({
    items: [],
    changes: [{ items: [one] }, { items: [one] }],
    sales_total: 0,
  });

  assert.equal(payload.items.length, 1);
});

test('a sale with no changes prints exactly what it always did', () => {
  /* The overwhelmingly common bill. Nothing about this may move. */
  const payload = buildBillPayload({
    items: [{ name: 'Coffee', quantity: 1, unit_price: 40, total: 40 }],
    sales_total: 40,
  });

  assert.equal(payload.items.length, 1);
  assert.ok(!payload.items[0].cancelled);
});

test('end to end: the cancelled dish is on the paper with a rule through it', () => {
  const payload = buildBillPayload({
    items: [{ name: 'Coffee', quantity: 1, unit_price: 40, total: 40 }],
    changes: [
      { items: [{ item_name: 'Chicken Biryani', item_quantity: 2, price: 220, process: 'cancel' }] },
    ],
    sales_total: 40,
  });

  const out = seen(renderSale(payload, { paperWidth: '48' }));
  const at = out.indexOf('Chicken Biryani');
  assert.notStrictEqual(at, -1, 'the cancelled dish never reached the paper');

  const row = out.slice(at, out.indexOf(String.fromCharCode(LF), at));
  assert.ok(row.includes(String.fromCharCode(CR)), 'it printed without a rule through it');
});
