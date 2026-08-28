'use strict';

/*
 * The one-command release (scripts/release-ship.js).
 *
 * The whole point of the command is that its ORDER is safe: nothing
 * irreversible happens before the things that can fail cheaply, and nothing
 * becomes public before every platform is verified present. These tests pin
 * that order in the source, the same way the Windows publisher's refusals
 * are pinned - because the day this matters is a release day, which is the
 * worst possible day to discover a regression.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'release-ship.js'), 'utf8');
const pkg = require('../package.json');

test('release:ship is wired', () => {
  assert.strictEqual(pkg.scripts['release:ship'], 'node scripts/release-ship.js');
});

test('the version format is gated like the updater parses it', () => {
  /* update-service.js reads the version with parseInt; anything but three
     plain integers classifies every release as a core update and silently
     stops automatic updates. The ship command must refuse at the door. */
  assert.match(src, /\^v\\d\+\\\.\\d\+\\\.\\d\+\$/, 'the vX.Y.Z gate is gone');
});

test('the card is checked before anything irreversible', () => {
  /* A missing card reader found AFTER the tag push leaves a half-release on
     the public tag list. The preflight must find the certificate before the
     first git push. */
  const preflightAt = src.indexOf('find-signing-cert');
  const pushAt = src.indexOf("'push'");
  assert.ok(preflightAt > 0 && pushAt > 0, 'preflight or push missing entirely');
  assert.ok(preflightAt < pushAt, 'the tag is pushed before the card is checked');
});

test('a dirty tree and a wrong branch both refuse', () => {
  assert.match(src, /status.*--porcelain/, 'a dirty tree would ship uncommitted code');
  assert.match(src, /!== 'main'/, 'a release could ship from a feature branch');
});

test('publishing happens only after every platform is verified in the draft', () => {
  const verifyAt = src.indexOf('missing.map');
  const publishAt = src.indexOf('--draft=false');
  assert.ok(verifyAt > 0 && publishAt > 0, 'verify or publish missing entirely');
  assert.ok(verifyAt < publishAt, 'the draft can go public before the asset check');
  /* And the check itself covers the update manifests, not just installers -
     a release with installers but no latest.yml bricks nothing visibly and
     updates nothing silently. */
  for (const manifest of ['latest\\.yml', 'latest-mac\\.yml', 'latest-linux\\.yml']) {
    assert.ok(src.includes(manifest), manifest + ' is not in the required-asset list');
  }
});

test('publish clears the prerelease flag and marks latest', () => {
  /* release.yml publishes drafts as prereleases by default (deliberately -
     electron-updater ignores prereleases, so betas never reach stable
     tills). A STABLE ship must clear that flag or no till ever sees it. */
  assert.match(src, /--prerelease=false/, 'a stable release would stay a prerelease');
  assert.match(src, /--latest/, 'GitHub would keep pointing "latest" at the old release');
});

test('the Windows attach goes through the gated publisher, not a bare upload', () => {
  /* scripts/release-windows.js is where signed/timestamped/latest.yml-match
     refusals live. Uploading around it would skip every one of them. */
  assert.match(src, /release-windows\.js/, 'the gated Windows publisher is bypassed');
  assert.ok(!/gh releaseupload.*exe/.test(src.replace(/\s+/g, '')),
    'a raw exe upload bypasses the signing gates');
});

test('another version left in dist/ can never ride along', () => {
  /* dist/ is where every previous build also landed. Uploading whatever .exe
     was lying there would put the LAST version's binaries on the new
     version's download page - each file individually valid and signed, so
     nothing downstream would catch it. */
  const pub = fs.readFileSync(path.join(ROOT, 'scripts', 'release-windows.js'), 'utf8');
  assert.match(pub, /f\.includes\(version\)/,
    'the publisher no longer filters dist/ down to the tag being released');
  assert.match(pub, /No \$\{version\} installer in dist\//,
    'a dist/ holding only stale builds would report success with nothing uploaded');
  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'release-ship.js'), 'utf8');
  assert.match(ship, /rmSync/, 'the ship command no longer clears stale installers before building');
});

test('stable tills verify update signatures; betas opt out explicitly', () => {
  /* The repo default is the STABLE truth: desk builds are signed, so the
     flag rides every stable installer. The beta workflow builds unsigned
     test builds and must therefore turn it off for itself - a beta till
     that verified would refuse the next unsigned beta and silently stop
     updating. */
  assert.strictEqual(pkg.build.win.verifyUpdateCodeSignature, true,
    'stable builds no longer verify the publisher of their own updates');
  const beta = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'beta.yml'), 'utf8');
  assert.match(beta, /verifyUpdateCodeSignature=false/,
    'beta builds would refuse their own unsigned channel');
  /* And the name the verifier compares against must stay the certificate CN
     (windows-code-signing.test.js pins the value; this pins the pairing). */
  assert.strictEqual(pkg.build.win.signtoolOptions.publisherName, 'BillMax');
});

test('a version bump reaches every file that states the version', () => {
  /* package.json is not the only file naming the release: codemeta.json says
     it twice plus a sentence, CITATION.cff says it again, and the generated
     OpenAPI spec carries it. Three tests assert they agree and CI regenerates
     the docs and fails on any diff - so bumping one file pushes a tag that CI
     refuses a minute later. That is not theory: it is what the first real run
     of release:ship did. */
  const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-version.js'), 'utf8');
  for (const f of ['codemeta.json', 'CITATION.cff', 'api/package.json']) {
    assert.ok(sync.includes(f), `sync-version.js no longer updates ${f}`);
  }
  assert.match(sync, /softwareVersion/, 'codemeta states the version twice; one is missed');
  assert.match(sync, /docs:api/, 'the OpenAPI spec is not regenerated, so CI will reject the tag');

  const ship = fs.readFileSync(path.join(ROOT, 'scripts', 'release-ship.js'), 'utf8');
  const syncAt = ship.indexOf('sync-version.js');
  const commitAt = ship.indexOf("'commit'");
  assert.ok(syncAt > 0, 'the ship command bumps package.json alone again');
  assert.ok(syncAt < commitAt, 'the sync runs after the commit, so the tag misses it');
});

test('every version-bearing file agrees right now', () => {
  /* The check mode, run as a test: this is the assertion CI makes from three
     directions, caught here in one. */
  const { execFileSync } = require('child_process');
  execFileSync('node', [path.join(ROOT, 'scripts', 'sync-version.js'), '--check'],
    { cwd: ROOT, stdio: 'pipe' });
});

test('the snap reaches the release it is built for', () => {
  /* package.json declares a snap target, so every Linux run builds
     posnic_<v>_amd64.snap - and both the artifact upload and the release
     collection filtered it out. publish-snap.yml then failed on every
     release downloading a .snap that was never attached: a red X beside a
     store that was quietly never updated, with the credentials configured
     the whole time. Found on v1.6.1, which is exactly how it had gone
     unnoticed - the release itself succeeds. */
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(wf, /dist\/\*\.snap/, 'the Linux job no longer uploads the snap it built');
  assert.match(wf, /-name '\*\.snap'/, 'the release no longer collects the snap');
  const linuxTargets = JSON.stringify(pkg.build.linux.target);
  assert.match(linuxTargets, /snap/, 'nothing builds a snap, so publishing one cannot work');
});
