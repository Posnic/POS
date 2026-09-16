'use strict';

/*
 * FIVE HUNDRED RUPEES OF FISH IS A PARTICULAR FISH.
 *
 * Owner: "whenever market price or quick sale we want print the price in the
 * KOT... lets customer wants to have fish for rs500 so that kitchen will
 * prepare according to that."
 *
 * For a whole fish, a crab, or something a waiter invented at the table, THE
 * PRICE IS THE SPECIFICATION. The kitchen cannot pick the right fish from the
 * name alone.
 *
 * For an ordinary dish off the card it is noise. A cook does not choose a
 * biryani differently because it costs 220, and a ticket with money on every
 * line is one where the line that matters stops standing out. So it prints on
 * two kinds of line and no others.
 *
 * NOT IN THE NOTE, though the owner suggested there. The note is what a waiter
 * typed, and putting anything else in it is the bug that printed a marketing
 * paragraph to a kitchen this morning.
 */

const test = require('node:test');
const assert = require('node:assert');

const { renderKitchenTicket } = require('../src/escpos-kot');

/*
 * The ticket as bytes, with only the control characters removed.
 *
 * An earlier version also stripped runs of @ to E, meaning to drop the letters
 * ESC/POS uses as command parameters. It ate the double E in SEER and the test
 * failed on working code. Printer commands and printable text share an
 * alphabet: the honest thing is to search for the words rather than pretend
 * the commands can be cleanly removed.
 */
function printed(items) {
  const bytes = renderKitchenTicket({ title: 'New Order', number: 7, items });
  return Buffer.from(bytes)
    .toString('latin1')
    .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}

test('A MARKET-PRICED DISH CARRIES ITS PRICE to the kitchen', () => {
  const ticket = printed([
    { item_name: 'Seer Fish', item_quantity: 1, priced_at_table: 500 },
  ]);

  assert.match(ticket, /SEER FISH/);
  assert.match(ticket, /Rs 500/);
});

test('an ordinary dish does not, because there the price is noise', () => {
  const ticket = printed([{ item_name: 'Chicken Biryani', item_quantity: 2 }]);

  assert.match(ticket, /CHICKEN BIRYANI/);
  assert.ok(!/Rs [0-9]/.test(ticket), 'no money on a dish the card already prices');
});

test('both on one ticket, and only one of them shows money', () => {
  /* The whole point of marking lines rather than printing every price. */
  const ticket = printed([
    { item_name: 'Seer Fish', item_quantity: 1, priced_at_table: 500 },
    { item_name: 'Chicken Biryani', item_quantity: 2 },
  ]);

  assert.strictEqual((ticket.match(/Rs [0-9]/g) || []).length, 1);
});

test('paise are shown when there are any, and not when there are none', () => {
  /* "Rs 500.00" on a kitchen ticket is two characters of noise on every line
     that has them; 750.50 is a number somebody agreed and must be read back. */
  assert.match(printed([{ item_name: 'A', item_quantity: 1, priced_at_table: 500 }]), /Rs 500(?!\.)/);
  assert.match(
    printed([{ item_name: 'B', item_quantity: 1, priced_at_table: 750.5 }]),
    /Rs 750\.50/
  );
});

test('it is Rs, not the rupee sign', () => {
  /*
   * A kitchen printer that lacks the glyph prints a box or a random
   * character, and a wrong number on a ticket is worse than a plain one.
   */
  const ticket = printed([{ item_name: 'A', item_quantity: 1, priced_at_table: 500 }]);

  assert.ok(!ticket.includes('₹'), 'no unicode rupee on a thermal printer');
});

test('a nonsense price prints nothing rather than nonsense', () => {
  for (const bad of [0, -5, null, undefined, 'five hundred']) {
    const ticket = printed([{ item_name: 'A', item_quantity: 1, priced_at_table: bad }]);
    assert.ok(!/Rs [0-9]/.test(ticket), `${String(bad)} should print no price line`);
  }
});

test('the price comes before the note, not inside it', () => {
  /*
   * The note is what a waiter typed. This morning's bug was a menu
   * description printed as a note; folding a price in there would be the same
   * mistake with a different field.
   */
  const ticket = printed([
    {
      item_name: 'Seer Fish',
      item_quantity: 1,
      priced_at_table: 500,
      item_description: 'Fry it dry',
    },
  ]);

  assert.ok(ticket.indexOf('Rs 500') < ticket.indexOf('Fry it dry'), 'price first');
  assert.match(ticket, /\*\* Fry it dry \*\*/);
  assert.ok(!/\*\*.*500.*\*\*/.test(ticket), 'the price is not in the note');
});

/*
 * HOW MANY PLATES ARE ON THE TICKET.
 *
 * Owner: "KOT total items also print and voice read please."
 *
 * A cook counts what they have plated against what the ticket asked for, and a
 * long ticket is exactly where one line gets missed. The number at the foot is
 * what makes that check possible without re-reading every line.
 */

test('THE TICKET FOOTS THE PLATE COUNT', () => {
  const ticket = printed([
    { item_name: 'Chicken Biryani', item_quantity: 1 },
    { item_name: 'Butter Naan', item_quantity: 2 },
  ]);

  assert.match(ticket, /TOTAL ITEMS/);
  assert.match(ticket, /TOTAL ITEMS\s+3/);
});

test('plates, not lines, so it matches what the voice says', () => {
  /* One biryani and two naan is three things to cook and two lines above. The
     speaker counts it the same way - see src/kitchen-call.js. */
  const ticket = printed([
    { item_name: 'A', item_quantity: 4 },
    { item_name: 'B', item_quantity: 1 },
  ]);

  assert.match(ticket, /TOTAL ITEMS\s+5/);
});

test('a ticket with nothing on it foots nothing', () => {
  const ticket = printed([]);

  assert.ok(!/TOTAL ITEMS/.test(ticket));
});
