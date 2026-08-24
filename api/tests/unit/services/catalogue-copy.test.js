'use strict';

/*
 * "Inventory copy, or common inventory" (owner ask #85).
 *
 * For this schema those are not two settings. Stock lives on the item document
 * and each branch owns its own items, so widening the item read the way the
 * customer read was widened would show a cashier N copies of every product,
 * one per branch, each with a different count - and selling the wrong row
 * decrements another shop's stock. A common inventory needs per-branch stock
 * records; that is a schema change, not a switch.
 *
 * So the copy is the shipped half, and the two things it must get right are
 * the two that are invisible until a shop is using it: the lookup ids have to
 * be REMAPPED (categories, units and taxes are per-branch too), and the counts
 * must NOT come across.
 */

const { ObjectId } = require('mongodb');
const { copyCatalogue, STOCK_FIELDS } = require('../../../src/services/catalogue-copy');

const SOURCE = new ObjectId();
const TARGET = new ObjectId();
const LICENSE = new ObjectId();

/* A database just real enough: find() filters on branch, insertMany records. */
const mkDb = ({ items = [], categories = [], unit = [], grouptax = [] } = {}) => {
  const store = { items, categories, unit, grouptax };
  const inserted = { items: [], categories: [], unit: [], grouptax: [] };
  const existingItem = { value: null };

  const collection = (name) => ({
    /* A real driver cursor is async-iterable AND has toArray. The service
       streams items with `for await` and still uses toArray for the small
       lookup collections, so the mock has to offer both - a mock with only
       toArray would pass while the real code path could not run. */
    find: (filter) => ({
      [Symbol.asyncIterator]: async function* () {
        for (const row of await this.toArray()) yield row;
      },
      toArray: async () => {
        const wanted = filter.$or
          ? String(filter.$or[0]['branch_access.branch_id'] || filter.$or[1].branch_id)
          : String(filter.branch_id);
        return store[name].filter((r) => {
          const own = String(r.branch_id || '');
          const access = (r.branch_access || []).map((a) => String(a.branch_id));
          return own === wanted || access.includes(wanted);
        });
      },
    }),
    findOne: async () => existingItem.value,
    insertMany: async (docs) => {
      inserted[name].push(...docs);
      return { insertedCount: docs.length };
    },
  });

  return { db: { collection }, inserted, existingItem };
};

const item = (over = {}) => ({
  _id: new ObjectId(),
  name: 'Coca-Cola 500ml',
  selling_price: 40,
  barcode_id: '8901234567890',
  branch_id: SOURCE,
  branch_name: 'Main shop',
  branch_access: [{ branch_id: SOURCE, branch_name: 'Main shop' }],
  license: LICENSE,
  quantity: 120,
  available_quantity: 118,
  ...over,
});

const opts = (over = {}) => ({
  sourceBranchId: SOURCE,
  targetBranchId: TARGET,
  targetBranchName: 'Second shop',
  licenseId: LICENSE,
  userName: 'sridhar',
  ...over,
});

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('what the new shop gets', () => {
  test('the products come across', async () => {
    const { db, inserted } = mkDb({ items: [item(), item({ name: 'Lays' })] });
    const r = await copyCatalogue(db, opts());
    expect(r.status).toBe(true);
    expect(inserted.items).toHaveLength(2);
    expect(inserted.items.map((i) => i.name).sort()).toEqual(['Coca-Cola 500ml', 'Lays']);
  });

  test('the price, barcode and description travel unchanged', async () => {
    const { db, inserted } = mkDb({ items: [item()] });
    await copyCatalogue(db, opts());
    expect(inserted.items[0].selling_price).toBe(40);
    expect(inserted.items[0].barcode_id).toBe('8901234567890');
  });

  test('THE COUNTS DO NOT', async () => {
    /* Stock is physical. A copied count is a number the shop never counted,
       and it lets the till sell what is not on the shelf from minute one. */
    const { db, inserted } = mkDb({
      items: [item({ quantity: 120, available_quantity: 118, opening_stock: 200 })],
    });
    await copyCatalogue(db, opts());
    for (const field of STOCK_FIELDS) {
      if (inserted.items[0][field] !== undefined) {
        expect(inserted.items[0][field]).toBe(0);
      }
    }
    expect(inserted.items[0].quantity).toBe(0);
    expect(inserted.items[0].available_quantity).toBe(0);
  });

  test('every copy is a NEW document, not the same one twice', async () => {
    const src = item();
    const { db, inserted } = mkDb({ items: [src] });
    await copyCatalogue(db, opts());
    expect(String(inserted.items[0]._id)).not.toBe(String(src._id));
  });
});

