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
 *
 * A LIVE VOICE LINE is the one call that reports no token count: the audio
 * goes phone to provider and never passes here. So a second of open line is
 * priced below, and voice-meter.js turns the page's "still talking" ticks
 * into seconds, and the seconds into this meter and this cap. Without that,
 * the monthly limit covered every question typed and not a minute spoken,
 * which is the dearest thing the shop can switch on.
 */

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { parseCurrencyLabel } = require('../utils/currency-label');

/*
 * List prices per million tokens, in US dollars, as published September 2026.
 *
 * Out of date the moment a provider changes them, which is why nothing
 * depends on them being right: they drive a meter and a cap, not a charge.
 * A text model that is not listed falls back to the dearest text entry, so
 * an unknown model over-counts rather than escaping the cap. The realtime
 * entries are AUDIO token prices; an unlisted realtime model is priced as
 * gpt-realtime, the dearest of them.
 */
const PRICES = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 5, out: 25 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-realtime': { in: 32, out: 64 },
  'gpt-realtime-mini': { in: 10, out: 20 },
  'gpt-4o-realtime-preview': { in: 40, out: 80 },
  'gpt-4o-mini-realtime-preview': { in: 10, out: 20 },
};
const FALLBACK_PRICE = { in: 5, out: 25 };
const REALTIME_FALLBACK_MODEL = 'gpt-realtime';

function priceFor(model) {
  const name = String(model || '');
  if (PRICES[name]) return PRICES[name];
  if (/realtime/i.test(name)) return PRICES[REALTIME_FALLBACK_MODEL];
  return FALLBACK_PRICE;
}

/*
 * A SECOND OF OPEN LINE, in audio tokens.
 *
 * The phone streams its microphone for the whole call, silence included,
 * which the provider publishes as roughly six hundred input tokens a minute:
 * ten a second. The assistant speaks for under half of a conversation, at
 * about twenty output tokens a second while it talks, so eight a second over
 * the whole line. Rounded up, so a quiet line is over-counted rather than a
 * busy one under-counted: this is a brake, and a brake that grips early is
 * the right way round.
 */
const AUDIO_TOKENS_PER_SECOND = { in: 10, out: 8 };

/*
 * THE SHOP'S OWN CURRENCY.
 *
 * Providers bill in dollars and a shopkeeper reads the till in rupees, or
 * dirhams, or ringgit. The meter and the cap are kept in that currency, in
 * minor units, converted at one rounded rate per currency. Approximate on
 * purpose, and said so on the screen: these are list prices at a rounded
 * rate, driving a meter and a brake, not a charge. Dollars per unit of the
 * shop's currency is the wrong way round to read this table; it is units of
 * the shop's currency per US dollar, September 2026, rounded.
 *
 * A branch stores its currency as the label the signup dropdown showed,
 * "India Rupee / INR or ₹"; utils/currency-label takes the code out of it.
 * A label with no code we know keeps the rupee, which is what every meter
 * before this one assumed, rather than guessing a rate.
 */
const USD_RATES = {
  INR: 88,
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  OMR: 0.385,
  KWD: 0.31,
  BHD: 0.376,
  JOD: 0.71,
  EGP: 49,
  TRY: 40,
  SGD: 1.34,
  MYR: 4.5,
  IDR: 16000,
  THB: 34,
  VND: 25500,
  PHP: 57,
  LKR: 300,
  NPR: 141,
  BTN: 88,
  BDT: 120,
  PKR: 280,
  MVR: 15.4,
  MMK: 2100,
  JPY: 148,
  CNY: 7.2,
  HKD: 7.8,
  KRW: 1380,
  TWD: 32,
  AUD: 1.5,
  NZD: 1.65,
  CAD: 1.37,
  MXN: 18.5,
  BRL: 5.5,
  ARS: 1300,
  CLP: 950,
  COP: 4100,
  PEN: 3.7,
  ZAR: 18,
  KES: 129,
  NGN: 1550,
  GHS: 15,
  TZS: 2600,
  UGX: 3700,
  ETB: 130,
  MUR: 46,
  MAD: 9.8,
  CHF: 0.86,
  SEK: 10.5,
  NOK: 10.7,
  DKK: 6.9,
  PLN: 3.9,
  CZK: 23,
  HUF: 370,
  RON: 4.6,
  RUB: 85,
  ILS: 3.7,
};
const DEFAULT_CURRENCY = { code: 'INR', symbol: '₹', rate: USD_RATES.INR, known: false };

/* The shop thinks in its own currency and the providers bill in dollars.
   Kept as the one number older callers and tests read; the table above is
   the same thing for every currency a shop can be in. */
const USD_TO_INR = USD_RATES.INR;

/* Named so the sync classification finds them: api/src/sync/collections.json
   says both stay local, and why. */
const usageCollection = 'ai_usage';
const COLLECTION = usageCollection;

/** YYYY-MM in UTC. Month boundaries do not need to be the shop's timezone:
    this is a spending window, not a business day. */
const monthKey = (at = new Date()) =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * What one call cost, in minor units of the shop's currency (paise, fils,
 * cents), so nothing is stored as a float.
 *
 * @param {{model: string, tokensIn: number, tokensOut: number, rate?: number}} call
 *   `rate` is units of the shop's currency per US dollar; absent means rupees.
 */
