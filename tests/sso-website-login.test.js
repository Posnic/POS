'use strict';

/*
 * "Go to website" stops depending on a machine that no longer exists.
 *
 * The till's account menu offers a jump to the owner's posnic.com account,
 * already signed in, so nobody has to remember a password last typed at
 * signup. It worked by posting to `api.posnic.com/user.php?action=ssoToken` -
 * a PHP script on a separate box.
 *
 * That box was deleted on 2026-08-29, and the button had already been failing
 * before then: the origin stopped answering HTTPS, so Cloudflare returned 522
 * to everyone. Five presses in the last fifteen days of retained logs, each of
 * which did nothing.
 *
 * Rebuilt against the website's own Node service. These tests pin the parts
 * that would rot quietly rather than loudly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const controller = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'src', 'controllers', 'users.controller.js'),
  'utf8'
);

/* Just the ssoClientLogin method. */
function ssoMethod() {
  const start = controller.indexOf('async ssoClientLogin(req, res)');
  assert.notStrictEqual(start, -1, 'ssoClientLogin is gone');
  const end = controller.indexOf('\n  }', controller.indexOf('catch (error)', start));
  return controller.slice(start, end);
}

test('nothing points at the PHP endpoint any more', () => {
  /* Comments stripped first: the fix explains the old bug by naming it, and a
     guard that reads prose fails on its own documentation. */
  const body = ssoMethod()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/user\.php/.test(body),
    'still calling user.php - that script and the machine serving it are gone');
  assert.ok(!/api\.posnic\.com/.test(body),
    'still naming api.posnic.com, whose DNS record points at a released IP');
});

test('it calls the website, and the website is configurable', () => {
  const body = ssoMethod();
  assert.match(body, /\/api\/sso\/token/, 'must mint against the website service');
  assert.match(body, /POSNIC_SITE_URL/,
    'the site base must be overridable - dev work should not hit production');
  assert.match(body, /process\.env\.SSO_URL/,
    'the explicit override must survive, it is how a local website is tested');
});

test('the returned link has exactly one slash before ssoauth', () => {
  /*
   * The old line joined 'https://www.posnic.com/' to '/ssoauth.html' and put a
   * double slash in every link it ever produced. It happened to work; it
   * should not be reintroduced by someone tidying the base URL.
   */
  const body = ssoMethod();
  const m = body.match(/const path = `([^`]+)`/);
  assert.ok(m, 'the redirect path is no longer a template literal - check it by hand');
  assert.ok(!m[1].includes('//ssoauth'), 'double slash is back in the SSO link');
  assert.match(m[1], /\$\{siteBase\}\/api\/sso\/auth\?token=/,
    'the link must use the /api prefix - CloudFront forwards only that to the service, '
    + 'and a bare /ssoauth answers 403 from the CDN exactly as /ssoauth.html did');
});

test('the website answers the consume route under /api too', (t) => {
  if (!fs.existsSync(WEB_API)) { t.skip('web-api is not checked out beside this repo'); return; }
  const server = fs.readFileSync(WEB_API, 'utf8');
  assert.match(server, /app\.get\('\/api\/sso\/auth', ssoConsume\)/,
    'without the /api route the token can be minted but never used through the CDN');
});

test('the token is url-encoded into the link', () => {
  const body = ssoMethod();
  assert.match(body, /encodeURIComponent\(response\.data\.data\.token\)/,
    'a raw token in a query string breaks on the first token containing +');
});

test('the request cannot hang forever', () => {
  /* Without a timeout, a website that accepts the connection and never answers
     holds the till's request open until something else gives up. */
  const body = ssoMethod();
  assert.match(body, /timeout: \d+/, 'the outbound SSO call needs a timeout');
});

/* --------------------------------------------------------- the website side --- */

const WEB_API = path.join(__dirname, '..', '..', 'web-api', 'server.js');

test('the website mints and consumes the token safely', (t) => {
  if (!fs.existsSync(WEB_API)) {
    t.skip('web-api is not checked out beside this repo');
    return;
  }
  const server = fs.readFileSync(WEB_API, 'utf8');

  assert.match(server, /app\.post\('\/api\/sso\/token'/, 'mint endpoint missing');
  assert.match(server, /app\.get\('\/ssoauth'/, 'consume route missing');

  /* Single use, and atomically so - reading then writing would let two clicks
     on the same link both succeed. */
  assert.match(server, /findOneAndUpdate\(\s*\{ tokenHash, usedAt: null, expiresAt: \{ \$gt: new Date\(\) \} \}/,
    'the token must be claimed atomically on an unused, unexpired row');

  /* Stored hashed, for the same reason passwords are. */
  assert.match(server, /tokenHash: crypto\.createHash\('sha256'\)/,
    'the token must be stored hashed, not in the clear');

  /* The shop key gates minting; without that check any caller could mint a
     session for any account. */
  assert.match(server, /key !== process\.env\.POSNIC_KEY \|\| secret !== process\.env\.POSNIC_SECRET/,
    'minting must be gated on the shop key');

  /* An unset key must not become "no key required". */
  assert.match(server, /!process\.env\.POSNIC_KEY \|\| !process\.env\.POSNIC_SECRET/,
    'an unset POSNIC_KEY must refuse, not allow');

  /* The session is set from the stored userId, never from what the caller
     asked for - otherwise the mint call chooses who you become. */
  assert.match(server, /req\.session\.uid = String\(u\._id\)/);
  assert.match(server, /findOne\(\{ _id: row\.userId \}\)/,
    'the account must come from the token record, not the request');
});

test('the SSO routes forbid caching', (t) => {
  /*
   * posnic.com sits behind CloudFront, and it demonstrably caches on this
   * path: a 404 served before the route existed was still being returned
   * afterwards, and only a cache-busting parameter got through.
   *
   * A cached 404 is confusing. A cached redirect carrying Set-Cookie would
   * hand one person's session to whoever asked next, which is why this is
   * stated explicitly rather than left to the CDN's default handling.
   */
  if (!fs.existsSync(WEB_API)) { t.skip('web-api is not checked out beside this repo'); return; }
  const server = fs.readFileSync(WEB_API, 'utf8');
  assert.match(server, /Cache-Control', 'no-store/,
    'the SSO routes must send no-store');
  const mint = server.indexOf("app.post('/api/sso/token'");
  const consume = server.indexOf('const ssoConsume = async');
  assert.match(server.slice(mint, mint + 200), /noStore\(res\)/, 'mint must not be cacheable');
  assert.match(server.slice(consume, consume + 200), /noStore\(res\)/, 'consume must not be cacheable');
});
