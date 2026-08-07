'use strict';

const errors = require('../../../src/utils/appError');

describe('appError utils', () => {
  test('AppError sets operational fields', () => {
    const err = new errors.AppError('boom', 418);
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(418);
    expect(err.status).toBe('fail');
    expect(err.isOperational).toBe(true);
  });

  test('specialized errors use expected defaults', () => {
    expect(new errors.ValidationError().statusCode).toBe(400);
    expect(new errors.UnauthorizedError().statusCode).toBe(401);
    expect(new errors.ForbiddenError().statusCode).toBe(403);
    expect(new errors.NotFoundError().statusCode).toBe(404);
    expect(new errors.BadRequestError().statusCode).toBe(400);
    expect(new errors.ConflictError().statusCode).toBe(409);
    expect(new errors.InternalServerError().statusCode).toBe(500);
  });
});
