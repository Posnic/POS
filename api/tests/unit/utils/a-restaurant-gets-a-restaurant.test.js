'use strict';

/*
 * A restaurant that signs up is shown a restaurant.
 *
 * It was shown a COFFEE SHOP. "restaurant" pointed at the cafe pack - espresso,
 * smoothies, a croissant and a litre of milk - because that was the closest
 * catalogue that existed, and the note in demoData.js said exactly that:
 * "Closer than groceries, which is where it landed before."
 *
 * Closer is not right. A restaurant that signed up had to delete fifteen
 * coffee-shop products before it could type its first dish.
 *
 * AND THE PACK ALONE WOULD NOT HAVE BEEN ENOUGH. The installer builds each
 * item from a fixed object literal - a whitelist - and a field the pack carries
 * that the literal does not NAME is dropped on the way in, silently. That is
 * the third time this shape of bug has cost this program a feature: the
 * ordering catalogue dropped the dish facts, then the market price, and the
 * seeder would have dropped every one of these. So the fields are asserted at
 * BOTH ends, the pack and the installer.
 */

const demo = require('../../../utils/demoData');
const fs = require('fs');
const path = require('path');

const pack = demo.getDemoDataByType('restaurant');

describe('the word "restaurant"', () => {
  test('no longer answers with a coffee shop', () => {
    expect(pack).toBe(demo.restaurantDemoData);
    expect(pack).not.toBe(demo.cafeDemoData);
  });

  test('a cafe still gets the cafe, which was never wrong for a cafe', () => {
    expect(demo.getDemoDataByType('cafe')).toBe(demo.cafeDemoData);
    expect(demo.getDemoDataByType('coffee')).toBe(demo.cafeDemoData);
  });

  test('the chooser offers the two under different names', () => {
    /*
     * The labels are what a shopkeeper picks from. Leaving "Cafe & restaurant"
     * on the cafe pack would send half the restaurants straight back to the
     * coffee shop by hand.
     */
    expect(demo.DEMO_PACK_LABELS.restaurant).toBe('Restaurant');
    expect(demo.DEMO_PACK_LABELS.cafe).not.toMatch(/restaurant/i);
    const keys = demo.listDemoPacks().map((p) => p.key);
    expect(keys).toContain('restaurant');
  });
});

describe('the menu it hands over', () => {
  test('every dish belongs to a section the pack defines', () => {
    /* The installer looks each category up and simply skips a product whose
       category it cannot find, with nothing to say why. */
    const sections = new Set(pack.categories.map((c) => c.name));
    for (const dish of pack.products) expect(sections.has(dish.category)).toBe(true);
  });

  test('prices are on the same scale as every other pack', () => {
    /*
     * These install in whatever currency the shop trades in. A menu priced in
     * hundreds would arrive in a Dublin restaurant as a 380 euro biryani.
     */
    for (const dish of pack.products) {
      expect(typeof dish.price).toBe('number');
      expect(dish.price).toBeGreaterThan(0);
      expect(dish.price).toBeLessThan(20);
    }
  });

  test('every dish says whether it is veg, so the veg filter has work to do', () => {
    /* An ordering page whose veg filter matches every dish or none of them
       hides the filter entirely - which is what a menu with no diet marks
       gets, and what every demo shop had until now. */
    const marks = new Set(pack.products.map((d) => d.diet));
    for (const dish of pack.products) {
      expect(['veg', 'non_veg', 'egg', 'vegan']).toContain(dish.diet);
    }
    expect(marks.size).toBeGreaterThan(1);
  });

  test('prep times are stated, which two separate features need', () => {
    /*
     * The dish sheet says "takes about 20 minutes", and the busy-kitchen
     * notice takes the shop's MEDIAN prep time as its round length - so a menu
     * with no prep times can tell a customer the kitchen is behind and never
     * by how much.
     */
    const stated = pack.products.filter((d) => Number(d.prep_minutes) > 0);
    expect(stated.length).toBeGreaterThan(pack.products.length / 2);

    const { typicalRound } = require('../../../src/utils/kitchen-load');
    expect(typicalRound(pack.products.map((d) => d.prep_minutes))).toBeGreaterThan(0);
  });
});

