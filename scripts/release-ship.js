'use strict';

/*
 * The whole release, one command from the desk:
 *
 *   npm run release:ship -- v1.6.0            # prepare everything, ask before publishing
 *   npm run release:ship -- v1.6.0 --yes      # publish without the final question
 *
 * What it does, in order:
 *
 *   1. preflight   clean tree on main, gh authenticated, Certum card present
 *   2. bump        package.json -> X.Y.Z, commit, tag vX.Y.Z, push both
 *   3. CI          the tag push runs release.yml: full CI, signed+notarized
 *                  macOS, Linux, draft release with checksums + attestation
 *   4. Windows     built and signed HERE while CI runs - the Certum key lives
 *                  on a card (CA/B rules since June 2023), so no CI runner can
 *                  ever sign it; the card PIN prompt is the one human moment
 *   5. attach      npm run release:windows gates (signed, timestamped,
 *                  latest.yml byte-match) and uploads into the same draft
 *   6. verify      the draft must hold every platform before anyone sees it
 *   7. publish     draft -> public. That single event fans out on its own:
 *                  publish-apt.yml fills packages.posnic.com, publish-snap.yml
 *                  pushes to the Snap Store (once credentials exist), and
 *                  notify-site-of-release.yml tells the website.
 *
 * Every step is idempotent, so a failed run is re-run with the same command
 * and continues where it stopped: an existing tag is not re-tagged, an
 * existing dist/ is not rebuilt unless --rebuild, uploaded assets are
 * clobbered in place.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, cwd: ROOT, ...opts });
}
function tryRun(cmd, args, opts = {}) {
  try { return { ok: true, out: run(cmd, args, opts) }; }
  catch (err) { return { ok: false, out: String((err.stdout || '') + (err.stderr || '')) }; }
}
/* Streams to the terminal - the build and the CI wait are long, and a silent
   console for ten minutes reads as a hang. */
function runLive(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
  return r.status === 0;
}
function fail(msg) {
  console.error('\n  ' + msg + '\n');
  process.exit(1);
}
function step(title) {
  console.log('\n== ' + title + ' ' + '='.repeat(Math.max(1, 60 - title.length)));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question + ' [y/N] ', res));
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

