'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { readExtensionFileAsync } = require('../../../src/extension-file');
const MAX_BYTES = 100 * 1024 * 1024;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const unavailable = () => new Error('extension_library_storage_unavailable');

// This directory must be private to the registry service, outside every web
// root. Only trusted publication code receives put(); HTTP download code gets
// read alone. Content addressing is integrity, not publisher authorization.
async function createLibraryStorage(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw unavailable();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(root)).isSymbolicLink()) throw unavailable();
  const directory = await fs.realpath(root);
  const filename = (digest) => {
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw unavailable();
    return path.join(directory, digest + '.zip');
  };
  async function read(digest) {
    const target = filename(digest);
    let bytes;
    try {
      bytes = await readExtensionFileAsync(target, MAX_BYTES);
    } catch {
      throw unavailable();
    }
    if (!bytes.length || hash(bytes) !== digest) throw unavailable();
    return bytes;
  }
  async function put(input) {
    if (!Buffer.isBuffer(input) || input.length < 1 || input.length > MAX_BYTES)
      throw unavailable();
    // Snapshot caller-owned memory before the first asynchronous operation.
    const bytes = Buffer.from(input),
      sha256 = hash(bytes),
      target = filename(sha256);
    const temporary = path.join(directory, '.' + crypto.randomBytes(24).toString('hex') + '.tmp');
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      // A hard link publishes the fully written file without replacing an
      // existing object; concurrent uploads converge on the same digest.
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await read(sha256); // Fail closed on corruption instead of overwriting.
      return { sha256, bytes: bytes.length };
    } finally {
      await handle?.close();
      await fs.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  return { put, read };
}
module.exports = { createLibraryStorage };
