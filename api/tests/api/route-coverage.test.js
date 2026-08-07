/*
 * Every route in the API, called, and none of them allowed to crash.
 *
 * There are around 479 of them across 24 route files, and until now a change
 * could break any one without a test noticing - the unit suite covers
 * controllers in isolation, not the assembled application, so a bad middleware
 * order, a renamed export, a controller that is no longer bound, or a route
 * pointing at nothing at all produces a 500 that only a user finds.
 *
 * This walks the real Express router, calls every registered path, and holds
 * one rule: no route may return a 5xx. A 401 is a good answer. So is a 400 or a
 * 404. A 500 means the request reached code that threw, and that is a defect
 * whatever the endpoint was for.
 *
 * Called without credentials on purpose. Almost every route answers 401 before
 * touching anything, so the whole surface can be swept without writing a single
 * row - which is what makes it safe to run against a real database on every
 * change rather than occasionally and nervously.
 */

const http = require('http');
const { MongoClient } = require('mongodb');
const { withDatabase, ciDatabaseName } = require('./ci-database');

const URI = process.env.CI_MONGODB_URI || process.env.LOCAL_MONGODB_URI;
const describeIfDb = URI ? describe : describe.skip;

if (!URI) {
  console.warn('\n  [route-coverage] skipped: set LOCAL_MONGODB_URI or CI_MONGODB_URI.\n');
}

const DB_NAME = ciDatabaseName('ci_routes');

const PORT = Number(process.env.CI_ROUTES_PORT || 5198);

/* A syntactically valid id, so a route that parses one does not 500 on the parse. */
const SAMPLE_ID = '000000000000000000000001';

/*
 * Every path the application actually serves.
 *
 * Read from the router rather than from a list somebody maintains: a list would
 * be wrong the day after it was written, and the thing being tested is what is
 * mounted, not what was intended.
 */
function collectRoutes(app) {
  const found = [];

  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        for (const method of Object.keys(layer.route.methods || {})) {
          if (layer.route.methods[method]) found.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // Recover the mount point from the layer's regexp, which is how Express
        // remembers it - there is no friendlier accessor.
        let mount = '';
        const source = layer.regexp && layer.regexp.source;
        if (source && source !== '^\\/?(?=\\/|$)') {
          const match = source
            .replace('^\\/', '/')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/');
          mount = match.startsWith('/') ? match : '';
        }
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };

  // Express 5 exposes this as app.router; Express 4 called it app._router.
  const root = (app.router && app.router.stack) || (app._router && app._router.stack);
  walk(root, '');
  return found;
}

/* :id and friends become something a route can at least parse. */
function concrete(path) {
  return path
    .replace(/:[A-Za-z_]+\(\[^\\\/\]\+\?\)/g, SAMPLE_ID)
    .replace(/:[A-Za-z_]+\??/g, SAMPLE_ID)
    .replace(/\*/g, 'x');
}

function request(method, path) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    /*
     * The reason is kept, not just the fact.
     *
     * This resolved 0 for every kind of non-answer, so a refused connection, a
     * reset socket and a genuine hang were indistinguishable in the report -
     * and the report simply listed routes as unreachable with no way to tell
     * which. ECONNRESET in particular is usually the server answering a POST
     * before reading its body, which is not a fault.
     */
    req.on('error', (err) => resolve(`ERR ${err.code || err.message}`));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve('TIMEOUT');
    });
    if (method !== 'GET' && method !== 'HEAD') req.write('{}');
    req.end();
  });
}

