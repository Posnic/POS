'use strict';

/**
 * The search engine exists twice, and the two copies have to agree.
 *
 * WHY IT IS DUPLICATED AT ALL.
 *
 * `api/src/utils/menu-search.js` is the server's copy; the menu bundle carries
 * a port of the same arithmetic. The bundle is plain scripts served to a phone
 * with no build step and no module loader, and being fast on a bad connection
 * is the entire reason that page exists - giving it a bundler to share ninety
 * lines would cost more than the duplication does.
 *
 * What the duplication cannot be allowed to cost is DIFFERENT ANSWERS. A menu
 * that finds "panner" where the server would not, or ranks two dishes the
 * other way round, is one bug reported as two.
 *
 * So this runs the same queries through both and compares. It is the price of
 * the copy, paid here rather than by whoever meets the divergence later.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const server = require(path.join(ROOT, 'api', 'src', 'utils', 'menu-search.js'));

/** The bundle's copy, lifted out and run on its own. */
function browserCopy() {
  const src = fs.readFileSync(path.join(ROOT, 'menu', 'menu.js'), 'utf8');

  const from = src.indexOf('  function normalize(value) {');
  const to = src.indexOf('  /* -------------------------------------------------------------- search */');
  assert.ok(from !== -1 && to > from, 'the ported engine is gone or moved');

  const sandbox = { String, Math, Array };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(from, to) + '\n;({ normalize, scoreWord, scoreItem, budgetFor })', sandbox);
  return vm.runInContext('({ normalize, scoreWord, scoreItem, budgetFor })', sandbox);
}

const browser = browserCopy();

const QUERIES = [
  'paneer',
  'panner',
  'biriyani',
  'biryani',
  'manchurain',
  'butter naan',
  'buter naan',
  'dal',
  'dosa',
  'masla dosa',
  'lasagne',
  'bir',
  'chicken 65',
  '',
  '   ',
];

const FIELDS = [
  { name: 'Paneer Butter Masala', description: 'Tomato and cashew gravy', category: 'Mains' },
  { name: 'Hyderabadi Dum Biryani', description: 'Slow cooked, saffron', category: 'Mains' },
  { name: 'Butter Naan', description: '', category: 'Breads' },
  { name: 'Gobi Manchurian', description: 'Cauliflower, soy and garlic', category: 'Starters' },
  { name: 'Masala Dosa', description: 'Potato masala, sambar', category: 'Breakfast' },
  { name: 'Dal Tadka', description: 'Yellow lentils', category: 'Mains' },
  { name: 'Chicken-65', description: 'Chettinad style', category: 'Starters' },
];

test('both copies normalise a string the same way', () => {
  for (const q of [...QUERIES, 'Café Mocha!!', 'Chicken-65', null, undefined]) {
    assert.strictEqual(
      browser.normalize(q),
      server.normalize(q),
      `normalize disagreed on ${JSON.stringify(q)}`
    );
  }
});

test('both copies give a word the same slack', () => {
  for (let n = 0; n <= 14; n += 1) {
    assert.strictEqual(browser.budgetFor(n), server.budgetFor(n), `budget disagreed at length ${n}`);
  }
});

test('both copies score a word identically', () => {
  const words = ['naan', 'naanbread', 'paneer', 'panner', 'dal', 'dosa', 'biryani', 'biriyani'];
  for (const a of words) {
    for (const b of words) {
      assert.strictEqual(
        browser.scoreWord(a, b),
        server.scoreWord(a, b),
        `scoreWord disagreed on "${a}" against "${b}"`
      );
    }
  }
});

/*
 * THE ONE THAT MATTERS TO A CUSTOMER.
 *
 * Not just whether each finds the dish, but whether they agree on how WELL -
 * because the score is the order results appear in, and two copies that agree
 * on matching and disagree on ranking still show two different menus.
 */
test('both copies match and rank every query the same', () => {
  const disagreements = [];

  for (const query of QUERIES) {
    for (const fields of FIELDS) {
      const a = browser.scoreItem(query, fields);
      const b = server.score(query, fields);
      if (a.match !== b.match || a.score !== b.score) {
        disagreements.push(
          `"${query}" against "${fields.name}": browser ${JSON.stringify(a)} server ${JSON.stringify(b)}`
        );
      }
    }
  }

  assert.deepStrictEqual(disagreements, [], disagreements.join('\n  '));
});

test('the misspellings people actually type are found by both', () => {
  /* Named explicitly so a regression reads as itself rather than as a count
     of disagreements. */
  const cases = [
    ['panner', 'Paneer Butter Masala'],
    ['biriyani', 'Hyderabadi Dum Biryani'],
    ['manchurain', 'Gobi Manchurian'],
    ['buter naan', 'Butter Naan'],
  ];

  for (const [typed, dish] of cases) {
    const fields = FIELDS.find((f) => f.name === dish);
    assert.ok(browser.scoreItem(typed, fields).match, `the menu cannot find ${dish} from "${typed}"`);
    assert.ok(server.score(typed, fields).match, `the server cannot find ${dish} from "${typed}"`);
  }
});

test('a short word stays strict in both, so dal does not find dosa', () => {
  const dosa = FIELDS.find((f) => f.name === 'Masala Dosa');
  assert.strictEqual(browser.scoreItem('dal', dosa).match, false);
  assert.strictEqual(server.score('dal', dosa).match, false);
});
