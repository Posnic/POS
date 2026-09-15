'use strict';

/*
 * Turning the spice choice on for a whole section.
 *
 * The tick is PER DISH on purpose: only the kitchen knows which dishes it can
 * cook to order, and a kitchen that batch-cooks its gravy cannot make one
 * portion mild. But "per dish" and "one dish at a time" are not the same
 * thing, and the difference decides whether the feature is ever used at all.
 * Production carries 272 dishes. A restaurant that has to open every one of
 * them to tick a box does not turn this on - it leaves it off, and the
 * customer goes on typing "less spicy" into a note, which is exactly what the
 * spice level exists to stop.
 *
 * The unit a kitchen thinks in is the SECTION: curries and biryanis can be
 * cooked to order, desserts and drinks cannot. So this takes the scope the
 * bulk price and bulk stock tools already take, and the shop corrects the
 * handful of exceptions on the dish itself.
 *
 * Driven against a fake collection rather than read: a bulk write is exactly
 * the kind of code where "which rows does the filter actually match" is the
 * whole question, and no regex over source can answer it.
 */

const ItemRepository = require('../../../src/repositories/item.repository');
const BaseModel = require('../../../src/models/base.model');

/* A collection that answers find() and updateMany() the way Mongo does, and
   remembers what it was asked, so the filter itself can be inspected. */
