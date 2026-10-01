'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
const marker = pkg.posnicDiagnostic;
assert.equal(marker?.enabled, true, 'Not a diagnostic package');
assert.equal(marker.endpoint, new URL(marker.endpoint).origin);
assert.equal(new URL(marker.endpoint).protocol, 'https:');
const files = ['src/diagnostics.js', 'src/diagnostic-session.js', 'src/diagnostic-health.js', 'src/diagnostics-ui.js', 'src/diagnostics.html', 'src/main.js', 'src/preload.js', 'src/ipc-guard.js', 'src/hardware-manager.js', 'src/escpos-unicode.js'];
for (const file of files) assert.ok(asar.extractFile(archive, file).equals(fs.readFileSync(path.join(root, file))), 'Stale packaged source: ' + file);
const digest = crypto.createHash('sha256');
for (const file of marker.sourceDigestFiles) {
  assert.ok(!file.includes('..') && !path.isAbsolute(file), 'Invalid manifest source path');
  digest.update(file).update(fs.readFileSync(path.join(root, file)));
}
assert.equal(digest.digest('hex'), marker.sourceDigest, 'Build source digest does not match');
let bundles = 0;
for (const file of fs.readdirSync(path.join(root, 'frontend/public/script')).filter(name => name.endsWith('.js'))) {
  assert.ok(fs.readFileSync(path.join(root, 'frontend/public/script', file)).equals(fs.readFileSync(path.join(root, 'dist/win-unpacked/resources/frontend/public/script', file))), 'Stale frontend: ' + file); bundles++;
}
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist/DIAGNOSTIC-BUILD.json'))), marker);
const name = `Posnic-${pkg.version}-diagnostic-${marker.buildId}.exe`;
const executable = path.join(root, 'dist', name);
const result = { verified: true, executable, bytes: fs.statSync(executable).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), packagedSourceFiles: files.length, frontendBundles: bundles, marker };
fs.writeFileSync(path.join(root, 'dist/DIAGNOSTIC-VERIFICATION.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
