'use strict';

/*
 * Saying how long a section takes, once rather than 272 times.
 *
 * `prep_minutes` is read by two features that both go quiet without it: the
 * dish sheet says "takes about 20 minutes" so a customer can decide before
 * ordering, and the busy-kitchen notice uses the shop's MEDIAN prep time as
 * its round length - so a menu with no prep times can say the kitchen is
 * behind and never by how much.
 *
 * Counted on the live production shop the day this was written: **272 dishes,
 * zero with a prep time.** The field has been on the item form all along. It
 * is empty because filling it means opening 272 dishes, and nobody does that.
 * A number nobody can enter is a number nobody has.
 *
 * Driven against a fake collection rather than read, because on a bulk write
 * "which rows does the filter actually match" is the entire question.
 */

const ItemRepository = require('../../../src/repositories/item.repository');
const BaseModel = require('../../../src/models/base.model');

/* Mongo's answers to the operators these two methods use, and a record of
   what it was asked so the filter itself can be inspected. */
function fakeCollection(docs) {
  const asked = [];

  const clause = (doc, key, want) => {
    if (key === '$or') return want.some((c) => matches(doc, c));
    if (key === '$and') return want.every((c) => matches(doc, c));
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$ne' in want) return doc[key] !== want.$ne;
      if ('$in' in want) return want.$in.includes(doc[key] === undefined ? null : doc[key]);
      if ('$exists' in want) return (doc[key] !== undefined) === want.$exists;
      /* _bulkPriceFilter runs a category through toObjectId, so the value in
         the filter is an ObjectId and the one on the doc is the string it was
         written from. Compared as strings, or the filter matches nothing and
         the test passes for entirely the wrong reason. */
      if (want.toString && doc[key] != null) return String(doc[key]) === String(want);
    }
    return doc[key] === want;
  };
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, want]) => clause(doc, key, want));

  return {
    asked,
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

const BREADS = '507f1f77bcf86cd799439031';
const MAINS = '507f1f77bcf86cd799439032';

/* One dish the shop has already tuned by hand, one left at zero, one that has
   never carried the field at all - which is the shape a real catalogue is in. */
const menu = () => [
  { _id: 'a', name: 'Butter Naan', category_id: BREADS, prep_minutes: 0 },
  { _id: 'b', name: 'Garlic Naan', category_id: BREADS },
  { _id: 'c', name: 'Parotta', category_id: BREADS, prep_minutes: 12 },
  { _id: 'd', name: 'Butter Chicken', category_id: MAINS, prep_minutes: 0 },
];

beforeEach(() => {
  BaseModel.license = null;
});

describe('the dry run', () => {
  test('it counts what would change, and what it would leave alone', async () => {
    const { repo } = repoFor(menu());
    const out = await repo.previewPrepMinutes({ scope: 'all', minutes: 8 }, {});
    expect(out.status).toBe(true);
    expect(out.data.total).toBe(4);
    expect(out.data.willChange).toBe(3); // Parotta is already tuned
    /* Said out loud, so a shop learns its own numbers are safe rather than
       having to trust the wording of a checkbox. */
    expect(out.data.keeping).toBe(1);
  });

  test('overwriting takes the tuned dish too', async () => {
    const { repo } = repoFor(menu());
    const out = await repo.previewPrepMinutes({ scope: 'all', minutes: 8, onlyEmpty: false }, {});
    expect(out.data.willChange).toBe(4);
    expect(out.data.keeping).toBe(0);
  });

  test('a second cautious run has nothing left to do', async () => {
    const docs = menu();
    const { repo } = repoFor(docs);
    await repo.setPrepMinutes({ scope: 'all', minutes: 8 }, {});
    const out = await repo.previewPrepMinutes({ scope: 'all', minutes: 8 }, {});
    expect(out.data.willChange).toBe(0);
  });

  test('a section is a section', async () => {
    const { repo } = repoFor(menu());
    const out = await repo.previewPrepMinutes(
      { scope: 'category', categoryId: MAINS, minutes: 25 },
      {}
    );
    expect(out.data.total).toBe(1);
    expect(out.data.sample.map((s) => s.name)).toEqual(['Butter Chicken']);
  });

  test('the sample says what each dish would go from and to', async () => {
    /* A shop about to rewrite a whole section should see the before as well
       as the after, or "84 dishes would change" is a number to take on faith. */
    const { repo } = repoFor(menu());
    const out = await repo.previewPrepMinutes({ scope: 'all', minutes: 8, onlyEmpty: false }, {});
    const parotta = out.data.sample.find((s) => s.name === 'Parotta');
    expect(parotta).toEqual({ name: 'Parotta', old_value: 12, new_value: 8 });
  });
});

describe('what it refuses', () => {
  test('a number that is not a number', async () => {
    const { repo } = repoFor(menu());
    for (const bad of ['soon', null, undefined, NaN, {}]) {
      const out = await repo.previewPrepMinutes({ scope: 'all', minutes: bad }, {});
      expect(out.status).toBe(false);
    }
  });

  test('a negative wait, and one longer than a day', async () => {
    /*
     * Both ends matter. A negative prints as a promise nobody can keep, and a
     * 90,000-minute dish would drag the busy-kitchen median somewhere absurd
     * and quote the customer an hour of imaginary queue.
     */
    const { repo } = repoFor(menu());
    expect((await repo.previewPrepMinutes({ scope: 'all', minutes: -5 }, {})).status).toBe(false);
    expect((await repo.previewPrepMinutes({ scope: 'all', minutes: 1441 }, {})).status).toBe(false);
    expect((await repo.previewPrepMinutes({ scope: 'all', minutes: 1440 }, {})).status).toBe(true);
  });

  test('"one category" with no category chosen', async () => {
    const { repo } = repoFor(menu());
    const out = await repo.previewPrepMinutes({ scope: 'category', minutes: 8 }, {});
    expect(out.status).toBe(false);
    expect(out.message).toMatch(/category/i);
  });

  test('half a minute is rounded, not refused', async () => {
    /* A number typed into a box is not an insult. */
    const { repo } = repoFor(menu());
    expect((await repo.previewPrepMinutes({ scope: 'all', minutes: 7.6 }, {})).data.minutes).toBe(
      8
    );
  });
});

describe('the write', () => {
  test('it fills the empty ones and spares what the shop tuned', async () => {
    /*
     * THE DEFAULT, and the reason it is the default. A shop that has hand-set
     * a handful of dishes has done the most valuable work on this whole field,
     * and a blanket write would erase exactly that.
     */
    const docs = menu();
    const { repo } = repoFor(docs);
    const out = await repo.setPrepMinutes(
      { scope: 'category', categoryId: BREADS, minutes: 8 },
      {}
    );
    expect(out.status).toBe(true);
    expect(docs.find((d) => d.name === 'Parotta').prep_minutes).toBe(12);
    expect(docs.find((d) => d.name === 'Butter Naan').prep_minutes).toBe(8);
    expect(docs.find((d) => d.name === 'Garlic Naan').prep_minutes).toBe(8);
    /* And nothing outside the section moved. */
    expect(docs.find((d) => d.name === 'Butter Chicken').prep_minutes).toBe(0);
  });

  test('a dish that has never carried the field counts as empty', async () => {
    /* Absent, null and zero all mean "not said" here, and a catalogue predating
       the field is entirely made of the first kind. */
    const docs = [{ _id: 'x', name: 'Idli', category_id: BREADS }];
    const { repo } = repoFor(docs);
    await repo.setPrepMinutes({ scope: 'all', minutes: 5 }, {});
    expect(docs[0].prep_minutes).toBe(5);
  });

  test('overwriting has to be asked for, and then it does overwrite', async () => {
    const docs = menu();
    const { repo } = repoFor(docs);
    await repo.setPrepMinutes({ scope: 'all', minutes: 8, onlyEmpty: false }, {});
    expect(docs.every((d) => d.prep_minutes === 8)).toBe(true);
  });

  test('a dish already saying it is not rewritten', async () => {
    /* Same reason as the spice tool: an untouched dish keeps its updated_date,
       which is what the items list sorts on and what a shop reads as changed. */
    const { repo, collection } = repoFor(menu());
    await repo.setPrepMinutes({ scope: 'all', minutes: 8, onlyEmpty: false }, {});
    const write = collection.asked.find((a) => a.op === 'updateMany');
    expect(write.filter.prep_minutes).toEqual({ $ne: 8 });
  });

  test('changing nothing says so', async () => {
    const docs = menu().map((d) => ({ ...d, prep_minutes: 8 }));
    const { repo } = repoFor(docs);
    const out = await repo.setPrepMinutes({ scope: 'all', minutes: 8, onlyEmpty: false }, {});
    expect(out.data.changed).toBe(0);
    expect(out.message).toMatch(/already/i);
  });

  test('the shop is the licence on every one of these', async () => {
    BaseModel.license = 'lic-1';
    const { repo, collection } = repoFor(menu());
    await repo.previewPrepMinutes({ scope: 'all', minutes: 8 }, {});
    await repo.setPrepMinutes({ scope: 'all', minutes: 8 }, {});
    for (const call of collection.asked) expect(call.filter.license).toBe('lic-1');
  });
});

describe('and then the kitchen notice can finally quote a figure', () => {
  test('a menu with prep times has a median to work from', async () => {
    /*
     * The whole reason this tool exists. kitchenLoad multiplies the rounds it
     * is behind by the shop's median prep time, and a menu of zeroes gives it
     * nothing to multiply - so the customer is told the kitchen is busy and
     * never by how much.
     */
    const { typicalRound, kitchenLoad } = require('../../../src/utils/kitchen-load');
    const docs = menu();
    const { repo } = repoFor(docs);

    const before = typicalRound(docs.map((d) => d.prep_minutes));
    await repo.setPrepMinutes({ scope: 'all', minutes: 20, onlyEmpty: false }, {});
    const after = typicalRound(docs.map((d) => d.prep_minutes));

    expect(before).toBe(12); // the one tuned dish, alone
    expect(after).toBe(20);
    /* 21 orders on 10 tables is three rounds deep, so two rounds of waiting. */
    expect(
      kitchenLoad({ tableService: true, open: 21, capacity: 10, round: after }).extra_minutes
    ).toBe(40);
  });
});
