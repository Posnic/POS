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

/*
 * Which shops this shard is responsible for.
 *
 * Unset means every provisioned shop, which is what a single-machine estate
 * wants and what shipped. SHARD_INSTANCE narrows it to the shops assigned to
 * one machine - necessary the moment a second machine runs a shard, because
 * otherwise both would try to open every shop in the fleet and each would fail
 * on the databases that live on the other one.
 */
const SHARD_INSTANCE = String(process.env.SHARD_INSTANCE || '').trim();

/*
 * A registry from a FILE instead of the control database.
 *
 * The demo estate needs this. Reading the control registry means holding the
 * control credential and TENANT_SECRET_KEY, which unseals every shop's secrets
 * across the whole fleet - and the demo box is a public machine whose logins
 * are printed on its own login page. Putting the fleet master key there to
 * serve shops that contain nothing would be a poor trade.
 *
 * The file carries its own plaintext secrets, which is the same posture the
 * single-shop demo already has: its JWT_SECRET sits in a 0600 .env beside it.
 * The difference from the control path is only WHERE the shop list comes from;
 * every tenant still gets its own scope and its own keys, and currentSecret
 * still refuses to fall through to the environment.
 *
 * Unset - which is every production shard - and nothing here runs.
 */
const REGISTRY_FILE = String(process.env.SHARD_REGISTRY_FILE || '').trim();

/* Lower-cased once: node lower-cases incoming header names, and comparing
   against a mixed-case env value would simply never match. */
const SHOP_HEADER = String(process.env.SHARD_SHOP_HEADER || '').trim().toLowerCase();

function loadRegistryFromFile() {
  const raw = JSON.parse(require('fs').readFileSync(REGISTRY_FILE, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.shops || [];
  const next = new Map();

  for (const r of rows) {
    if (!r || !r.host || !r.tenantDb) continue;
    /* Same rule as the control path: a shop whose keys are missing is not
       served, because serving it would sign tokens nothing can verify. */
    const secrets = r.secrets && typeof r.secrets === 'object' ? r.secrets : null;
    if (!secrets || !secrets.JWT_SECRET) {
      console.error(`[shard] ${r.host}: no JWT_SECRET in the registry file; not served`);
      continue;
    }
    const connection = mongoose.connection.useDb(r.tenantDb, { useCache: true });
    next.set(String(r.host).toLowerCase(), {
      subdomain: r.subdomain || r.host,
      tenantDb: r.tenantDb,
      suspended: !!r.suspended,
      connection,
      db: connection.db,
      secrets,
    });
  }

  byHost.clear();
  for (const [k, v] of next) byHost.set(k, v);
  lastLoad = Date.now();
  console.log(`[shard] serving ${next.size} hostname(s) from ${REGISTRY_FILE}`);
}

async function loadRegistry() {
  if (REGISTRY_FILE) return loadRegistryFromFile();
  const query = { provisioned: true, subdomain: { $exists: true, $nin: [null, ''] } };
  if (SHARD_INSTANCE) query.instance = SHARD_INSTANCE;
  const tenants = await controlClient
    .db(CONTROL_DB)
    .collection('tenants')
    .find(query)
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
  console.log(`[shard] serving ${next.size} hostname(s) across ${tenants.length} shop(s)`
    + (SHARD_INSTANCE ? ` on ${SHARD_INSTANCE}` : ''));
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
  /* Only the control path needs a control database to read. */
  if (!REGISTRY_FILE && !CONTROL_DB) throw new Error('CONTROL_DB must be set');

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
  if (!REGISTRY_FILE) {
    controlClient = new MongoClient(CONTROL_URI, { maxPoolSize: 5 });
    await controlClient.connect();
  }

  await loadRegistry();
  setInterval(() => {
    loadRegistry().catch((e) => console.error('[shard] refresh failed:', e.message));
  }, RELOAD_MS).unref();

  const server = http.createServer((req, res) => {
    /*
     * Which header names the shop.
     *
     * Host, normally - a shop is its own hostname and that is the whole
     * addressing scheme. The demo estate is the exception: fifty shops share
     * ONE public hostname and are chosen by a cookie, so the front end has to
     * name the shop some other way.
     *
     * Rewriting Host would do it, and would also put an internal name into
     * every absolute URL the application generates - links to a hostname that
     * does not resolve for anybody. A header of its own costs nothing and
     * cannot leak into a page.
     */
    const named = SHOP_HEADER ? req.headers[SHOP_HEADER] : null;
    resolve(named || req.headers.host)
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
