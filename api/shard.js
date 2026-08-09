/*
 * One process, many shops.
 *
 * A shop today is its own Node process: ~125MB of runtime and modules, plus
 * about 6MB of anything that is actually the shop. Twenty-one shops on the first
 * machine cost 2.6GB, and in eleven hours of measurement they served 318
 * requests between them. A trial that never rings a sale costs exactly what the
 * busiest customer costs, because the tax is the runtime, not the tenant.
 *
 * This serves all of them from one process. The saving is the duplicate runtime:
 * 21 x 125MB becomes one x ~125MB plus 21 x ~6MB.
 *
 * The whole design rests on two seams that already exist and are tested:
 *
 *   - src/db/tenant-context.js carries the shop in AsyncLocalStorage, so a
 *     request keeps its identity across every await without threading an
 *     argument through twelve layers. In multi-tenant mode it THROWS rather
 *     than falling back to a process-wide handle, because the fallback is the
 *     leak: it would quietly serve one shop's data to another;
 *   - currentSecret() does the same for JWT_SECRET and the encryption keys.
 *     Those are per shop, and reading them from process.env here would mean a
 *     token minted for one customer verifying for another - worse than the
 *     wrong database, because nothing about it is visible from inside either
 *     shop.
 *
 * What this file adds is the front door: Host header -> which shop -> open the
 * scope -> hand the request to the same express app a single-shop process runs.
 */

const dotenv = require('dotenv');
dotenv.config({ path: './.env', quiet: true });

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const app = require('./app');
const { enableMultiTenant, runWithTenant } = require('./src/db/tenant-context');

const PORT = Number(process.env.SHARD_PORT || process.env.PORT || 6000);
const HOST = process.env.SHARD_HOST || '127.0.0.1';

/*
 * The control database, read directly.
 *
 * The worker needs the tenant registry and the sealed secrets, both of which
 * live in the control database. It reads them; it never writes there.
 */
const CONTROL_URI = process.env.CONTROL_URI || process.env.MONGODB_URI;
const CONTROL_DB = process.env.CONTROL_DB;

/*
 * Pool size, and why it matters more here than it did per shop.
 *
 * Every shop used to hold its own pool, so the ceiling was multiplied by the
 * number of processes - twenty shops idling once held 1,052 open connections.
 * One process means one pool for all of them, so this is a real ceiling rather
 * than a per-shop suggestion, and it can afford to be larger than five.
 */
const POOL_SIZE = parseInt(process.env.SHARD_POOL_SIZE, 10) || 20;

/* Envelope format shared with the provisioner. Only the opening half is here:
   the worker never writes a shop's secrets. The version tag makes a change
   there surface as a refusal naming the version rather than a wrong plaintext. */
const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function masterKey() {
  const raw = process.env.TENANT_SECRET_KEY;
  if (!raw) throw new Error('TENANT_SECRET_KEY is not set; a shard cannot open any shop');
  const key = Buffer.from(String(raw).trim(), 'hex');
  if (key.length !== 32) throw new Error('TENANT_SECRET_KEY must be 64 hex characters');
  return key;
}

function decryptSecret(blob, key) {
  const parts = String(blob).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`not an encrypted secret of a version this understands: ${parts[0]}`);
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const d = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ctHex, 'hex')), d.final()]).toString('utf8');
}

/*
 * The registry, in memory.
 *
 * Looking a shop up in the control database on every request would put a round
 * trip in front of every page load, and the answer changes about once a day.
 * Refreshed on a timer, and again on demand when a hostname arrives that is not
 * known - which is what a shop provisioned two minutes ago looks like.
 */
const byHost = new Map();
let lastLoad = 0;
const RELOAD_MS = 60_000;
/* Long enough that a stream of requests for a hostname that will never exist
   cannot turn into a stream of control-database queries. */
const MISS_BACKOFF_MS = 10_000;
let lastMiss = 0;

let controlClient = null;

