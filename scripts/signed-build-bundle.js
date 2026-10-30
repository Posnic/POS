'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

function bundle(dir, version, commit, publisher) {
  const name = `Posnic-${version}-windows-x64-installer.exe`;
  const exe = path.join(dir, name);
  const bytes = fs.readFileSync(exe);
  const hash = crypto.createHash('sha512').update(bytes).digest('base64');
  const manifests = fs.readdirSync(dir).filter((f) => /^(latest|beta|alpha)\.yml$/.test(f));
  if (!manifests.length) throw new Error('No updater manifest generated');
  for (const file of manifests) {
    const meta = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (meta.version !== version || meta.path !== name || meta.sha512 !== hash ||
        !Array.isArray(meta.files) || meta.files.length !== 1 ||
        meta.files[0].url !== name || meta.files[0].sha512 !== hash ||
        meta.files[0].size !== bytes.length) {
      throw new Error(`Updater metadata does not match the signed installer: ${file}`);
    }
  }
  const blockmap = name + '.blockmap';
  if (!fs.statSync(path.join(dir, blockmap)).size) throw new Error('Empty blockmap');
  const dest = path.join(dir, 'handoff');
  fs.mkdirSync(dest); // Never reuse a previous handoff.
  const files = [name, blockmap, ...manifests];
  for (const file of files) fs.copyFileSync(path.join(dir, file), path.join(dest, file));
  fs.writeFileSync(path.join(dest, 'BUILD-INFO.json'), JSON.stringify({
    version, commit, publisher, createdAt: new Date().toISOString(),
    note: 'Built locally; installer Authenticode and timestamp verified by build-signed-windows.ps1. Not published.',
  }, null, 2) + '\n');
  files.push('BUILD-INFO.json');
  fs.writeFileSync(path.join(dest, 'SHA256SUMS.txt'), files.map((file) =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(dest, file))).digest('hex') + '  ' + file
  ).join('\n') + '\n');
  return dest;
}
if (require.main === module) bundle(...process.argv.slice(2));
module.exports = { bundle };
