'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migrateUploads } = require('../src/uploads-migration');

for (const kind of ['runtime', ...(process.platform === 'win32' ? ['installer'] : [])]) {
  test(`${kind} upgrade preserves nested images and newer retained versions`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-images-'));
    try {
      const source = path.join(root, 'legacy');
      const destination = path.join(root, 'retained');
      fs.mkdirSync(path.join(source, 'demo'), { recursive: true });
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(source, 'demo', 'image.jpg'), 'image bytes');
      fs.writeFileSync(path.join(source, 'existing.jpg'), 'old');
      fs.writeFileSync(path.join(destination, 'existing.jpg'), 'new');
      for (let n = 0; n < 2; n++) {
        if (kind === 'runtime') migrateUploads(source, destination);
        else {
          const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('builds/migrate-uploads.ps1'), '-Source', source, '-Destination', destination], { env: { ...process.env, POSNIC_USER_DATA: '' }, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stdout + result.stderr);
        }
      }
      assert.equal(fs.readFileSync(path.join(destination, 'demo', 'image.jpg'), 'utf8'), 'image bytes');
      assert.equal(fs.readFileSync(path.join(destination, 'existing.jpg'), 'utf8'), 'new');
      assert.equal(fs.readFileSync(path.join(source, 'existing.jpg'), 'utf8'), 'old');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
