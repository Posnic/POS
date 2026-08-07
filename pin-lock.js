'use strict';
/*
 * Unlocking a till with a PIN.
 *
 * The rule this is built on: a PIN unlocks, a password authenticates. A PIN
 * may only resume a session that a password already established on this
 * machine. It never creates one from nothing and it never leaves the till.
 *
 * That is not pedantry, it decides how this is stored. Four digits is ten
 * thousand combinations, so a stored PIN *hash* would be brute-forced offline
 * in milliseconds whatever algorithm produced it. So nothing here stores a
 * hash to compare against. The PIN derives a key, and that key is the only
 * thing that can decrypt the session token. A wrong PIN does not fail a
 * comparison - it produces a wrong key, the authentication tag does not
 * verify, and there is simply no token to be had.
 *
 * Two more things make the derived key worth having:
 *
 *   scrypt, tuned so one attempt costs about a tenth of a second. Unnoticeable
 *   to a cashier; ten thousand of them is a quarter of an hour rather than an
 *   instant.
 *
 *   the machine's own install secret is mixed into the salt, so this file
 *   copied to another computer decrypts to nothing at all.
 *
 * And five wrong tries wipe the blob, which ends the guessing on the machine
 * itself. What it cannot stop is somebody who copies the file first and has
 * time - for them the password is the real boundary, and it always still is.
 * This is proportionate for a shared till in a shop, and is not claimed to be
 * more than that.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_FAILURES = 5;

// scrypt cost. N=2^15 lands near 100ms on the low-powered boxes these tills
// tend to be, which is the most that can be spent without the keypad feeling
// broken.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

class PinLock {
  /*
   * `installSecret` ties the file to this machine. It is not a substitute for
   * the PIN - it lives on the same disk - but it means the blob alone, carried
   * to another computer, is useless.
   */
  constructor({ file, installSecret = '' } = {}) {
    this.file = file;
    this.installSecret = installSecret;
  }

  _read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && parsed.users) return parsed;
    } catch (e) { /* first run, or the file was removed */ }
    return { version: 1, users: {} };
  }

  _write(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Owner only. On Windows this is advisory rather than enforced, which is
    // part of why the install secret and the attempt limit are both here.
    fs.writeFileSync(this.file, JSON.stringify(state), { mode: 0o600 });
  }

  _key(pin, saltHex) {
    const salt = Buffer.concat([
      Buffer.from(saltHex, 'hex'),
      Buffer.from(String(this.installSecret), 'utf8'),
    ]);
    return crypto.scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT);
  }

  /* Which users can unlock this till. */
  list() {
    const state = this._read();
    return Object.keys(state.users).map((username) => ({
      username,
      displayName: state.users[username].displayName || username,
      avatar: state.users[username].avatar || '',
    }));
  }

  isEnrolled(username) {
    return !!this._read().users[String(username || '').toLowerCase()];
  }

  /*
   * Remember this user on this till, behind a PIN.
   *
   * Called after a real password login, which is the only thing that can put a
   * session here in the first place.
   */
  enroll({ username, displayName, avatar, pin, session }) {
    const pinText = String(pin == null ? '' : pin);
    if (!/^\d{4,6}$/.test(pinText)) {
      throw new Error('A PIN is four to six digits.');
    }
    if (!username) throw new Error('A user is required.');
    // 1234, 0000, 1111 - the PINs that get tried first.
    if (isTooObvious(pinText)) {
      throw new Error('That PIN is too easy to guess. Choose another.');
    }

    const salt = crypto.randomBytes(16);
    const key = this._key(pinText, salt.toString('hex'));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(session || {}), 'utf8'),
      cipher.final(),
    ]);

    const state = this._read();
    state.users[String(username).toLowerCase()] = {
      displayName: displayName || username,
      avatar: avatar || '',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('hex'),
      failures: 0,
      enrolledAt: new Date().toISOString(),
    };
    this._write(state);
    return { success: true };
  }

  /*
   * Try a PIN.
   *
   * Returns the session on success. On failure it says how many tries are
   * left, because a cashier who has mistyped needs to know before the till
   * sends them back to the password screen mid-queue.
   */
  unlock({ username, pin }) {
    const key = String(username || '').toLowerCase();
    const state = this._read();
    const record = state.users[key];
    if (!record) return { success: false, reason: 'not-enrolled' };

    let session = null;
    try {
      const derived = this._key(String(pin == null ? '' : pin), record.salt);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm', derived, Buffer.from(record.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(record.data, 'hex')),
        decipher.final(),
      ]);
      session = JSON.parse(plain.toString('utf8'));
    } catch (e) {
      // The tag did not verify, which is what a wrong PIN looks like. There is
      // no other kind of failure worth telling apart here.
      record.failures = (record.failures || 0) + 1;
      const left = MAX_FAILURES - record.failures;
      if (left <= 0) {
        delete state.users[key];
        this._write(state);
        return { success: false, reason: 'locked-out', attemptsLeft: 0 };
      }
      this._write(state);
      return { success: false, reason: 'wrong-pin', attemptsLeft: left };
    }

    if (record.failures) {
      record.failures = 0;
      this._write(state);
    }
    return { success: true, session, displayName: record.displayName };
  }

  /* Deliberate logout, or a user removed from this till. */
  forget(username) {
    const state = this._read();
    delete state.users[String(username || '').toLowerCase()];
    this._write(state);
    return { success: true };
  }

  forgetAll() {
    this._write({ version: 1, users: {} });
    return { success: true };
  }
}

/*
 * The PINs an attacker tries first: repeated digits, runs up or down, and the
 * handful everybody picks. Rejecting them costs a cashier one retry at setup
 * and removes the guesses that would otherwise succeed inside five attempts.
 */
function isTooObvious(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const COMMON = ['1234', '4321', '0123', '1212', '2580', '1004', '2000',
    '123456', '654321', '111222'];
  if (COMMON.includes(pin)) return true;

  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i++) {
    if (+pin[i] !== +pin[i - 1] + 1) ascending = false;
    if (+pin[i] !== +pin[i - 1] - 1) descending = false;
  }
  return ascending || descending;
}

module.exports = { PinLock, isTooObvious, MAX_FAILURES };
