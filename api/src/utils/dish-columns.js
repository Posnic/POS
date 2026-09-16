'use strict';

/*
 * THE DISH DETAIL, AS IT CROSSES A SPREADSHEET.
 *
 * Owner: "you need to fill the details of menu. description and nutrition,
 * veg or non veg, other all details needs to be filled one by one. very
 * detailed."
 *
 * Every one of those fields already exists on an item and already has a box
 * on the item screen. What did not exist was a way to fill in ninety of them
 * without opening ninety forms: the item import carries the price-and-stock
 * columns and nothing else, so a menu can only be detailed by hand.
 *
 * This is the translation between a column in a file and a field on a dish,
 * and it is its own file rather than a block inside the import because the
 * rules it enforces are the item screen's own rules. An import that could
 * write something the form would have refused is not an import, it is a back
 * door: the form filters food tags against the tickable list precisely so
 * that a client asking for `heart_healthy` stores nothing, and a CSV that
 * skipped that filter would put an unearned health claim on a live menu.
 *
 * THREE RULES DECIDE EVERYTHING BELOW.
 *
 *   A COLUMN THE FILE DOES NOT CARRY CHANGES NOTHING. This is what lets the
 *   existing eighteen-column export keep working untouched, and it is the
 *   opposite of how the rest of the import behaves - it rewrites its columns
 *   unconditionally, which is fine for a price and ruinous for a description
 *   somebody typed. So `fromRow` returns only the keys the row actually has,
 *   and the caller writes only those.
 *
 *   A COLUMN THAT IS THERE AND EMPTY CLEARS THE FIELD. Otherwise there is no
 *   way to remove a tag through the same door it was added by, and a
 *   spreadsheet that looks empty would not be.
 *
 *   NOTHING IS DROPPED IN SILENCE. A tag that is not a real tag, a diet word
 *   nobody recognises, a pairing naming a dish that is not on the menu: each
 *   comes back as a note the shop is told. A cell that vanishes quietly is
 *   how somebody spends an afternoon typing into a column nothing reads.
 */

const dishFacts = require('./dish-facts');
const dishIcons = require('./dish-icons');

/*
 * The diet mark, and the only list of it.
 *
 * It lived as a private const inside item.repository, which was fine while
 * exactly one place wrote the field. Two places write it now, and two lists
 * that agree today disagree after the first one is edited - with the
 * disagreement showing as a dish that renders unmarked, which somebody with
 * an allergy reads as "safe" rather than as "not said".
 */
const DIET_MARKS = Object.freeze(['veg', 'non_veg', 'egg', 'vegan']);

/*
 * What a person types for the diet, as opposed to what is stored.
 *
 * Nobody writes `non_veg` in a spreadsheet unless they were told to, and a
 * menu typed by a kitchen says "Non Veg" or "non-veg" or just "N". The stored
 * vocabulary does not move; this is only the set of ways in.
 */
const DIET_WORDS = Object.freeze({
  veg: 'veg',
  vegetarian: 'veg',
  v: 'veg',
  non_veg: 'non_veg',
  nonveg: 'non_veg',
  'non-veg': 'non_veg',
  'non veg': 'non_veg',
  nonvegetarian: 'non_veg',
  'non vegetarian': 'non_veg',
  'non-vegetarian': 'non_veg',
  n: 'non_veg',
  nv: 'non_veg',
  egg: 'egg',
  eggetarian: 'egg',
  e: 'egg',
  vegan: 'vegan',
});

/** Yes and no, in the spellings a spreadsheet actually contains. */
const YES = Object.freeze(['yes', 'y', 'true', '1', 'on']);
const NO = Object.freeze(['no', 'n', 'false', '0', 'off', '']);

/*
 * The nutrient columns, and the headers a person is likely to write.
 *
 * The stored keys come from dish-facts and are not restated here; this only
 * says which header lands on which of them. `calories` is the word on every
 * menu that does this, and `kcal` is the field.
 */
const NUTRIENT_COLUMNS = Object.freeze({
  kcal: 'kcal',
  calories: 'kcal',
  energy_kcal: 'kcal',
  protein_g: 'protein_g',
  protein: 'protein_g',
  carbs_g: 'carbs_g',
  carbs: 'carbs_g',
  carbohydrates_g: 'carbs_g',
  fat_g: 'fat_g',
  fat: 'fat_g',
  sat_fat_g: 'sat_fat_g',
  saturated_fat_g: 'sat_fat_g',
  fibre_g: 'fibre_g',
  fiber_g: 'fibre_g',
  sugar_g: 'sugar_g',
  sugar: 'sugar_g',
  sodium_mg: 'sodium_mg',
  sodium: 'sodium_mg',
});

