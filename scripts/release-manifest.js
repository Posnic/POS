#!/usr/bin/env node
'use strict';
/*
 * Write the release-manifest (SEAMLESS_UPDATE_ROADMAP U1.1): the one
 * machine-readable statement of what a release IS, attached to every GitHub
 * release next to the installers. Fleet tooling, the gateway and future
 * clients read this instead of parsing version strings out of file names.
 *
 *   node scripts/release-manifest.js <output-path>
 *
 * Fields:
 *   version          root package.json - the only version users see
 *   channel          'stable' | 'beta' (from POSNIC_PRERELEASE, mirroring the
 *                    release workflow's prerelease decision)
 *   apiSchema        api/src/constants/runtime.constants.js - bumps with
 *                    migrations
 *   syncProtocol     same file - the gateway supports N and N-1
 *   minClientVersion oldest app version this release's API still accepts;
 *                    defaults to the current major's floor, overridable via
 *                    POSNIC_MIN_CLIENT_VERSION when a deliberate break ships
 *
 * Deliberately no timestamp: two runs over the same commit produce identical
 * bytes, so the manifest can be diffed and cached like any other artifact.
 */

const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/release-manifest.js <output-path>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const {
  API_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
} = require(path.join(root, 'api', 'src', 'constants', 'runtime.constants.js'));

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  console.error(`release-manifest: root version "${pkg.version}" is not a plain semver`);
  process.exit(1);
}

const major = pkg.version.split('.')[0];
const minClient = process.env.POSNIC_MIN_CLIENT_VERSION || `${major}.0.0`;
if (!/^\d+\.\d+\.\d+$/.test(minClient)) {
  console.error(`release-manifest: minClientVersion "${minClient}" is not a plain semver`);
  process.exit(1);
}

const manifest = {
  version: pkg.version,
  channel: process.env.POSNIC_PRERELEASE === 'no' ? 'stable' : 'beta',
  apiSchema: API_SCHEMA_VERSION,
  syncProtocol: SYNC_PROTOCOL_VERSION,
  minClientVersion: minClient,
};

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`release-manifest: wrote ${out}`, manifest);
