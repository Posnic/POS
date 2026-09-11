'use strict';

/**
 * Unit tests for src/utils/menu-search.js
 *
 * The forgiving half and the strict half are equally important. A search that
 * tolerates nothing tells a hungry customer the restaurant does not sell what
 * it plainly sells; a search that tolerates everything answers every query
 * with the whole menu, which is the same uselessness wearing a different hat.
 *
 * Most of these are real misspellings of real Indian dishes, because that is
 * what this has to survive.
 */

const {
  editDistance,
  normalize,
  score,
  scoreWord,
  search,
} = require('../../../src/utils/menu-search');

const DISHES = [
  { name: 'Paneer Butter Masala', description: 'Tomato and cashew gravy', category: 'Mains' },
  { name: 'Hyderabadi Dum Biryani', description: 'Slow cooked, saffron', category: 'Mains' },
  { name: 'Butter Naan', description: '', category: 'Breads' },
  { name: 'Gobi Manchurian', description: 'Cauliflower, soy and garlic', category: 'Starters' },
  { name: 'Masala Dosa', description: 'Potato masala, sambar', category: 'Breakfast' },
  { name: 'Dal Tadka', description: 'Yellow lentils, ghee tempering', category: 'Mains' },
];

const names = (rows) => rows.map((r) => r.name);

describe('spelled correctly', () => {
  test('an exact name comes back', () => {
    expect(names(search('Butter Naan', DISHES))).toContain('Butter Naan');
  });

  test('a prefix finds it before anything else', () => {
    expect(names(search('bir', DISHES))[0]).toBe('Hyderabadi Dum Biryani');
  });

  test('a word from the middle of a name still finds it', () => {
    expect(names(search('dum', DISHES))).toEqual(['Hyderabadi Dum Biryani']);
  });

  test('a word from the description finds it, ranked below a name match', () => {
    const found = names(search('sambar', DISHES));
    expect(found).toContain('Masala Dosa');
  });

  test('an empty query is the whole menu, in the shop own order', () => {
    expect(names(search('', DISHES))).toEqual(names(DISHES));
    expect(names(search('   ', DISHES))).toEqual(names(DISHES));
  });
});

describe('spelled the way people actually type', () => {
  /* Each of these is a real misspelling somebody has typed into a food app. */
  test.each([
    ['panner', 'Paneer Butter Masala'],
    ['biriyani', 'Hyderabadi Dum Biryani'],
    ['manchurain', 'Gobi Manchurian'],
    ['masla dosa', 'Masala Dosa'],
    ['buter naan', 'Butter Naan'],
  ])('%s finds %s', (typed, expected) => {
    expect(names(search(typed, DISHES))).toContain(expected);
  });

  test('two adjacent letters swapped costs one mistake, not two', () => {
    /* The reason this is Damerau rather than plain Levenshtein. To a person,
       "biriyani" is one slip. */
    expect(editDistance('biriyani', 'biryani', 2)).toBeLessThanOrEqual(2);
  });
});

describe('and refuses what it should', () => {
  /*
   * THE ONE THAT KEEPS IT USEFUL.
   *
   * A fixed edit budget of two turns "dal" into "dosa", and every short word
   * matches every other short word. Under five characters nothing is forgiven,
   * so a three-letter search stays a three-letter search.
   */
  test('a short word is matched strictly', () => {
    const found = names(search('dal', DISHES));
    expect(found).toContain('Dal Tadka');
    expect(found).not.toContain('Masala Dosa');
  });

  test('a word nobody on the menu resembles finds nothing', () => {
    expect(search('lasagne', DISHES)).toEqual([]);
    expect(search('xylophone', DISHES)).toEqual([]);
  });

  /*
   * A customer who typed two words meant both of them. Matching on one would
   * put Butter Chicken above the naan somebody plainly asked for.
   */
  test('every word has to find something', () => {
    expect(names(search('butter lasagne', DISHES))).toEqual([]);
    expect(names(search('butter naan', DISHES))).toContain('Butter Naan');
  });
});

describe('ranking', () => {
  test('an exact word beats a prefix beats a substring beats a typo', () => {
    expect(scoreWord('naan', 'naan')).toBeGreaterThan(scoreWord('naan', 'naanbread'));
    expect(scoreWord('naan', 'naanbread')).toBeGreaterThan(scoreWord('aan', 'naan'));
    expect(scoreWord('aan', 'naan')).toBeGreaterThan(scoreWord('paneeer', 'paneer'));
  });

  test('a name match outranks the same word in a description', () => {
    const inName = score('masala', { name: 'Masala Dosa', description: '' });
    const inDesc = score('masala', { name: 'Aloo Gobi', description: 'masala and cumin' });
    expect(inName.score).toBeGreaterThan(inDesc.score);
  });

  test('equal matches keep the shop own order rather than going alphabetical', () => {
    /* A menu is arranged deliberately - starters before mains, the chef's own
       sequence - and scrambling ties throws that away for nothing. */
    const two = [
      { name: 'Masala Dosa', description: '' },
      { name: 'Masala Chai', description: '' },
    ];
    expect(names(search('masala', two))).toEqual(['Masala Dosa', 'Masala Chai']);
  });
});

describe('normalize', () => {
  test('case, accents and punctuation stop mattering', () => {
    expect(normalize('  Café   Mocha!! ')).toBe('cafe mocha');
    expect(normalize('Chicken-65')).toBe('chicken 65');
  });

  test('junk is an empty string, not a crash', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});
