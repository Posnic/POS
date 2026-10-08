'use strict';
const fs = require('node:fs');

// Package roots are service-owned. Never follow a final symlink, and bound
// reads through the same descriptor we inspect, including concurrent growth.
function readExtensionFile(filename, limit) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const info = fs.fstatSync(fd);
    const named = fs.lstatSync(filename);
    if (!info.isFile() || named.isSymbolicLink() || named.dev !== info.dev ||
        named.ino !== info.ino || info.size > limit) {
      throw new Error('extension_file_invalid');
    }
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== info.size) throw new Error('extension_file_invalid');
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
async function readExtensionFileAsync(filename, limit) {
  const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    const named = await fs.promises.lstat(filename);
    if (!info.isFile() || named.isSymbolicLink() || named.dev !== info.dev ||
        named.ino !== info.ino || info.size > limit) {
      throw new Error('extension_file_invalid');
    }
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) throw new Error('extension_file_invalid');
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
module.exports = { readExtensionFile, readExtensionFileAsync };
