'use strict';

/*
 * One version, written everywhere it is stated.
 *
 * package.json is not the only file that names the release. codemeta.json
 * states it twice (version and softwareVersion) plus a sentence about whether
 * it is tagged, CITATION.cff states it again, and the generated OpenAPI spec
 * carries it in info.version. Three separate tests assert they all agree, and
 * CI regenerates the docs and fails on any diff.
 *
 * The first real run of `release:ship` bumped package.json alone and CI
 * refused the release a minute later - correctly, and after the tag had
 * already been pushed. Bumping is therefore not an edit to one file; it is
 * this script, and release-ship.js calls it before committing.
 *
 *   node scripts/sync-version.js            # sync every file to package.json
 *   node scripts/sync-version.js --check    # fail if any of them disagree
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');
const version = require(path.join(ROOT, 'package.json')).version;

const changed = [];
const wrong = [];

/* Rewritten as text, not JSON.stringify: these files are read by people and
   reformatting them whole would bury a one-line change in a thousand. */
function edit(file, replacements) {
  const p = path.join(ROOT, file);
  const before = fs.readFileSync(p, 'utf8');
  let after = before;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(after)) {
      throw new Error(`${file}: nothing matched ${pattern} - the file's shape changed`);
    }
    after = after.replace(pattern, replacement);
  }
  if (after === before) return;
  if (CHECK) { wrong.push(file); return; }
  fs.writeFileSync(p, after);
  changed.push(file);
}

edit('codemeta.json', [
  [/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`],
  [/^(\s*"softwareVersion":\s*")[^"]+(")/m, `$1${version}$2`],
  /* The sentence names the version too, so it goes stale in its own way. */
  [/^(\s*"developmentStatus":\s*"active development; package version )[^ ]+( )/m,
    `$1${version}$2`],
]);

edit('CITATION.cff', [[/^(version:\s*).+$/m, `$1${version}`]]);

/*
 * The OpenAPI spec takes its version from api/package.json, so that file has
 * to move too - and the spec is then regenerated rather than hand-edited,
 * because CI regenerates it and compares.
 */
edit('api/package.json', [[/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`]]);

if (!CHECK) {
  execFileSync('npm', ['run', 'docs:api'], {
    cwd: path.join(ROOT, 'api'), stdio: 'pipe', shell: true,
  });
  changed.push('docs/API.md + docs/openapi.json (regenerated)');
}

if (CHECK) {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'openapi.json'), 'utf8'));
  if (spec.info.version !== version) wrong.push('docs/openapi.json');
  if (wrong.length) {
    console.error(`\n  These still name a different version than ${version}:`);
    for (const f of wrong) console.error(`    ${f}`);
    console.error('\n  Run: node scripts/sync-version.js\n');
    process.exit(1);
  }
  console.log(`every version-bearing file agrees on ${version}`);
} else {
  console.log(`version ${version} written to:`);
  for (const f of changed) console.log(`  ${f}`);
}
