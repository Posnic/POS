'use strict';

const catchAsync = require('../../../src/utils/catchAsync');

describe('catchAsync', () => {
  test('forwards resolved async handler without calling next', async () => {
    const req = {};
    const res = {};
    const next = jest.fn();
    const handler = jest.fn().mockResolvedValue('ok');

    const middleware = catchAsync(handler);
    await middleware(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('forwards rejected async handler to next', async () => {
    const req = {};
    const res = {};
    const next = jest.fn();
    const error = new Error('boom');
    const handler = jest.fn().mockRejectedValue(error);

    const middleware = catchAsync(handler);
    await middleware(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  test('forwards sync throw to next', async () => {
    const req = {};
    const res = {};
    const next = jest.fn();
    const error = new Error('sync boom');
    const handler = jest.fn(() => {
      throw error;
    });

    const middleware = catchAsync(handler);
    await middleware(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
