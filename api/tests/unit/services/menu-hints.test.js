'use strict';

/*
 * Telling the recogniser what this shop sells, before it guesses.
 *
 * The hard part of voice ordering was never "which dish did they mean" - the
 * handset does that lookup locally and for nothing. It is acoustic: getting
 * the sounds of "Chicken Biryani" out of a loud room and an accent. Every
 * provider takes hints for exactly that, and takes them free.
 *
 * Two things are pinned harder than the feature itself.
 *
 * WHAT LEAVES THE BUILDING. Dish names, and nothing else. This list is sent
 * with every clip, so the rule has to be one somebody can hold in their head.
 *
 * IT IS AN IMPROVEMENT, NOT A DEPENDENCY. A shop whose menu could not be read
 * must still be able to take an order by voice, slightly less accurately,
 * rather than not at all.
 */

const hints = require('../../../src/services/menu-hints');
const BaseModel = require('../../../src/models/base.model');

const BRANCH = '64b7f1e2c3d4e5f6a7b8c9d0';
const LICENSE = '64b7f1e2c3d4e5f6a7b8c9d1';
const context = { branchId: BRANCH, licenseId: LICENSE };

/** A menu, answered the way the driver answers one. */
function shopSells(names, capture = {}) {
  const rows = names.map((name) => ({ name }));
  const collection = {
    find: jest.fn((filter, options) => {
      capture.filter = filter;
      capture.options = options;
      return { sort: () => ({ toArray: async () => rows }) };
    }),
  };
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue({ collection: () => collection });
  return capture;
}

beforeEach(() => hints.forget());
afterEach(() => jest.restoreAllMocks());

describe('the names a recogniser is told', () => {
  test('the shop’s own dishes, as written', async () => {
    shopSells(['Chicken Biryani', 'Masala Dosa', 'Rasmalai']);
    await expect(hints.phrasesFor(context)).resolves.toEqual([
      'Chicken Biryani',
      'Masala Dosa',
      'Rasmalai',
    ]);
  });

  test('the same dish in two categories is sent once', async () => {
    /* A chain carries the same line in several places and a provider gains
       nothing from being told twice. */
    shopSells(['Coffee', 'coffee', 'COFFEE', 'Tea']);
    await expect(hints.phrasesFor(context)).resolves.toEqual(['Coffee', 'Tea']);
  });

  test('noise is left out', async () => {
    /* A one-character name and an essay both cost a provider's attention and
       buy nothing. */
    shopSells(['A', '', '   ', 'x'.repeat(200), 'Filter Coffee']);
    await expect(hints.phrasesFor(context)).resolves.toEqual(['Filter Coffee']);
  });

  test('the read is scoped to this branch AND this licence', async () => {
    const seen = shopSells(['Coffee']);
    await hints.phrasesFor(context);
    expect(Object.keys(seen.filter).sort()).toEqual(['branch_access.branch_id', 'license']);
  });

  test('only the NAME is read out of the database', async () => {
    /* Not prices, not stock, not what sold yesterday. A projection is the
       cheapest place to make that true, and the hardest to undo by accident. */
    const seen = shopSells(['Coffee']);
    await hints.phrasesFor(context);
    expect(seen.options.projection).toEqual({ name: 1 });
  });

  test('the count is capped HERE, not left to the provider', async () => {
    /* Whisper silently drops a prompt past its own limit, so a shop with two
       thousand items would send a truncated list and never know. */
    const seen = shopSells(['Coffee']);
    await hints.phrasesFor(context);
    expect(seen.options.limit).toBe(hints.MAX_PHRASES);
  });
});

describe('an improvement, never a dependency', () => {
  test('a database that will not answer gives no hints, not an error', async () => {
    jest.spyOn(BaseModel, 'getDb').mockRejectedValue(new Error('no database'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(hints.phrasesFor(context)).resolves.toEqual([]);
  });

  test('a branch that is not a branch gives no hints, not an error', async () => {
    for (const branchId of ['', 'not-an-id', null, undefined]) {
      await expect(hints.phrasesFor({ branchId, licenseId: LICENSE })).resolves.toEqual([]);
    }
  });

  test('no context at all is survivable', async () => {
    await expect(hints.phrasesFor()).resolves.toEqual([]);
  });
});

describe('read once, not once per spoken order', () => {
  test('a second order inside the window does not touch the database', async () => {
    const seen = shopSells(['Coffee']);
    await hints.phrasesFor(context);
    await hints.phrasesFor(context);
    await hints.phrasesFor(context);
    expect(BaseModel.getDb).toHaveBeenCalledTimes(1);
    expect(seen.filter).toBeDefined();
  });

  test('each branch is remembered separately', async () => {
    shopSells(['Coffee']);
    await hints.phrasesFor(context);
    await hints.phrasesFor({ branchId: LICENSE, licenseId: BRANCH });
    expect(BaseModel.getDb).toHaveBeenCalledTimes(2);
  });

  test('a menu that just changed can be forgotten', async () => {
    shopSells(['Coffee']);
    await hints.phrasesFor(context);
    hints.forget(context);
    await hints.phrasesFor(context);
    expect(BaseModel.getDb).toHaveBeenCalledTimes(2);
  });
});

describe('the Whisper prompt', () => {
  test('a run of terms, which is the shape that biases a decoder', () => {
    expect(hints.promptFrom(['Chicken Biryani', 'Masala Dosa'])).toBe(
      'Chicken Biryani, Masala Dosa'
    );
  });

  test('capped by CHARACTER, and never mid-name', () => {
    /* Truncating mid-name teaches the model a word the shop does not sell. */
    const many = Array.from({ length: 300 }, (_, i) => `Dish Number ${i}`);
    const prompt = hints.promptFrom(many);

    expect(prompt.length).toBeLessThanOrEqual(hints.MAX_PROMPT_CHARS);
    for (const term of prompt.split(', ')) expect(many).toContain(term);
  });

  test('nothing to say says nothing', () => {
    expect(hints.promptFrom([])).toBe('');
  });
});
