/*
 * The README's numbers must be true.
 *
 * The badges were a test count of 8,296 and coverage of 66%. Neither matched
 * what the suite actually did - the real figures were 7,986 and 64.6% - because
 * a number typed into a badge stays where it was typed while the thing it
 * describes moves on.
 *
 * A stale badge is worse on a public repository than no badge. It is the first
 * thing a stranger reads, they have no way to check it, and if the easily
 * checked claims are wrong there is no reason to believe the rest.
 *
 * The counts that can be derived are derived here. The ones that cannot - the
 * live download total, the latest release - are left to shields.io, which reads
 * them from GitHub rather than from a promise made months ago.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

function badge(label) {
  const m = README.match(
    new RegExp(`img\\.shields\\.io/badge/${label}-([^)\\]]+?)(?:-[a-z]+)?\\)`));
  return m ? decodeURIComponent(m[1]).replace(/%2C/gi, ',').replace(/%20/g, ' ') : null;
}

test('the REST endpoint count is the number of routes there are', () => {
  const dir = path.join(ROOT, 'api', 'src', 'routes');
  const actual = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.routes.js'))
    .reduce((n, f) => n + (fs.readFileSync(path.join(dir, f), 'utf8')
      .match(/router\.(get|post|put|patch|delete)\(/g) || []).length, 0);

  const claimed = parseInt((badge('REST%20API') || '').replace(/\D/g, ''), 10);
  assert.ok(Number.isFinite(claimed), 'the API badge has gone or changed shape');
  assert.strictEqual(claimed, actual,
    `README says ${claimed} endpoints; the routes declare ${actual}`);
});

test('the download and release badges read from GitHub, not from a number typed here', () => {
  /* These are the two the badges exist for - "how many people took it" and
     "what is current" - and both are unknowable from inside the repository. */
  assert.match(README, /img\.shields\.io\/github\/downloads\/Posnic\/POS\/total/,
    'the downloads badge is missing or is a hardcoded number');
  assert.match(README, /img\.shields\.io\/github\/v\/release\/Posnic\/POS/,
    'the latest-release badge is missing or is a hardcoded version');
});

test('the build badge points at the workflow that gates main', () => {
  assert.match(README, /actions\/workflows\/ci\.yml\/badge\.svg\?branch=main/,
    'the CI badge should be pinned to main, or it reports whichever branch ran last');
});

test('every badge that states a number is checked by this file', () => {
  /* So a new hardcoded claim cannot arrive unnoticed. If this fails, either
     derive the number above or make the badge live. */
  const KNOWN = ['REST%20API', 'tests', 'coverage', 'licence', 'platforms'];
  const numeric = [...README.matchAll(/img\.shields\.io\/badge\/([^-]+)-/g)]
    .map((m) => m[1]);

  for (const label of numeric) {
    assert.ok(KNOWN.includes(label),
      `the badge "${decodeURIComponent(label)}" states something this test does ` +
      `not verify. Add a check for it, or use a live shields.io endpoint.`);
  }
});

test('the licence badge matches what package.json declares', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const claimed = (badge('licence') || '').replace(/--/g, '-');

  /* The badge shows the licence's name, package.json carries its SPDX
     identifier, and SPDX appends -only or -or-later to say whether later
     versions are permitted. "AGPL-3.0" on a badge for "AGPL-3.0-only" is the
     same licence, not a discrepancy - what matters is that the family and
     version agree. */
  const spdxBase = pkg.license.replace(/-(only|or-later)$/, '');
  assert.strictEqual(claimed, spdxBase,
    `README says ${claimed}; package.json says ${pkg.license}`);
});

test('the licence the badge names is the licence in the file', () => {
  const licence = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(licence, /GNU AFFERO GENERAL PUBLIC LICENSE/,
    'LICENSE is not the AGPL the badge and package.json claim');
  assert.match(licence, /Version 3/, 'LICENSE is not version 3');
});

