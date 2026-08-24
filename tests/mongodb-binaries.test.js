/*
 * The build must not quietly produce an installer with no database in it.
 *
 * MongoDB's server binaries used to be committed, so they were always there and
 * nobody had to think about it. They are not committed any more - 60MB of
 * somebody else's software under the SSPL, making every clone 130MB and this
 * repository a redistributor of a licence that is not its own.
 *
 * The dangerous part of that change is what electron-builder does when an
 * extraResources path is absent: nothing. No warning, no error. The installer is
 * built, it installs, and it fails on a shop's counter the first time it tries
 * to start its database - the worst possible place to find out.
 *
 * So a check runs before every build, and these tests keep the check honest:
 * it has to be wired in, and it has to be asking for the same files the build
 * actually copies.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { REQUIRED } = require('../scripts/check-mongodb-binaries');

/* What electron-builder is told to copy out of mongodb/. */
function packagedBinaries() {
  /* The Windows entry specifically. check-mongodb-binaries.js verifies
     mongod.exe and the three Visual C++ DLLs, none of which exist on the other
     platforms - they get their own extraResources and their own binary. */
  const entry = ((pkg.build.win && pkg.build.win.extraResources) || [])
    .find((r) => r.from === 'mongodb');
  assert.ok(entry, 'the Windows build no longer copies mongodb/ into the installer');

  return (entry.filter || [])
    .filter((f) => !f.startsWith('!'))
    .filter((f) => f.startsWith('bin/'))
    .map((f) => f.slice('bin/'.length));
}

test('the check asks for exactly what the build copies', () => {
  /* If they drift, the check passes while the installer ships incomplete -
     which is the failure this whole arrangement exists to prevent. */
  assert.deepStrictEqual([...REQUIRED].sort(), [...packagedBinaries()].sort());
});

test('the check runs before every build that packages MongoDB', () => {
  const builds = Object.keys(pkg.scripts).filter((k) => /^prebuild/.test(k));
  assert.ok(builds.length >= 3, `only found ${builds.length} prebuild scripts`);

  for (const script of builds) {
    assert.match(pkg.scripts[script], /check:mongodb/,
      `${script} does not check for the MongoDB binaries. electron-builder ` +
      `treats a missing extraResources path as nothing to copy, so the build ` +
      `would succeed and the till would fail.`);
  }
});

test('the binaries are not tracked in git', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^mongodb\/bin\/$/m, 'mongodb/bin/ is not ignored');
  assert.match(ignore, /^nodejs\/$/m, 'nodejs/ is not ignored');
});

test('there is a documented way to get them back', () => {
  const script = path.join(ROOT, 'download-mongodb.bat');
  assert.ok(fs.existsSync(script),
    'download-mongodb.bat is gone, and it is the only way to restore the ' +
    'binaries this repository no longer carries');

  const text = fs.readFileSync(script, 'latin1');
  assert.match(text, /fastdl\.mongodb\.org/,
    'the download script no longer points at MongoDB’s own servers');
});

test('the failure message names the script that fixes it', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'scripts', 'check-mongodb-binaries.js'), 'utf8');
  assert.match(src, /download-mongodb\.bat/,
    'someone hitting this error should be told what to run');
});

test('Electron’s own Node is what runs the API, so no Node is bundled', () => {
  /* nodejs/node.exe was 66MB and reached nothing: it was not in
     extraResources, and the only file that looked for it was
     start-api-server.js, which nothing ever required. main.js loads the API
     with require(), in-process, on the Node inside Electron. */
  const files = JSON.stringify(pkg.build.files);
  const extra = JSON.stringify(pkg.build.extraResources || []);

  assert.ok(!/nodejs/.test(files), 'build.files references nodejs/ again');
  assert.ok(!/nodejs/.test(extra), 'extraResources references nodejs/ again');
  assert.ok(!fs.existsSync(path.join(ROOT, 'nodejs')),
    'nodejs/ is back in the working tree');
});

test('macOS and Linux ship a database too', () => {
  /*
   * They did not. The fetch step was gated on Windows and mongodb-manager.js
   * hardcoded mongod.exe, so both packages contained no database and refused
   * to start - telling the user to run download-mongodb.bat, a batch file, on
   * a Mac. Not degraded: they could not open at all.
   */
  for (const platform of ['mac', 'linux']) {
    const entries = (pkg.build[platform] && pkg.build[platform].extraResources) || [];
    const mongo = entries.find((r) => /mongodb/.test(String(r.from)));
    assert.ok(
      mongo,
      `the ${platform} build packages no database, so it cannot start at all`,
    );
    assert.deepStrictEqual(
      mongo.filter,
      ['bin/mongod'],
      `the ${platform} build should copy the platform binary, not mongod.exe`,
    );
  }
});

test('macOS picks the binary for the architecture it is building', () => {
  /* One runner produces both the Intel and Apple Silicon packages, so a single
     fixed path would put an x86 mongod inside the arm64 build. */
  const mongo = pkg.build.mac.extraResources.find((r) => /mongodb/.test(String(r.from)));
  assert.match(
    mongo.from,
    /\$\{arch\}/,
    'the macOS build copies one fixed mongodb directory, so one of the two ' +
      'architectures would ship the wrong binary',
  );
});

test('the app looks for the right binary name', () => {
  const manager = fs.readFileSync(path.join(ROOT, 'mongodb-manager.js'), 'utf8');
  assert.match(
    manager,
    /process\.platform === 'win32' \? 'mongod\.exe' : 'mongod'/,
    'mongodb-manager.js hardcodes a binary name, so it will look for a Windows ' +
      'executable on macOS and Linux',
  );
});
test('the prebuild check fails only on what a person must fetch', () => {
  /*
   * check:mongodb runs FIRST in the prebuild chain - before prepare:bundle,
   * which is what runs prepare:vc-runtime and copies the three VC runtime DLLs
   * off the machine. Demanding all four here listed three files the build
   * supplies moments later, and told the developer to fix them with
   * download-mongodb.bat.
   *
   * That advice is wrong twice over: those DLLs are not the developer's to
   * fetch, and MongoDB's archive does not contain them anyway - it ships
   * vc_redist.x64.exe, an installer. Somebody following it downloads 600MB,
   * sees the same four names, and cannot tell that three were never the issue.
   */
  const { FETCHED_BY_HAND, SUPPLIED_BY_BUILD, REQUIRED } =
    require('../scripts/check-mongodb-binaries');

  assert.deepStrictEqual(
    FETCHED_BY_HAND,
    ['mongod.exe'],
    'the prebuild gate covers files the build itself produces',
  );
  assert.ok(
    SUPPLIED_BY_BUILD.every((f) => f.endsWith('.dll')),
    'something other than the VC runtime is being deferred to the build',
  );
  assert.deepStrictEqual(
    [...FETCHED_BY_HAND, ...SUPPLIED_BY_BUILD].sort(),
    [...REQUIRED].sort(),
    'the split lost or invented a file - the package would ship incomplete',
  );

  /* The deferred DLLs are still guaranteed - by the step that produces them. */
  const vc = fs.readFileSync(path.join(ROOT, 'scripts', 'bundle-vc-runtime.js'), 'utf8');
  assert.match(
    vc,
    /process\.exit\(1\)/,
    'nothing fails the build when the VC runtime cannot be found - the DLLs are now unguarded',
  );
});
