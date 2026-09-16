'use strict';

/*
 * THE IMPORT CARRIES THE DISH, NOT ONLY THE PRICE.
 *
 * Owner: "azure coastal kitchen production you need to fill the details of
 * menu. description and nutrition, veg or non veg, other all details needs to
 * be filled one by one. very detailed... also cross selling also do that."
 *
 * Every one of those fields already had a box on the item screen. What was
 * missing was a way to fill in a whole menu without opening a form per dish -
 * the import carried the price-and-stock columns and set `description` to
 * empty on the way past.
 *
 * What is pinned here is the behaviour of the DOOR, which is where this can go
 * wrong quietly and expensively:
 *
 *   an ordinary price re-import must not touch a menu somebody wrote;
 *   a column that IS there must be written, including back to empty;
 *   pairings arrive as names and are resolved after every row exists;
 *   a name nobody recognises is reported, never guessed at.
 */

jest.mock('../../../src/constants/items.constants', () => ({
  DEFAULTS: { IMAGE: 'item.svg' },
  ITEM_STATUS: { REGULAR: 'regular', INSTANT: 'instant' },
  SUCCESS_MESSAGES: { ITEM_CREATED: 'Created', ITEM_UPDATED: 'Updated' },
  ERROR_MESSAGES: {
    ITEM_NOT_FOUND: 'Not found',
    BRANCH_LICENSE_REQUIRED: 'Required',
    BARCODE_EXISTS: 'Barcode exists',
  },
}));

jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => id, toHexString: () => id }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

jest.mock('../../../src/models/item.model', () => ({
  LegacyItemModel: { fields: { name: {}, price: {} }, collectionName: 'items' },
}));

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ branch_name: 'Main Branch' }),
    }),
  }),
}));

jest.mock(
  '../../../src/repositories/stock-log.repository',
  () =>
    class {
      createStockLog() {
        return Promise.resolve();
      }
      updateItemNameInStockLogs() {
        return Promise.resolve();
      }
    }
);

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(c) {
    this.collectionName = c;
  }
  MockBaseModel.prototype.toObjectId = jest.fn((id) => id);
  MockBaseModel.prototype.checkPlan = jest.fn().mockResolvedValue(0);
  MockBaseModel.simplifyFields = jest.fn((d) => d);
  MockBaseModel.getSelectFields = jest.fn(() => ({}));
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.license = null;
  return MockBaseModel;
});

const ItemRepository = require('../../../src/repositories/item.repository');

const BRANCH = '64f9a1c2e3b4d5e6f7000002';
const LICENSE = '64f9a1c2e3b4d5e6f7000003';

/* The eighteen columns the export has produced for years, plus whatever the
   test is actually about. */
const row = (extra = {}) => ({
  name: 'Chicken Biryani',
  itemid: 'BIR-1',
  barcode_id: '',
  supplier_name: 'Kitchen',
  category_name: 'Biryani',
  discount_amount: 0,
  discount_percentage: 0,
  tax: 5,
  tax_type: 'exclusive',
  mrp_price: 260,
  company_price: 120,
  selling_price: 240,
  available_quantity: 50,
  unit: 'qty',
  sort_order: 1,
  ...extra,
});

