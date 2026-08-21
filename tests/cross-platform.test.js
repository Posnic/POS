/*
 * The Windows assumptions that shipped to macOS and Linux.
 *
 * Two of them reached a real machine on the same day, both at the worst
 * possible moment - in front of a client:
 *
 *   macOS  "Posnic is damaged and can't be opened."
 *   Ubuntu  a failure naming 7za.exe, on a machine with no .exe files at all.
 *
 * Neither is a mystery once seen. Every build shipped
 * node_modules/7zip-bin/win/x64/7za.exe as tools/7za.exe and server.js asked
 * for that name unconditionally, so the first launch after install failed
 * while extracting the API runtime. And the mac build was signed by nothing at
 * all, which on Apple Silicon is not "unidentified developer" - it is refused
 * outright, and the right-click-Open advice on the download page cannot help,
 * because that escape hatch exists only for apps signed by somebody untrusted.
 *
 * The pattern behind both: this was written on Windows, tested on Windows, and
 * the other two platforms were assumed to follow. These tests are the check
 * that runs on every push, on a Linux runner, whether or not anyone remembers.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const pkg = require('../package.json');
const { stripComments } = require('./helpers/source-lookup');

// ── The tools each platform is given ────────────────────────────────────────

test('every platform is shipped a 7-Zip it can actually run', () => {
  const forPlatform = (name) => (pkg.build[name]?.extraResources || [])
    .filter((e) => /7za/.test(e.from || ''));

  const win = forPlatform('win');
  const mac = forPlatform('mac');
  const linux = forPlatform('linux');

  assert.ok(win.length, 'the Windows build has no 7-Zip');
  assert.ok(mac.length, 'the macOS build has no 7-Zip, so the API runtime cannot be extracted');
  assert.ok(linux.length, 'the Linux build has no 7-Zip, so the API runtime cannot be extracted');

  assert.match(win[0].from, /win\//, `Windows is given ${win[0].from}`);
  assert.match(mac[0].from, /mac\//, `macOS is given ${mac[0].from} - a Windows binary will not run there`);
  assert.match(linux[0].from, /linux\//, `Linux is given ${linux[0].from} - a Windows binary will not run there`);

  /* The mac build produces both architectures from one runner, so the binary
     has to be selected per arch rather than hardcoded. */
  assert.match(
    mac[0].from,
    /\$\{arch\}/,
    'the macOS 7-Zip is not architecture-aware, so one of Intel or Apple Silicon gets the wrong binary',
  );
});

test('and nothing hands a .exe to a platform that cannot run one', () => {
  for (const platform of ['mac', 'linux']) {
    for (const entry of pkg.build[platform]?.extraResources || []) {
      assert.doesNotMatch(
        JSON.stringify(entry),
        /\.exe/,
        `the ${platform} build ships ${entry.from}, which is a Windows executable`,
      );
    }
  }
});

test('the code asks for the binary by the name it was shipped under', () => {
  /* Shipping the right file is only half of it. server.js asked for
     tools/7za.exe on every platform, which is how this failed. */
  const SERVER = read('server.js');
  const call = SERVER.slice(SERVER.indexOf('sevenZipPath'));
  const expr = call.slice(0, call.indexOf('\n      user'));

  assert.match(
    expr,
    /process\.platform/,
    'the 7-Zip path is fixed, so a non-Windows build looks for a filename it does not have',
  );
  assert.match(expr, /'7za\.exe'/, 'the Windows name is gone');
  assert.match(expr, /'7za'/, 'the name used everywhere else is missing');
});

// ── Printing ────────────────────────────────────────────────────────────────

test('printing has a path that is not PowerShell', () => {
  /*
   * pdf-to-printer bundles SumatraPDF-3.4.6-32.exe and has no platform branch
   * of its own: it is a Windows library. Raw ESC/POS went out through a
   * PowerShell winspool script. Both were called unconditionally, so on macOS
   * and Linux every receipt failed - naming a command the machine does not
   * have.
   */
  const HW = read('hardware-manager.js');

  assert.match(HW, /_sendRawViaCups/, 'raw printing is PowerShell-only');
  assert.match(HW, /'-o', 'raw'/, 'the CUPS path does not ask for raw mode, so ESC/POS is filtered as text');
  assert.match(HW, /_printPdfFile/, 'PDF printing goes straight to the Windows-only library');

  const raw = HW.slice(HW.indexOf('async sendRawToPrinter'));
  assert.match(
    raw.slice(0, raw.indexOf('try {')),
    /process\.platform !== 'win32'/,
    'sendRawToPrinter runs the PowerShell path on every platform',
  );

  const drawer = HW.slice(HW.indexOf('async openCashDrawerViaPrinter'));
  assert.match(
    drawer.slice(0, drawer.indexOf('try {')),
    /process\.platform !== 'win32'/,
    'the cash drawer kick is PowerShell-only, so no drawer opens off Windows',
  );
});

