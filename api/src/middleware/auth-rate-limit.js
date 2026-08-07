const rateLimit = require('express-rate-limit');

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
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    status: false,
    message: 'Too many accounts created from this connection. Please wait an hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, passwordResetLimiter, registerLimiter };
