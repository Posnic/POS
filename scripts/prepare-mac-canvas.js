'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const MAC_CANVAS_PACKAGES = ['@napi-rs/canvas-darwin-arm64', '@napi-rs/canvas-darwin-x64'];

function verifyNativePackage(extracted, name, entry, arch) {
  const metadata = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
  if (metadata.name !== name || metadata.version !== entry.version ||
      !metadata.os?.includes('darwin') || !metadata.cpu?.includes(arch)) {
    throw new Error(`Native package identity/architecture mismatch: ${name}`);
  }
  const binary = fs.readFileSync(path.join(extracted, `skia.darwin-${arch}.node`));
  const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (binary.length < 8 || binary.subarray(0,4).toString('hex') !== 'cffaedfe' || binary.readUInt32LE(4) !== cpu) {
    throw new Error(`Native canvas Mach-O architecture mismatch: ${name}`);
  }
}

// One runtime ZIP is shared by both Mac targets. npm ci only installs the
// runner's architecture; include both lockfile-pinned native canvas packages.
function prepareMacCanvas(root, run = execFileSync) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'api/package-lock.json'), 'utf8'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-mac-canvas-'));
  try {
    for (const arch of ['arm64', 'x64']) {
      const name = `@napi-rs/canvas-darwin-${arch}`;
      const entry = lock.packages[`node_modules/${name}`];
      if (!entry || !entry.resolved || !entry.integrity?.startsWith('sha512-')) throw new Error(`Missing locked native package: ${name}`);
      const directory = path.join(temporary, arch);
      fs.mkdirSync(directory);
      const output = JSON.parse(run('npm', ['pack', entry.resolved, '--ignore-scripts', '--json', '--pack-destination', directory], { encoding: 'utf8' }));
      const filename = output[0]?.filename;
      if (!filename || path.basename(filename) !== filename) throw new Error('Invalid native package archive name');
      const tarball = path.join(directory, filename);
      const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tarball)).digest('base64');
      if (integrity !== entry.integrity) throw new Error(`Native package integrity mismatch: ${name}`);
      run('/usr/bin/tar', ['-xzf', tarball, '-C', directory], { stdio: 'inherit' });
      const extracted = path.join(directory, 'package');
      verifyNativePackage(extracted, name, entry, arch);
      fs.cpSync(extracted, path.join(root, 'api/node_modules', name), { recursive: true });
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

exports.prepareMacCanvas = prepareMacCanvas;
exports.MAC_CANVAS_PACKAGES = MAC_CANVAS_PACKAGES;
exports.verifyNativePackage = verifyNativePackage;
