'use strict';

const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
} = require('../../../src/constants/stock-logs.constants');

describe('stock-logs.constants', () => {
  test('exports response metadata', () => {
    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
      NONE: 'none',
    });

    expect(HTTP_STATUS).toEqual({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_ACCEPTABLE: 406,
      CONFLICT: 409,
      UNPROCESSABLE_ENTITY: 422,
      INTERNAL_ERROR: 500,
    });
  });

  test('exports message catalogs', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      INVALID_FILTERS_FORMAT: 'Invalid filters format',
      FAILED_TO_FETCH_STOCK_LOGS: 'Failed to fetch stock logs',
      FAILED_TO_RETRIEVE_STOCK_LOGS: 'Failed to retrieve stock logs',
      FAILED_TO_RETRIEVE_STOCK_LOG: 'Failed to retrieve stock log',
      VALIDATION_FAILED: 'Validation failed',
      NO_STOCK_LOG_IDS_PROVIDED: 'No stock log IDs provided',
      FAILED_TO_CREATE_STOCK_LOG: 'Failed to create stock log',
      FAILED_TO_DELETE_STOCK_LOGS: 'Failed to delete stock logs',
      NO_MATCHING_STOCK_LOGS: 'No matching stock logs found',
      FAILED_TO_EXPORT_STOCK_LOGS: 'Failed to export stock logs',
      STOCK_LOG_NOT_FOUND: 'Stock log not found',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      STOCK_LOGS_RETRIEVED: 'Stock logs retrieved',
      STOCK_LOG_RETRIEVED: 'Stock log retrieved',
      STOCK_LOG_CREATED: 'Stock log created',
      STOCK_LOGS_DELETED: 'Stock logs deleted',
      STOCK_LOGS_EXPORTED: 'Stock logs exported',
      STOCK_EXPORTED: 'Stock exported',
    });
  });
});
