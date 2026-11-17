'use strict';

// electron-builder cannot sign binaries hidden inside the compressed API runtime.
// Its custom signing hook runs before the enclosing app is signed/notarized.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    if (fs.readSync(fd, header, 0, 4, 0) !== 4) return false;
    return ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'));
  } finally { fs.closeSync(fd); }
}

function signRuntime(options, run = execFileSync) {
  if (!options.identity || options.identity === '-') throw new Error('API runtime requires a Developer ID signing identity');
  const archive = path.join(options.app, 'Contents', 'Resources', 'api', 'node_modules.zip');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-mac-sign-'));
  try {
    const extracted = path.join(temporary, 'runtime');
    fs.mkdirSync(extracted);
    run('/usr/bin/ditto', ['-x', '-k', archive, extracted], { stdio: 'inherit' });
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { visit(file); continue; }
        if (!entry.isFile() || !isMachO(file)) continue;
        const args = ['--force', '--timestamp', '--options', 'runtime', '--sign', options.identity];
        if (options.keychain) args.push('--keychain', options.keychain);
        run('/usr/bin/codesign', [...args, file], { stdio: 'inherit' });
        run('/usr/bin/codesign', ['--verify', '--strict', file], { stdio: 'inherit' });
      }
    };
    visit(extracted);
    const signed = path.join(temporary, 'signed.zip');
    run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', extracted, signed], { stdio: 'inherit' });
    fs.copyFileSync(signed, archive);
    // Force re-extraction on upgrade from the earlier unsigned runtime cache.
    const id = fs.readFileSync(archive + '.id', 'utf8');
    fs.writeFileSync(archive + '.id', crypto.createHash('sha256').update(id + ':mac-developer-id-v1:' + options.identity).digest('hex'));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

exports.default = async (options) => {
  signRuntime(options);
  await require('app-builder-lib/out/codeSign/macCodeSign').sign(options);
};
exports.signRuntime = signRuntime;
exports.isMachO = isMachO;
