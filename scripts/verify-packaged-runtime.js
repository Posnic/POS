'use strict';
const fs = require('node:fs');
const path = require('node:path');

const runtimeCopies = [
  { from: 'src/asset-updater.js', to: 'src/asset-updater.js' },
  { from: 'src/handset-slots.js', to: 'handset-slots.js' },
];

async function verifyArchive(archive, files) {
  const asar = await import('@electron/asar');
  const entries = new Set(asar.listPackage(archive).map(p => p.replace(/\\/g, '/').replace(/^\//, '')));
  const missing = files.filter(p => !entries.has(p));
  if (missing.length) throw new Error('Packaged runtime modules missing from app.asar: ' + missing.join(', '));
}

async function verifyPackagedRuntime(context) {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const isMac = ['darwin', 'mac'].includes(context.electronPlatformName);
  const resources = isMac
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const files = config.build.files.filter(p => typeof p === 'string' && p.startsWith('src/') && p.endsWith('.js'));
  await verifyArchive(path.join(resources, 'app.asar'), files);
  // These modules are also used by the separately launched API/server. Copy
  // AFTER packaging: listing the same source as extraResources can exclude it
  // from the ASAR even when it is explicitly listed in build.files.
  for (const { from: source, to: destination } of runtimeCopies) {
    const target = path.join(resources, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target);
  }
  console.log('[package] Verified ' + files.length + ' runtime modules in app.asar');
}
module.exports = { verifyArchive, verifyPackagedRuntime, runtimeCopies };
