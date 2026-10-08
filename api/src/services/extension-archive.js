'use strict';
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const {
  safePath,
  verifyExtensionPackage,
  MAX_FILES,
  MAX_BYTES,
} = require('../../../src/extension-package');
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const failure = (code) => Object.assign(new Error(code), { code, status: 422 });

/** Read a bounded upload completely in memory. Nothing is extracted or
 * executed until every entry and the signed package have been verified.
 * The caller must also bound its HTTP/file input before allocating the buffer.
 */
async function readArchive(input, options, verifyPackage) {
  if (!Buffer.isBuffer(input)) throw failure('extension_archive_size_invalid');
  const size = Buffer.byteLength(input);
  if (size === 0 || size > MAX_ARCHIVE_BYTES) throw failure('extension_archive_size_invalid');
  const archive = Buffer.from(input);
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      archive,
      {
        lazyEntries: true,
        autoClose: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, result) => (error ? reject(failure('extension_archive_invalid')) : resolve(result))
    )
  );
  if (zip.entryCount < 3 || zip.entryCount > MAX_FILES * 4) {
    zip.close();
    throw failure('extension_archive_entry_limit');
  }
  return new Promise((resolve, reject) => {
    const names = new Map(),
      files = new Map();
    let expanded = 0,
      readBytes = 0,
      count = 0,
      finished = false,
      active;
    const stop = (error) => {
      if (finished) return;
      finished = true;
      active?.destroy();
      zip.close();
      reject(error.code?.startsWith('extension_') ? error : failure('extension_archive_invalid'));
    };
    zip.on('error', stop);
    zip.on('entry', async (entry) => {
      try {
        if (++count > MAX_FILES * 4) throw failure('extension_archive_entry_limit');
        const directory = entry.fileName.endsWith('/');
        const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
        const key = name.toLowerCase();
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (!safePath(name) || names.has(key)) throw failure('extension_archive_path_invalid');
        if (type && type !== (directory ? 0o040000 : 0o100000))
          throw failure('extension_archive_special_file');
        if (
          entry.externalFileAttributes & 0x400 ||
          (!directory && entry.externalFileAttributes & 0x10)
        )
          throw failure('extension_archive_special_file');
        if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod))
          throw failure('extension_archive_encoding_invalid');
        // A regular file cannot also be another entry's parent, including
        // case-folded Windows paths. Explicit directory entries are optional.
        for (const [existing, isDirectory] of names) {
          if (
            (!isDirectory && key.startsWith(`${existing}/`)) ||
            (!directory && existing.startsWith(`${key}/`))
          )
            throw failure('extension_archive_path_invalid');
        }
        names.set(key, directory);
        if (
          !Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 ||
          !Number.isSafeInteger(entry.compressedSize) ||
          entry.compressedSize < 0
        )
          throw failure('extension_archive_size_invalid');
        if (directory) {
          if (entry.uncompressedSize || entry.compressedSize)
            throw failure('extension_archive_directory_payload');
          zip.readEntry();
          return;
        }
        if (files.size >= MAX_FILES + 1) throw failure('extension_archive_entry_limit');
        const limit = name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_BYTES;
        expanded += entry.uncompressedSize;
        if (entry.uncompressedSize > limit || expanded > MAX_BYTES + MAX_MANIFEST_BYTES)
          throw failure('extension_archive_expansion_limit');
        const stream = await new Promise((resolveStream, rejectStream) =>
          zip.openReadStream(entry, (error, value) =>
            error ? rejectStream(error) : resolveStream(value)
          )
        );
        active = stream;
        const chunks = [];
        let length = 0;
        for await (const chunk of stream) {
          length += chunk.length;
          readBytes += chunk.length;
          if (
            length > entry.uncompressedSize ||
            length > limit ||
            readBytes > MAX_BYTES + MAX_MANIFEST_BYTES
          )
            throw failure('extension_archive_expansion_limit');
          chunks.push(chunk);
        }
        active = null;
        if (length !== entry.uncompressedSize) throw failure('extension_archive_size_invalid');
        files.set(name, Buffer.concat(chunks, length));
        if (!finished) zip.readEntry();
      } catch (error) {
        stop(error);
      }
    });
    zip.on('end', () => {
      if (finished) return;
      try {
        const bytes = files.get('manifest.json');
        if (!bytes) throw failure('extension_manifest_missing');
        const manifest = JSON.parse(bytes.toString('utf8'));
        files.delete('manifest.json');
        const metadata = verifyPackage(manifest, files, options);
        // Directory names are structural only; no unsigned empty directories
        // are carried into the installation.
        finished = true;
        resolve({
          manifest,
          manifestBytes: bytes,
          contents: files,
          metadata,
          packageDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
      } catch (error) {
        stop(error);
      }
    });
    zip.readEntry();
  });
}
const readExtensionArchive = (input, options) =>
  readArchive(input, options, verifyExtensionPackage);
const readSourceArchive = (input, options) =>
  readArchive(input, options, require('./extension-source-package').verifySourcePackage);
module.exports = { readExtensionArchive, readSourceArchive, MAX_ARCHIVE_BYTES, MAX_MANIFEST_BYTES };
