'use strict';

/*
 * ONE BODY SANITISER, NOT TWO.
 *
 * `api/app.js` has had its own NoSQL guard for a long time, and its body half
 * has always worked - `req.body` is an ordinary property, unlike the query
 * getter that #811 found had been a silent no-op since Express 5.
 *
 * I did not check that before adding `src/middleware/no-mongo-operators.js` in
 * #812. I tested a bare Express app I built inside my own test, watched an
 * operator reach the handler there, and reported it as this application's
 * behaviour. It was not: the scaffold had no sanitiser because I had not put
 * one in it. The middleware still earns its place - it removes `__proto__`,
 * `constructor` and `prototype`, bounds its walk, and logs a count rather than
 * a string the caller chose - but the body was being stripped twice.
 *
 * Two implementations of one promise is how the two drift: a rule added to one
 * and not the other reads as covered and is not. So the duplicate went, and
 * this is the test that it stays gone and that the surviving one is really in
 * the stack.
 *
 * AGAINST THE REAL APP. Requiring app.js gives the actual middleware chain,
 * which is the thing the earlier test should have been asserting against.
 */

const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', '..', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

/** Every middleware layer the real app mounted, in order. */
function layersOf(app) {
  const router = app.router || app._router;
  return (router && router.stack) || [];
}

describe('the surviving sanitiser is really mounted', () => {
  let app;

  beforeAll(() => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';

    app = require('../../../app.js');
  });

  test('the real app has the operator guard in its chain', () => {
    const names = layersOf(app).map((layer) => layer.name);
    expect(names).toContain('noMongoOperators');
  });

  test('it runs before the app own NoSQL middleware, so the body is clean first', () => {
    const names = layersOf(app).map((layer) => layer.name);
    const guard = names.indexOf('noMongoOperators');
    const json = names.indexOf('jsonParser');
    expect(guard).toBeGreaterThan(-1);
    /* After the parsers: there is nothing to walk before the body exists. */
    if (json > -1) expect(guard).toBeGreaterThan(json);
  });
});

describe('and the duplicate is gone', () => {
  test('app.js no longer strips the body a second time', () => {
    /* Anchored to the start of a line so the comment that explains the removal
       does not satisfy the test that checks for it. `sanitizeObject` further
       down is the XSS pass, which is a different job and stays. */
    expect(source).not.toMatch(/^\s*req\.body = sanitize\(/m);
  });

  test('but it still sanitises the QUERY, which is its own problem', () => {
    /*
     * That half was a silent no-op from the move to Express 5 until #811, and
     * it is not this middleware's job: the query string never carried an
     * operator into an object anyway, because Express 5's simple parser leaves
     * `?user[$ne]=x` as a literal string key. Removing it would be removing a
     * fix somebody just made for a different reason.
     */
    expect(source).toMatch(/const cleanQuery = sanitize\(\{ \.\.\.req\.query \}\)/);
    expect(source).toMatch(/Object\.defineProperty\(req, 'query'/);
  });

  test('the reason is written down where the line used to be', () => {
    /* A deletion with no note reads as an oversight to whoever finds the gap
       and is one commit away from being put back. */
    expect(source).toMatch(/THE BODY IS ALREADY CLEAN BY THE TIME THIS RUNS/);
    expect(source).toMatch(/no-mongo-operators/);
  });
});
