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
const { perClientKey, perPlacedOrderKey, perShopKey } = require('./rate-limit-key');

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
/*
 * THIRTY, NOT TEN, BECAUSE EVERY TAP COSTS ONE.
 *
 * This covers reading an order back AND changing it, and the screens that
 * change one have a plus and a minus on every line. Ten a minute is one tap
 * every six seconds, which somebody correcting a quantity passes without
 * noticing - and the refusal lands as a details panel that empties itself
 * under their thumb. Owner: "not working page broken."
 *
 * It was worse than that: a change answered with too little to redraw from,
 * so each tap spent TWO - the change and a read afterwards. That is fixed at
 * the source (customer-order.service, viewOf), and this is the headroom
 * around it. Thirty a minute is still nowhere near what hammering looks
 * like, and the door itself is proof-bound: an id and a token per order.
 */
const placedOrderLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'placed_order' }),
  /* PER ORDER, NOT PER ADDRESS. A restaurant is one address: every diner is
     behind the shop's own wifi, so an address key hands the whole room one
     budget and refuses one table for another table's taps. See
     perPlacedOrderKey, which keeps the address in the key as well. */
  keyGenerator: perPlacedOrderKey,
  windowMs: 60 * 1000,
  limit: 30,
  message: {
    type: 'error',
    message: 'Too many changes in a minute. Please wait a moment and try again.',
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/*
 * THE BACKSTOP, because the limiter above is deliberately generous per order.
 *
 * Giving every order its own budget is right for customers and would be wrong
 * on its own: a script naming a new order id each time would get a fresh
 * budget every request. This one is per address and per shop, set high enough
 * that a full restaurant never reaches it - fifty tables tapping at once is
 * far short - and low enough that a machine hammering the shop does.
 */
const placedOrderFloodLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'placed_order_flood' }),
  keyGenerator: perShopKey,
  windowMs: 60 * 1000,
  limit: 600,
  message: {
    type: 'error',
    message: 'Too many requests from this network. Please wait a moment and try again.',
    data: null,
  },
  standardHeaders: false,
  legacyHeaders: false,
});

/*
 * How often one table may call a waiter.
 *
 * The rule that matters is in the repository - one open call per table, so a
 * second tap answers with the first call rather than writing another. This is
 * the floor under it: a button anybody in the room can reach is a button
 * anybody can hold down, and six a minute is far more than a person taps and
 * far fewer than a script sends.
 */
const waiterCallLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'waitercall' }),
  keyGenerator: perClientKey,
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  waiterCallLimiter,
  assistantLimiter,
  voiceLimiter,
  voiceTickLimiter,
  placedOrderLimiter,
  placedOrderFloodLimiter,
};
