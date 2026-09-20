'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function zipOnlyManifest(manifest) {
  const files = (manifest.files || []).filter((file) => /\.zip$/i.test(file.url));
  if (!files.length) throw new Error('macOS updates require a ZIP package.');
  const primary = files.find((file) => file.url === manifest.path) || files[0];
  return { ...manifest, files, path: primary.url, sha512: primary.sha512 };
}

function prepare(directory) {
  const file = path.join(directory, 'latest-mac.yml');
  const manifest = yaml.load(fs.readFileSync(file, 'utf8'));
  const normalized = zipOnlyManifest(manifest);
  fs.writeFileSync(file, yaml.dump(normalized, { lineWidth: -1 }));
  // Stapling changes the DMG bytes after electron-builder made its metadata.
  // MacUpdater uses ZIPs exclusively. DMGs remain manual downloads, covered
  // by the final release checksum and SBOM; stale DMG blockmaps must not ship.
  for (const entry of manifest.files || []) {
    if (!/\.dmg$/i.test(entry.url) || path.basename(entry.url) !== entry.url) continue;
    try { fs.unlinkSync(path.join(directory, entry.url + '.blockmap')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return normalized;
}

if (require.main === module) {
  prepare(path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist')));
  console.log('macOS updater metadata contains only its unchanged ZIP packages.');
}

module.exports = { zipOnlyManifest, prepare };