describeIfDb('every route in the API', () => {
  let server;
  let mongoose;
  let client;
  let routes = [];

  beforeAll(async () => {
    const base = withDatabase(URI, DB_NAME);
    process.env.MONGODB_URI = base;
    process.env.PORT = String(PORT);
    process.env.HOST = '127.0.0.1';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-jwt-secret-0123456789abcdef';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-only-session-secret-0123456789';
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    process.env.ENCRYPTION_IV = process.env.ENCRYPTION_IV || '0123456789abcdef';

    client = new MongoClient(base, { serverSelectionTimeoutMS: 20000 });
    await client.connect();

    mongoose = require('mongoose');
    await mongoose.connect(base, { serverSelectionTimeoutMS: 20000 });

    const app = require('../../app');
    routes = collectRoutes(app);
    await new Promise((r) => {
      server = http.createServer(app).listen(PORT, '127.0.0.1', r);
    });
  }, 90000);

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    try {
      await mongoose.disconnect();
    } catch (e) {
      /* already closed */
    }
    if (client) {
      /* See rest-smoke: a silently leaked database on a 512MB free tier turns
         into a CI failure that looks like it belongs to somebody's change. */
      await client
        .db(DB_NAME)
        .dropDatabase()
        .catch((e) => {
          console.warn(`[route-coverage] could not drop ${DB_NAME}: ${e.message}`);
        });
      await client.close();
    }
    /* BaseModel opens its own client the first time a repository asks for a
         collection, and nothing else closes it. Left open it keeps
         re-authenticating after the suite ends, into a Jest context that no
         longer exists - which is how driver 7's lazy require('crypto') in
         SCRAM-SHA-1 came back as undefined. */
    await require('../../src/models/base.model').closeConnection();
  }, 60000);

  it('finds the routes rather than trusting a list', () => {
    // If this drops, the walker has stopped understanding how the app is
    // mounted and every assertion below became vacuous.
    expect(routes.length).toBeGreaterThan(200);
  });

  it('serves every route without any of them throwing', async () => {
    /*
     * The whole point. 401, 400, 404 are all fine answers - they mean the
     * request was understood and refused. A 5xx means it reached code that
     * threw, which is a defect whatever the endpoint does.
     */
    const crashed = [];
    const silent = [];

    /*
     * Each distinct route once.
     *
     * app.js mounts the same router at "/api" and again at "/", and suppliers a
     * third time, so walking the stack yields about 1,020 entries for 357
     * routes - every handler swept three times over. Sequentially that was more
     * than the ten minutes this test allows itself, so it never reached its
     * assertion and reported a timeout, which reads like a broken API and is
     * really a slow loop.
     *
     * Concurrency was the obvious answer and the wrong one: sixteen at a time
     * against one database starved every request past its own five-second
     * timeout, and the sweep came back claiming all 1,020 were unreachable.
     * Doing a third of the work is better than doing all of it three times as
     * fast, and it keeps one request on the server at a time - which is what
     * makes a 5xx here mean the handler threw, rather than that it was busy.
     *
     * Anything that stops the server or wipes data is skipped; those have their
     * own tests and should not be triggered in a loop.
     */
    const seen = new Set();
    const sweepable = routes.filter((r) => {
      if (/shutdown|restart|drop|reset|wipe/i.test(r.path)) return false;
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    /*
     * Four at a time.
     *
     * Most of each request is waiting on the database rather than working, so
     * one-at-a-time spends the sweep idle: 357 routes took over ten minutes and
     * the test timed out before it could assert anything. Sixteen at a time was
     * the opposite mistake - they starved each other past the five-second
     * per-request timeout and the sweep reported every route unreachable.
     *
     * Four overlaps the waiting without queueing requests behind each other, so
     * a 5xx still means the handler threw rather than that the server was busy.
     */
    const CONCURRENCY = 4;
    let next = 0;

    async function worker() {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= sweepable.length) return;

        const route = sweepable[i];

        /*
         * One retry when the socket, rather than the handler, is what failed.
         *
         * Sweeping a few hundred routes in a few seconds means a lot of short
         * connections, and a handful come back ECONNRESET - the server having
         * closed a socket the client still thought good. That says nothing
         * about the route. A route that genuinely kills the connection does it
         * both times, and then it is reported.
         */
        let status = await request(route.method, concrete(route.path));
        if (typeof status !== 'number') {
          status = await request(route.method, concrete(route.path));
        }

        /*
         * A 5xx means it reached code that threw, which is a defect whatever
         * the endpoint does. No answer at all is a different complaint - it may
         * simply be slow - so it is collected separately and named as itself.
         */
        if (typeof status === 'number') {
          if (status >= 500) crashed.push(`${route.method} ${route.path} -> ${status}`);
        } else {
          silent.push(`${route.method} ${route.path} -> ${status}`);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    expect({ crashed, silent }).toEqual({ crashed: [], silent: [] });
  }, 900000);
});
