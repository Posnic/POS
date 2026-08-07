/*
 * local-crypto.js, proved on its own before anything depends on it.
 *
 * This is the module that stops the MongoDB password being readable with
 * `type`. Everything about it that can be wrong silently - a wrong key that
 * returns rubbish instead of failing, a tampered file that decrypts anyway, a
 * missing keystore that stops the till starting - is checked here.
 */

const test = require('node:test');
const assert = require('node:assert');
const lc = require('../local-crypto');

const SECRET = 'JstHH8Az3bJaqE*^9YUM';

test('a secret survives a round trip', () => {
  const key = lc.newKey();
  const sealed = lc.encrypt(SECRET, key);
  assert.strictEqual(lc.decrypt(sealed, key), SECRET);
});

test('the sealed value contains nothing readable', () => {
  /* The whole point. If the password appears anywhere in the envelope - or in
     its JSON form, which is what lands on disk - this has achieved nothing. */
  const key = lc.newKey();
  const sealed = lc.encrypt(SECRET, key);
  const onDisk = JSON.stringify(sealed);

  assert.ok(!onDisk.includes(SECRET), 'the plaintext is in the file');
  for (const fragment of ['JstHH', 'Az3bJ', '9YUM']) {
    assert.ok(!onDisk.includes(fragment), `a fragment of the secret survived: ${fragment}`);
  }
});

test('the same secret encrypts differently every time', () => {
  /* A fresh IV per encryption. Without it, two shops with the same password
     produce the same ciphertext, and a changed password is visible as a
     changed file even to someone who cannot read either. */
  const key = lc.newKey();
  const a = lc.encrypt(SECRET, key);
  const b = lc.encrypt(SECRET, key);
  assert.notStrictEqual(a.iv, b.iv);
  assert.notStrictEqual(a.ct, b.ct);
  assert.strictEqual(lc.decrypt(a, key), lc.decrypt(b, key));
});

test('a wrong key fails loudly rather than returning rubbish', () => {
  const sealed = lc.encrypt(SECRET, lc.newKey());
  assert.throws(
    () => lc.decrypt(sealed, lc.newKey()),
    (e) => e.code === 'DECRYPTION_FAILED',
    'decrypting with the wrong key must fail, not produce a plausible string',
  );
});

test('tampering is detected', () => {
  /* GCM authenticates. Someone who cannot read the file must not be able to
     usefully change it either - flipping a byte of ciphertext should fail
     rather than silently alter the password the application then uses. */
  const key = lc.newKey();
  const sealed = lc.encrypt(SECRET, key);

  const flipped = { ...sealed, ct: (sealed.ct[0] === 'a' ? 'b' : 'a') + sealed.ct.slice(1) };
  assert.throws(() => lc.decrypt(flipped, key), (e) => e.code === 'DECRYPTION_FAILED');

  const badTag = { ...sealed, tag: (sealed.tag[0] === 'a' ? 'b' : 'a') + sealed.tag.slice(1) };
  assert.throws(() => lc.decrypt(badTag, key), (e) => e.code === 'DECRYPTION_FAILED');
});

test('plaintext is recognised as not-an-envelope, so migration can be silent', () => {
  /* An existing install has a plain string here. Reading it must be
     distinguishable from reading an encrypted value, or the upgrade needs a
     flag day. */
  assert.strictEqual(lc.isEnvelope(SECRET), false);
  assert.strictEqual(lc.isEnvelope(null), false);
  assert.strictEqual(lc.isEnvelope(undefined), false);
  assert.strictEqual(lc.isEnvelope({}), false);
  assert.strictEqual(lc.isEnvelope({ v: 1 }), false);
  assert.strictEqual(lc.isEnvelope(lc.encrypt(SECRET, lc.newKey())), true);

  assert.throws(() => lc.decrypt(SECRET, lc.newKey()), /not an encrypted value/);
});

