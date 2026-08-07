/*
 * The REST API, started for real and asked real questions.
 *
 * Everything else in this suite mocks the database, which is why a unique index
 * could stop a shop creating its second branch without a single test noticing:
 * a mocked collection has no indexes, so the collision it exists to cause is
 * unreproducible. These tests boot the actual server against an actual MongoDB
 * and talk to it over HTTP, which is the only arrangement where a constraint
 * living in the database can fail a build.
 *
 * Skipped, loudly, when no database is configured. A machine without
 * CI_MONGODB_URI runs the rest of the suite and says why these did not run -
 * silently passing would be worse than not having them, because the green tick
 * would mean something it does not.
 *
 * Every run gets its own database, named after the run, and drops it at the
 * end. The cluster is shared and free; two builds must not be able to see each
 * other's rows.
 */

const http = require('http');
const { MongoClient } = require('mongodb');
const { withDatabase, ciDatabaseName, sweepStaleDatabases } = require('./ci-database');

const URI = process.env.CI_MONGODB_URI;
const describeIfDb = URI ? describe : describe.skip;

if (!URI) {
  console.warn(
    '\n  [rest-smoke] skipped: set CI_MONGODB_URI to run these against a real database.\n'
  );
}

/* A database of this run's own, so parallel builds cannot collide. */
const DB_NAME = ciDatabaseName();

const PORT = Number(process.env.CI_API_PORT || 5199);

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => {
          data += d;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describeIfDb('the REST API, against a real database', () => {
  let server;
  let client;

  beforeAll(async () => {
    process.env.MONGODB_URI = withDatabase(URI, DB_NAME);
    process.env.PORT = String(PORT);
    process.env.HOST = '127.0.0.1';
    process.env.NODE_ENV = 'test';
    // verify-secrets refuses to boot without these, correctly.
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-only-jwt-secret-0123456789abcdef';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-only-session-secret-0123456789';
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    process.env.ENCRYPTION_IV = process.env.ENCRYPTION_IV || '0123456789abcdef';

    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
    await client.connect();

    /* Clear out databases left by runs that were cancelled before their
       teardown could run. Without this the free cluster fills up and every
       later build fails for a reason unrelated to the change. */
    await sweepStaleDatabases(client);

    /*
     * Connect mongoose before the app is required, the way server.js does.
     *
     * Without it the models have no connection, every query throws, and the
     * API key middleware correctly turns that into a 500 - so the first run of
     * this file reported that an invalid key returns 500 rather than 401. The
     * middleware was right. The harness was not yet a server.
     */
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });

    const app = require('../../app');
    await new Promise((resolve) => {
      server = http.createServer(app).listen(PORT, '127.0.0.1', resolve);
    });
  }, 60000);

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    try {
      await require('mongoose').disconnect();
    } catch (e) {
      /* already closed */
    }
    if (client) {
      /* Say so when the drop fails. The cluster is a shared free tier with a
         512MB cap, so a leaked database is a real cost - and if this is ever
         silent, CI eventually fails for a reason unrelated to the change that
         broke it. */
      await client
        .db(DB_NAME)
        .dropDatabase()
        .catch((e) => {
          console.warn(`[rest-smoke] could not drop ${DB_NAME}: ${e.message}`);
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

  it('answers at all', async () => {
    const res = await request('GET', '/settings/getJSONCountry');
    expect(res.status).toBe(200);
  });

  it('refuses an unauthenticated request to a protected route', async () => {
    // The whole till depends on this being true, and no mocked test can prove
    // it - the middleware chain only exists once the app is really assembled.
    const res = await request('GET', '/sales');
    expect(res.status).toBe(401);
  });

  it('refuses an invalid API key rather than ignoring it', async () => {
    const res = await request('GET', '/sales', null, { 'x-api-key': 'not-a-real-key' });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/api key/i);
    // Generous, because an unknown key is a round trip to the cluster - which
    // is the point: it proves the key is really looked up rather than waved
    // through on a fast path.
  }, 30000);

  it('enforces the unique index that stopped a shop creating branches', async () => {
    /*
     * The regression this file was written for. A blank customer email is a
     * value, not an absence, so the second one collided with the first and the
     * branch would not save. It cannot be caught with a mock: the constraint
     * lives in MongoDB, not in the code.
     */
    const customers = client.db(DB_NAME).collection('customers');
    await customers.createIndex({ email: 1 }, { unique: true, sparse: true });

    await customers.insertOne({ name: 'First', phone: '' });
    await customers.insertOne({ name: 'Second', phone: '' }); // no email: fine

    await customers.insertOne({ name: 'Third', email: '' });
    await expect(customers.insertOne({ name: 'Fourth', email: '' })).rejects.toThrow(/E11000/);
  }, 30000);
});
