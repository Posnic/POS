'use strict';

jest.mock('../../../src/controllers/whatsapp.controller', () => ({
  initializeConnection: jest.fn(),
  getQRCode: jest.fn(),
  getConnectionStatus: jest.fn(),
  logout: jest.fn(),
  removeDevice: jest.fn(),
  sendMessage: jest.fn(),
  saveTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  getTemplates: jest.fn(),
  deleteTemplate: jest.fn(),
  getSalesReceiptTemplate: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/whatsapp.routes');

describe('whatsapp.routes', () => {
  test('exposes whatsapp routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });

  test('applies authentication to the router', () => {
    expect(router.stack.some((layer) => !layer.route)).toBe(true);
  });
});
