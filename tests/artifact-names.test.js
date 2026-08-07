/*
 * What the download page calls each file.
 *
 * The first beta shipped `Posnic-Setup-2.0.0.exe` next to `Posnic 2.0.0.exe`,
 * both 159 MB. One installs and one runs from a stick, and nothing in either
 * name said which. `Posnic-2.0.0.dmg` was the Intel build sitting beside
 * `Posnic-2.0.0-arm64.dmg`, so the Intel one was identified only by what it did
 * not say.
 *
 * A shop picking a file should not have to guess, and should not have to
 * download 375 MB to find out it was the wrong one. Every name now carries the
 * platform, the architecture, and what kind of thing it is.
 */

const test = require('node:test');
const assert = require('node:assert');

const build = require('../package.json').build;

/* deb is exempt: Debian tooling and users both expect name_version_arch.deb,
   and that convention already carries the architecture. */
const TARGETS = ['nsis', 'portable', 'dmg', 'mac', 'appImage'];

test('every artifact name says which platform it is for', () => {
  for (const target of TARGETS) {
    const name = build[target] && build[target].artifactName;
    assert.ok(name, `${target} has no artifactName, so it falls back to a default that may be ambiguous`);
    assert.match(
      name,
      /windows|macos|linux/,
      `${target} artifactName "${name}" does not name a platform`,
    );
  }
});

test('and which architecture', () => {
  for (const target of TARGETS) {
    const name = build[target].artifactName;
    assert.match(
      name,
      /\$\{arch\}|x64|arm64/,
      `${target} artifactName "${name}" does not carry an architecture. The ` +
        'Intel mac build was identified only by not saying arm64, which is not ' +
        'something a shop should have to notice.',
    );
  }
});

test('the two Windows builds say which is which', () => {
  /* They are the same size and both end in .exe. Without the word, the only
     way to tell them apart is to run one. */
  assert.match(build.nsis.artifactName, /installer/, 'the Windows installer does not say so');
  assert.match(build.portable.artifactName, /portable/, 'the portable build does not say so');
  assert.notStrictEqual(
    build.nsis.artifactName,
    build.portable.artifactName,
    'both Windows targets produce the same filename',
  );
});

test('the version is in every name', () => {
  /* A file that has been sitting in Downloads for six months should still say
     what it is. */
  for (const target of [...TARGETS, 'deb']) {
    assert.match(
      build[target].artifactName,
      /\$\{version\}/,
      `${target} artifactName omits the version`,
    );
  }
});

test('no name contains a space', () => {
  /* "Posnic 2.0.0.exe" needed quoting in every command anyone wrote about it,
     and wrapped badly in the release list. */
  for (const target of [...TARGETS, 'deb']) {
    assert.doesNotMatch(
      build[target].artifactName,
      / /,
      `${target} artifactName contains a space`,
    );
  }
});
