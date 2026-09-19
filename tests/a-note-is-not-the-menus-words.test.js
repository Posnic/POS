'use strict';

/*
 * A NOTE IS THE WAITER'S WORDS, NEVER THE MENU'S.
 *
 * A cancellation ticket came off the owner's printer reading:
 *
 *   CHICKEN BIRYANI 1 HANDI                                   x1
 *   ** Chicken Biryani sold as 1 handi, configured for a INR
 *      Restaurant Demo Dataset POS demo. **
 *
 * Owner: "it supposed print only note right? that too in cancel shit?" and,
 * seeing the same text in the KOT cart, "who asked to add this line item info
 * in the desktop cart? why?"
 *
 * Nobody asked. Two client-side fallbacks reached for the dish's catalogue
 * description whenever a line had no note:
 *
 *   sales.js addItem   stored `params.description` in item_description, so
 *                      the blurb was SAVED on the sale and travelled to the
 *                      kitchen, the cart and the cancellation ticket
 *   kot.js             printed `it.description` when item_description was
 *                      empty, so it appeared even on lines that escaped the
 *                      first one
 *
 * A note on a ticket is an instruction and a cook assumes somebody asked for
 * it. The server was taught this on 2026-09-15 ("The kitchen reads less
 * spicy") and the till went on writing the blurb in, which is exactly why the
 * owner saw it again after it had been reported fixed. Both halves have to
 * agree or the paper shows the wrong one.
 *
 * These are structural assertions on the two lines that caused it, because
 * that is where the fallback can silently come back - a reviewer adding
 * `|| description` to "be helpful" reintroduces the whole bug.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the cart stores the note, and never the dish description', () => {
  const sales = read('frontend/static/script/js/modules/js/sales.js');

  const at = sales.indexOf("var item_description = '';");
  assert.ok(at > 0, 'addItem no longer prepares a line note; this test is reading nothing');
  /* The assignment block: up to the line that normalises it into plain text. */
  const block = sales.slice(at, sales.indexOf('Normalize any HTML description', at));

  assert.match(block, /params\.item_description/, 'the line note is not read at all');
  assert.ok(!/params\.description/.test(block),
    'a line with no note borrows the dish catalogue description again:\n' + block.trim());
});

test('the printed ticket reads the note field only', () => {
  const kot = read('frontend/static/script/js/core/kot-print.js');

  const line = kot.split('\n').find((l) => l.includes('var note ='));
  assert.ok(line, 'the ticket no longer renders a note; this test is reading nothing');

  assert.match(line, /item\.item_description/, 'the ticket does not read the note');
  assert.ok(!/item\.description|item\.item_desc\b/.test(line),
    'the ticket falls back to the catalogue description again: ' + line.trim());
});

test('what feeds the printed ticket carries the note, not the catalogue', () => {
  /*
   * THE FILE THE FIRST FIX MISSED. kot-manager builds the ticket payload out
   * of the sale's lines, and both builders read the sale's `description` - the
   * catalogue sentence - when a line had no note. That is what put
   *
   *   ** Chicken Biryani sold as 1 handi, configured for a INR ... **
   *
   * on the owner's cancellation ticket, and why fixing the cart and the HTML
   * ticket changed nothing on paper.
   *
   * NOTE ON escpos-kot.js, which is deliberately not swept below: the ticket
   * payload's own field is NAMED `description` and by then it already IS the
   * note, because this builder put it there. Reading it in the renderer is
   * correct, and "fixing" it broke two ticket tests - the payload shape is
   * documented at the top of that file.
   */
  const manager = read('src/kot-manager.js');
  const builders = manager
    .split('\n')
    .filter((l) => /description:\s*it\.|const desc = it\./.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.ok(builders.length >= 2, 'the ticket payload builders have moved; this test reads nothing');

  for (const line of builders) {
    assert.match(line, /it\.item_note/, 'a ticket payload does not prefer the waiter note: ' + line.trim());
    assert.ok(!/it\.description\b/.test(line),
      'a ticket payload still carries the catalogue sentence: ' + line.trim());
  }
});

test('NO path that reaches a cook reads the catalogue field', () => {
  /*
   * Swept, not spot-checked. This bug survived two fixes by living in several
   * places at once: the cart write, the HTML ticket, two ticket payloads in
   * kot-manager, the cart display, the cancellation's stored change record
   * and the kitchen screen card. Checking one file at a time is how the ones
   * that actually printed were missed.
   *
   * A ticket line, a screen card or a cart row may read `item_note` (what a
   * waiter typed) and `item_description` (the field a note has historically
   * travelled in). The catalogue's own `description` is not an instruction.
   *
   * escpos-kot.js is excluded on purpose - see the test above. Comment lines
   * are skipped so the explanations here do not trip it.
   */
  const files = [
    'src/kot-manager.js',
    'frontend/static/script/js/modules/js/kot.js',
    'frontend/static/script/js/modules/js/sales.js',
  ];
  const offenders = [];
  for (const file of files) {
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\b(it|item|line|ex|params)\.description\b/.test(line)) {
          offenders.push(file + ':' + (i + 1) + '  ' + line.trim());
        }
      });
  }
  assert.deepStrictEqual(offenders, [],
    "these put the menu's words where a cook reads them:\n  " + offenders.join('\n  '));
});

test('the cart display has no fallback of its own to fall into', () => {
  /*
   * The italic text beside each cart line reads item_description and nothing
   * else, which is correct - it was only ever showing what addItem had
   * already poisoned. Pinned so a fallback is not added here instead.
   */
  const kot = read('frontend/static/script/js/modules/js/kot.js');
  const line = kot.split('\n').find((l) => l.includes('var itemDesc'));
  assert.ok(line, 'the cart no longer shows a note; this test is reading nothing');
  assert.ok(!/item\.description|item\.item_desc\b/.test(line),
    'the cart line borrows the catalogue description: ' + line.trim());
});
