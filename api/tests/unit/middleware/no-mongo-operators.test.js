'use strict';

/*
 * A REQUEST BODY IS DATA, NEVER A QUERY.
 *
 * MongoDB has no query language separate from its data, so a `$` key inside a
 * filter is an operator. A value that arrives from a caller and lands in a
 * filter can therefore stop being a value:
 *
 *   { user: 'amudha' }        the one row
 *   { user: { $ne: null } }   every row
 *
 * Driven through a real express app rather than by calling the middleware
 * with a hand-made req, because half of what is being asserted is WHERE it
 * sits in the stack: after the parsers, before every route.
 */

const express = require('express');
const guard = require('../../../src/middleware/no-mongo-operators');

/** An app shaped like the real one, that reports what the handler was given. */
function serve() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(guard);
  app.all('/t', (req, res) => res.json({ body: req.body, query: req.query }));
  return app;
}

let server;
let base;

beforeAll(async () => {
  server = serve().listen(0);
  await new Promise((done) => server.once('listening', done));
  base = 'http://127.0.0.1:' + server.address().port;
});

afterAll(async () => {
  if (server) await new Promise((done) => server.close(done));
});

const post = async (body, type = 'application/json') => {
  const answer = await fetch(base + '/t', {
    method: 'POST',
    headers: { 'content-type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body,
  });
  return answer.json();
};

describe('an operator never reaches the handler', () => {
  test('the obvious one: a filter for one row turned into a filter for every row', async () => {
    const seen = await post({ user: { $ne: null }, name: 'amudha' });
    expect(seen.body).toEqual({ user: {}, name: 'amudha' });
  });

  test('at the top of the body as well as inside it', async () => {
    const seen = await post({ $where: 'sleep(5000)', ok: 1 });
    expect(seen.body).toEqual({ ok: 1 });
  });

  test('inside an array, which is where a line item lives', async () => {
    const seen = await post({
      items: [{ item_id: 'a1', quantity: 2 }, { item_id: { $gt: '' } }],
    });
    expect(seen.body.items[1]).toEqual({ item_id: {} });
    /* And the honest line beside it is untouched. */
    expect(seen.body.items[0]).toEqual({ item_id: 'a1', quantity: 2 });
  });

  test('several levels down', async () => {
    const seen = await post({ a: { b: { c: { password: { $gt: '' } } } } });
    expect(seen.body.a.b.c.password).toEqual({});
  });

  test('a form post is as capable of it, because the parser is the extended one', async () => {
    const seen = await post('user[$ne]=&name=amudha', 'application/x-www-form-urlencoded');
    expect(seen.body.name).toBe('amudha');
    expect(seen.body.user).toEqual({});
  });
});

describe('and ordinary data is left exactly alone', () => {
  test('a dollar sign in a VALUE is just a character', async () => {
    /* Prices, notes and names carry these. Removing them would be the bug. */
    const seen = await post({ note: 'paid $20', name: 'A$AP' });
    expect(seen.body).toEqual({ note: 'paid $20', name: 'A$AP' });
  });

  test('a dollar sign that is not the first character of a key', async () => {
    const seen = await post({ price$: 10, a$b: 2 });
    expect(seen.body).toEqual({ price$: 10, a$b: 2 });
  });

  test('a dotted key, which is ordinary in this product settings', async () => {
    const seen = await post({ 'invoice.prefix': 'INV', 'bill.year_reset': false });
    expect(seen.body).toEqual({ 'invoice.prefix': 'INV', 'bill.year_reset': false });
  });

  test('a real sale goes through untouched', async () => {
    const sale = {
      sale_process: 'KOT',
      table_number: '7',
      items: [
        { item_id: '68c0f1a2b3c4d5e6f7a8b9c0', item_quantity: 2, spice_level: 1 },
        { item_id: '68c0f1a2b3c4d5e6f7a8b9c1', item_quantity: 1, note: 'no onion' },
      ],
      sales_total: 420.5,
      paid: true,
    };
    const seen = await post(sale);
    expect(seen.body).toEqual(sale);
  });

  test('an empty body, and a body that is not an object', async () => {
    expect((await post({})).body).toEqual({});
    expect((await post([1, 2, 3])).body).toEqual([1, 2, 3]);
  });
});

describe('the query string was already safe, and is left as it was', () => {
  test('express 5 does not expand brackets, so an operator there is inert', async () => {
    /*
     * MEASURED, not assumed. Express 5's default query parser is the simple
     * one: `?user[$ne]=x` arrives as the literal string key "user[$ne]", which
     * is a harmless value. This test is here so that a future change to
     * `app.set('query parser', 'extended')` fails loudly rather than quietly
     * opening the door this middleware was written to shut.
     */
    const answer = await fetch(base + '/t?user[$ne]=x&ok=1');
    const seen = await answer.json();
    expect(seen.query).toEqual({ 'user[$ne]': 'x', ok: '1' });
    expect(seen.query.user).toBeUndefined();
  });
});

describe('a hostile body cannot cost the server the request', () => {
  test('a cycle does not loop for ever', () => {
    const body = { a: 1 };
    body.self = body;
    expect(() => guard.strip(body)).not.toThrow();
  });

  test('a structure built to be walked is bounded', () => {
    /* Deeper than the limit: the levels above it are still cleaned, which is
       where an operator has to be to do anything. */
    let deep = { $ne: null };
    for (let i = 0; i < guard.DEEPEST + 20; i += 1) deep = { down: deep };
    const removed = guard.strip(deep);
    expect(Array.isArray(removed)).toBe(true);
  });

  test('prototype keys go too, because a key that reaches an assignment is its own problem', () => {
    const body = JSON.parse('{"a":1,"constructor":{"x":1}}');
    guard.strip(body);
    expect(body.constructor).not.toEqual({ x: 1 });
  });
});

describe('it is mounted where it has to be', () => {
  test('after the parsers and before every route', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app.js'), 'utf8');

    const json = app.indexOf('app.use(express.json(');
    const mounted = app.indexOf("require('./src/middleware/no-mongo-operators')");
    const firstRoute = app.indexOf("app.use('/api/");

    expect(json).toBeGreaterThan(-1);
    expect(mounted).toBeGreaterThan(json);
    if (firstRoute > -1) expect(mounted).toBeLessThan(firstRoute);
  });
});
