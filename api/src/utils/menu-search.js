'use strict';
/*
 * Finding a dish when the customer cannot spell it.
 *
 * WHY THIS IS NOT `indexOf`.
 *
 * The menu's first search was a substring test, which is honest and fails in
 * exactly the way that matters: a hungry person on a phone types "panner",
 * "biriyani", "manchurain", and a menu that answers "nothing matches" reads as
 * a restaurant that does not sell it. Every food app in the country tolerates
 * this, so a menu that does not feels broken rather than strict.
 *
 * WHAT IT TOLERATES, AND WHAT IT REFUSES.
 *
 *   exact / prefix / substring   scored highest, in that order
 *   one transposition            "biriyani" finds "biryani"
 *   one or two edits             within a budget that GROWS with word length
 *
 * The budget is the whole design. A fixed distance of two turns "dal" into
 * "dosa" and every three-letter word matches every other; scaling it means a
 * short word is matched strictly and a long one forgivingly, which is how
 * people actually mistype. Under five characters, nothing is forgiven.
 *
 * MATCHING IS PER WORD, NOT PER STRING. "butter nan" has to find "Butter Naan"
 * - a whole-string distance of the query against the dish name would be miles
 * out because of everything else in the description.
 *
 * NO DATABASE IMPORTS. Vocabulary and arithmetic, testable on its own.
 */

/** Lowercase, unaccented, punctuation gone, single-spaced. */
function normalize(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How many single-character edits separate two words.
 *
 * Damerau-Levenshtein: insert, delete, substitute AND transpose. The
 * transposition is the one that earns its place here - "biriyani" for
 * "biryani" and "resturant" for "restaurant" are two adjacent letters swapped,
 * which plain Levenshtein charges two edits for and this charges one.
 *
 * Bails out as soon as the whole row exceeds the budget, so a long dish name
 * against a short query costs almost nothing.
 */
function editDistance(a, b, budget) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > budget) return budget + 1;

  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const row = new Array(b.length + 1);
    row[0] = i;
    let best = row[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);

      /* The transposition, and the reason this is Damerau rather than plain
         Levenshtein: two adjacent letters swapped is ONE mistake to a person
         and should cost one edit. */
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + cost);
      }

      row[j] = value;
      if (value < best) best = value;
    }

    /* Nothing later can bring the row back under budget. */
    if (best > budget) return budget + 1;

    prev2 = prev;
    prev = row;
  }

  return prev[b.length];
}

/**
 * How much slack a word of this length earns.
 *
 * Short words get none: with a budget of two, "dal" matches "dosa" and a
 * three-letter search returns the menu. The thresholds are where a typo stops
 * being ambiguous with a different word.
 */
function budgetFor(length) {
  if (length < 5) return 0;
  if (length < 8) return 1;
  return 2;
}

/**
 * How well one query word matches one target word. Higher is better, 0 is no.
 *
 * The ladder is deliberate: an exact word beats a prefix, a prefix beats a
 * substring, and anything spelled correctly beats anything forgiven. A
 * customer who types the name exactly should never see a fuzzy match above it.
 */
function scoreWord(query, target) {
  if (!query || !target) return 0;
  if (query === target) return 100;
  if (target.startsWith(query)) return 80;
  if (target.includes(query)) return 55;

  const budget = budgetFor(query.length);
  if (!budget) return 0;

  const distance = editDistance(query, target, budget);
  if (distance > budget) return 0;

  /* One edit is worth more than two, and a forgiven match never reaches the
     score of a substring that was actually spelled right. */
  return 40 - (distance - 1) * 12;
}

/**
 * Does this haystack answer this query, and how well?
 *
 * EVERY query word must find something. "butter naan" should not match a
 * dish called "Butter Chicken" on the strength of one word - a customer who
 * typed two words meant both of them.
 *
 * @param {string} query    what was typed
 * @param {object} fields   { name, description, category }
 * @returns {{match: boolean, score: number}}
 */
function scoreItem(query, fields = {}) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return { match: true, score: 0 };

  /* Weighted by where the word was found. A dish whose NAME is what you typed
     belongs above one that merely mentions it in a description. */
  const haystacks = [
    { text: normalize(fields.name), weight: 1 },
    { text: normalize(fields.category), weight: 0.5 },
    { text: normalize(fields.description), weight: 0.35 },
  ].filter((h) => h.text);

  let total = 0;

  for (const word of words) {
    let bestForWord = 0;

    for (const hay of haystacks) {
      /* Whole-field substring first: it catches multi-word phrases that no
         single-word comparison would, like "butter ma" inside "butter
         masala". */
      if (hay.text.includes(word)) {
        bestForWord = Math.max(bestForWord, 70 * hay.weight);
      }
      for (const target of hay.text.split(' ')) {
        const s = scoreWord(word, target);
        if (s) bestForWord = Math.max(bestForWord, s * hay.weight);
      }
    }

    /* One word nobody can place means this is not the dish. */
    if (!bestForWord) return { match: false, score: 0 };
    total += bestForWord;
  }

  return { match: true, score: Math.round(total / words.length) };
}

/**
 * A whole list, filtered and ordered by how well it answered.
 *
 * Ties keep the shop's own order. A menu is arranged deliberately - starters
 * before mains, the chef's own sequence - and scrambling equal matches
 * alphabetically throws that away for no gain.
 */
function search(query, items, read = (i) => i) {
  const list = Array.isArray(items) ? items : [];
  if (!normalize(query)) return list.slice();

  return list
    .map((item, index) => ({ item, index, ...scoreItem(query, read(item)) }))
    .filter((row) => row.match)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item);
}

module.exports = {
  budgetFor,
  editDistance,
  normalize,
  score: scoreItem,
  scoreWord,
  search,
};