describe('the branch relation', () => {
  test('a copy belongs to the NEW branch alone', async () => {
    /* Carrying the source's branch_access entry across would make the copy
       visible from the shop it was copied FROM - two rows for one product on
       that shop's list, which is the duplication this exists to avoid. */
    const { db, inserted } = mkDb({ items: [item()] });
    await copyCatalogue(db, opts());
    const access = inserted.items[0].branch_access;
    expect(access).toHaveLength(1);
    expect(String(access[0].branch_id)).toBe(String(TARGET));
    expect(String(inserted.items[0].branch_id)).toBe(String(TARGET));
  });

  test("the new shop's name replaces the old one", async () => {
    const { db, inserted } = mkDb({ items: [item()] });
    await copyCatalogue(db, opts());
    expect(inserted.items[0].branch_name).toBe('Second shop');
    expect(inserted.items[0].branch_access[0].branch_name).toBe('Second shop');
  });
});

describe('lookups are remapped, not carried', () => {
  test("a copied item points at the NEW branch's category", async () => {
    /* Categories, units and taxes are per-branch. Copying items alone leaves
       every one pointing at a record the new branch cannot see, so the list
       renders with blank categories and the first sale takes the wrong tax. */
    const catId = new ObjectId();
    const { db, inserted } = mkDb({
      categories: [{ _id: catId, name: 'Drinks', branch_id: SOURCE, license: LICENSE }],
      items: [item({ category_id: catId, category_name: 'Drinks' })],
    });
    await copyCatalogue(db, opts());

    const newCat = inserted.categories[0];
    expect(String(newCat.branch_id)).toBe(String(TARGET));
    expect(String(newCat._id)).not.toBe(String(catId));
    expect(String(inserted.items[0].category_id)).toBe(String(newCat._id));
    expect(String(inserted.items[0].category_id)).not.toBe(String(catId));
  });

  test('units and taxes are remapped the same way', async () => {
    const unitId = new ObjectId();
    const taxId = new ObjectId();
    const { db, inserted } = mkDb({
      unit: [{ _id: unitId, name: 'Quantity', branch_id: SOURCE, license: LICENSE }],
      grouptax: [{ _id: taxId, name: 'GST 18', branch_id: SOURCE, license: LICENSE }],
      items: [item({ unit_id: unitId, tax_id: taxId })],
    });
    await copyCatalogue(db, opts());
    expect(String(inserted.items[0].unit_id)).toBe(String(inserted.unit[0]._id));
    expect(String(inserted.items[0].tax_id)).toBe(String(inserted.grouptax[0]._id));
  });

  test('a lookup that no longer exists is CLEARED, not carried', async () => {
    /* A dangling id renders as a blank the shop can fix. Keeping it points at
       a record this branch cannot read and never will. */
    const missing = new ObjectId();
    const { db, inserted } = mkDb({
      items: [item({ category_id: missing, category_name: 'Gone' })],
    });
    await copyCatalogue(db, opts());
    expect(inserted.items[0].category_id).toBeNull();
    expect(inserted.items[0].category_name).toBe('');
  });

  test("a category carries the new shop's name, not the old one", async () => {
    const { db, inserted } = mkDb({
      categories: [
        {
          _id: new ObjectId(),
          name: 'Drinks',
          branch_id: SOURCE,
          branch_name: 'Main shop',
          license: LICENSE,
        },
      ],
      items: [item()],
    });
    await copyCatalogue(db, opts());
    expect(inserted.categories[0].branch_name).toBe('Second shop');
  });
});

