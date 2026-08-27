/*
 * Rollback drill (SEAMLESS_UPDATE_ROADMAP U4.3).
 *
 * asset-updater.test.js proves the engine on synthetic fixtures;
 * asset-channel.test.js proves the signer round-trips. What neither proves
 * is the whole community release path with the REAL artifact: the manifest
 * scripts/build-asset-bundle.js emits over the actually-built frontend,
 * staged onto a till, activated, failing to boot, and rolled back on its
 * own. That end-to-end path is exactly what runs unattended in a shop, so
 * it is exercised on every CI run here - not discovered in production.
 *
 * Needs frontend/public to exist (CI builds it before the suite; locally
 * run the frontend build once).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { AssetUpdater, MAX_BOOT_ATTEMPTS } = require('../src/asset-updater');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'frontend', 'public');

const keys = crypto.generateKeyPairSync('ed25519');
const PRIVATE_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC_PEM = keys.publicKey.export({ type: 'spki', format: 'pem' });

test('the real release artifact stages, activates, and auto-reverts when it cannot boot', (t) => {
  assert.ok(
    fs.existsSync(path.join(ASSETS_DIR, 'dashboard.html')),
    'frontend/public is not built - build the frontend before the suite'
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-drill-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // 1. The release side, verbatim: the same script the release workflow runs,
  //    over the same directory it signs, key pair supplied like the CI secret.
  const manifestPath = path.join(tmp, 'asset-manifest.json');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-asset-bundle.js'), manifestPath], {
    env: {
      ...process.env,
      POSNIC_ASSET_SIGNING_KEY: PRIVATE_PEM,
      POSNIC_ASSET_PUBLIC_KEY: PUBLIC_PEM,
    },
    stdio: 'pipe',
  });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.files.length >= 50, 'a built frontend is hundreds of files');
  assert.ok(manifest.signature, 'the manifest ships signed');

  // 2. The till side: bytes arrive separately (the workflow zips the same
  //    tree), so read them from the tree the manifest describes.
  const contents = new Map();
  for (const f of manifest.files) {
    contents.set(f.path, fs.readFileSync(path.join(ASSETS_DIR, f.path)));
  }

  const baseline = path.join(tmp, 'baseline');
  fs.mkdirSync(baseline, { recursive: true });
  fs.writeFileSync(path.join(baseline, 'installed.txt'), 'installer version');
  const till = new AssetUpdater({
    root: path.join(tmp, 'assets'),
    publicKey: PUBLIC_PEM,
    baseline,
  });

  assert.strictEqual(till.stage(manifest, contents).ok, true, 'the real artifact must stage');
  assert.strictEqual(till.activate(manifest.version).ok, true);
  assert.strictEqual(till.activeVersion(), manifest.version);
  assert.ok(
    fs.existsSync(path.join(till.activeDir(), 'dashboard.html')),
    'the served directory holds the released pages'
  );

  // 3. The drill: the update never reaches healthy. The till must abandon it
  //    by itself and serve the installed baseline again - no human involved.
  for (let i = 0; i < MAX_BOOT_ATTEMPTS; i++) {
    assert.strictEqual(till.beginBoot().reverted, false, 'attempt ' + (i + 1) + ' still tries');
  }
  const r = till.beginBoot();
  assert.strictEqual(r.reverted, true, 'the failing release must be abandoned');
  assert.strictEqual(till.activeVersion(), null, 'back on the installed baseline');
  assert.strictEqual(
    fs.readFileSync(path.join(till.activeDir(), 'installed.txt'), 'utf8'),
    'installer version'
  );
});

test('tampered bytes in an otherwise-genuine release are refused at stage', (t) => {
  // The zip travels unsigned; the manifest is what makes it trustworthy.
  // Prove that swapping one file's bytes after signing is caught.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-drill-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const manifestPath = path.join(tmp, 'asset-manifest.json');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-asset-bundle.js'), manifestPath], {
    env: {
      ...process.env,
      POSNIC_ASSET_SIGNING_KEY: PRIVATE_PEM,
      POSNIC_ASSET_PUBLIC_KEY: PUBLIC_PEM,
    },
    stdio: 'pipe',
  });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const contents = new Map();
  for (const f of manifest.files) {
    contents.set(f.path, fs.readFileSync(path.join(ASSETS_DIR, f.path)));
  }
  contents.set(manifest.files[0].path, Buffer.from('not what was signed'));

  const baseline = path.join(tmp, 'baseline');
  fs.mkdirSync(baseline, { recursive: true });
  const till = new AssetUpdater({
    root: path.join(tmp, 'assets'),
    publicKey: PUBLIC_PEM,
    baseline,
  });

  const res = till.stage(manifest, contents);
  assert.strictEqual(res.ok, false, 'tampered bytes must not stage');
  assert.strictEqual(till.activeVersion(), null);
});
