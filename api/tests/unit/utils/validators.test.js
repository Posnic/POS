'use strict';

const Joi = require('joi');
const { validate, auth, user, query } = require('../../../src/utils/validators');

describe('validators utils', () => {
  const createRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  test('auth register schema validates matching passwords', () => {
    const { error } = auth.register.validate({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'Password1!',
      confirmPassword: 'Password1!',
      role: 'user',
    });
    expect(error).toBeUndefined();
  });

  test('user update profile requires at least one field', () => {
    expect(user.updateProfile.validate({}).error).toBeTruthy();
  });

  test('query pagination applies defaults', () => {
    const { value, error } = query.pagination.validate({});
    expect(error).toBeUndefined();
    expect(value).toEqual({ page: 1, limit: 10, sort: '-createdAt' });
  });

  test('validate middleware returns formatted errors', () => {
    const schema = Joi.object({ name: Joi.string().required() });
    const middleware = validate(schema);
    const res = createRes();
    const next = jest.fn();

    middleware({ body: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        message: 'Validation failed',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
