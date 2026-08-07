'use strict';

jest.mock('../../../src/controllers/crons.controller', () => ({
  cronCreateFile: jest.fn(),
  getAllCronJobs: jest.fn(),
  createCronJob: jest.fn(),
  updateCronJob: jest.fn(),
  deleteCronJob: jest.fn(),
  startCronJob: jest.fn(),
  stopCronJob: jest.fn(),
  executeCronJob: jest.fn(),
  getCronLogs: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/crons.routes');

describe('crons.routes', () => {
  test('exposes cron routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'post /cronCreateFile',
        'get /',
        'post /',
        'put /:name',
        'delete /:name',
      ])
    );
  });
});
