/*
 * Encrypting individual fields that are credentials rather than business data.
 *
 * There is already an Encryption class in this directory and it must not be
 * used for this. It exists to match the legacy PHP implementation byte for
 * byte so receipt links stay interoperable, which means AES-256-CBC with a
 * fixed IV derived from configuration. Correct for encoding an id into a URL,
 * wrong for a secret: a fixed IV makes the same plaintext produce the same
 * ciphertext every time, and CBC without authentication can be altered by
 * someone who cannot read it.
 *
 * This uses AES-256-GCM with a random IV per value, so two shops with the same
 * SMTP password produce different ciphertext and tampering is detected.
 *
 * The key is ENCRYPTION_KEY, which main.js sets from the per-install secrets it
 * generates on first run. It is hashed to the 32 bytes AES-256 needs rather
 * than used raw, because that value is 16 bytes of hex and the shape of what is
 * in the environment should not decide the strength of the cipher.
 *
 * What this protects, honestly: the raw database files. Someone who copies
 * mongodb/data off a disk gets ciphertext for these fields instead of a
 * merchant's Razorpay secret. It does not protect against code running as the
 * till's user - that code can read ENCRYPTION_KEY the same way this does. The
 * full reasoning is in SECURITY.md.
 */

const crypto = require('crypto');
const { currentSecret } = require('../db/tenant-context');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 1;

/* Marks a value as one of ours. Without it there is no way to tell an
   encrypted field from a shop that genuinely typed something base64-shaped. */
const PREFIX = 'enc:v1:';

function key() {
  /* Per shop, resolved per call. Reading this from the environment in a process
     serving several shops would encrypt one customer's records with another's
     key - and, worse, decrypt them with it, so the damage would be invisible
     until the two were separated again. */
  const material = currentSecret('ENCRYPTION_KEY');
  if (!material) {
    throw new Error(
      'ENCRYPTION_KEY is not set, so secret fields cannot be encrypted. ' +
        'main.js sets it from the per-install secrets; a standalone API needs it in .env.'
    );
  }
  /* A hash rather than the raw value: ENCRYPTION_KEY is 16 bytes of hex, and
     AES-256 needs 32 bytes. Hashing gives a full-length key from whatever
     length the environment happens to hold. */
  return crypto.createHash('sha256').update(String(material)).digest();
}

/** Is this value already encrypted by us? */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a field value.
 *
 * Empty values are returned untouched. A shop that has not configured a
 * payment gateway has an empty string there, and encrypting it would turn
 * "not set" into something that looks set.
 */
function encryptField(value) {
  if (value === null || value === undefined || value === '') return value;
  if (isEncrypted(value)) return value; // already done; do not double-wrap
  if (typeof value !== 'string') {
    throw new TypeError('only string fields can be encrypted');
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return (
    PREFIX +
    [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
  );
}

/**
 * Decrypt a field value.
 *
 * A value that was never encrypted is returned as it is, which is what makes
 * this safe to apply to a database written by an older build: reading works
 * either way, and the next write encrypts.
 */
function decryptField(value) {
  if (!isEncrypted(value)) return value;

  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('encrypted field is malformed');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8'
  );
}

/**
 * Walk an object and encrypt the fields a policy says to encrypt.
 *
 * Nested one level, because payment_gateway is an object of { key, secret }
 * rather than a string - the whole object is the credential, so both of its
 * meaningful members are covered.
 */
function encryptObjectFields(object, fieldNames) {
  if (!object || typeof object !== 'object') return object;
  const out = Array.isArray(object) ? [...object] : { ...object };

  for (const name of fieldNames) {
    const value = out[name];
    if (typeof value === 'string') {
      out[name] = encryptField(value);
    } else if (value && typeof value === 'object') {
      out[name] = encryptCredentialObject(value);
    }
  }
  return out;
}

/* A credential held as an object - { key, secret, name, status }. Only the
   parts that are secret are encrypted; the provider name and the on/off flag
   stay readable so a settings page can render without a key. */
const SECRET_MEMBERS = new Set(['key', 'secret', 'password', 'token', 'apiKey', 'api_key']);

function encryptCredentialObject(value) {
  if (Array.isArray(value)) return value.map(encryptCredentialObject);
  if (!value || typeof value !== 'object') return value;

  const out = { ...value };
  for (const [member, inner] of Object.entries(out)) {
    if (SECRET_MEMBERS.has(member) && typeof inner === 'string') {
      out[member] = encryptField(inner);
    }
  }
  return out;
}

function decryptCredentialObject(value) {
  if (Array.isArray(value)) return value.map(decryptCredentialObject);
  if (!value || typeof value !== 'object') return value;

  const out = { ...value };
  for (const [member, inner] of Object.entries(out)) {
    if (typeof inner === 'string' && isEncrypted(inner)) {
      out[member] = decryptField(inner);
    }
  }
  return out;
}

module.exports = {
  encryptField,
  decryptField,
  isEncrypted,
  encryptObjectFields,
  encryptCredentialObject,
  decryptCredentialObject,
  PREFIX,
  VERSION,
};
