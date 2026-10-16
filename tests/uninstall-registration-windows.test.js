'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const compiler = process.env.NSIS_MAKENSIS || path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe');
const available = process.platform === 'win32' && fs.existsSync(compiler);
const source = fs.readFileSync(path.join(__dirname, '../builds/installer.nsh'), 'utf8');
const macro = source.match(/!macro POSNIC_VERIFY_REMOVAL\r?\n[\s\S]*?!macroend/)[0];

// Execute the production cleanup macro against disposable registry keys only.
// This harness never installs or uninstalls a real application.
test('Windows registration finalizer handles stale, absent, live and unrelated installations', { skip: !available }, t => {
  for (const scenario of ['stale', 'absent', 'live', 'other']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-registration-test-'));
    const key = 'HKCU\\Software\\PosnicRemovalTests\\' + path.basename(dir);
    const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const nsisKey = key.replace(/^HKCU\\/, '');
    const run = (file, args) => spawnSync(file, args, { encoding: 'utf8', windowsHide: true });
    t.after(() => {
      assert.ok(key.startsWith('HKCU\\Software\\PosnicRemovalTests\\posnic-registration-test-'));
      run('reg.exe', ['delete', key, '/f', '/reg:64']);
      run('reg.exe', ['delete', runKey, '/v', path.basename(dir), '/f', '/reg:64']);
      assert.equal(path.dirname(dir), os.tmpdir());
      assert.ok(path.basename(dir).startsWith('posnic-registration-test-'));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const exe = path.join(dir, 'check.exe');
    const nsi = path.join(dir, 'check.nsi');
    fs.writeFileSync(nsi, `Unicode true
!include LogicLib.nsh
Name "Registration cleanup test"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
!define APP_EXECUTABLE_FILENAME "fixture.exe"
!define PRODUCT_NAME "${path.basename(dir)}"
!define INSTALL_REGISTRY_KEY "${nsisKey}\\Install"
!define UNINSTALL_REGISTRY_KEY "${nsisKey}\\Uninstall"
${macro}
Section
  SetRegView 64
  StrCpy $INSTDIR "${dir}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "\${PRODUCT_NAME}" "$INSTDIR\\fixture.exe"
  ${scenario !== 'absent' ? `WriteRegStr HKCU "\${INSTALL_REGISTRY_KEY}" InstallLocation "${scenario === 'other' ? dir + '-other' : dir}"
  WriteRegStr HKCU "\${UNINSTALL_REGISTRY_KEY}" DisplayName "Fixture"` : ''}
  ${scenario === 'live' ? 'FileOpen $0 "$INSTDIR\\fixture.exe" w\n  FileClose $0' : ''}
  ; Simulate a shell plugin leaving a different context behind.
  SetShellVarContext all
  !insertmacro POSNIC_VERIFY_REMOVAL
SectionEnd
`);
    const compiled = run(compiler, ['/V2', nsi]);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = run(exe, []);
    const shouldKeep = scenario === 'live' || scenario === 'other';
    assert.equal(result.status, shouldKeep ? 1 : 0, scenario + ': ' + result.stderr);
    for (const child of ['Install', 'Uninstall']) {
      const query = run('reg.exe', ['query', key + '\\' + child, '/reg:64']);
      assert.equal(query.status === 0, shouldKeep, scenario + ': ' + child);
    }
    const startup = run('reg.exe', ['query', runKey, '/v', path.basename(dir), '/reg:64']);
    assert.equal(startup.status === 0, shouldKeep, scenario + ': startup');
  }
});