describe('the spice choice, which is the whole argument for it being per dish', () => {
  const offered = pack.products.filter((d) => d.spice_choice === true);

  test('some dishes offer it', () => {
    expect(offered.length).toBeGreaterThan(0);
  });

  test('and most do not, which is the point', () => {
    /*
     * If a demo menu ticked every dish it would teach the opposite of the
     * rule: the tick exists BECAUSE a kitchen cannot cook everything to
     * order. A pack that ticked all 22 would be a worked example of the
     * mistake the feature is designed to prevent.
     */
    expect(offered.length).toBeLessThan(pack.products.length / 2);
  });

  test('nothing sweet or poured offers it', () => {
    for (const dish of pack.products) {
      if (dish.category === 'Desserts' || dish.category === 'Beverages') {
        expect(dish.spice_choice).not.toBe(true);
      }
    }
  });

  test('the batch-cooked dishes do not offer it either', () => {
    /*
     * The two dishes a real kitchen makes once, in one pot, for the whole
     * service. They are in the pack precisely so the menu shows a curry that
     * CANNOT be made mild sitting beside ones that can.
     */
    for (const name of ['Dal Tadka', 'Chicken Biryani']) {
      const dish = pack.products.find((d) => d.name === name);
      expect(dish).toBeTruthy();
      expect(dish.spice_choice).not.toBe(true);
    }
  });
});

describe('nutrition, on some dishes and not all', () => {
  test('a handful carry numbers', () => {
    expect(pack.products.filter((d) => d.nutrition).length).toBeGreaterThan(2);
  });

  test('most do not, which is what a half-filled menu really looks like', () => {
    /* And it demonstrates the rule: badges appear only on the dishes whose
       numbers earn them, rather than on everything. */
    const withNumbers = pack.products.filter((d) => d.nutrition).length;
    expect(withNumbers).toBeLessThan(pack.products.length / 2);
  });

  test('no dish carries a health claim, because claims are never stored', () => {
    /*
     * The owner's rule: a badge may appear "only when the recipe/nutrition
     * actually supports the claim". The only guarantee of that is that there
     * is no way to write one, demo data included.
     */
    for (const dish of pack.products) {
      expect(dish.claims).toBeUndefined();
      expect(dish.health_tags).toBeUndefined();
    }
  });

  test('the numbers a dish states earn it real badges', () => {
    /* Grilled Fish is lean and high in protein. Nothing says so on the dish;
       it is worked out from the figures at read time. */
    const dishFacts = require('../../../src/utils/dish-facts');
    const fish = pack.products.find((d) => d.name === 'Grilled Fish');
    const facts = dishFacts.factsFor({ nutrition: fish.nutrition, food_tags: fish.food_tags });
    expect(facts.claims.length).toBeGreaterThan(0);
  });
});

describe('the installer carries them, or the pack may as well not say them', () => {
  /*
   * A source check rather than a seeded database, because the failure is not
   * that the write throws - it is that the field is quietly absent from the
   * object that gets written. There is nothing to observe at runtime except an
   * item that looks finished and has no diet mark.
   */
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'services', 'install.service.js'),
    'utf8'
  );
  const literal = (() => {
    const at = source.indexOf('itemMultiData.push({');
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    let i = source.indexOf('{', at + 19);
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return source.slice(at, i + 1);
  })();

  test.each(['diet', 'prep_minutes', 'spice_choice', 'nutrition', 'food_tags', 'menu_marks'])(
    'a seeded item keeps %s',
    (field) => {
      expect(literal).toMatch(new RegExp('[\\s{]' + field + ':'));
    }
  );

  test('the facts are cleaned on the way in, so a pack cannot smuggle a claim', () => {
    expect(literal).toMatch(/dishFacts\.cleanNutrition\(product\.nutrition\)/);
    expect(literal).toMatch(/dishFacts\.cleanTags\(product\.food_tags/);
    expect(literal).toMatch(/dishFacts\.cleanTags\(product\.menu_marks/);
  });

  test('a diet mark nobody recognises becomes "not said", not itself', () => {
    expect(literal).toMatch(/DIET_MARKS\.includes\(/);
  });
});
