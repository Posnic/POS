'use strict';
/*
 * Filling in the nutrition panel a kitchen was never going to fill in.
 *
 * Owner: "each item should have details seperate section for restaurant. we
 * have ai assistand also to auto fill if user lazy to do."
 *
 * He is right about the laziness and it is not laziness. Eight numbers times
 * three hundred dishes is two thousand four hundred pieces of data entry, for
 * a menu that changes every season, by somebody who is running a restaurant.
 * Left to hand entry this panel is empty in every shop in the estate, and a
 * feature that is empty everywhere may as well not exist.
 *
 * WHAT THIS IS ALLOWED TO PRODUCE, AND WHAT IT IS NOT.
 *
 * It produces NUMBERS - the energy and macros of a typical serving of a dish
 * with that name - and the recipe facts that follow from the name with no
 * guessing at all: a paneer butter masala is vegetarian, a chicken 65 is not.
 *
 * It does NOT produce claims. It is never asked whether a dish is heart
 * healthy, diabetic friendly or keto, and there is nowhere for such an answer
 * to go: the claims are derived from the numbers by utils/dish-facts.js and
 * the write path refuses any tag that is not in FOOD_TAGS. This matters more
 * here than anywhere else in the feature, because a model asked directly for
 * a health claim will happily give one, and a guess that arrives wearing the
 * word "diabetic" is the exact thing the owner ruled out.
 *
 * THE CHAIN THAT NEEDS WATCHING. An estimate becomes a number, the number
 * earns a badge, and the badge is a regulated claim about food. That chain is
 * real and it is why nothing here writes: the numbers land in form fields,
 * marked as estimates, and a person looks at them and presses Save. It is the
 * same contract as the description drafter - a draft a person edits and
 * saves, never a write - and here the draft is also labelled on screen so
 * nobody saves eight numbers believing the kitchen measured them.
 *
 * ALLERGEN TAGS ARE DELIBERATELY WITHHELD. Gluten free, nut free, dairy free
 * are the tags somebody with an allergy reads before eating, and the only
 * honest source for them is the kitchen that made the dish - not a guess from
 * a name, however confident. A model saying "nut free" about a korma has
 * misread a recipe it never saw. Those stay for a person to tick.
 */

const ai = require('./ai.service');
const dishFacts = require('../utils/dish-facts');

const FEATURE = 'item_description';

/*
 * The tags a name can honestly settle, and the ones it cannot.
 *
 * A dish called "Mutton Biryani" tells you it is not vegetarian, and that is
 * a reading of the words rather than a guess about a recipe. Whether the
 * kitchen fries it in the same oil as the prawns is not in the name, so the
 * allergen tags are not on this list and the model is told why.
 */
const SUGGESTIBLE_TAGS = Object.freeze(['plant_based', 'eggetarian', 'jain', 'satvik', 'organic']);

const SYSTEM = [
  'You estimate the nutrition of a single restaurant serving from its name.',
  '',
  'Return ONLY a JSON object with these keys, all optional:',
  '  kcal, protein_g, carbs_g, fat_g, sat_fat_g, fibre_g, sugar_g, sodium_mg',
  '  diet      one of: veg, non_veg, egg, vegan',
  `  food_tags an array from exactly: ${SUGGESTIBLE_TAGS.join(', ')}`,
  '',
  'Rules:',
  '- Numbers are for ONE TYPICAL RESTAURANT SERVING of that dish, not per 100g',
  '  and not per kilogram. A restaurant plate is larger than a home portion.',
  '- Estimate from the standard recipe for the dish. Regional variation is',
  '  expected and fine; you are giving a starting point a cook will correct.',
  '- OMIT any number you cannot reasonably estimate. An omitted number is',
  '  correct. A guessed number is not, and a wrong one here becomes a claim on',
  '  a public menu.',
  '- NEVER return a health claim, a diet name, or a marketing phrase. Not',
  '  "keto", not "diabetic friendly", not "heart healthy", not "high protein",',
  '  not "low calorie". Those are decided from the numbers elsewhere and any',
  '  such value is discarded.',
  '- NEVER suggest gluten free, nut free, dairy free or lactose free. Only the',
  '  kitchen that cooked the dish can state those, and somebody with an allergy',
  '  reads them before eating.',
  '- Use food_tags only where the NAME settles it. Do not guess Jain or organic.',
  '- No units, no ranges, no text. Plain numbers. No preamble, no code fence.',
].join('\n');

/** Only what helps place a dish, and nothing that identifies a person. */
function payloadFor(item) {
  const pick = {
    name: item && item.name,
    category: item && item.category_name,
    description: item && item.description,
    /* If the shop already marked the dot, say so: it narrows the estimate and
       stops the model contradicting something a person decided. */
    diet: item && item.diet,
  };
  return Object.entries(pick)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim().slice(0, 300)}`)
    .join('\n');
}

/** The first JSON object in a reply, however the model wrapped it. */
function parseReply(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

const DIETS = ['veg', 'non_veg', 'egg', 'vegan'];

/**
 * Estimate the nutrition of one dish. Writes nothing.
 *
 * @param {object} item  the form's current values, not a saved record
 * @param {{branchId: string, licenseId: string}} context
 */
async function draft(item, context) {
  const name = String((item && item.name) || '').trim();
  if (!name) {
    return { status: false, reason: 'no_name', message: 'A dish name is needed first', data: null };
  }

  const result = await ai.ask(
    {
      feature: FEATURE,
      system: `${SYSTEM}

${ai.DATA_GUARD}`,
      /* Fenced: an item name can reach this from the online ordering page,
         which members of the public type into. See ai.service.js. */
      prompt: ai.fence(payloadFor(item)),
    },
    context
  );
  if (!result.status) return result;

  const said = parseReply(result.data && result.data.text);
  if (!said) {
    return {
      status: false,
      reason: 'unreadable',
      message: 'The assistant did not answer with numbers. Try again.',
      data: null,
    };
  }

  /*
   * Cleaned through exactly the same gate the write path uses.
   *
   * Not belt and braces. cleanNutrition drops anything that is not a real
   * number, so "about 450" or "450-500" becomes not-said rather than
   * something. cleanTags drops every tag that is not in FOOD_TAGS, which is
   * what makes the "never return a health claim" rule above enforced rather
   * than merely requested - a model that returns keto_friendly anyway has
   * returned a value with nowhere to land.
   */
  const nutrition = dishFacts.cleanNutrition(said);
  const tags = dishFacts.cleanTags(said.food_tags, SUGGESTIBLE_TAGS);
  const diet = DIETS.includes(String(said.diet || '').trim()) ? String(said.diet).trim() : '';

  if (!Object.keys(nutrition).length && !tags.length && !diet) {
    return {
      status: false,
      reason: 'nothing_usable',
      message: 'The assistant could not place this dish. Fill it in by hand.',
      data: null,
    };
  }

  return {
    status: true,
    data: {
      nutrition,
      food_tags: tags,
      diet,
      /*
       * Said plainly, and carried to the screen rather than assumed there.
       *
       * The panel shows this next to the numbers it just filled in, because
       * the person about to press Save needs to know these were estimated
       * from a name. The badges the menu derives from them are claims about
       * food, and the shop is the one making them.
       */
      estimated: true,
      /* Which claims these numbers would earn, so the screen can show the
         consequence at the moment of the estimate rather than after a save. */
      claims: dishFacts.claimsFor(nutrition, tags),
    },
  };
}

module.exports = { draft, payloadFor, parseReply, SYSTEM, SUGGESTIBLE_TAGS, FEATURE };
