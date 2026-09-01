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

function clientIp(req) {
  const forwardedFor = req.headers && req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || '')
        .split(',')[0]
        .trim();
  return req.ip || req.connection?.remoteAddress || forwardedIp || 'unknown';
}

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
  const shadowActor = claims.reason === 'owner sign-in from posnic.com' ? 'owner' : 'support';
  try {
    await spent.createIndex({ jti: 1 }, { unique: true, name: 'jti_once' });
    await spent.createIndex({ usedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60, name: 'jti_ttl' });
    await spent.insertOne({
      jti: claims.jti,
      usedAt: new Date(),
      by: claims.by || null,
      reason: claims.reason || null,
      actor: shadowActor,
    });
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

  /*
   * Hand the token to the browser the way this shop's UI actually reads it.
   *
   * Setting the cookie and redirecting to / looked right and did not work: the
   * frontend authenticates from localStorage.posnic_jwt_token (see
   * static/script/js/core/ajax.js), so it found no token, and the support link
   * landed on the login page every time.
   *
   * So a small page writes the token where the UI looks and then leaves. Same
   * origin - this is the shop's own domain - so localStorage is writable here.
   * The cookie is still set, because the API accepts either.
   *
   * The token is written into the page as JSON rather than interpolated into a
   * string: it is signed base64 with dots and cannot break out of a JSON
   * literal, and doing it this way means it stays true if the token format ever
   * changes.
   */
  /*
   * Both halves of a session, not just the token.
   *
   * This page used to set localStorage.posnic_jwt_token and nothing else, and
   * support kept reporting that "sign in as user" just lands on the login
   * page. It was not a permissions problem or a bad token - the token was
   * fine, and the API accepted it.
   *
   * The frontend decides whether somebody is signed in from TWO things. Every
   * real sign-in path sets both (see users.js around lines 606-752, and
   * lock-screen.js restore()):
   *
   *     localStorage.posnic_jwt_token = <jwt>
   *     document.cookie loginuser=yes
   *
   * With the token but no `loginuser`, the app treats the visit as
   * unauthenticated and redirects to login.html - carrying a perfectly valid
   * credential it has decided not to use. Nothing errors, which is why this
   * survived several rounds of "it still does not work".
   *
   * The cookie is written here the way createCookie writes it: encoded, path=/,
   * and dated. One day, because that is what a normal sign-in uses and a
   * support session has no business outliving it.
   */
  /*
   * The identity fields a NORMAL sign-in stores, not just the token.
   *
   * The page stored token + email and nothing else, and the frontend reads
   * localStorage for the rest: usertype gates admin-only screens (the
   * first-run welcome refused its bypass because usertype was null),
   * username's ABSENCE makes the ajax layer bounce any failed call to
   * login.html, and branchname/branch_id feed the header and the per-shop
   * keys. Every shadow session - which is also how the owner opens shops
   * from My Account - ran half-signed-in, and each missing field failed as
   * its own separate mystery.
   */
  /*
   * Where to land after signing in. The diagnostic rig needs this: a page
   * that only breaks on #/variants or one item's view can't be captured by
   * a run that always lands on the dashboard, and a second browser launch
   * loses the first one's storage when the harness kills Chrome before the
   * profile flushes. One launch, straight to the route, is the only shape
   * that always works. Strictly a hash ROUTE - a handful of safe characters,
   * never a URL - so this can't become an open redirect or script injection.
   */
  const nextRaw = String((req.query && req.query.next) || '');
  const nextRoute = /^[a-zA-Z0-9/_-]{1,80}$/.test(nextRaw) ? nextRaw : '';
  const firstBranch =
    Array.isArray(user.branch_access) && user.branch_access[0] ? user.branch_access[0] : {};
  if (shadowActor === 'owner') {
    const branchId = user.branch_id || firstBranch.branch_id;
    const licenseId = user.license || user.license_id;
    if (branchId && licenseId) {
      const activity = await BaseModel.changeUserLog(
        user._id,
        user.username || user.name || user.email,
        new Date(),
        branchId,
        firstBranch.branch_name || '',
        licenseId,
        {
          userAgent: req.headers['user-agent'] || '',
          ip: clientIp(req),
        }
      );
      if (!activity || activity.status === false) {
        // eslint-disable-next-line no-console
        console.warn('shadow owner activity log failed:', activity && activity.message);
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('shadow owner activity log skipped: branch or license missing');
    }
  }
  const payload = JSON.stringify({
    next: nextRoute,
    token: authToken,
    user: user.email,
    username: user.username || user.name || user.email,
    usertype: user.usertype || '',
    branch_id: user.branch_id
      ? String(user.branch_id)
      : firstBranch.branch_id
        ? String(firstBranch.branch_id)
        : '',
    branch_name: firstBranch.branch_name || '',
  });
  res.set('content-type', 'text/html; charset=utf-8');
  /* Never cached, never indexed. For the next two hours this page body is a
     working credential for someone else's shop. */
  res.set('cache-control', 'no-store, no-cache, must-revalidate, private');
  res.set('x-robots-tag', 'noindex, nofollow');
  return res.send(`<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Signing in…</title>
<style>body{font:15px system-ui;margin:0;display:grid;place-items:center;height:100vh;color:#334}</style>
<p>Signing in…</p>
<script>
(function () {
  var d = ${payload};
  try { localStorage.setItem('posnic_jwt_token', d.token); } catch (e) {}
  try {
    if (d.username) localStorage.setItem('username', d.username);
    if (d.usertype) localStorage.setItem('usertype', d.usertype);
    if (d.branch_id) localStorage.setItem('branch_id_set', d.branch_id);
    if (d.branch_name) localStorage.setItem('branchname', d.branch_name);
  } catch (e) {}
  /* The other half a real sign-in sets. Without it the app has the token and
     still redirects to login.html - see the comment above this template. */
  try {
    var until = new Date();
    until.setTime(until.getTime() + 24 * 60 * 60 * 1000);
    document.cookie = 'loginuser=yes; expires=' + until.toGMTString() + '; path=/';
  } catch (e) {}
  /* replace, not assign: the back button should not return to a page that
     still holds the token in its source. d.next is server-sanitised to a
     bare hash route (letters, digits, slash, dash, underscore only). */
  location.replace(d.next ? '/dashboard.html#/' + d.next : '/');
})();
</script>`);
}

module.exports = { shadowLogin, MAX_LIFETIME_SEC };
