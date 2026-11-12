"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hasRealKeystore } = require('./local-crypto');
const FILE = '.books-payment-authority.json';
const createdThisProcess = new Set();
function fail() {
  throw Object.assign(new Error('Original Books payment installation identity is unavailable. Restore or review the original installation; do not create a replacement for existing payments.'), { code: 'BOOKS_AUTHORITY_UNAVAILABLE' });
}
// Desktop-shell only. The caller supplies its own data directory and explicitly
// authorizes first-time creation after verifying there is no prior receipt owner.
// Never call with a browser-provided path or use a synced database UUID instead.
function load({ directory, safeStorage, allowCreate = false }) {
  if (!hasRealKeystore(safeStorage)) fail();
  let canonical;
  try { canonical = fs.realpathSync(directory); } catch { fail(); }
  const binding = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const file = path.join(canonical, FILE);
  function read() {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) fail();
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (envelope.version !== 1 || envelope.scheme !== 'safeStorage' ||
          typeof envelope.value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.value)) fail();
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.value, 'base64')));
      if (value.version !== 1 || value.directory !== binding ||
          typeof value.authority !== 'string' || !/^books-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.authority)) fail();
      return Object.freeze({ version: 1, authority: value.authority, requiresRestart: createdThisProcess.has(file) });
    } catch { fail(); }
  }
  try { fs.lstatSync(file); return read(); } catch (error) {
    if (error.code !== 'ENOENT' || allowCreate !== true) fail();
  }
  let encrypted;
  try {
    encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, authority: 'books-' + randomUUID(), directory: binding }));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) fail();
  } catch { fail(); }
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    // Electron may persist its OS encryption key only during normal shutdown.
    // Payment activation must wait for a fresh process to reopen this identity.
    createdThisProcess.add(file);
    fs.writeFileSync(fd, JSON.stringify({ version: 1, scheme: 'safeStorage', value: encrypted.toString('base64') }));
    fs.fsyncSync(fd);
  } catch (error) {
    // A concurrent creator owns the existing file. Corrupt/partial originals
    // stay held rather than being silently replaced or given another identity.
    if (error.code !== 'EEXIST') fail();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  return read();
}
module.exports = { load, FILE };
