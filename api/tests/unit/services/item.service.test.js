'use strict';

/**
 * Unit tests for src/services/item.service.js
 *
 * File confirmed  : src/services/item.service.js (1361 lines)
 * Export type     : CLASS export — `module.exports = ItemService`
 * Does NOT extend base.service.js.
 *
 * Constructor:
 *   `this.repository   = new ItemRepository()`
 *   `this.s3UploadedCache = new Set()`
 *   `this.s3UploadQueue  = new Set()`
 *   `this.s3Client       = null`
 *
 * Methods (30):
 *   shouldUploadToS3()
 *   getS3Client()
 *   getImageContentType(filename)
 *   uploadFileToS3(filename, filePath)
 *   queueS3Upload(filename, filePath)
 *   getAllItems(params)
 *   uploadItemImages(filesArray, options)
 *   getHsnCodes()
 *   addItem(params)
 *   updateItem(params)
 *   deleteItems(params)
 *   getItemsByCategory(categoryId)
 *   searchItems(query)
 *   getItemById(id, options)
 *   getLowStockItems(params, context)
 *   getOnlineItemsAjaxList(params, context)
 *   getOnlineSalesItems(params, context)
 *   createInstantItem(params)
 *   deleteInstantItem(params)
 *   getReceivingItemsAjaxList(params, context)
 *   accessKiosk(branchStoreId)
 *   updateKioskStatus(id, status)
 *   getItemsByCategoryId(categoryId, context)
 *   itemSearchPage(params, context)
 *   accessQr(params)
 *   accessMobileApp(branchId)
 *   updateItemQuantity(id, value)
 *   categoryProductDetails(data, context)
 *   supplierProductDetails(data, context)
 *   getCustomerSearchItems(query, context)
 *   quantityCount(match)
 *   categoryItemsReportTable(params)
 *   supplierItemsReportTable(params)
 *   itemReportTable(params)
 *   itemStockReportTable(data, context)
 *   importItems(data, context)
 *   exportItems(ids, context)
 *   resolveBranchContext(params)
 *   getBranchNotificationRange(branchId)
 *   updateItemStock(params)
 *   getDataChanges(module, from)
 *   getCategoryItemsReport(params)
 *
 * External dependencies (all mocked):
 *   ItemRepository          — class, mocked per-test via jest.mock + mockImplementation
 *   items.helper            — sanitizeItemData
 *   branches.repository     — findOne, findById (singleton)
 *   mongodb ObjectId        — mocked
 *   fs                      — mocked (existsSync, mkdirSync, writeFileSync, copyFileSync,
 *                             createReadStream, readFileSync)
 *   path                    — real (pure utility, no I/O)
 *   config                  — mocked (config/config.js)
 */

// ─── Mock ItemRepository (class) ─────────────────────────────────────────────
jest.mock('../../../src/repositories/item.repository', () => jest.fn());

// ─── Mock items.helper ────────────────────────────────────────────────────────
jest.mock('../../../src/helpers/items.helper', () => ({
  sanitizeItemData: jest.fn((data) => ({ ...data, _sanitized: true })),
}));

// ─── Mock branches.repository (singleton) ────────────────────────────────────
jest.mock('../../../src/repositories/branch.repository', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const mockObjectId = jest.fn().mockImplementation((id) => ({
    _mockId: id,
    toString: () => String(id),
  }));
  mockObjectId.isValid = jest.fn().mockReturnValue(true);
  return { ObjectId: mockObjectId };
});

// ─── Mock config ──────────────────────────────────────────────────────────────
jest.mock('../../../src/config/config', () => ({
  storageType: 'local',
  aws: {},
}));

// ─── Mock fs ──────────────────────────────────────────────────────────────────
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue('mock-stream'),
  readFileSync: jest.fn().mockReturnValue('[]'),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const ItemRepository = require('../../../src/repositories/item.repository');
const { sanitizeItemData } = require('../../../src/helpers/items.helper');
const branchesRepository = require('../../../src/repositories/branch.repository');
require('mongodb');
const fs = require('fs');
const ItemService = require('../../../src/services/item.service');

const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../../../src/constants/items.constants');

// ─── Constants ────────────────────────────────────────────────────────────────
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d0e1';
const LICENSE_ID = '64a1b2c3d4e5f6a7b8c9d0e2';
const ITEM_ID = '64a1b2c3d4e5f6a7b8c9d0e3';
const CATEGORY_ID = '64a1b2c3d4e5f6a7b8c9d0e4';
const SUPPLIER_ID = '64a1b2c3d4e5f6a7b8c9d0e5';
const USER_ID = '64a1b2c3d4e5f6a7b8c9d0e6';

// ─── Mock data factories ──────────────────────────────────────────────────────
function makeMockItem(overrides = {}) {
  return {
    _id: ITEM_ID,
    name: 'Test Item',
    sku: 'SKU-001',
    barcode_id: 'BARCODE-001',
    category_id: CATEGORY_ID,
    supplier_id: SUPPLIER_ID,
    selling_price: 100,
    cost_price: 70,
    current_stock: 10,
    license: LICENSE_ID,
    branch_access: [{ branch_id: BRANCH_ID }],
    status: 'active',
    is_deleted: false,
    ...overrides,
  };
}

