'use strict';
/*
 * Writing the description a shopkeeper was never going to write.
 *
 * The description field is optional, and in practice it is empty on most
 * items in most shops, because typing two sentences about a bar of soap is
 * the least rewarding minute of anybody's day. It stops being optional the
 * moment a shop turns on online ordering, where an item with no description
 * is a dish nobody orders.
 *
 * WHAT IT MAY AND MAY NOT SAY.
 *
 * It may describe what the shop already told us: the name, what it is a kind
 * of, who supplies it, how it is sold, whether it is vegetarian. It may not
 * invent anything else. "Organic", "handmade", "sugar free" and "best in the
 * city" are claims, some of them regulated, and a shopkeeper who publishes
 * one because software suggested it is the one carrying the consequence. So
 * the instruction is explicit about it, and the output is a draft in a form
 * field that a person edits and saves, never a write.
 *
 * The shop's own language, not English, unless the shop is English. A kirana
 * in Coimbatore with a Tamil storefront does not want English copy, and
 * translating it afterwards is a second job nobody will do.
 */

const ai = require('./ai.service');

const FEATURE = 'item_description';

/* The field is maxlength=1000 with a minlength=5 validation rule on the form
   (frontend items.js). Aiming well under the ceiling leaves room for a person
   to add a sentence without hitting a limit they did not know about. */
const TARGET_CHARS = 400;

const SYSTEM = [
  'You write short product descriptions for a small shop\'s point-of-sale catalogue.',
  '',
  'Rules:',
  '- Two or three sentences. Plain, warm, factual. No marketing slogans.',
  `- Under ${TARGET_CHARS} characters.`,
  '- Describe ONLY what the supplied fields state. Never invent an ingredient,',
  '  an origin, a certification, a health benefit, a quantity or a price.',
  '- Never claim organic, natural, homemade, fresh, pure, sugar-free, or any',
  '  superlative, unless that exact word appears in the supplied fields. These',
  '  are regulated claims and the shopkeeper carries the consequence of them.',
  '- Write in the requested language. If none is given, write in English.',
  '- Return the description only. No preamble, no quotation marks, no labels.',
].join('\n');

/** Only the fields worth describing, and nothing that identifies a person. */
function payloadFor(item) {
  const pick = {
    name: item.name,
    category: item.category_name,
    brand: item.brand,
    unit: item.unit,
    /* Useful and safe to state: it is a fact about the item, and in India it
       is often the first thing a customer wants to know. */
    diet: item.diet,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8).join(', ') : item.tags,
  };
  return Object.entries(pick)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join('\n');
}

/**
 * Draft a description for one item. Writes nothing.
 *
 * @param {object} item     the form's current values, not a saved record
 * @param {{branchId: string, licenseId: string}} context
 */
async function draft(item, context) {
  const name = String((item && item.name) || '').trim();
  if (!name) {
    return { status: false, reason: 'no_name', message: 'An item name is needed first', data: null };
  }

  const language = String((item && item.language) || '').trim();
  const system = language ? `${SYSTEM}\n- The requested language is: ${language}` : SYSTEM;

  const result = await ai.ask(
    {
      feature: FEATURE,
      system: `${system}

${ai.DATA_GUARD}`,
      /* Fenced, because an item name can be typed by a member of the public
         through the online ordering page. See ai.service.js. */
      prompt: ai.fence(payloadFor(item)),
    },
    context
  );
  if (!result.status) return result;

  /* Trimmed here rather than trusted. A model that ignores the character
     budget would otherwise produce text the form's own validation rejects,
     which reads to the shopkeeper as the button being broken. */
  let text = String(result.data.text || '').trim();
  if (text.length > 1000) text = `${text.slice(0, 997)}...`;

  return { status: true, data: { description: text, cost_minor: result.data.cost_minor || 0 } };
}

module.exports = { draft, payloadFor, SYSTEM, FEATURE, TARGET_CHARS };
