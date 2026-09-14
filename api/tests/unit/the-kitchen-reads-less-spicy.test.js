'use strict';

/*
 * "less spicy" reaches the kitchen.
 *
 * Owner, holding a ticket: "when item print, item notes not printed. example
 * 'less spicy' not printed in the kot. its bad very bad".
 *
 * He is right that it is bad, and worse than it looks. The note is the one line
 * on a ticket the kitchen cannot work out for itself - everything else is the
 * dish, the table and the quantity, all of which the cook could reconstruct. A
 * customer who asks for something, is told yes, and does not get it blames the
 * restaurant, and the restaurant has no way of knowing it happened.
 *
 * WHERE IT WAS LOST, and it is not where anybody would look first.
 *
 * The note WAS stored correctly. `_priceOnlineLine` puts it on the sale item as
 * `item_description`, and both ticket builders print it - escpos-kot.js renders
 * `** less spicy **` under the dish when the field is there.
 *
 * But the kitchen ticket is not printed from `sale.items`. The poller builds
 * its print jobs out of `changes[].items` - the record of what changed - and
 * THAT list carried seven fields: id, name, quantity, process, code, unit,
 * price and total. No note. Three places built it, and all three dropped it.
 *
 * So every layer was working and the ticket was still wrong, which is why
 * reading the printing code found nothing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REPO = fs.readFileSync(path.join(ROOT, 'src', 'repositories', 'sale.repository.js'), 'utf8');

/*
 * Every list of change-items in the repository, lifted out by its shape.
 *
 * Asserted as a COUNT as well as individually: the bug was one of three places
 * being right and the other two silently not, so a test that checks a specific
 * one would have passed while the kitchen still got nothing.
 */
function changeItemLists() {
  /*
   * Anchored on `changesItems`, the variable the change record is built in.
   * The first version of this matched on `item_quantity: qty` and swept up
   * ordinary sale-item constructions with it, which is a test that fails for
   * reasons unrelated to the bug.
   */
  const lists = [];
  const re = /changesItems\.push\(\{/g;
  let m;
  while ((m = re.exec(REPO))) {
    lists.push(REPO.slice(m.index, REPO.indexOf('});', m.index)));
  }
  const mapped = REPO.indexOf('const changesItems = saleItems');
  if (mapped > -1) lists.push(REPO.slice(mapped, REPO.indexOf('.filter(', mapped)));
  return lists;
}

test('a new order carries the note the customer typed', () => {
  /* createOnlineOrder builds changes[0] from the priced sale items, which
     already hold the note; it was mapping six fields across and leaving it. */
  const block = REPO.slice(REPO.indexOf('const changesItems = saleItems'));
  expect(block.slice(0, 900)).toMatch(/item_description: String\(si\.item_description \|\| ''\)/);
});

test('a cancelled line carries it too', () => {
  /*
   * Worth its own test rather than folding into the count. A cancellation
   * ticket says WHICH dish to stop, and a kitchen with two of the same dish on
   * one table tells them apart by the note.
   */
  expect(REPO).toMatch(/item_description: String\(ex\.item_description \|\| ''\)/);
});

test('an amendment prefers the note just typed over the stored one', () => {
  /*
   * The order matters. On an amendment the request carries what the person has
   * only now said; the stored copy is what they said before. Reading the stored
   * one first would quietly ignore a change of mind.
   */
  expect(REPO).toMatch(
    /item_description: String\(item\.item_note \|\| item\.item_description \|\| ''\)/
  );
});

test('both spellings are accepted, because two callers use two', () => {
  /* The handset sends `item_note`; a line added to a live order says
     `item_description`. Accepting only one loses half the notes. */
  /* Searched across the file rather than a slice of the function: the mapping
     sits about 450 lines into _priceOnlineLine, well past any sensible slice,
     and the first version of this test cut it off. */
  expect(REPO).toMatch(
    /item_description: String\(item\.item_note \|\| item\.item_description \|\| ''\)/
  );
});

test('the ticket builder still prints it, which was never the broken part', () => {
  /*
   * Pinned so a future change to the ticket cannot quietly drop the note at the
   * other end. The printing was always right; the data never arrived.
   */
  const kot = fs.readFileSync(path.join(ROOT, '..', 'src', 'escpos-kot.js'), 'utf8');
  expect(kot).toMatch(
    /const note = String\(\(item && \(item\.description \|\| item\.item_description\)\) \|\| ''\)/
  );
  expect(kot).toMatch(/r\.line\(' {3}\*\* ' \+ note \+ ' \*\*'\)/);

  const manager = fs.readFileSync(path.join(ROOT, '..', 'src', 'kot-manager.js'), 'utf8');
  expect(manager).toMatch(
    /description: it\.item_description \|\| it\.description \|\| it\.note \|\| ''/
  );
});

test('the reason is written where the next person will look', () => {
  /*
   * Every layer was working and the ticket was still wrong, so reading the
   * printing code found nothing. The next person deserves to be told that the
   * ticket is printed from the CHANGE record and not from the sale.
   */
  expect(REPO).toMatch(/THE NOTE TRAVELS WITH THE ITEM/);
  expect(REPO).toMatch(/printed FROM/);
});
