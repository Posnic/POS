/*
 * Test builds, and who is allowed to receive them.
 *
 * There was no way to try a build before it became everybody's build. A
 * release was cut from a tag and went to every till, so the only testing a
 * change got before reaching shops was whatever happened on one developer
 * machine.
 *
 * The mechanism is deliberately the smallest one that works: builds from main
 * are published as GitHub pre-releases, and `allowPrerelease` decides whether
 * an installation can see them at all. Not "sees them and declines" - an
 * installation on stable never learns a pre-release exists. So the line
 * between a tester and a shop is held by the updater rather than by anyone
 * remembering which build went where.
 *
 * The rule that matters, and the one worth a test: a shop that never opens the
 * Updates screen must never be given a test build.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const SERVICE = read('src/update-service.js');
const UI = read('src/update-manager.html');

test('stable is what you get by not choosing', () => {
  const defaults = SERVICE.slice(SERVICE.indexOf('loadConfig()'));
  const body = defaults.slice(0, defaults.indexOf('saveConfig'));

  assert.match(
    body,
    /channel:\s*'stable'/,
    "the default channel is not stable, so an installation with no stored " +
      'config could be offered test builds',
  );
});

test('and an unreadable config cannot promote a machine to test builds', () => {
  /* loadConfig returns the defaults when the file is missing or corrupt, but
     allowPrerelease is also set explicitly at configure time so that the
     failure mode is stable-only rather than whatever electron-updater last
     had. */
  const configure = SERVICE.slice(SERVICE.indexOf('_configure()'));
  assert.match(
    configure.slice(0, configure.indexOf('_applyChannel()')),
    /allowPrerelease\s*=\s*false/,
    'allowPrerelease is not forced to false before the stored channel is read',
  );
});

test('choosing the channel actually changes what the updater offers', () => {
  /* Stored and not applied, the screen would say "Test builds" while the
     updater carried on offering stable ones until the next restart - a setting
     that is believed and ignored. */
  assert.match(SERVICE, /_applyChannel\(/, 'there is no channel application at all');

  const save = SERVICE.slice(SERVICE.indexOf('saveConfig(patch)'));
  assert.match(
    save.slice(0, save.indexOf('catch')),
    /_applyChannel/,
    'saving the channel does not apply it, so it takes effect only after a restart',
  );

  const apply = SERVICE.slice(SERVICE.indexOf('_applyChannel(config)'));
  assert.match(
    apply.slice(0, 700),
    /allowPrerelease\s*=\s*beta/,
    'the channel does not drive allowPrerelease, which is the only thing that ' +
      'decides whether a pre-release is visible',
  );
});

test('the screen says that leaving the test channel does not undo an update', () => {
  /*
   * electron-updater only moves forwards. A tester on 2.1.0-beta.4 who selects
   * stable stays on the beta build until a stable release passes it, and the
   * only way back sooner is a reinstall.
   *
   * That is the one consequence a tester cannot undo from this screen, so it
   * is stated before they choose rather than discovered afterwards.
   */
  assert.match(
    UI,
    /does not undo|only moves forwards|stays on the test build/i,
    'the channel selector does not warn that switching back leaves the ' +
      'machine on the test build',
  );
});

test('the release page a shop is sent to is reachable', () => {
  /*
   * preload.js exposes two bridges: `update` is on window.electron and
   * `desktop` is on window.electronAPI. window.electron.desktop.open threw a
   * TypeError before any IPC happened, and the catch reported "Could not open
   * the releases page" - which reads as the link being down.
   *
   * This is the one route out of the application offered to a shop that needs
   * to reinstall an earlier version. That is to say, the one route offered to
   * a shop whose till is already broken.
   */
  const fn = UI.slice(UI.indexOf('function openReleases'));
  const body = fn.slice(0, fn.indexOf('\n    }'));

  assert.match(
    body,
    /window\.electronAPI\s*&&\s*window\.electronAPI\.desktop/,
    'openReleases does not reach for the bridge that actually carries desktop',
  );
  assert.doesNotMatch(
    body,
    /^\s*window\.electron\.desktop\.open/m,
    'openReleases calls desktop on window.electron, where it does not exist',
  );
});

test('the shared CI workflow does not cancel its own callers', () => {
  /*
   * ci.yml runs on its own and is also called by release.yml and beta.yml, so
   * a tag or a test build is gated on exactly what a pull request meets.
   *
   * A called workflow keeps the caller's ref. With `ci-${{ github.ref }}` as
   * the concurrency group, the standalone run and the called one landed in the
   * same group with cancel-in-progress - so pushing to main killed CI four
   * seconds in, every time, and whichever started second was the only one that
   * survived. Nothing failed; a run just disappeared.
   */
  const CI = read('.github/workflows/ci.yml');
  const block = CI.slice(CI.indexOf('concurrency:'));
  const group = block.slice(0, block.indexOf('cancel-in-progress'));

  assert.match(
    group,
    /github\.workflow/,
    'the CI concurrency group does not include the caller, so a workflow that ' +
      'calls ci.yml and the push that triggered ci.yml directly cancel each other',
  );
  assert.match(group, /github\.ref/, 'the group no longer distinguishes branches');
});

test('a test build is never published as a normal release', () => {
  /* This flag is the only thing standing between a build from main and every
     installed till, which is why it is a literal here rather than a repository
     variable that could be set wrong once and quietly stay that way. */
  const BETA = read('.github/workflows/beta.yml');
  assert.match(BETA, /prerelease:\s*true/, 'beta.yml does not force a pre-release');
  assert.doesNotMatch(
    BETA,
    /prerelease:\s*\$\{\{/,
    'the pre-release flag is read from a variable, so one wrong setting would ' +
      'push a build from main to every shop',
  );
});

test('the preload bridges have not silently diverged again', () => {
  /*
   * `electron` is a subset of `electronAPI`. Nothing enforces that, and the
   * names are close enough that the wrong one is easy to reach for - which is
   * exactly what happened. This does not demand they be identical; it demands
   * that anything a page calls on window.electron is actually on it.
   */
  const PRELOAD = read('src/preload.js');
  const keysOf = (name) => {
    const i = PRELOAD.indexOf(`exposeInMainWorld('${name}'`);
    if (i < 0) return [];
    const rest = PRELOAD.slice(i + 1);
    const next = rest.indexOf('exposeInMainWorld(');
    const chunk = next > -1 ? rest.slice(0, next) : rest;
    return [...new Set((chunk.match(/^ {2}([a-zA-Z_]\w*)\s*:/gm) || [])
      .map((m) => m.trim().replace(':', '')))];
  };

  const onElectron = new Set(keysOf('electron'));
  assert.ok(onElectron.size > 0, 'the electron bridge exposes nothing');

  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of html.matchAll(/(?<!\.)\bwindow\.electron\.([a-zA-Z_]\w*)/g)) {
      /* The fallback in openReleases names it deliberately, guarded by a
         truthiness check, so it is not a call. */
      if (m[1] === 'desktop' && /&&\s*window\.electron\.desktop/.test(html)) continue;
      assert.ok(
        onElectron.has(m[1]),
        `${file} calls window.electron.${m[1]}, which is only on window.electronAPI`,
      );
    }
  }
});
