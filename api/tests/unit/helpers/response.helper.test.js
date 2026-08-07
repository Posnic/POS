'use strict';

jest.mock('../../../src/constants/users.constants', () => ({
  HTTP_STATUS: {
    OK: 200,
    INTERNAL_ERROR: 500,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    NOT_ACCEPTABLE: 406,
  },
  RESPONSE_TYPES: {
    SUCCESS: 'success',
    ERROR: 'error',
  },
}));

const helper = require('../../../src/helpers/response.helper');

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('response.helper', () => {
  test('formats success response', () => {
    const res = createRes();
    helper.sendSuccess(res, { ok: true }, 'done');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
