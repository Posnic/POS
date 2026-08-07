'use strict';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSet = jest.fn();
const mockStartSession = jest.fn();

jest.mock('mongoose', () => ({
  connect: mockConnect,
  disconnect: mockDisconnect,
  set: mockSet,
  startSession: mockStartSession,
  connection: {
    readyState: 0,
    host: 'localhost',
    port: 27017,
    name: 'testdb',
    user: 'user',
    models: {},
    db: { admin: () => ({ ping: jest.fn() }) },
  },
  STATES: ['disconnected', 'connected'],
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const db = require('../../../src/utils/db');

describe('db utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.connection.readyState = 0;
  });

  test('checkConnection blocks when disconnected', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await db.checkConnection({}, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('withTransaction commits successful operations', async () => {
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };
    mockStartSession.mockResolvedValue(session);

    const result = await db.withTransaction(async (tx) => {
      expect(tx).toBe(session);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });
});
