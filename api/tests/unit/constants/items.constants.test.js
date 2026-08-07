'use strict';

const {
  DEFAULTS,
  ITEM_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
} = require('../../../src/constants/items.constants');

describe('items.constants', () => {
  test('exports default values and item statuses', () => {
    expect(DEFAULTS).toEqual({
      STATUS: 'active',
      IMAGE: 'item.svg',
      AVAILABLE_QUANTITY: 0,
    });

    expect(ITEM_STATUS).toEqual({
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      INSTANT: 'instant',
      DRAFT: 'draft',
      REGULAR: 'regular',
    });
  });

  test('exports response metadata', () => {
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
  });

  test('exports messages and field limits', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      ITEM_NOT_FOUND: 'Item not found',
      ITEM_NOT_FOUND_TITLE: 'Item Not Found',
      ITEM_NAME_REQUIRED: 'Item name is required',
      BARCODE_EXISTS: 'Item with this barcode already exists',
      VALIDATION_ERROR: 'Validation Error',
      ITEM_ID_REQUIRED: 'Item ID is required',
      ITEM_ID_MISSING: 'Item Id is missing',
      INVALID_ITEM_ID: 'Invalid item id',
      NO_ITEM_IDS_PROVIDED: 'No item IDs provided',
      ITEM_DETAILS_NOT_FOUND: 'Item Details Not Found',
      BRANCH_LICENSE_REQUIRED: 'Branch and license context required',
      NO_FILES_UPLOADED: 'No files uploaded',
      INVALID_IMAGE_TYPE: 'Upload valiid images. Only GIF, PNG, JPG, JPEG and BMP are allowed.',
      IMAGE_TOO_LARGE: 'Image size exceeds 5MB',
      HSN_FILE_NOT_FOUND: 'HSN file not found',
      CATEGORY_ID_REQUIRED: 'Category ID is required',
      INVALID_QUANTITY_CHANGE: 'Invalid quantity change',
      UNAUTHORIZED: 'Unauthorized',
      FAILED_TO_FETCH_ITEMS: 'Failed to fetch items',
      FAILED_TO_FETCH_ITEMS_BY_CATEGORY: 'Failed to fetch items by category',
      FAILED_TO_UPDATE_STOCK: 'Failed to update stock',
      FAILED_TO_GET_QUANTITY_COUNT: 'Failed to get quantity count',
      FAILED_TO_CREATE_ITEM: 'Failed to create item',
      FAILED_TO_UPDATE_ITEM: 'Failed to update item',
      FAILED_TO_DELETE_ITEM: 'Failed to delete item',
      FAILED_TO_LOAD_ITEM: 'Failed to load item. Please try again later.',
      FAILED_TO_DELETE_INSTANT_ITEM: 'Failed to delete instant item. Please try again later.',
      FAILED_TO_UPDATE_QUANTITY_PREFIX: 'Failed to update quantity: ',
      ITEMS_REPORT_RETRIEVED_UNSUCCESSFULLY: 'Items report retrieved unsuccessfully',
      ITEMS_EXPORTED_UNSUCCESSFULLY: 'Items exported unsuccessfully',
      NO_ITEMS_TO_IMPORT: 'No items to import',
      NO_ITEMS_TO_BULK_UPDATE: 'No items provided',
      INVALID_ID_AND_QUANTITY_REQUIRED: 'Invalid input. ID and Quantity are required.',
      UPLOAD_FAILED: 'Upload failed',
    });

    expect(SUCCESS_MESSAGES).toEqual({
      ITEM_CREATED: 'Item created successfully',
      ITEM_UPDATED: 'Item updated successfully',
      ITEM_DELETED: 'Item deleted successfully',
      ITEMS_DELETED: 'Items deleted successfully',
      ITEMS_RETRIEVED: 'Items retrieved successfully',
      IMAGE_UPLOADED: 'Image uploaded successfully',
    });

    expect(FIELD_LIMITS).toEqual({
      NAME_MIN: 1,
      NAME_MAX: 200,
      SKU_MAX: 100,
      BARCODE_MAX: 100,
      DESCRIPTION_MAX: 2000,
    });
  });
});
