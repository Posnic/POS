'use strict';
/*
 * "Sign in as user" must actually sign the officer in.
 *
 * This was reported as broken several times and each investigation found the
 * server side healthy: the endpoint returned 200, the token verified, and
 * /api/items answered with it. Every one of those checks passed while the
 * feature did not work, because none of them was the thing that was wrong.
 *
 * The frontend decides somebody is signed in from TWO things, and every real
 * sign-in path sets both (users.js around 606-752, lock-screen.js restore()):
 *
 *     localStorage.posnic_jwt_token = <jwt>
 *     document.cookie loginuser=yes
 *
 * The page this endpoint returns set only the first. So the browser arrived
 * holding a perfectly valid credential the app had decided not to use, and
 * redirected to login.html. Nothing errored anywhere.
 *
 * These assertions are deliberately about the page's CONTENT rather than the
 * status code, because the status code was never the problem.
 */

const path = require('path');

/** The template lives in the controller; read it rather than run a browser. */
const SOURCE = require('fs').readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'controllers', 'shadow-login.controller.js'),
  'utf8'
);

describe('the page returned by shadow login', () => {
  test('stores the token where the app reads it', () => {
    expect(SOURCE).toMatch(/localStorage\.setItem\(\s*'posnic_jwt_token'/);
  });

  test('also sets the loginuser cookie, which is what was missing', () => {
    /* The single assertion that would have caught this. */
    expect(SOURCE).toMatch(/document\.cookie\s*=\s*'loginuser=yes/);
  });

  test('the cookie is scoped to the whole site', () => {
    /* path=/ - a cookie left on /api would not be visible to the pages that
       read it, which is the same failure wearing a different hat. */
    expect(SOURCE).toMatch(/path=\//);
  });

  test('the cookie expires rather than lasting for ever', () => {
    /* A support session has no business outliving a normal sign-in. */
    expect(SOURCE).toMatch(/expires=/);
  });

  test('both halves are set before the redirect, not after', () => {
    /* location.replace() ends the page. Anything below it never runs, and the
       browser would arrive at / with half a session. */
    const token = SOURCE.indexOf("localStorage.setItem('posnic_jwt_token'");
    const cookie = SOURCE.indexOf("document.cookie = 'loginuser=yes");
    const redirect = SOURCE.indexOf("location.replace('/')");
    expect(token).toBeGreaterThan(-1);
    expect(cookie).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(-1);
    expect(token).toBeLessThan(redirect);
    expect(cookie).toBeLessThan(redirect);
  });

  test('the redirect replaces rather than pushes', () => {
    /* The back button must not return to a page whose source still holds a
       working credential. */
    expect(SOURCE).toMatch(/location\.replace\(/);
    expect(SOURCE).not.toMatch(/location\.href\s*=\s*'\/'/);
  });

  test('the token is written as JSON, never interpolated into a string', () => {
    /* A signed token cannot break out of a JSON literal, and this stays true
       if the token format ever changes. */
    expect(SOURCE).toMatch(/var d = \$\{payload\}/);
    expect(SOURCE).toMatch(/JSON\.stringify\(\{[\s\S]{0,40}token: authToken/);
  });

  test('the page refuses to be cached or indexed', () => {
    /* For the next two hours its body is a working credential for somebody
       else's shop. */
    expect(SOURCE).toMatch(/no-store/);
    expect(SOURCE).toMatch(/x-robots-tag/i);
  });
});
