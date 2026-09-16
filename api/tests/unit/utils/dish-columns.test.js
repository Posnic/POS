'use strict';

/*
 * A MENU FILLED IN FROM A FILE.
 *
 * Owner: "you need to fill the details of menu. description and nutrition,
 * veg or non veg, other all details needs to be filled one by one. very
 * detailed."
 *
 * These are the rules that decide what a column is allowed to do to a dish.
 * The two that carry the most weight are the least obvious:
 *
 *   A column the file does not have changes nothing - which is what stops
 *   the ordinary eighteen-column re-import from wiping a menu that somebody
 *   spent a week writing.
 *
 *   Numbers that arrive in a file are an estimate unless the file says a
 *   kitchen stands behind them, because the empty source is what turns the
 *   calorie figure and the health claims ON.
 */

const dishColumns = require('../../../src/utils/dish-columns');
const dishFacts = require('../../../src/utils/dish-facts');

/* The eighteen columns the item export has produced for years. */
const LEGACY_ROW = Object.freeze({
  name: 'Chicken Biryani',
  itemid: 'BIR-1',
  barcode_id: '',
  category_name: 'Biryani',
  supplier_name: 'Kitchen',
  discount_amount: 0,
  discount_percentage: 0,
  hsncode: '',
  hsndescription: '',
  tax_name: 'gst5%',
  tax: 5,
  tax_type: 'exclusive',
  mrp_price: 260,
  company_price: 120,
  selling_price: 240,
  available_quantity: 50,
  unit: 'qty',
  sort_order: 1,
});

describe('a file that says nothing about a dish', () => {
  test('CHANGES NOTHING ABOUT THE DISH', () => {
    /*
     * The rule the whole feature rests on. Every shop on the estate re-imports
     * this file to change prices; if a missing column meant "make it empty",
     * the first price update after a menu was written would erase the menu.
     */
    const read = dishColumns.fromRow(LEGACY_ROW);
    expect(read.fields).toEqual({});
    expect(read.nutrition).toBeNull();
    expect(read.pairings).toBeNull();
    expect(read.notes).toEqual([]);
  });

  test('and a row of nothing at all does not throw', () => {
    expect(dishColumns.fromRow(null).fields).toEqual({});
    expect(dishColumns.fromRow(undefined).fields).toEqual({});
    expect(dishColumns.fromRow({}).fields).toEqual({});
  });
});

describe('a column that is there and empty', () => {
  test('clears the field, because that is the only way to take a value back out', () => {
    const read = dishColumns.fromRow({
      description: '',
      diet: '',
      food_tags: '',
      menu_marks: '',
      prep_note: '',
      prep_minutes: '',
      goes_with: '',
    });
    expect(read.fields.description).toBe('');
    expect(read.fields.diet).toBe('');
    expect(read.fields.food_tags).toEqual([]);
    expect(read.fields.menu_marks).toEqual([]);
    expect(read.fields.prep_note).toBe('');
    expect(read.fields.prep_minutes).toBe(0);
    expect(read.pairings).toEqual([]);
  });

  test('and an empty nutrient asks for that one nutrient to be removed', () => {
    const read = dishColumns.fromRow({ calories: '', protein_g: '12' });
    expect(read.nutrition).toEqual({ kcal: null, protein_g: 12 });
  });
});

describe('the veg mark', () => {
  test.each([
    ['veg', 'veg'],
    ['Veg', 'veg'],
    ['VEGETARIAN', 'veg'],
    ['v', 'veg'],
    ['Non Veg', 'non_veg'],
    ['non-veg', 'non_veg'],
    ['nonveg', 'non_veg'],
    ['non_veg', 'non_veg'],
    ['N', 'non_veg'],
    ['n.v.', 'non_veg'],
    ['Egg', 'egg'],
    ['eggetarian', 'egg'],
    ['Vegan', 'vegan'],
  ])('"%s" is stored as %s', (typed, stored) => {
    expect(dishColumns.fromRow({ diet: typed }).fields.diet).toBe(stored);
  });

  test('AND A WORD NOBODY RECOGNISES LEAVES NO MARK, AND SAYS SO', () => {
    /*
     * A dish that looks unmarked because of a typo is worse than one that is
     * honestly unmarked: somebody with a dietary restriction reads both the
     * same way, and only one of them is telling the truth.
     */
    const read = dishColumns.fromRow({ diet: 'pescatarian' });
    expect(read.fields.diet).toBe('');
    expect(read.notes.join(' ')).toContain('pescatarian');
  });

  test('and the header may be the one a kitchen would write', () => {
    expect(dishColumns.fromRow({ food_type: 'veg' }).fields.diet).toBe('veg');
    expect(dishColumns.fromRow({ veg_nonveg: 'non veg' }).fields.diet).toBe('non_veg');
  });
});

