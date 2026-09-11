'use strict';

/*
 * "Discount note" is an action, and an action that cannot apply yet reads as
 * one that is broken.
 *
 * The chip sat beside Payment note and Sale note from the moment the sale
 * screen loaded, so a cashier could write a note about a discount nobody had
 * given - and the note then described nothing. On a counter with a customer
 * waiting, a control that does nothing is worse than one that is absent.
 *
 * Pinned as source assertions rather than by driving the DOM, because this
 * screen needs the whole jQuery sale stack to come up. The checks below are
 * the ones that actually fail if the behaviour is reverted: the chip starting
 * hidden, and the sync running off the same signal the rowspan uses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/modules/sales_write.html'), 'utf8');
const sales = fs.readFileSync(
  path.join(root, 'frontend/static/script/js/modules/js/sales.js'), 'utf8');

test('the chip starts hidden, so it cannot be pressed before a discount exists', () => {
  const chip = html.match(/<a[^>]*id="click_discount_description"[^>]*>/);
  assert.ok(chip, 'the discount note chip is gone from the sale screen');
  assert.match(chip[0], /display:\s*none/,
    'the chip is visible on load again, offering a note for a discount nobody gave');
});

test('it follows the discount row, the same signal the layout already uses', () => {
  assert.match(sales, /syncDiscountNoteChip\s*=\s*function/,
    'nothing syncs the chip any more');
  /* Called from syncNotesCellSpan so every existing call site is covered
     rather than only the add-discount click. */
  const span = sales.match(/syncNotesCellSpan\s*=\s*function[\s\S]{0,400}?\n\};/);
  assert.ok(span, 'syncNotesCellSpan is gone');
  assert.match(span[0], /syncDiscountNoteChip/,
    'the chip no longer updates when the discount row does');
});

test('the wording says whether a note already exists', () => {
  /* "Add note" and "Edit note" are the difference between guessing what a
     button does and knowing. */
  assert.match(sales, /'Edit note'/, 'an existing note is not offered for editing');
  assert.match(sales, /'Add note'/, 'a blank note is not invited');
});

test('removing a discount is followed too, not only adding one', () => {
  /* Hiding on add but never on remove would leave the chip stranded after a
     discount is cleared - the original bug, one step later. */
  assert.match(sales, /remove-discount|sale_remove_discount/,
    'nothing re-syncs the chip when a discount is removed');
});

test('visibility is set inline, so the tooltip wrapper follows it', () => {
  /*
   * syncActionTooltips decides whether a tooltip wrapper should hide by
   * reading btn.style.display. A class-based hide leaves the wrapper - and its
   * tooltip - floating over a control that is not there, which is a bug this
   * screen has had before.
   */
  const fn = sales.match(/syncDiscountNoteChip\s*=\s*function[\s\S]{0,1200}?\n\};/);
  assert.ok(fn, 'syncDiscountNoteChip is gone');
  assert.match(fn[0], /style\.display/,
    'the chip is hidden by class, so its tooltip wrapper will not follow');
});
