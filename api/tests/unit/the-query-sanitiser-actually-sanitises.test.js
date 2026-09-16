'use strict';

/*
 * The NoSQL guard on the query string, which had not been running.
 *
 * app.js mounts a sanitiser that walks `req.query` and `req.body` and drops
 * any key beginning with `$` - the operators that turn a filter into a
 * different question. It is the app's own, rather than express-mongo-sanitize,
 * and it is load bearing: filter-guard.js says so in its own opening line.
 *
 * WHAT WAS WRONG
 *
 * It did this:
 *
 *     req.query = sanitize({ ...req.query });
 *
 * On Express 5 - which this API runs - `query` is a GETTER that re-parses the
 * query string on every access. Assigning to it does nothing and throws
 * nothing. Mutating the object it returns does nothing either, because the
 * next read parses the string again.
 *
 * So from the day this app moved to Express 5, every `$`-prefixed query
 * parameter survived the one middleware that exists to remove it, the warning
 * it logs never fired, and nothing anywhere looked wrong. The body half was
 * never affected: `req.body` is an ordinary property.
 *
 * These tests run a REAL Express app, because the whole bug is a thing Express
 * does that no amount of reading the sanitiser would show.
 */

const express = require('express');

/** An app with only the guard under test on it, and an echo behind it. */
function appWithGuard() {
  const app = express();
  app.use(express.json());

  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (key.startsWith('$')) return acc;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        acc[key] = sanitize(value);
      } else if (Array.isArray(value)) {
        acc[key] = value.map((item) =>
          item !== null && typeof item === 'object' ? sanitize(item) : item
        );
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  };

  app.use((req, res, next) => {
    if (req.query) {
      const cleanQuery = sanitize({ ...req.query });
      Object.defineProperty(req, 'query', {
        value: cleanQuery,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (req.body && typeof req.body === 'object') {
      req.body = sanitize({ ...req.body });
    }
    next();
  });

  app.all('/echo', (req, res) => res.json({ query: req.query, body: req.body }));
  return app;
}

/** One request against a real listening server. */
function call(app, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const url = `http://127.0.0.1:${server.address().port}${path}`;
        const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        resolve(await res.json());
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

describe('the query string', () => {
  test('AN OPERATOR IN THE QUERY STRING IS REMOVED, which it was not', async () => {
    /*
     * The bug, stated as the thing a shop is protected from. `?$ne=` reaching
     * a Mongo filter turns "this id" into "any id but this one", which is how
     * a lookup becomes a list of everybody else's rows.
     */
    const said = await call(appWithGuard(), '/echo?$ne=1&token=219');
    expect(said.query.$ne).toBeUndefined();
    expect(said.query.token).toBe('219');
  });

  test('AND ?id[$ne]=x IS NOT AN OPERATOR HERE, which is worth knowing', async () => {
    /*
     * The shape everybody reaches for when testing this, and on Express 5 it
     * does not do what it does on Express 4.
     *
     * Express 5's default query parser is `simple` - Node's querystring - not
     * `extended`. So `id[$ne]=x` is ONE key, spelled `id[$ne]`, and not a
     * nested object at all. It therefore does not begin with `$`, the
     * sanitiser leaves it alone, and it reaches a query as a field literally
     * named `id[$ne]`, which matches nothing and does nothing.
     *
     * Asserted rather than assumed, because the day somebody sets
     * `query parser` to `extended` for an unrelated reason, this becomes a
     * real nested operator and this test is what says so.
     */
    const said = await call(appWithGuard(), '/echo?id[$ne]=x&id=real');
    expect(said.query['id[$ne]']).toBe('x');
    expect(said.query.id).toBe('real');
    expect(typeof said.query.id).toBe('string');
  });

  test('ORDINARY PARAMETERS ARE UNTOUCHED, or this would break every list', async () => {
    const said = await call(
      appWithGuard(),
      '/echo?page=2&per_page=50&q=dollar%24sign&from=2026-01-01'
    );
    expect(said.query).toEqual({
      page: '2',
      per_page: '50',
      /* A `$` INSIDE a value is not an operator. Only a key can be one, and a
         shop selling something with a price in its name must still find it. */
      q: 'dollar$sign',
      from: '2026-01-01',
    });
  });
});

describe('the body, which was always fine', () => {
  test('an operator in the body is removed', async () => {
    const said = await call(appWithGuard(), '/echo', {
      method: 'POST',
      body: { token: { $ne: null }, orderId: 'abc' },
    });
    expect(said.body.token).toEqual({});
    expect(said.body.orderId).toBe('abc');
  });

  test('and one hiding inside an array is too', async () => {
    const said = await call(appWithGuard(), '/echo', {
      method: 'POST',
      body: { items: [{ id: '1' }, { $where: 'sleep(9000)' }] },
    });
    expect(said.body.items[0].id).toBe('1');
    expect(said.body.items[1]).toEqual({});
  });
});

/* ------------------------------------------------- why it has to be defineProperty */

describe('what Express 5 actually allows', () => {
  /*
   * These three are the finding itself. They are asserted rather than
   * described because the next person to touch this middleware will reach for
   * assignment - it is the obvious thing, it is what was there, and it fails
   * in complete silence.
   */
  /*
   * NON-STRICT, because app.js is.
   *
   * That is not a detail. Assigning to a getter-only property THROWS in strict
   * mode and does nothing at all in sloppy mode, and app.js is an ordinary
   * CommonJS file with no 'use strict' - which is exactly why this failed in
   * total silence for so long instead of taking the API down on the first
   * request, where anybody would have seen it.
   */

  const sloppy = (body) => new Function('req', body);

  const probe = (attempt) => {
    const app = express();
    app.use((req, res) => {
      attempt(req);
      res.json({ query: req.query });
    });
    return call(app, '/echo?$ne=1&ok=2');
  };

  test('ASSIGNMENT IS A SILENT NO-OP, and that is the whole bug', async () => {
    const said = await probe(sloppy('req.query = { clean: true };'));
    expect(said.query.clean).toBeUndefined();
    expect(said.query.$ne).toBe('1');
  });

  test('and in strict code the same line THROWS, which is why nobody saw it', async () => {
    /* Had app.js been strict, this would have been a 500 on the first request
       of the first day instead of a guard quietly not running for months. */
    let threw = '';
    const app = express();
    app.use((req, res) => {
      try {
        req.query = { clean: true };
      } catch (e) {
        threw = e.message;
      }
      res.json({ threw });
    });
    const said = await call(app, '/echo?$ne=1');
    expect(said.threw).toMatch(/query/i);
  });

  test('and mutating what the getter hands back does nothing either', async () => {
    /* The obvious second attempt. The getter re-parses the string, so the
       delete is thrown away with the object it was made on. */
    const said = await probe((req) => {
      delete req.query.$ne;
    });
    expect(said.query.$ne).toBe('1');
  });

  test('defineProperty is the one that holds', async () => {
    const said = await probe((req) => {
      Object.defineProperty(req, 'query', {
        value: { clean: true },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    });
    expect(said.query).toEqual({ clean: true });
  });
});

/* ------------------------------------------- what else depends on it */

describe('the guard is what makes every later sanitiser work', () => {
  test('AFTER IT, BOTH MUTATION AND ASSIGNMENT HOLD - and before it, neither does', async () => {
    /*
     * Two more middlewares change req.query further down the chain, and each
     * does it a different way that Express 5 ignores on its own:
     *
     *   app.js, XSS pass          delete every key, then Object.assign
     *   middleware/validateRequest   req.query = sanitizeInput(req.query)
     *
     * Both were silently doing nothing for the same reason the NoSQL guard
     * was. Neither was touched: replacing the getter with a plain writable
     * property is what made all three start working, which means the ORDER is
     * load bearing. Move the guard below them, or take it out, and three
     * sanitisers stop running in silence.
     */
    const app = express();
    app.use((req, res, next) => {
      /* what the guard now does */
      const clean = { ...req.query };
      delete clean.$ne;
      Object.defineProperty(req, 'query', {
        value: clean,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      next();
    });
    app.use((req, res, next) => {
      /* the XSS pass's style: mutation */
      Object.keys(req.query).forEach((k) => delete req.query[k]);
      Object.assign(req.query, { xss: 'applied', ok: '2' });
      next();
    });
    app.use((req, res, next) => {
      /* validateRequest's style: assignment */
      req.query = { ...req.query, validated: true };
      next();
    });
    app.get('/x', (req, res) => res.json(req.query));

    const said = await call(app, '/x?$ne=1&ok=2');
    expect(said).toEqual({ xss: 'applied', ok: '2', validated: true });
  });

  test('and the app really does define it before those two run', () => {
    /* Line order, because that is the whole dependency. */
    const fs = require('node:fs');
    const path = require('node:path');
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

    const guard = app.indexOf("Object.defineProperty(req, 'query'");
    const xss = app.indexOf('sanitizedQuery[key] = filterXSS(value)');
    expect(guard).toBeGreaterThan(-1);
    expect(xss).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(xss);
  });
});

/* ------------------------------------------------------- and it is really mounted */

test('THE APP USES defineProperty, not an assignment', () => {
  /*
   * A wiring check, because everything above tests a copy of the middleware.
   * If app.js goes back to assigning, these tests all still pass and the guard
   * stops running again - which is exactly how it went unnoticed the first
   * time.
   */
  const fs = require('node:fs');
  const path = require('node:path');
  const whole = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
  /* COMMENTS STRIPPED FIRST. The comment explaining the fix quotes the broken
     line, so a bare search finds its own explanation and fails - the fifth
     time that trap has been met in this codebase. */
  const app = whole.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  expect(app).toMatch(/Object\.defineProperty\(req, 'query', \{/);
  expect(app).not.toMatch(/req\.query = sanitize\(/);
  /* The body half never needed it and still must not be broken. */
  expect(app).toMatch(/req\.body = sanitize\(\{ \.\.\.req\.body \}\);/);
});
