'use strict';

jest.mock('../../../src/config/config', () => ({
  encryption: {
    key: 'test-key',
    iv: 'test-iv',
  },
}));

jest.mock('crypto', () => ({
  createHash: jest.fn(),
  createCipheriv: jest.fn(),
  createDecipheriv: jest.fn(),
}));

const crypto = require('crypto');
const Encryption = require('../../../src/utils/encryption');

describe('Encryption utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockHashResults() {
    const keyDigest = Buffer.from('key-digest');
    const ivHashHex = '1234567890abcdef1234567890abcdef';

    const keyUpdate = jest.fn().mockReturnThis();
    const keyDigestFn = jest.fn().mockReturnValue(keyDigest);
    const ivUpdate = jest.fn().mockReturnThis();
    const ivDigestFn = jest.fn().mockReturnValue(ivHashHex);

    crypto.createHash
      .mockReturnValueOnce({ update: keyUpdate, digest: keyDigestFn })
      .mockReturnValueOnce({ update: ivUpdate, digest: ivDigestFn });

    return { keyDigest, ivHashHex };
  }

  test('generateEncryptedId encrypts plaintext using configured key and iv', () => {
    const { keyDigest, ivHashHex } = mockHashResults();
    const update = jest.fn().mockReturnValue('base64-part');
    const final = jest.fn().mockReturnValue('final-part');
    crypto.createCipheriv.mockReturnValue({ update, final });

    const result = Encryption.generateEncryptedId('plain-text');

    expect(crypto.createHash).toHaveBeenCalledTimes(2);
    expect(crypto.createCipheriv).toHaveBeenCalledWith(
      'aes-256-cbc',
      keyDigest,
      Buffer.from(ivHashHex.substring(0, 16), 'utf8')
    );
    expect(update).toHaveBeenCalledWith('plain-text', 'utf8', 'base64');
    expect(final).toHaveBeenCalledWith('base64');
    expect(result).toBe('base64-partfinal-part');
  });

  test('decryptId decrypts encrypted text using configured key and iv', () => {
    const { keyDigest, ivHashHex } = mockHashResults();
    const update = jest.fn().mockReturnValue('decrypted-part');
    const final = jest.fn().mockReturnValue('final-text');
    crypto.createDecipheriv.mockReturnValue({ update, final });

    const result = Encryption.decryptId('encrypted-text');

    expect(crypto.createHash).toHaveBeenCalledTimes(2);
    expect(crypto.createDecipheriv).toHaveBeenCalledWith(
      'aes-256-cbc',
      keyDigest,
      Buffer.from(ivHashHex.substring(0, 16), 'utf8')
    );
    expect(update).toHaveBeenCalledWith('encrypted-text', 'base64', 'utf8');
    expect(final).toHaveBeenCalledWith('utf8');
    expect(result).toBe('decrypted-partfinal-text');
  });
});
