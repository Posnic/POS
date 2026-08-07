/*
 * The connection string surgery the real-database tests depend on.
 *
 * This runs in the ordinary suite, with no database, because the thing it
 * guards is exactly the thing a database-gated test cannot check: whether the
 * tests are talking to the database they think they are. A mistake here does
 * not fail - it quietly runs the suite somewhere else and drops something else
 * afterwards.
 */

const { withDatabase, ciDatabaseName, SWEEP_PATTERN } = require('../api/ci-database');

describe('pointing a connection string at a run of its own', () => {
  test('the shape Atlas actually puts on the clipboard', () => {
    expect(
      withDatabase(
        'mongodb+srv://ci:s3cret@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
        'ci_123'
      )
    ).toBe(
      'mongodb+srv://ci:s3cret@cluster0.ab1cd.mongodb.net/ci_123?retryWrites=true&w=majority&appName=Cluster0'
    );
  });

  test('a URI that already names a database has it replaced, not appended', () => {
    /* The old string replace left this one untouched, so the tests ran in
       "posnic" and the cleanup dropped an empty database instead. */
    expect(withDatabase('mongodb+srv://ci:p@host.mongodb.net/posnic?w=majority', 'ci_123')).toBe(
      'mongodb+srv://ci:p@host.mongodb.net/ci_123?w=majority'
    );
  });

  test('no options at all', () => {
    expect(withDatabase('mongodb://localhost:27017', 'ci_123')).toBe(
      'mongodb://localhost:27017/ci_123'
    );
    expect(withDatabase('mongodb://localhost:27017/', 'ci_123')).toBe(
      'mongodb://localhost:27017/ci_123'
    );
    expect(withDatabase('mongodb://localhost:27017/other', 'ci_123')).toBe(
      'mongodb://localhost:27017/ci_123'
    );
  });

  test('a replica set of several hosts keeps all of them', () => {
    expect(withDatabase('mongodb://a:1,b:2,c:3/old?replicaSet=rs0', 'ci_123')).toBe(
      'mongodb://a:1,b:2,c:3/ci_123?replicaSet=rs0'
    );
  });

  test('a password containing @ or / does not cut the string in the wrong place', () => {
    /* Percent-encoded, which is what the driver requires - but the encoding of
       a slash is what a naive indexOf('/') would trip over. */
    expect(withDatabase('mongodb://u:p%40ss%2Fword@host:27017/x?tls=true', 'ci_123')).toBe(
      'mongodb://u:p%40ss%2Fword@host:27017/ci_123?tls=true'
    );
  });

  test('the credentials are passed through byte for byte', () => {
    /* Round-tripping through a URL parser re-encodes these, which turns a
       working password into a failing one for no visible reason. */
    const uri = 'mongodb+srv://user%2Bci:A%2Fb%3Dc%21@cluster.mongodb.net/?authSource=admin';
    const out = withDatabase(uri, 'ci_1');
    expect(out).toContain('user%2Bci:A%2Fb%3Dc%21@');
  });

  test('something that is not a MongoDB URI says which secret is wrong', () => {
    expect(() => withDatabase('https://example.com', 'ci_1')).toThrow(/CI_MONGODB_URI/);
    expect(() => withDatabase('', 'ci_1')).toThrow(/connection string is required/);
  });

  test('a database name MongoDB would reject is caught here, not at connect time', () => {
    for (const bad of ['has space', 'has/slash', 'has.dot', '']) {
      expect(() => withDatabase('mongodb://h/x', bad)).toThrow(/usable database name/);
    }
  });
});

describe('the generated name', () => {
  test('is unique per call, so two jobs in one build cannot collide', () => {
    const names = new Set(Array.from({ length: 200 }, () => ciDatabaseName()));
    expect(names.size).toBe(200);
  });

  test('is a name MongoDB accepts, so it can be fed straight back in', () => {
    const name = ciDatabaseName();
    expect(() => withDatabase('mongodb://h/x', name)).not.toThrow();
  });

  test('carries the run id, so an orphan database can be traced to its build', () => {
    const prev = process.env.GITHUB_RUN_ID;
    process.env.GITHUB_RUN_ID = '987654';
    try {
      expect(ciDatabaseName()).toContain('987654');
    } finally {
      if (prev === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = prev;
    }
  });
});

/*
 * The sweeper and the generator have to agree, and nothing used to check that.
 *
 * They drifted: a run-attempt segment was added to ciDatabaseName, and
 * SWEEP_PATTERN was written for the new shape only. Every database created
 * before the change - ci_routes_30800121481_72rd5i, run id straight to the
 * random tail - stopped matching, so the sweeper walked past nineteen of its
 * own leftovers on the test cluster while reporting nothing to clean.
 *
 * That failure is silent by construction. The sweeper is housekeeping; it
 * never fails a build, so a pattern matching nothing looks exactly like a
 * cluster that was already tidy, right up until the 100-database limit starts
 * failing every build for a reason unrelated to the change being tested.
 *
 * The first test is the one that matters: it feeds the generator's own output
 * back to the pattern. Add a segment to ciDatabaseName without widening
 * SWEEP_PATTERN and it fails here, in the ordinary suite, with no database
 * needed - rather than months later on a cluster nobody is looking at.
 */
describe('the sweeper recognises its own leftovers', () => {
  test('whatever the generator produces today is matched', () => {
    const prev = { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
    try {
      process.env.GITHUB_RUN_ID = '30800121481';
      process.env.GITHUB_RUN_ATTEMPT = '2';
      for (const prefix of ['ci', 'ci_routes']) {
        expect(ciDatabaseName(prefix)).toMatch(SWEEP_PATTERN);
      }
      /* A developer running the suite locally has neither variable set. */
      delete process.env.GITHUB_RUN_ID;
      delete process.env.GITHUB_RUN_ATTEMPT;
      for (const prefix of ['ci', 'ci_routes']) {
        expect(ciDatabaseName(prefix)).toMatch(SWEEP_PATTERN);
      }
    } finally {
      if (prev.id === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = prev.id;
      if (prev.attempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
      else process.env.GITHUB_RUN_ATTEMPT = prev.attempt;
    }
  });

  test('names from before the attempt segment existed are still matched', () => {
    /* Taken from the test cluster, where they had accumulated unswept. */
    for (const name of [
      'ci_routes_30800121481_72rd5i',
      'ci_routes_30805722908_1oynco',
      'ci_routes_30978880948_iitnxz',
      'ci_30822742650_0bldsp',
    ]) {
      expect(name).toMatch(SWEEP_PATTERN);
    }
  });

  test('nothing that is not ours is ever matched', () => {
    /* The cost of a false positive here is a dropped production database, so
       this list is deliberately blunt: tenant databases, the databases every
       MongoDB deployment has, and near-misses that merely start with "ci". */
    for (const name of [
      'posnic_t_bala',
      'posnic_t_kiranastore',
      'PosnicPro',
      'Web',
      'admin',
      'local',
      'config',
      'ci',
      'ci_routes',
      'citybank_prod',
      'ci_routes_30800121481_toolongtail',
    ]) {
      expect(name).not.toMatch(SWEEP_PATTERN);
    }
  });
});
