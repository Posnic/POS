/*
 * Encrypting the small secrets this application keeps on disk.
 *
 * The one that matters is the MongoDB password. It sat in
 * .mongodb-credentials.json as plain text, so `type` showed it, any backup or
 * synced folder carried it, and a generic credential stealer scanning for JSON
 * with a "password" field would find it without knowing anything about Posnic.
 *
 * What this does and does not achieve, stated plainly because the limit is not
 * obvious:
 *
 *   - A copied file is useless. The key stays on the machine.
 *   - Casual reading is stopped. There is nothing quotable in the file.
 *   - Generic stealers are stopped. They look for patterns, not for us.
 *   - Someone who has read this repository and is targeting Posnic is NOT
 *     stopped. They know which file holds the key.
 *   - Code already running as the till's user is NOT stopped. It can do
 *     everything this module does.
 *
 * That last pair is unavoidable for software that must boot and start selling
 * with nobody present: it has to reach its own secrets unaided, so anything
 * running as it can too. SECURITY.md says so out loud rather than implying
 * otherwise.
 *
 * Two layers, because they defend different things:
 *
 *   credentialKey  - random per install, from getLocalSecrets()
 *                    encrypts the secret
 *   safeStorage    - the operating system's own keystore, DPAPI on Windows
 *                    encrypts the credentialKey
 *
 * Without the second layer, copying both files to another machine works.
 * With it, the key is bound to this machine and this Windows account, so the
 * pair is inert anywhere else. safeStorage is not available everywhere, and
 * where it is missing this degrades to the first layer alone rather than
 * refusing to start - an unreadable secret must never stop a till.
 */

const crypto = require('crypto');

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, what GCM is specified for
const KEY_BYTES = 32; // AES-256

/* Thrown when a value cannot be recovered. The caller decides what to do -
   for the MongoDB credential that means rotating it rather than failing. */
class DecryptionFailed extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DecryptionFailed';
    this.code = 'DECRYPTION_FAILED';
  }
}

function keyBuffer(keyHex) {
  if (typeof keyHex !== 'string' || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new TypeError('key must be a hex string');
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new TypeError(`key must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars), got ${buf.length}`);
  }
  return buf;
}

/**
 * Is this value one of our envelopes rather than a plain string?
 *
 * Used to tell an already-encrypted field from one written by an older build,
 * which is what makes migration silent: read either, always write the new form.
 */
function isEnvelope(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.v === ENVELOPE_VERSION &&
    value.alg === ALGORITHM &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ct === 'string'
  );
}

/** Encrypt a string. Returns a plain object safe to JSON.stringify. */
function encrypt(plaintext, keyHex) {
  if (typeof plaintext !== 'string') throw new TypeError('plaintext must be a string');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ct: ct.toString('hex'),
  };
}

/**
 * Decrypt an envelope.
 *
 * GCM authenticates as well as encrypts, so a tampered ciphertext fails here
 * rather than returning plausible rubbish.
 */
function decrypt(envelope, keyHex) {
  if (!isEnvelope(envelope)) {
    throw new DecryptionFailed('not an encrypted value');
  }
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      keyBuffer(keyHex),
      Buffer.from(envelope.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    /* Wrong key, tampered ciphertext, truncated file - all land here, and the
       caller cannot usefully tell them apart. What it can do is rotate. */
    throw new DecryptionFailed('could not decrypt with this key', error);
  }
}

/**
 * The operating system's keystore, when there is a real one.
 *
 * Injectable so tests can drive both branches without Electron. In the
 * application this resolves to electron.safeStorage.
 */
function defaultSafeStorage() {
  try {
    // eslint-disable-next-line global-require
    return require('electron').safeStorage;
  } catch {
    return null; // not running under Electron: a script, or a test
  }
}

/**
 * Is safeStorage backed by something real?
 *
 * On Linux, Electron reports encryption as "available" even when it has fallen
 * back to a hardcoded key because no secret service is running. That backend is
 * called basic_text and it is obfuscation, not encryption, so it is refused
 * here - storing the key in the clear and saying so is more honest than
 * pretending it is protected.
 */
function hasRealKeystore(safeStorage = defaultSafeStorage()) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') return false;
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true; // Windows and macOS do not expose a backend name
  } catch {
    return false;
  }
}

/**
 * Wrap the per-install key with the OS keystore, if there is one.
 *
 * Returns a descriptor recording which scheme was used, so unprotectKey does
 * not have to guess and a machine that loses its keystore produces a clear
 * failure rather than a silent wrong answer.
 */
function protectKey(keyHex, safeStorage = defaultSafeStorage()) {
  keyBuffer(keyHex); // validate before storing
  if (hasRealKeystore(safeStorage)) {
    try {
      return {
        v: ENVELOPE_VERSION,
        scheme: 'safeStorage',
        value: safeStorage.encryptString(keyHex).toString('base64'),
      };
    } catch {
      /* Fall through: a keystore that is present but refusing is no better
         than one that is absent, and neither is a reason to fail to start. */
    }
  }
  return { v: ENVELOPE_VERSION, scheme: 'plain', value: keyHex };
}

/** Recover the per-install key. Throws DecryptionFailed if it cannot. */
function unprotectKey(descriptor, safeStorage = defaultSafeStorage()) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new DecryptionFailed('no key descriptor');
  }
  if (descriptor.scheme === 'plain') return descriptor.value;
  if (descriptor.scheme !== 'safeStorage') {
    throw new DecryptionFailed(`unknown key protection scheme: ${descriptor.scheme}`);
  }
  if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
    throw new DecryptionFailed('this key needs the OS keystore, which is unavailable');
  }
  try {
    return safeStorage.decryptString(Buffer.from(descriptor.value, 'base64'));
  } catch (error) {
    /* A different Windows account, or a rebuilt profile. The key is gone; the
       caller rotates rather than reporting a failure to the shop. */
    throw new DecryptionFailed('the OS keystore could not unwrap this key', error);
  }
}

/** A fresh per-install key. */
function newKey() {
  return crypto.randomBytes(KEY_BYTES).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  isEnvelope,
  protectKey,
  unprotectKey,
  hasRealKeystore,
  newKey,
  DecryptionFailed,
  ENVELOPE_VERSION,
  KEY_BYTES,
};
