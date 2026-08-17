#!/usr/bin/env node
'use strict';
/*
 * Build and sign the asset-update manifest (SEAMLESS_UPDATE_ROADMAP U2).
 *
 *   POSNIC_ASSET_SIGNING_KEY="<pem>" node scripts/build-asset-bundle.js <out-manifest.json> [assets-dir]
 *
 * Walks the built frontend (frontend/public by default), hashes every file,
 * signs the canonical payload with the Ed25519 private key from the
 * environment, and writes the manifest that asset-updater.js verifies on the
 * till. The signature uses AssetUpdater.signedPayload itself, so signer and
 * verifier can never drift on serialisation - the exact failure mode its
 * comment warns about.
 *
 * After signing, the manifest is verified against the repo's committed
 * public key: a mismatched keypair fails the release here, not on a shop's
 * till.
 *
 * The file BYTES travel separately (the release workflow zips the same tree
 * as posnic-assets.zip); this manifest is what makes them trustworthy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AssetUpdater } = require('../asset-updater');

const out = process.argv[2];
if (!out) {
  console.error('usage: build-asset-bundle.js <out-manifest.json> [assets-dir]');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const assetsDir = path.resolve(process.argv[3] || path.join(root, 'frontend', 'public'));

const privatePem = process.env.POSNIC_ASSET_SIGNING_KEY;
if (!privatePem || !privatePem.includes('PRIVATE KEY')) {
  console.error('POSNIC_ASSET_SIGNING_KEY is not set (PEM Ed25519 private key). Refusing to');
  console.error('emit an unsigned manifest - the till would rightly reject it.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function walk(dir, base, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, list);
    else if (entry.isFile()) list.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return list;
}

const skip = new Set(['all.zip']); // packaging convenience, not an asset
const files = walk(assetsDir, assetsDir)
  .filter((p) => !skip.has(p))
  .map((p) => ({
    path: p,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(assetsDir, p))).digest('hex'),
  }));

if (files.length < 50) {
  console.error(`only ${files.length} files under ${assetsDir} - that is not a built frontend.`);
  process.exit(1);
}

const manifest = { version: pkg.version, kind: 'assets', files };
manifest.signature = crypto
  .sign(null, Buffer.from(AssetUpdater.signedPayload(manifest), 'utf8'), privatePem)
  .toString('base64');

// Prove the pair: verify with the committed public key before shipping.
const publicKey = process.env.POSNIC_ASSET_PUBLIC_KEY
  || fs.readFileSync(path.join(root, 'asset-signing-key.pub'), 'utf8');
const check = new AssetUpdater({ root: '/tmp/x', publicKey, baseline: null }).verifyManifest(manifest);
if (!check.ok) {
  console.error('signed manifest does not verify against asset-signing-key.pub:', check.reason);
  console.error('the POSNIC_ASSET_SIGNING_KEY secret does not match the committed public key.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest));
console.log(`asset manifest: v${manifest.version}, ${files.length} files, signed + verified`);
