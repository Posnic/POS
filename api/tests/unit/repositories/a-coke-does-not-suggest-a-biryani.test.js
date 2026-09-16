'use strict';

/*
 * A suggestion goes from the dish to the accompaniment, and never back.
 *
 * Owner: "cross selling also do that. example chickent briyani link to
 * chicken 65 or mojito or coke. but coke should not suggest the briyani."
 *
 * WHY IT DID
 *
 * Cross-selling has two halves. The shop's own `goes_with` was always
 * directional - putting a chicken 65 under a biryani does not put a biryani
 * under the chicken 65. The learned half was not: `salesSignals` counts every
 * pair in BOTH directions, on purpose, because it is measuring which dishes
 * travel together and that is a symmetric fact.
 *
 * A suggestion is not symmetric. Somebody holding a biryani may well want a
 * drink. Nobody holding a drink is one nudge away from a biryani, and being
 * offered one reads as a shop trying to sell rather than a shop helping. So a
 * coke that had sold beside a biryani four hundred times suggested it back.
 *
 * THE RULE: a suggestion may not cost more than the dish it is suggested
 * under. It needs nothing set up - no categories to maintain, no list of what
 * counts as a main - which matters on a menu nobody has tidied. And the shop
 * can still overrule it outright, because `goes_with` is never filtered.
 *
 * Same complaint this area came from once already: "for checken briyani its
 * suggessting french fries. not good combination."
 */

/*
 * THE PROTOTYPE, not an instance.
 *
 * item.repository exports the CLASS, and constructing one drags in the whole
 * per-shop connection machinery to call two functions that touch neither.
 * Both of these use only their arguments - no `this`, no database - which is
 * what makes the pairing rule testable at all.
 */
const ItemRepository = require('../../../src/repositories/item.repository');
const repo = ItemRepository.prototype;

/* One shop's menu, at the prices that make the rule bite. */
const BIRYANI = { _id: 'biryani', name: 'Chicken Biryani', selling_price: 240 };
const CHICKEN65 = { _id: 'chicken65', name: 'Chicken 65', selling_price: 180 };
const MOJITO = { _id: 'mojito', name: 'Virgin Mojito', selling_price: 120 };
const COKE = { _id: 'coke', name: 'Coke', selling_price: 60 };
const MENU = [BIRYANI, CHICKEN65, MOJITO, COKE];

const priceOf = repo.priceLookup(MENU);
const learned = (...ids) => ids.map((id, i) => ({ id, count: 100 - i }));

/* ------------------------------------------------------------ the ask */

describe('what a dish offers, and what it does not', () => {
  test('A BIRYANI OFFERS THE CHICKEN 65, THE MOJITO AND THE COKE', () => {
    const out = repo.pairingsFor(BIRYANI, learned('chicken65', 'mojito', 'coke'), priceOf);
    expect(out).toEqual(['chicken65', 'mojito', 'coke']);
  });

  test('AND THE COKE DOES NOT OFFER THE BIRYANI BACK', () => {
    /* The sentence this whole change exists for. */
    const out = repo.pairingsFor(COKE, learned('biryani', 'chicken65', 'mojito'), priceOf);
    expect(out).not.toContain('biryani');
    expect(out).not.toContain('chicken65');
    expect(out).not.toContain('mojito');
  });

  test('a drink may still offer another drink of the same price', () => {
    /* The rule is "not more expensive", not "nothing at all". A coke beside a
       cheaper thing is a perfectly good suggestion. */
    const WATER = { _id: 'water', name: 'Water', selling_price: 20 };
    const withWater = repo.priceLookup([...MENU, WATER]);
    expect(repo.pairingsFor(COKE, learned('water'), withWater)).toEqual(['water']);
  });

  test('and equal prices are allowed, because equal is not more', () => {
    const LIME = { _id: 'lime', name: 'Lime Soda', selling_price: 60 };
    const withLime = repo.priceLookup([...MENU, LIME]);
    expect(repo.pairingsFor(COKE, learned('lime'), withLime)).toEqual(['lime']);
  });
});

/* ------------------------------------------- what the shop says still wins */

describe('the shop can always overrule it', () => {
  test('AN EXPLICIT PAIRING IS NEVER FILTERED, whatever it costs', () => {
    /*
     * A shop that has taken the trouble to pair a dish has overruled the
     * statistics on purpose - most often to STOP a pairing the numbers keep
     * producing. Applying the price rule to their own answer would be the
     * product arguing with the person who wrote the menu.
     */
    const cokeWithABiryaniUnderIt = { ...COKE, goes_with: ['biryani'] };
    const out = repo.pairingsFor(cokeWithABiryaniUnderIt, learned('mojito'), priceOf);
    expect(out).toContain('biryani');
  });

  test('and what the shop said comes first', () => {
    const said = { ...BIRYANI, goes_with: ['coke'] };
    const out = repo.pairingsFor(said, learned('chicken65', 'mojito'), priceOf);
    expect(out[0]).toBe('coke');
  });
});

/* ------------------------------------------------- it changes nothing else */

describe('it is the same function it was, without a price', () => {
  test('NO PRICE LOOKUP MEANS NO FILTERING AT ALL', () => {
    /*
     * An older caller, or a row read without the field. The rule is an
     * improvement on a suggestion, never a gate on one: a menu that cannot
     * price itself should suggest what it always suggested rather than
     * suddenly suggesting nothing.
     */
    const out = repo.pairingsFor(COKE, learned('biryani', 'chicken65'));
    expect(out).toEqual(['biryani', 'chicken65']);
  });

  test('and a dish with no price of its own filters nothing', () => {
    const unpriced = { _id: 'mystery', name: 'Mystery' };
    const out = repo.pairingsFor(unpriced, learned('biryani'), priceOf);
    expect(out).toEqual(['biryani']);
  });

  test('a candidate with no price is kept, not dropped', () => {
    /* Absent is "not said", never "expensive". Dropping it would quietly
       empty the suggestions on a half-priced menu. */
    const out = repo.pairingsFor(COKE, learned('nosuchdish'), priceOf);
    expect(out).toEqual(['nosuchdish']);
  });

  test('still three at most, because that is what fits under a dish', () => {
    const out = repo.pairingsFor(BIRYANI, learned('chicken65', 'mojito', 'coke', 'extra'), priceOf);
    expect(out).toHaveLength(3);
  });

  test('and a dish is never paired with itself', () => {
    const out = repo.pairingsFor(BIRYANI, learned('biryani', 'coke'), priceOf);
    expect(out[0]).not.toBe('biryani');
  });
});

/* ------------------------------------------------------- the lookup itself */

describe('the price lookup', () => {
  test('answers for an id and for a whole dish', () => {
    expect(priceOf('biryani')).toBe(240);
    expect(priceOf(BIRYANI)).toBe(240);
  });

  test('prefers the price on the row it was handed', () => {
    /* The anchor arrives as a full row and may be fresher than the map. */
    expect(priceOf({ _id: 'biryani', selling_price: 300 })).toBe(300);
  });

  test('reads either spelling of the price', () => {
    const lookup = repo.priceLookup([{ id: 'x', price: 99 }]);
    expect(lookup('x')).toBe(99);
  });

  test('and answers NaN rather than zero for a dish it does not know', () => {
    /* Zero would read as free, which is cheaper than everything, which would
       let an unknown dish be suggested under anything at all. */
    expect(Number.isNaN(priceOf('nosuchdish'))).toBe(true);
    expect(Number.isNaN(priceOf(null))).toBe(true);
  });
});
