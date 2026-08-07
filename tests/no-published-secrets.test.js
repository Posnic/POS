/*
 * No signing key may be a string in the source.
 *
 * Written for the day this repository goes public. It used to hold
 *
 *     secret: process.env.JWT_SECRET || "your_jwt_secret_key_here"
 *     secret: process.env.SESSION_SECRET || "your-secret-key"
 *
 * which were harmless while nobody outside could read them. Published, they are
 * signing keys printed on the internet: any deployment that missed the
 * environment variable would sign login tokens with a known string, and anyone
 * could mint a token for any user of any tenant.
 *
 * Both front doors already refuse to start without real secrets - verify-secrets
 * runs before server.js serves anything, and the desktop app generates a set per
 * machine. This is about every other door, and about the next person who adds a
 * secret and reaches for a placeholder.
 *
 * The rule: absent means random-per-process, never a constant. Failing closed is
 * a loud local problem; failing public is a quiet global one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Everything that ships. Tests are excluded: a test secret is a fixture, it
   signs nothing real, and forcing randomness on them only makes them flaky. */
function shippedJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|dist|builds|mongodb|nodejs|tests|test)$/.test(entry.name)) continue;
      shippedJs(full, out);
    } else if (entry.name.endsWith('.js') && !/\.(test|spec)\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [
  ...shippedJs(path.join(ROOT, 'api', 'src')),
  /*
   * api/scripts too. It was left out of the first version of this test, which
   * is why a script writing JWT_SECRET=your_jwt_secret_key_here into a
   * generated .env went unnoticed - the file was simply never read.
   *
   * test-local.js is exempt. Its secrets are fixtures for a local test run
   * against a throwaway database: they sign nothing that exists outside that
   * run, and forcing randomness on them would only make the suite unrepeatable.
   * It no longer ships either - api/scripts is excluded from the installer, so
   * a shop's till stopped receiving fourteen developer scripts it had no use
   * for, including one that connects to the database and one that rewrites
   * source files.
   */
  ...shippedJs(path.join(ROOT, 'api', 'scripts'))
    .filter((f) => !/test-local\.js$/.test(f)),
  ...shippedJs(path.join(ROOT, 'scripts')),
  path.join(ROOT, 'api', 'app.js'),
  path.join(ROOT, 'api', 'server.js'),
  ...fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.js') && !/\.(test|spec)\.js$/.test(f))
    .map((f) => path.join(ROOT, f)),
].filter((f) => fs.existsSync(f));

const SECRET_NAME = /(JWT_SECRET|SESSION_SECRET|ENCRYPTION_KEY|ENCRYPTION_IV|API_KEY|COOKIE_SECRET|REFRESH_SECRET)/;

test('there are shipped files to check', () => {
  assert.ok(FILES.length > 50, `only found ${FILES.length} files; the walk is wrong`);
});

test('no secret falls back to a string literal', () => {
  const offences = [];

  for (const file of FILES) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;

      /*
       * A secret written straight into generated configuration.
       *
       * The first version of this test looked only for the
       * `process.env.X || "literal"` shape and so missed
       * api/scripts/setup-package-json.js, which wrote
       * JWT_SECRET=your_jwt_secret_key_here into a .env it generated. Same
       * published key, different shape.
       */
      const written = line.match(/^\s*(\w*(?:SECRET|KEY|PASSWORD)\w*)=(\S+)/);
      if (written && SECRET_NAME.test(written[1])) {
        offences.push(
          `${path.relative(ROOT, file)}:${i + 1}  ${written[1]} is written as "${written[2]}"`);
        return;
      }

      /* process.env.X_SECRET || "anything" - the exact shape that shipped. */
      const m = line.match(
        /process\.env\.(\w*(?:SECRET|KEY|IV|PASSWORD)\w*)\s*\|\|\s*(['"`])([^'"`]*)\2/);
      if (!m) return;

      const [, name, , value] = m;
      if (!SECRET_NAME.test(name)) return;
      if (value === '') return; // empty means absent, which is honest

      offences.push(`${path.relative(ROOT, file)}:${i + 1}  ${name} falls back to "${value}"`);
    });
  }

  assert.deepStrictEqual(offences, [],
    'a signing secret falls back to a literal, which is a published key once ' +
    'this repository is public. Use ephemeralSecret() from config/signing-secret:\n  ' +
    offences.join('\n  '));
});

test('the placeholders that shipped are gone by name', () => {
  /* Named explicitly: these are the exact strings that were in the source, and
     a copy-paste that reintroduces one should fail loudly rather than rely on
     the pattern above still matching whatever shape it comes back in. */
  const BANNED = ['your-secret-key', 'your_jwt_secret_key_here', 'changeme', 'secret123'];

  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const banned of BANNED) {
      /* Allowed inside a comment - the files that fixed this quote them. */
      const inCode = text.split('\n').some((line) =>
        line.includes(banned)
        && !line.trim().startsWith('*')
        && !line.trim().startsWith('//')
        && !line.trim().startsWith('/*'));

      assert.ok(!inCode,
        `${path.relative(ROOT, file)} uses the placeholder "${banned}" in code`);
    }
  }
});

