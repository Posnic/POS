/*
 * Pointing a connection string at a database of this run's own.
 *
 * The real-database tests share one free Atlas cluster. Two builds running at
 * once must not see each other's rows, and a build that finishes must not leave
 * anything behind - a 512MB free tier fills up, and then CI fails for a reason
 * that has nothing to do with the change being tested.
 *
 * Both suites used to do this by string surgery on the URI:
 *
 *     URI.replace('/?', `/${DB_NAME}?`)
 *
 * which works for exactly the shape Atlas puts on the clipboard
 * (mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true) and fails
 * silently for every other shape. A secret that already names a database -
 * .../posnic?retryWrites=true - has no '/?' in it, so nothing is replaced, the
 * tests run in that database, and the cleanup drops a different, empty one. The
 * isolation is gone and nothing says so.
 *
 * This parses the string instead: whatever database the URI names, if any, is
 * replaced by the one asked for.
 */

/* mongodb://host/db?opts and mongodb+srv://host/db?opts. Anything else is not
   a MongoDB URI and the driver would reject it anyway - better to say so here,
   where the message can explain which secret is wrong. */
const SCHEME = /^(mongodb(?:\+srv)?:\/\/)(.+)$/;

/**
 * Return `uri` with its database set to `dbName`, whatever it was before.
 *
 * Done by hand rather than through the WHATWG URL parser because the userinfo
 * of a real Atlas string is percent-encoded, and round-tripping it through URL
 * re-encodes it - which turns a working password into a failing one.
 */
function withDatabase(uri, dbName) {
  if (!uri || typeof uri !== 'string') {
    throw new TypeError('a MongoDB connection string is required');
  }
  if (!dbName || /[/\\. "$*<>:|?]/.test(dbName)) {
    /* MongoDB rejects these in a database name, and an invalid one here shows
       up much later as an unrelated connection error. */
    throw new Error(`"${dbName}" is not a usable database name`);
  }

  const match = uri.match(SCHEME);
  if (!match) {
    throw new Error(
      'the connection string does not start with mongodb:// or mongodb+srv:// - ' +
        'check the CI_MONGODB_URI secret'
    );
  }
  const [, scheme, rest] = match;

  /* Split the options off first: a password may contain a '/' but the query
     always begins at the first '?'. */
  const queryAt = rest.indexOf('?');
  const query = queryAt === -1 ? '' : rest.slice(queryAt);
  const authority = queryAt === -1 ? rest : rest.slice(0, queryAt);

  /* The host list ends at the first '/' after the credentials. Searching from
     the last '@' rather than the first keeps a password containing '@' from
     cutting the string in the wrong place. */
  const at = authority.lastIndexOf('@');
  const slash = authority.indexOf('/', at === -1 ? 0 : at + 1);
  const hosts = slash === -1 ? authority : authority.slice(0, slash);

  return `${scheme}${hosts}/${dbName}${query}`;
}

/**
 * A database name unique to this run.
 *
 * The run id and attempt keep two builds apart; the random tail keeps two jobs
 * within one build apart, since they share both.
 */
function ciDatabaseName(prefix = 'ci') {
  return [
    prefix,
    process.env.GITHUB_RUN_ID || 'local',
    process.env.GITHUB_RUN_ATTEMPT || '1',
    Math.random().toString(36).slice(2, 8),
  ].join('_');
}

/*
 * Clear out databases left behind by runs that never finished.
 *
 * Both suites drop their own database in teardown, and that works whenever
 * they reach it. A cancelled workflow does not: the runner is killed, the
 * `afterAll` never executes, and the database stays. Today a dozen builds were
 * cancelled by the concurrency group, and the free cluster answered the next
 * one with
 *
 *   cannot create a new database -- already using 100 databases of 100
 *
 * which fails every future build, for a reason that has nothing to do with
 * the change being tested. Cleaning up on the way in makes CI self-healing
 * rather than something that needs a person with cluster access.
 *
 * Only names this file generates, and only ones old enough that no run could
 * still be using them - a concurrent job's database must never be dropped
 * underneath it. GITHUB_RUN_ID is monotonic, so a name carrying a much older
 * id is finished by definition.
 */
/*
 * The run-attempt segment is optional because it was added to ciDatabaseName
 * after databases had already been created without it. Names from before that
 * change look like ci_routes_30800121481_72rd5i - run id, then straight to the
 * random tail - and a pattern that insisted on the attempt matched none of
 * them. Nineteen of them accumulated on the test cluster, invisible to the
 * sweeper that existed to remove exactly that, until the 100-database limit
 * started failing builds again.
 *
 * A sweeper is only as good as its ability to recognise its own past output,
 * so this has to keep matching every format we have ever generated, not just
 * the current one. Adding a segment to ciDatabaseName means widening this too.
 */
const SWEEP_PATTERN = /^ci(_routes)?_(\d+|local)(_\d+)?_[a-z0-9]{6}$/;

async function sweepStaleDatabases(client, { keepRunId } = {}) {
  const dropped = [];
  try {
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    const current = String(keepRunId || process.env.GITHUB_RUN_ID || '');

    for (const { name } of databases) {
      if (!SWEEP_PATTERN.test(name)) continue; // not ours
      const runId = name.split('_').filter((p) => /^\d+$/.test(p))[0];
      /*
       * Leave this run's own databases AND any run close enough to be
       * running right now. The old check was `runId === current`, which
       * missed that the CI workflow and the Test build workflow on the
       * SAME push carry DIFFERENT run ids - each sweeper saw the other's
       * live database as a leftover and dropped it mid-test, which is how
       * a freshly created unique index "stopped existing" and a duplicate
       * insert sailed through. Run ids on this instance differ by a few
       * hundred within one push and by hundreds of thousands between
       * pushes, so a 50k window cleanly separates "possibly concurrent"
       * from "finished by definition".
       */
      if (!runId) continue;
      if (!/^\d+$/.test(current) || Math.abs(Number(runId) - Number(current)) < 50000) continue;
      await client
        .db(name)
        .dropDatabase()
        .then(() => dropped.push(name))
        .catch(() => {
          /* another job may have dropped it first */
        });
    }
  } catch (err) {
    /* Never fail a test run over housekeeping. */
    console.warn('[ci-database] could not sweep old test databases:', err.message);
  }
  if (dropped.length) {
    console.log(`[ci-database] dropped ${dropped.length} leftover test database(s)`);
  }
  return dropped;
}

module.exports = { withDatabase, ciDatabaseName, sweepStaleDatabases, SWEEP_PATTERN };
