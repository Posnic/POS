const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const BackupManager = require('../src/backup-manager');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-backup-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new BackupManager({ userDataPath: root, getMongoUri: () => { throw new Error('Database must not be touched'); } });
  manager.grantBackupPath(root);
  manager.saveConfig({ path: root });
  return { manager, root };
}

test('same-timestamp dedup cannot remove the earlier successful backup', async t => {
  const { manager, root } = setup(t);
  manager._formatTimestamp = () => 'same-second';
  manager._dumpDatabase = async () => ({ collections: [], totalDocs: 0, totalSize: 0, dataHash: 'unchanged' });
  const first = await manager.runBackup();
  const second = await manager.runBackup();
  assert.equal(first.success, true);
  assert.equal(second.skipped, true);
  assert.equal(fs.existsSync(path.join(first.path, 'manifest.json')), true);
  assert.equal(fs.readdirSync(root).filter(n => n.startsWith('posnic-backup-')).length, 1);
});

for (const issue of ['missing', 'corrupt', 'checksum']) {
  test('restore preflight rejects ' + issue + ' files before connecting to database', async t => {
    const { manager, root } = setup(t);
    const folder = path.join(root, 'posnic-backup-damaged'); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ version: '2.0', format: 'ejson', collections: [{ name: 'items', documents: 1, hash: 'wrong' }] }));
    if (issue !== 'missing') fs.writeFileSync(path.join(folder, 'items.json.gz'), issue === 'corrupt' ? Buffer.from('broken') : zlib.gzipSync('[{"name":"changed"}]'));
    const result = await manager.restoreBackup(folder, { dropExisting: true });
    assert.equal(result.success, false);
    assert.doesNotMatch(result.error, /Database must not be touched/);
  });
}

test('failed collection export cannot report a successful backup', async t => {
  const { manager } = setup(t);
  manager._dumpDatabase = async () => ({ collections: [{ name: 'sales', error: 'read failed' }], totalDocs: 0, totalSize: 0, dataHash: '' });
  const result = await manager.runBackup();
  assert.equal(result.success, false);
  assert.equal(manager.loadConfig().status, 'failed');
});
