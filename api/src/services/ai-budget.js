'use strict';
/*
 * What this shop has spent on AI this month, and whether it may spend more.
 *
 * Sits beside ai.service.js, which enforces it. That file is the one place a
 * model call goes through, so a cap checked there is a cap every feature has
 * without any of them remembering to ask.
 *
 * WHOSE MONEY THIS IS.
 *
 * The shop's own. Posnic charges nothing for AI and the key belongs to the
 * shopkeeper, so nothing here protects our margin - there is no margin in it.
 * It protects the customer from us. A loop that calls a model in a retry
 * bills more in a day than the shop pays for the software in a year, and the
 * invoice arrives on their card with our name on the software that spent it.
 *
 * That makes two things non-negotiable. The cap is checked BEFORE the call,
 * because a cap checked afterwards is a report. And the meter is visible,
 * because somebody spending their own money is entitled to watch it.
 *
 * The figures here are OURS, not the provider's. They are computed from the
 * token counts each call reports, at published list prices, so they will not
 * match the invoice to the paisa - promotional rates, batch discounts and
 * cache reads all move it. They are close enough to answer "is this costing
 * me anything" and to stop a runaway, which is what they are for. The
 * provider's own dashboard is the authority on the bill, and the settings
 * screen should say so.
 */

const BaseModel = require('../models/base.model');

/*
 * List prices per million tokens, in US dollars, as published September 2026.
 *
 * Out of date the moment a provider changes them, which is why nothing
 * depends on them being right: they drive a meter and a cap, not a charge.
 * A model that is not listed falls back to the most expensive entry, so an
 * unknown model over-counts rather than escaping the cap.
 */
const PRICES = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 5, out: 25 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
};
const FALLBACK_PRICE = { in: 5, out: 25 };

/* The shop thinks in its own currency and the providers bill in dollars.
   One number, in one place, rather than a conversion scattered through the
   screens that show it. */
const USD_TO_INR = 88;

const COLLECTION = 'ai_usage';

/** YYYY-MM in UTC. Month boundaries do not need to be the shop's timezone:
    this is a spending window, not a business day. */
const monthKey = (at = new Date()) =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

/** What one call cost, in paise, so nothing is stored as a float. */
function costMinor({ model, tokensIn, tokensOut }) {
  const price = PRICES[model] || FALLBACK_PRICE;
  const usd = ((Number(tokensIn) || 0) * price.in + (Number(tokensOut) || 0) * price.out) / 1e6;
  return Math.round(usd * USD_TO_INR * 100);
}

function scope(context) {
  return {
    license: BaseModel.license,
    branch_id: String((context && context.branchId) || ''),
    month: monthKey(),
  };
}

/**
 * What has been spent this month, in paise, and on what.
 *
 * @returns {Promise<{total: number, byFeature: object}>}
 */
async function spentThisMonth(context) {
  const db = await BaseModel.getDb();
  const rows = await db.collection(COLLECTION).find(scope(context)).toArray();
  const byFeature = {};
  let total = 0;
  for (const row of rows) {
    const minor = Number(row.cost_minor) || 0;
    total += minor;
    byFeature[row.feature] = (byFeature[row.feature] || 0) + minor;
  }
  return { total, byFeature };
}

/**
 * May this shop make another call?
 *
 * Checked before every call. A shop that has not set a cap is not capped:
 * that is its own decision about its own money, and refusing to work until
 * somebody names a number would be us deciding how they spend.
 *
 * @param {number|null} cap  monthly limit in whole currency units, or null
 */
async function withinCap(context, cap) {
  if (!cap) return { ok: true, spent: null, cap: null };
  const { total } = await spentThisMonth(context);
  const capMinor = Math.round(Number(cap) * 100);
  if (total >= capMinor) {
    return { ok: false, spent: total, cap: capMinor };
  }
  return { ok: true, spent: total, cap: capMinor };
}

/**
 * Write down what a call cost.
 *
 * One row per feature per month, incremented, rather than one row per call.
 * A busy shop makes thousands of calls a month and nobody will ever read them
 * individually; what gets asked is "what did descriptions cost me in March".
 * The call-level detail that is worth keeping - failures, refusals - is in the
 * log, not here.
 */
async function record({ feature, model, tokensIn, tokensOut, payer }, context) {
  const db = await BaseModel.getDb();
  const minor = costMinor({ model, tokensIn, tokensOut });
  await db.collection(COLLECTION).updateOne(
    { ...scope(context), feature: String(feature || 'unknown') },
    {
      $inc: {
        calls: 1,
        tokens_in: Number(tokensIn) || 0,
        tokens_out: Number(tokensOut) || 0,
        cost_minor: minor,
      },
      $set: { last_at: new Date(), last_model: model, payer: payer || 'shop' },
    },
    { upsert: true }
  );
  return minor;
}

/**
 * The ceiling this shop set, or null if it set none.
 *
 * Read here rather than passed in, so a caller cannot forget it and get an
 * uncapped call by omission.
 */
async function capFor(context) {
  const SettingsRepository = require('../repositories/settings.repository');
  if (!repo) repo = new SettingsRepository();
  const preferences = await repo.resolveGroup('preferences', context);
  /* data.values, not data: reading the wrong one finds nothing and quietly
     uncaps every shop that set a limit. */
  const values = (preferences && preferences.status && preferences.data.values) || {};
  const cap = Number(values.ai_monthly_cap);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

let repo = null;

module.exports = {
  capFor,
  spentThisMonth,
  withinCap,
  record,
  costMinor,
  monthKey,
  PRICES,
  FALLBACK_PRICE,
  USD_TO_INR,
  COLLECTION,
};
