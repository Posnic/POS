'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibraryStorage } = require('../src/services/extension-library-storage');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'posnic-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: await createLibraryStorage(root) };
}
test('concurrent publication is immutable and restart preserves verified bytes', async (t) => {
  const { root, store } = await fixture(t),
    bytes = Buffer.from('private synthetic ZIP');
  const results = await Promise.all(Array.from({ length: 30 }, () => store.put(bytes)));
  assert.equal(new Set(results.map((row) => row.sha256)).size, 1);
  assert.deepEqual(await fs.readdir(root), [results[0].sha256 + '.zip']);
  assert.deepEqual(await (await createLibraryStorage(root)).read(results[0].sha256), bytes);
});
test('traversal, invalid digests and invalid publication input are rejected', async (t) => {
  const { store } = await fixture(t);
  for (const value of ['../secret', 'A'.repeat(64), '', null, {}])
    await assert.rejects(store.read(value));
  for (const value of ['', Buffer.alloc(0), null, {}]) await assert.rejects(store.put(value));
  await assert.rejects(createLibraryStorage('relative/path'));
});
test('corrupt existing objects are neither served nor silently overwritten', async (t) => {
  const { root, store } = await fixture(t),
    bytes = Buffer.from('original');
  const artifact = await store.put(bytes),
    target = path.join(root, artifact.sha256 + '.zip');
  await fs.writeFile(target, 'modified');
  await assert.rejects(store.read(artifact.sha256), /unavailable/);
  await assert.rejects(store.put(bytes), /unavailable/);
  assert.equal(await fs.readFile(target, 'utf8'), 'modified');
  assert.deepEqual(await fs.readdir(root), [artifact.sha256 + '.zip']);
});
test('publication snapshots caller memory and incomplete files are not addressable', async (t) => {
  const { root, store } = await fixture(t),
    bytes = Buffer.from('original');
  const pending = store.put(bytes);
  bytes.fill(0);
  const artifact = await pending;
  assert.equal((await store.read(artifact.sha256)).toString(), 'original');
  await fs.writeFile(path.join(root, '.interrupted.tmp'), 'incomplete');
  await assert.rejects(store.read('.interrupted.tmp'));
});
test('linked roots and directory objects cannot become downloadable artifacts', async (t) => {
  const { root, store } = await fixture(t);
  const linked = root + '-link';
  await fs.symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.unlink(linked));
  await assert.rejects(createLibraryStorage(linked), /unavailable/);
  const digest = 'a'.repeat(64);
  await fs.mkdir(path.join(root, digest + '.zip'));
  await assert.rejects(store.read(digest), /unavailable/);
});
test('oversized stored objects are rejected before reading their contents', async (t) => {
  const { root, store } = await fixture(t),
    digest = 'b'.repeat(64);
  const handle = await fs.open(path.join(root, digest + '.zip'), 'wx');
  try {
    await handle.truncate(100 * 1024 * 1024 + 1);
  } finally {
    await handle.close();
  }
  await assert.rejects(store.read(digest), /unavailable/);
});