test('the printer name is an argument, not something a shell parses', () => {
  /* Printer names contain spaces as a matter of course, and apostrophes often
     enough. Interpolating one into a shell string is both a bug and a way to
     run whatever a printer is called. */
  const HW = read('hardware-manager.js');
  /* The definition, not the call. The call inside sendRawToPrinter comes
     first in the file and passes the same argument names, so the anchor has to
     be the opening brace that only a declaration has. */
  const fn = HW.slice(HW.indexOf('_sendRawViaCups(printerName, buffer, docName) {'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(body.includes('execFileSync'), 'the CUPS implementation was not found to check');

  assert.match(body, /execFileSync\(\s*'lp'/, 'CUPS is invoked through a shell');
  assert.doesNotMatch(body, /`lp .*\$\{/, 'the printer name is interpolated into a command string');
});

// ── macOS being openable at all ─────────────────────────────────────────────

test('the macOS build is signed with something, even without a certificate', () => {
  /*
   * On Apple Silicon an unsigned binary is refused as damaged - not offered
   * with a warning, refused. An ad-hoc signature costs nothing and needs no
   * Apple account, and it is the difference between "damaged, move it to the
   * Trash" and "unidentified developer, open it if you meant to".
   */
  assert.ok(pkg.build.afterPack, 'there is no afterPack hook, so the mac build ships unsigned');

  const hook = path.join(ROOT, pkg.build.afterPack);
  assert.ok(fs.existsSync(hook), `${pkg.build.afterPack} does not exist`);

  const src = fs.readFileSync(hook, 'utf8');
  assert.match(src, /codesign/, 'the hook does not sign anything');
  assert.match(src, /'--sign', '-'/, 'the hook does not request an ad-hoc signature');
  assert.match(src, /darwin/, 'the hook does not restrict itself to macOS');
});

test('and a real certificate is never replaced by an ad-hoc one', () => {
  /* The day a Developer ID arrives, this hook must get out of the way rather
     than overwrite a properly signed, notarizable build with a worthless
     signature. */
  const src = fs.readFileSync(path.join(ROOT, pkg.build.afterPack), 'utf8');
  assert.match(
    src,
    /identity[\s\S]{0,200}return/,
    'the hook signs ad-hoc even when a signing identity is configured',
  );
});

test('a failure to sign does not lose the Windows and Linux release', () => {
  const src = fs.readFileSync(path.join(ROOT, pkg.build.afterPack), 'utf8');
  assert.match(src, /catch[\s\S]{0,300}console\.warn/, 'a signing failure aborts the whole build');
});

// ── The database, which had none of this ────────────────────────────────────

test('mongod is selected per platform, and shipped for each', () => {
  const MANAGER = read('mongodb-manager.js');
  assert.match(
    MANAGER,
    /win32' \? 'mongod\.exe' : 'mongod'/,
    'the database binary name is fixed to one platform',
  );

  for (const platform of ['win', 'mac', 'linux']) {
    const entries = (pkg.build[platform]?.extraResources || [])
      .filter((e) => /mongodb/.test(e.from || ''));
    assert.ok(entries.length, `the ${platform} build ships no database at all`);
  }
});

test('nothing but print-pdf.js may reach for the Windows-only printer', () => {
  /*
   * The gap this closes, found by asking what SumatraPDF was doing in a signed
   * build: hardware-manager had the platform branch and kot-manager did not.
   * kot-manager called pdf-to-printer straight, so on a Mac or Linux till every
   * kitchen ticket that fell back to PDF printing failed - caught and reported,
   * so nothing crashed and nothing printed either. build:mac and build:linux
   * exist, so that was a real hole rather than a theoretical one.
   *
   * The test that was here checked hardware-manager alone, which is precisely
   * how the second caller went unnoticed. It asks about the whole app now.
   */
  const OWNER = 'print-pdf.js';
  const callers = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith('.js') && f !== OWNER)
    /* COMMENTS STRIPPED: the explanation in kot-manager names the package it
       no longer calls, and matching prose reported it as a caller. */
    .filter((f) => stripComments(read(f)).includes('pdf-to-printer'));
  assert.deepStrictEqual(
    callers,
    [],
    'these require the Windows-only printer directly instead of print-pdf.js, so they fail off Windows: ' + callers.join(', '),
  );

  /* And the one that may must actually branch. */
  const PP = read(OWNER);
  assert.match(PP, /process\.platform === 'win32'/, 'print-pdf has no platform branch');
  assert.match(PP, /execFile\('lp'/, 'there is no CUPS path off Windows');
  assert.match(PP, /CUPS printing is not available/, 'ENOENT is reported as ENOENT, which helps nobody at a counter');

  /* A module the build does not package dies with Cannot find module on a
     customer machine while working perfectly from source. */
  assert.ok(pkg.build.files.includes(OWNER), OWNER + ' is not in build.files - it will not ship');
});

test('both printers go through the shared path', () => {
  for (const f of ['hardware-manager.js', 'kot-manager.js']) {
    assert.match(read(f), /printPdfFile/, f + ' does not use the shared PDF print path');
  }
});
