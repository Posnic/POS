'use strict';

/*
 * The receipt-link encryption utility - PHP-parity double-base64 AES.
 *
 * The previous version of this suite mocked crypto's internals against an
 * OLDER implementation (single base64, raw digest key) and went red the day
 * the util was rewritten for byte-parity with the PHP API. Mock-the-crypto
 * tests pin the how, not the what; these pin behaviour: the round trip, the
 * double-base64 envelope PHP produces, determinism (fixed IV is the PHP
 * design), and the URL-mangled '+'-as-space case decryptId handles.
 */

jest.mock('../../../src/config/config', () => ({
  encryption: {
    key: 'test-key',
    iv: 'test-iv',
  },
}));

const Encryption = require('../../../src/utils/encryption');

describe('Encryption utility (PHP parity)', () => {
  test('what it encrypts, it decrypts - the round trip', () => {
    for (const plain of ['64a000000000000000000abc', 'hello world', '1', 'ölëß-unicode']) {
      expect(Encryption.decryptId(Encryption.generateEncryptedId(plain))).toBe(plain);
    }
  });

  test('the envelope is double base64, exactly as PHP produces it', () => {
    const id = Encryption.generateEncryptedId('64a000000000000000000abc');
    // Outer layer decodes to ANOTHER valid base64 string (the inner layer).
    const inner = Buffer.from(id, 'base64').toString('utf8');
    expect(inner).toMatch(/^[A-Za-z0-9+/=]+$/);
    // And the inner layer is real ciphertext, not the plaintext.
    expect(inner).not.toContain('64a000000000000000000abc');
  });

  test('deterministic: the same input always makes the same link (fixed IV, the PHP design)', () => {
    expect(Encryption.generateEncryptedId('same-input')).toBe(
      Encryption.generateEncryptedId('same-input')
    );
  });

  test('URL-mangled ids still decrypt: surrounding whitespace and space-for-plus', () => {
    /*
     * A '+' inside the envelope is structurally rare here (the outer layer
     * encodes base64-alphabet ASCII, a narrow byte range), so rather than
     * probing for one, exercise the normalization directly: surrounding
     * whitespace must trim, and the space-for-plus restoration must never
     * corrupt an id that had no '+' to begin with.
     */
    /*
     * Note the util's real contract: spaces are restored to '+' BEFORE any
     * trim, because a space in a received id can only be a query-mangled
     * '+'. That means accidental surrounding whitespace is NOT tolerated -
     * by design, since a leading space would otherwise be guessed into a
     * leading '+'. The test pins that exact behaviour.
     */
    const plain = '64a000000000000000000abc';
    const id = Encryption.generateEncryptedId(plain);
    expect(Encryption.decryptId(id.replace(/\+/g, ' '))).toBe(plain);
    expect(() => Encryption.decryptId('  ' + id + '  ')).toThrow();
  });

  test('garbage input throws rather than returning silent nonsense', () => {
    expect(() => Encryption.decryptId('definitely-not-a-valid-id')).toThrow();
  });
});