describe('refusing rather than duplicating', () => {
  test('a branch that already has items is left alone', async () => {
    /* This runs from branch creation. A retried create must not leave a shop
       with two of every product. */
    const { db, inserted, existingItem } = mkDb({ items: [item()] });
    existingItem.value = { _id: new ObjectId() };
    const r = await copyCatalogue(db, opts());
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already has items/i);
    expect(inserted.items).toHaveLength(0);
  });

  test('a branch cannot copy from itself', async () => {
    const { db } = mkDb({ items: [item()] });
    const r = await copyCatalogue(db, opts({ sourceBranchId: TARGET }));
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/from itself/i);
  });

  test('a missing licence refuses rather than copying across accounts', async () => {
    const { db, inserted } = mkDb({ items: [item()] });
    const r = await copyCatalogue(db, opts({ licenseId: null }));
    expect(r.status).toBe(false);
    expect(inserted.items).toHaveLength(0);
  });

  test('a source with no products succeeds and says so', async () => {
    const { db } = mkDb({ items: [] });
    const r = await copyCatalogue(db, opts());
    expect(r.status).toBe(true);
    expect(r.data.items).toBe(0);
  });

  test('a database error is reported, never thrown at the caller', async () => {
    const db = {
      collection: () => ({
        findOne: async () => {
          throw new Error('mongo is having a day');
        },
      }),
    };
    const r = await copyCatalogue(db, opts());
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/having a day/);
  });
});

/*
 * Memory: a catalogue copy must not hold the catalogue.
 *
 * The writes were batched from the start for the obvious reason. Reading with
 * .toArray() and then building a second full array of copies undid that on the
 * way in - two copies of a shop's entire item list resident at once, on a
 * process shared with every other shop.
 */
describe('the copy streams rather than loading', () => {
  test('it never materialises the whole item list', async () => {
    /* A cursor that refuses toArray proves the items path does not use it.
       The small lookup collections legitimately still do. */
    const rows = [item(), item({ name: 'Lays' }), item({ name: 'Kurkure' })];
    const inserted = [];
    const db = {
      collection: (name) => ({
        findOne: async () => null,
        find: () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const r of name === 'items' ? rows : []) yield r;
          },
          toArray: async () => {
            if (name === 'items') throw new Error('items must be streamed, not loaded');
            return [];
          },
        }),
        insertMany: async (docs) => {
          inserted.push(...docs);
          return { insertedCount: docs.length };
        },
      }),
    };

    const r = await copyCatalogue(db, opts());
    expect(r.status).toBe(true);
    expect(r.data.items).toBe(3);
    expect(inserted).toHaveLength(3);
  });

  test('it writes in batches, not one insert per row', async () => {
    const { db, inserted } = mkDb({ items: Array.from({ length: 5 }, () => item()) });
    const calls = [];
    const real = db.collection;
    db.collection = (name) => {
      const c = real(name);
      if (name !== 'items') return c;
      return {
        ...c,
        insertMany: async (docs) => {
          calls.push(docs.length);
          return c.insertMany(docs);
        },
      };
    };
    await copyCatalogue(db, opts());
    expect(inserted.items).toHaveLength(5);
    expect(calls).toEqual([5]); // one flush, not five inserts
  });

  test('a partial final batch is still written', async () => {
    /* The classic off-by-one: everything below BATCH never flushes. */
    const { db, inserted } = mkDb({ items: [item(), item({ name: 'B' })] });
    const r = await copyCatalogue(db, opts());
    expect(r.data.items).toBe(2);
    expect(inserted.items).toHaveLength(2);
  });
});
