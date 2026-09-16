'use strict';

/*
 * THE EXTRAS ARE CHARGED FOR, AT THE SHOP'S PRICE.
 *
 * A waiter could not offer extra cheese, so they typed it into the notes box.
 * The kitchen made it, the bill said nothing, and the shop gave it away.
 *
 * Fixing that on the handset alone would not have worked, and would have
 * looked like it had. This path prices every ordinary line from the shop's own
 * catalogue and throws away whatever price a client sends:
 *
 *     const sellingPrice = partnerVenues.priceFor(dynamic ? asked : catalogue, ...)
 *
 * So a phone that added the cheese into its line price would have watched the
 * till quietly replace it with the plain price - the same failure as before,
 * with more code. The till has to do the arithmetic.
 *
 * Which is the right answer anyway: a client that could name the price of
 * cheese could also name a discount nobody agreed to.
 */

const mongoose = require('mongoose');

const repo = require('../../../src/repositories/sale.repository');

const ITEM = new mongoose.Types.ObjectId();
const EXTRAS_GROUP = new mongoose.Types.ObjectId();
const SPICE_GROUP = new mongoose.Types.ObjectId();
const LICENSE = new mongoose.Types.ObjectId();

const GROUPS = [
  {
    _id: EXTRAS_GROUP,
    license: LICENSE,
    name: 'Extras',
    min: 0,
    max: 2,
    options: [
      { name: 'Extra cheese', price_delta: 20 },
      { name: 'Extra butter', price_delta: 15 },
      { name: 'Extra paneer', price_delta: 40 },
    ],
  },
  {
    _id: SPICE_GROUP,
    license: LICENSE,
    name: 'How spicy',
    min: 1,
    max: 1,
    options: [
      { name: 'Medium', price_delta: 0 },
      { name: 'Extra spicy', price_delta: 5 },
    ],
  },
];

const DISH = {
  _id: ITEM,
  name: 'Paneer Butter Masala',
  selling_price: 220,
  modifier_group_ids: [EXTRAS_GROUP, SPICE_GROUP],
};

const BRANCH = { license: LICENSE };

/** Ask the till what a set of picks costs on this dish. */
function priceFor(chosen, dish = DISH, docs = GROUPS) {
  repo.getCollection = jest.fn().mockResolvedValue({
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) }),
  });
  return repo._priceModifiers(chosen, dish, BRANCH);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('what the extras cost', () => {
  test('THE SHOP DECIDES, not the phone', async () => {
    /*
     * The heart of it. The client sends a name; the money comes from the
     * shop's own document, whatever the client claims it costs.
     */
    const out = await priceFor([{ group: 'Extras', name: 'Extra cheese', price_delta: -500 }]);

    expect(out.status).toBe(true);
    expect(out.delta).toBe(20);
    expect(out.lines).toEqual([{ group: 'Extras', name: 'Extra cheese', price_delta: 20 }]);
  });

  test('two extras add up', async () => {
    const out = await priceFor([
      { group: 'Extras', name: 'Extra cheese' },
      { group: 'Extras', name: 'Extra butter' },
    ]);

    expect(out.delta).toBe(35);
  });

  test('an option the shop does not offer is refused, by name', async () => {
    /*
     * A phone asking for it is holding a stale menu or asking for something
     * the kitchen will not make. Both are worth stopping before a ticket
     * prints, and the refusal says which dish and which option so somebody
     * can act on it.
     */
    const out = await priceFor([{ group: 'Extras', name: 'Truffle shavings' }]);

    expect(out.status).toBe(false);
    expect(out.message).toContain('Truffle shavings');
    expect(out.message).toContain('Paneer Butter Masala');
  });

  test('a dish that carries no option sets refuses them too', async () => {
    const plain = { ...DISH, modifier_group_ids: [] };
    const out = await priceFor([{ name: 'Extra cheese' }], plain);

    expect(out.status).toBe(false);
  });

  test('a group named wrongly still finds the option, because the price is ours either way', async () => {
    const out = await priceFor([{ group: 'Nonsense', name: 'Extra cheese' }]);

    expect(out.status).toBe(true);
    expect(out.lines[0].group).toBe('Extras');
    expect(out.delta).toBe(20);
  });

  test('the same tick twice is charged once', async () => {
    const out = await priceFor([
      { group: 'Extras', name: 'Extra cheese' },
      { group: 'Extras', name: 'Extra cheese' },
    ]);

    expect(out.delta).toBe(20);
    expect(out.lines).toHaveLength(1);
  });

  test("a group's ceiling is honoured", async () => {
    /* Extras takes two. A third is dropped rather than charged. */
    const out = await priceFor([
      { group: 'Extras', name: 'Extra cheese' },
      { group: 'Extras', name: 'Extra butter' },
      { group: 'Extras', name: 'Extra paneer' },
    ]);

    expect(out.lines).toHaveLength(2);
    expect(out.delta).toBe(35);
  });

  test('an option that costs nothing still travels, because the kitchen needs it', async () => {
    /* "Medium" has no price. It is not a money question, it is a cooking
       question, and dropping it would send the pass a dish with no answer. */
    const out = await priceFor([{ group: 'How spicy', name: 'Medium' }]);

    expect(out.delta).toBe(0);
    expect(out.lines).toEqual([{ group: 'How spicy', name: 'Medium', price_delta: 0 }]);
  });

  test('asking for nothing costs nothing and reads nothing', async () => {
    const none = await repo._priceModifiers(undefined, DISH, BRANCH);

    expect(none).toEqual({ status: true, delta: 0, lines: [] });
  });
});
