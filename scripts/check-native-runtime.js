'use strict';
/*
 * Every native binary we ship must be able to load on a clean Windows.
 *
 * Windows does not include the Visual C++ runtime. It arrives with Office,
 * Visual Studio or another application that installed the redistributable, so
 * a developer machine always has it and a shop's new till does not. A binary
 * that imports it and cannot find it fails with 0xC0000135 before it can log
 * anything - which is exactly how a customer install died in the field.
 *
 * This walks the packaged application, reads each PE binary's import table,
 * and reports any that needs the runtime without a copy it can actually reach.
 *
 *   node scripts/check-native-runtime.js [dist/win-unpacked]
 *
 * Windows searches, in order: the folder of the EXE that started the process,
 * then system folders. A .node addon or a DLL is therefore resolved against
 * the executable that loaded it, not against its own folder - which is why the
 * check below asks where the owning executable lives.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked');

// Shipped by Windows itself since Windows 10, so importing these is fine.
const OS_PROVIDED = /^(api-ms-win-|kernel32|advapi32|user32|gdi32|shell32|ole32|oleaut32|ws2_32|crypt32|bcrypt|secur32|dbghelp|version|winmm|psapi|iphlpapi|netapi32|userenv|dnsapi|wldap32|shlwapi|comdlg32|comctl32|imm32|setupapi|powrprof|dwmapi|uxtheme|rpcrt4|msvcrt|ntdll|winhttp|wininet|cfgmgr32|propsys|dbgcore|d3d|dxgi|hid|usp10|normaliz|mswsock|mpr|winspool)/i;

// The Visual C++ runtime, which is not.
const VC_RUNTIME = /^(vcruntime140(_1)?|msvcp140(_1|_2|_atomic_wait|_codecvt_ids)?|concrt140)\.dll$/i;

function peImports(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null;   // MZ
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 6 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null;  // PE\0\0

  const machine = buf.readUInt16LE(peOff + 4);
  // Import DLL names are plain ASCII in the binary. Parsing the full import
  // directory means walking section headers to convert RVAs; scanning for the
  // names is enough to answer "does this need the VC runtime", and cannot miss
  // one that is present.
  const names = new Set();
  const text = buf.toString('latin1');
  for (const m of text.matchAll(/[A-Za-z0-9_.\-]+\.dll/g)) names.add(m[0].toLowerCase());
  return { machine, names: [...names] };
}

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(exe|dll|node)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function main() {
  if (!fs.existsSync(target)) {
    console.log(`  ${path.relative(ROOT, target)} does not exist; build first`);
    return;
  }

  const binaries = walk(target);
  const problems = [];
  let needing = 0;

  for (const file of binaries) {
    const pe = peImports(file);
    if (!pe) continue;

    const vc = pe.names.filter((n) => VC_RUNTIME.test(n));
    if (!vc.length) continue;
    needing++;

    /*
     * Which folders will Windows search?
     *
     * An .exe resolves against its own folder. A .dll or .node resolves
     * against the folder of the executable that loaded it - which for a
     * satellite sitting beside an .exe is that same folder, and otherwise is
     * the app root where the Electron binary lives. Both are allowed, because
     * either one satisfies the loader.
     */
    const own = path.dirname(file);
    const searchDirs = /\.exe$/i.test(file)
      ? [own]
      : [own, target];

    const unresolved = vc.filter(
      (dll) => !searchDirs.some((d) => fs.existsSync(path.join(d, dll)))
    );
    if (unresolved.length) {
      problems.push({
        file: path.relative(target, file),
        searchDir: searchDirs.map((d) => path.relative(target, d) || '.').join(' or '),
        unresolved,
      });
    }
  }

  console.log(`  scanned ${binaries.length} binaries, ${needing} need the Visual C++ runtime\n`);

  if (!problems.length) {
    console.log('  every one of them can reach a bundled copy: this will start on a clean Windows');
    return;
  }

  console.log('  these would fail with 0xC0000135 on a machine without the runtime installed:\n');
  for (const p of problems) {
    console.log(`    ${p.file}`);
    console.log(`      looks in: ${p.searchDir}`);
    console.log(`      missing : ${p.unresolved.join(', ')}`);
  }
  console.log('\n  run: node scripts/bundle-vc-runtime.js');
  process.exit(1);
}

main();
