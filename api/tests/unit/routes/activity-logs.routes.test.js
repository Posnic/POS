'use strict';

jest.mock('../../../src/controllers/activity-logs.controller', () => ({
  getActivityLogs: jest.fn((req, res) => res.status(200).json({ ok: true })),
  getSalesAuditLogs: jest.fn((req, res) => res.status(200).json({ ok: true })),
}));

const router = require('../../../src/routes/activity-logs.routes');

describe('activity-logs.routes', () => {
  test('exposes activity log route', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

    expect(paths).toContain('get /');
    expect(paths).toContain('get /sales');
  });
});
