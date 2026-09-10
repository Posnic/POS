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

test('the kiosk mobile login hands back a credential and a shop key', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'users.controller.js'), 'utf8');

  const start = src.indexOf('async kioskMobileLogin(');
  assert.ok(start > -1, 'kioskMobileLogin is gone');
  /* Bound by the next method so this cannot accidentally read another
     handler's token issuing and pass. */
  const end = src.indexOf('async ssoToken(', start);
  const handler = src.slice(start, end > -1 ? end : undefined);

  assert.match(handler, /jwt_token: jwtToken/,
    'the app has no credential to present to the routes behind protectOrKioskKey');
  assert.match(handler, /signLegacyToken\(recordsFiltered, req\)/,
    'the token must name the user who signed in, not a shared device key');
  assert.match(handler, /shop_key: shopKey/,
    'without a shop key the app cannot tell that a LAN server holds the same shop');
  assert.doesNotMatch(handler, /license: *recordsFiltered\.license/,
    'the licence itself must not travel to the handset; the hash is what is compared');
});
