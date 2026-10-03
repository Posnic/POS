'use strict';
jest.mock('../../../src/db/tenant-context', () => ({
  currentDb: jest.fn(),
  currentSecret: () => 'test-shadow-secret',
}));
jest.mock('../../../src/models/base.model', () => ({}));
jest.mock('../../../src/models/user.model', () => ({ findById: jest.fn() }));
const jwt = require('jsonwebtoken');
const User = require('../../../src/models/user.model');
const { currentDb } = require('../../../src/db/tenant-context');
const { shadowLogin } = require('../../../src/controllers/shadow-login.controller');
const versions = require('../../../src/utils/auth-version');
test.each([0, 3])(
  'shadow credentials carry current account version %i and later resets revoke them',
  async (authVersion) => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      authVersion,
      email: 'test@example.com',
      active: true,
    };
    User.findById.mockReturnValue({ select: async () => user });
    currentDb.mockReturnValue({
      collection: () => ({ createIndex: async () => {}, insertOne: async () => {} }),
    });
    const token = jwt.sign(
      { purpose: 'shadow', uid: user._id, jti: 'test-once' },
      'test-shadow-secret',
      { expiresIn: '60s' }
    );
    const req = { query: { token }, session: {} };
    const res = { cookie: jest.fn(), set: jest.fn(), send: jest.fn() };
    await shadowLogin(req, res);
    const decoded = jwt.verify(res.cookie.mock.calls[0][1], 'test-shadow-secret');
    expect(versions.current(user, decoded)).toBe(true);
    expect(versions.current(user, req.session)).toBe(true);
    expect(versions.current({ ...user, authVersion: authVersion + 1 }, decoded)).toBe(false);
  }
);