describe('a menu filled in from a file', () => {
  let repo;
  let col;
  let inserted;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    inserted = 0;
    col = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockResolvedValue(null),
      /* The import also creates the supplier, category, tax and unit a row
         names, so an id that counts inserts would depend on which of those
         already existed. Naming the item ids after the dish keeps what the
         pairings assert readable. */
      insertOne: jest.fn(async (doc) => {
        inserted += 1;
        const isItem = doc && doc.itemid !== undefined;
        return { insertedId: isItem ? `item-${doc.name}` : `other-${inserted}` };
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    repo = new ItemRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
    repo.logItemChanges = jest.fn().mockResolvedValue();
  });

  afterEach(() => jest.restoreAllMocks());

  const run = (rows) => repo.importItems(rows, { branchId: BRANCH, licenseId: LICENSE });

  /** The document the import inserted, ignoring the collections it creates. */
  const insertedItem = () => {
    const calls = col.insertOne.mock.calls.map(([doc]) => doc);
    return calls.find((doc) => doc && doc.itemid !== undefined);
  };

  /** The $set of the last update that was not the pairing pass. */
  const itemUpdate = () => {
    const calls = col.updateOne.mock.calls.filter(([, update]) => update && update.$set);
    const notPairing = calls.filter(([, update]) => !('goes_with' in update.$set));
    return notPairing.length ? notPairing[notPairing.length - 1][1].$set : null;
  };

  /* ------------------------------------------- the file that says nothing */

  describe('an ordinary price re-import', () => {
    test('DOES NOT TOUCH THE MENU SOMEBODY WROTE', async () => {
      /*
       * The reason the dish fields are spread in rather than listed. Every
       * shop re-imports the eighteen-column export to change prices. If a
       * missing column meant "make it empty", the first price update after a
       * menu was detailed would erase the detailing - silently, and across
       * the whole catalogue at once.
       */
      col.findOne.mockResolvedValueOnce({
        _id: 'existing-1',
        name: 'Chicken Biryani',
        itemid: 'BIR-1',
        description: 'Written by the shop',
        diet: 'non_veg',
        nutrition: { kcal: 520 },
      });

      const result = await run([row({ selling_price: 250 })]);

      expect(result.status).toBe(true);
      const set = itemUpdate();
      expect(set.selling_price).toBe(250);
      expect(set).not.toHaveProperty('description');
      expect(set).not.toHaveProperty('diet');
      expect(set).not.toHaveProperty('nutrition');
      expect(set).not.toHaveProperty('food_tags');
      expect(set).not.toHaveProperty('nutrition_source');
    });

    test('and writes no pairings, because the file did not mention any', async () => {
      col.findOne.mockResolvedValueOnce({ _id: 'existing-1', goes_with: ['keep-me'] });
      await run([row()]);
      const pairingWrites = col.updateOne.mock.calls.filter(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairingWrites).toHaveLength(0);
    });
  });

  /* ------------------------------------------------ the file that says so */

  describe('a file with the dish detail in it', () => {
    test('fills a new dish in, one column at a time', async () => {
      await run([
        row({
          description: 'Long-grain rice, slow-cooked with chicken',
          diet: 'Non Veg',
          food_tags: 'nut_free; gluten free',
          menu_marks: 'signature',
          spice_choice: 'yes',
          prep_note: 'Cook to order',
          prep_minutes: '25',
          calories: '520',
          protein_g: '28',
        }),
      ]);

      const doc = insertedItem();
      expect(doc.description).toBe('Long-grain rice, slow-cooked with chicken');
      expect(doc.diet).toBe('non_veg');
      expect(doc.food_tags).toEqual(['nut_free', 'gluten_free']);
      expect(doc.menu_marks).toEqual(['signature']);
      expect(doc.spice_choice).toBe(true);
      expect(doc.prep_note).toBe('Cook to order');
      expect(doc.prep_minutes).toBe(25);
      expect(doc.nutrition).toEqual({ kcal: 520, protein_g: 28 });
    });

    test('AND THE NUMBERS ARRIVE AS AN ESTIMATE, so no health claim is published', async () => {
      /*
       * `nutrition_source` empty means a person entered these and the menu may
       * publish the calorie figure and every claim it supports. A file cannot
       * be that person by default.
       */
      await run([row({ calories: '520' })]);
      expect(insertedItem().nutrition_source).toBe('estimated');
    });

    test('unless the file says a kitchen stood behind them', async () => {
      await run([row({ calories: '520', nutrition_source: 'kitchen' })]);
      expect(insertedItem().nutrition_source).toBe('');
    });

    test('and an existing dish keeps the nutrients the file did not mention', async () => {
      col.findOne.mockResolvedValueOnce({
        _id: 'existing-1',
        nutrition: { kcal: 400, protein_g: 20, sodium_mg: 800 },
      });
      await run([row({ calories: '520' })]);
      expect(itemUpdate().nutrition).toEqual({ kcal: 520, protein_g: 20, sodium_mg: 800 });
    });

    test('a description emptied on purpose is written back as empty', async () => {
      col.findOne.mockResolvedValueOnce({ _id: 'existing-1', description: 'Old words' });
      await run([row({ description: '' })]);
      expect(itemUpdate().description).toBe('');
    });

    test('and what could not be used is said in the message, not swallowed', async () => {
      const result = await run([row({ food_tags: 'heart_healthy', diet: 'pescatarian' })]);
      expect(result.status).toBe(true);
      expect(result.message).toContain('heart_healthy');
      expect(result.message).toContain('pescatarian');
      expect(result.message).toContain('Chicken Biryani');
    });
  });

  /* ---------------------------------------------------------- the pairings */

  describe('what goes with what', () => {
    test('A FILE PAIRS BY NAME, AND ITS OWN DISHES RESOLVE TO EACH OTHER', async () => {
      /*
       * Owner: "chickent briyani link to chicken 65 or mojito or coke." The
       * file IS the menu, so the dishes a row pairs with are usually rows in
       * the same file that did not exist when that row was written. Hence a
       * second pass, after everything has an id.
       */
      await run([
        row({ name: 'Chicken Biryani', itemid: 'BIR-1', goes_with: 'Chicken 65; Coke' }),
        row({ name: 'Chicken 65', itemid: 'C65-1' }),
        row({ name: 'Coke', itemid: 'COKE-1' }),
      ]);

      const pairing = col.updateOne.mock.calls.find(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairing[1].$set.goes_with).toEqual(['item-Chicken 65', 'item-Coke']);
    });

    test('and the case somebody typed it in does not have to match', async () => {
      await run([
        row({ name: 'Chicken Biryani', itemid: 'BIR-1', goes_with: 'chicken 65' }),
        row({ name: 'Chicken 65', itemid: 'C65-1' }),
      ]);
      const pairing = col.updateOne.mock.calls.find(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairing[1].$set.goes_with).toEqual(['item-Chicken 65']);
    });

    test('a dish the menu does not have is REPORTED, never guessed at', async () => {
      const result = await run([row({ goes_with: 'Sambar' })]);
      expect(result.message).toContain('Sambar');
      expect(result.message).toContain('not a dish here');
      const pairing = col.updateOne.mock.calls.find(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairing[1].$set.goes_with).toEqual([]);
    });

    test('a dish pairs with a dish already on the menu, found once', async () => {
      col.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([{ _id: 'already-there', name: 'Virgin Mojito' }]),
      });
      await run([row({ goes_with: 'virgin mojito' })]);
      const pairing = col.updateOne.mock.calls.find(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairing[1].$set.goes_with).toEqual(['already-there']);
      /* One lookup for every unresolved name, not one per name. */
      const lookups = col.find.mock.calls.filter(([filter]) => filter && filter.name);
      expect(lookups).toHaveLength(1);
    });

    test('AND A DISH IS NEVER PAIRED WITH ITSELF', async () => {
      await run([row({ name: 'Chicken Biryani', goes_with: 'Chicken Biryani; Chicken 65' })]);
      const pairing = col.updateOne.mock.calls.find(
        ([, update]) => update && update.$set && 'goes_with' in update.$set
      );
      expect(pairing[1].$set.goes_with).not.toContain('item-Chicken Biryani');
    });

    test('and a dish name is looked up as a name, not as a pattern', async () => {
      /* A menu contains "Chicken 65 (Boneless)" and "Dosa - Plain". Handed to
         Mongo unescaped those are regular expressions, which is a query a
         customer-facing field should never be able to write. */
      await run([row({ goes_with: 'Chicken 65 (Boneless)' })]);
      const lookup = col.find.mock.calls.find(([filter]) => filter && filter.name);
      const [pattern] = lookup[0].name.$in;
      expect(pattern.test('Chicken 65 (Boneless)')).toBe(true);
      expect(pattern.test('Chicken 65 Boneless')).toBe(false);
    });
  });

  /* ------------------------------------------------------------ the notes */

  describe('the notes a shop is shown', () => {
    test('stop at three and then count, because a wall of them is not a message', async () => {
      const suffix = repo._importNotesSuffix(['one', 'two', 'three', 'four', 'five']);
      expect(suffix).toContain('one; two; three');
      expect(suffix).toContain('and 2 more');
      expect(suffix).not.toContain('four');
    });

    test('and an import with nothing to say says nothing', async () => {
      expect(repo._importNotesSuffix([])).toBe('');
      expect(repo._importNotesSuffix(null)).toBe('');
      const result = await run([row()]);
      expect(result.message).toBe('Import complete: 1 added');
    });
  });
});
