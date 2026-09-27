/*
 * What a phone on the shop Wi-Fi needs from this API, pinned.
 *
 * Two things were broken at once, and each hid the other.
 *
 * The table-ordering app finds the till by asking every address on the network
 * whether it is a Posnic server. The only endpoint that can answer honestly is
 * /api/runtime-info, and it - along with /api/healthz and /api/readyz - was
 * registered near the top of app.js, several hundred lines ABOVE the CORS
 * middleware. So the answer came back without Access-Control-Allow-Origin and
 * the browser threw it away. Discovery fell back to "something replied on port
 * 5555", which a printer or a router admin page satisfies just as well.
 *
 * And once connected, the app signed in through /users/kioskMobileLogin, which
 * authenticates properly and then hands back no credential at all. Every
 * screen after the branch list calls a route behind protectOrKioskKey, so the
 * login succeeded and the app then loaded nothing.
 *
 * These tests read the source rather than standing up the server: the ordering
 * of middleware IS the bug, and an integration test that mounts the app would
 * pass whether or not the order was preserved by a later edit.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'api', 'app.js'), 'utf8');

const cors = require(path.join(ROOT, 'api', 'src', 'middleware', 'cors-origins.js'));

/* The endpoints a device may reach before it has any credential, and which
   therefore have to carry CORS headers of their own. */
const DISCOVERY_ROUTES = ['/api/runtime-info', '/runtime-info', '/api/healthz', '/api/readyz'];

test('the CORS headers are mounted before every discovery endpoint', () => {
  const mountedAt = APP_JS.indexOf('app.use(corsHeaders)');
  assert.ok(mountedAt > -1, 'corsHeaders is not mounted in app.js');

  for (const route of DISCOVERY_ROUTES) {
    const declaredAt = APP_JS.indexOf(`app.get('${route}'`);
    assert.ok(declaredAt > -1, `${route} is no longer declared in app.js`);
    assert.ok(
      mountedAt < declaredAt,
      `${route} is declared before the CORS headers are mounted, so a browser ` +
        'on the shop network cannot read its answer'
    );
  }
});

test('a Capacitor app shell is an allowed origin', () => {
  /* Which string a packaged app sends is decided by the packager. Android with
     androidScheme "http" sends http://localhost; iOS sends capacitor://. */
  const req = { headers: { host: 'shop.posnic.io' } };
  for (const origin of ['http://localhost', 'https://localhost', 'capacitor://localhost']) {
    assert.ok(cors.isAllowedOrigin(origin, req), `${origin} is refused`);
  }
});

test('an opaque origin is still refused', () => {
  /* "null" is what a file:// page sends - and also what a sandboxed iframe and
     any other opaque origin sends. Allowing it to support one packaging mode
     would open the API to any page that framed itself. */
  const req = { headers: { host: 'shop.posnic.io' } };
  assert.equal(cors.isAllowedOrigin('null', req), false);
  assert.equal(cors.isAllowedOrigin('https://evil.example', req), false);
});

test('a device on the shop LAN is an allowed origin', () => {
  const req = { headers: { host: '192.168.1.5:5555' } };
  assert.ok(cors.isAllowedOrigin('http://192.168.1.9', req));
  assert.ok(cors.isAllowedOrigin('http://10.0.0.4:8100', req));
  assert.equal(cors.isAllowedOrigin('http://8.8.8.8', req), false);
});

test('the response varies by origin, so a cache cannot cross-serve the header', () => {
  const headers = {};
  const res = { header: (k, v) => { headers[k] = v; }, status: () => res, end: () => res };
  let nexted = false;
  cors.corsHeaders({ method: 'GET', headers: { origin: 'http://localhost' } }, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(headers.Vary, 'Origin');
});

test('a preflight is answered without falling through', () => {
  const res = {
    statusCode: null,
    header() { return res; },
    status(code) { res.statusCode = code; return res; },
    end() { return res; },
  };
  let nexted = false;
  cors.corsHeaders({ method: 'OPTIONS', headers: { origin: 'http://localhost' } }, res, () => { nexted = true; });
  assert.equal(res.statusCode, 200);
  assert.equal(nexted, false, 'a preflight must not continue into the app');
});

/* The kiosk login handler alone. mobileLogin next door is a near-copy, so a
   whole-file match would pass on the wrong one. */
function kioskLoginHandler() {
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'users.controller.js'), 'utf8');
  const start = src.indexOf('async kioskMobileLogin(');
  assert.ok(start > -1, 'kioskMobileLogin is gone');
  const end = src.indexOf('async ssoToken(', start);
  return src.slice(start, end > -1 ? end : undefined);
}

