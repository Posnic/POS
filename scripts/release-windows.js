'use strict';

/*
 * Publish the Windows release, which is built here rather than in CI.
 *
 * WHY WINDOWS IS SEPARATE
 *
 * The code signing key lives on a Certum card. CA/Browser Forum rules have put
 * code signing keys on certified hardware since June 2023, so there is no .pfx
 * and no secret - and a GitHub-hosted runner has no card reader. Windows
 * therefore cannot be signed in CI at all. macOS and Linux still build there;
 * only this one comes from a desk.
 *
 * WHY IT CANNOT SIMPLY BE UPLOADED OVER THE CI BUILD
 *
 * Three files are derived from the installer's exact bytes, and signing changes
 * those bytes:
 *
 *   latest.yml    sha512 + size, which electron-updater CHECKS before applying
 *                 an update. A mismatch does not warn - the update just never
 *                 installs, on every till already in the field.
 *   *.blockmap    block hashes for delta updates.
 *   SHA256SUMS.txt what the release notes tell people to verify by hand.
 *
 * So the installer and its metadata have to travel together, from the same
 * build. That is what this does.
 *
 * WHAT IT REFUSES TO DO
 *
 * Publish anything unsigned or untimestamped, or whose latest.yml does not
 * describe the file being uploaded. Signing is opt-in in this repo - a build
 * with POSNIC_SIGN_SHA1 unset succeeds and produces an unsigned installer - so
 * without a gate here the easiest way to ship "Unknown publisher" to every
 * customer is to forget one environment variable.
 *
 *   npm run build                      # with POSNIC_SIGN_SHA1 set
 *   npm run release:windows -- v1.4.0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    cwd: ROOT,
    ...opts,
  });
}

function tryRun(cmd, args, opts = {}) {
  try {
    return { ok: true, out: run(cmd, args, opts) };
  } catch (err) {
    return { ok: false, out: String((err.stdout || '') + (err.stderr || '')) };
  }
}

function findSignTool() {
  if (process.env.POSNIC_SIGNTOOL) return process.env.POSNIC_SIGNTOOL;
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const arch of ['x64', '']) {
        const c = path.join(root, entry, arch, 'signtool.exe');
        if (fs.existsSync(c)) found.push({ v: entry, c });
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => {
    const pa = a.v.split('.').map(Number);
    const pb = b.v.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d;
    }
    return 0;
  });
  return found[0].c;
}

const sha512b64 = (file) =>
  crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const sha256hex = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/*
 * latest.yml is small and fixed in shape, so it is read with two regexes
 * rather than by adding a YAML parser to the dependency list for one file.
 * Both fields are required: a path with no hash would pass a check that only
 * looked for the hash it did not find.
 */
function readLatestYml(file) {
  const text = fs.readFileSync(file, 'utf8');
  const p = text.match(/^path:\s*(.+)$/m);
  const h = text.match(/^sha512:\s*(.+)$/m);
  if (!p || !h) return null;
  return { path: p[1].trim(), sha512: h[1].trim() };
}

function fail(message) {
  console.error('');
  console.error('  ' + message);
  console.error('');
  process.exit(1);
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    fail('Usage: npm run release:windows -- <tag>   e.g. v1.4.0');
  }

  if (!fs.existsSync(DIST)) {
    fail('No dist/ - run `npm run build` first, with POSNIC_SIGN_SHA1 set.');
  }

  const installers = fs
    .readdirSync(DIST)
    .filter((f) => f.endsWith('.exe'))
    .map((f) => path.join(DIST, f));
  if (!installers.length) {
    fail('No .exe in dist/ - run `npm run build` first.');
  }

  const signtool = findSignTool();
  if (!signtool) fail('signtool.exe not found - install the Windows SDK.');

  console.log('');
  console.log(`  Publishing Windows build to ${tag}`);
  console.log('');

  /* ---- every installer must be signed AND timestamped ---- */
  for (const exe of installers) {
    const res = tryRun(signtool, ['verify', '/pa', '/v', exe]);
    const timestamped = /timestamp/i.test(res.out);
    console.log(`  ${path.basename(exe)}`);
    console.log(`    signature   ${res.ok ? 'valid' : 'MISSING'}`);
    console.log(`    timestamp   ${timestamped ? 'present' : 'ABSENT'}`);

    if (!res.ok) {
      fail(
        'Refusing to publish an unsigned installer.\n' +
          '  POSNIC_SIGN_SHA1 was probably unset for this build - run\n' +
          '  `npm run sign:cert`, export it, and rebuild.'
      );
    }
    if (!timestamped) {
      fail(
        'Refusing to publish a signature with no timestamp.\n' +
          '  It would stop validating the day the certificate expires, on every\n' +
          '  copy already installed.'
      );
    }
  }

  /* ---- latest.yml must describe the file actually being uploaded ---- */
  const latest = path.join(DIST, 'latest.yml');
  if (!fs.existsSync(latest)) {
    fail('dist/latest.yml is missing - electron-updater cannot update without it.');
  }
  const meta = readLatestYml(latest);
  if (!meta) fail('dist/latest.yml has no path/sha512 - it cannot be trusted.');

  const described = path.join(DIST, meta.path);
  if (!fs.existsSync(described)) {
    fail(`latest.yml names ${meta.path}, which is not in dist/.`);
  }
  const actual = sha512b64(described);
  if (actual !== meta.sha512) {
    fail(
      'latest.yml does not match the installer.\n' +
        `  It describes a different build of ${meta.path}.\n` +
        '  Auto-update would reject the download SILENTLY on every till.\n' +
        '  Rebuild so the installer and its manifest come from one run.'
    );
  }
  console.log(`\n  latest.yml matches ${meta.path}`);

  /* ---- upload ---- */
  const uploads = fs
    .readdirSync(DIST)
    .filter((f) => /\.(exe|blockmap)$/.test(f) || /^latest.*\.yml$/.test(f))
    .map((f) => path.join(DIST, f));

  console.log('\n  uploading:');
  for (const f of uploads) console.log(`    ${path.basename(f)}`);

  const up = tryRun('gh', ['release', 'upload', tag, ...uploads, '--clobber']);
  if (!up.ok) {
    fail('Upload failed:\n  ' + up.out.trim());
  }
  console.log('    done');

  /* ---- merge the Windows lines into SHA256SUMS.txt ----
     CI writes that file from the mac and linux artefacts it built. Appending
     rather than replacing is the point: replacing it would drop the checksums
     for the platforms this machine never built. */
  const tmp = path.join(DIST, 'SHA256SUMS.txt');
  const got = tryRun('gh', ['release', 'download', tag, '-p', 'SHA256SUMS.txt', '-D', DIST, '--clobber']);
  const existing = got.ok && fs.existsSync(tmp) ? fs.readFileSync(tmp, 'utf8') : '';
  if (!got.ok) {
    console.log('\n  no SHA256SUMS.txt on the release yet - writing a new one');
  }

  const keep = existing
    .split('\n')
    .filter((l) => l.trim() && !/\.exe\s*$/.test(l.trim()));
  for (const exe of installers) {
    keep.push(`${sha256hex(exe)}  ${path.basename(exe)}`);
  }
  fs.writeFileSync(tmp, keep.sort().join('\n') + '\n');

  const sums = tryRun('gh', ['release', 'upload', tag, tmp, '--clobber']);
  if (!sums.ok) fail('Could not upload SHA256SUMS.txt:\n  ' + sums.out.trim());
  console.log('  SHA256SUMS.txt updated with the Windows entries');

  console.log(`\n  Windows published to ${tag}, signed and timestamped.\n`);
}

main();
