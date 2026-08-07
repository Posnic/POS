'use strict';

jest.mock('mongodb', () => ({
  ObjectId: jest.fn((id) => ({ toString: () => String(id) })),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  createHash: jest.fn(),
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
  },
  createWriteStream: jest.fn(),
}));

jest.mock('stream', () => {
  const actual = jest.requireActual('stream');
  return {
    ...actual,
    pipeline: jest.fn(),
  };
});

const crypto = require('crypto');
const fs = require('fs');
require('stream');
const helpers = require('../../../src/utils/helpers');

describe('helpers utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    crypto.randomBytes.mockReset();
    crypto.createHash.mockReset();
  });

  test('formatDate handles Date, string, number, and MongoDB date formats', () => {
    expect(helpers.formatDate(new Date('2025-01-02T14:05:00.000Z'))).toBe('01/02/2025 07:35 pm');
    expect(helpers.formatDate('2025-01-02T02:05:00.000Z')).toBe('01/02/2025 07:35 am');
    expect(helpers.formatDate(1735826700000)).toBe('01/02/2025 07:35 pm');
    expect(helpers.formatDate({ $date: '2025-01-02T14:05:00.000Z' })).toBe('01/02/2025 07:35 pm');
    expect(helpers.formatDate(null)).toBe('');
  });

  test('isValidObjectId validates string ids', () => {
    expect(helpers.isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    expect(helpers.isValidObjectId('not-an-id')).toBe(true);
    expect(helpers.isValidObjectId(123)).toBe(false);
  });

  test('toObjectId returns ObjectId instance or null', () => {
    expect(helpers.toObjectId('507f1f77bcf86cd799439011')).toEqual({
      toString: expect.any(Function),
    });
    expect(helpers.toObjectId(null)).toBeNull();
  });

  test('generateRandomString trims to requested length', () => {
    crypto.randomBytes.mockReturnValue(Buffer.from('0123456789abcdef0123456789abcdef'));
    expect(helpers.generateRandomString(10)).toHaveLength(10);
  });

  test('generateHash hashes data with algorithm', () => {
    const update = jest.fn().mockReturnThis();
    const digest = jest.fn().mockReturnValue('hashed');
    crypto.createHash.mockReturnValue({ update, digest });

    expect(helpers.generateHash('hello')).toBe('hashed');
    expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    expect(update).toHaveBeenCalledWith('hello');
    expect(digest).toHaveBeenCalledWith('hex');
  });

  test('generateToken resolves to random hex token', async () => {
    crypto.randomBytes.mockImplementation((bytes, callback) => {
      callback(null, Buffer.from('abcd'));
    });

    await expect(helpers.generateToken(4)).resolves.toBe('61626364');
  });

  test('isValidEmail and isValidPhone validate formats', () => {
    expect(helpers.isValidEmail('test@example.com')).toBe(true);
    expect(helpers.isValidEmail('bad')).toBe(false);
    expect(helpers.isValidPhone('+91 9876543210')).toBe(true);
    expect(helpers.isValidPhone('123')).toBe(false);
  });

  test('formatFileSize formats bytes', () => {
    expect(helpers.formatFileSize(0)).toBe('0 Bytes');
    expect(helpers.formatFileSize(1024)).toBe('1 KB');
  });

  test('ensureDirectoryExists creates directory recursively', async () => {
    await helpers.ensureDirectoryExists('/tmp/test-dir');
    expect(fs.promises.mkdir).toHaveBeenCalledWith('/tmp/test-dir', { recursive: true });
  });

  test('saveFile writes buffer to disk', async () => {
    await helpers.saveFile('/tmp/file.txt', Buffer.from('hello'));
    expect(fs.promises.writeFile).toHaveBeenCalledWith('/tmp/file.txt', Buffer.from('hello'));
  });

  test('safeJsonParse returns default on invalid json', () => {
    expect(helpers.safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(helpers.safeJsonParse('bad', { fallback: true })).toEqual({ fallback: true });
  });

  test('toQueryString serializes object values and arrays', () => {
    expect(helpers.toQueryString({ a: '1', b: ['x', null, 'y'], c: undefined, d: null })).toBe(
      'a=1&b=x&b=y'
    );
  });

  test('deepClone clones nested data without sharing references', () => {
    const original = {
      a: 1,
      nested: { b: 2 },
      arr: [1, { c: 3 }],
      date: new Date('2025-01-01T00:00:00.000Z'),
    };
    const cloned = helpers.deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
    expect(cloned.arr).not.toBe(original.arr);
    expect(cloned.date).not.toBe(original.date);
  });
});
