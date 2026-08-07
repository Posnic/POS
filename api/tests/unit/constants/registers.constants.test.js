'use strict';

const {
  REGISTER_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
} = require('../../../src/constants/registers.constants');

describe('registers.constants', () => {
  test('exports status, response metadata, and limits', () => {
    expect(REGISTER_STATUS).toEqual({
      OPENED: 'Opened',
      CLOSED: 'Closed',
    });

    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
      NONE: 'none',
    });

    expect(HTTP_STATUS).toMatchObject({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_ACCEPTABLE: 406,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    });

    expect(FIELD_LIMITS).toEqual({
      REGISTER_NAME_MIN: 1,
      REGISTER_NAME_MAX: 200,
    });
  });

  test('exports messages', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      DOCUMENT_NOT_FOUND: 'Document Not Found',
      REGISTER_NOT_FOUND: 'Register Not Found',
      REGISTER_NOT_OPENED: 'Register is not opened',
      INVALID_REGISTER_ID: 'Invalid register ID',
      FAILED_FETCH_REGISTER_REPORT: 'Failed to fetch register report',
      FAILED_FETCH_REGISTER_SALE_DETAILS: 'Failed to fetch register sale details',
      NOT_VALID_INPUT: 'Not valid Input',
      UNAUTHORIZED: 'Unauthorized',
      SALES_DETAILS_NOT_FOUND: 'Sales Details Not Found',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      REGISTER_OPENED: 'Register Opened successfully',
      REGISTER_CLOSED: 'Register Closed successfully',
      REGISTER_FETCHED: 'Register get successfully',
      REGISTER_CASHDETAIL_UPDATED: 'Register Cashdetail update successfully',
      REGISTER_CASH_ENTRY_DELETED: 'Cash In/Out entry deleted successfully',
      PAYMENT_NOTE_UPDATED: 'Payment note updated successfully',
      AMOUNT_UPDATED: 'Amount Updated successfully',
      CASH_ADDED: 'Cash added successfully',
      CHANGES_RETRIEVED: 'Changes Retrieved',
      REGISTER_REPORT_DETAILS_RETRIEVED: 'Register report details retrieved successfully',
      DELETE_SUCCESS: 'Delete Successfully',
    });
  });
});