function fakeCollection(docs) {
  const asked = [];

  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, want]) => {
      if (key === '$or') return want.some((clause) => matches(doc, clause));
      if (want && typeof want === 'object' && '$ne' in want) return doc[key] !== want.$ne;
      if (want && typeof want === 'object' && want.toString && doc[key] && doc[key].toString) {
        return String(doc[key]) === String(want);
      }
      return doc[key] === want;
    });

  return {
    asked,
    docs,
    find(filter) {
      asked.push({ op: 'find', filter });
      return { toArray: async () => docs.filter((d) => matches(d, filter)) };
    },
    async updateMany(filter, update) {
      asked.push({ op: 'updateMany', filter, update });
      let modifiedCount = 0;
      for (const doc of docs) {
        if (!matches(doc, filter)) continue;
        Object.assign(doc, update.$set);
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
  };
}

function repoFor(docs) {
  const repo = new ItemRepository();
  const collection = fakeCollection(docs);
  repo.getCollection = async () => collection;
  return { repo, collection };
}

/* Real ObjectId spellings, because _bulkPriceFilter runs the category through
   toObjectId and a made-up word would quietly match nothing - which is a test
   that passes for the wrong reason. */
const MAINS = '507f1f77bcf86cd799439021';
const SWEETS = '507f1f77bcf86cd799439022';

const menu = () => [
  { _id: 'a', name: 'Chettinad Chicken', category_id: MAINS, spice_choice: false },
  { _id: 'b', name: 'Meen Kuzhambu', category_id: MAINS, spice_choice: false },
  { _id: 'c', name: 'Dal Tadka', category_id: MAINS, spice_choice: true },
  { _id: 'd', name: 'Gulab Jamun', category_id: SWEETS, spice_choice: false },
];

beforeEach(() => {
  BaseModel.license = null;
});

describe('the dry run', () => {
  test('it counts what would CHANGE, not what matches', async () => {
    /*
     * The distinction the whole screen turns on. A shop that runs this twice
     * should be told there is nothing left to do, rather than shown the same
     * number again and left wondering whether the first run worked.
     */
    const { repo } = repoFor(menu());
    const out = await repo.previewSpiceChoice({ scope: 'all', offer: true }, {});
    expect(out.status).toBe(true);
    expect(out.data.total).toBe(4);
    expect(out.data.willChange).toBe(3); // Dal Tadka is already on
    expect(out.data.sample.map((s) => s.name)).not.toContain('Dal Tadka');
  });

  test('a second run has nothing left to do', async () => {
    const docs = menu();
    const { repo } = repoFor(docs);
    await repo.setSpiceChoice({ scope: 'all', offer: true }, {});
    const out = await repo.previewSpiceChoice({ scope: 'all', offer: true }, {});
    expect(out.data.willChange).toBe(0);
  });

  test('taking it back off is counted the same way', async () => {
    const { repo } = repoFor(menu());
    const out = await repo.previewSpiceChoice({ scope: 'all', offer: false }, {});
    expect(out.data.willChange).toBe(1); // only Dal Tadka is on
    expect(out.data.offer).toBe(false);
  });

  test('a category is a category, and the rest of the menu is left alone', async () => {
    const { repo, collection } = repoFor(menu());
    const out = await repo.previewSpiceChoice(
      { scope: 'category', categoryId: SWEETS, offer: true },
      {}
    );
    expect(out.data.total).toBe(1);
    expect(out.data.sample.map((s) => s.name)).toEqual(['Gulab Jamun']);
    expect(collection.asked[0].filter.category_id).toBeDefined();
  });

  test('"one category" with no category chosen is refused, not treated as all', async () => {
    /* Falling through to every dish on the menu because a select was empty is
       the worst possible reading of an unanswered question. */
    const { repo } = repoFor(menu());
    const out = await repo.previewSpiceChoice({ scope: 'category', offer: true }, {});
    expect(out.status).toBe(false);
    expect(out.message).toMatch(/category/i);
  });
});

describe('the write', () => {
  test('it offers the choice across the scope', async () => {
    const docs = menu();
    const { repo } = repoFor(docs);
    const out = await repo.setSpiceChoice(
      { scope: 'category', categoryId: MAINS, offer: true },
      {}
    );
    expect(out.status).toBe(true);
    expect(out.data.changed).toBe(2);
    expect(docs.map((d) => d.spice_choice)).toEqual([true, true, true, false]);
  });

  test('it takes the choice back, over the same scope', async () => {
    /*
     * Not a one-way door. A shop that turns it on for the whole menu and then
     * finds the kitchen cannot honour it must be able to undo that in one
     * action, not 272.
     */
    const docs = menu();
    const { repo } = repoFor(docs);
    await repo.setSpiceChoice({ scope: 'all', offer: true }, {});
    const out = await repo.setSpiceChoice({ scope: 'all', offer: false }, {});
    expect(out.data.changed).toBe(4);
    expect(docs.every((d) => d.spice_choice === false)).toBe(true);
  });

  test('a dish that is already right is not written at all', async () => {
    /*
     * The filter carries `spice_choice: { $ne: wanted }` so an untouched dish
     * keeps its updated_date - which is what the items list sorts on and what
     * a shop reads as "this changed". A blanket write would restamp the whole
     * catalogue and make the list useless for a week.
     */
    const { repo, collection } = repoFor(menu());
    await repo.setSpiceChoice({ scope: 'all', offer: true }, {});
    const write = collection.asked.find((a) => a.op === 'updateMany');
    expect(write.filter.spice_choice).toEqual({ $ne: true });
  });

  test('changing nothing says so, rather than claiming success over an empty set', async () => {
    const docs = menu().map((d) => ({ ...d, spice_choice: true }));
    const { repo } = repoFor(docs);
    const out = await repo.setSpiceChoice({ scope: 'all', offer: true }, {});
    expect(out.status).toBe(true);
    expect(out.data.changed).toBe(0);
    expect(out.message).toMatch(/already/i);
  });

  test('a branch narrows what a bulk write can reach', async () => {
    /* The same scope filter the price and stock tools use, so a manager on one
       branch cannot rewrite another branch's menu from this screen. */
    const { repo, collection } = repoFor(menu());
    await repo.setSpiceChoice(
      { scope: 'all', offer: true },
      { branchId: '507f1f77bcf86cd799439011' }
    );
    const write = collection.asked.find((a) => a.op === 'updateMany');
    expect(write.filter.$or).toBeDefined();
  });

  test('the shop is the licence, on every one of these', async () => {
    BaseModel.license = 'lic-1';
    const { repo, collection } = repoFor(menu());
    await repo.previewSpiceChoice({ scope: 'all', offer: true }, {});
    await repo.setSpiceChoice({ scope: 'all', offer: true }, {});
    for (const call of collection.asked) {
      expect(call.filter.license).toBe('lic-1');
    }
  });
});

describe('what counts as "offer it"', () => {
  test('only a real yes', async () => {
    /*
     * The form sends a boolean and an older client could send the string.
     * Everything else is NO, because the safe reading of an unrecognised
     * value is "do not promise the customer anything".
     */
    const { repo } = repoFor(menu());
    for (const yes of [true, 'true']) {
      expect((await repo.previewSpiceChoice({ scope: 'all', offer: yes }, {})).data.offer).toBe(
        true
      );
    }
    for (const no of [false, 'false', 'yes', 1, null, undefined, {}]) {
      expect((await repo.previewSpiceChoice({ scope: 'all', offer: no }, {})).data.offer).toBe(
        false
      );
    }
  });
});
