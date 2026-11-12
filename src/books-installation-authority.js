"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hasRealKeystore } = require('./local-crypto');
const FILE = '.books-payment-authority.json';
const MARKER = '.books-payment-authority.created';
const preparations = new Map();
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
  const marker = path.join(canonical, MARKER);
  function markCreated(exclusive = false) {
    let markerFd;
    try {
      markerFd = fs.openSync(marker, 'wx', 0o600);
      fs.writeFileSync(markerFd, JSON.stringify({version:1,createdAt:new Date().toISOString()}));
      fs.fsyncSync(markerFd);
    } catch (error) {
      if (error.code !== 'EEXIST' || exclusive) fail();
      const stat = fs.lstatSync(marker);
      if (!stat.isFile() || stat.isSymbolicLink()) fail();
    } finally { if (markerFd !== undefined) fs.closeSync(markerFd); }
  }

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
  try { fs.lstatSync(file); const original=read(); markCreated(); return original; } catch (error) {
    if (error.code !== 'ENOENT' || allowCreate !== true) fail();
  }
  try { fs.lstatSync(marker); fail(); } catch (error) { if (error.code !== 'ENOENT') fail(); }
  let encrypted;
  try {
    encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, authority: 'books-' + randomUUID(), directory: binding }));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) fail();
  } catch { fail(); }
  let fd;
  try {
    markCreated(true);
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
async function prepare({directory,safeStorage,assertUnused}) {
  const canonical=fs.realpathSync(directory);
  const key=process.platform==='win32'?canonical.toLowerCase():canonical;
  if(preparations.has(key))return preparations.get(key);
  const pending=(async()=>{
    try { fs.lstatSync(path.join(canonical,FILE)); return load({directory:canonical,safeStorage}); }
    catch(error){if(error.code!=='ENOENT')throw error;}
    try { fs.lstatSync(path.join(canonical,MARKER)); fail(); } catch(error){if(error.code!=='ENOENT')fail();}
    if(typeof assertUnused!=='function')fail();
    if(await assertUnused()!==true)fail();
    return load({directory:canonical,safeStorage,allowCreate:true});
  })();
  preparations.set(key,pending);
  try{return await pending;}finally{if(preparations.get(key)===pending)preparations.delete(key);}
}
module.exports = { load, prepare, FILE, MARKER };