test('the kiosk mobile login hands back a credential and a shop key', () => {
  const handler = kioskLoginHandler();

  assert.match(handler, /token: jwtToken/,
    'the app has no credential to present to the routes behind protectOrKioskKey');
  /*
   * The RULE, not the call's exact spelling.
   *
   * This pinned `signLegacyToken(recordsFiltered, req)` as a literal, and so
   * went red the moment a handset token was given its own lifetime:
   *
   *     signLegacyToken(recordsFiltered, req, undefined, handsetSeconds)
   *
   * Nothing about that weakened the credential - it is still signed from the
   * user who signed in - but develop carried a failing suite for it, which is
   * how a red test stops meaning anything. What has to hold is that the user
   * and the request are what the token is signed FROM; how long it then lasts
   * is a separate decision, and adding arguments must not fail this.
   */
  assert.match(handler, /signLegacyToken\(\s*recordsFiltered\s*,\s*req/,
    'the token must name the user who signed in, not a shared device key');
  /*
   * The client is told the SAME lifetime the token was signed with.
   *
   * This pinned `expiresIn: jwtLifetimeSeconds()` as a literal, and went red
   * when a handset was given its own, longer lifetime:
   *
   *     const handsetSeconds = handsetLifetimeSeconds();
   *     signLegacyToken(recordsFiltered, req, undefined, handsetSeconds);
   *     expiresIn: handsetSeconds,
   *
   * Which is better than what it replaced, and the test failed it anyway. The
   * property worth holding is not WHICH clock the lifetime comes from - a
   * handset on a floor all day should not expire like a till - but that the
   * number reported is the number the token carries. A client told a
   * different figure refreshes too often or, worse, too late.
   *
   * So the fourth argument to signLegacyToken is read out of the source, and
   * expiresIn must report that same identifier.
   */
  /*
   * NAMED IN ONE PLACE, THEN USED TWICE - however the call is spelled.
   *
   * The lifetime is read out of `const <name> = handsetLifetimeSeconds()`
   * rather than out of the argument list, and the call is then asked whether
   * it CONTAINS that name. The previous version matched by POSITION and
   * required the call to end immediately after the fourth argument, so it
   * failed the day anybody added a fifth - and this test has already gone red
   * twice for changes that improved the code it guards. That is a veto on the
   * controller dressed up as a test, and it nearly stopped a device claim
   * being added to the token.
   *
   * What has to hold is unchanged: one source for the number, and the phone
   * told the same one its token carries.
   */
  const lifetime = handler.match(/const (\w+) = handsetLifetimeSeconds\(\)/);
  assert.ok(lifetime, 'the handset lifetime is no longer read from one place');
  const named = lifetime[1];

  const call = handler.match(/signLegacyToken\([^)]*\)/);
  assert.ok(call, 'the handset token is no longer signed here');
  assert.ok(
    call[0].includes(named),
    'the token is signed with a lifetime other than the one the phone is told: ' + named
  );
  assert.ok(
    handler.includes('expiresIn: ' + named),
    'the phone is told an expiry that is not the one its token carries: signed with ' + named
  );

  assert.match(handler, /shopKey,/,
    'without a shop key the app cannot tell that a LAN server holds the same shop');
  assert.doesNotMatch(handler, /license: *recordsFiltered\.license/,
    'the licence itself must not travel to the handset; the hash is what is compared');
});

test('sign-in failures answer with the status that says what happened', () => {
  /*
   * Every branch answered 404 - "there is no such endpoint". A wrong password,
   * a locked-out device and a wrong server address were indistinguishable to
   * the client, which left the app nothing to act on but the English in the
   * message, and sent users looking for a fault in the URL.
   */
  const handler = kioskLoginHandler();

  assert.match(handler, /res\.status\(400\)[\s\S]{0,200}MISSING_CREDENTIALS/,
    'an empty submission is a bad request');
  assert.match(handler, /res\.status\(401\)[\s\S]{0,200}INVALID_CREDENTIALS/,
    'a wrong password is failed authentication');
  assert.match(handler, /res\.status\(429\)[\s\S]{0,200}TOO_MANY_ATTEMPTS/,
    'a lockout is rate limiting, and the client should be told to wait');
  assert.match(handler, /Retry-After/,
    'a 429 without Retry-After leaves the client guessing how long to wait');
  assert.match(handler, /res\.status\(500\)/,
    'a database failure is the server’s fault, not the caller’s');

  assert.doesNotMatch(handler, /res\.status\(404\)/,
    'nothing about a sign-in is a missing resource');
  assert.doesNotMatch(handler, /message: error\.message/,
    'the internal failure text must not be echoed to a stranger');
});

test('the token lifetime the client is told matches the one it is signed with', () => {
  const { jwtLifetimeSeconds } = require(
    path.join(ROOT, 'api', 'src', 'utils', 'token-lifetime.js'));

  for (const [value, expected] of [['24h', 86400], ['30m', 1800], ['7d', 604800], ['900', 900]]) {
    assert.equal(jwtLifetimeSeconds({ JWT_EXPIRES_IN: value }), expected,
      `${value} should be ${expected}s`);
  }
  /* Unset or malformed falls back to the same default the signers use. A bad
     setting must not stop sign-in, and must not report a lifetime the token
     does not have. */
  assert.equal(jwtLifetimeSeconds({}), 86400);
  assert.equal(jwtLifetimeSeconds({ JWT_EXPIRES_IN: 'nonsense' }), 86400);
});

test('the signers and the reported lifetime read the same setting', () => {
  const auth = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'middleware', 'auth.js'), 'utf8');
  const lifetime = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'utils', 'token-lifetime.js'), 'utf8');

  /* Both must fall back to the same value, or a client is told an expiry the
     token does not have. */
  assert.match(auth, /expiresIn: jwtLifetimeSeconds\(\)/);
  assert.match(auth, /expiresIn: expiresIn \|\| jwtLifetimeSeconds\(\)/);
  assert.match(lifetime, /const DEFAULT = '24h'/);
});
