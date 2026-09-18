'use strict';
/*
 * RUNS IN BOTH PLACES, FROM ONE SOURCE.
 *
 * The server derives these claims on every menu read. The item screen ALSO
 * needs them, live, as somebody types a protein figure - a round trip per
 * keystroke is not a thing to build, and a second implementation in the
 * frontend is worse: two sets of thresholds that agree today and disagree
 * after the first one is edited, with the disagreement showing up as a badge
 * a shop was promised and a customer never sees.
 *
 * So this file is the only copy of the rules and it works in both runtimes.
 * The desktop bundle carries a byte-identical copy at
 * frontend/static/script/js/core/dish-facts.js, the way the ordering pages
 * carry their translation dictionary, and a test fails if the two drift.
 * Regenerate with: node scripts/dev/copy-dish-facts.cjs
 */
(function (root) {
  /*
   * What a dish IS, and what may therefore be SAID about it.
   *
   * Owner: "signature dishes, chef pick, nutritions, veg or non veg, calories,
   * health benefits, ready in 10 minutes, something like how top international
   * food brands are having options i want those." And then the sentence that
   * decides the whole shape of this file:
   *
   *   "tags such as 'diabetic friendly,' 'heart healthy,' 'keto,' or exact
   *    calorie numbers should only be shown when the recipe/nutrition actually
   *    supports the claim."
   *
   * He is right, and it is not only good sense. A health claim on food is
   * regulated - FSSAI here, Codex and EU 1924/2006 elsewhere - and a restaurant
   * that badges a dish "heart healthy" because somebody ticked a box has made a
   * claim it cannot support. A tick box for "Diabetic Friendly" is a liability
   * with a checkbox in front of it.
   *
   * SO THERE ARE THREE KINDS OF THING HERE, AND ONLY TWO ARE TICKABLE.
   *
   *   FACTS       what the kitchen knows and enters: the energy and the
   *               macros per serving, and what is and is not in the dish
   *               (vegan, Jain, gluten free, nut free). A kitchen asserting
   *               "there are no nuts in this" is stating a fact about its own
   *               recipe, which is exactly what it is in a position to do.
   *
   *   CLAIMS      High Protein, Low Calorie, Keto Friendly, Heart Healthy,
   *               Diabetic Friendly, Under 500 kcal. DERIVED from the numbers,
   *               here, every time they are read. Never stored and never
   *               tickable - so a dish cannot carry a claim its own nutrition
   *               contradicts, and a threshold that changes applies to the
   *               whole estate at once rather than to whatever was ticked on
   *               the day.
   *
   *   POSITIONING Signature Dish, Chef's Pick. Not claims about health, so the
   *               shop says them freely. Nobody can be misled about whether
   *               the chef likes something.
   *
   * WHERE THE NUMBERS COME FROM. The thresholds below are the regulated ones
   * where a regulated one exists, cited at each. Where none exists - keto is a
   * diet, not a regulation - the rule is stated plainly as a convention so that
   * anybody reading it can disagree with the number rather than guess at it.
   *
   * A DISH IS A SERVING, NOT 100 GRAMS. Most nutrition regulation is written
   * per 100g, which is right for a packet on a shelf and wrong for a plate: a
   * restaurant knows what it puts on the plate and a customer eats the plate.
   * Energy-proportion claims (high protein) carry over unchanged, because a
   * proportion is a proportion. Absolute ones are stated per serving and say
   * so.
   *
   * NOTHING IS CLAIMED FROM MISSING DATA. A dish with no nutrition entered
   * carries no claims at all - not "low fat" because zero was stored, which is
   * the obvious way for this to go wrong and put a false claim on every dish a
   * shop has not filled in.
   */

  /** Energy per gram, the Atwater factors every food label is built on. */
  const KCAL_PER_G = Object.freeze({ protein: 4, carbs: 4, fat: 9 });

  /**
   * The facts a kitchen enters about a dish, per serving.
   *
   * Empty means "not said", which is different from zero in every direction
   * that matters: an unsaid sugar is not "no sugar".
   */
  const NUTRIENTS = Object.freeze([
    'kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'sat_fat_g',
    'fibre_g',
    'sugar_g',
    'sodium_mg',
  ]);

  /**
   * What is and is not in the dish. Facts, ticked by the kitchen.
   *
   * Kept separate from `diet` - the veg/non-veg dot - which Indian menus carry
   * by law and which has its own field and its own rendering.
   */
  const FOOD_TAGS = Object.freeze([
    'plant_based',
    'eggetarian',
    'jain',
    'satvik',
    'gluten_free',
    'dairy_free',
    'lactose_free',
    'nut_free',
    'organic',
    'no_added_sugar',
  ]);

  /** How the shop positions the dish. Not a health claim; freely chosen. */
  const MENU_MARKS = Object.freeze(['signature', 'chefs_pick', 'house_special', 'new']);

  /** Only a number, and only a sane one. Anything else is "not said". */
  function number(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    /* A plate is not 40,000 kcal. A typo that large is data entry, not food. */
    if (n > 100000) return null;
    return Math.round(n * 100) / 100;
  }

  /**
   * The nutrition a shop entered, cleaned.
   *
   * @param {object} raw
   * @returns {object} only the nutrients actually given; absent stays absent
   */
  function cleanNutrition(raw) {
    const out = {};
    const from = raw && typeof raw === 'object' ? raw : {};
    for (const key of NUTRIENTS) {
      const n = number(from[key]);
      if (n !== null) out[key] = n;
    }
    return out;
  }

  /** The tags a shop ticked, cleaned against the list this file knows. */
  function cleanTags(raw, allowed) {
    const asked = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const one of asked) {
      const tag = String(one == null ? '' : one)
        .trim()
        .toLowerCase();
      if (allowed.includes(tag) && !out.includes(tag)) out.push(tag);
    }
    return out;
  }

  const has = (n, key) => typeof n[key] === 'number';

  /**
   * What may honestly be said about this dish.
   *
   * @param {object} nutrition  per serving, as cleanNutrition returns it
   * @param {string[]} tags     the factual food tags the kitchen ticked
   * @returns {string[]} claim keys, in the order they should be shown
   */
  function claimsFor(nutrition, tags) {
    const n = cleanNutrition(nutrition);
    const ticked = Array.isArray(tags) ? tags : [];
    const out = [];
    const kcal = has(n, 'kcal') ? n.kcal : null;

    /*
     * HIGH PROTEIN: at least 20% of the dish's energy from protein.
     * SOURCE OF PROTEIN: at least 12%. Codex CAC/GL 23-1997, and the same
     * numbers in EU 1924/2006 - a proportion, so it carries from 100g to a
     * plate unchanged.
     */
    if (kcal && has(n, 'protein_g')) {
      const share = (n.protein_g * KCAL_PER_G.protein) / kcal;
      if (share >= 0.2) out.push('high_protein');
      else if (share >= 0.12) out.push('protein_source');
    }

    /*
     * UNDER 300 / UNDER 500 kcal. Not a regulated claim - it is a plain
     * statement of the number, which is why it is safe, and it is the line
     * every menu that does this actually uses. Only the lower one is shown
     * when both are true; "under 500" on a 240 kcal dish reads as a hedge.
     */
    if (kcal !== null) {
      if (kcal < 300) out.push('under_300');
      else if (kcal < 500) out.push('under_500');
    }

    /*
     * LOW FAT: 3g or less per 100g by regulation. A plate is not 100g, so the
     * honest per-serving reading of the same intent is a dish whose energy is
     * no more than 30% fat - the proportion the regulation works out to for a
     * food of ordinary energy density.
     */
    if (kcal && has(n, 'fat_g') && (n.fat_g * KCAL_PER_G.fat) / kcal <= 0.3) {
      out.push('low_fat');
    }

    /*
     * HIGH FIBRE: 6g per 100g, or 3g per 100 kcal. The second form is the one
     * written for prepared foods and is the one that fits a plate.
     */
    if (kcal && has(n, 'fibre_g') && (n.fibre_g / kcal) * 100 >= 3) out.push('high_fibre');

    /*
     * KETO FRIENDLY: not a regulated claim anywhere - it is a diet, and the
     * convention it is sold on is net carbs, being carbohydrate less fibre.
     * Ten grams per serving is the usual line and is stated here so it can be
     * argued with rather than guessed at.
     */
    if (has(n, 'carbs_g')) {
      const net = n.carbs_g - (has(n, 'fibre_g') ? n.fibre_g : 0);
      if (net <= 10) out.push('keto_friendly');
      if (net <= 20) out.push('low_carb');
    }

    /*
     * DIABETIC FRIENDLY. A compound claim and a serious one: it is read as
     * advice by somebody managing a condition, not as marketing.
     *
     * What actually matters to that reader is the carbohydrate load of the
     * plate and how much of it is sugar - so it is those two numbers the shop
     * must have entered, and a dish missing either makes no claim at all.
     *
     * Two ways to be over the line, and a dish must clear both. Sugar at or
     * under a tenth of the dish's energy, the same proportion the low-sugar
     * claim uses. And net carbohydrate - carbs less fibre, since fibre is the
     * part that does not land as glucose - at or under 30g on the plate, which
     * is the low end of the per-meal carbohydrate budget diabetes guidance is
     * written around.
     *
     * Note what this deliberately does NOT require: fibre. A grilled chicken
     * with six grams of carbohydrate is excellent for a diabetic because there
     * is almost no carbohydrate in it, not because it is full of fibre. Asking
     * for fibre on top would have silently refused the claim to exactly the
     * dishes that deserve it most, which is how this rule was first written
     * and what a test caught.
     */
    if (has(n, 'sugar_g') && has(n, 'carbs_g') && kcal) {
      const sugarShare = (n.sugar_g * KCAL_PER_G.carbs) / kcal;
      const net = n.carbs_g - (has(n, 'fibre_g') ? n.fibre_g : 0);
      if (sugarShare <= 0.1 && net <= 30) out.push('diabetic_friendly');
    }

    /*
     * HEART HEALTHY. Compound too, and the one that most needs its numbers:
     * low saturated fat AND low sodium, which is what every heart-health
     * programme in the world means by it. Sodium is collected for exactly this
     * reason - without it the claim would be guesswork wearing a badge.
     *
     * Saturated fat at or under 10% of energy is the WHO population guideline.
     * 600mg sodium is the FDA's per-serving ceiling for a "healthy" claim.
     */
    if (kcal && has(n, 'sat_fat_g') && has(n, 'sodium_mg')) {
      const satShare = (n.sat_fat_g * KCAL_PER_G.fat) / kcal;
      if (satShare <= 0.1 && n.sodium_mg <= 600) out.push('heart_healthy');
    }

    /* NO ADDED SUGAR is a fact about the recipe, not a number, so the kitchen
     is the one who knows it - it rides in with the food tags and is surfaced
     here so every badge on a menu comes from one list. */
    if (ticked.includes('no_added_sugar')) out.push('no_added_sugar');

    return out;
  }

  /**
   * Everything a customer-facing menu should show for one dish.
   *
   * @returns {{nutrition: object, tags: string[], marks: string[], claims: string[]}}
   */
  /*
   * WHO SAID SO. '' and 'kitchen' mean a person entered or accepted these
   * numbers; 'estimated' means a machine guessed them from the dish name and
   * nobody has checked yet.
   *
   * Empty reads as kitchen ON PURPOSE. Every number stored before this field
   * existed got there because somebody typed it into the item screen and
   * pressed Save, so it IS confirmed; treating the absence as "unverified"
   * would silently strip the badges off every dish already done.
   */
  function estimatedOnly(item) {
    return String((item && item.nutrition_source) || '').trim() === 'estimated';
  }

  /**
   * Everything a customer-facing menu should show for one dish.
   *
   * A GUESS EARNS NOTHING. Until this field existed the question could not
   * arise: the only way numbers reached an item was a person typing them, or
   * pressing Estimate and then Save - either way a person put them there. The
   * moment anything writes estimates in bulk that stops being true, and an
   * unchecked guess would start earning "Heart healthy" and "Diabetic
   * friendly" on a live menu.
   *
   * That is the same harm the owner ruled out - "only be shown when the
   * recipe/nutrition actually supports the claim" - arriving by a different
   * door. A tick box was the obvious way in and was refused; a machine
   * guessing is the less obvious one.
   *
   * So estimated numbers are held back from the CUSTOMER entirely: no claims
   * and no calorie figure, because a number on a menu is itself a claim. The
   * shop still sees them on its own screen, where they are a draft to check
   * rather than something published.
   *
   * The recipe tags survive, because the kitchen ticked those itself and
   * nothing about them was estimated.
   */
  function factsFor(item) {
    const nutrition = cleanNutrition(item && item.nutrition);
    const tags = cleanTags(item && item.food_tags, FOOD_TAGS);
    const marks = cleanTags(item && item.menu_marks, MENU_MARKS);

    if (estimatedOnly(item)) {
      /*
       * THE NUMBERS GO OUT. THE BADGES DO NOT.
       *
       * Owner, 2026-09-18, on 267 dishes whose estimates nobody could see:
       * "no need to worry about correct value. later we can update. now i
       * want all values."
       *
       * So a guessed calorie count now reaches the customer, carrying a flag
       * that says what it is. A number a menu calls an estimate is not a
       * false claim; it is a number with its provenance attached, and a
       * customer can weigh it.
       *
       * A CLAIM IS NOT A VALUE, and those still wait. "Heart healthy" and
       * "Diabetic friendly" cannot be labelled as guesses in any way somebody
       * reads carefully - a badge is an assertion, and the owner's earlier
       * ruling was that one may "only be shown when the recipe/nutrition
       * actually supports the claim". A machine's guess about a dish name
       * supports nothing. So claims are still computed from the TAGS the
       * kitchen ticked itself and never from estimated numbers.
       *
       * The two halves of his instruction do not conflict once values and
       * assertions are separated, which is the whole of this branch.
       */
      return { nutrition, nutrition_estimated: true, tags, marks, claims: claimsFor({}, tags) };
    }
    return {
      nutrition,
      nutrition_estimated: false,
      tags,
      marks,
      claims: claimsFor(nutrition, tags),
    };
  }

  const api = {
    NUTRIENTS,
    FOOD_TAGS,
    MENU_MARKS,
    KCAL_PER_G,
    number,
    cleanNutrition,
    cleanTags,
    claimsFor,
    factsFor,
    estimatedOnly,
  };

  /* Node takes it as a module; the desktop bundle hangs it on the window,
     where the item screen's live preview reads it. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PosnicDishFacts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