/* ---- and the replacement behaves ------------------------------------- */

const { ephemeralSecret } = require('../api/src/config/signing-secret');

test('an absent secret becomes something unguessable', () => {
  const s = ephemeralSecret('TEST_ONLY_SECRET');
  assert.strictEqual(typeof s, 'string');
  assert.ok(s.length >= 64, `too short to sign with: ${s.length} chars`);
  assert.match(s, /^[0-9a-f]+$/, 'expected hex from randomBytes');
});

test('it is stable within a process, so a token survives the next request', () => {
  assert.strictEqual(
    ephemeralSecret('TEST_STABLE'), ephemeralSecret('TEST_STABLE'));
});

test('different secrets do not collide', () => {
  assert.notStrictEqual(ephemeralSecret('TEST_A'), ephemeralSecret('TEST_B'));
});

test('the startup guard still lists every secret it must have', () => {
  /* This test is about the fallback being safe. The guard is what makes it
     unreachable in a real launch, and the two must not drift apart. */
  const { REQUIRED } = require('../api/src/config/verify-secrets');
  const names = REQUIRED.map(([n]) => n);
  for (const needed of ['JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'ENCRYPTION_IV']) {
    assert.ok(names.includes(needed), `verify-secrets no longer requires ${needed}`);
  }
});

test('server.js checks before it serves', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'server.js'), 'utf8');
  const check = src.indexOf('verify-secrets');
  const serve = src.indexOf('require("./app")');
  assert.ok(check > -1, 'server.js no longer verifies its secrets');
  assert.ok(serve === -1 || check < serve,
    'the app is loaded before the secrets are checked');
});

test('the environment template reaches people who clone', () => {
  /* api/.gitignore ignores .env.* , which swallowed .env.example - so the one
     file documenting every variable the API needs sat on each maintainer's disk
     and reached nobody else. It holds names and empty values only. */
  const { execFileSync } = require('node:child_process');
  const tracked = execFileSync('git', ['ls-files', 'api/.env.example'],
    { cwd: ROOT, encoding: 'utf8' }).trim();

  assert.strictEqual(tracked, 'api/.env.example',
    'api/.env.example is not tracked; contributors get no environment template');
});

test('the template lists every secret the API refuses to start without', () => {
  const { REQUIRED, OPTIONAL } = require('../api/src/config/verify-secrets');
  const template = fs.readFileSync(path.join(ROOT, 'api', '.env.example'), 'utf8');

  for (const [name] of [...REQUIRED, ...OPTIONAL]) {
    assert.ok(template.includes(`${name}=`),
      `${name} is required at startup but absent from .env.example, so someone ` +
      `following the template still cannot boot the API`);
  }
});

test('the template carries no actual secrets', () => {
  /* It is tracked now, so anything with a value in it is published. */
  const template = fs.readFileSync(path.join(ROOT, 'api', '.env.example'), 'utf8');
  const { REQUIRED, OPTIONAL } = require('../api/src/config/verify-secrets');
  const secretNames = [...REQUIRED, ...OPTIONAL].map(([n]) => n);

  for (const line of template.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    if (!secretNames.includes(name) && !/KEY|SECRET|PASSWORD|TOKEN/.test(name)) continue;

    assert.strictEqual(value.trim(), '',
      `${name} has a value in .env.example, which is a tracked file`);
  }
});