async function loadRegistry() {
  const tenants = await controlClient
    .db(CONTROL_DB)
    .collection('tenants')
    .find({ provisioned: true, subdomain: { $exists: true, $nin: [null, ''] } })
    .project({ subdomain: 1, tenantDb: 1, secrets: 1, suspended: 1, webDomain: 1 })
    .toArray();

  const key = masterKey();
  const next = new Map();

  for (const t of tenants) {
    let secrets = {};
    try {
      for (const [name, blob] of Object.entries(t.secrets || {})) {
        secrets[name] = decryptSecret(blob, key);
      }
    } catch (e) {
      /* A shop whose secrets cannot be opened is not served. Serving it with
         the wrong keys would encrypt its records unreadably and sign tokens
         nothing can verify - both silent, both permanent. */
      console.error(
        `[shard] ${t.subdomain}: secrets could not be opened (${e.message}); not served`
      );
      continue;
    }

    /* useDb shares the parent's MongoClient and its pool - measured at zero
       additional sockets for twenty-five shops. Cached, so the same Connection
       is reused rather than rebuilt per request. */
    const connection = mongoose.connection.useDb(t.tenantDb, { useCache: true });

    const entry = {
      subdomain: t.subdomain,
      tenantDb: t.tenantDb,
      suspended: !!t.suspended,
      connection,
      db: connection.db,
      secrets,
    };

    next.set(`${t.subdomain}.posnic.io`, entry);
    /* A custom domain points at the same shop. Registered too, so a customer on
       their own domain is not a second lookup path that can drift. */
    if (t.webDomain) next.set(String(t.webDomain).toLowerCase(), entry);
  }

  byHost.clear();
  for (const [k, v] of next) byHost.set(k, v);
  lastLoad = Date.now();
  console.log(`[shard] serving ${next.size} hostname(s) across ${tenants.length} shop(s)`);
}

/** The shop a request belongs to, or null. */
async function resolve(hostHeader) {
  const host = String(hostHeader || '')
    .toLowerCase()
    .split(':')[0];
  if (!host) return null;

  let hit = byHost.get(host);
  if (hit) return hit;

  /* Not known. A shop provisioned a minute ago looks exactly like this, so the
     registry is re-read once - rate limited, so a flood of requests for a
     hostname that will never exist cannot become a flood of queries. */
  if (Date.now() - lastMiss > MISS_BACKOFF_MS) {
    lastMiss = Date.now();
    try {
      await loadRegistry();
    } catch (e) {
      console.error('[shard] registry reload failed:', e.message);
    }
    hit = byHost.get(host);
  }
  return hit || null;
}

async function main() {
  if (!CONTROL_URI) throw new Error('CONTROL_URI or MONGODB_URI must be set');
  if (!CONTROL_DB) throw new Error('CONTROL_DB must be set');

  /*
   * Declared before anything is served.
   *
   * From here, any database access outside a request scope throws instead of
   * quietly using whichever shop the process happened to connect to. That is
   * the point: a background job that wants the database has to say which shop
   * it means.
   */
  enableMultiTenant(true);

  await mongoose.connect(CONTROL_URI, { maxPoolSize: POOL_SIZE });
  controlClient = new MongoClient(CONTROL_URI, { maxPoolSize: 5 });
  await controlClient.connect();

  await loadRegistry();
  setInterval(() => {
    loadRegistry().catch((e) => console.error('[shard] refresh failed:', e.message));
  }, RELOAD_MS).unref();

  const server = http.createServer((req, res) => {
    resolve(req.headers.host)
      .then((tenant) => {
        if (!tenant) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('No shop is served at this address.\n');
          return;
        }
        if (tenant.suspended) {
          /* Answered here rather than by the app, which has no reason to know
             about suspension and would otherwise let a suspended shop sign in. */
          res.writeHead(403, { 'content-type': 'text/plain' });
          res.end('This shop is suspended.\n');
          return;
        }

        /*
         * The scope. Everything downstream - models, controllers, the auth
         * middleware, anything they await - reads this shop and no other.
         */
        runWithTenant(tenant, () => app(req, res));
      })
      .catch((e) => {
        console.error('[shard] request failed:', e.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('This shop could not be reached.\n');
        }
      });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[shard] listening on http://${HOST}:${PORT}`);
    console.log(`[shard] pool ${POOL_SIZE}, registry refresh ${RELOAD_MS / 1000}s`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[shard] fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { resolve, loadRegistry, decryptSecret, byHost };
