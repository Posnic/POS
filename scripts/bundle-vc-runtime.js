'use strict';
/*
 * Put the Visual C++ runtime next to mongod.exe.
 *
 * mongod.exe imports vcruntime140.dll, vcruntime140_1.dll and msvcp140.dll
 * directly. Those are not part of Windows - they arrive with Office, Visual
 * Studio, or some other application that happened to install the
 * redistributable. A developer machine always has them; a shop's brand new
 * till does not, and mongod then exits with 0xC0000135 (DLL not found) before
 * it can log anything of its own.
 *
 * Windows searches the folder holding the executable before the system
 * folders, so three files beside mongod.exe fix it for every machine. That is
 * about 600 KB, against 25 MB for bundling the redistributable installer, and
 * it needs no elevation and no extra step during setup.
 *
 * The Universal CRT (api-ms-win-crt-*.dll) is deliberately not copied: it has
 * shipped as part of Windows since Windows 10, which is our floor.
 *
 *   node scripts/bundle-vc-runtime.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'mongodb', 'bin');

// Exactly what mongod.exe imports. Anything else is somebody guessing.
const NEEDED = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];

/*
 * Where to look, best first.
 *
 * The redistributable's own install directory is preferred over System32:
 * both hold the same files on an x64 machine, but the redist folder cannot be
 * confused with the 32-bit copies in SysWOW64 by a future edit.
 */
function candidateDirs() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const dirs = [];
  const vcRoot = path.join(process.env.ProgramFiles || 'C:\\Program Files',
    'Microsoft Visual Studio');
  if (fs.existsSync(vcRoot)) {
    // .../VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT
    const stack = [vcRoot];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        if (/Microsoft\.VC\d+\.CRT$/i.test(full) && /[\\/]x64[\\/]/i.test(full)) dirs.push(full);
        else if (stack.length < 400) stack.push(full);
      }
    }
  }
  dirs.push(path.join(sysRoot, 'System32'));   // x64 DLLs on an x64 Windows
  return dirs;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('  not Windows; nothing to bundle');
    return;
  }
  if (!fs.existsSync(path.join(TARGET, 'mongod.exe'))) {
    console.log(`  no mongod.exe in ${path.relative(ROOT, TARGET)}; nothing to do`);
    return;
  }

  const dirs = candidateDirs();
  const missing = [];

  for (const dll of NEEDED) {
    const dest = path.join(TARGET, dll);
    const from = dirs.map((d) => path.join(d, dll)).find((p) => fs.existsSync(p));
    if (!from) { missing.push(dll); continue; }

    // Skip an identical copy so repeated builds do not churn the file.
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(from))) {
      console.log(`  ${dll} already current`);
      continue;
    }
    fs.copyFileSync(from, dest);
    console.log(`  ${dll} <- ${from}`);
  }

  if (missing.length) {
    // Fail loudly. Shipping without these produces an installer that works on
    // every machine we test and fails on a customer's, which is the worst
    // possible way to find out.
    console.error(`\n  could not find: ${missing.join(', ')}`);
    console.error('  install the Microsoft Visual C++ 2015-2022 Redistributable (x64)');
    console.error('  on the build machine, then build again.');
    process.exit(1);
  }
  console.log(`\n  Visual C++ runtime bundled beside mongod.exe (${NEEDED.length} files)`);
}

main();
