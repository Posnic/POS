'use strict';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
}));

jest.mock('multer', () => {
  const multer = jest.fn(() => ({
    storage: 'storage',
    limits: { fileSize: 5242880 },
    fileFilter: jest.fn(),
  }));
  multer.diskStorage = jest.fn((opts) => opts);
  return multer;
});

const upload = require('../../../src/middleware/upload');

describe('upload middleware', () => {
  test('exports multer instance', () => {
    expect(upload).toBeTruthy();
  });
});