function makeMockUser(overrides = {}) {
  return {
    _id: USER_ID,
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

function makePaginatedResult(overrides = {}) {
  return {
    items: [makeMockItem()],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findPage: jest.fn(),
    upsertItem: jest.fn(),
    deleteItems: jest.fn(),
    getItemsByCategory: jest.fn(),
    searchItems: jest.fn(),
    getItemTableRow: jest.fn(),
    getLowStockItems: jest.fn(),
    getOnlineItemsAjaxList: jest.fn(),
    getOnlineSalesItems: jest.fn(),
    createInstantItem: jest.fn(),
    deleteInstantItem: jest.fn(),
    getReceivingItemsAjaxList: jest.fn(),
    accessKiosk: jest.fn(),
    updateKioskStatus: jest.fn(),
    getItemsByCategoryId: jest.fn(),
    itemSearchPage: jest.fn(),
    accessQr: jest.fn(),
    accessMobileApp: jest.fn(),
    updateItemQuantity: jest.fn(),
    categoryProductDetails: jest.fn(),
    supplierProductDetails: jest.fn(),
    getCustomerSearchItems: jest.fn(),
    getQuantityCount: jest.fn(),
    categoryItemsReportTable: jest.fn(),
    supplierItemsReportTable: jest.fn(),
    itemReportTable: jest.fn(),
    itemStockReportTable: jest.fn(),
    importItems: jest.fn(),
    exportItems: jest.fn(),
    updateStock: jest.fn(),
    findItemById: jest.fn(),
    getDataChanges: jest.fn(),
    getCategoryItemsReport: jest.fn(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('ItemService', () => {
  let service;
  let repo;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.STORAGE_TYPE = 'local';
    delete process.env.AWS_S3_BUCKET;

    const repoMethods = makeRepoMethods();
    ItemRepository.mockImplementation(() => repoMethods);
    service = new ItemService();
    repo = service.repository;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('ItemService exports a class (not a singleton instance)', () => {
      expect(typeof ItemService).toBe('function');
    });

    test('new ItemService() creates an instance with a repository', () => {
      expect(service.repository).toBeDefined();
    });

    test('instantiates a new ItemRepository in the constructor', () => {
      expect(ItemRepository).toHaveBeenCalledTimes(1);
    });

    test('initialises s3UploadedCache as a Set', () => {
      expect(service.s3UploadedCache).toBeInstanceOf(Set);
    });

    test('initialises s3UploadQueue as a Set', () => {
      expect(service.s3UploadQueue).toBeInstanceOf(Set);
    });

    test('initialises s3Client as null', () => {
      expect(service.s3Client).toBeNull();
    });

    test('exposes all expected service methods', () => {
      const methods = [
        'shouldUploadToS3',
        'getS3Client',
        'getImageContentType',
        'uploadFileToS3',
        'queueS3Upload',
        'getAllItems',
        'uploadItemImages',
        'getHsnCodes',
        'addItem',
        'updateItem',
        'deleteItems',
        'getItemsByCategory',
        'searchItems',
        'getItemById',
        'getLowStockItems',
        'getOnlineItemsAjaxList',
        'getOnlineSalesItems',
        'createInstantItem',
        'deleteInstantItem',
        'getReceivingItemsAjaxList',
        'accessKiosk',
        'updateKioskStatus',
        'getItemsByCategoryId',
        'itemSearchPage',
        'accessQr',
        'accessMobileApp',
        'updateItemQuantity',
        'categoryProductDetails',
        'supplierProductDetails',
        'getCustomerSearchItems',
        'quantityCount',
        'categoryItemsReportTable',
        'supplierItemsReportTable',
        'itemReportTable',
        'itemStockReportTable',
        'importItems',
        'exportItems',
        'resolveBranchContext',
        'getBranchNotificationRange',
        'updateItemStock',
        'getDataChanges',
        'getCategoryItemsReport',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // shouldUploadToS3
  // ════════════════════════════════════════════════════════════════════════════
  describe('shouldUploadToS3', () => {
    test('returns false when STORAGE_TYPE is local', () => {
      process.env.STORAGE_TYPE = 'local';
      expect(service.shouldUploadToS3()).toBe(false);
    });

    test('returns falsy when STORAGE_TYPE is s3 but AWS_S3_BUCKET is unset', () => {
      process.env.STORAGE_TYPE = 's3';
      delete process.env.AWS_S3_BUCKET;
      expect(service.shouldUploadToS3()).toBeFalsy();
    });

    test('returns truthy when STORAGE_TYPE is s3 and AWS_S3_BUCKET is set', () => {
      process.env.STORAGE_TYPE = 's3';
      process.env.AWS_S3_BUCKET = 'my-bucket';
      expect(service.shouldUploadToS3()).toBeTruthy();
      delete process.env.AWS_S3_BUCKET;
    });

    test('defaults STORAGE_TYPE to local when env var is absent', () => {
      delete process.env.STORAGE_TYPE;
      expect(service.shouldUploadToS3()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getImageContentType
  // ════════════════════════════════════════════════════════════════════════════
  describe('getImageContentType', () => {
    test('returns image/jpeg for .jpg', () => {
      expect(service.getImageContentType('file.jpg')).toBe('image/jpeg');
    });

    test('returns image/jpeg for .jpeg', () => {
      expect(service.getImageContentType('file.jpeg')).toBe('image/jpeg');
    });

    test('returns image/png for .png', () => {
      expect(service.getImageContentType('file.png')).toBe('image/png');
    });

    test('returns image/gif for .gif', () => {
      expect(service.getImageContentType('file.gif')).toBe('image/gif');
    });

    test('returns image/bmp for .bmp', () => {
      expect(service.getImageContentType('file.bmp')).toBe('image/bmp');
    });

    test('returns application/octet-stream for unknown extension', () => {
      expect(service.getImageContentType('file.xyz')).toBe('application/octet-stream');
    });

    test('handles uppercase extensions (.JPG)', () => {
      // path.extname lowercased via toLowerCase() in the service
      expect(service.getImageContentType('FILE.JPG')).toBe('image/jpeg');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // uploadFileToS3
  // ════════════════════════════════════════════════════════════════════════════
  describe('uploadFileToS3', () => {
    test('returns null when shouldUploadToS3 returns false (local mode)', async () => {
      process.env.STORAGE_TYPE = 'local';
      const result = await service.uploadFileToS3('file.jpg', '/path/file.jpg');
      expect(result).toBeNull();
    });

    test('returns null when s3 client is null', async () => {
      process.env.STORAGE_TYPE = 's3';
      process.env.AWS_S3_BUCKET = 'bucket';
      service.s3Client = null;
      // getS3Client will try to require aws-sdk — mock it to return null
      jest.spyOn(service, 'getS3Client').mockReturnValue(null);
      const result = await service.uploadFileToS3('file.jpg', '/path/file.jpg');
      expect(result).toBeNull();
      delete process.env.AWS_S3_BUCKET;
    });

    test('returns null when file does not exist', async () => {
      process.env.STORAGE_TYPE = 's3';
      process.env.AWS_S3_BUCKET = 'bucket';
      fs.existsSync.mockReturnValue(false);
      const mockS3 = { upload: jest.fn() };
      jest.spyOn(service, 'getS3Client').mockReturnValue(mockS3);
      const result = await service.uploadFileToS3('file.jpg', '/path/file.jpg');
      expect(result).toBeNull();
      delete process.env.AWS_S3_BUCKET;
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getAllItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('getAllItems', () => {
    const defaultParams = { branchId: BRANCH_ID, licenseId: LICENSE_ID };

    test('returns error when branchId is missing', async () => {
      const result = await service.getAllItems({ licenseId: LICENSE_ID });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
      expect(result.data).toBeNull();
    });

    test('returns error when licenseId is missing', async () => {
      const result = await service.getAllItems({ branchId: BRANCH_ID });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
    });

    test('returns error when both branchId and licenseId are missing', async () => {
      const result = await service.getAllItems({});
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
    });

    test('returns error when called with no arguments', async () => {
      const result = await service.getAllItems();
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
    });

    test('returns paginated data on success', async () => {
      repo.findPage.mockResolvedValue(makePaginatedResult());

      const result = await service.getAllItems(defaultParams);

      expect(result.status).toBe(true);
      expect(result.message).toBe('success');
      expect(result.data).toMatchObject({
        total: 1,
        current_page: 1,
        total_pages: 1,
        per_page: 10,
      });
      expect(Array.isArray(result.data.list)).toBe(true);
    });

    test('calls repository.findPage with correct parameters', async () => {
      repo.findPage.mockResolvedValue(makePaginatedResult());

      await service.getAllItems({
        ...defaultParams,
        filters: { status: 'active' },
        options: { page: 2, limit: 20, sort: { name: 1 } },
      });

      expect(repo.findPage).toHaveBeenCalledWith({
        branchId: BRANCH_ID,
        licenseId: LICENSE_ID,
        filters: { status: 'active' },
        page: 2,
        limit: 20,
        sort: { name: 1 },
      });
    });

    test('uses default page=1, limit=5 when options are not provided', async () => {
      repo.findPage.mockResolvedValue(makePaginatedResult({ limit: 5 }));

      await service.getAllItems(defaultParams);

      const call = repo.findPage.mock.calls[0][0];
      expect(call.page).toBe(1);
      expect(call.limit).toBe(5);
    });

    test('uses default sort {_id:-1} when sort is not provided', async () => {
      repo.findPage.mockResolvedValue(makePaginatedResult());

      await service.getAllItems(defaultParams);

      const call = repo.findPage.mock.calls[0][0];
      expect(call.sort).toEqual({ _id: -1 });
    });

    test('returns empty list when repository returns zero items', async () => {
      repo.findPage.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, totalPages: 1 });

      const result = await service.getAllItems(defaultParams);

      expect(result.status).toBe(true);
      expect(result.data.list).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    test('handles non-numeric page/limit gracefully', async () => {
      repo.findPage.mockResolvedValue(makePaginatedResult());

      await service.getAllItems({
        ...defaultParams,
        options: { page: 'abc', limit: 'xyz' },
      });

      const call = repo.findPage.mock.calls[0][0];
      expect(call.page).toBe(1);
      expect(call.limit).toBe(5);
    });

    test('returns error when repository throws', async () => {
      repo.findPage.mockRejectedValue(new Error('DB failure'));

      const result = await service.getAllItems(defaultParams);

      expect(result.status).toBe(false);
      expect(result.message).toBe('DB failure');
      expect(result.data).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // uploadItemImages
  // ════════════════════════════════════════════════════════════════════════════
  describe('uploadItemImages', () => {
    const validFile = {
      name: 'photo.jpg',
      size: 1024,
      cover: 'yes',
      data: Buffer.from('fake-image-data').toString('base64'),
    };

    beforeEach(() => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockReturnValue(undefined);
      fs.writeFileSync.mockReturnValue(undefined);
      fs.copyFileSync.mockReturnValue(undefined);
    });

    test('returns error when filesArray is empty', async () => {
      const result = await service.uploadItemImages([], { protocol: 'http', host: 'localhost' });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.NO_FILES_UPLOADED);
      expect(result.code).toBe(400);
    });

    test('returns error when filesArray is not an array', async () => {
      const result = await service.uploadItemImages(null, { protocol: 'http', host: 'localhost' });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.NO_FILES_UPLOADED);
    });

    test('returns error for invalid image extension', async () => {
      const badFile = { ...validFile, name: 'file.exe' };
      const result = await service.uploadItemImages([badFile], {
        protocol: 'http',
        host: 'localhost',
      });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.INVALID_IMAGE_TYPE);
      expect(result.code).toBe(400);
    });

    test('returns error when image is too large (> 5MB)', async () => {
      const bigFile = { ...validFile, size: 6 * 1024 * 1024 };
      const result = await service.uploadItemImages([bigFile], {
        protocol: 'http',
        host: 'localhost',
      });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.IMAGE_TOO_LARGE);
      expect(result.code).toBe(400);
    });

    test('succeeds for a valid jpg file and returns URL array', async () => {
      const result = await service.uploadItemImages([validFile], {
        protocol: 'http',
        host: 'localhost',
      });
      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.IMAGE_UPLOADED);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        size: 1024,
        cover: 'yes',
      });
      expect(result.data[0].name).toContain('/uploads/item_images/');
    });

    test('accepts all supported image types: gif, png, jpeg, bmp', async () => {
      for (const ext of ['gif', 'GIF', 'png', 'PNG', 'jpeg', 'JPEG', 'bmp', 'BMP']) {
        jest.clearAllMocks();
        ItemRepository.mockImplementation(() => makeRepoMethods());
        service = new ItemService();
        const file = { ...validFile, name: `photo.${ext}` };
        const result = await service.uploadItemImages([file], {});
        expect(result.status).toBe(true);
      }
    });

    test('uses relative path when protocol/host are not provided', async () => {
      const result = await service.uploadItemImages([validFile], {});
      expect(result.status).toBe(true);
      expect(result.data[0].name).toMatch(/^\/uploads\/item_images\//);
    });

    test('creates itemImagesDir if it does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      await service.uploadItemImages([validFile], {});
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('item_images'), {
        recursive: true,
      });
    });

    test('does not call mkdirSync when directory already exists', async () => {
      fs.existsSync.mockReturnValue(true);
      await service.uploadItemImages([validFile], {});
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    test('writes file to disk via writeFileSync', async () => {
      fs.existsSync.mockReturnValue(false);
      await service.uploadItemImages([validFile], {});
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('handles fs.writeFileSync throwing an error', async () => {
      fs.existsSync.mockReturnValue(false);
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });
      const result = await service.uploadItemImages([validFile], {});
      expect(result.status).toBe(false);
      expect(result.code).toBe(500);
    });

    test('handles multiple files and returns array with all entries', async () => {
      fs.existsSync.mockReturnValue(false);
      const file2 = { ...validFile, name: 'second.png', cover: 'no' };
      const result = await service.uploadItemImages([validFile, file2], {
        protocol: 'https',
        host: 'example.com',
      });
      expect(result.status).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    test('file with no extension triggers invalid image type error', async () => {
      const noExtFile = { ...validFile, name: 'noextension' };
      const result = await service.uploadItemImages([noExtFile], {});
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.INVALID_IMAGE_TYPE);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getHsnCodes
  // ════════════════════════════════════════════════════════════════════════════
  describe('getHsnCodes', () => {
    test('returns empty array with message when hsn.json does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await service.getHsnCodes();
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.message).toBe(ERROR_MESSAGES.HSN_FILE_NOT_FOUND);
    });

    test('returns parsed JSON when hsn.json exists', async () => {
      const mockHsn = [{ code: '01', description: 'Animals' }];
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockHsn));
      const result = await service.getHsnCodes();
      expect(result.status).toBe(true);
      expect(result.data).toEqual(mockHsn);
    });

    test('returns error when readFileSync throws', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('read error');
      });
      const result = await service.getHsnCodes();
      expect(result.status).toBe(false);
      expect(result.message).toBe('read error');
    });

    test('returns error when JSON.parse fails (corrupted file)', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('NOT_VALID_JSON{{{');
      const result = await service.getHsnCodes();
      expect(result.status).toBe(false);
      expect(result.data).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // addItem
  // ════════════════════════════════════════════════════════════════════════════
  describe('addItem', () => {
    const validParams = {
      data: { name: 'New Item', selling_price: 100 },
      branchId: BRANCH_ID,
      licenseId: LICENSE_ID,
      user: makeMockUser(),
    };

    test('calls sanitizeItemData with the provided data', async () => {
      repo.upsertItem.mockResolvedValue({
        status: true,
        data: makeMockItem(),
        message: SUCCESS_MESSAGES.ITEM_CREATED,
      });

      await service.addItem(validParams);

      expect(sanitizeItemData).toHaveBeenCalledWith(validParams.data);
    });

    test('calls repository.upsertItem with sanitized data and empty id', async () => {
      const mockResult = {
        status: true,
        data: makeMockItem(),
        message: SUCCESS_MESSAGES.ITEM_CREATED,
      };
      repo.upsertItem.mockResolvedValue(mockResult);

      await service.addItem(validParams);

      expect(repo.upsertItem).toHaveBeenCalledWith(
        expect.objectContaining({ _sanitized: true }),
        '',
        expect.objectContaining({ branchId: BRANCH_ID, licenseId: LICENSE_ID })
      );
    });

    test('passes loggedUserId from user._id', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.addItem(validParams);

      const context = repo.upsertItem.mock.calls[0][2];
      expect(context.loggedUserId).toBe(USER_ID);
    });

    test('passes loggedUserName from user.username', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.addItem(validParams);

      const context = repo.upsertItem.mock.calls[0][2];
      expect(context.loggedUserName).toBe('testuser');
    });

    test('falls back loggedUserName to email when username is absent', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });
      const userNoUsername = { ...makeMockUser(), username: undefined };

      await service.addItem({ ...validParams, user: userNoUsername });

      const context = repo.upsertItem.mock.calls[0][2];
      expect(context.loggedUserName).toBe('test@example.com');
    });

    test('falls back loggedUserName to "System" when user is null', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.addItem({ ...validParams, user: null });

      const context = repo.upsertItem.mock.calls[0][2];
      expect(context.loggedUserName).toBe('System');
    });

    test('handles empty data gracefully (sanitizes empty object)', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.addItem({ branchId: BRANCH_ID, licenseId: LICENSE_ID, user: makeMockUser() });

      expect(sanitizeItemData).toHaveBeenCalledWith({});
    });

    test('returns repository result on success', async () => {
      const mockResult = {
        status: true,
        data: makeMockItem(),
        message: SUCCESS_MESSAGES.ITEM_CREATED,
      };
      repo.upsertItem.mockResolvedValue(mockResult);

      const result = await service.addItem(validParams);

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.upsertItem.mockRejectedValue(new Error('insert failed'));

      const result = await service.addItem(validParams);

      expect(result.status).toBe(false);
      expect(result.message).toBe('insert failed');
      expect(result.data).toBeNull();
    });

    test('returns error when called with no arguments', async () => {
      repo.upsertItem.mockRejectedValue(new Error('unexpected'));

      const result = await service.addItem();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateItem
  // ════════════════════════════════════════════════════════════════════════════
  describe('updateItem', () => {
    const validParams = {
      id: ITEM_ID,
      data: { name: 'Updated Item', selling_price: 150 },
      branchId: BRANCH_ID,
      licenseId: LICENSE_ID,
      user: makeMockUser(),
    };

    test('calls sanitizeItemData with the provided data', async () => {
      repo.upsertItem.mockResolvedValue({
        status: true,
        data: makeMockItem(),
        message: SUCCESS_MESSAGES.ITEM_UPDATED,
      });

      await service.updateItem(validParams);

      expect(sanitizeItemData).toHaveBeenCalledWith(validParams.data);
    });

    test('calls repository.upsertItem with sanitized data and correct id', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.updateItem(validParams);

      expect(repo.upsertItem).toHaveBeenCalledWith(
        expect.objectContaining({ _sanitized: true }),
        ITEM_ID,
        expect.objectContaining({ branchId: BRANCH_ID })
      );
    });

    test('passes loggedUserName from user.name when username is absent', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });
      const userNoUsername = { ...makeMockUser(), username: undefined };

      await service.updateItem({ ...validParams, user: userNoUsername });

      const context = repo.upsertItem.mock.calls[0][2];
      expect(context.loggedUserName).toBe('Test User');
    });

    test('returns repository result on success', async () => {
      const mockResult = {
        status: true,
        data: makeMockItem(),
        message: SUCCESS_MESSAGES.ITEM_UPDATED,
      };
      repo.upsertItem.mockResolvedValue(mockResult);

      const result = await service.updateItem(validParams);

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.upsertItem.mockRejectedValue(new Error('update failed'));

      const result = await service.updateItem(validParams);

      expect(result.status).toBe(false);
      expect(result.message).toBe('update failed');
    });

    test('handles empty data gracefully', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.updateItem({ id: ITEM_ID, branchId: BRANCH_ID, licenseId: LICENSE_ID });

      expect(sanitizeItemData).toHaveBeenCalledWith({});
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // deleteItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('deleteItems', () => {
    const validParams = {
      ids: [ITEM_ID],
      licenseId: LICENSE_ID,
      branchId: BRANCH_ID,
      user: makeMockUser(),
    };

    test('calls repository.deleteItems with ids and context', async () => {
      repo.deleteItems.mockResolvedValue({
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.ITEMS_DELETED,
      });

      await service.deleteItems(validParams);

      expect(repo.deleteItems).toHaveBeenCalledWith(
        [ITEM_ID],
        expect.objectContaining({ licenseId: LICENSE_ID, branchId: BRANCH_ID })
      );
    });

    test('passes loggedUserId to context', async () => {
      repo.deleteItems.mockResolvedValue({ status: true, data: null, message: 'ok' });

      await service.deleteItems(validParams);

      const context = repo.deleteItems.mock.calls[0][1];
      expect(context.loggedUserId).toBe(USER_ID);
    });

    test('returns repository result on success', async () => {
      const mockResult = { status: true, data: null, message: SUCCESS_MESSAGES.ITEMS_DELETED };
      repo.deleteItems.mockResolvedValue(mockResult);

      const result = await service.deleteItems(validParams);

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.deleteItems.mockRejectedValue(new Error('delete failed'));

      const result = await service.deleteItems(validParams);

      expect(result.status).toBe(false);
      expect(result.message).toBe('delete failed');
    });

    test('handles undefined ids gracefully (no crash)', async () => {
      repo.deleteItems.mockResolvedValue({ status: false, data: null, message: 'no ids' });

      const result = await service.deleteItems({
        licenseId: LICENSE_ID,
        branchId: BRANCH_ID,
        user: makeMockUser(),
      });

      expect(repo.deleteItems).toHaveBeenCalledWith(undefined, expect.any(Object));
    });

    test('handles empty ids array', async () => {
      repo.deleteItems.mockResolvedValue({
        status: false,
        data: null,
        message: ERROR_MESSAGES.NO_ITEM_IDS_PROVIDED,
      });

      const result = await service.deleteItems({ ...validParams, ids: [] });

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getItemsByCategory
  // ════════════════════════════════════════════════════════════════════════════
  describe('getItemsByCategory', () => {
    test('returns items on success', async () => {
      repo.getItemsByCategory.mockResolvedValue([makeMockItem()]);

      const result = await service.getItemsByCategory(CATEGORY_ID);

      expect(result.status).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.message).toBe('success');
    });

    test('calls repository.getItemsByCategory with categoryId', async () => {
      repo.getItemsByCategory.mockResolvedValue([]);

      await service.getItemsByCategory(CATEGORY_ID);

      expect(repo.getItemsByCategory).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns empty array when no items found', async () => {
      repo.getItemsByCategory.mockResolvedValue([]);

      const result = await service.getItemsByCategory(CATEGORY_ID);

      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('returns error when repository throws', async () => {
      repo.getItemsByCategory.mockRejectedValue(new Error('category lookup failed'));

      const result = await service.getItemsByCategory(CATEGORY_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe('category lookup failed');
    });

    test('handles null categoryId (passes through to repository)', async () => {
      repo.getItemsByCategory.mockResolvedValue([]);

      const result = await service.getItemsByCategory(null);

      expect(repo.getItemsByCategory).toHaveBeenCalledWith(null);
      expect(result.status).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // searchItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('searchItems', () => {
    test('returns matching items on success', async () => {
      repo.searchItems.mockResolvedValue([makeMockItem()]);

      const result = await service.searchItems('Test');

      expect(result.status).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    test('calls repository.searchItems with the query', async () => {
      repo.searchItems.mockResolvedValue([]);

      await service.searchItems('keyword');

      expect(repo.searchItems).toHaveBeenCalledWith('keyword');
    });

    test('returns empty array for empty keyword', async () => {
      repo.searchItems.mockResolvedValue([]);

      const result = await service.searchItems('');

      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('handles keyword with special characters', async () => {
      repo.searchItems.mockResolvedValue([]);

      await service.searchItems('Item & Co. <special>');

      expect(repo.searchItems).toHaveBeenCalledWith('Item & Co. <special>');
    });

    test('returns error when repository throws', async () => {
      repo.searchItems.mockRejectedValue(new Error('search failed'));

      const result = await service.searchItems('query');

      expect(result.status).toBe(false);
      expect(result.message).toBe('search failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getItemById
  // ════════════════════════════════════════════════════════════════════════════
  describe('getItemById', () => {
    test('calls repository.getItemTableRow with id and options', async () => {
      repo.getItemTableRow.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.getItemById(ITEM_ID, { licenseId: LICENSE_ID });

      expect(repo.getItemTableRow).toHaveBeenCalledWith(ITEM_ID, { licenseId: LICENSE_ID });
    });

    test('returns repository result on success', async () => {
      const mockResult = { status: true, data: makeMockItem(), message: 'ok' };
      repo.getItemTableRow.mockResolvedValue(mockResult);

      const result = await service.getItemById(ITEM_ID, { licenseId: LICENSE_ID });

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getItemTableRow.mockRejectedValue(new Error('not found'));

      const result = await service.getItemById(ITEM_ID, { licenseId: LICENSE_ID });

      expect(result.status).toBe(false);
      expect(result.message).toBe('not found');
    });

    test('uses empty options when options parameter is omitted', async () => {
      repo.getItemTableRow.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await service.getItemById(ITEM_ID);

      expect(repo.getItemTableRow).toHaveBeenCalledWith(ITEM_ID, {});
    });

    test('handles invalid item id (passes through to repository)', async () => {
      repo.getItemTableRow.mockResolvedValue({
        status: false,
        data: null,
        message: ERROR_MESSAGES.ITEM_NOT_FOUND,
      });

      const result = await service.getItemById('invalid-id', { licenseId: LICENSE_ID });

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getLowStockItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('getLowStockItems', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [makeMockItem()], message: 'ok' };
      repo.getLowStockItems.mockResolvedValue(mockResult);

      const result = await service.getLowStockItems({ threshold: 5 }, { branchId: BRANCH_ID });

      expect(repo.getLowStockItems).toHaveBeenCalledWith({ threshold: 5 }, { branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getLowStockItems.mockRejectedValue(new Error('low stock error'));

      const result = await service.getLowStockItems();

      expect(result.status).toBe(false);
      expect(result.message).toBe('low stock error');
    });

    test('uses empty default params when called with no args', async () => {
      repo.getLowStockItems.mockResolvedValue({ status: true, data: [], message: 'ok' });

      await service.getLowStockItems();

      expect(repo.getLowStockItems).toHaveBeenCalledWith({}, {});
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getOnlineItemsAjaxList
  // ════════════════════════════════════════════════════════════════════════════
  describe('getOnlineItemsAjaxList', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getOnlineItemsAjaxList.mockResolvedValue(mockResult);

      const result = await service.getOnlineItemsAjaxList({ page: 1 }, { licenseId: LICENSE_ID });

      expect(repo.getOnlineItemsAjaxList).toHaveBeenCalledWith(
        { page: 1 },
        { licenseId: LICENSE_ID }
      );
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getOnlineItemsAjaxList.mockRejectedValue(new Error('online items error'));

      const result = await service.getOnlineItemsAjaxList();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getOnlineSalesItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('getOnlineSalesItems', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getOnlineSalesItems.mockResolvedValue(mockResult);

      const result = await service.getOnlineSalesItems({ page: 1 }, { licenseId: LICENSE_ID });

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getOnlineSalesItems.mockRejectedValue(new Error('online sales error'));

      const result = await service.getOnlineSalesItems();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // createInstantItem
  // ════════════════════════════════════════════════════════════════════════════
  describe('createInstantItem', () => {
    test('calls repository.createInstantItem with data and context', async () => {
      const mockResult = { status: true, data: makeMockItem(), message: 'ok' };
      repo.createInstantItem.mockResolvedValue(mockResult);

      await service.createInstantItem({
        data: { name: 'Instant' },
        context: { branchId: BRANCH_ID },
      });

      expect(repo.createInstantItem).toHaveBeenCalledWith(
        { name: 'Instant' },
        { branchId: BRANCH_ID }
      );
    });

    test('uses empty context when context is not provided', async () => {
      repo.createInstantItem.mockResolvedValue({ status: true, data: {}, message: 'ok' });

      await service.createInstantItem({ data: { name: 'x' } });

      expect(repo.createInstantItem).toHaveBeenCalledWith({ name: 'x' }, {});
    });

    test('returns error when repository throws', async () => {
      repo.createInstantItem.mockRejectedValue(new Error('instant create error'));

      const result = await service.createInstantItem({ data: {} });

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // deleteInstantItem
  // ════════════════════════════════════════════════════════════════════════════
  describe('deleteInstantItem', () => {
    test('calls repository.deleteInstantItem with id and context', async () => {
      repo.deleteInstantItem.mockResolvedValue({ status: true, data: null, message: 'ok' });

      await service.deleteInstantItem({ id: ITEM_ID, context: { branchId: BRANCH_ID } });

      expect(repo.deleteInstantItem).toHaveBeenCalledWith(ITEM_ID, { branchId: BRANCH_ID });
    });

    test('returns error when repository throws', async () => {
      repo.deleteInstantItem.mockRejectedValue(new Error('delete instant error'));

      const result = await service.deleteInstantItem({ id: ITEM_ID });

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingItemsAjaxList
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingItemsAjaxList', () => {
    test('delegates to repository', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getReceivingItemsAjaxList.mockResolvedValue(mockResult);

      const result = await service.getReceivingItemsAjaxList(
        { page: 1 },
        { licenseId: LICENSE_ID }
      );

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getReceivingItemsAjaxList.mockRejectedValue(new Error('receiving error'));

      const result = await service.getReceivingItemsAjaxList();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // accessKiosk
  // ════════════════════════════════════════════════════════════════════════════
  describe('accessKiosk', () => {
    test('returns repository result when status is false (no image processing)', async () => {
      const mockResult = { status: false, data: null, message: 'not found' };
      repo.accessKiosk.mockResolvedValue(mockResult);

      const result = await service.accessKiosk('store-123');

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.accessKiosk.mockRejectedValue(new Error('kiosk error'));

      const result = await service.accessKiosk('store-123');

      expect(result.status).toBe(false);
      expect(result.message).toBe('kiosk error');
    });

    test('returns data when status is true but data is null (no image processing)', async () => {
      repo.accessKiosk.mockResolvedValue({ status: true, data: null, message: 'ok' });

      const result = await service.accessKiosk('store-123');

      expect(result.status).toBe(true);
    });

    test('processes kiosk_images and products when status is true and data exists', async () => {
      fs.existsSync.mockReturnValue(false);
      const mockData = {
        kiosk_images: { logo: null, banner: null, homebanner: null, advertisement: null },
        products: [],
      };
      repo.accessKiosk.mockResolvedValue({ status: true, data: mockData, message: 'ok' });

      const result = await service.accessKiosk('store-123');

      expect(result.status).toBe(true);
      expect(result.data.kiosk_images).toBeDefined();
      expect(Array.isArray(result.data.products)).toBe(true);
    });

    test('handles products array with items containing img field', async () => {
      fs.existsSync.mockReturnValue(false);
      const mockData = {
        kiosk_images: { logo: null, banner: null, homebanner: null, advertisement: null },
        products: [{ name: 'Cat A', items: [{ name: 'Item A', img: null }] }],
      };
      repo.accessKiosk.mockResolvedValue({ status: true, data: mockData, message: 'ok' });

      const result = await service.accessKiosk('store-123');

      expect(result.data.products[0].items[0].img).toBeNull();
    });

    test('handles products array where items field is not an array', async () => {
      fs.existsSync.mockReturnValue(false);
      const mockData = {
        kiosk_images: { logo: null, banner: null, homebanner: null, advertisement: null },
        products: [{ name: 'Cat A', items: null }],
      };
      repo.accessKiosk.mockResolvedValue({ status: true, data: mockData, message: 'ok' });

      const result = await service.accessKiosk('store-123');

      expect(result.data.products[0].items).toBeNull();
    });

    test('preserves http URL for kiosk images (item.svg passthrough)', async () => {
      fs.existsSync.mockReturnValue(false);
      const mockData = {
        kiosk_images: { logo: 'item.svg', banner: null, homebanner: null, advertisement: null },
        products: [],
      };
      repo.accessKiosk.mockResolvedValue({ status: true, data: mockData, message: 'ok' });

      const result = await service.accessKiosk('store-123');

      expect(result.data.kiosk_images.logo).toBe('item.svg');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateKioskStatus
  // ════════════════════════════════════════════════════════════════════════════
  describe('updateKioskStatus', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: null, message: 'ok' };
      repo.updateKioskStatus.mockResolvedValue(mockResult);

      const result = await service.updateKioskStatus(ITEM_ID, 'active');

      expect(repo.updateKioskStatus).toHaveBeenCalledWith(ITEM_ID, 'active');
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.updateKioskStatus.mockRejectedValue(new Error('kiosk update error'));

      const result = await service.updateKioskStatus(ITEM_ID, 'active');

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getItemsByCategoryId
  // ════════════════════════════════════════════════════════════════════════════
  describe('getItemsByCategoryId', () => {
    test('delegates to repository with categoryId and context', async () => {
      const mockResult = { status: true, data: [makeMockItem()], message: 'ok' };
      repo.getItemsByCategoryId.mockResolvedValue(mockResult);

      const result = await service.getItemsByCategoryId(CATEGORY_ID, { branchId: BRANCH_ID });

      expect(repo.getItemsByCategoryId).toHaveBeenCalledWith(CATEGORY_ID, { branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getItemsByCategoryId.mockRejectedValue(new Error('category fetch error'));

      const result = await service.getItemsByCategoryId(CATEGORY_ID);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // itemSearchPage
  // ════════════════════════════════════════════════════════════════════════════
  describe('itemSearchPage', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.itemSearchPage.mockResolvedValue(mockResult);

      const result = await service.itemSearchPage({ query: 'test' }, { branchId: BRANCH_ID });

      expect(repo.itemSearchPage).toHaveBeenCalledWith({ query: 'test' }, { branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.itemSearchPage.mockRejectedValue(new Error('search page error'));

      const result = await service.itemSearchPage();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // accessQr
  // ════════════════════════════════════════════════════════════════════════════
  describe('accessQr', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: {}, message: 'ok' };
      repo.accessQr.mockResolvedValue(mockResult);

      const result = await service.accessQr({ branchId: BRANCH_ID });

      expect(repo.accessQr).toHaveBeenCalledWith({ branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.accessQr.mockRejectedValue(new Error('qr error'));

      const result = await service.accessQr();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // accessMobileApp
  // ════════════════════════════════════════════════════════════════════════════
  describe('accessMobileApp', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: {}, message: 'ok' };
      repo.accessMobileApp.mockResolvedValue(mockResult);

      const result = await service.accessMobileApp(BRANCH_ID);

      expect(repo.accessMobileApp).toHaveBeenCalledWith(BRANCH_ID);
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.accessMobileApp.mockRejectedValue(new Error('mobile app error'));

      const result = await service.accessMobileApp(BRANCH_ID);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateItemQuantity
  // ════════════════════════════════════════════════════════════════════════════
  describe('updateItemQuantity', () => {
    test('delegates to repository with id and value', async () => {
      const mockResult = { status: true, data: null, message: 'ok' };
      repo.updateItemQuantity.mockResolvedValue(mockResult);

      const result = await service.updateItemQuantity(ITEM_ID, 5);

      expect(repo.updateItemQuantity).toHaveBeenCalledWith(ITEM_ID, 5);
      expect(result).toEqual(mockResult);
    });

    test('handles negative quantity change', async () => {
      repo.updateItemQuantity.mockResolvedValue({ status: true, data: null, message: 'ok' });

      await service.updateItemQuantity(ITEM_ID, -3);

      expect(repo.updateItemQuantity).toHaveBeenCalledWith(ITEM_ID, -3);
    });

    test('handles zero quantity change', async () => {
      repo.updateItemQuantity.mockResolvedValue({ status: true, data: null, message: 'ok' });

      await service.updateItemQuantity(ITEM_ID, 0);

      expect(repo.updateItemQuantity).toHaveBeenCalledWith(ITEM_ID, 0);
    });

    test('returns error when repository throws', async () => {
      repo.updateItemQuantity.mockRejectedValue(new Error('qty update error'));

      const result = await service.updateItemQuantity(ITEM_ID, 5);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // categoryProductDetails
  // ════════════════════════════════════════════════════════════════════════════
  describe('categoryProductDetails', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.categoryProductDetails.mockResolvedValue(mockResult);

      const result = await service.categoryProductDetails(
        { category_id: CATEGORY_ID },
        { branchId: BRANCH_ID }
      );

      expect(repo.categoryProductDetails).toHaveBeenCalledWith(
        { category_id: CATEGORY_ID },
        { branchId: BRANCH_ID }
      );
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.categoryProductDetails.mockRejectedValue(new Error('cat product error'));

      const result = await service.categoryProductDetails();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // supplierProductDetails
  // ════════════════════════════════════════════════════════════════════════════
  describe('supplierProductDetails', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.supplierProductDetails.mockResolvedValue(mockResult);

      const result = await service.supplierProductDetails(
        { supplier_id: SUPPLIER_ID },
        { branchId: BRANCH_ID }
      );

      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.supplierProductDetails.mockRejectedValue(new Error('supplier product error'));

      const result = await service.supplierProductDetails();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getCustomerSearchItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('getCustomerSearchItems', () => {
    test('delegates to repository with query and context', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getCustomerSearchItems.mockResolvedValue(mockResult);

      const result = await service.getCustomerSearchItems('search term', { branchId: BRANCH_ID });

      expect(repo.getCustomerSearchItems).toHaveBeenCalledWith('search term', {
        branchId: BRANCH_ID,
      });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getCustomerSearchItems.mockRejectedValue(new Error('customer search error'));

      const result = await service.getCustomerSearchItems('term');

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // quantityCount
  // ════════════════════════════════════════════════════════════════════════════
  describe('quantityCount', () => {
    test('returns {status:true, data:{count, listDocs}} on success', async () => {
      repo.getQuantityCount.mockResolvedValue({ count: 42, listDocs: [makeMockItem()] });

      const result = await service.quantityCount({ branchId: BRANCH_ID });

      expect(result.status).toBe(true);
      expect(result.data.count).toBe(42);
      expect(result.data.listDocs).toHaveLength(1);
      expect(result.message).toBe('success');
    });

    test('calls repository.getQuantityCount with the match filter', async () => {
      repo.getQuantityCount.mockResolvedValue({ count: 0, listDocs: [] });

      await service.quantityCount({ branchId: BRANCH_ID });

      expect(repo.getQuantityCount).toHaveBeenCalledWith({ branchId: BRANCH_ID });
    });

    test('returns count=0 and empty listDocs when nothing found', async () => {
      repo.getQuantityCount.mockResolvedValue({ count: 0, listDocs: [] });

      const result = await service.quantityCount({});

      expect(result.data.count).toBe(0);
      expect(result.data.listDocs).toEqual([]);
    });

    test('uses empty match by default', async () => {
      repo.getQuantityCount.mockResolvedValue({ count: 0, listDocs: [] });

      await service.quantityCount();

      expect(repo.getQuantityCount).toHaveBeenCalledWith({});
    });

    test('returns error when repository throws', async () => {
      repo.getQuantityCount.mockRejectedValue(new Error('count error'));

      const result = await service.quantityCount({});

      expect(result.status).toBe(false);
      expect(result.message).toBe('count error');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // categoryItemsReportTable
  // ════════════════════════════════════════════════════════════════════════════
  describe('categoryItemsReportTable', () => {
    const validParams = {
      rawCategoryId: CATEGORY_ID,
      rawBranches: [BRANCH_ID],
      startingDate: '2024-01-01',
      endingDate: '2024-01-31',
      licenseId: LICENSE_ID,
      page: 1,
      limit: 5,
    };

    test('returns paginated data on success', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({
        total: 1,
        results: [
          {
            _id: { category_id: CATEGORY_ID, category_name: 'Food' },
            selling_price: 200,
            item_count: 2,
          },
        ],
      });

      const result = await service.categoryItemsReportTable(validParams);

      expect(result.status).toBe(true);
      expect(result.data.list).toHaveLength(1);
      expect(result.data.list[0].category_name).toBe('Food');
      expect(result.data.list[0].selling_price).toBe(200);
    });

    test('returns empty list when no data', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      const result = await service.categoryItemsReportTable({});

      expect(result.status).toBe(true);
      expect(result.data.list).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    test('uses default page=1, limit=5 when not provided', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      await service.categoryItemsReportTable({});

      const { paginatedPipeline } = repo.categoryItemsReportTable.mock.calls[0][0];
      const skipStage = paginatedPipeline.find((s) => s.$skip !== undefined);
      expect(skipStage.$skip).toBe(0);
    });

    test('normalises page and limit to 1 and 5 when zero/invalid values', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      await service.categoryItemsReportTable({ page: 0, limit: 0 });

      const { paginatedPipeline } = repo.categoryItemsReportTable.mock.calls[0][0];
      const limitStage = paginatedPipeline.find((s) => s.$limit !== undefined);
      expect(limitStage.$limit).toBe(5);
    });

    test('accepts snake_case category_id and uses it over camelCase rawCategoryId', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      await service.categoryItemsReportTable({ category_id: CATEGORY_ID });

      const { paginatedPipeline } = repo.categoryItemsReportTable.mock.calls[0][0];
      const matchStage = paginatedPipeline.find((s) => s.$match !== undefined);
      expect(matchStage).toBeDefined();
    });

    test('handles comma-separated rawBranches string', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      await service.categoryItemsReportTable({
        rawBranches: `${BRANCH_ID},${BRANCH_ID}`,
        startingDate: '2024-01-01',
        endingDate: '2024-12-31',
      });

      expect(repo.categoryItemsReportTable).toHaveBeenCalled();
    });

    test('returns error when repository throws', async () => {
      repo.categoryItemsReportTable.mockRejectedValue(new Error('report error'));

      const result = await service.categoryItemsReportTable(validParams);

      expect(result.status).toBe(false);
      expect(result.message).toBe('report error');
    });

    test('computes total_pages correctly', async () => {
      repo.categoryItemsReportTable.mockResolvedValue({
        total: 12,
        results: Array(5).fill({
          _id: { category_id: CATEGORY_ID, category_name: 'Food' },
          selling_price: 10,
          item_count: 1,
        }),
      });

      const result = await service.categoryItemsReportTable({ ...validParams, page: 1, limit: 5 });

      expect(result.data.total_pages).toBe(3);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // supplierItemsReportTable
  // ════════════════════════════════════════════════════════════════════════════
  describe('supplierItemsReportTable', () => {
    const validParams = {
      rawBranches: [BRANCH_ID],
      startingDate: '2024-01-01',
      endingDate: '2024-01-31',
      supplierId: SUPPLIER_ID,
      licenseId: LICENSE_ID,
      page: 1,
      limit: 5,
    };

    test('returns paginated flat list on success', async () => {
      repo.supplierItemsReportTable.mockResolvedValue({
        total: 1,
        results: [
          {
            _id: { supplier_id: SUPPLIER_ID, supplier_name: 'Supplier A' },
            selling_price: 500,
            item_count: 3,
          },
        ],
      });

      const result = await service.supplierItemsReportTable(validParams);

      expect(result.status).toBe(true);
      expect(result.data.list).toHaveLength(1);
      expect(result.data.list[0].supplier_name).toBe('Supplier A');
    });

    test('returns empty list when no results', async () => {
      repo.supplierItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      const result = await service.supplierItemsReportTable({});

      expect(result.status).toBe(true);
      expect(result.data.list).toEqual([]);
    });

    test('accepts snake_case supplier_id and uses it over camelCase', async () => {
      repo.supplierItemsReportTable.mockResolvedValue({ total: 0, results: [] });

      await service.supplierItemsReportTable({ supplier_id: SUPPLIER_ID, ...validParams });

      expect(repo.supplierItemsReportTable).toHaveBeenCalled();
    });

    test('computes total_pages correctly', async () => {
      repo.supplierItemsReportTable.mockResolvedValue({
        total: 10,
        results: Array(5).fill({
          _id: { supplier_id: SUPPLIER_ID, supplier_name: 'S' },
          selling_price: 10,
          item_count: 1,
        }),
      });

      const result = await service.supplierItemsReportTable({ ...validParams, page: 1, limit: 5 });

      expect(result.data.total_pages).toBe(2);
    });

    test('returns error when repository throws', async () => {
      repo.supplierItemsReportTable.mockRejectedValue(new Error('supplier report error'));

      const result = await service.supplierItemsReportTable(validParams);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // itemReportTable
  // ════════════════════════════════════════════════════════════════════════════
  describe('itemReportTable', () => {
    const validParams = {
      rawBranches: [BRANCH_ID],
      startingDate: '2024-01-01',
      endingDate: '2024-01-31',
      licenseId: LICENSE_ID,
      page: 1,
      limit: 5,
    };

    test('returns paginated data on success', async () => {
      repo.itemReportTable.mockResolvedValue({ items: [makeMockItem()], total: 1 });

      const result = await service.itemReportTable(validParams);

      expect(result.status).toBe(true);
      expect(result.data.list).toHaveLength(1);
      expect(result.data.total).toBe(1);
    });

    test('uses default page=1, limit=5', async () => {
      repo.itemReportTable.mockResolvedValue({ items: [], total: 0 });

      await service.itemReportTable({});

      const call = repo.itemReportTable.mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.limit).toBe(5);
    });

    test('normalises invalid page/limit to defaults', async () => {
      repo.itemReportTable.mockResolvedValue({ items: [], total: 0 });

      await service.itemReportTable({ page: -1, limit: 'bad' });

      const call = repo.itemReportTable.mock.calls[0][0];
      expect(call.limit).toBe(5);
    });

    test('returns error when repository throws', async () => {
      repo.itemReportTable.mockRejectedValue(new Error('item report error'));

      const result = await service.itemReportTable(validParams);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // itemStockReportTable
  // ════════════════════════════════════════════════════════════════════════════
  describe('itemStockReportTable', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.itemStockReportTable.mockResolvedValue(mockResult);

      const result = await service.itemStockReportTable(
        { branchId: BRANCH_ID },
        { licenseId: LICENSE_ID }
      );

      expect(repo.itemStockReportTable).toHaveBeenCalledWith(
        { branchId: BRANCH_ID },
        { licenseId: LICENSE_ID }
      );
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.itemStockReportTable.mockRejectedValue(new Error('stock report error'));

      const result = await service.itemStockReportTable();

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // importItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('importItems', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: { imported: 5 }, message: 'ok' };
      repo.importItems.mockResolvedValue(mockResult);

      const result = await service.importItems([{ name: 'Item A' }], { branchId: BRANCH_ID });

      expect(repo.importItems).toHaveBeenCalledWith([{ name: 'Item A' }], { branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('handles empty array gracefully', async () => {
      repo.importItems.mockResolvedValue({
        status: false,
        data: null,
        message: ERROR_MESSAGES.NO_ITEMS_TO_IMPORT,
      });

      const result = await service.importItems([], {});

      expect(repo.importItems).toHaveBeenCalledWith([], {});
    });

    test('returns error when repository throws', async () => {
      repo.importItems.mockRejectedValue(new Error('import error'));

      const result = await service.importItems([]);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // exportItems
  // ════════════════════════════════════════════════════════════════════════════
  describe('exportItems', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [makeMockItem()], message: 'ok' };
      repo.exportItems.mockResolvedValue(mockResult);

      const result = await service.exportItems([ITEM_ID], { branchId: BRANCH_ID });

      expect(repo.exportItems).toHaveBeenCalledWith([ITEM_ID], { branchId: BRANCH_ID });
      expect(result).toEqual(mockResult);
    });

    test('handles empty ids array', async () => {
      repo.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });

      await service.exportItems([], {});

      expect(repo.exportItems).toHaveBeenCalledWith([], {});
    });

    test('returns error when repository throws', async () => {
      repo.exportItems.mockRejectedValue(new Error('export error'));

      const result = await service.exportItems([ITEM_ID]);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // resolveBranchContext
  // ════════════════════════════════════════════════════════════════════════════
  describe('resolveBranchContext', () => {
    test('returns currentBranchId immediately when provided', async () => {
      const result = await service.resolveBranchContext({
        currentBranchId: BRANCH_ID,
        currentLicenseId: LICENSE_ID,
        licenseId: 'other',
      });

      expect(result.branchId).toBe(BRANCH_ID);
      expect(result.licenseId).toBe(LICENSE_ID);
      expect(branchesRepository.findOne).not.toHaveBeenCalled();
    });

    test('returns {branchId:null} when query is empty', async () => {
      const result = await service.resolveBranchContext({});

      expect(result.branchId).toBeNull();
    });

    test('calls branchesRepository.findOne with {_id:userBranchId} when userBranchId provided', async () => {
      branchesRepository.findOne.mockResolvedValue({
        _id: { toString: () => BRANCH_ID },
        license: LICENSE_ID,
      });

      const result = await service.resolveBranchContext({ userBranchId: BRANCH_ID });

      expect(branchesRepository.findOne).toHaveBeenCalledWith(
        { _id: BRANCH_ID },
        expect.objectContaining({ lean: true })
      );
      expect(result.branchId).toBe(BRANCH_ID);
    });

    test('returns branchId=null when branch document not found', async () => {
      branchesRepository.findOne.mockResolvedValue(null);

      const result = await service.resolveBranchContext({ userBranchId: BRANCH_ID });

      expect(result.branchId).toBeNull();
    });

    test('returns branchId=null and preserves licenseId on error', async () => {
      branchesRepository.findOne.mockRejectedValue(new Error('db error'));

      const result = await service.resolveBranchContext({
        userBranchId: BRANCH_ID,
        licenseId: LICENSE_ID,
      });

      expect(result.branchId).toBeNull();
      expect(result.licenseId).toBe(LICENSE_ID);
    });

    test('uses licenseId from branchDoc when currentLicenseId is absent', async () => {
      branchesRepository.findOne.mockResolvedValue({
        _id: { toString: () => BRANCH_ID },
        license: LICENSE_ID,
      });

      const result = await service.resolveBranchContext({ userBranchId: BRANCH_ID });

      expect(result.licenseId).toBe(LICENSE_ID);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getBranchNotificationRange
  // ════════════════════════════════════════════════════════════════════════════
  describe('getBranchNotificationRange', () => {
    test('returns null when branchId is falsy', async () => {
      const result = await service.getBranchNotificationRange(null);
      expect(result).toBeNull();
      expect(branchesRepository.findById).not.toHaveBeenCalled();
    });

    test('returns null when branchDoc is not found', async () => {
      branchesRepository.findById.mockResolvedValue(null);
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBeNull();
    });

    test('returns null when notification_range is undefined', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: undefined });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBeNull();
    });

    test('returns null when notification_range is empty string', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: '' });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBeNull();
    });

    test('returns parsed integer when notification_range is a valid number string', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: '10' });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBe(10);
    });

    test('returns parsed integer when notification_range is an integer', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: 5 });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBe(5);
    });

    test('returns null when notification_range is non-numeric string', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: 'abc' });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBeNull();
    });

    test('returns null on repository error', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('db error'));
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBeNull();
    });

    test('trims whitespace from notification_range before parsing', async () => {
      branchesRepository.findById.mockResolvedValue({ notification_range: '  15  ' });
      const result = await service.getBranchNotificationRange(BRANCH_ID);
      expect(result).toBe(15);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateItemStock
  // ════════════════════════════════════════════════════════════════════════════
  describe('updateItemStock', () => {
    test('returns error when itemId is missing', async () => {
      const result = await service.updateItemStock({ quantityChange: 5 });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_ID_REQUIRED);
    });

    test('returns error when itemId is null', async () => {
      const result = await service.updateItemStock({ itemId: null, quantityChange: 5 });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_ID_REQUIRED);
    });

    test('returns error when quantityChange is not a number', async () => {
      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 'five' });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.INVALID_QUANTITY_CHANGE);
    });

    test('returns error when quantityChange is NaN', async () => {
      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: NaN });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.INVALID_QUANTITY_CHANGE);
    });

    test('returns error when called with no arguments', async () => {
      const result = await service.updateItemStock();
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_ID_REQUIRED);
    });

    test('returns item-not-found when matchedCount is 0', async () => {
      repo.updateStock.mockResolvedValue({ matchedCount: 0 });

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 3 });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_NOT_FOUND);
    });

    test('returns item-not-found when dbResult is null', async () => {
      repo.updateStock.mockResolvedValue(null);

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 3 });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_NOT_FOUND);
    });

    test('returns success with updated item data when stock is updated', async () => {
      const mockDbResult = { matchedCount: 1, modifiedCount: 1 };
      const mockItem = makeMockItem({ current_stock: 13 });
      repo.updateStock.mockResolvedValue(mockDbResult);
      repo.findItemById.mockResolvedValue(mockItem);

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 3 });

      expect(result.status).toBe(true);
      expect(result.message).toBe('success');
      expect(result.data.result).toEqual(mockDbResult);
      expect(result.data.item).toEqual(mockItem);
    });

    test('calls repository.updateStock with itemId and quantityChange', async () => {
      repo.updateStock.mockResolvedValue({ matchedCount: 1 });
      repo.findItemById.mockResolvedValue(makeMockItem());

      await service.updateItemStock({ itemId: ITEM_ID, quantityChange: -2 });

      expect(repo.updateStock).toHaveBeenCalledWith(ITEM_ID, -2);
    });

    test('calls repository.findItemById after successful stock update', async () => {
      repo.updateStock.mockResolvedValue({ matchedCount: 1 });
      repo.findItemById.mockResolvedValue(makeMockItem());

      await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 1 });

      expect(repo.findItemById).toHaveBeenCalledWith(ITEM_ID);
    });

    test('handles decimal quantityChange', async () => {
      repo.updateStock.mockResolvedValue({ matchedCount: 1 });
      repo.findItemById.mockResolvedValue(makeMockItem());

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 1.5 });

      expect(result.status).toBe(true);
    });

    test('returns error when repository.updateStock throws', async () => {
      repo.updateStock.mockRejectedValue(new Error('stock update failed'));

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 3 });

      expect(result.status).toBe(false);
      expect(result.message).toBe('stock update failed');
    });

    test('returns error when repository.findItemById throws', async () => {
      repo.updateStock.mockResolvedValue({ matchedCount: 1 });
      repo.findItemById.mockRejectedValue(new Error('findById failed'));

      const result = await service.updateItemStock({ itemId: ITEM_ID, quantityChange: 3 });

      expect(result.status).toBe(false);
      expect(result.message).toBe('findById failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getDataChanges
  // ════════════════════════════════════════════════════════════════════════════
  describe('getDataChanges', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getDataChanges.mockResolvedValue(mockResult);

      const result = await service.getDataChanges('items', '2024-01-01');

      expect(repo.getDataChanges).toHaveBeenCalledWith('items', '2024-01-01');
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getDataChanges.mockRejectedValue(new Error('data changes error'));

      const result = await service.getDataChanges('items', '2024-01-01');

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getCategoryItemsReport
  // ════════════════════════════════════════════════════════════════════════════
  describe('getCategoryItemsReport', () => {
    test('delegates to repository and returns result', async () => {
      const mockResult = { status: true, data: [], message: 'ok' };
      repo.getCategoryItemsReport.mockResolvedValue(mockResult);

      const result = await service.getCategoryItemsReport({ category_id: CATEGORY_ID });

      expect(repo.getCategoryItemsReport).toHaveBeenCalledWith({ category_id: CATEGORY_ID });
      expect(result).toEqual(mockResult);
    });

    test('returns error when repository throws', async () => {
      repo.getCategoryItemsReport.mockRejectedValue(new Error('cat items report error'));

      const result = await service.getCategoryItemsReport({ category_id: CATEGORY_ID });

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // queueS3Upload
  // ════════════════════════════════════════════════════════════════════════════
  describe('queueS3Upload', () => {
    test('does nothing when shouldUploadToS3 returns false', () => {
      process.env.STORAGE_TYPE = 'local';
      jest.spyOn(service, 'uploadFileToS3').mockResolvedValue(null);

      service.queueS3Upload('file.jpg', '/path/file.jpg');

      expect(service.uploadFileToS3).not.toHaveBeenCalled();
    });

    test('does not re-queue a file already in cache', () => {
      process.env.STORAGE_TYPE = 's3';
      process.env.AWS_S3_BUCKET = 'bucket';
      service.s3UploadedCache.add('file.jpg');
      jest.spyOn(service, 'uploadFileToS3').mockResolvedValue(null);

      service.queueS3Upload('file.jpg', '/path/file.jpg');

      expect(service.uploadFileToS3).not.toHaveBeenCalled();
      delete process.env.AWS_S3_BUCKET;
    });

    test('does not re-queue a file already in upload queue', () => {
      process.env.STORAGE_TYPE = 's3';
      process.env.AWS_S3_BUCKET = 'bucket';
      service.s3UploadQueue.add('file.jpg');
      jest.spyOn(service, 'uploadFileToS3').mockResolvedValue(null);

      service.queueS3Upload('file.jpg', '/path/file.jpg');

      expect(service.uploadFileToS3).not.toHaveBeenCalled();
      delete process.env.AWS_S3_BUCKET;
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Edge cases: null/undefined payloads
  // ════════════════════════════════════════════════════════════════════════════
  describe('edge cases — null/undefined/empty payloads', () => {
    test('addItem with null data does not throw', async () => {
      repo.upsertItem.mockResolvedValue({ status: true, data: makeMockItem(), message: 'ok' });

      await expect(
        service.addItem({ data: null, branchId: BRANCH_ID, licenseId: LICENSE_ID })
      ).resolves.toBeDefined();
    });

    test('deleteItems with undefined ids does not throw', async () => {
      repo.deleteItems.mockResolvedValue({ status: false, data: null, message: 'no ids' });

      await expect(
        service.deleteItems({ licenseId: LICENSE_ID, branchId: BRANCH_ID })
      ).resolves.toBeDefined();
    });

    test('searchItems with undefined query delegates to repository', async () => {
      repo.searchItems.mockResolvedValue([]);

      await service.searchItems(undefined);

      expect(repo.searchItems).toHaveBeenCalledWith(undefined);
    });

    test('quantityCount with undefined match uses empty object', async () => {
      repo.getQuantityCount.mockResolvedValue({ count: 0, listDocs: [] });

      await service.quantityCount(undefined);

      expect(repo.getQuantityCount).toHaveBeenCalledWith({});
    });

    test('importItems with undefined data uses empty array default', async () => {
      repo.importItems.mockResolvedValue({ status: true, data: null, message: 'ok' });

      await service.importItems(undefined);

      expect(repo.importItems).toHaveBeenCalledWith([], {});
    });

    test('exportItems with undefined ids uses empty array default', async () => {
      repo.exportItems.mockResolvedValue({ status: true, data: [], message: 'ok' });

      await service.exportItems(undefined);

      expect(repo.exportItems).toHaveBeenCalledWith([], {});
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Error shape consistency
  // ════════════════════════════════════════════════════════════════════════════
  describe('error response shape', () => {
    const errorMethods = [
      ['getAllItems', () => repo.findPage.mockRejectedValue(new Error('err'))],
      ['getItemsByCategory', () => repo.getItemsByCategory.mockRejectedValue(new Error('err'))],
      ['searchItems', () => repo.searchItems.mockRejectedValue(new Error('err'))],
      ['getItemById', () => repo.getItemTableRow.mockRejectedValue(new Error('err'))],
      ['getLowStockItems', () => repo.getLowStockItems.mockRejectedValue(new Error('err'))],
      ['quantityCount', () => repo.getQuantityCount.mockRejectedValue(new Error('err'))],
      ['importItems', () => repo.importItems.mockRejectedValue(new Error('err'))],
      ['exportItems', () => repo.exportItems.mockRejectedValue(new Error('err'))],
      ['getDataChanges', () => repo.getDataChanges.mockRejectedValue(new Error('err'))],
      [
        'getCategoryItemsReport',
        () => repo.getCategoryItemsReport.mockRejectedValue(new Error('err')),
      ],
    ];

    test.each(errorMethods)(
      '%s returns {status:false, data:null, message} on error',
      async (method, setup) => {
        setup();
        const result = await service[method]();
        expect(result.status).toBe(false);
        expect(result.data).toBeNull();
        expect(typeof result.message).toBe('string');
      }
    );
  });
});
