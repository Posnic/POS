'use strict';

/*
 * The address we put in an email, and the two ways it goes wrong.
 *
 * WRONG THE FIRST WAY - dead. Forgot-password read SERVER_NAME, which is set on
 * no process in the estate, fell through to the localhost branch, and mailed
 * every hosted shop a link to http://localhost:3000/forgotpassword.html. That
 * is the recipient's own computer, on a port with nothing listening. Self-
 * service password recovery has never worked for a cloud shop, which is why a
 * locked-out owner needed five days and a database session to get back into his
 * own till.
 *
 * WRONG THE SECOND WAY - poisoned. The obvious repair is to build the link from
 * req.headers.host, and that is password-reset poisoning, the oldest attack
 * against exactly this code: send `Host: evil.example`, and the victim receives
 * a genuine email from us carrying a link that hands their token to somebody
 * else. This application is more exposed than most, because the host does not
 * select the database here - the process already knows its shop - so a forged
 * host is contradicted by nothing downstream.
 *
 * Both failures are pinned below. The second matters more: a dead link is a
 * support ticket, a poisoned one is an account takeover.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  publicBaseUrl, publicPageUrl, isOwnHost, looksLikeHostname,
} = require('../api/src/utils/public-url');

const withHost = (host, extra = {}) => ({ headers: { host, ...extra } });

/* The environment must not leak between tests - PUBLIC_BASE_URL short-circuits
   everything, so one stray value would make the rest pass for the wrong reason. */
