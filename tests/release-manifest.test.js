/*
 * The file without which auto-update does not work at all.
 *
 * electron-updater asks GitHub for latest.yml - latest-mac.yml, latest-linux.yml
 * on the others - to learn what the newest version is and where to fetch it.
 * electron-builder writes it into dist/ on every build.
 *
 * The release workflow collected only installers: *.exe, *.dmg, *.zip,
 * *.AppImage, *.deb. So the manifest was built and thrown away, every update
 * check 404'd, and the Updates screen reported that it could not reach the
 * update server - which reads as a network problem rather than a missing file.
 *
 * Nothing catches this except looking, because the release succeeds: all the
 * installers are there, the checksums are right, and the one file that makes
 * them reachable is absent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE = fs
  .readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
  .replace(/\r\n/g, '\n');

test('the build uploads the update manifest', () => {
  const upload = RELEASE.slice(RELEASE.indexOf('Upload installers'));
  const body = upload.slice(0, upload.indexOf('retention-days'));

  assert.match(
    body,
    /latest\*?\.yml/,
    'the build artifact does not include latest.yml, so it never reaches the ' +
      'release and electron-updater has nothing to read',
  );
});

test('and the release keeps it', () => {
  const collect = RELEASE.slice(RELEASE.indexOf('Collect and checksum'));
  const body = collect.slice(0, collect.indexOf('Publishing:'));

  assert.match(body, /latest\*?\.yml/, 'the collect step drops the update manifest');
  assert.match(
    body,
    /blockmap/,
    'blockmaps are dropped, so every update downloads the whole installer ' +
      'instead of only the changed parts',
  );
});

test('the checksum file lists downloads, not plumbing', () => {
  /* SHA256SUMS.txt is what the release notes tell a shop to check. A manifest
     that carries its own hashes, and a blockmap nobody downloads by hand, would
     only make that list harder to read. */
  const collect = RELEASE.slice(RELEASE.indexOf('Collect and checksum'));
  const body = collect.slice(0, collect.indexOf('Publishing:'));

  assert.match(body, /sha256sum/, 'nothing writes SHA256SUMS.txt');
  assert.match(
    body,
    /grep -vE[^\n]*latest[^\n]*blockmap/,
    'the checksum list is not filtered, so it includes the update manifest and ' +
      'the blockmaps alongside the files people actually download',
  );
});

test('whether a release is offered to installed copies is a decision, not a constant', () => {
  /*
   * prerelease was hardcoded true, which is right while the installers are
   * unsigned - allowPrerelease is false, so nothing is pushed a beta.
   *
   * It also makes the update path impossible to verify: an installed build
   * ignores every pre-release, so there is never anything to update to. The
   * flag has to be settable for the release that proves updates work.
   */
  assert.match(
    RELEASE,
    /prerelease: \$\{\{ vars\.POSNIC_PRERELEASE/,
    'prerelease is hardcoded, so either every release is a beta nobody is ' +
      'offered, or every release is pushed to everyone',
  );
  assert.match(
    RELEASE,
    /vars\.POSNIC_PRERELEASE != 'no'/,
    "the default must be a pre-release - an unset variable should not publish " +
      'an unsigned build to every installed till',
  );
});

test('the updater still refuses pre-releases', () => {
  /* If this ever flips, the pre-release flag stops protecting anyone: every
     beta would be offered to every shop automatically. */
  const service = fs.readFileSync(path.join(ROOT, 'src', 'update-service.js'), 'utf8');
  assert.match(
    service,
    /allowPrerelease\s*=\s*false/,
    'allowPrerelease is no longer false, so marking a release as a pre-release ' +
      'no longer stops it being pushed to shops',
  );
});

test('every release ships the machine-readable release manifest', () => {
  /* release-manifest.json (SEAMLESS_UPDATE_ROADMAP U1): version, channel,
     schema + sync-protocol, oldest supported client - generated, not typed. */
  const collect = RELEASE.slice(RELEASE.indexOf('Collect and checksum'));
  const body = collect.slice(0, collect.indexOf('Publishing:'));
  assert.match(
    body,
    /release-manifest\.js release\/release-manifest\.json/,
    'the collect step does not generate release-manifest.json, so releases ' +
      'carry no machine-readable statement of what they are',
  );
});

test('the release manifest carries the update-contract fields', () => {
  const os = require('os');
  const { execFileSync } = require('child_process');
  const out = path.join(os.tmpdir(), `posnic-release-manifest-${process.pid}.json`);
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'release-manifest.js'), out],
    { env: { ...process.env, POSNIC_PRERELEASE: 'no' } },
  );
  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.unlinkSync(out);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must be the plain root semver');
  assert.strictEqual(manifest.channel, 'stable', 'POSNIC_PRERELEASE=no must mean the stable channel');
  assert.strictEqual(typeof manifest.apiSchema, 'number');
  assert.strictEqual(typeof manifest.syncProtocol, 'number');
  assert.match(manifest.minClientVersion, /^\d+\.\d+\.\d+$/);
});
