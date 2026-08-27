#!/usr/bin/env node
'use strict';

/*
 * A whole Posnic on this machine, with nothing shared with production.
 *
 * Owner, before the vendor-stack upgrade: "create one local mongodb and
 * install all local... i dont want existing customer affected."
 *
 * Starts an embedded MongoDB (downloaded once into the mongodb-memory-server
 * cache) with its files under api/.local-db so the data SURVIVES restarts -
 * an in-memory database would make every test session start from nothing.
 * Then boots the API against it on a local port. The frontend is served by
 * the same API process out of frontend/public, so one URL is the whole app.
 *
 * Nothing here reads production credentials: the URI is localhost, the JWT
 * secret is a throwaway, and the tenant is whatever you seed.
 */
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', '.local-db');
const PORT = process.env.LOCAL_PORT || 5055;
const DB_PORT = process.env.LOCAL_DB_PORT || 27055;

async function main() {
  fs.mkdirSync(DB_DIR, { recursive: true });

  /*
   * A previous run that was killed (rather than shut down) leaves
   * mongod.lock behind and the next start dies on DBPathInUse. Clear a
   * stale lock when no mongod is actually holding the port.
   */
  const lock = path.join(DB_DIR, 'mongod.lock');
  if (fs.existsSync(lock)) {
    try {
      fs.unlinkSync(lock);
      console.log('[local] cleared a stale database lock from a previous run');
    } catch (e) {
      console.error('[local] a previous MongoDB is still running and holding ' + DB_DIR);
      console.error('[local] stop it first:  powershell "Get-Process *mongo* | Stop-Process -Force"');
      process.exit(1);
    }
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  console.log('[local] starting embedded MongoDB (first run downloads it)…');
  const mongo = await MongoMemoryServer.create({
    instance: { port: Number(DB_PORT), dbName: 'PosnicPro', dbPath: DB_DIR, storageEngine: 'wiredTiger' },
  });
  const uri = mongo.getUri('PosnicPro');
  console.log('[local] mongodb ready on port ' + DB_PORT + ' (data kept in api/.local-db)');

  /*
   * Secrets: generated once for THIS machine and kept beside the local
   * database. The API refuses to boot without them by design (a shipped
   * default would be shared by every installation), and these never leave
   * the box - .local-db is gitignored.
   */
  const crypto = require('crypto');
  const secretsFile = path.join(DB_DIR, 'local-secrets.json');
  let secrets;
  if (fs.existsSync(secretsFile)) {
    secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  } else {
    const rand = () => crypto.randomBytes(32).toString('hex');
    secrets = {
      SESSION_SECRET: rand(),
      ENCRYPTION_KEY: rand(),
      ENCRYPTION_IV: rand(),
      JWT_SECRET: rand(),
      KIOSK_API_KEY: rand(),
      POSNIC_KEY: rand(),
      POSNIC_SECRET: rand(),
    };
    fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
    console.log('[local] generated local-only secrets (api/.local-db/local-secrets.json)');
  }
  for (const [k, v] of Object.entries(secrets)) {
    if (!process.env[k]) process.env[k] = v;
  }

  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.MONGODB_URI = uri;
  process.env.PORT = String(PORT);
  process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';

  console.log('[local] booting the API…');
  require(path.join(__dirname, '..', 'server.js'));

  /*
   * A shop to log into. Installed once through the real installation
   * endpoint - the same path a genuine tenant takes - so the local copy
   * exercises production code rather than a special test fixture.
   */
  const LOGIN = { user: 'local@posnic.test', pass: 'Local@12345' };
  setTimeout(async () => {
    try {
      const base = 'http://localhost:' + PORT;
      /*
       * Install exactly ONCE per local database. Re-running install/add on
       * an existing license does NOT upsert - it creates a NEW branch id
       * every time, orphaning the previous branch's items and settings
       * (that is how the local shop kept "losing" its catalogue between
       * restarts). Until the endpoint is made idempotent server-side, a
       * marker beside the data files is the guard.
       */
      const installedMarker = path.join(DB_DIR, 'installed.marker');
      if (!fs.existsSync(installedMarker)) {
        const res = await fetch(base + '/api/install/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: process.env.POSNIC_KEY,
            secret: process.env.POSNIC_SECRET,
            register_companyname: 'Local Test Shop',
            register_username: LOGIN.user,
            register_useremail: LOGIN.user,
            register_userphone: '9000000000',
            register_userpassword: LOGIN.pass,
            /* a real, stable ObjectId so restarts reuse the same shop */
            register_license: 'local'.split('').map(function (c) { return c.charCodeAt(0).toString(16); }).join('').padEnd(24, '0'),
            register_firstname: 'Local',
            register_lastname: 'Tester',
            /* the installer builds a default customer from these */
            register_country: 'India',
            register_countryid: '101',
            register_state: 'Tamil Nadu',
            register_stateid: '4035',
            register_currency: 'INR',
            register_timezone: 'Asia/Kolkata',
            demo_data: 'yes',
          }),
        }).then((r) => r.json()).catch((e) => ({ error: e.message }));
        console.log('[local] shop install: ' + (res && (res.message || res.type || res.error || 'done')));
        if (res && res.type !== 'error' && !res.error) {
          fs.writeFileSync(installedMarker, new Date().toISOString());
        }
      }
    } catch (e) {
      console.log('[local] shop install skipped: ' + e.message);
    }
    console.log('\n' + '='.repeat(66));
    console.log('  POSNIC (LOCAL)  ->  http://localhost:' + PORT + '/login.html');
    console.log('  login: ' + LOGIN.user + '   password: ' + LOGIN.pass);
    console.log('  database: local only (api/.local-db) - production untouched');
    console.log('='.repeat(66) + '\n');
  }, 3000);

  const shutdown = async () => {
    console.log('\n[local] stopping…');
    await mongo.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[local] failed to start:', err && err.message);
  process.exit(1);
});
