/*
 * The network half of the asset channel (asset-channel.js) and the release
 * bundle signer (scripts/build-asset-bundle.js).
 *
 * No network is exercised: checkAndApply's fetch path is not tested here (it
 * is deliberately thin), but everything that decides versions, and the full
 * sign -> verify round trip the release workflow performs, is.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { compareVersions, reconcileWithInstaller } = require(path.join(ROOT, 'src', 'asset-channel'));
const { AssetUpdater } = require(path.join(ROOT, 'src', 'asset-updater'));

test('compareVersions orders plain semvers and refuses to guess otherwise', () => {
  assert.ok(compareVersions('1.4.0', '1.4.1') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.strictEqual(compareVersions('1.4.0', '1.4.0'), 0);
  assert.strictEqual(compareVersions('abc', '1.0.0'), 0); // non-semver: no winner
});

test('an installer newer than the staged assets clears them back to baseline', () => {
  const reverted = [];
  const fake = {
    versions: ['1.3.9', null],
    activeVersion() { return this.versions[0]; },
    revert() { reverted.push(this.versions.shift()); return { ok: true }; },
  };
  const r = reconcileWithInstaller(fake, '1.4.0');
  assert.strictEqual(r.cleared, true);
  assert.deepStrictEqual(reverted, ['1.3.9']);
});

test('staged assets at or above the installer version are left alone', () => {
  const fake = {
    activeVersion() { return '1.4.2'; },
    revert() { throw new Error('must not revert'); },
  };
  assert.strictEqual(reconcileWithInstaller(fake, '1.4.0').cleared, false);
  assert.strictEqual(reconcileWithInstaller({ activeVersion: () => null, revert() {} }, '1.4.0').cleared, false);
});

test('the release signer round-trips against the verifier on the till', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // A fake built frontend: enough files to pass the script's sanity floor.
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-assets-src-'));
  for (let i = 0; i < 60; i++) {
    const dir = path.join(assets, i % 2 ? 'script' : 'style');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `f${i}.txt`), `content-${i}`);
  }
  const out = path.join(assets, 'manifest.json');

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-asset-bundle.js'), out, assets], {
    env: { ...process.env, POSNIC_ASSET_SIGNING_KEY: privPem, POSNIC_ASSET_PUBLIC_KEY: pubPem },
  });

  const manifest = JSON.parse(fs.readFileSync(out, 'utf8'));
  const updater = new AssetUpdater({ root: path.join(assets, 'u'), publicKey: pubPem, baseline: null });
  assert.strictEqual(updater.verifyManifest(manifest).ok, true, 'signed manifest must verify');
  assert.ok(manifest.files.length >= 60);

  // Tampering with one hash after signing must be caught.
  manifest.files[0].sha256 = manifest.files[0].sha256.replace(/^./, manifest.files[0].sha256[0] === 'a' ? 'b' : 'a');
  assert.strictEqual(updater.verifyManifest(manifest).ok, false, 'tampered manifest must fail');
});

test('the signer refuses a key that does not match the shipped public key', () => {
  const a = crypto.generateKeyPairSync('ed25519');
  const b = crypto.generateKeyPairSync('ed25519');
  const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-assets-mismatch-'));
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(assets, `f${i}.txt`), String(i));

  assert.throws(() =>
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-asset-bundle.js'),
      path.join(assets, 'm.json'), assets], {
      env: {
        ...process.env,
        POSNIC_ASSET_SIGNING_KEY: a.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        POSNIC_ASSET_PUBLIC_KEY: b.publicKey.export({ type: 'spki', format: 'pem' }),
      },
      stdio: 'pipe',
    })
  );
});
