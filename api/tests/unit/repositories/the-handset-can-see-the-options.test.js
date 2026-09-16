'use strict';

/*
 * EXTRA CHEESE THAT NOBODY CHARGES FOR.
 *
 * The shop defines option sets in settings - extra cheese, half plate, medium
 * spicy - with a price on each, and ticks which dishes carry them. The sale
 * model has stored the answers since V2, and says in its own comment that "the
 * price delta [is] already inside the line price the client sent".
 *
 * So the client does the arithmetic, which means a client that cannot SEE the
 * options cannot charge for them. The handset could not see them: the
 * storefront builds an explicit field list and `modifier_group_ids` was not in
 * it. A waiter typed "extra cheese" as a note, the kitchen made it, and the
 * bill said nothing. The shop gave away cheese for months and had no record
 * that it had.
 *
 * Sent WHOLE rather than as ids, because a handset keeps its menu and sells
 * from it on a dead network. Ids would mean a second request to a settings
 * endpoint, and the one time that request matters is the time it cannot be
 * made.
 */

const ItemRepository = require('../../../src/repositories/item.repository');
const SettingsRepository = require('../../../src/repositories/settings.repository');

const FAKE_ID = '507f1f77bcf86cd799439011';
const CHEESE_GROUP = '507f1f77bcf86cd799439012';
const SPICE_GROUP = '507f1f77bcf86cd799439013';
const DELETED_GROUP = '507f1f77bcf86cd799439014';

const chain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

const agg = (result) => ({ toArray: jest.fn().mockResolvedValue(result) });

/** The option sets a shop has defined. */
const SETS = [
  {
    _id: CHEESE_GROUP,
    license: FAKE_ID,
    name: 'Extras',
    min: 0,
    max: 3,
    options: [
      { name: 'Extra cheese', price_delta: 20 },
      { name: 'Extra butter', price_delta: 15 },
    ],
  },
  {
    _id: SPICE_GROUP,
    license: FAKE_ID,
    name: 'How spicy',
    min: 1,
    max: 1,
    options: [
      { name: 'Medium', price_delta: 0 },
      { name: 'Extra spicy', price_delta: 0 },
    ],
  },
];

describe('what the storefront tells a handset about options', () => {
  let repo;
  let col;

  /** Run the storefront over a menu of one dish carrying the given groups. */
  async function menuFor(groupIds, { sets = SETS, readFails = false } = {}) {
    col.aggregate.mockReturnValue(
      agg([
        {
          _id: { category_id: 'c1', category_name: 'Mains' },
          items: [
            {
              id: 'i1',
              name: 'Paneer Butter Masala',
              price: 220,
              modifier_group_ids: groupIds,
            },
          ],
        },
      ])
    );

    col.find.mockImplementation(() =>
      readFails ? { toArray: () => Promise.reject(new Error('no')) } : chain(sets)
    );

    const out = await repo.storefront({ channel: 'tableside' });
    expect(out.status).toBe(true);

    /* `products` is the grouped menu: one entry per category, each with its
       items. Named here rather than guessed at, because a helper that hunts
       for a key will keep passing after somebody renames it. */
    const dish = (out.data.products || [])
      .flatMap((category) => category.items || [])
      .find((i) => i.id === 'i1');

    expect(dish).toBeDefined();
    return dish;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    col = {
      find: jest.fn().mockReturnValue(chain([])),
      findOne: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockReturnValue(agg([])),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    repo = new ItemRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
    jest
      .spyOn(repo, '_storefrontBranch')
      .mockResolvedValue({ _id: FAKE_ID, license: FAKE_ID, online_ordering: {} });
    jest
      .spyOn(SettingsRepository.prototype, 'resolveGroup')
      .mockResolvedValue({ status: true, data: { values: { table_options: true } } });
  });

  afterEach(() => jest.restoreAllMocks());

  test('A DISH CARRIES ITS OPTION SETS, whole, with the prices on them', async () => {
    const dish = await menuFor([CHEESE_GROUP]);

    expect(dish.modifier_groups).toEqual([
      {
        name: 'Extras',
        min: 0,
        max: 3,
        options: [
          { name: 'Extra cheese', price_delta: 20 },
          { name: 'Extra butter', price_delta: 15 },
        ],
      },
    ]);
  });

  test('the ids themselves never reach a client', async () => {
    /* An id is no use to a handset that cannot ask what it means, and leaving
       it there invites somebody to build a second request around it. */
    const dish = await menuFor([CHEESE_GROUP]);

    expect(dish.modifier_group_ids).toBeUndefined();
  });

  test('a dish with no options says nothing rather than saying nothing loudly', async () => {
    const dish = await menuFor([]);

    expect(dish.modifier_groups).toBeUndefined();
    expect(dish.modifier_group_ids).toBeUndefined();
  });

  test('a group the shop deleted is gone, not an empty box to tap past', async () => {
    const dish = await menuFor([DELETED_GROUP, CHEESE_GROUP]);

    expect(dish.modifier_groups.map((g) => g.name)).toEqual(['Extras']);
  });

  test('a group with no options left in it is dropped too', async () => {
    const emptied = [{ _id: CHEESE_GROUP, license: FAKE_ID, name: 'Extras', options: [] }];
    const dish = await menuFor([CHEESE_GROUP], { sets: emptied });

    expect(dish.modifier_groups).toBeUndefined();
  });

  test('min and max travel, because "pick one" is not the same as "pick any"', async () => {
    const dish = await menuFor([SPICE_GROUP]);

    expect(dish.modifier_groups[0].min).toBe(1);
    expect(dish.modifier_groups[0].max).toBe(1);
  });

  test('a shop that cannot read its option sets still sells food', async () => {
    /*
     * Losing the extras is a smaller harm than losing the menu. A handset with
     * no cheese option still takes orders; a handset with no menu takes none.
     */
    const dish = await menuFor([CHEESE_GROUP], { readFails: true });

    expect(dish.name).toBe('Paneer Butter Masala');
    expect(dish.modifier_groups).toBeUndefined();
    expect(dish.modifier_group_ids).toBeUndefined();
  });
});
