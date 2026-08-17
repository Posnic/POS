'use strict';
/*
 * The network half of the asset-update channel (SEAMLESS_UPDATE_ROADMAP U2).
 *
 * asset-updater.js deliberately contains no network code: it decides what is
 * SAFE to run. This module decides what is AVAILABLE - it fetches the signed
 * manifest and the asset bundle from the latest stable GitHub release, hands
 * the bytes to the updater for verification/staging, and activates for the
 * next boot. Between installer releases, a shop's UI and pages stay current
 * with zero prompts: the Slack model, with a signature standing between a
 * leaked token and the fleet.
 *
 * Release layout it expects (release.yml publishes both, names unversioned so
 * /releases/latest/download/ URLs stay stable):
 *   asset-manifest.json   signed manifest (asset-updater's contract)
 *   posnic-assets.zip     the frontend/public tree those hashes describe
 *
 * Rules:
 *  - Same-major only. Assets from a new major may assume a new Electron/API
 *    core; that ships as an installer, by the shop's deliberate click.
 *  - Stable releases only (the /latest/ endpoint never serves prereleases) -
 *    matching electron-updater's allowPrerelease=false default.
 *  - Never interrupts: staged now, live on the next launch, and the boot
 *    health gate auto-reverts a bad bundle after two failed starts.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FEED_BASE = 'https://github.com/Posnic/POS/releases/latest/download';

/* Plain numeric semver compare; returns <0, 0, >0. Non-semver never wins. */
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/*
 * After a full installer runs, its baseline IS the app version - staged assets
 * from an older release must never shadow it. Called at boot, before the
 * updater's own health gate.
 */
function reconcileWithInstaller(assetUpdater, appVersion, log = () => {}) {
  const active = assetUpdater.activeVersion();
  if (active && compareVersions(active, appVersion) < 0) {
    log(`[assets] installer ${appVersion} supersedes staged ${active} - back to baseline`);
    assetUpdater.revert();
    // If the previous was also older, clear that too rather than offering a
    // revert INTO the stale version.
    const still = assetUpdater.activeVersion();
    if (still && compareVersions(still, appVersion) < 0) assetUpdater.revert();
    return { cleared: true, from: active };
  }
  return { cleared: false };
}

function extractZip(sevenZipPath, zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile(sevenZipPath, ['x', zipPath, `-o${destDir}`, '-y', '-bso0', '-bsp0'],
      (err) => (err ? reject(err) : resolve()));
  });
}

function loadTree(dir, base, map = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) loadTree(full, base, map);
    else if (entry.isFile()) {
      map.set(path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  }
  return map;
}

/*
 * One check-and-apply cycle. Silent on every expected outcome (no release yet,
 * already current, offline); loud only on a genuinely broken bundle.
 * Returns { applied, version } for the caller's log/broadcast.
 */
async function checkAndApply({ assetUpdater, appVersion, sevenZipPath, log = () => {} }) {
  if (!assetUpdater || !assetUpdater.publicKey) return { applied: false, reason: 'no-key' };

  let manifest;
  try {
    const res = await fetch(`${FEED_BASE}/asset-manifest.json`, { redirect: 'follow' });
    if (!res.ok) return { applied: false, reason: `feed-${res.status}` };
    manifest = await res.json();
  } catch (err) {
    return { applied: false, reason: 'offline' };
  }

  const current = assetUpdater.activeVersion() || appVersion;
  if (compareVersions(manifest.version, current) <= 0) {
    return { applied: false, reason: 'current' };
  }
  if (String(manifest.version).split('.')[0] !== String(appVersion).split('.')[0]) {
    log(`[assets] ${manifest.version} is a new major - waiting for the installer`);
    return { applied: false, reason: 'major' };
  }

  // The signature check comes before the download would even matter, so a
  // tampered manifest costs one small fetch, not a bundle.
  const verdict = assetUpdater.verifyManifest(manifest);
  if (!verdict.ok) {
    log(`[assets] refusing ${manifest.version}: ${verdict.reason}`);
    return { applied: false, reason: verdict.reason };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-assets-'));
  try {
    const zipPath = path.join(work, 'bundle.zip');
    const res = await fetch(`${FEED_BASE}/posnic-assets.zip`, { redirect: 'follow' });
    if (!res.ok) return { applied: false, reason: `bundle-${res.status}` };
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    const treeDir = path.join(work, 'tree');
    fs.mkdirSync(treeDir);
    await extractZip(sevenZipPath, zipPath, treeDir);

    const staged = assetUpdater.stage(manifest, loadTree(treeDir, treeDir));
    if (!staged.ok) {
      log(`[assets] stage refused ${manifest.version}: ${staged.reason}`);
      return { applied: false, reason: staged.reason };
    }
    const active = assetUpdater.activate(manifest.version);
    if (!active.ok) return { applied: false, reason: active.reason };

    log(`[assets] ${manifest.version} staged and activated - live on the next launch`);
    return { applied: true, version: manifest.version };
  } catch (err) {
    log(`[assets] update attempt failed: ${err.message}`);
    return { applied: false, reason: 'error', detail: err.message };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { checkAndApply, reconcileWithInstaller, compareVersions, FEED_BASE };
