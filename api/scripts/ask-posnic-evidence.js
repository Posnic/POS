'use strict';
const fs = require('node:fs');
const LIMIT = 16000;

// Open once: a pathname replacement cannot change what was checked. Reading
// at most LIMIT + 1 bytes also catches growth after fstat without allocating it.
function readEvidence(file) {
  if (typeof file !== 'string' || !file) throw new Error('Supply a provider evidence JSON file smaller than 16 KB.');
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('Supply a provider evidence JSON file smaller than 16 KB.');
    const buffer = Buffer.alloc(LIMIT + 1);
    let size = 0, read;
    do { read = fs.readSync(fd, buffer, size, buffer.length - size, size); size += read; } while (read && size < buffer.length);
    if (size > LIMIT) throw new Error('Supply a provider evidence JSON file smaller than 16 KB.');
    return JSON.parse(buffer.toString('utf8', 0, size));
  } finally { fs.closeSync(fd); }
}

module.exports = { readEvidence };
