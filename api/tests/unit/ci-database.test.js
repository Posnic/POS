/*
 * The connection string surgery the real-database tests depend on.
 *
 * This runs in the ordinary suite, with no database, because the thing it
 * guards is exactly the thing a database-gated test cannot check: whether the
 * tests are talking to the database they think they are. A mistake here does
 * not fail - it quietly runs the suite somewhere else and drops something else
 * afterwards.
 */

const { withDatabase, ciDatabaseName } = require('../api/ci-database');

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
