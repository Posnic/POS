/*
 * Support logging in as a shop's own user.
 *
 * "The totals are wrong on my sales report" cannot be answered from outside the
 * shop. The alternatives are worse than this: asking a shopkeeper for their
 * password, or keeping a support account in every tenant - a permanent extra
 * credential per shop, which is a larger standing risk than a link that lives
 * for a minute.
 *
 * The console mints a token signed with *this shop's* JWT_SECRET, which it can
 * already read from the control database because it seals those secrets in the
 * first place. That deliberately adds no new shared secret: anyone who could
 * forge one of these could already forge an ordinary login token, so this opens
 * no door that the secret itself does not already open.
 *
 * Four things make it narrow.
 *
 *   - It carries `uid`, never `id`. The auth middleware reads `decoded.id`, so
 *     this token cannot be presented as an ordinary credential; it can only be
 *     spent here, once, for the one thing it is for.
 *   - It is valid for a minute. Long enough to follow a link, too short to be
 *     worth keeping.
 *   - It is single use, enforced by a unique index rather than by a check -
 *     two simultaneous uses of the same link cannot both win a race against an
 *     index.
 *   - Every use is written to the shop's own records, marked as impersonation
 *     and naming the officer. A support action nobody can see afterwards is
 *     indistinguishable from an intrusion.
 */

const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { authCookieOptions } = require('../utils/auth-cookie');
const { currentDb, currentSecret } = require('../db/tenant-context');
const BaseModel = require('../models/base.model');

/* The shop is the one that decides how long is acceptable, not the caller. A
   token arriving with a year-long expiry is refused however well it is signed:
   otherwise the console could mint a permanent key to any shop by accident. */
const MAX_LIFETIME_SEC = 120;

async function shadowLogin(req, res) {
  const token = req.query.token || req.body?.token;
  if (!token) return res.status(400).send('This link is missing its token.');

  let claims;
  try {
    claims = await promisify(jwt.verify)(token, currentSecret('JWT_SECRET'));
  } catch (e) {
    /* Not distinguished for the caller. "Expired" versus "bad signature" tells
       someone probing exactly which half to work on. */
    return res.status(401).send('This link is not valid. Ask for a new one.');
  }

  if (claims.purpose !== 'shadow' || !claims.uid || !claims.jti) {
    return res.status(401).send('This link is not valid. Ask for a new one.');
  }
  if (!claims.exp || !claims.iat || claims.exp - claims.iat > MAX_LIFETIME_SEC) {
    return res.status(401).send('This link was issued for too long a period.');
  }

  /* The same seam every model reads through: the tenant in context if this
     process serves several shops, and the single connection if it does not.
     Reaching for a connection any other way is what the single-entry-point
     test exists to catch. */
  const db = currentDb(BaseModel.database);
  if (!db) return res.status(500).send('This shop is not ready.');

  /*
   * Spend the token.
   *
   * A unique index, not a read-then-write: two clicks on the same link arriving
   * together would both pass a check and both succeed. The insert makes the
   * database settle it, and the loser gets the same message as a stale link.
   *
   * The TTL index keeps this collection from growing forever; the records are
   * only needed for as long as a token could still be replayed.
   */
  const spent = db.collection('shadow_login_tokens');
  try {
    await spent.createIndex({ jti: 1 }, { unique: true, name: 'jti_once' });
    await spent.createIndex({ usedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60, name: 'jti_ttl' });
    await spent.insertOne({ jti: claims.jti, usedAt: new Date(), by: claims.by || null });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(401).send('This link has already been used. Ask for a new one.');
    }
    throw e;
  }

  const User = require('../models/user.model');
  const user = await User.findById(claims.uid).select('+active');
  if (!user || user.active === false) {
    return res.status(404).send('That user no longer exists in this shop.');
  }

  /*
   * Recorded in the shop's own audit trail, before the session exists.
   *
   * Written first on purpose: if anything below fails, the attempt is still on
   * record. An impersonation that is only logged on success is a log that
   * hides its own failures.
   */
  await db
    .collection('audit_log')
    .insertOne({
      action: 'shadow_login',
      at: new Date(),
      officer: claims.by || 'unknown',
      reason: claims.reason || null,
      user_id: user._id,
      user_email: user.email,
      ip: req.ip,
      note: 'Signed in from the Posnic console as this user.',
    })
    .catch(() => {});

  /*
   * From here it is an ordinary session, with one difference: it is marked.
   *
   * The mark is what makes the shop's own records honest - a sale or an edit
   * made during support should never be indistinguishable from one the
   * shopkeeper made.
   */
  const authToken = jwt.sign(
    { id: user._id, shadow: true, by: claims.by || null },
    currentSecret('JWT_SECRET'),
    { expiresIn: '2h' }
  );

  res.cookie(
    'jwt',
    authToken,
    authCookieOptions({
      expires: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
  );

  if (req.session) {
    req.session.shadow = { by: claims.by || null, at: new Date(), user: user.email };
  }

  /* Sent to the shop itself rather than answered with JSON: this is reached by
     following a link, and a page of JSON is not somewhere to arrive. */
  return res.redirect('/');
}

module.exports = { shadowLogin, MAX_LIFETIME_SEC };
