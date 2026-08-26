/*
 * Which routes an anonymous caller may reach.
 *
 * Written before making this repository public, because publishing the source
 * turns "nobody knows the endpoint exists" into no protection at all.
 *
 * A group of sales routes ran behind optionalProtect and nothing else.
 * optionalProtect tries to authenticate and never refuses, so a caller who
 * simply did not authenticate carried on as anonymous - and the handlers, with
 * no session to read the branch from, took it from the request instead:
 * req.body.branch_id, req.query.branchId, req.body.order_id.
 *
 * The effect was that anyone who could reach the API could name any branch of
 * any shop and read its live tables, its order history, its catalogue and its
 * printed receipts. updateOrder went further: it accepts items, totals and
 * discounts, so an anonymous request could rewrite what another shop's order
 * said it cost.
 *
 * These tests fix the list of routes that may be reached without a session, and
 * require the rest to prove they are the shop's own equipment.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES_DIR = path.join(__dirname, '..', 'api', 'src', 'routes');

/* Routes declared before a file's router.use(protect), i.e. reachable without
   a login session. */
function openRoutes(file) {
  const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  const guardAt = (() => {
    const m = src.match(/router\.use\(\s*(protect|auth\b)/);
    return m ? m.index : Infinity;
  })();

  /* Both quote styles. This matched only double quotes for months, and a
     route file written with single quotes - which is most of them - escaped
     the sweep entirely. A security test that inspects a dialect nobody
     writes is a security test in name. Found when a deliberately public
     route passed without being allowed. */
  return [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']([^;]*)/g)]
    .filter((m) => m.index < guardAt)
    .map((m) => ({ method: m[1], route: m[2], middleware: m[3] }));
}

/*
 * The only routes that may be reached with no credential of any kind.
 *
 * Each is here for a stated reason. Adding to this list is a decision about
 * what strangers may do to a shop's data, so it should take a code review.
 */
const ALLOWED_ANONYMOUS = {
  'users.routes.js': [
    // Invisible to this sweep for months: the file is single-quoted and the
    // sweep matched only double quotes. Reviewed on discovery - every one
    // is an auth ENTRY point or carries its own credential.
    '/register', '/login', '/verify',
    // self-authenticating logins for the phone and kiosk apps
    '/mobileLogin', '/kioskMobileLogin',
    // key+secret travel IN the path - installation credentials
    '/ssoAuth', '/ssoToken/:key/:secret', '/planUpdate/:key/:secret',
    // the forgot-password flow: both require the emailed one-time user_key
    '/getUserKeyDetails', '/updateNewPassword',
  ],
  'client-errors.routes.js': [
    // The boot watchdog's report: the errors worth hearing about happen
    // BEFORE auth works. Stores nothing, per-IP budgeted, truncated,
    // always 204 - see the route file.
    '/',
    // TEMPORARY diagnostic window (OWNER_QUEUE row 193): the last 30
    // already-truncated report lines, readable where no audited log path
    // exists. Comes out with the boot flight recorder once the mobile
    // crash is closed.
    '/recent',
  ],
  'auth.routes.js': [
    '/register', '/login', '/verify', '/forgot-password', '/reset-password/:token',
  ],
  'settings.routes.js': [
    // Static reference data. No shop's information is in any of them.
    '/getJSONCountry', '/getJSONState', '/getJSONCurrency', '/getJSONTimeZone',
    '/forgotPassword',
  ],
  'items.routes.js': [
    // The pairing handshake a kiosk, QR page or phone makes before it has a key.
    '/accesskiosk', '/accessQr', '/accessMobileApp',
  ],
  'sales.routes.js': [
    // getNewSale refuses an anonymous caller inside the handler (403 without
    // sales.write). qrOrder is anonymous BY DESIGN - a customer's phone has no
    // credentials - and is gated in the repository instead: only a branch with
    // a configured QR identity (kiosk.store_id) accepts orders, so a shop that
    // never enabled QR ordering exposes nothing.
    '/qrOrder', '/getNewSale',
  ],
  'base.routes.js': [
    // Liveness only. "/" says it is running; "/health" reports status, time and
    // uptime to a stranger and keeps the version, platform and memory figures
    // for callers who have logged in.
    '/', '/health',
  ],
};

/*
 * verifyInstallationCredentials belongs here: the install routes are how a
 * fresh machine registers itself, before any user exists to log in as, and they
 * check the per-installation key and secret instead.
 */
const GUARDS =
  /(protect|ensureKioskKey|protectOrKioskKey|authenticate|verifyToken|verifyInstallationCredentials)/;

test('the route files are where the test thinks they are', () => {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.routes.js'));
  assert.ok(files.length > 15, `only ${files.length} route files found`);
});

test('nothing reachable without a session is left unguarded', () => {
  const naked = [];

  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.routes.js'))) {
    const allowed = ALLOWED_ANONYMOUS[file] || [];

    for (const { method, route, middleware } of openRoutes(file)) {
      if (allowed.includes(route)) continue;
      if (GUARDS.test(middleware)) continue;
      naked.push(`${file}  ${method.toUpperCase()} ${route}`);
    }
  }

  assert.deepStrictEqual(naked, [],
    'these are reachable with no credential at all. Either add a guard ' +
    '(protectOrKioskKey for kitchen and tablet callers, protect otherwise) or ' +
    'add them to ALLOWED_ANONYMOUS with the reason:\n  ' + naked.join('\n  '));
});

test('optionalProtect is never the only thing in front of a route', () => {
  /* This is the specific mistake that was made. optionalProtect authenticates
     when it can and lets everyone else through, so on its own it is not a
     guard - it only looks like one. */
  const lonely = [];

  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.routes.js'))) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(/router\.\w+\(\s*"([^"]+)"\s*,\s*optionalProtect\s*,\s*(\w+)/g)) {
      if (!GUARDS.test(m[2])) lonely.push(`${file}  ${m[1]}  -> ${m[2]}`);
    }
  }

  assert.deepStrictEqual(lonely, [],
    'optionalProtect never returns 401, so it must be followed by a real ' +
    'guard:\n  ' + lonely.join('\n  '));
});

