'use strict';

const ErrorResponse = require('../../../src/utils/errorResponse');

describe('errorResponse utils', () => {
  test('factory helpers create expected responses', () => {
    expect(ErrorResponse.badRequest('bad').statusCode).toBe(400);
    expect(ErrorResponse.unauthorized().statusCode).toBe(401);
    expect(ErrorResponse.forbidden().statusCode).toBe(403);
    expect(ErrorResponse.notFound('User').message).toBe('User not found');
    expect(ErrorResponse.conflict('dup').statusCode).toBe(409);
    expect(ErrorResponse.validationError({ a: 'b' }).statusCode).toBe(422);
    expect(ErrorResponse.serverError().statusCode).toBe(500);
  });

  test('formatError handles operational and generic errors', () => {
    const operational = ErrorResponse.badRequest('bad', [{ field: 'x' }]);
    expect(ErrorResponse.formatError(operational)).toEqual(
      expect.objectContaining({
        success: false,
        status: 'fail',
        statusCode: 400,
        message: 'bad',
        errors: [{ field: 'x' }],
      })
    );

    process.env.NODE_ENV = 'development';
    const formatted = ErrorResponse.formatError(new Error('boom'));
    expect(formatted).toEqual(
      expect.objectContaining({
        success: false,
        status: 'error',
        statusCode: 500,
        message: 'Internal Server Error',
        stack: expect.any(String),
      })
    );
  });
});
