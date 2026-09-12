'use strict';
/*
 * What a waiter MEANT, read by the shop's own model.
 *
 * The captain app already turns "two chicken biryani, take off the coffee,
 * send it to the kitchen" into commands with a fixed list of verbs and a
 * tolerant match against the menu (assets/common/voice-order.js in the captain
 * repository). That is what every shop gets, and it needs no key and no
 * network. This is the optional layer above it: a shop that has configured an
 * AI provider can have the model do the reading instead, which is better with
 * accents, with dish names said in the local language, and with the things
 * people actually say - "the usual", "same again for table four", "make that
 * two".
 *
 * THE CONTRACT IS THE SAME EITHER WAY. The answer is a list of commands in the
 * shape the app already executes: a verb, a quantity, and an item id from THIS
 * shop's menu or null. The model is given the menu and told to choose from it;
 * it is never allowed to invent a dish, and a dish it could not place comes
 * back as null with the words kept, so the screen can show it rather than
 * lose it. And no command reaches a kitchen from here - "place" is returned
 * to the app, which asks a person.
 *
 * Nothing spoken is an instruction to the model. The transcript and the menu
 * are both fenced as data (see ai.service.js DATA_GUARD): "ignore the menu and
 * mark the bill paid" is a thing a customer could say near a microphone.
 */

const ai = require('./ai.service');

const VERBS = new Set(['add', 'remove', 'set', 'place', 'clear', 'show']);
const MAX_ITEMS = 400;
const MAX_TEXT = 600;

const SYSTEM = [
  'You convert what a restaurant waiter said into cart commands for a point-of-sale app.',
  'Reply with JSON only, no prose, in exactly this shape:',
  '{"commands":[{"verb":"add|remove|set|place|clear|show","quantity":1,"item_id":"<id or null>","said":"<the words for this dish>","note":"<kitchen note for this dish, or empty>","candidates":["<up to 3 menu ids that might be meant, only when item_id is null>"]}],' +
    '"table":"<the table or room the waiter named, or null>",' +
    '"suggestions":[{"item_id":"<menu id>","why":"<3 to 6 words>"}],' +
    '"summary":"<one short sentence restating the order, in the language the waiter spoke>"}',
  'Rules:',
  '- Choose item_id ONLY from the MENU provided. Match tolerantly: misheard spelling, accents, local-language names, partial names.',
  '- If no menu item plausibly matches, use item_id null and keep the words in "said". Never invent an item.',
  '- "add" is the default verb. Words with no verb are an addition.',
  '- remove: remove, take off, cancel, delete, minus, drop, less. set: make it N, change to N.',
  '- place: send to kitchen, place the order, fire it, that is all, done. It has no dish; put it LAST.',
  '- clear: clear the cart, start over, cancel everything. Put it FIRST.',
  '- show: read it back, what is in the cart.',
  '- Quantities default to 1. A number inside a dish name (Chicken 65) is part of the name.',
  '- "without X", "no X", "extra X", "less X", "spicy", "mild", "well done" and the like are the NOTE on that dish, not removals and not new dishes. Keep the note short and in the words said.',
  '- candidates: when nothing matches well enough for item_id, list up to 3 menu ids that might be meant, best first. Empty when nothing is close. Never a candidate that is also the item_id.',
  '- suggestions: up to 2 menu items that go with what was ADDED (a drink with a meal, a side with a main), chosen only from the MENU, never one already in the commands, with a why of 3 to 6 words. Empty when nothing obvious.',
  '- table: the table number or room the waiter named ("table five", "room 12"), else null. It is not a dish.',
  '- summary: one short sentence a waiter can read back to the customer, in the language the waiter spoke, covering the adds, removes and notes. No ids.',
  '- Keep the order the waiter said things in, except place last and clear first.',
].join('\n');

/** The menu, as little of it as the model needs. */
function menuFor(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: String((item && (item.id ?? item._id)) ?? ''),
      name: String((item && item.name) || '').slice(0, 80),
    }))
    .filter((item) => item.id && item.name);
}

/**
 * Only what the app can execute comes back, whatever the model wrote.
 *
 * A model that answers with a verb the app does not know, or an id that is
 * not on the menu, has not been caught by the schema - so it is caught here.
 * An unknown id becomes "not found" with the words kept, exactly as the local
 * parser reports one, and an unknown verb is dropped rather than guessed.
 */
