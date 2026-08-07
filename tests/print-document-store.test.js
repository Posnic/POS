/*
 * Serving a print document from a real origin instead of a data: URL.
 *
 * The receipt window loaded its HTML as `data:text/html;...`, whose origin is
 * opaque, while the invoice markup links print.css and the shop's logo from the
 * local API. An opaque origin may not fetch either, so that window ran with web
 * security disabled - correct for printing, and flagged by every audit.
 *
 * Serving the document from the API makes the page same-origin with both, so
 * the exception is not needed. What has to hold for that to be safe:
 *
 *   - a document is fetched once and is then gone
 *   - nothing off this machine can fetch one
 *   - a document that is never collected does not sit in memory
 *   - and the print window must never gain a preload, because its origin is now
 *     loopback, which ipc-guard trusts
 *
 * That last one is the trade this change makes. It is cheap and correct while
 * the window has no preload, and it silently stops being either if one is added.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const store = require('../print-document-store');
const HARDWARE = read('hardware-manager.js');
const APP = read('api', 'app.js');
const pkg = require('../package.json');

test('a document is handed over exactly once', () => {
  const html = '<html><body>invoice</body></html>';
  const token = store.put(html);

  assert.strictEqual(store.take(token), html);
  assert.strictEqual(store.take(token), null, 'a spent token still returned a document');
});

test('an unknown or malformed token gets nothing', () => {
  assert.strictEqual(store.take('not-a-token'), null);
  assert.strictEqual(store.take(''), null);
  assert.strictEqual(store.take(undefined), null);
  assert.strictEqual(store.take(null), null);
  assert.strictEqual(store.take({}), null);
});

test('tokens are long and unpredictable', () => {
  const tokens = new Set(Array.from({ length: 500 }, () => store.put('x')));
  assert.strictEqual(tokens.size, 500, 'a token was issued twice');
  for (const t of tokens) {
    assert.match(t, /^[0-9a-f]{48}$/, 'tokens must be 24 random bytes as hex');
  }
  for (const t of tokens) store.take(t);
});

test('an uncollected document does not linger', () => {
  /* A print cancelled before the page loads leaves nobody to fetch it. It must
     not stay in memory until the till is restarted - it is a customer's
     invoice. */
  store.clear();
  store.put('<html>orphan</html>');
  assert.strictEqual(store.size(), 1);

  const expired = Date.now() + store.TTL_MS + 1000;
  const realNow = Date.now;
  Date.now = () => expired;
  try {
    assert.strictEqual(store.size(), 0, 'an expired document was still held');
  } finally {
    Date.now = realNow;
  }
});

test('an empty document is refused rather than served', () => {
  assert.throws(() => store.put(''), /non-empty/);
  assert.throws(() => store.put(null), /non-empty/);
});

test('the route refuses anything that is not loopback', () => {
  const handler = APP.slice(APP.indexOf("app.get('/print/:token'"));
  const body = handler.slice(0, handler.indexOf('\n  });'));

  assert.match(body, /remoteAddress/, 'the route does not look at where the request came from');
  assert.match(body, /127\.0\.0\.1/, 'loopback is not checked');
  assert.match(body, /status\(403\)/, 'a non-loopback request is not refused');
  assert.match(body, /status\(404\)/, 'a spent or unknown token is not refused');
  assert.match(body, /no-store/, 'a customer invoice must not be cached');
  assert.match(body, /nosniff/, 'the content type must not be sniffed');
});

test('the print window prefers the local route and can fall back', () => {
  const fn = HARDWARE.slice(HARDWARE.indexOf('_resolvePrintRoute(htmlContent)'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));

  assert.match(body, /secure: false/, 'there is no inline fallback');
  assert.match(body, /secure: true/, 'the local route is never used');
  assert.match(body, /process\.env\.PORT/, 'it does not check the API is there');
  assert.match(body, /catch/, 'a failure to reach the store would break printing');
});

test('and web security follows whichever route was chosen', () => {
  /* The whole point: the exception exists only for the fallback. */
  const at = HARDWARE.indexOf('new BrowserWindow({');
  const prefs = HARDWARE.slice(at, HARDWARE.indexOf('});', at));

  assert.match(
    prefs,
    /webSecurity:\s*route\.secure/,
    'the print window no longer ties web security to the route it loads, so ' +
      'either the local route runs with the exception it does not need, or the ' +
      'fallback runs without the one it does',
  );
});

test('the print window has no preload, which is what makes a loopback origin safe', () => {
  /*
   * ipc-guard trusts any loopback origin. Serving print documents from the API
   * puts this window on one - which is harmless only because it has no preload,
   * so window.electron does not exist and there is nothing to invoke.
   *
   * Adding a preload here would hand a document built from page content the
   * full IPC surface, including backup restore and update install. There is no
   * reason a print window needs one.
   */
  const at = HARDWARE.indexOf('new BrowserWindow({');
  const prefs = HARDWARE.slice(at, HARDWARE.indexOf('});', at));

  assert.doesNotMatch(
    prefs,
    /preload/,
    'the receipt print window declares a preload. Its origin is now loopback, ' +
      'which ipc-guard trusts, so a preload would give the printed document ' +
      'access to every IPC channel.',
  );
  assert.match(prefs, /nodeIntegration:\s*false/, 'node integration must stay off');
  assert.match(prefs, /contextIsolation:\s*true/, 'context isolation must stay on');
});

test('the store ships where both sides can reach the same instance', () => {
  /* api/app.js serves the route and hardware-manager.js fills the store. They
     are on opposite sides of the asar boundary, and two copies would be two
     different Maps - the token would never be found. */
  const extra = pkg.build.extraResources.filter((r) => typeof r.from === 'string').map((r) => r.from);

  assert.ok(
    extra.includes('print-document-store.js'),
    'print-document-store.js is not in extraResources, so api/app.js cannot ' +
      'require it in a packaged build',
  );
  assert.ok(
    !pkg.build.files.includes('print-document-store.js'),
    'print-document-store.js is in build.files as well - electron-builder then ' +
      'leaves it out of the asar entirely, and the two sides get different Maps',
  );
  assert.match(
    HARDWARE,
    /process\.resourcesPath,\s*'print-document-store'/,
    'hardware-manager.js must resolve the store from resources/ when packaged',
  );
});
