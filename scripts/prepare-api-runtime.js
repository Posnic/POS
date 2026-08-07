const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'api', 'node_modules');
const outputDir = path.join(rootDir, 'builds', 'api-runtime');
const archivePath = path.join(outputDir, 'node_modules.zip');
const temporaryArchivePath = path.join(outputDir, 'node_modules.next.zip');
const fingerprintPath = path.join(outputDir, 'node_modules.fingerprint.json');
/*
 * 7zip-bin ships a binary per platform and picks the right one itself. This
 * used to hardcode win/x64/7za.exe, which is correct on a developer's machine
 * and wrong on the macOS and Linux release runners - the path simply does not
 * exist there, and this script throws before it packs anything.
 */
const sevenZip = require('7zip-bin').path7za;
const dependencyFiles = [
  path.join(rootDir, 'api', 'package.json'),
  path.join(rootDir, 'api', 'package-lock.json')
];
const forceRebuild = process.argv.includes('--force');

/*
 * Leave out what a running application never opens.
 *
 * Source maps alone were 46 MB of the 196 MB, TypeScript sources another 29,
 * and markdown 8. None of it is ever read by Node at runtime; it was being
 * compressed, shipped, and written to every till's disk for nothing.
 *
 * Only file types are excluded, never directories. An earlier pass also
 * dropped test/, examples/ and docs/ folders and took 583 .js files with it -
 * one MB better, and not worth wondering which package keeps something real
 * in a folder called docs. Every .js and .json file survives this list, which
 * was checked by counting both before and after.
 */
const EXCLUDE = [
  '-xr!*.map',        // source maps: 46 MB, read only by a debugger
  '-xr!*.ts',         // TypeScript sources and .d.ts: 29 MB, we run the .js
  '-xr!*.md',         // 8 MB of documentation
  '-xr!*.flow',
  '-xr!LICENSE', '-xr!LICENCE', '-xr!LICENSE.*', '-xr!LICENCE.*',
  '-xr!CHANGELOG*', '-xr!AUTHORS', '-xr!CONTRIBUTING*',
  '-xr!.github',
];

// -mx=9 rather than -mx=1: this archive is built once and then downloaded by
// every customer, so trading build seconds for megabytes on each install is
// the right way round. Measured 55 MB -> 31 MB with the exclusions above.
const COMPRESSION = '-mx=9';

/*
 * Leave the development tooling behind.
 *
 * The archive used to be the whole of api/node_modules, so eslint, prettier,
 * the docs generator and everything they drag in were downloaded by every shop
 * that installed Posnic and never once used. npm knows exactly which packages
 * the application needs at runtime, so ask it rather than maintaining a list
 * by hand that would be wrong within a month.
 *
 * Only top level entries are excluded. A dev package nested inside a
 * production one is rare and small, and excluding by name recursively could
 * remove a copy something real depends on.
 */
