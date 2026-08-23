'use strict';

const ItemRepository = require('../../../src/repositories/item.repository');

/*
 * Removing the demo data for good.
 *
 * The switch hides and is reversible. This destroys, so the whole value of it
 * is in what it DECLINES to touch, and that is what these tests are about.
 *
 * A demo item exists to be rung up - that is how somebody finds out whether
 * the till suits them - and a sale line stores item_id. Delete the item and
 * the sale becomes a purchase of a product that does not exist. The sale is
 * real even though the product was not, so nothing puts that right afterwards.
 *
 * And a sample whose price a shop has changed is not a sample any more. By the
 * time they press this button that row is theirs, whatever tag it carries.
 */
describe('purgeDemoData', () => {
  const BRANCH = '507f1f77bcf86cd799439011';
  const LICENSE = '507f1f77bcf86cd799439012';

  const SEEDED = new Date('2026-08-01T10:00:00Z');

  let repo;
  let collections;
  let updateMany;
  let deletedCategories;

  const item = (id, name, over = {}) => ({
    _id: id,
    name,
    demo_seeded_at: SEEDED,
    updated_date: SEEDED,
    ...over,
  });

  /* A stand-in for the driver, shaped only where this function touches it. */
  const setup = ({
    items = [],
    sales = [],
    receivings = [],
    categories = [],
    itemsLeftInCat = 0,
  } = {}) => {
    updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    deletedCategories = [];

    collections = {
      items: {
        find: () => ({ toArray: async () => items }),
        updateMany: (...a) => {
          updateMany(...a);
          const ids = a[0]._id.$in;
          return Promise.resolve({ modifiedCount: ids.length });
        },
        countDocuments: async () => itemsLeftInCat,
      },
      sales: { find: () => ({ toArray: async () => sales }) },
      receivings: { find: () => ({ toArray: async () => receivings }) },
      categories: {
        find: () => ({ toArray: async () => categories }),
        deleteOne: async (f) => {
          deletedCategories.push(f._id);
          return { deletedCount: 1 };
        },
      },
    };

    repo = new ItemRepository();
    repo.getCollection = async (name) => collections[name] || collections.items;
    repo.collectionName = 'items';
    return repo;
  };

  const run = () =>
    repo.purgeDemoData({ branchId: BRANCH, licenseId: LICENSE, user: { name: 'Owner' } });

  test('nothing to remove says so, and touches nothing', async () => {
    setup({ items: [] });
    const r = await run();
    expect(r.status).toBe(true);
    expect(r.removed).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('an untouched, unsold sample is removed', async () => {
    setup({ items: [item('a1', 'Croissant')] });
    const r = await run();
    expect(r.removed).toBe(1);
    expect(r.kept).toEqual([]);
  });

  describe('what it refuses', () => {
    test('an item that has been SOLD is kept', async () => {
      setup({
        items: [item('a1', 'Croissant'), item('a2', 'Muffin')],
        sales: [{ items: [{ item_id: 'a1' }] }],
      });
      const r = await run();
      expect(r.removed).toBe(1);
      expect(r.kept).toEqual([{ name: 'Croissant', why: 'sold or received' }]);
    });

    test('an item that has been RECEIVED is kept', async () => {
      setup({
        items: [item('a1', 'Croissant')],
        receivings: [{ items: [{ item_id: 'a1' }] }],
      });
      const r = await run();
      expect(r.removed).toBe(0);
      expect(r.kept[0].why).toBe('sold or received');
    });

    test('an item the shop has EDITED is kept', async () => {
      /* Changing the price and putting it on the shelf is how a small shop
         starts its real catalogue. */
      setup({
        items: [item('a1', 'Croissant', { updated_date: new Date('2026-08-05T09:00:00Z') })],
      });
      const r = await run();
      expect(r.removed).toBe(0);
      expect(r.kept[0].why).toBe('you have edited it');
    });

    test('the seed writing both dates at once does not count as an edit', async () => {
      /* created_date and updated_date are written in the same pass, so clock
         resolution must not make every row look edited and remove nothing. */
      setup({
        items: [item('a1', 'Croissant', { updated_date: new Date(SEEDED.getTime() + 300) })],
      });
      expect((await run()).removed).toBe(1);
    });
  });

  describe('matching an id however it was stored', () => {
    test('a sale storing item_id as a string still protects the item', async () => {
      setup({ items: [item('a1', 'Croissant')], sales: [{ items: [{ item_id: 'a1' }] }] });
      expect((await run()).removed).toBe(0);
    });

    test('the query asks for both shapes', async () => {
      /* item_id is a string in some collections and an ObjectId in others.
         Matching only one finds nothing, and here "found nothing" means
         deleting something that was sold. */
      const seen = [];
      setup({ items: [item('a1', 'Croissant')] });
      collections.sales.find = (q) => {
        seen.push(q);
        return { toArray: async () => [] };
      };
      await run();
      expect(seen[0]['items.item_id'].$in.length).toBe(2);
    });
  });

  describe('when history cannot be read', () => {
    test('an unreadable sales history removes NOTHING', async () => {
      /* Not being able to check is not permission to delete. */
      jest.spyOn(console, 'error').mockImplementation(() => {});
      setup({ items: [item('a1', 'Croissant')] });
      collections.sales.find = () => {
        throw new Error('mongo down');
      };
      const r = await run();
      expect(r.status).toBe(false);
      expect(r.removed).toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
      expect(r.message).toMatch(/nothing was removed/i);
      jest.restoreAllMocks();
    });
  });

  describe('the removal itself', () => {
    test('is a soft delete, so the Recycle Bin still holds it', async () => {
      /* "Permanent" must not mean unrecoverable for the shop that asked. */
      setup({ items: [item('a1', 'Croissant')] });
      await run();
      const [, update] = updateMany.mock.calls[0];
      expect(update.$set.del_status).toBe(1);
      expect(update.$set.deleted_date).toBeInstanceOf(Date);
    });

    test('is scoped to the licence', async () => {
      setup({ items: [item('a1', 'Croissant')] });
      await run();
      const [filter] = updateMany.mock.calls[0];
      expect(filter.license).toBeTruthy();
    });
  });

  describe('categories', () => {
    test('an emptied demo category goes', async () => {
      setup({ items: [item('a1', 'Croissant')], categories: [{ _id: 'c1' }], itemsLeftInCat: 0 });
      const r = await run();
      expect(deletedCategories).toEqual(['c1']);
      expect(r.categoriesRemoved).toBe(1);
    });

    test('a demo category still holding something is kept', async () => {
      /* It is the shop's category now, and emptying the shelf label out from
         under a product they kept is its own small disaster. */
      setup({ items: [item('a1', 'Croissant')], categories: [{ _id: 'c1' }], itemsLeftInCat: 3 });
      await run();
      expect(deletedCategories).toEqual([]);
    });
  });

  describe('the report', () => {
    test('says what it kept and why, by name', async () => {
      /* "Removed 128, kept 6" invites the question this already knows the
         answer to, and a silent partial delete is worse than none. */
      setup({
        items: [item('a1', 'Croissant'), item('a2', 'Muffin')],
        sales: [{ items: [{ item_id: 'a1' }] }],
      });
      const r = await run();
      expect(r.message).toMatch(/Croissant/);
      expect(r.message).toMatch(/sold or received/);
    });

    test('a long kept-list is summarised rather than dumped', async () => {
      const items = [];
      for (let i = 0; i < 9; i++) items.push(item('a' + i, 'Item ' + i));
      setup({ items, sales: [{ items: items.map((x) => ({ item_id: x._id })) }] });
      const r = await run();
      expect(r.kept).toHaveLength(9);
      expect(r.message).toMatch(/and 3 more/);
    });
  });
});
