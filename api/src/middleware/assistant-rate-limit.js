'use strict';
/*
 * How often one phone may ask the ordering assistant.
 *
 * Every question is a model call billed to the shop, from a page anybody can
 * open. The shop's monthly cap is the ceiling; this is the floor under it:
 * one client, a dozen questions a minute, which is more than a person
 * types and far fewer than a script sends. Keyed per client and not per
 * shop, so one phone in a loop cannot use up the minute for the whole
 * restaurant.
 */
const rateLimit = require('express-rate-limit');
const { MongoRateLimitStore } = require('./rate-limit-store');
const { perClientKey } = require('./rate-limit-key');

const assistantLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'assistant' }),
  keyGenerator: perClientKey,
  windowMs: 60 * 1000,
  limit: 12,
  message: {
    type: 'error',
    message: 'Too many questions in a minute. Please wait a moment and ask again.',
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* A live line is a heavier thing to open than a typed question: a handful
   a minute from one client is a person; more is a script. */
const voiceLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'voice' }),
  keyGenerator: perClientKey,
  windowMs: 60 * 1000,
  limit: 6,
  message: {
    type: 'error',
    message: 'Too many voice sessions in a minute. Please wait a moment and try again.',
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* A line reports itself twice a minute. Forty from one client is not a
   person on a call, and each one is a database write. */
const voiceTickLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'voice_tick' }),
  keyGenerator: perClientKey,
  windowMs: 60 * 1000,
  limit: 40,
  message: { type: 'error', message: 'Too many voice reports in a minute.', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

/* Changing an order already on the ticket is rarer than asking about the
   menu and heavier than reading one: a handful a minute is a person changing
   their mind, and more is something else. */
const placedOrderLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'placed_order' }),
  keyGenerator: perClientKey,
  windowMs: 60 * 1000,
  limit: 10,
  message: {
    type: 'error',
    message: 'Too many changes in a minute. Please wait a moment and try again.',
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { assistantLimiter, voiceLimiter, voiceTickLimiter, placedOrderLimiter };
