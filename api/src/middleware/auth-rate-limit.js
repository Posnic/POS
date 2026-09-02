const rateLimit = require('express-rate-limit');
const { MongoRateLimitStore } = require('./rate-limit-store');
const { perClientKey, perShopKey } = require('./rate-limit-key');

/*
 * Counters in the database, not in this process's memory.
 *
 * The default store is per process, which is correct while each shop has a
 * process of its own. As soon as shops share a pool of workers it silently
 * multiplies every limit by the number of workers - twenty sign-in attempts
 * becomes eighty across four - with the configuration still reading "limit: 20".
 * Each limiter gets its own prefix so their keys cannot collide.
 */

/*
 * A tighter limit on the handful of routes that guess at credentials.
 *
 * The general limiter in app.js allows 1000 requests per fifteen minutes,
 * which is right for a till: one page load makes dozens of calls, and a shop
 * throttled mid-sale is a shop that cannot trade. But applied to a login form
 * that same allowance is a thousand password attempts per quarter hour from
 * one address, which is a workable brute-force window against any password a
 * shopkeeper actually chose.
 *
 * There was also a second limiter in middleware/security.js, never mounted,
 * whose `skip` list named `/auth/login` and `/auth/refresh-token` - exempting
 * the two routes that most need limiting. Written, presumably, meaning "these
 * are special"; the effect was the opposite of the intent. It is deleted
 * rather than fixed, because two limiters and one of them dead is how the
 * next person concludes rate limiting is handled when it is not.
 *
 * The numbers here are chosen against a shop, not a security benchmark:
 * somebody who has genuinely forgotten which of two passwords they used gets
 * plenty of attempts, and a script gets a few seconds of work per guess.
 */

/* Counted per address rather than per account, deliberately. Per-account
   locking lets anybody lock a shop out of their own till by guessing badly at
   their email, which turns a nuisance into an outage. */
const loginLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'login' }),
  /* Per address across every shop on the machine, not per shop. Somebody
     working through a password list against twenty shops from one address is
     one attacker and gets one budget - which is why this differs from the
     general limiter in app.js, and why it is written out rather than left to
     a default that used to mean per-shop only because each shop had its own
     process. */
  keyGenerator: perClientKey,
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: {
    status: false,
    message:
      'Too many sign-in attempts. Please wait ten minutes and try again, ' +
      'or use "forgotten password".',
  },
  standardHeaders: true,
  legacyHeaders: false,
  /* A successful sign-in should not use up the allowance - the shop that
     signs in and out all day is not the one being guarded against. */
  skipSuccessfulRequests: true,
});

/*
 * Sending mail to an address somebody typed.
 *
 * Lower, and it counts successes too: the cost here is not a guessed password
 * but our domain delivering unwanted mail, and a request that "succeeds" is
 * exactly the one that sent it.
 */
const passwordResetLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'pwreset' }),
  /* Per address across every shop on the machine, not per shop. Somebody
     working through a password list against twenty shops from one address is
     one attacker and gets one budget - which is why this differs from the
     general limiter in app.js, and why it is written out rather than left to
     a default that used to mean per-shop only because each shop had its own
     process. */
  keyGenerator: perClientKey,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: {
    status: false,
    message: 'Too many password reset requests. Please wait an hour, or contact support.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/*
 * Creating an account, which also sends mail and claims a name.
 */
const registerLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'register' }),
  /* Per address across every shop on the machine, not per shop. Somebody
     working through a password list against twenty shops from one address is
     one attacker and gets one budget - which is why this differs from the
     general limiter in app.js, and why it is written out rather than left to
     a default that used to mean per-shop only because each shop had its own
     process. */
  keyGenerator: perClientKey,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    status: false,
    message: 'Too many accounts created from this connection. Please wait an hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/*
 * Invoice routes are also mounted at the legacy root path, where app.js's
 * /api-wide limiter does not run. Keep a separate availability budget here so
 * both route prefixes are protected without making a normal till workflow
 * share a small credential-guessing budget.
 */
const invoiceLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: 'invoice' }),
  keyGenerator: perShopKey,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: {
    status: false,
    message: 'Too many invoice requests. Please wait a few minutes and try again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, passwordResetLimiter, registerLimiter, invoiceLimiter };