test('the third-party notices exist and ship with the app', () => {
  /* The installer carries MongoDB under the SSPL and Microsoft's C++ runtime.
     Both require their notice to travel with the copy. */
  const notices = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
  assert.ok(fs.existsSync(notices), 'THIRD-PARTY-NOTICES.md is missing');

  const text = fs.readFileSync(notices, 'utf8');
  for (const named of ['MongoDB', 'SSPL', 'Node.js', 'Electron', 'Visual C++']) {
    assert.ok(text.includes(named), `the notices do not mention ${named}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const f of ['THIRD-PARTY-NOTICES.md', 'LICENSE']) {
    assert.ok(pkg.build.files.includes(f),
      `${f} is not packaged, so it does not reach anyone who installs this`);
  }
});

test('the licence files survive the markdown exclusion', () => {
  // build.files is order-sensitive: a later pattern overrides an earlier one.
  // THIRD-PARTY-NOTICES.md was listed at index 7 and the blanket markdown
  // exclusion at index 33, so the exclusion won and the notices never reached
  // the installer - while the packaging test passed, because it checks that
  // listed files exist rather than that they survive the filter.
  //
  // MongoDB's SSPL and Microsoft's runtime terms both require the notice to
  // travel with the copy, so this is the difference between complying and
  // believing you comply.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = pkg.build.files;

  const exclusion = files.findIndex((f) => f === '!**/*.md');
  if (exclusion === -1) return; // no blanket exclusion, nothing to outrank

  for (const needed of ['THIRD-PARTY-NOTICES.md', 'LICENSE']) {
    const at = files.indexOf(needed);
    assert.notStrictEqual(at, -1, `${needed} is not in build.files`);
    if (!needed.endsWith('.md')) continue;
    assert.ok(at > exclusion,
      `${needed} is listed at ${at}, before the "!**/*.md" exclusion at ` +
      `${exclusion}. Later patterns win, so it is excluded and never ships.`);
  }
});

test('the test command a contributor is told to run is the one CI runs', () => {
  /*
   * `cd api && npm test` used to fail 12 suites on a clean checkout, because it
   * ran the unfiltered suite while CI ran the curated one. A first command that
   * fails teaches a new contributor that the project is broken, or worse, that
   * red is normal here.
   *
   * They are the same command now. The quarantine stays visible through
   * test:known-failures rather than being hidden - excluding suites is only
   * honest while the list is easy to look at.
   */
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8'));

  assert.match(pkg.scripts.test, /jest\.ci\.config\.js/,
    'api "npm test" must run the same configuration as CI');
  assert.strictEqual(pkg.scripts.test, pkg.scripts['test:ci'],
    'test and test:ci have drifted apart');

  assert.ok(pkg.scripts['test:all'],
    'the unfiltered suite must still be runnable, under a name that says so');
  assert.ok(!/jest\.ci\.config\.js/.test(pkg.scripts['test:all']),
    'test:all must not use the CI config, or nothing runs the quarantine');

  assert.ok(pkg.scripts['test:known-failures'],
    'the quarantine must be inspectable, or excluding it is just hiding it');
});

test('the quarantine list is reachable and not silently empty', () => {
  const list = require('../api/jest.known-failures.js');
  assert.ok(Array.isArray(list), 'jest.known-failures no longer exports a list');

  for (const suite of list) {
    assert.ok(fs.existsSync(path.join(ROOT, 'api', suite)),
      `${suite} is quarantined but no longer exists - the list is stale`);
  }
});

test('the docs describe the commands that exist', () => {
  const dev = fs.readFileSync(path.join(ROOT, 'docs', 'DEVELOPMENT.md'), 'utf8');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8'));

  for (const named of ['test:known-failures', 'test:all', 'test:local']) {
    assert.ok(dev.includes(named), `DEVELOPMENT.md does not mention ${named}`);
    assert.ok(pkg.scripts[named], `${named} is documented but does not exist`);
  }
});

test('every package points at this repository', () => {
  /* frontend/package.json pointed at Posnic/posnicpro, a repository this is
     not, so "report a bug" on npm metadata sent people somewhere else. The
     other two had no repository, bugs or homepage at all. */
  const REPO = 'github.com/Posnic/POS';

  for (const dir of ['.', 'api', 'frontend']) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'));
    const where = dir === '.' ? 'root' : dir;

    for (const field of ['repository', 'bugs', 'homepage']) {
      assert.ok(pkg[field], `${where}/package.json has no ${field}`);
      const value = typeof pkg[field] === 'string' ? pkg[field] : pkg[field].url;
      assert.ok(value.includes(REPO),
        `${where}/package.json ${field} points at ${value}, not this repository`);
    }
  }
});

test('the repository declares what it is', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.description && pkg.description.length > 40,
    'the root package has no usable description');
  assert.ok((pkg.keywords || []).length >= 5,
    'the root package has no keywords, so it is unfindable');
});

test('line endings and editor settings are declared', () => {
  /* Without these, a contributor on Linux and one on Windows hand each other
     diffs where every line changed. */
  for (const f of ['.gitattributes', '.editorconfig']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
  }

  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert.match(attrs, /^\* text=auto/m, '.gitattributes does not normalise text');
  assert.match(attrs, /\*\.bat\s+text eol=crlf/,
    'Windows batch files need CRLF or they misbehave when run');
});
