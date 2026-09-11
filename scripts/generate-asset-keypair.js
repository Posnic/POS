#!/usr/bin/env node
'use strict';
/*
 * One-time keypair for the frontend asset-update channel (asset-updater.js).
 *
 *   node scripts/generate-asset-keypair.js
 *
 * Writes:
 *   asset-signing-key.pub          - COMMIT this. Ships in extraResources;
 *                                    without it every till refuses updates.
 *   asset-signing-key.private.pem  - NEVER commit (gitignored). Add its
 *                                    contents as the GitHub Actions secret
 *                                    POSNIC_ASSET_SIGNING_KEY, keep an offline
 *                                    copy, then delete the file.
 *
 * Refuses to overwrite an existing public key: rotating the key orphans every
 * installed till (they verify against the old one until the next installer),
 * so rotation is a deliberate release event, not a re-run of this script.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const pubPath = path.join(root, 'src', 'asset-signing-key.pub');
const privPath = path.join(root, 'asset-signing-key.private.pem');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
let pubFd;
let privFd;
try {
  pubFd = fs.openSync(pubPath, 'wx', 0o644);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('asset-signing-key.pub already exists. Key rotation orphans every');
  console.error('installed till until its next full installer - if you really mean');
  console.error('to rotate, delete the old key first and ship an installer release.');
  process.exit(1);
}

try {
  privFd = fs.openSync(privPath, 'wx', 0o600);
  fs.writeFileSync(pubFd, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(privFd, privateKey.export({ type: 'pkcs8', format: 'pem' }));
} catch (error) {
  if (pubFd !== undefined) fs.closeSync(pubFd);
  if (privFd !== undefined) fs.closeSync(privFd);
  pubFd = privFd = undefined;
  fs.rmSync(pubPath, { force: true });
  if (error.code !== 'EEXIST') fs.rmSync(privPath, { force: true });
  if (error.code === 'EEXIST') {
    console.error('asset-signing-key.private.pem already exists; no keys were changed.');
    process.exit(1);
  }
  throw error;
} finally {
  if (pubFd !== undefined) fs.closeSync(pubFd);
  if (privFd !== undefined) fs.closeSync(privFd);
}

console.log('Wrote asset-signing-key.pub (commit this).');
console.log('Wrote asset-signing-key.private.pem (DO NOT COMMIT).');
console.log('');
console.log('Next steps:');
console.log('  1. gh secret set POSNIC_ASSET_SIGNING_KEY < asset-signing-key.private.pem');
console.log('  2. Store an offline copy of the private key somewhere safe.');
console.log('  3. Delete asset-signing-key.private.pem from this machine.');