describe('what may be said about a recipe', () => {
  test('A HEALTH CLAIM ASKED FOR BY NAME STORES NOTHING', () => {
    /*
     * The reason this file exists rather than a block inside the import. The
     * item form filters food tags against the tickable list so that
     * `heart_healthy` - a regulated claim - cannot be ticked; a CSV that
     * skipped the filter would be a back door onto a live menu.
     */
    const read = dishColumns.fromRow({ food_tags: 'nut_free; heart_healthy; keto' });
    expect(read.fields.food_tags).toEqual(['nut_free']);
    expect(read.notes.join(' ')).toContain('heart_healthy');
    expect(read.notes.join(' ')).toContain('keto');
  });

  test('every real recipe fact is accepted', () => {
    const read = dishColumns.fromRow({ food_tags: dishFacts.FOOD_TAGS.join(';') });
    expect(read.fields.food_tags).toEqual([...dishFacts.FOOD_TAGS]);
    expect(read.notes).toEqual([]);
  });

  test('a tag typed with a space or a dash still lands', () => {
    const read = dishColumns.fromRow({ food_tags: 'Gluten Free | no-added-sugar' });
    expect(read.fields.food_tags).toEqual(['gluten_free', 'no_added_sugar']);
  });

  test('and the marks a shop is free to choose are separate from the facts', () => {
    const read = dishColumns.fromRow({ menu_marks: 'signature, chefs pick, heart_healthy' });
    expect(read.fields.menu_marks).toEqual(['signature', 'chefs_pick']);
    expect(read.notes.join(' ')).toContain('heart_healthy');
  });
});

describe('the nutrition, and who stands behind it', () => {
  test('NUMBERS IN A FILE ARE AN ESTIMATE UNLESS THE FILE SAYS A KITCHEN SAID SO', () => {
    /*
     * The one mistake here that could actually hurt somebody. An empty
     * `nutrition_source` means a person entered these figures, and the product
     * then publishes the calorie count and every claim the numbers support. A
     * spreadsheet of nutrition drafted from standard recipes, imported with no
     * source column, would otherwise arrive claiming a kitchen had checked it.
     */
    const read = dishColumns.fromRow({ calories: '520', protein_g: '28' });
    expect(read.fields.nutrition_source).toBe('estimated');
  });

  test('and writing the word kitchen is a person saying it, which is allowed', () => {
    const read = dishColumns.fromRow({ calories: '520', nutrition_source: 'Kitchen' });
    expect(read.fields.nutrition_source).toBe('');
    expect(read.notes).toEqual([]);
  });

  test('anything else in that column is still an estimate, and is reported', () => {
    const read = dishColumns.fromRow({ calories: '520', nutrition_source: 'chef' });
    expect(read.fields.nutrition_source).toBe('estimated');
    expect(read.notes.join(' ')).toContain('chef');
  });

  test('a file that says nothing about nutrition does not touch the source either', () => {
    const read = dishColumns.fromRow({ description: 'Rice' });
    expect(read.fields).not.toHaveProperty('nutrition_source');
  });

  test('"about 300" IS NOT SAID, rather than stored as something', () => {
    const read = dishColumns.fromRow({ calories: 'about 300' });
    expect(read.nutrition).toEqual({ kcal: null });
    expect(read.notes.join(' ')).toContain('not a number');
  });

  test('every nutrient has a column, under the name a person would write', () => {
    const read = dishColumns.fromRow({
      calories: 520,
      protein: 28,
      carbs: 60,
      fat: 18,
      saturated_fat_g: 6,
      fiber_g: 3,
      sugar: 4,
      sodium: 900,
    });
    expect(read.nutrition).toEqual({
      kcal: 520,
      protein_g: 28,
      carbs_g: 60,
      fat_g: 18,
      sat_fat_g: 6,
      fibre_g: 3,
      sugar_g: 4,
      sodium_mg: 900,
    });
  });

  test('and a file carrying two names for one nutrient is decided by the file, not by key order', () => {
    const read = dishColumns.fromRow({ calories: '100', kcal: '999' });
    expect(read.nutrition).toEqual({ kcal: 100 });
  });
});

