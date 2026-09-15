'use strict';

/*
 * "Two chillies" reaches the kitchen, by the road "less spicy" already took.
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy. we can add those into kitchen note."
 *
 * THE ROAD IS THE POINT, and the-kitchen-reads-less-spicy.test.js is beside
 * this file because it paid for the map. The kitchen ticket is NOT printed
 * from `sale.items`: the poller builds its print jobs out of `changes[].items`,
 * the record of what changed. The note was stored perfectly on the sale, both
 * ticket builders printed it, and it still never reached paper - because three
 * separate places build that change list and all three left it out.
 *
 * A spice level stored on the sale and absent from the change record would be
 * the same bug, shipped again, in the same week the last one was fixed. So
 * this asserts the RULE rather than one spelling: every change list that
 * carries the customer's note carries the level beside it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REPO = fs.readFileSync(path.join(ROOT, 'src', 'repositories', 'sale.repository.js'), 'utf8');

/**
 * Every object literal in the repository that carries the customer's note.
 *
 * Found by the note rather than by function name: the note is on the sale
 * line, on three change lists and on the map a removed line is rebuilt from,
 * and those are exactly the places a level has to travel too. Anchored this
 * way, a fourth one added tomorrow is caught the day it appears.
 */
function placesCarryingTheNote() {
  const out = [];
  const re = /(item_description|description):\s*String\(/g;
  let m;
  while ((m = re.exec(REPO))) {
    /*
     * The literal this line sits in: back to its opening brace, forward to
     * the matching close. Counted rather than regexed, because these objects
     * hold nested ternaries and template strings.
     *
     * And out again while the literal is a ONE-LINE fragment. Two of these
     * sites are conditional spreads - `...(x != null ? { item_description: …
     * } : {})` - whose own braces enclose nothing but the note; the level
     * sits beside them in the object those spreads build, which is the object
     * this test means by "place".
     */
    let open = m.index;
    let close;
    do {
      open = REPO.lastIndexOf('{', open - 1);
      let depth = 0;
      close = open;
      while (close < REPO.length) {
        if (REPO[close] === '{') depth += 1;
        else if (REPO[close] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        close += 1;
      }
    } while (open > 0 && !REPO.slice(open, close).includes('\n'));
    out.push({ at: m.index, body: REPO.slice(open, close + 1) });
  }
  return out;
}

test('every place that carries the note carries the level too', () => {
  /*
   * The whole test. A level that stops at any one of these is a level the
   * kitchen never sees, and nothing anywhere fails: the order goes through,
   * the ticket prints, and the food comes out wrong.
   */
  const places = placesCarryingTheNote();
  expect(places.length).toBeGreaterThanOrEqual(5);

  const without = places.filter((p) => !/spice_level:/.test(p.body));
  expect(without.map((p) => REPO.slice(p.at, p.at + 60))).toEqual([]);
});

test('an amendment prefers the level just chosen over the stored one', () => {
  /*
   * Same rule as the note, for the same reason: the request carries what the
   * person has only now said and the stored copy is what they said before.
   * Reading the stored one first would quietly ignore a change of mind.
   *
   * Read through existingIndex rather than oldItemsData, because that map has
   * had this id deleted from it a few lines above - which is the sort of thing
   * that only shows up when somebody actually changes an order.
   */
  expect(REPO).toMatch(/item\.spice_level != null\s*\?\s*item\.spice_level/);
  expect(REPO).toMatch(/updatedItems\[existingIndex\[productId\]\] \|\| \{\}\)\.spice_level/);
});

test('every level is cleaned on the way in, never trusted', () => {
  /*
   * This arrives as JSON from a customer's own phone over the open internet.
   * levelOf refuses anything that is not 1, 2 or 3 - a stray true included,
   * because Number(true) is 1 and would have printed MILD on real paper.
   */
  const raw = REPO.match(/spice_level:\s*([^\n]*)/g) || [];
  expect(raw.length).toBeGreaterThanOrEqual(6);
  for (const line of raw) {
    expect(line).toMatch(/spiceLevel\.levelOf\(/);
  }
  expect(REPO).toMatch(/require\('\.\.\/utils\/spice-level'\)/);
});

test('the shop sees how hot before it decides whether to accept', () => {
  /*
   * The approval queue is where an order is REFUSED, and "we cannot make that
   * one mild" is a reason to refuse it. A request visible only on the paper in
   * the kitchen reaches the person who has to cook it and not the person who
   * has to agree to it.
   */
  expect(REPO).toMatch(/spice: spiceLevel\.levelOf\(item\.spice_level\)/);
});

test('the customer can see it back on their own order', () => {
  /* Somebody who asked for mild and is waiting should be able to check that
     the restaurant heard them, without ringing the counter. */
  expect(REPO).toMatch(/spice: spiceLevel\.levelOf\(line\.spice_level\)/);
});

test('the reason is written where the next person will look', () => {
  /*
   * The note bug was invisible because every layer worked and the ticket was
   * still wrong. Whoever adds the next per-line field deserves to be told, in
   * the file, that the ticket is printed from the CHANGE record.
   */
  expect(REPO).toMatch(/THE NOTE TRAVELS WITH THE ITEM/);
  expect(REPO).toMatch(/never reaches the paper/);
});