async function main() {
  const argv = process.argv.slice(2);
  const tag = argv.find((a) => !a.startsWith('--'));
  const YES = argv.includes('--yes');
  const REBUILD = argv.includes('--rebuild');
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail('Usage: npm run release:ship -- vX.Y.Z [--yes] [--rebuild]\n'
      + '  Three plain integers only - update-service.js parses the version with\n'
      + '  parseInt, and anything fancier silently stops every till updating.');
  }
  const version = tag.slice(1);

  step('Preflight');
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') fail(`Releases ship from main; this is ${branch}.`);
  if (run('git', ['status', '--porcelain']).trim()) {
    fail('The working tree is not clean - commit or stash first.');
  }
  if (!tryRun('gh', ['auth', 'status']).ok) fail('gh is not authenticated - run `gh auth login`.');

  /* The card, before anything irreversible: a missing reader discovered after
     the tag is pushed leaves a half-release; discovered now it costs nothing. */
  let sha1 = process.env.POSNIC_SIGN_SHA1 || '';
  if (!sha1) {
    const cert = tryRun('node', ['scripts/find-signing-cert.js']);
    const m = cert.out.match(/Thumbprint\s+([0-9A-Fa-f]{40})/);
    if (!m) {
      fail('No signing certificate found - is the Certum card in the reader?\n'
        + '  (or set POSNIC_SIGN_SHA1 yourself)');
    }
    sha1 = m[1];
    console.log('  signing certificate found: ' + sha1);
  }

  step('Version ' + tag);
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const tagExists = tryRun('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag]).ok;
  if (pkg.version === version && tagExists) {
    console.log('  already at ' + version + ' with the tag cut - resuming');
  } else {
    if (tagExists) fail(`Tag ${tag} exists but package.json says ${pkg.version} - untangle by hand.`);
    /* String surgery, not JSON.stringify: rewriting the whole file would
       reorder nothing but reformat everything, and this diff should be one
       line in a release commit someone will actually read. */
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const bumped = raw.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
    if (bumped === raw) fail('Could not find the version field in package.json.');
    fs.writeFileSync(pkgPath, bumped);
    if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version !== version) {
      fail('The version bump did not take - package.json left untouched otherwise.');
    }
    run('git', ['add', 'package.json']);
    run('git', ['commit', '-m', tag]);
    run('git', ['tag', tag]);
    run('git', ['push', 'origin', 'main']);
    run('git', ['push', 'origin', tag]);
    console.log('  committed, tagged and pushed - CI is building macOS and Linux now');
  }

  step('Windows build (signed on this machine)');
  const haveInstaller = fs.existsSync(DIST)
    && fs.readdirSync(DIST).some((f) => f.endsWith('.exe') && f.includes(version));
  if (haveInstaller && !REBUILD) {
    console.log('  dist/ already holds a ' + version + ' installer - keeping it (--rebuild to redo)');
  } else {
    /* Previous releases left their installers here. The publisher refuses to
       upload another version's bytes now, but clearing them first keeps the
       build output unambiguous - and stops a half-built run from looking
       finished to the resume check above. */
    if (fs.existsSync(DIST)) {
      for (const f of fs.readdirSync(DIST)) {
        if (/\.(exe|blockmap)$/.test(f) || /^latest.*\.yml$/.test(f)) {
          fs.rmSync(path.join(DIST, f), { force: true });
        }
      }
    }
    console.log('  card PIN prompts may appear - this is the one human moment\n');
    if (!runLive('npm', ['run', 'build'], { env: { ...process.env, POSNIC_SIGN_SHA1: sha1 }, shell: true })) {
      fail('The Windows build failed - fix and re-run the same command to resume.');
    }
  }

  step('Waiting for CI (signed macOS + Linux + draft release)');
  const deadline = Date.now() + 90 * 60 * 1000;
  let ciDone = false;
  while (Date.now() < deadline) {
    const q = tryRun('gh', ['run', 'list', '--workflow', 'release.yml',
      '--json', 'status,conclusion,headBranch,databaseId', '--limit', '10']);
    if (q.ok) {
      let runs = [];
      try { runs = JSON.parse(q.out); } catch (e) { runs = []; }
      const mine = runs.filter((r) => r.headBranch === tag);
      if (mine.length && mine.every((r) => r.status === 'completed')) {
        if (mine.some((r) => r.conclusion === 'success')) { ciDone = true; break; }
        fail('The release workflow for ' + tag + ' failed - open the run, fix, then\n'
          + '  `gh workflow run release.yml -f tag=' + tag + '` and re-run this command.');
      }
      const state = mine.length ? mine[0].status : 'not started yet';
      process.stdout.write('  CI: ' + state + '                    \r');
    }
    await sleep(30000);
  }
  if (!ciDone) fail('CI did not finish within 90 minutes - check the Actions page and resume.');
  console.log('\n  CI is green - the draft release holds macOS and Linux');

  step('Attaching the signed Windows build');
  if (!runLive('node', ['scripts/release-windows.js', tag])) {
    fail('The Windows publisher refused - its message above says why.');
  }

  step('Verifying the draft holds every platform');
  const view = tryRun('gh', ['release', 'view', tag, '--json', 'assets,isDraft']);
  if (!view.ok) fail('Could not read the release: ' + view.out.trim());
  const rel = JSON.parse(view.out);
  const names = (rel.assets || []).map((a) => a.name);
  const need = [
    [/windows.*installer\.exe$/, 'Windows installer'],
    [/macos-arm64\.dmg$/, 'macOS arm64 dmg'],
    [/macos-x64\.dmg$/, 'macOS x64 dmg'],
    [/\.AppImage$/, 'Linux AppImage'],
    [/_amd64\.deb$/, 'Debian package'],
    [/^latest\.yml$/, 'Windows update manifest'],
    [/^latest-mac\.yml$/, 'macOS update manifest'],
    [/^latest-linux\.yml$/, 'Linux update manifest'],
    [/^SHA256SUMS\.txt$/, 'checksums'],
  ];
  const missing = need.filter(([re]) => !names.some((n) => re.test(n)));
  if (missing.length) {
    fail('The draft is missing: ' + missing.map(([, l]) => l).join(', ') + '\n'
      + '  Nothing was published.');
  }
  console.log('  all ' + need.length + ' required artifacts present (' + names.length + ' assets total)');

  step('Publish');
  if (!rel.isDraft) {
    console.log('  already public - nothing left to do');
    return;
  }
  if (!YES) {
    const go = await confirm('  Make ' + tag + ' public? This starts the APT repo, Snap and website updates.');
    if (!go) {
      console.log('\n  Left as a draft. Publish later with:\n'
        + '    gh release edit ' + tag + ' --draft=false --prerelease=false --latest\n');
      return;
    }
  }
  const pub = tryRun('gh', ['release', 'edit', tag, '--draft=false', '--prerelease=false', '--latest']);
  if (!pub.ok) fail('Publishing failed: ' + pub.out.trim());
  console.log('\n  ' + tag + ' is PUBLIC.');
  console.log('  Now running on their own: packages.posnic.com (APT), Snap Store');
  console.log('  (when credentials exist), and the website release notice.');
  console.log('  Tills in the field pick it up through latest*.yml - silently, next close.\n');
}

main().catch((e) => fail(String(e && e.message || e)));
