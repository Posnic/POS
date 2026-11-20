'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const MACHO = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
function nativeFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...nativeFiles(file));
    else if (entry.isFile()) {
      const fd = fs.openSync(file, 'r');
      const magic = Buffer.alloc(4);
      try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (MACHO.has(magic.toString('hex'))) found.push(file);
    }
  }
  return found;
}
async function signMacApiArchive(context, run = execFileSync) {
  if (!['darwin','mac'].includes(context.electronPlatformName)) return;
  const packager = context.packager;
  const config = packager.platformSpecificBuildOptions || packager.config.mac || {};
  // Unsigned PR smoke builds deliberately have no Developer ID credentials.
  if (config.identity === null || (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !process.env.CSC_LINK && !config.identity)) return;
  const {keychainFile} = await packager.codeSigningInfo.value;
  const identity = await packager.helper.findSigningIdentity(false, false, config.identity, keychainFile, config);
  if (!identity) {
    if (process.env.CSC_LINK || config.identity) throw new Error('Developer ID required to sign API native libraries');
    return;
  }
  const archive = path.join(context.appOutDir, packager.appInfo.productFilename + '.app', 'Contents', 'Resources', 'api', 'node_modules.zip');
  if (!fs.existsSync(archive)) throw new Error('Packaged API archive missing before signing');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-sign-api-'));
  const extracted = path.join(temp, 'modules');
  fs.mkdirSync(extracted);
  try {
    const sevenZip = require('7zip-bin').path7za;
    run(sevenZip, ['x', archive, '-o' + extracted, '-y'], {stdio:'pipe'});
    const binaries = nativeFiles(extracted);
    if (!binaries.length) return;
    for (const binary of binaries) {
      const args = ['--force', '--sign', identity.hash, '--timestamp', '--options', 'runtime'];
      if (keychainFile) args.push('--keychain', keychainFile);
      args.push(binary);
      run('/usr/bin/codesign', args, {stdio:'inherit'});
      run('/usr/bin/codesign', ['--verify', '--strict', binary], {stdio:'inherit'});
    }
    const replacement = path.join(temp, 'signed.zip');
    run(sevenZip, ['a', '-tzip', '-mx=9', replacement, '.'], {cwd:extracted,stdio:'pipe'});
    // Replace only this architecture's packaged copy, never the shared build cache.
    fs.copyFileSync(replacement, archive);
    fs.writeFileSync(archive + '.id', crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
    console.log(`[mac] Signed and verified ${binaries.length} archived native libraries with Developer ID`);
  } finally {
    fs.rmSync(temp, {recursive:true,force:true});
  }
}
module.exports = {signMacApiArchive, nativeFiles};