function costMinor({ model, tokensIn, tokensOut, rate }) {
  const price = priceFor(model);
  const usd = ((Number(tokensIn) || 0) * price.in + (Number(tokensOut) || 0) * price.out) / 1e6;
  const perDollar = Number(rate) > 0 ? Number(rate) : USD_TO_INR;
  return Math.round(usd * perDollar * 100);
}

/** The audio tokens a stretch of open line is priced as. Rounded up. */
function voiceTokens(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return {
    tokensIn: Math.ceil(s * AUDIO_TOKENS_PER_SECOND.in),
    tokensOut: Math.ceil(s * AUDIO_TOKENS_PER_SECOND.out),
  };
}

/** What a minute of live voice costs, in minor units, for the screen to say
    beside the switch. A model that cannot hold a line is priced as the one
    that would. */
function voiceMinuteMinor(model, rate) {
  const name = /realtime/i.test(String(model || '')) ? String(model) : REALTIME_FALLBACK_MODEL;
  return costMinor({ model: name, ...voiceTokens(60), rate });
}

/*
 * The shop's currency, from its branch record, remembered for ten minutes so
 * a call metered every half minute does not read the branch every time.
 */
const CURRENCY_TTL_MS = 10 * 60 * 1000;
const currencyCache = new Map();

/**
 * @returns {Promise<{code: string, symbol: string, rate: number, known: boolean}>}
 *   Never throws: a meter that cannot find the currency counts in rupees, as
 *   it always did, rather than refusing the call.
 */
async function currencyOf(context) {
  const branchId = String((context && context.branchId) || '');
  const hit = currencyCache.get(branchId);
  if (hit && Date.now() - hit.at < CURRENCY_TTL_MS) return hit.value;
  let value = DEFAULT_CURRENCY;
  try {
    if (branchId) {
      const db = await BaseModel.getDb();
      const filter = ObjectId.isValid(branchId)
        ? { _id: new ObjectId(branchId) }
        : { _id: branchId };
      const doc = await db
        .collection('branches')
        .findOne(filter, { projection: { currency_text: 1, currency: 1 } });
      const parsed = parseCurrencyLabel((doc && (doc.currency_text || doc.currency)) || '');
      if (parsed.code && USD_RATES[parsed.code]) {
        value = {
          code: parsed.code,
          symbol: parsed.symbol || parsed.code,
          rate: USD_RATES[parsed.code],
          known: true,
        };
      }
    }
  } catch (error) {
    console.error('[ai] could not read the shop currency, counting in rupees:', error.message);
  }
  currencyCache.set(branchId, { at: Date.now(), value });
  return value;
}

function scope(context) {
  return {
    license: BaseModel.license,
    branch_id: String((context && context.branchId) || ''),
    month: monthKey(),
  };
}

/**
 * What has been spent this month, in minor units, and on what.
 *
 * @returns {Promise<{total: number, byFeature: object, details: object}>}
 *   `byFeature` is the cost per feature; `details` adds the calls and the
 *   seconds of line behind it, for a screen that shows more than a number.
 */
async function spentThisMonth(context) {
  const db = await BaseModel.getDb();
  const rows = await db.collection(usageCollection).find(scope(context)).toArray();
  const byFeature = {};
  const details = {};
  let total = 0;
  for (const row of rows) {
    const minor = Number(row.cost_minor) || 0;
    total += minor;
    byFeature[row.feature] = (byFeature[row.feature] || 0) + minor;
    const d = details[row.feature] || { minor: 0, calls: 0, seconds: 0, model: '' };
    d.minor += minor;
    d.calls += Number(row.calls) || 0;
    d.seconds += Number(row.seconds) || 0;
    d.model = row.last_model || d.model;
    details[row.feature] = d;
  }
  return { total, byFeature, details };
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
 *
 * `calls` is one unless said otherwise: a stretch of voice line is metered
 * as seconds on the call that opened it, not as a call of its own.
 */
async function record({ feature, model, tokensIn, tokensOut, payer, seconds, calls }, context) {
  const db = await BaseModel.getDb();
  const currency = await currencyOf(context);
  const minor = costMinor({ model, tokensIn, tokensOut, rate: currency.rate });
  await db.collection(usageCollection).updateOne(
    { ...scope(context), feature: String(feature || 'unknown') },
    {
      $inc: {
        calls: calls == null ? 1 : Number(calls) || 0,
        tokens_in: Number(tokensIn) || 0,
        tokens_out: Number(tokensOut) || 0,
        seconds: Number(seconds) || 0,
        cost_minor: minor,
      },
      $set: {
        last_at: new Date(),
        last_model: model,
        payer: payer || 'shop',
        currency: currency.code,
      },
    },
    { upsert: true }
  );
  return minor;
}

module.exports = {
  spentThisMonth,
  withinCap,
  record,
  costMinor,
  priceFor,
  voiceTokens,
  voiceMinuteMinor,
  currencyOf,
  monthKey,
  PRICES,
  FALLBACK_PRICE,
  AUDIO_TOKENS_PER_SECOND,
  USD_RATES,
  USD_TO_INR,
  DEFAULT_CURRENCY,
  COLLECTION,
  _currencyCache: currencyCache,
};