test('the routes that leaked are specifically closed', () => {
  /* Named one by one rather than left to the sweep above: these are the actual
     holes that were open, and each should fail loudly if it reopens. */
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'sales.routes.js'), 'utf8');

  const MUST_BE_GUARDED = [
    ['/getTablesWithActiveOrders', 'live unpaid orders for any branch'],
    ['/getOrderHistory', "any branch's order history"],
    ['/updateOrder', 'rewrites items, totals and discounts on any order'],
    ['/searchProducts', "any branch's catalogue and prices"],
    ['/getFrequentItems', "any branch's popular items"],
    ['/getListKot', "any branch's kitchen queue"],
    ['/getCustomerPrint', 'any sale receipt, with the customer on it'],
  ];

  /*
   * Read whole registrations, not lines.
   *
   * This used to scan for a line containing both `router.` and the
   * double-quoted path. Two things then broke it at once: Prettier prefers
   * single quotes, and it wraps a call this long across several lines - so
   * `router.get(`, the path and the guards each ended up on their own line.
   * Every route in this list looked as though it had vanished, which is the
   * most alarming way for a test to be wrong about a security check.
   *
   * Splitting on `router.` and taking each call up to its closing `);` reads
   * the same registration whatever shape the formatter leaves it in.
   */
  const calls = src
    .split(/\brouter\.(?=get|post|put|patch|delete|all)/)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf(');') + 2));

  for (const [route, what] of MUST_BE_GUARDED) {
    const quoted = new RegExp(`['"\`]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    const matching = calls.filter((c) => quoted.test(c));
    assert.ok(matching.length > 0, `${route} has vanished from the routes`);
    for (const call of matching) {
      assert.match(call, /protectOrKioskKey|(?<!optional)protect\b/,
        `${route} is unguarded again - it exposes ${what}`);
    }
  }
});

test('anonymous qrOrder only serves branches that opted into QR', () => {
  /*
   * qrOrder is anonymous by design - a customer's phone has no credentials -
   * so the gate lives in the repository: no configured QR identity
   * (kiosk.store_id), no order. Without it, any branch's raw ObjectId (which
   * appears in every authenticated response and is no secret) was enough for
   * a stranger to put orders on its kitchen queue. Asserted here because the
   * repository's own unit file sits in jest's CI ignore list.
   */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'src', 'repositories', 'sale.repository.js'), 'utf8');
  const start = src.indexOf('async qrOrderModel');
  assert.ok(start >= 0, 'qrOrderModel has gone or been renamed');
  const insertAt = src.indexOf('insertOne', start);
  const beforeCreate = src.slice(start, insertAt > start ? insertAt : start + 4000);

  assert.match(beforeCreate, /branchDoc\.kiosk\s*\|\|\s*!branchDoc\.kiosk\.store_id/,
    'the QR opt-in gate is gone - any branch id would accept anonymous orders again');
  assert.ok(beforeCreate.includes('QR ordering is not enabled for this branch'),
    'the refusal message changed or moved after order creation');
});

test('the kiosk key is compared in constant time', () => {
  /* A plain !== leaks, through timing, roughly how many leading characters were
     right. Slow, but a way in, and these endpoints face the shop floor. */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'src', 'middleware', 'kiosk-key.js'), 'utf8');

  assert.match(src, /timingSafeEqual/, 'the kiosk key comparison is not constant time');
  assert.ok(!/kioskKey\s*!==\s*expected/.test(src),
    'the old direct string comparison is back');
});

test('a length mismatch does not short-circuit the comparison', () => {
  const { protectOrKioskKey } = require('../api/src/middleware/kiosk-key');
  assert.strictEqual(typeof protectOrKioskKey, 'function');
});

/* ---- and the guard itself behaves ------------------------------------- */

const { protectOrKioskKey } = require('../api/src/middleware/kiosk-key');

function run(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ blocked: true, code: this.statusCode, body }); },
    };
    protectOrKioskKey(req, res, () => resolve({ blocked: false }));
  });
}

test('a signed-in user passes untouched', async () => {
  const out = await run({ user: { _id: 'u1' }, headers: {} });
  assert.strictEqual(out.blocked, false);
});

test('an anonymous caller with no key is refused', async () => {
  process.env.KIOSK_API_KEY = 'a'.repeat(64);
  const out = await run({ headers: {} });
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.code, 401);
});

test('an anonymous caller with the wrong key is refused', async () => {
  process.env.KIOSK_API_KEY = 'a'.repeat(64);
  const out = await run({ headers: { kioskkey: 'b'.repeat(64) } });
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.code, 401);
});

test('a wrong key of a different length is refused, not crashed on', async () => {
  /* timingSafeEqual throws when the buffers differ in length; an unhandled
     throw here would be a 500 that says the length was wrong. */
  process.env.KIOSK_API_KEY = 'a'.repeat(64);
  const out = await run({ headers: { kioskkey: 'short' } });
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.code, 401);
});

test('the shop’s own equipment, holding the key, passes', async () => {
  process.env.KIOSK_API_KEY = 'a'.repeat(64);
  const out = await run({ headers: { kioskkey: 'a'.repeat(64) } });
  assert.strictEqual(out.blocked, false);
});

test('with no key configured, anonymous access stays shut', async () => {
  /* Failing open here would expose these endpoints on every install that
     started without a kiosk key - which is most of them. */
  delete process.env.KIOSK_API_KEY;
  const out = await run({ headers: { kioskkey: 'anything' } });
  assert.strictEqual(out.blocked, true);
  assert.strictEqual(out.code, 401);
});

test('the public health answer does not name the runtime', () => {
  /* An unauthenticated /health used to return process.version, the platform and
     the environment name - the exact list wanted by someone choosing which
     published Node vulnerability to try. */
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'base.routes.js'), 'utf8');
  const health = src.search(/router\.get\(\s*['"`]\/health['"`]/);
  assert.ok(health >= 0, 'the /health route has gone or changed shape');
  const handler = src.slice(health);
  const body = handler.slice(0, handler.indexOf('\n});'));

  assert.match(body, /if \(req\.user\)/,
    'the detailed health payload is not gated on being signed in');

  const beforeGate = body.slice(0, body.indexOf('if (req.user)'));
  for (const leak of ['process.version', 'process.platform', 'NODE_ENV', 'memoryUsage']) {
    assert.ok(!beforeGate.includes(leak),
      `/health tells an anonymous caller ${leak}`);
  }
});