function devOnlyTopLevelDirs() {
  const listed = spawnSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
    cwd: path.join(rootDir, 'api'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  // If npm cannot resolve the tree, ship everything rather than guess wrong and
  // produce an installer that is missing a module.
  if (!listed.stdout || !listed.stdout.trim()) {
    console.warn('  could not resolve the production tree; keeping every package');
    return [];
  }

  const keep = new Set();
  for (const line of listed.stdout.split(/\r?\n/)) {
    const at = line.lastIndexOf(`${path.sep}node_modules${path.sep}`);
    if (at === -1) continue;
    const rel = line.slice(at + `${path.sep}node_modules${path.sep}`.length);
    const parts = rel.split(path.sep);
    keep.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  if (!keep.size) return [];

  const drop = [];
  for (const entry of fs.readdirSync(sourceDir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(sourceDir, entry);
    if (!fs.statSync(full).isDirectory()) continue;

    if (entry.startsWith('@')) {
      // A scope can hold a mix, so each package inside it is judged separately.
      for (const sub of fs.readdirSync(full)) {
        if (!keep.has(`${entry}/${sub}`)) drop.push(`${entry}/${sub}`);
      }
    } else if (!keep.has(entry)) {
      drop.push(entry);
    }
  }
  return drop;
}

// Resolved once: the answer is the same for the whole run, and asking npm is
// not free.
const DEV_DROP = fs.existsSync(sourceDir) ? devOnlyTopLevelDirs() : [];
const DEV_EXCLUDE = DEV_DROP.map((name) => `-x!${name}`);

function createFingerprint() {
  const hash = crypto.createHash('sha256');
  hash.update('posnic-api-runtime-v1');
  hash.update(process.platform);
  hash.update(process.arch);
  hash.update(process.versions.modules || '');

  for (const filePath of dependencyFiles) {
    if (!fs.existsSync(filePath)) throw new Error(`Dependency manifest not found: ${filePath}`);
    hash.update(path.basename(filePath));
    hash.update(fs.readFileSync(filePath));
  }

  // How the archive is built is part of what the archive IS. Fingerprinting
  // only the dependency manifests meant a change to the compression level or
  // the exclusion list left the cache looking valid, so the old archive was
  // reused for ever and the change silently never took effect - which is
  // exactly what happened the first time these two were altered.
  hash.update(COMPRESSION);
  hash.update(EXCLUDE.join('|'));
  // Which packages were left out is part of what the archive is, for the same
  // reason as the two above: change it without changing this and every later
  // build silently reuses an archive that still contains them.
  hash.update(DEV_EXCLUDE.join('|'));
  return hash.digest('hex');
}

function writeFingerprint(fingerprint) {
  const temporaryPath = `${fingerprintPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ fingerprint }, null, 2));
  fs.renameSync(temporaryPath, fingerprintPath);
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`api dependencies not found: ${sourceDir}`);
}
if (!fs.existsSync(sevenZip)) {
  throw new Error(`7-Zip build tool not found: ${sevenZip}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const fingerprint = createFingerprint();

if (!forceRebuild && fs.existsSync(archivePath)) {
  let cachedFingerprint = null;
  try {
    cachedFingerprint = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8')).fingerprint;
  } catch (error) { /* first cached build has no metadata yet */ }

  if (cachedFingerprint === fingerprint) {
    const archiveMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1);
    console.log(`api dependency cache unchanged; reusing node_modules.zip (${archiveMb} MB).`);
    process.exit(0);
  }

  // Safely adopt an archive created by the old build script when it is newer
  // than both dependency manifests. Future builds use the exact fingerprint.
  if (!cachedFingerprint) {
    const archiveMtime = fs.statSync(archivePath).mtimeMs;
    const manifestsAreOlder = dependencyFiles.every(filePath => fs.statSync(filePath).mtimeMs <= archiveMtime);
    if (manifestsAreOlder) {
      writeFingerprint(fingerprint);
      const archiveMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1);
      console.log(`Adopted existing api dependency cache (${archiveMb} MB).`);
      process.exit(0);
    }
  }
}

fs.rmSync(temporaryArchivePath, { force: true });

/*
 * The executable bit, on anything that has one.
 *
 * npm does not reliably preserve the mode when 7zip-bin is unpacked, and a
 * binary that exists but cannot be executed fails in a way that reads like
 * nothing at all: spawnSync returns status null, and the old message reported
 * "7-Zip failed with exit code null" while throwing away result.error, which
 * held the actual reason. Every macOS and Linux release build died here.
 */
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(sevenZip, 0o755);
  } catch (e) {
    console.warn(`  could not make 7-Zip executable: ${e.message}`);
  }
}

console.log('Bundling api dependencies into one installer payload...');
const result = spawnSync(sevenZip, [
  'a', '-tzip', COMPRESSION, '-mtc=off', temporaryArchivePath, '.', ...EXCLUDE, ...DEV_EXCLUDE
], {
  cwd: sourceDir,
  stdio: 'inherit',
  windowsHide: true
});

if (result.status !== 0) {
  fs.rmSync(temporaryArchivePath, { force: true });
  /* result.error carries why the process never started - a missing execute
     bit, the wrong architecture - and status is null in exactly those cases.
     Reporting only the status hid the cause of every failed build here. */
  throw new Error(
    result.error
      ? `7-Zip could not be run (${sevenZip}): ${result.error.message}`
      : `7-Zip failed with exit code ${result.status}`
  );
}

fs.rmSync(archivePath, { force: true });
fs.renameSync(temporaryArchivePath, archivePath);
writeFingerprint(fingerprint);

const archiveMb = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1);
console.log(`Created ${archivePath} (${archiveMb} MB)`);
