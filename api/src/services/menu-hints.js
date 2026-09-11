'use strict';
/*
 * Telling the recogniser what this shop actually sells, before it guesses.
 *
 * THE HARD PART OF VOICE ORDERING IS NEVER "WHICH DISH DID THEY MEAN". That
 * is a lookup against a few hundred known strings and the handset already does
 * it, locally and for nothing. The hard part is acoustic: getting the sounds
 * of "Chicken Biryani" out of a loud dining room and an accent that the model
 * was not mostly trained on.
 *
 * Every serious provider takes domain hints for exactly this, and every one of
 * them takes them FREE. A model told that "biryani", "uthappam" and "rasmalai"
 * are words that exist in this room stops reaching for the ordinary English
 * that sounds like them. It is the cheapest accuracy in the whole feature -
 * cheaper than changing provider, and much cheaper than widening the spelling
 * tolerance, which buys accuracy by putting dishes nobody ordered on the bill.
 *
 * WHAT LEAVES THE BUILDING. Dish names, and nothing else. Not prices, not
 * stock, not what sold yesterday. A hint list is sent with every clip, so the
 * rule has to be one somebody can hold in their head: if it is not a name
 * printed on the shop's own menu, it does not go.
 *
 * Read once and kept for a few minutes. A menu changes a few times a season; a
 * database round trip on every spoken order would be paid for by a waiter
 * standing at a table.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

/*
 * How long a menu stays fresh enough.
 *
 * Long enough that a lunch rush costs one read, short enough that a shop that
 * renames a dish sees it take effect before they have finished wondering
 * whether it worked.
 */
const CACHE_MS = 5 * 60 * 1000;

/*
 * How many names to carry.
 *
 * Whisper's prompt is a few hundred tokens and silently drops the rest, so a
 * shop with two thousand items would send a truncated list and never know.
 * Google takes thousands of phrases and is capped far higher. Both are capped
 * HERE rather than left to the provider, because a limit that bites silently
 * at the far end is a limit nobody can debug.
 */
const MAX_PHRASES = 400;
const MAX_PROMPT_CHARS = 850;

/* A dish name worth sending. Anything else is noise that costs a provider's
   attention and buys nothing. */
const usable = (name) => {
  const said = String(name || '').trim();
  return said.length > 1 && said.length <= 60;
};

const cache = new Map();

const keyFor = (context) => `${context.licenseId || ''}:${context.branchId || ''}`;

/**
 * This branch's dish names.
 *
 * Never throws and never returns null. A hint list is an improvement, not a
 * dependency: a shop whose menu could not be read should still be able to take
 * an order by voice, slightly less accurately, rather than not at all.
 *
 * @param {{branchId: string, licenseId: string}} context
 * @returns {Promise<string[]>}
 */
async function phrasesFor(context = {}) {
  const key = keyFor(context);
  const held = cache.get(key);
  if (held && held.until > Date.now()) return held.phrases;

  const branchId = String(context.branchId || '');
  const licenseId = String(context.licenseId || '');
  /* Checked before a connection is opened. "That is not a branch" needs no
     database to answer, and a warning logged for it reads like a fault. */
  if (!ObjectId.isValid(branchId)) return [];

  try {
    const db = await BaseModel.getDb();

    const filter = { 'branch_access.branch_id': new ObjectId(branchId) };
    if (ObjectId.isValid(licenseId)) filter.license = new ObjectId(licenseId);

    const rows = await db
      .collection('items')
      .find(filter, { projection: { name: 1 }, limit: MAX_PHRASES })
      .sort({ sort_order: 1, name: 1 })
      .toArray();

    /* Deduplicated, because a chain carries the same dish in several
       categories and a provider gains nothing from being told twice. */
    const seen = new Set();
    const phrases = [];
    for (const row of rows) {
      const name = String(row.name || '').trim();
      if (!usable(name)) continue;
      const folded = name.toLowerCase();
      if (seen.has(folded)) continue;
      seen.add(folded);
      phrases.push(name);
    }

    cache.set(key, { phrases, until: Date.now() + CACHE_MS });
    return phrases;
  } catch (error) {
    /* A menu that could not be read is a slightly worse transcription, never a
       failed one. */
    console.warn('[menu-hints] could not read the menu:', error.message);
    return [];
  }
}

/**
 * The same names as a Whisper prompt.
 *
 * A comma-separated run of terms, which is the shape Whisper's prompt is
 * actually for: it biases the decoder toward words that appear in it. Capped
 * by CHARACTER here, because the model's own cap is in tokens and truncating
 * mid-name teaches it a word the shop does not sell.
 */
function promptFrom(phrases) {
  const kept = [];
  let length = 0;
  for (const phrase of phrases) {
    const next = length + phrase.length + 2;
    if (next > MAX_PROMPT_CHARS) break;
    kept.push(phrase);
    length = next;
  }
  return kept.join(', ');
}

/** Forget what was cached. For a test, and for a menu that just changed. */
function forget(context) {
  if (context) cache.delete(keyFor(context));
  else cache.clear();
}

module.exports = { phrasesFor, promptFrom, forget, CACHE_MS, MAX_PHRASES, MAX_PROMPT_CHARS };
