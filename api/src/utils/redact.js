/**
 * Take the secrets out of anything about to be logged.
 *
 * A real password reached a real log file on a real machine:
 *
 *   [LOGIN] Request body: { username: 'sri@test.com', password: 'Reset@123' }
 *
 * Two controllers logged `req.body` whole while debugging a login problem,
 * which is the most natural thing in the world to write and the worst possible
 * object to print. The file it lands in is the one a shop sends us when they
 * need help - so the password travels to us by email, sits in an inbox, and
 * gets forwarded on with the rest of the thread.
 *
 * Redacting at the point of logging rather than removing the log lines: the
 * lines are useful, and a rule that says "never log the body" is one somebody
 * breaks the next time they are debugging at midnight. This makes the safe
 * thing the easy thing.
 *
 * Keys are matched by name and case-insensitively, on the way down through
 * nested objects, because a password is as likely to be at data.user.password
 * as at the top.
 */

const SECRET_KEY =
  /pass(word|wd)?$|^pwd$|secret|token|apikey|api_key|authorization|cookie|credential|otp|pin$|hash$|salt$/i;

const REDACTED = '[REDACTED]';

/* Depth limit, because a log call must never be the thing that hangs the
   process on a circular or pathologically deep object. */
const MAX_DEPTH = 6;

/**
 * @param   {unknown} value  anything about to be logged
 * @returns {unknown}        the same shape, with secret-looking values replaced
 */
function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[deep]';
  /* A object that references itself would otherwise recurse forever. */
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));

  /*
   * A null prototype, so a key called __proto__ is a key.
   *
   * With a normal object literal, out['__proto__'] = x does not create a
   * property - it sets the prototype. So an object carrying a __proto__ key
   * lost it from the output entirely, which for this function is the exact
   * wrong failure: a secret stored under that name would have disappeared
   * from the redacted copy while remaining in the original, and the caller
   * logging the "redacted" object would think it had been handled.
   *
   * Object.create(null) has no inherited setter to trigger, so the assignment
   * below is an ordinary own property whatever it is called. JSON.stringify
   * treats it the same as any other object.
   */
  const out = Object.create(null);
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      /* Whether something was supplied is often the useful part - a blank
         password and a wrong one are different bugs - so the shape is kept. */
      out[key] = v === undefined || v === null || v === '' ? v : REDACTED;
    } else {
      out[key] = redact(v, depth + 1, seen);
    }
  }
  return out;
}

module.exports = { redact, REDACTED, SECRET_KEY };