test('no default login credential is written anywhere', () => {
  /*
   * setup-mongodb.js carried a never-called installDemoData() that seeded a
   * first user of admin / admin123, and api/README.md printed the same pair as
   * a login example. Neither created anything - a database with no users shows
   * the installation wizard and the operator picks their own credentials - but
   * setup-mongodb.js ships inside the installer, so publishing this repository
   * would have published what reads like a working default login for every
   * Posnic ever installed.
   *
   * Dead code is no defence. It needs one caller to become true.
   */
  const CREDENTIALS = ['admin123', 'password123', 'Admin@123', 'posnic123'];

  const files = [
    ...shippedJs(path.join(ROOT, 'api', 'src')),
    ...fs.readdirSync(ROOT)
      .filter((f) => /\.(js|md)$/.test(f))
      .map((f) => path.join(ROOT, f)),
    path.join(ROOT, 'api', 'README.md'),
  ].filter((f) => fs.existsSync(f));

  const offences = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      /* A line explaining that one was removed is not one. */
      if (/stood here|used to|no longer|removed/.test(line)) return;
      for (const cred of CREDENTIALS) {
        if (line.includes(cred)) {
          offences.push(`${path.relative(ROOT, file)}:${i + 1}  ${cred}`);
        }
      }
    });
  }

  assert.deepStrictEqual(offences, [],
    'a default credential appears in shipped source or documentation:\n  ' +
    offences.join('\n  '));
});

test('developer scripts do not ship to shops', () => {
  /* Fourteen of them were reaching every till: one that connects to the
     database and prints money figures, one that rewrites source files, one that
     overwrote api/package.json. Nothing at runtime requires any of them. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const api = (pkg.build.extraResources || []).find((r) => r.from === 'api');

  assert.ok(api, 'the build no longer packages api/');
  assert.ok(api.filter.includes('!scripts/**'),
    'api/scripts is packaged into the installer again');
});

test('no schema default supplies a secret either', () => {
  /*
   * A third shape, found after the first two were closed.
   *
   * api/src/config/index.js validated its environment with Joi and gave the
   * signing keys defaults:
   *
   *   JWT_SECRET: Joi.string().default("your_jwt_super_secret_key_change_in_production")
   *
   * A default is worse than a missing value. It makes the schema validate, so
   * the API starts and signs real tokens with a string printed in a public
   * repository - and nothing complains, because as far as the schema is
   * concerned the configuration is complete.
   */
  const offences = [];

  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8');

    /*
     * Joi.string()...default("literal") on a name that signs something.
     *
     * [^,;]* rather than [\s\S]{0,200} because the loose version ran past the
     * end of one property into the next and reported JWT_SECRET as defaulting
     * to "90d" - which belonged to JWT_EXPIRES_IN two lines below. A check that
     * cries wolf about the wrong field is worse than no check.
     */
    const rx = /(\w*(?:SECRET|KEY|PASSWORD|TOKEN)\w*)\s*:\s*Joi\.[^,;]*?\.default\(\s*(['"`])([^'"`]*)\2/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const [, name, , value] = m;
      if (!SECRET_NAME.test(name)) continue;
      if (value === '') continue;
      offences.push(`${path.relative(ROOT, file)}  ${name} defaults to "${value}"`);
    }
  }

  assert.deepStrictEqual(offences, [],
    'a signing secret has a schema default, so the API starts without one ' +
    'being configured and signs with a published string:\n  ' + offences.join('\n  '));
});

test('the secrets the API cannot run without are required, not defaulted', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'config', 'index.js'), 'utf8');

  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET']) {
    const at = src.indexOf(`${name}: Joi.`);
    assert.notStrictEqual(at, -1, `${name} is no longer in the config schema`);
    const decl = src.slice(at, at + 200);
    assert.match(decl, /\.required\(\)/,
      `${name} is not required, so a deployment missing it starts anyway`);
  }
});
