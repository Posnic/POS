'use strict';

const mockConnect = jest.fn();
const mockOn = jest.fn();
const mockClose = jest.fn();

jest.mock('mongoose', () => ({
  connect: mockConnect,
  connection: {
    on: mockOn,
    close: mockClose,
  },
  Promise: Promise,
}));

jest.mock('../../../src/config/environment', () => ({
  mongo: { uri: 'mongodb://example/test' },
  env: 'test',
  isProduction: false,
}));

const database = require('../../../src/config/database');

describe('config/database', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds mongo options from environment', () => {
    process.env.MAX_POOL_SIZE = '20';
    process.env.SOCKET_TIMEOUT = '40000';
    process.env.CONNECTION_TIMEOUT = '15000';

    expect(database.getMongoOptions()).toEqual(
      expect.objectContaining({
        maxPoolSize: 20,
        socketTimeoutMS: 40000,
        connectTimeoutMS: 15000,
        retryWrites: true,
        retryReads: true,
      })
    );
  });

  test('exports collections and migrations', () => {
    expect(database.collections).toEqual({ users: 'users', sessions: 'sessions' });
    expect(database.indexes.users).toHaveLength(2);
    expect(database.migrations.migrationsDir).toContain('database');
  });
});