describe('the rest of the detail', () => {
  test('a description is trimmed, a prep note is capped', () => {
    expect(dishColumns.fromRow({ description: '  Rice  ' }).fields.description).toBe('Rice');
    const long = 'x'.repeat(500);
    expect(dishColumns.fromRow({ prep_note: long }).fields.prep_note).toHaveLength(200);
  });

  test('prep minutes are whole, and never longer than the form allows', () => {
    expect(dishColumns.fromRow({ prep_minutes: '12.6' }).fields.prep_minutes).toBe(13);
    expect(dishColumns.fromRow({ prep_minutes: '900' }).fields.prep_minutes).toBe(480);
    expect(dishColumns.fromRow({ prep_minutes: '-5' }).fields.prep_minutes).toBe(0);
  });

  test('a prep time that is not a number leaves the stored one alone', () => {
    const read = dishColumns.fromRow({ prep_minutes: 'quick' });
    expect(read.fields).not.toHaveProperty('prep_minutes');
    expect(read.notes.join(' ')).toContain('quick');
  });

  test.each([
    ['yes', true],
    ['Y', true],
    ['TRUE', true],
    ['1', true],
    ['no', false],
    ['n', false],
    ['0', false],
    ['', false],
  ])('spice_choice "%s" reads as %s', (typed, stored) => {
    expect(dishColumns.fromRow({ spice_choice: typed }).fields.spice_choice).toBe(stored);
  });

  test('and a spice cell that is neither leaves it alone and says so', () => {
    const read = dishColumns.fromRow({ spice_choice: 'medium only' });
    expect(read.fields).not.toHaveProperty('spice_choice');
    expect(read.notes.join(' ')).toContain('medium only');
  });

  test('an icon is one emoji, and a word is reported rather than dropped', () => {
    expect(dishColumns.fromRow({ icon: '🍛' }).fields.icon).toBe('🍛');
    const read = dishColumns.fromRow({ icon: 'biryani' });
    expect(read.fields.icon).toBe('');
    expect(read.notes.join(' ')).toContain('not an emoji');
  });

  test('a header keeps working however it is capitalised or spaced', () => {
    const read = dishColumns.fromRow({ ' Prep Minutes ': '12', 'Food Tags': 'jain' });
    expect(read.fields.prep_minutes).toBe(12);
    expect(read.fields.food_tags).toEqual(['jain']);
  });
});

describe('what goes with a dish', () => {
  test('arrives as NAMES, because nobody types an ObjectId into a spreadsheet', () => {
    const read = dishColumns.fromRow({ goes_with: 'Chicken 65; Virgin Mojito | Coke' });
    expect(read.pairings).toEqual(['Chicken 65', 'Virgin Mojito', 'Coke']);
  });

  test('AND A COMMA IS PART OF A DISH NAME, NOT A SEPARATOR', () => {
    /* "Chicken 65, Boneless" is one dish. Tags split on a comma because no tag
       contains one; names cannot afford to. */
    const read = dishColumns.fromRow({ goes_with: 'Chicken 65, Boneless; Coke' });
    expect(read.pairings).toEqual(['Chicken 65, Boneless', 'Coke']);
  });

  test('and six is the cap, the same as the form', () => {
    const read = dishColumns.fromRow({ goes_with: 'a;b;c;d;e;f;g;h' });
    expect(read.pairings).toHaveLength(6);
  });
});

describe('merging nutrition with what the dish already has', () => {
  test('a file with only a calories column leaves the protein alone', () => {
    const merged = dishColumns.mergeNutrition({ kcal: 100, protein_g: 9 }, { kcal: 520 });
    expect(merged).toEqual({ kcal: 520, protein_g: 9 });
  });

  test('and an empty cell removes that one nutrient', () => {
    const merged = dishColumns.mergeNutrition({ kcal: 100, protein_g: 9 }, { protein_g: null });
    expect(merged).toEqual({ kcal: 100 });
  });

  test('a file that said nothing returns nothing, which means LEAVE THE FIELD ALONE', () => {
    /* Not an empty object - that would be a write, and a write of nothing is
       how a re-import erases a dish. */
    expect(dishColumns.mergeNutrition({ kcal: 100 }, null)).toBeNull();
    expect(dishColumns.mergeNutrition({ kcal: 100 }, undefined)).toBeNull();
  });

  test('and whatever is stored is cleaned on the way back out', () => {
    const merged = dishColumns.mergeNutrition({ kcal: 'lots', protein_g: -4 }, { fat_g: 3 });
    expect(merged).toEqual({ fat_g: 3 });
  });
});

describe('the column list itself', () => {
  test('names every nutrient dish-facts knows', () => {
    /* A nutrient added to dish-facts with no column here is a box on the item
       screen that a file can never fill in. */
    for (const nutrient of dishFacts.NUTRIENTS) {
      const header = nutrient === 'kcal' ? 'calories' : nutrient;
      expect(dishColumns.COLUMNS).toContain(header);
      expect(dishColumns.fromRow({ [header]: 1 }).nutrition).toHaveProperty(nutrient);
    }
  });

  test('and every column it lists is one it reads', () => {
    for (const column of dishColumns.COLUMNS) {
      const read = dishColumns.fromRow({ [column]: '' });
      const touched =
        Object.keys(read.fields).length > 0 || read.nutrition !== null || read.pairings !== null;
      expect(touched).toBe(true);
    }
  });
});