function clean(run) {
  const saved = {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    SERVER_NAME: process.env.SERVER_NAME,
    PUBLIC_EXTRA_DOMAINS: process.env.PUBLIC_EXTRA_DOMAINS,
  };
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.SERVER_NAME;
  delete process.env.PUBLIC_EXTRA_DOMAINS;
  try { return run(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('a shop gets a link to itself', () => {
  clean(() => {
    assert.equal(
      publicBaseUrl(withHost('pugazhfashion26.posnic.io')),
      'https://pugazhfashion26.posnic.io'
    );
    assert.equal(
      publicPageUrl(withHost('pugazhfashion26.posnic.io'), 'forgotpassword.html', { forgotpassword_Id: 'abc123' }),
      'https://pugazhfashion26.posnic.io/public/forgotpassword.html?forgotpassword_Id=abc123'
    );
  });
});

test('nobody is ever sent to localhost again', () => {
  /* The exact bug. A hosted shop must never produce this string. */
  clean(() => {
    const link = publicPageUrl(withHost('kiranastore.posnic.io'), 'forgotpassword.html', { forgotpassword_Id: 'x' });
    assert.ok(!/localhost|127\.0\.0\.1/.test(link),
      'a hosted shop produced a loopback link: ' + link);
  });
});

test('a forged host is refused, so no email carries it', () => {
  /*
   * The attack: POST the reset endpoint with someone else's Host. The victim
   * gets a real email from us with a link to the attacker's server.
   */
  clean(() => {
    for (const evil of [
      'evil.example',
      'posnic.io.evil.example',
      'evil.example#posnic.io',
      'attacker.co.uk',
      'notposnic.io',
    ]) {
      assert.equal(publicBaseUrl(withHost(evil)), null,
        `${evil} was accepted as our own host`);
      assert.equal(publicPageUrl(withHost(evil), 'forgotpassword.html', { forgotpassword_Id: 'x' }), null,
        `${evil} produced a link`);
    }
  });
});

test('a forged x-forwarded-host is refused too', () => {
  /* The header a proxy sets is just as writable by a caller as Host is. */
  clean(() => {
    assert.equal(
      publicBaseUrl({ headers: { host: 'shop.posnic.io', 'x-forwarded-host': 'evil.example' } }),
      null,
      'x-forwarded-host was trusted over a genuine host');
  });
});

test('a suffix that merely contains our domain is not our domain', () => {
  /* endsWith on ".posnic.io" is the check; "xposnic.io" and "posnic.io.evil"
     are the two ways a careless one lets an attacker through. */
  assert.ok(isOwnHost('a.posnic.io'));
  assert.ok(isOwnHost('shop.posnic.com'));
  assert.ok(!isOwnHost('xposnic.io'));
  assert.ok(!isOwnHost('posnic.io.evil.example'));
  assert.ok(!isOwnHost('evilposnic.com'));
});

test('what an operator configured wins over anything a caller sends', () => {
  /* A self-hosted shop on its own name, and the only route that does not
     depend on guessing. */
  const saved = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://pos.myshop.example';
  try {
    assert.equal(publicBaseUrl(withHost('evil.example')), 'https://pos.myshop.example',
      'a forged host beat the configured address');
    assert.equal(
      publicPageUrl(withHost('evil.example'), 'forgotpassword.html', { forgotpassword_Id: 'k' }),
      'https://pos.myshop.example/public/forgotpassword.html?forgotpassword_Id=k');
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved;
  }
});

test('a custom domain works once an operator names it', () => {
  const saved = process.env.PUBLIC_EXTRA_DOMAINS;
  process.env.PUBLIC_EXTRA_DOMAINS = 'pos.sbala.in, shop.example.com';
  try {
    delete process.env.PUBLIC_BASE_URL;
    assert.equal(publicBaseUrl(withHost('pos.sbala.in')), 'https://pos.sbala.in');
    assert.equal(publicBaseUrl(withHost('other.sbala.in')), null,
      'naming one custom domain must not admit its siblings');
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_EXTRA_DOMAINS;
    else process.env.PUBLIC_EXTRA_DOMAINS = saved;
  }
});

test('local development still works, over http', () => {
  clean(() => {
    assert.equal(publicBaseUrl(withHost('localhost:3000')), 'http://localhost:3000');
  });
});

test('a host that is not a hostname is refused', () => {
  assert.ok(!looksLikeHostname('shop.posnic.io/evil'));
  assert.ok(!looksLikeHostname('user:pass@shop.posnic.io'));
  assert.ok(!looksLikeHostname('shop .posnic.io'));
  assert.ok(looksLikeHostname('shop.posnic.io'));
  assert.ok(looksLikeHostname('localhost:3000'));
});

test('with nothing trustworthy, there is no link at all', () => {
  /* The caller must then refuse to send, rather than mailing a dead or
     dangerous address. */
  clean(() => {
    assert.equal(publicBaseUrl({ headers: {} }), null);
    assert.equal(publicBaseUrl(undefined), null);
  });
});

test('forgot-password refuses to send when it has no address', () => {
  /*
   * The behaviour that makes the null above safe. Read from the source: this
   * is a mail path, so exercising it for real would send mail.
   */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'src', 'models', 'setting.model.js'), 'utf8');
  const fn = /async getForgotUserDetails\([\s\S]*?\n  \}/.exec(src);
  assert.ok(fn, 'getForgotUserDetails not found');

  assert.match(fn[0], /publicPageUrl\(req, 'forgotpassword\.html'/,
    'the link is not built from this shop own address');
  assert.match(fn[0], /if \(!basePath\)/,
    'a missing address is not checked, so a broken link would still be mailed');
  /* Comments are stripped first. The function explains the old bug in prose,
     and the strings being banned appear there - a check that matched the
     explanation instead of the code would fail for the wrong reason, which is
     its own kind of useless. */
  const code = fn[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/FRONTEND_URL\s*\|\|\s*'http:\/\/localhost/.test(code),
    'the localhost fallback is still in the code');
  assert.ok(!/basePath\s*=\s*`https:\/\/www\.posnic\.io/.test(code),
    'the hardcoded marketing-site link is still in the code');
  assert.ok(!/process\.env\.SERVER_NAME\s*\|\|\s*'localhost'/.test(code),
    'the SERVER_NAME-or-localhost guess is still in the code');
});
