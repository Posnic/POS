'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const windows = process.platform === 'win32';
const ps = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const script = path.resolve(__dirname, '../builds/setup-data.ps1');
function fixture(t) {
  const documents = spawnSync(ps, ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const id = 'Posnic-Setup-Test-' + crypto.randomBytes(8).toString('hex');
  const data = path.join(process.env.APPDATA, id), backups = path.join(documents, id + '-Backups'), recovery = path.join(documents, id + '-Recovery');
  const roots = [data, backups, recovery];
  t.after(() => {
    for (const root of roots) {
      assert.ok(path.basename(root).startsWith(id));
      assert.ok([path.resolve(process.env.APPDATA), path.resolve(documents)].includes(path.dirname(path.resolve(root))));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  fs.mkdirSync(path.join(data, 'mongodb/data'), { recursive: true });
  fs.mkdirSync(backups);
  fs.mkdirSync(path.join(data, 'backups'));
  fs.writeFileSync(path.join(data, 'backups', 'fallback.json'), 'fallback backup');
  fs.writeFileSync(path.join(data, 'mongodb/data/sales.wt'), 'offline sale');
  fs.writeFileSync(path.join(data, 'preferences.json'), 'printer settings');
  fs.writeFileSync(path.join(backups, 'saved.json'), 'old backup');
  return { data, backups, recovery, run(business, hardware, keepBackups, executable = '') {
    return spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-DataRoot', data, '-BackupsRoot', backups, '-RecoveryRoot', recovery,
      '-HardwareManifest', path.resolve(__dirname, '../src/setup-hardware-files.json'),
      ...(executable ? ['-AppExecutable', executable] : []),
      '-KeepBusiness', String(business), '-KeepHardware', String(hardware), '-KeepBackups', String(keepBackups)],
    { encoding: 'utf8', windowsHide: true });
  } };
}
test('Windows uninstaller handles all eight keep combinations and protects unsynced data', { skip: !windows }, t => {
  for (const business of [0, 1]) for (const hardware of [0, 1]) for (const backups of [0, 1]) {
    const f = fixture(t), result = f.run(business, hardware, backups);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(f.data, 'mongodb/data/sales.wt')), Boolean(business));
    assert.equal(fs.existsSync(path.join(f.data, 'preferences.json')), Boolean(hardware));
    assert.equal(fs.existsSync(path.join(f.backups, 'saved.json')), Boolean(backups));
    assert.equal(fs.existsSync(path.join(f.data, 'backups/fallback.json')), Boolean(backups));
    if (!business) {
      const archive = path.join(f.recovery, fs.readdirSync(f.recovery)[0]);
      assert.equal(fs.readFileSync(path.join(archive, 'mongodb/data/sales.wt'), 'utf8'), 'offline sale');
      assert.equal(fs.readFileSync(path.join(archive, 'preferences.json'), 'utf8'), 'printer settings');
    }
  }
});

test('Windows uninstaller refuses to change data while its application is running', { skip: !windows }, t => {
  const f = fixture(t);
  const result = f.run(0, 0, 0, process.execPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /still running/);
  assert.equal(fs.readFileSync(path.join(f.data, 'mongodb/data/sales.wt'), 'utf8'), 'offline sale');
  assert.equal(fs.existsSync(f.recovery), false);
});
test('Windows recovery failure stops before deleting business data or backups', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.recovery, 'blocked destination');
  assert.notEqual(f.run(0, 0, 0).status, 0);
  assert.equal(fs.readFileSync(path.join(f.data, 'mongodb/data/sales.wt'), 'utf8'), 'offline sale');
  assert.equal(fs.readFileSync(path.join(f.backups, 'saved.json'), 'utf8'), 'old backup');
});
