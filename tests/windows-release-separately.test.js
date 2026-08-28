const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Windows is built and published from a desk, not from CI.
 *
 * Its code signing key lives on a Certum card. CA/Browser Forum rules have put
 * code signing keys on certified hardware since June 2023, so there is no .pfx
 * and no secret - and a GitHub-hosted runner has no card reader. A Windows
 * build produced in CI could only ever be UNSIGNED, which is worse than no
 * build at all: it looks finished and tells every customer the publisher is
 * unknown.
 *
 * The risk this file guards is not the pipeline breaking. It is the pipeline
 * working perfectly and shipping the wrong bytes - an unsigned installer, or a
 * signed one whose latest.yml describes a different build. Neither announces
 * itself; the second one stops auto-update on every till in the field without
 * a single error anywhere.
 */

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const pkg = require('../package.json');
const workflow = read('.github/workflows/release.yml');
const publisher = read('scripts/release-windows.js');

test('CI does not build Windows', () => {
  /* An unsigned Windows installer reaching a release is the failure this
     whole arrangement exists to prevent. */
  assert.ok(
    !/os:\s*windows-latest/.test(workflow),
    'CI builds Windows again - it has no card reader, so that installer can only be unsigned',
  );
  for (const os of ['macos-latest', 'ubuntu-latest']) {
    assert.match(workflow, new RegExp(`os:\\s*${os}`), `${os} is no longer built in CI`);
  }
  /* And the absence has to be explained where somebody would add it back. */
  assert.match(
    workflow,
    /WINDOWS IS NOT BUILT HERE/,
    'nothing says why Windows is missing, so the next person will helpfully restore it',
  );
});

test('no step is left conditioned on a platform the matrix no longer has', () => {
  /* `if: matrix.name == 'Windows'` against a matrix with no Windows is a step
     that never runs. It reads as coverage and is not - which is worse than
     having deleted it. */
  /* YAML comments stripped first. The note explaining why the step was removed
     quotes the very condition it removed, so matching the raw file found the
     prose and failed - the third time that shape has bitten in this session. */
  const code = workflow
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('#'))
    .join(String.fromCharCode(10));
  assert.ok(
    !/if:\s*matrix\.name\s*==\s*'Windows'/.test(code),
    'a Windows-only step survives in a workflow that no longer builds Windows',
  );
});

test('the publisher refuses anything unsigned or untimestamped', () => {
  /* Signing is opt-in in this repo: a build with POSNIC_SIGN_SHA1 unset
     succeeds and produces an unsigned installer. Without a gate here, the
     easiest way to ship "Unknown publisher" to every customer is to forget one
     environment variable. */
  assert.match(publisher, /Refusing to publish an unsigned installer/, 'unsigned builds can be published');
  assert.match(
    publisher,
    /Refusing to publish a signature with no timestamp/,
    'an untimestamped signature can be published - it dies with the certificate',
  );
  assert.match(publisher, /'verify', '\/pa'/, 'it does not verify under the policy Windows itself applies');

  /* Both refusals must actually stop the process. */
  const fail = publisher.slice(publisher.indexOf('function fail('));
  assert.match(fail.slice(0, 300), /process\.exit\(1\)/, 'fail() does not exit, so publishing continues');
});

test('latest.yml is checked against the installer being uploaded', () => {
  /*
   * The subtle one. electron-updater reads latest.yml to learn the newest
   * version and VERIFIES the sha512 before applying an update. Signing changes
   * the installer's bytes, so a manifest from a different build does not warn -
   * the update simply never installs, on every till already in the field.
   */
  assert.match(publisher, /sha512/, 'the manifest hash is never read');
  assert.match(publisher, /createHash\('sha512'\)/, 'the installer is never hashed to compare');
  assert.match(
    publisher,
    /latest\.yml does not match the installer/,
    'a mismatched manifest is uploaded without complaint',
  );
  assert.match(
    publisher,
    /SILENTLY/,
    'the consequence of a mismatch is not stated where somebody would read it',
  );
});

test('the Windows checksums are merged, not substituted', () => {
  /* SHA256SUMS.txt is written in CI from the macOS and Linux artefacts.
     Replacing it wholesale would drop the checksums for the two platforms this
     machine never built. */
  assert.match(publisher, /SHA256SUMS\.txt/, 'the checksum file is not updated at all');
  assert.match(publisher, /release', 'download'/, 'it never fetches the existing file, so it can only overwrite');
  const merge = publisher.slice(publisher.indexOf('const keep ='));
  assert.match(merge.slice(0, 400), /filter/, 'existing entries are not preserved');
});

test('release:windows is wired, and the release notes tell the truth', () => {
  assert.strictEqual(pkg.scripts['release:windows'], 'node scripts/release-windows.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'release-windows.js')));

  /* The notes have tracked the truth through three eras: "certificate on the
     way", then "Windows signed, macOS not yet", and now - with the Developer
     ID certificate live and the notary gate proven on a real dmg - every
     platform carries a trust chain and the notes say exactly which one. */
  assert.ok(
    !/The installers are not signed yet/.test(workflow),
    'the notes still tell Windows users to expect an unknown-publisher warning',
  );
  assert.ok(
    !/macOS is not signed yet/.test(workflow),
    'the notes still say macOS is unsigned - the notarize gate made that untrue',
  );
  assert.match(workflow, /signed and notarized/,
    'the notes no longer state the macOS trust chain');
  assert.match(workflow, /packages\.posnic\.com/,
    'the notes no longer point Linux users at the signed APT repository');
});