/** The plain fields, and the headers that reach them. */
const FIELD_COLUMNS = Object.freeze({
  description: 'description',
  diet: 'diet',
  food_type: 'diet',
  veg_nonveg: 'diet',
  icon: 'icon',
  emoji: 'icon',
  spice_choice: 'spice_choice',
  prep_note: 'prep_note',
  kitchen_note: 'prep_note',
  prep_minutes: 'prep_minutes',
  ready_in_minutes: 'prep_minutes',
  food_tags: 'food_tags',
  menu_marks: 'menu_marks',
  goes_with: 'goes_with',
  nutrition_source: 'nutrition_source',
});

/** Every header this file understands, for a template or a document. */
const COLUMNS = Object.freeze([
  'description',
  'diet',
  'icon',
  'food_tags',
  'menu_marks',
  'spice_choice',
  'prep_note',
  'prep_minutes',
  'goes_with',
  'nutrition_source',
  'calories',
  'protein_g',
  'carbs_g',
  'fat_g',
  'sat_fat_g',
  'fibre_g',
  'sugar_g',
  'sodium_mg',
]);

/** A header as written, reduced to the shape the tables above are keyed by. */
function headerKey(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .join('_');
}

/** A cell, as text. */
function cell(value) {
  return String(value == null ? '' : value).trim();
}

/*
 * A list in one cell.
 *
 * Semicolon, pipe or comma, because somebody exporting from one spreadsheet
 * and opening it in another gets whichever their tool produced - and a comma
 * inside an unquoted cell is the commonest way a CSV arrives broken.
 * Accepting all three costs nothing, since none of them appears inside a tag.
 */
function list(value) {
  return cell(value)
    .split(/[;|,]/)
    .map((one) => one.trim())
    .filter(Boolean);
}

/** The same, for things whose own text may contain a comma: dish names. */
function nameList(value) {
  return cell(value)
    .split(/[;|]/)
    .map((one) => one.trim())
    .filter(Boolean);
}

/** A tag as somebody typed it, in the shape the tickable list is keyed by. */
function tagKey(raw) {
  return String(raw).trim().toLowerCase().split(' ').join('_').split('-').join('_');
}

/**
 * The dish detail a single CSV row carries.
 *
 * @param {object} row a row from the file, keyed by its own headers
 * @returns {{fields: object, nutrition: object|null, pairings: string[]|null, notes: string[]}}
 *   `fields` holds only the columns the row actually has, already normalised.
 *   `nutrition` is null when the row names no nutrient at all, and otherwise
 *   maps a stored nutrient key to a number, or to null meaning "clear this
 *   one". `pairings` is null when the row has no goes_with column, and
 *   otherwise the dish NAMES it asked for - ids are resolved by the caller,
 *   which is the only thing that knows the menu. `notes` is what was not
 *   understood, said in the shop's words rather than the field's.
 */
