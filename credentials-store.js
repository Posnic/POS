/*
 * The one place that reads and writes .mongodb-credentials.json.
 *
 * Nine files touched that path directly - main.js, setup-mongodb.js,
 * mongodb-manager.js, sync-agent-manager.js, install.service.js - each with its
 * own JSON.parse and its own idea of which candidate directory to look in.
 * Encrypting the password in nine places would have meant nine chances to get
 * the migration wrong, so it happens here instead and the callers ask for
 * credentials rather than for a file.
 *
 * The file used to hold the password in the clear. Now:
 *
 *   { username, password: { v, alg, iv, tag, ct }, enc: 1 }
 *
 * The key lives beside it in .credential-key.json, wrapped by the operating
 * system's keystore where there is one. Deliberately its own file rather than a
 * field in .local-secrets.json: that file is owned by main.js and read during
 * startup, and two writers on one file is a race waiting to happen.
 *
 * Reading tolerates both shapes. An install made before this change has a plain
 * string, which is read as-is and rewritten encrypted the next time anything
 * saves - so the upgrade needs no flag day, no prompt and no migration step
 * that could half-finish.
 *
 * What this is worth, and what it is not, is set out in local-crypto.js. In
 * short: a copied file is dead, casual reading and generic stealers are
 * stopped, and anyone targeting Posnic specifically is not.
 */

const fs = require('fs');
const path = require('path');
const lc = require('./local-crypto');

const CREDENTIALS_FILE = '.mongodb-credentials.json';
const KEY_FILE = '.credential-key.json';

/* Only the password is secret. The username and the host are not worth hiding
   and keeping them readable makes the file diagnosable by a human who is
   entitled to see it. */
const ENCRYPTED_FIELDS = ['password'];

function keyPath(baseDir) {
  return path.join(baseDir, KEY_FILE);
}

/**
 * The per-install key, created on first use.
 *
 * Never throws for a reason a caller could not act on: if the key file cannot
 * be read or unwrapped - a different Windows account, a rebuilt profile - this
 * reports it rather than inventing a new key, because inventing one silently
 * would make the existing credential undecryptable with no explanation.
 */
function getOrCreateKey(baseDir, safeStorage) {
  const file = keyPath(baseDir);

  if (fs.existsSync(file)) {
    let descriptor;
    try {
      descriptor = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new lc.DecryptionFailed('the key file is unreadable', error);
    }
    return lc.unprotectKey(descriptor, safeStorage);
  }

  const key = lc.newKey();
  const descriptor = lc.protectKey(key, safeStorage);
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(descriptor), { mode: 0o600 });
  return key;
}

/** Has this install got a key yet? Used to decide whether reading can succeed. */
function hasKey(baseDir) {
  return fs.existsSync(keyPath(baseDir));
}

/**
 * Read credentials from the first candidate path that has them.
 *
 * Returns { username, password, uri, path, wasPlaintext } or null. wasPlaintext
 * tells the caller this install predates encryption, which is the signal to
 * write it back.
 */
function read(candidatePaths, baseDir, safeStorage) {
  for (const file of candidatePaths) {
    if (!fs.existsSync(file)) continue;

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // truncated or hand-edited; try the next candidate
    }

    const encrypted = ENCRYPTED_FIELDS.some((f) => lc.isEnvelope(raw[f]));
    if (!encrypted) {
      /* Written before this change, or by a build that could not encrypt. */
      return { ...raw, path: file, wasPlaintext: true };
    }

    const key = getOrCreateKey(baseDir, safeStorage);
    const out = { ...raw, path: file, wasPlaintext: false };
    for (const field of ENCRYPTED_FIELDS) {
      if (lc.isEnvelope(raw[field])) out[field] = lc.decrypt(raw[field], key);
    }

    /* The stored uri had the password in it, which defeats the point. Rebuild
       it from the parts so it never has to be written down. */
    if (out.username && out.password) out.uri = buildUri(out, raw.uri);
    return out;
  }
  return null;
}

/**
 * Rebuild the connection string from its parts.
 *
 * Keeps whatever host, database and options the stored uri had - the port is
 * derived per install, so it cannot be assumed - and replaces only the
 * credentials.
 */
function buildUri({ username, password }, previousUri) {
  const fallback = `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro?authSource=admin`;
  const source = previousUri || fallback;

  try {
    const url = new URL(source);
    url.username = encodeURIComponent(username);
    url.password = encodeURIComponent(password);
    return url.toString();
  } catch {
    /* A stored uri we cannot parse. Build a plain one rather than returning
       something that will fail later in a less obvious place. */
    const tail = fallback.slice(fallback.indexOf('localhost'));
    return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${tail}`;
  }
}

/**
 * Write credentials, encrypted, to every path given.
 *
 * Writes to all of them because the readers look in several places and an
 * install can legitimately have more than one - leaving a stale plaintext copy
 * behind would undo the whole exercise.
 */
function write(targetPaths, credentials, baseDir, safeStorage) {
  const key = getOrCreateKey(baseDir, safeStorage);

  const payload = { ...credentials };
  delete payload.path;
  delete payload.wasPlaintext;

  for (const field of ENCRYPTED_FIELDS) {
    if (typeof payload[field] === 'string') payload[field] = lc.encrypt(payload[field], key);
  }

  /* The assembled uri carries the password, so it is not stored. read()
     rebuilds it, and keeping the shape lets an older build still find its
     host and database. */
  if (payload.uri) {
    try {
      const url = new URL(payload.uri);
      url.username = '';
      url.password = '';
      payload.uri = url.toString();
    } catch {
      delete payload.uri;
    }
  }
  payload.enc = lc.ENVELOPE_VERSION;

  const written = [];
  for (const file of targetPaths) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
      written.push(file);
    } catch (error) {
      /* One unwritable location must not lose the others - a packaged install
         has read-only directories among its candidates. */
      console.warn(`[credentials] could not write ${file}: ${error.message}`);
    }
  }
  return written;
}

module.exports = {
  read,
  write,
  getOrCreateKey,
  hasKey,
  buildUri,
  CREDENTIALS_FILE,
  KEY_FILE,
  ENCRYPTED_FIELDS,
};
