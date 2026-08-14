'use strict';

const {
  DEFAULTS,
  RECEIVING_STATUS,
  STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
  ALLOWED_IMAGE_EXTENSIONS,
} = require('../../../src/constants/receivings.constants');

describe('receivings.constants', () => {
  test('exports default values and status enums', () => {
    expect(DEFAULTS).toEqual({
      STATUS: 'draft',
      RECEIVING_STATUS: 'Open',
      PAYMENT_STATUS: 'pending',
      PAYMENT_METHOD: 'cash',
      TAX: 0,
      DISCOUNT: 0,
      SUBTOTAL: 0,
      TOTAL: 0,
      PREFIX: 'RID',
    });

    expect(RECEIVING_STATUS).toEqual({
      OPEN: 'Open',
      RECEIVED: 'Received',
      PARTIAL_RETURN: 'PartialReturn',
      FULL_RETURN: 'FullReturn',
      CANCELLED: 'Cancelled',
    });

    expect(STATUS).toEqual({
      DRAFT: 'draft',
      RECEIVED: 'received',
      CANCELLED: 'cancelled',
    });

    expect(PAYMENT_STATUS).toEqual({
      PENDING: 'pending',
      PARTIAL: 'partial',
      PAID: 'paid',
    });

    expect(PAYMENT_METHOD).toEqual({
      CASH: 'cash',
      CREDIT: 'credit',
      BANK_TRANSFER: 'bank_transfer',
      CHEQUE: 'cheque',
      OTHER: 'other',
    });
  });

  test('exports response metadata and validation values', () => {
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
      SUPPLIER_NAME_MIN: 3,
      SUPPLIER_NAME_MAX: 200,
      NOTES_MAX: 1000,
      RECEIVING_ID_LENGTH: 9,
      MAX_ITEMS: 1000,
      MAX_IMAGE_SIZE: 5242880,
      MAX_IMAGES: 10,
    });

    expect(VALIDATION_PATTERNS.RECEIVING_ID).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.POSITIVE_NUMBER).toBeInstanceOf(RegExp);
    expect(ALLOWED_IMAGE_EXTENSIONS).toEqual(['gif', 'jpg', 'png', 'jpeg', 'bmp', 'pdf']);
  });

  test('exports messages', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      RECEIVING_NOT_FOUND: 'Receiving not found',
      SUPPLIER_REQUIRED: 'Supplier is required',
      ITEMS_REQUIRED: 'At least one item is required',
      INVALID_QUANTITY: 'Invalid quantity',
      INVALID_PRICE: 'Invalid price',
      VALIDATION_ERROR: 'Validation Error',
      BRANCH_REQUIRED: 'Branch ID is required',
      DELETE_FAILED: 'Failed to delete receiving',
      UPDATE_FAILED: 'Failed to update receiving',
      CREATE_FAILED: 'Failed to create receiving',
      ALREADY_RECEIVED: 'This receiving is already marked as received',
      CANNOT_MODIFY_RECEIVED: 'Cannot modify received receiving',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      RECEIVING_CREATED: 'Receiving created',
      RECEIVING_UPDATED: 'Receiving updated',
      RECEIVING_DELETED: 'Receiving deleted',
      RECEIVINGS_DELETED: 'Receivings deleted',
      RECEIVINGS_RETRIEVED: 'Receivings retrieved',
      RECEIVING_RETRIEVED: 'Receiving retrieved',
      RECEIVING_RECEIVED: 'Receiving marked as received',
      RETURN_PROCESSED: 'Return processed',
      IMAGE_UPLOADED: 'Image uploaded',
      RECEIVINGS_EXPORTED: 'Receivings exported',
    });
  });
});