test('registration cannot be reached, or self-promoted, by a stranger', () => {
  /*
   * POST /auth/register sat above router.use(protect), and the handler passed
   * role straight from the request body into User.create. The schema's role
   * enum includes "admin" and "super_admin", and hasPermission returns true for
   * everything when role is "admin" - so an unauthenticated caller could name
   * themselves super_admin and be signed in as one. The API router is mounted
   * at both /api and /, so it was reachable twice over.
   *
   * Two independent things have to hold, because either alone is enough to be
   * bitten by: the route must not be anonymous, and the handler must not take a
   * role from whoever is asking.
   */
  const routes = fs.readFileSync(path.join(ROUTES_DIR, 'auth.routes.js'), 'utf8');
  const line = routes.split('\n').find((l) => /router\.post\(\s*['"`]\/register['"`]/.test(l));

  assert.ok(line, 'the register route has gone or changed shape');
  assert.match(line, /verifyInstallationCredentials|protect/,
    'POST /auth/register is anonymous again');

  const handler = fs.readFileSync(
    path.join(ROUTES_DIR, '..', 'controllers', 'auth.controller.js'), 'utf8');
  const create = handler.slice(handler.indexOf('exports.register'));
  const body = create.slice(0, create.indexOf('});'));

  for (const claimed of ['role', 'usertype', 'access', 'license']) {
    assert.ok(!new RegExp(`${claimed}:\s*req\.body\.`).test(body),
      `register takes ${claimed} from the request body - privilege is granted, not claimed`);
  }
});