function fromRow(row) {
  const fields = {};
  const notes = [];
  let nutrition = null;
  let pairings = null;

  const seen = {};
  for (const rawHeader of Object.keys(row || {})) {
    const key = headerKey(rawHeader);
    const nutrient = NUTRIENT_COLUMNS[key];
    const field = FIELD_COLUMNS[key];
    if (!nutrient && !field) continue;

    /* First header wins, so a file carrying both `calories` and `kcal` is not
       decided by which key the parser happened to put first. */
    const target = nutrient ? `nutrition_${nutrient}` : field;
    if (seen[target]) continue;
    seen[target] = true;
    const raw = row[rawHeader];

    if (nutrient) {
      if (nutrition === null) nutrition = {};
      const text = cell(raw);
      if (text === '') {
        nutrition[nutrient] = null;
        continue;
      }
      const cleaned = dishFacts.cleanNutrition({ [nutrient]: text });
      if (Object.prototype.hasOwnProperty.call(cleaned, nutrient)) {
        nutrition[nutrient] = cleaned[nutrient];
      } else {
        /* "about 300" is not a number, and storing it as one would put a
           figure on a menu that nobody actually said. */
        nutrition[nutrient] = null;
        notes.push(nutrient + ' "' + text + '" is not a number, so it was left unsaid');
      }
      continue;
    }

    switch (field) {
      case 'description':
        fields.description = cell(raw);
        break;

      case 'diet': {
        const text = cell(raw);
        if (text === '') {
          fields.diet = '';
          break;
        }
        const word = text.toLowerCase().split('.').join('');
        const mark = DIET_WORDS[word] || (DIET_MARKS.includes(word) ? word : '');
        fields.diet = mark;
        if (!mark) {
          notes.push('"' + text + '" is not veg, non veg, egg or vegan, so no mark was set');
        }
        break;
      }

      case 'icon': {
        /* One emoji or nothing, cleaned exactly as the form cleans it: a
           field that accepts letters quietly becomes a second name. */
        const asked = cell(raw);
        fields.icon = dishIcons.clean(asked);
        if (asked && !fields.icon) {
          notes.push('icon "' + asked + '" is not an emoji, so no icon was set');
        }
        break;
      }

      case 'spice_choice': {
        const text = cell(raw).toLowerCase();
        if (YES.includes(text)) fields.spice_choice = true;
        else if (NO.includes(text)) fields.spice_choice = false;
        else
          notes.push('spice_choice "' + cell(raw) + '" is not a yes or a no, so it was left alone');
        break;
      }

      case 'prep_note':
        fields.prep_note = cell(raw).slice(0, 200);
        break;

      case 'prep_minutes': {
        const text = cell(raw);
        if (text === '') {
          fields.prep_minutes = 0;
          break;
        }
        const minutes = Number(text);
        if (Number.isFinite(minutes)) {
          fields.prep_minutes = Math.max(0, Math.min(480, Math.round(minutes)));
        } else {
          notes.push(
            'prep_minutes "' + text + '" is not a number of minutes, so it was left alone'
          );
        }
        break;
      }

      case 'food_tags':
      case 'menu_marks': {
        const allowed = field === 'food_tags' ? dishFacts.FOOD_TAGS : dishFacts.MENU_MARKS;
        const asked = list(raw).map(tagKey);
        const kept = dishFacts.cleanTags(asked, allowed);
        fields[field] = kept;
        for (const one of asked) {
          if (kept.includes(one)) continue;
          notes.push(
            field === 'food_tags'
              ? '"' + one + '" is not a recipe fact this menu can state, so it was not stored'
              : '"' + one + '" is not a menu mark, so it was not stored'
          );
        }
        break;
      }

      case 'goes_with':
        pairings = nameList(raw).slice(0, 6);
        break;

      case 'nutrition_source':
        /* Read below, together with the numbers, because on its own it says
           nothing about whether anybody looked at them. */
        fields.nutrition_source = cell(raw).toLowerCase();
        break;

      default:
        break;
    }
  }

  /*
   * A NUMBER THAT ARRIVED IN A FILE IS AN ESTIMATE UNTIL A PERSON SAYS
   * OTHERWISE.
   *
   * `nutrition_source` is not decoration. Empty means a person entered these
   * numbers, and the product then publishes what they support: the calorie
   * figure, "high protein", "under 500 kcal". `estimated` means a machine
   * produced them and the product publishes none of it.
   *
   * So the default for a file cannot be empty. A spreadsheet of nutrition
   * assembled from standard recipes, imported with no source column, would
   * otherwise arrive claiming a kitchen stood behind every figure, and health
   * claims would appear on a live menu that nobody had earned. It is the one
   * mistake in this whole feature that could actually hurt somebody.
   *
   * Writing the word `kitchen` in the column is a person asserting it, which
   * is the same act as leaving the box ticked on the item screen. Anything
   * else, including saying nothing at all, is an estimate.
   */
  const saidSource = Object.prototype.hasOwnProperty.call(fields, 'nutrition_source');
  if (saidSource || nutrition !== null) {
    const said = saidSource ? fields.nutrition_source : '';
    fields.nutrition_source = said === 'kitchen' ? '' : 'estimated';
    if (saidSource && said !== 'kitchen' && said !== 'estimated' && said !== '') {
      notes.push(
        'nutrition_source "' + said + '" is not "kitchen", so the numbers stay an estimate'
      );
    }
  }

  return { fields, nutrition, pairings, notes };
}

/**
 * The nutrition to store, given what is already there and what the file said.
 *
 * Per nutrient, not per dish: a file with only a calories column changes only
 * the calories, and the protein somebody typed on the item screen last month
 * survives it. A column that is present and empty removes that one nutrient,
 * which is the only way to take a wrong figure back out.
 *
 * @param {object} existing what the dish has now
 * @param {object|null} carried what fromRow read; null when the file said nothing
 * @returns {object|null} the value to store, or null to leave the field alone
 */
function mergeNutrition(existing, carried) {
  if (carried === null || carried === undefined) return null;
  const out = dishFacts.cleanNutrition(existing);
  for (const key of Object.keys(carried)) {
    if (carried[key] === null) delete out[key];
    else out[key] = carried[key];
  }
  return dishFacts.cleanNutrition(out);
}

module.exports = {
  COLUMNS,
  DIET_MARKS,
  headerKey,
  fromRow,
  mergeNutrition,
};
