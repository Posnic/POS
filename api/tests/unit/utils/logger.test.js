'use strict';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock('winston-daily-rotate-file', () => jest.fn(), { virtual: true });

jest.mock(
  'winston',
  () => {
    const logger = {
      http: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      stream: undefined,
    };

    const formatFn = jest.fn((fn) => jest.fn((info = {}) => fn(info)));
    formatFn.combine = jest.fn((...args) => args);
    formatFn.timestamp = jest.fn(() => 'timestamp');
    formatFn.printf = jest.fn((fn) => fn);
    formatFn.colorize = jest.fn(() => 'colorize');
    formatFn.json = jest.fn(() => 'json');
    formatFn.errors = jest.fn(() => 'errors');

    return {
      createLogger: jest.fn(() => logger),
      format: formatFn,
      transports: {
        Console: jest.fn(),
        File: jest.fn(),
      },
    };
  },
  { virtual: true }
);

describe('logger utility', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
  });

  test('creates logs directory when missing', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);

    jest.isolateModules(() => {
      require('../../../src/utils/logger');
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('logs');
  });

  test('exposes logger stream that writes to info', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);

    let exported;
    jest.isolateModules(() => {
      exported = require('../../../src/utils/logger');
    });

    exported.logger.info.mockClear();
    exported.logger.stream.write('hello world\n');

    expect(exported.logger.info).toHaveBeenCalledWith('hello world');
  });

  test('requestLogger logs incoming and outgoing requests', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);

    let exported;
    jest.isolateModules(() => {
      exported = require('../../../src/utils/logger');
    });

    const req = {
      method: 'GET',
      originalUrl: '/health',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest'),
      body: { ok: true },
      query: { page: 1 },
      params: { id: '1' },
    };
    const originalSend = jest.fn().mockReturnValue('sent');
    const res = { send: originalSend };
    const next = jest.fn();

    exported.requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();

    res.send('payload');
    expect(exported.logger.http).toHaveBeenCalledWith(
      'Incoming Request',
      expect.objectContaining({
        method: 'GET',
        url: '/health',
        ip: '127.0.0.1',
        userAgent: 'jest',
        body: { ok: true },
        query: { page: 1 },
        params: { id: '1' },
      })
    );
    expect(exported.logger.http).toHaveBeenCalledWith(
      'Outgoing Response',
      expect.objectContaining({
        statusCode: undefined,
        url: '/health',
        response: 'payload',
      })
    );
    expect(originalSend).toHaveBeenCalledWith('payload');
  });

  test('errorLogger logs the error with request context and calls next', () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);

    let exported;
    jest.isolateModules(() => {
      exported = require('../../../src/utils/logger');
    });

    const err = new Error('boom');
    const req = {
      method: 'POST',
      originalUrl: '/items',
      body: { name: 'Item' },
      query: { q: 'x' },
      params: { id: '123' },
      user: { id: 'u1', email: 'u1@test.com' },
    };
    const res = {};
    const next = jest.fn();

    exported.errorLogger(err, req, res, next);

    expect(exported.logger.error).toHaveBeenCalledWith(
      'Unhandled Error',
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'boom',
          name: 'Error',
        }),
        request: expect.objectContaining({
          method: 'POST',
          url: '/items',
          body: { name: 'Item' },
          query: { q: 'x' },
          params: { id: '123' },
          user: { id: 'u1', email: 'u1@test.com' },
        }),
      })
    );
    expect(next).toHaveBeenCalledWith(err);
  });
});