test('a malformed key is rejected before anything is written', () => {
  assert.throws(() => lc.encrypt(SECRET, 'not-hex'), TypeError);
  assert.throws(() => lc.encrypt(SECRET, 'abcd'), /must be 32 bytes/);
  assert.throws(() => lc.encrypt(SECRET, ''), TypeError);
  assert.strictEqual(lc.newKey().length, lc.KEY_BYTES * 2);
});

/* ── key protection ───────────────────────────────────────────────────────── */

const fakeKeystore = (backend) => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: backend ? () => backend : undefined,
  encryptString: (s) => Buffer.from('SEALED:' + s, 'utf8'),
  decryptString: (b) => {
    const s = b.toString('utf8');
    if (!s.startsWith('SEALED:')) throw new Error('not ours');
    return s.slice('SEALED:'.length);
  },
});

test('with a real keystore the key is wrapped, not stored', () => {
  const key = lc.newKey();
  const descriptor = lc.protectKey(key, fakeKeystore());

  assert.strictEqual(descriptor.scheme, 'safeStorage');
  assert.ok(!descriptor.value.includes(key), 'the key is in the descriptor in the clear');
  assert.strictEqual(lc.unprotectKey(descriptor, fakeKeystore()), key);
});

test('Linux basic_text is refused rather than trusted', () => {
  /* Electron reports encryption as available on Linux even when it has fallen
     back to a hardcoded key. Storing the key in the clear and saying so beats
     recording "safeStorage" against something that is not. */
  const key = lc.newKey();
  assert.strictEqual(lc.hasRealKeystore(fakeKeystore('basic_text')), false);
  assert.strictEqual(lc.hasRealKeystore(fakeKeystore('gnome_libsecret')), true);

  const descriptor = lc.protectKey(key, fakeKeystore('basic_text'));
  assert.strictEqual(descriptor.scheme, 'plain');
  assert.strictEqual(lc.unprotectKey(descriptor, fakeKeystore('basic_text')), key);
});

test('no keystore at all still works', () => {
  /* A till must start. Without a keystore the secret is still encrypted with
     the per-install key; only the copy-to-another-machine protection is lost. */
  const key = lc.newKey();
  const descriptor = lc.protectKey(key, null);
  assert.strictEqual(descriptor.scheme, 'plain');
  assert.strictEqual(lc.unprotectKey(descriptor, null), key);
});

test('a keystore that throws is treated as absent', () => {
  const angry = {
    isEncryptionAvailable: () => true,
    encryptString: () => { throw new Error('keychain locked'); },
  };
  const key = lc.newKey();
  const descriptor = lc.protectKey(key, angry);
  assert.strictEqual(descriptor.scheme, 'plain', 'a failing keystore must not stop startup');
  assert.strictEqual(lc.unprotectKey(descriptor, angry), key);
});

test('a key wrapped on another machine fails clearly, so the caller can rotate', () => {
  /* A different Windows account, or a rebuilt profile. This is the case that
     must not become a dialog on a shop counter - it has to be a recognisable
     error the caller answers by recreating the credential. */
  const descriptor = lc.protectKey(lc.newKey(), fakeKeystore());
  const otherMachine = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: () => { throw new Error('DPAPI: key not found'); },
  };
  assert.throws(
    () => lc.unprotectKey(descriptor, otherMachine),
    (e) => e.code === 'DECRYPTION_FAILED',
  );
});

test('an unknown scheme is refused rather than guessed at', () => {
  assert.throws(
    () => lc.unprotectKey({ v: 1, scheme: 'tpm-someday', value: 'x' }, fakeKeystore()),
    /unknown key protection scheme/,
  );
  assert.throws(() => lc.unprotectKey(null, fakeKeystore()), /no key descriptor/);
});

test('the module loads outside Electron', () => {
  /* It is required by setup-mongodb.js, which also runs from plain node during
     installation. A top-level require('electron') would break that. */
  assert.strictEqual(typeof lc.encrypt, 'function');
  assert.strictEqual(lc.hasRealKeystore(), false, 'no Electron here, so no keystore');
});
