#!/usr/bin/env node
/*
 * Prove the CI database is usable before a release depends on it.
 *
 * The release job used to check only that CI_MONGODB_URI was non-empty. Three
 * ordinary Atlas misconfigurations pass that check and then fail later as
 * something that reads like a code problem:
 *
 *   - the Network Access allowlist does not include 0.0.0.0/0, so the runner
 *     (whose IP changes every build) cannot connect at all;
 *   - the database user is scoped to one database, and every run uses a new
 *     one, so authentication succeeds and the first write is refused;
 *   - a free-tier cluster has auto-paused after sixty days of no use.
 *
 * This does what the tests do - connect, create a database of its own, write,
 * read it back, drop it - and says which of those it was. It exits non-zero
 * with an explanation rather than a stack trace, because the person reading it
 * is looking at a failed release and wants to know which setting to change.
 */

const { MongoClient } = require('mongodb');
const { withDatabase, ciDatabaseName } = require('../tests/api/ci-database');

const URI = process.env.CI_MONGODB_URI;

/* Never print the URI: it carries the password, and CI logs are readable by
   anyone who can see the repository. */
function redact(uri) {
  return String(uri).replace(/\/\/[^@/]+@/, '//***:***@');
}

function fail(message, detail) {
  console.error(`::error::${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

async function main() {
  if (!URI) {
    fail(
      'CI_MONGODB_URI is not set, so the real-database tests would skip - on a ' +
        'release tag. Add it under Settings → Secrets and variables → Actions, ' +
        'then re-run this release.'
    );
  }

  const dbName = ciDatabaseName('ci_preflight');
  let target;
  try {
    target = withDatabase(URI, dbName);
  } catch (e) {
    fail(`CI_MONGODB_URI is not a usable connection string: ${e.message}`);
  }

  console.log(`Checking ${redact(target)}`);

  const client = new MongoClient(target, { serverSelectionTimeoutMS: 20000 });

  try {
    await client.connect();
  } catch (e) {
    fail(
      'Could not connect to the CI database.',
      `${e.message}\n  Usually one of: the Atlas Network Access list does not ` +
        'include 0.0.0.0/0 (GitHub runners have no fixed IP), the free cluster ' +
        'has auto-paused, or the password in the secret is stale.'
    );
  }

  try {
    const db = client.db(dbName);
    const collection = db.collection('preflight');

    await collection.insertOne({ at: new Date(), run: process.env.GITHUB_RUN_ID || 'local' });
    const count = await collection.countDocuments();
    if (count !== 1) {
      fail(`Wrote one document and read back ${count}.`);
    }

    /* The tests drop their database at the end. If that is refused they leak,
       and a 512MB free tier fills up. Better to find out now. */
    await db.dropDatabase();

    console.log('CI_MONGODB_URI works: connected, wrote, read back and dropped a database.');
  } catch (e) {
    fail(
      'Connected to the CI database but could not use it.',
      `${e.message}\n  Each run creates a database of its own, so the database ` +
        'user needs readWriteAnyDatabase - a user scoped to a single database ' +
        'authenticates and is then refused on the first write.'
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((e) => fail('The database preflight itself failed.', e.stack));