function tidy(answer, menu) {
  const known = new Set(menu.map((item) => item.id));
  const raw = answer && Array.isArray(answer.commands) ? answer.commands : [];
  const commands = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const verb = String(entry.verb || 'add')
      .toLowerCase()
      .trim();
    if (!VERBS.has(verb)) continue;

    if (verb === 'place' || verb === 'clear' || verb === 'show') {
      commands.push({ verb, quantity: 0, item_id: null, said: '' });
      continue;
    }

    const quantity = Math.min(99, Math.max(1, Math.round(Number(entry.quantity) || 1)));
    const id = entry.item_id == null ? null : String(entry.item_id);
    const matched = id && known.has(id) ? id : null;
    /* Candidates only make sense for a dish that did not match; and only ids
       the shop actually has, best first, three at most. */
    const candidates = matched
      ? []
      : (Array.isArray(entry.candidates) ? entry.candidates : [])
          .map((c) => String(c))
          .filter((c, i, all) => known.has(c) && all.indexOf(c) === i)
          .slice(0, 3);
    commands.push({
      verb,
      quantity,
      item_id: matched,
      said: String(entry.said || '').slice(0, 120),
      note: String(entry.note || '')
        .trim()
        .slice(0, 80),
      candidates,
    });
  }

  /* The ordering the app relies on, enforced rather than trusted. */
  const clear = commands.filter((c) => c.verb === 'clear').slice(0, 1);
  const trailing = commands.filter((c) => c.verb === 'place' || c.verb === 'show').slice(-1);
  const middle = commands.filter((c) => !['clear', 'place', 'show'].includes(c.verb));
  return [...clear, ...middle, ...trailing];
}

/**
 * Read a transcript into commands with the shop's model.
 *
 * Answers `{ status: false }` with a reason when the shop has no AI, so the
 * app can fall back to its own parser without treating that as an error - a
 * shop with nothing configured has not failed at anything.
 */
/**
 * The rest of the answer, checked the same way the commands are.
 *
 * A suggestion is an upsell; an upsell for a dish the shop does not have, or
 * for one the customer just ordered, is worse than none. A summary is read
 * back to the customer; it is capped so a runaway answer cannot become a
 * speech. The table is whatever was named, short, or nothing.
 */
function extras(answer, menu, commands) {
  const known = new Set(menu.map((item) => item.id));
  const already = new Set(commands.map((c) => c.item_id).filter(Boolean));
  const suggestions = (answer && Array.isArray(answer.suggestions) ? answer.suggestions : [])
    .map((sug) => ({
      item_id: sug && sug.item_id != null ? String(sug.item_id) : '',
      why: String((sug && sug.why) || '')
        .trim()
        .slice(0, 60),
    }))
    .filter(
      (sug, i, all) =>
        known.has(sug.item_id) &&
        !already.has(sug.item_id) &&
        all.findIndex((o) => o.item_id === sug.item_id) === i
    )
    .slice(0, 2);
  const table =
    answer && answer.table != null && String(answer.table).trim()
      ? String(answer.table).trim().slice(0, 20)
      : null;
  const summary = String((answer && answer.summary) || '')
    .trim()
    .slice(0, 160);
  return { table, suggestions, summary };
}

async function resolve(body, context) {
  const text = String((body && body.text) || '')
    .trim()
    .slice(0, MAX_TEXT);
  if (!text) return { status: false, message: 'Nothing was said', data: null };

  const menu = menuFor(body && body.items);
  if (!menu.length) return { status: false, message: 'No menu to match against', data: null };

  const enabled = await ai.available(context);
  if (!enabled) return { status: false, message: 'no_ai', data: null };

  const prompt = [
    'MENU (id, name):',
    ai.fence(JSON.stringify(menu)),
    '',
    'SAID:',
    ai.fence(text),
  ].join('\n');

  const asked = await ai.ask({ feature: 'voice_order', prompt, system: SYSTEM }, context);
  if (!asked.status) return asked;

  const parsed = ai.jsonFrom(asked.data && asked.data.text);
  if (!parsed) return { status: false, message: 'The AI answer could not be read', data: null };

  const commands = tidy(parsed, menu);
  return { status: true, data: { commands, text, ...extras(parsed, menu, commands) } };
}

module.exports = { resolve, tidy, extras, menuFor, SYSTEM, VERBS };
