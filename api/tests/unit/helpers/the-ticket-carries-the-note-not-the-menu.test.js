'use strict';

/*
 * THE NOTE IS THE WAITER'S, NEVER THE MENU'S.
 *
 * Owner, looking at a live ticket on the handset: "i see active kot i see some
 * descirption details inside the line items. actually we need to show only
 * item name if any customization note delibertly captain entered. otherwise
 * dont show any other details. dont confuse captain."
 *
 * This is the third place the same leak has been found. The dish's marketing
 * copy - "slow cooked overnight with 21 spices" - was reaching the printed
 * kitchen ticket, then the handset's live ticket, because several code paths
 * treated a line with no note as a line that ought to borrow one.
 *
 * It is worth being blunt about why that is a real fault rather than clutter.
 * A note on a kitchen ticket is an INSTRUCTION. A cook reading one assumes
 * somebody at the table asked for it. Menu copy in that position is an
 * instruction nobody gave, in a place where the only sane response is to obey
 * it, and it buries the one line that somebody did ask for.
 *
 * A blank note means nothing was asked for. Blank is the honest answer.
 */

const { formatSaleListEntry } = require('../../../src/helpers/sales.helper');

const ticket = (item) => formatSaleListEntry({ _id: 'x', items: [item] }).items[0];

describe('a kitchen ticket line', () => {
  it('KEEPS A NOTE THE WAITER ACTUALLY TYPED', () => {
    expect(
      ticket({
        item_name: 'Chicken Biryani',
        item_quantity: 1,
        item_description: 'no raita, extra onion',
      }).item_description
    ).toBe('no raita, extra onion');
  });

  it('IS BLANK WHEN NOBODY ASKED FOR ANYTHING', () => {
    expect(ticket({ item_name: 'Chicken Biryani', item_quantity: 1 }).item_description).toBe('');
  });

  it('NEVER BORROWS THE MENU DESCRIPTION', () => {
    /*
     * The shape that caused it: something catalogue-shaped passing through a
     * mapper that fell back to `description`. A sale line has no `description`
     * field - the schema has never had one - so this fallback could only ever
     * pick up menu copy.
     */
    const line = ticket({
      item_name: 'Chicken Biryani',
      item_quantity: 1,
      description: 'Slow cooked overnight with 21 spices and saffron',
    });

    expect(line.item_description).toBe('');
    expect(line.item_name).toBe('Chicken Biryani');
  });

  it('and does not borrow it to fill in behind an empty note', () => {
    const line = ticket({
      item_name: 'Gobi (65)',
      item_quantity: 2,
      item_description: '',
      description: 'A Chennai classic, crisp and fiery',
    });

    expect(line.item_description).toBe('');
  });

  it('still says which dish it is', () => {
    /* Removing the fallback must not take the name with it: the name has
       genuine aliases, because the same value really does arrive under
       several keys. The note does not. */
    expect(ticket({ name: 'Butter Naan', item_quantity: 2 }).item_name).toBe('Butter Naan');
    expect(ticket({ itemName: 'Butter Naan', item_quantity: 2 }).item_name).toBe('Butter Naan');
  });
});
