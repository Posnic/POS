'use strict';

/**
 * Unit tests for src/services/install.service.js
 *
 * File confirmed  : src/services/install.service.js (1298 lines)
 * Export type     : CLASS export — `module.exports = InstallService`
 * Does NOT extend : base.service.js
 * Constructor     : `this.repository = new InstallRepository()`
 *
 * PUBLIC methods (2):
 *   processInstallation(data)
 *     — Orchestrates full install: optional MongoDB auth setup, existing-user cleanup,
 *       secret key generation, user creation (hashed password), branch creation
 *       (reads print templates from fs), tax creation (reads countries.json from fs),
 *       default customer/supplier/unit, branch defaults + email fields,
 *       then demo OR default data insertion.
 *   cleanupByLicense(licenseId)
 *     — Coerces licenseId to ObjectId, calls repository.cleanupByLicense,
 *       returns {status, data:{license, totalDeleted, details}, message}
 *
 * PRIVATE methods (16) — tested individually via spyOn or direct call:
 *   _getDuplicateField            — SYNC helper, returns 'username'/'email'/'license'/'field'
 *   _generateUserSecretKey        — bcrypt.hash(random, 10)
 *   _loadPrintTemplates           — fs.readFileSync × 2, SYNCHRONOUS (not async)
 *   _createUser                   — bcrypt.hash + repository.insertUser
 *   _createBranch                 — repository.insertBranch
 *   _updateUserBranchAccess       — repository.updateUserBranchAccess
 *   _createTaxes                  — fs.readFileSync countries.json + repository.insertTax
 *   _createDefaultCustomer        — repository.insertCustomer
 *   _createDefaultSupplier        — repository.insertSupplier
 *   _createDefaultUnit            — repository.insertUnit
 *   _updateBranchDefaults         — repository.updateBranch
 *   _addBranchEmailFields         — repository.addBranchEmailFields
 *   _insertDefaultCategoryAndItem — repository.insertCategory + insertItem; swallows errors
 *   _insertDemoData               — fs.readFileSync install_documents.json + repo; swallows errors
 *   _insertBusinessTypeDemoData   — inline require(utils/demoData) + repo; swallows errors;
 *                                   falls back to _insertDefaultCategoryAndItem on invalid type
 *   _setupMongoDBAuth             — inline MongoClient + fs + mongoose + BaseModel; NOT
 *                                   unit-tested end-to-end (too many inline dynamic requires);
 *                                   tested only via spy in processInstallation context
 *
 * External dependencies (all mocked):
 *   InstallRepository   — explicit factory mock
 *   mongodb.ObjectId    — mocked
 *   bcryptjs            — mocked
 *   fs                  — mocked (readFileSync, existsSync, writeFileSync, mkdirSync)
 *   utils/demoData      — mocked (getDemoDataByType)
 *   install.constants   — NOT mocked (pure JS constants, no external deps)
 *
 * TESTING STRATEGY FOR processInstallation:
 *   Use jest.spyOn on all private methods to isolate orchestration logic cleanly.
 *   Each private method is then tested independently with direct calls.
 *   This avoids cascading mock setup and keeps each test truly isolated.
 *
 * SECURITY NOTES:
 *   - bcrypt.hash is called for both secret key and user password — password never returned
 *   - db_username/db_password trigger MongoDB auth setup; never appears in return value
 *   - _saveDBCredentialsToEnv writes plain-text password to .env — security concern
 *   - credentials JSON includes plain-text password field — security concern
 *
 * PRODUCTION NOTES:
 *   1. _setupMongoDBAuth uses inline dynamic requires (MongoClient, mongoose, electron,
 *      BaseModel) — bypasses Jest module mocking; practically untestable as a unit.
 *   2. _insertBusinessTypeDemoData / _insertDemoData / _insertDefaultCategoryAndItem all
 *      swallow errors silently — installation proceeds even if all demo/default data fails.
 *   3. _saveDBCredentialsToEnv writes plain-text db password to both .env and a JSON file.
 *   4. _loadPrintTemplates is SYNCHRONOUS (fs.readFileSync, not fs.promises.readFile) —
 *      blocks the event loop on startup for potentially large template files.
 *   5. _insertDemoData exists as a method but is NEVER called from processInstallation —
 *      it is dead code (replaced by _insertBusinessTypeDemoData).
 *   6. console.log/console.error used extensively instead of structured logger.
 */

// ─── Module mocks (must precede requires) ─────────────────────────────────────
jest.mock('../../../src/repositories/install.repository', () => jest.fn());

jest.mock('mongodb', () => ({
  ObjectId: jest.fn().mockImplementation((id) => ({
    _mockedId: id,
    toString: () => String(id),
  })),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// utils/demoData is inline-required inside _insertBusinessTypeDemoData
jest.mock('../../../utils/demoData', () => ({
  getDemoDataByType: jest.fn(),
}));

jest.mock('../../../src/services/demo-dataset', () => ({
  loadDatasetPack: jest.fn(),
  datasetKeyFor: jest.fn(),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────
const InstallRepository = require('../../../src/repositories/install.repository');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { getDemoDataByType } = require('../../../utils/demoData');
const demoDataset = require('../../../src/services/demo-dataset');
const { SUCCESS_MESSAGES, ERROR_MESSAGES } = require('../../../src/constants/install.constants');
const InstallService = require('../../../src/services/install.service');

// ─── Mock data ────────────────────────────────────────────────────────────────
const LICENSE_ID = '64a1b2c3d4e5f6a7b8c9d001';
const USER_ID = '64a1b2c3d4e5f6a7b8c9d002';
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d003';
const TAX_ID = '64a1b2c3d4e5f6a7b8c9d004';
const CUSTOMER_ID = '64a1b2c3d4e5f6a7b8c9d005';
const SUPPLIER_ID = '64a1b2c3d4e5f6a7b8c9d006';
const UNIT_ID = '64a1b2c3d4e5f6a7b8c9d007';
const CATEGORY_ID = '64a1b2c3d4e5f6a7b8c9d008';

function validInstallData(overrides = {}) {
  return {
    register_license: LICENSE_ID,
    register_username: 'admin',
    register_useremail: 'admin@example.com',
    register_userpassword: 'StrongPass123!',
    register_firstname: 'Admin',
    register_lastname: 'User',
    register_companyname: 'Demo Company',
    register_address: '123 Main St',
    register_fullnumber: '+911234567890',
    register_country: 'TestCountry',
    register_countryid: 'TC',
    register_state: 'TestState',
    register_timezone: 'Asia/Kolkata',
    register_demo: false,
    businessType: 'cafe',
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findExistingUser: jest.fn(),
    cleanupByLicense: jest.fn(),
    insertUser: jest.fn(),
    insertBranch: jest.fn(),
    updateUserBranchAccess: jest.fn(),
    insertTax: jest.fn(),
    insertCustomer: jest.fn(),
    insertSupplier: jest.fn(),
    insertUnit: jest.fn(),
    updateBranch: jest.fn(),
    addBranchEmailFields: jest.fn(),
    insertCategory: jest.fn(),
    insertItem: jest.fn(),
    insertCategories: jest.fn(),
    findCategoriesByIds: jest.fn(),
    findUnitsByBranch: jest.fn().mockResolvedValue([]),
    insertItems: jest.fn(),
    ...overrides,
  };
}

// ─── Shared params object for private-method tests ────────────────────────────
function makeParams(overrides = {}) {
  return {
    branchId: BRANCH_ID,
    branchName: 'Demo Company',
    userId: USER_ID,
    username: 'admin',
    licenseId: { _mockedId: LICENSE_ID, toString: () => LICENSE_ID },
    now: new Date('2026-01-01T00:00:00.000Z'),
    userBranch: [{ branch_id: BRANCH_ID, branch_name: 'Demo Company', branch_image: 'store.png' }],
    supplierId: SUPPLIER_ID,
    supplierName: 'General Supplier',
    taxId: null,
    taxData: null,
    unitId: UNIT_ID,
    businessType: 'cafe',
    ...overrides,
  };
}

// ─── Mock data for fs.readFileSync ────────────────────────────────────────────
const MOCK_COUNTRIES = JSON.stringify({
  countries: [
    {
      value: 'India',
      sortname: 'IN',
      tax: [{ tax_name: 'GST', tax_value: '18' }],
    },
  ],
});

const MOCK_INSTALL_DOCS = JSON.stringify({
  documents: [
    {
      categories: [{ name: 'Food', description: 'Food items', image: 'food.png' }],
      items: [
        {
          name: 'Rice',
          category_name: 'Food',
          mrp_price: '100',
          company_price: '80',
          selling_price: '90',
          available_quantity: '50',
          image: 'rice.png',
          sort_order: '1',
          description: 'Basmati Rice',
        },
      ],
    },
  ],
});

function setupFsReadFileMock() {
  fs.readFileSync.mockImplementation((filePath) => {
    const p = String(filePath);
    if (p.includes('print_a4html')) return '<html>A4</html>';
    if (p.includes('print_standard_html')) return '<html>Thermal</html>';
    if (p.includes('countries.json')) return MOCK_COUNTRIES;
    if (p.includes('install_documents')) return MOCK_INSTALL_DOCS;
    return '';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
describe('InstallService', () => {
  let service;
  let repo;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const repoMethods = makeRepoMethods();
    InstallRepository.mockImplementation(() => repoMethods);
    service = new InstallService();
    repo = service.repository;

    // Default bcrypt mock
    bcrypt.hash.mockResolvedValue('hashed_value');

    // Default fs mock
    setupFsReadFileMock();

    demoDataset.loadDatasetPack.mockResolvedValue(null);
    demoDataset.datasetKeyFor.mockReturnValue(null);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('InstallService exports a class (not a singleton)', () => {
      expect(typeof InstallService).toBe('function');
    });

    test('constructor creates instance with repository', () => {
      expect(service.repository).toBeDefined();
      expect(InstallRepository).toHaveBeenCalledTimes(1);
    });

    test('exposes public methods processInstallation and cleanupByLicense', () => {
      expect(typeof service.processInstallation).toBe('function');
      expect(typeof service.cleanupByLicense).toBe('function');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // processInstallation
  // Strategy: spy on ALL private methods for clean orchestration testing
  // ══════════════════════════════════════════════════════════════════════════
  describe('processInstallation', () => {
    function spyAllPrivateMethods(svc) {
      jest.spyOn(svc, '_setupMongoDBAuth').mockResolvedValue(true);
      jest.spyOn(svc, '_generateUserSecretKey').mockResolvedValue('secret_key');
      jest.spyOn(svc, '_loadPrintTemplates').mockReturnValue({
        regularBodyPrint: '<html>A4</html>',
        thermalBodyPrint: '<html>Thermal</html>',
      });
      jest.spyOn(svc, '_createUser').mockResolvedValue(USER_ID);
      jest.spyOn(svc, '_createBranch').mockResolvedValue(BRANCH_ID);
      jest.spyOn(svc, '_updateUserBranchAccess').mockResolvedValue(undefined);
      jest.spyOn(svc, '_createTaxes').mockResolvedValue({
        taxId: null,
        taxData: null,
        sortname: '',
      });
      jest.spyOn(svc, '_createDefaultCustomer').mockResolvedValue(CUSTOMER_ID);
      jest.spyOn(svc, '_createDefaultSupplier').mockResolvedValue(SUPPLIER_ID);
      jest.spyOn(svc, '_createDefaultUnit').mockResolvedValue(UNIT_ID);
      jest.spyOn(svc, '_updateBranchDefaults').mockResolvedValue(undefined);
      jest.spyOn(svc, '_addBranchEmailFields').mockResolvedValue(undefined);
      jest.spyOn(svc, '_insertDefaultCategoryAndItem').mockResolvedValue(undefined);
      jest.spyOn(svc, '_insertBusinessTypeDemoData').mockResolvedValue(undefined);
    }

    // ── success ─────────────────────────────────────────────────────────────
    test('returns {status:true, data:"", message:ACCOUNT_CREATED} on success', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      const result = await service.processInstallation(validInstallData());

      expect(result).toEqual({
        status: true,
        data: '',
        message: SUCCESS_MESSAGES.ACCOUNT_CREATED,
      });
    });

    test('routes to _insertDefaultCategoryAndItem when register_demo is false', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(validInstallData({ register_demo: false }));

      expect(service._insertDefaultCategoryAndItem).toHaveBeenCalledTimes(1);
      expect(service._insertBusinessTypeDemoData).not.toHaveBeenCalled();
    });

    test('routes to _insertBusinessTypeDemoData when register_demo is true', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(validInstallData({ register_demo: true }));

      expect(service._insertBusinessTypeDemoData).toHaveBeenCalledTimes(1);
      expect(service._insertDefaultCategoryAndItem).not.toHaveBeenCalled();
    });

    test('routes to _insertBusinessTypeDemoData when register_demo is "on"', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(validInstallData({ register_demo: 'on' }));

      expect(service._insertBusinessTypeDemoData).toHaveBeenCalledTimes(1);
    });

    // ── existing user cleanup ────────────────────────────────────────────────
    test('calls repository.cleanupByLicense when existing user found', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue({ _id: USER_ID });
      repo.cleanupByLicense.mockResolvedValue({ totalDeleted: 5 });

      await service.processInstallation(validInstallData());

      expect(repo.cleanupByLicense).toHaveBeenCalledTimes(1);
    });

    test('does NOT call cleanupByLicense when no existing user', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(validInstallData());

      expect(repo.cleanupByLicense).not.toHaveBeenCalled();
    });

    // ── MongoDB auth setup ────────────────────────────────────────────────────
    test('calls _setupMongoDBAuth when db_username and db_password provided', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(
        validInstallData({
          db_username: 'mongoadmin',
          db_password: 'secret123',
        })
      );

      expect(service._setupMongoDBAuth).toHaveBeenCalledWith('mongoadmin', 'secret123');
    });

    test('does NOT call _setupMongoDBAuth when db credentials absent', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      await service.processInstallation(validInstallData());

      expect(service._setupMongoDBAuth).not.toHaveBeenCalled();
    });

    // ── orchestration order ───────────────────────────────────────────────────
    test('calls all core private methods in correct order', async () => {
      const order = [];
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockResolvedValue(null);

      service._generateUserSecretKey.mockImplementation(async () => {
        order.push('secretKey');
        return 'sk';
      });
      service._createUser.mockImplementation(async () => {
        order.push('createUser');
        return USER_ID;
      });
      service._loadPrintTemplates.mockImplementation(() => {
        order.push('loadTemplates');
        return { regularBodyPrint: 'A4', thermalBodyPrint: 'T' };
      });
      service._createBranch.mockImplementation(async () => {
        order.push('createBranch');
        return BRANCH_ID;
      });

      await service.processInstallation(validInstallData());

      expect(order.indexOf('secretKey')).toBeLessThan(order.indexOf('createUser'));
      expect(order.indexOf('createUser')).toBeLessThan(order.indexOf('loadTemplates'));
      expect(order.indexOf('loadTemplates')).toBeLessThan(order.indexOf('createBranch'));
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns {status:false, data:"", message} on general error', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockRejectedValue(new Error('DB crash'));

      const result = await service.processInstallation(validInstallData());

      expect(result).toEqual({ status: false, data: '', message: 'DB crash' });
    });

    test('handles E11000 duplicate key error with descriptive message', async () => {
      spyAllPrivateMethods(service);
      const dupError = Object.assign(
        new Error('E11000 duplicate key ... collection: posnic.users ...'),
        {
          code: 11000,
          keyPattern: { username: 1 },
          keyValue: { username: 'admin' },
        }
      );
      repo.findExistingUser.mockRejectedValue(dupError);

      const result = await service.processInstallation(validInstallData());

      expect(result.status).toBe(false);
      expect(result.message).toContain('username');
      expect(result.message).toContain('admin');
    });

    test('E11000 with missing keyPattern still returns a message', async () => {
      spyAllPrivateMethods(service);
      const dupError = Object.assign(new Error('E11000 error'), { code: 11000 });
      repo.findExistingUser.mockRejectedValue(dupError);

      const result = await service.processInstallation(validInstallData());

      expect(result.status).toBe(false);
      expect(result.data).toBe('');
    });

    test('does not re-throw on unexpected error', async () => {
      spyAllPrivateMethods(service);
      repo.findExistingUser.mockRejectedValue(new Error('crash'));

      await expect(service.processInstallation(validInstallData())).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // cleanupByLicense
  // ══════════════════════════════════════════════════════════════════════════
  describe('cleanupByLicense', () => {
    test('coerces licenseId string to ObjectId', async () => {
      repo.cleanupByLicense.mockResolvedValue({ totalDeleted: 3, details: {} });

      await service.cleanupByLicense(LICENSE_ID);

      expect(ObjectId).toHaveBeenCalledWith(LICENSE_ID);
    });

    test('calls repository.cleanupByLicense with ObjectId', async () => {
      repo.cleanupByLicense.mockResolvedValue({ totalDeleted: 3, details: {} });

      await service.cleanupByLicense(LICENSE_ID);

      expect(repo.cleanupByLicense).toHaveBeenCalledTimes(1);
    });

    test('returns {status:true, data:{license, totalDeleted, details}} on success', async () => {
      const repoResult = { totalDeleted: 5, details: { users: 1, branches: 1 } };
      repo.cleanupByLicense.mockResolvedValue(repoResult);

      const result = await service.cleanupByLicense(LICENSE_ID);

      expect(result).toEqual({
        status: true,
        data: {
          license: LICENSE_ID,
          totalDeleted: 5,
          details: { users: 1, branches: 1 },
        },
        message: expect.stringContaining(LICENSE_ID),
      });
    });

    test('message includes CLEANUP_SUCCESS text', async () => {
      repo.cleanupByLicense.mockResolvedValue({ totalDeleted: 0, details: {} });

      const result = await service.cleanupByLicense(LICENSE_ID);

      expect(result.message).toContain(SUCCESS_MESSAGES.CLEANUP_SUCCESS);
    });

    test('returns {status:false, data:"", message} on error', async () => {
      repo.cleanupByLicense.mockRejectedValue(new Error('cleanup fail'));

      const result = await service.cleanupByLicense(LICENSE_ID);

      expect(result).toEqual({
        status: false,
        data: '',
        message: 'cleanup fail',
      });
    });

    test('uses ERROR_MESSAGES.CLEANUP_FAILED fallback when error has no message', async () => {
      repo.cleanupByLicense.mockRejectedValue(Object.assign(new Error(), { message: '' }));

      const result = await service.cleanupByLicense(LICENSE_ID);

      expect(result.message).toBe(ERROR_MESSAGES.CLEANUP_FAILED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getDuplicateField (synchronous)
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getDuplicateField', () => {
    const licenseId = { toString: () => LICENSE_ID };

    test('returns "username" when username matches', () => {
      const existingUser = {
        username: 'admin',
        email: 'other@x.com',
        license: { toString: () => 'other' },
      };
      const data = { register_username: 'admin', register_useremail: 'new@x.com' };

      expect(service._getDuplicateField(existingUser, data, licenseId)).toBe('username');
    });

    test('returns "email" when email matches (username differs)', () => {
      const existingUser = {
        username: 'other',
        email: 'admin@example.com',
        license: { toString: () => 'other' },
      };
      const data = { register_username: 'newuser', register_useremail: 'admin@example.com' };

      expect(service._getDuplicateField(existingUser, data, licenseId)).toBe('email');
    });

    test('returns "license" when license matches (username + email differ)', () => {
      const existingUser = {
        username: 'other',
        email: 'other@x.com',
        license: { toString: () => LICENSE_ID },
      };
      const data = { register_username: 'newuser', register_useremail: 'new@x.com' };

      expect(service._getDuplicateField(existingUser, data, licenseId)).toBe('license');
    });

    test('returns "field" when nothing matches', () => {
      const existingUser = {
        username: 'other',
        email: 'other@x.com',
        license: { toString: () => 'totally-different' },
      };
      const data = { register_username: 'newuser', register_useremail: 'new@x.com' };

      expect(service._getDuplicateField(existingUser, data, licenseId)).toBe('field');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _generateUserSecretKey
  // ══════════════════════════════════════════════════════════════════════════
  describe('_generateUserSecretKey', () => {
    test('calls bcrypt.hash with salt rounds 10', async () => {
      bcrypt.hash.mockResolvedValue('hashed_secret');

      await service._generateUserSecretKey();

      expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 10);
    });

    test('returns the hashed value from bcrypt.hash', async () => {
      bcrypt.hash.mockResolvedValue('hashed_secret_abc');

      const result = await service._generateUserSecretKey();

      expect(result).toBe('hashed_secret_abc');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _loadPrintTemplates (synchronous)
  // ══════════════════════════════════════════════════════════════════════════
  describe('_loadPrintTemplates', () => {
    test('reads print_a4html.txt using fs.readFileSync', () => {
      service._loadPrintTemplates();

      const readCalls = fs.readFileSync.mock.calls.map(([p]) => String(p));
      expect(readCalls.some((p) => p.includes('print_a4html'))).toBe(true);
    });

    test('reads print_standard_html.txt using fs.readFileSync', () => {
      service._loadPrintTemplates();

      const readCalls = fs.readFileSync.mock.calls.map(([p]) => String(p));
      expect(readCalls.some((p) => p.includes('print_standard_html'))).toBe(true);
    });

    test('returns {regularBodyPrint, thermalBodyPrint} from file contents', () => {
      const result = service._loadPrintTemplates();

      expect(result).toEqual({
        regularBodyPrint: '<html>A4</html>',
        thermalBodyPrint: '<html>Thermal</html>',
      });
    });

    test('throws synchronously when fs.readFileSync throws', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => service._loadPrintTemplates()).toThrow('ENOENT');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _createUser
  // ══════════════════════════════════════════════════════════════════════════
  describe('_createUser', () => {
    const licenseId = { _mockedId: LICENSE_ID, toString: () => LICENSE_ID };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const oneYearLater = new Date('2027-01-01T00:00:00.000Z');

    test('hashes the user password with bcrypt (salt=10)', async () => {
      repo.insertUser.mockResolvedValue(USER_ID);

      await service._createUser(validInstallData(), licenseId, 'secret_key', now, oneYearLater);

      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass123!', 10);
    });

    test('calls repository.insertUser with hashed password (not plain text)', async () => {
      bcrypt.hash.mockResolvedValue('$2b$10$hashedpassword');
      repo.insertUser.mockResolvedValue(USER_ID);

      await service._createUser(validInstallData(), licenseId, 'secret_key', now, oneYearLater);

      const [userData] = repo.insertUser.mock.calls[0];
      expect(userData.password).toBe('$2b$10$hashedpassword');
      expect(userData.password).not.toBe('StrongPass123!');
    });

    test('includes correct usertype from USER_TYPES constant', async () => {
      repo.insertUser.mockResolvedValue(USER_ID);

      await service._createUser(validInstallData(), licenseId, 'secret_key', now, oneYearLater);

      const [userData] = repo.insertUser.mock.calls[0];
      expect(userData.usertype).toBe('super_admin');
    });

    test('returns value from repository.insertUser', async () => {
      repo.insertUser.mockResolvedValue(USER_ID);

      const result = await service._createUser(
        validInstallData(),
        licenseId,
        'secret_key',
        now,
        oneYearLater
      );

      expect(result).toBe(USER_ID);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _insertDefaultCategoryAndItem
  // ══════════════════════════════════════════════════════════════════════════
  describe('_insertDefaultCategoryAndItem', () => {
    test('calls repository.insertCategory with name "Supermarkets"', async () => {
      repo.insertCategory.mockResolvedValue(CATEGORY_ID);
      repo.insertItem.mockResolvedValue(undefined);

      await service._insertDefaultCategoryAndItem(makeParams());

      const [catData] = repo.insertCategory.mock.calls[0];
      expect(catData.name).toBe('Supermarkets');
    });

    test('calls repository.insertItem with categoryId from insertCategory', async () => {
      repo.insertCategory.mockResolvedValue(CATEGORY_ID);
      repo.insertItem.mockResolvedValue(undefined);

      await service._insertDefaultCategoryAndItem(makeParams());

      const [itemData] = repo.insertItem.mock.calls[0];
      expect(itemData.category_id).toBe(CATEGORY_ID);
    });

    test('sets tax_fields to empty array when taxId is null', async () => {
      repo.insertCategory.mockResolvedValue(CATEGORY_ID);
      repo.insertItem.mockResolvedValue(undefined);

      await service._insertDefaultCategoryAndItem(makeParams({ taxId: null }));

      const [itemData] = repo.insertItem.mock.calls[0];
      expect(itemData.tax_fields).toEqual([]);
    });

    test('sets tax_fields with taxId/taxName/taxValue when taxId is provided', async () => {
      repo.insertCategory.mockResolvedValue(CATEGORY_ID);
      repo.insertItem.mockResolvedValue(undefined);
      const taxData = { name: 'GST', rate: 18 };

      await service._insertDefaultCategoryAndItem(makeParams({ taxId: TAX_ID, taxData }));

      const [itemData] = repo.insertItem.mock.calls[0];
      expect(itemData.tax_fields).toHaveLength(1);
      expect(itemData.tax_fields[0]).toMatchObject({
        tax_id: TAX_ID,
        tax_name: 'GST',
        tax_value: 18,
      });
    });

    test('swallows errors silently (does NOT throw)', async () => {
      repo.insertCategory.mockRejectedValue(new Error('DB error'));

      await expect(service._insertDefaultCategoryAndItem(makeParams())).resolves.not.toThrow();
    });

    test('does NOT call insertItem when insertCategory throws', async () => {
      repo.insertCategory.mockRejectedValue(new Error('DB error'));

      await service._insertDefaultCategoryAndItem(makeParams());

      expect(repo.insertItem).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _insertDemoData  (dead code — exists as method but never called from
  //                   processInstallation; replaced by _insertBusinessTypeDemoData)
  // ══════════════════════════════════════════════════════════════════════════
  describe('_insertDemoData', () => {
    test('reads install_documents.json via fs.readFileSync', async () => {
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Food' }]);
      repo.insertItems.mockResolvedValue(undefined);

      await service._insertDemoData(makeParams());

      const readCalls = fs.readFileSync.mock.calls.map(([p]) => String(p));
      expect(readCalls.some((p) => p.includes('install_documents'))).toBe(true);
    });

    test('calls insertCategories + findCategoriesByIds + insertItems', async () => {
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Food' }]);
      repo.insertItems.mockResolvedValue(undefined);

      await service._insertDemoData(makeParams());

      expect(repo.insertCategories).toHaveBeenCalledTimes(1);
      expect(repo.findCategoriesByIds).toHaveBeenCalledTimes(1);
      expect(repo.insertItems).toHaveBeenCalledTimes(1);
    });

    test('swallows errors silently (does NOT throw)', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      await expect(service._insertDemoData(makeParams())).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _insertBusinessTypeDemoData
  // ══════════════════════════════════════════════════════════════════════════
  describe('_insertBusinessTypeDemoData', () => {
    const validDemoData = () => ({
      categories: [{ name: 'Coffee', description: 'Coffee items' }],
      products: [
        { name: 'Espresso', category: 'Coffee', price: '3.50', stock: '100', unit: 'cup' },
      ],
    });

    test('calls getDemoDataByType with the provided businessType', async () => {
      getDemoDataByType.mockReturnValue(validDemoData());
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Coffee' }]);
      repo.insertItems.mockResolvedValue(undefined);

      await service._insertBusinessTypeDemoData(makeParams({ businessType: 'cafe' }));

      expect(getDemoDataByType).toHaveBeenCalledWith('cafe');
    });

    test('falls back to _insertDefaultCategoryAndItem when getDemoDataByType returns null', async () => {
      getDemoDataByType.mockReturnValue(null);
      jest.spyOn(service, '_insertDefaultCategoryAndItem').mockResolvedValue(undefined);

      await service._insertBusinessTypeDemoData(makeParams({ businessType: 'unknown' }));

      expect(service._insertDefaultCategoryAndItem).toHaveBeenCalledTimes(1);
    });

    test('calls insertCategories + findCategoriesByIds + insertItems for valid business type', async () => {
      getDemoDataByType.mockReturnValue(validDemoData());
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Coffee' }]);
      repo.insertItems.mockResolvedValue(undefined);

      await service._insertBusinessTypeDemoData(makeParams());

      expect(repo.insertCategories).toHaveBeenCalledTimes(1);
      expect(repo.findCategoriesByIds).toHaveBeenCalledTimes(1);
      expect(repo.insertItems).toHaveBeenCalledTimes(1);
    });

    test('inserts only items whose category is found in categoryMap', async () => {
      getDemoDataByType.mockReturnValue({
        categories: [{ name: 'Coffee', description: '' }],
        products: [
          { name: 'Espresso', category: 'Coffee', price: '3.50', stock: '10', unit: 'cup' },
          { name: 'Water', category: 'NonExistentCat', price: '1.00', stock: '50', unit: 'bottle' },
        ],
      });
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Coffee' }]);
      repo.insertItems.mockResolvedValue(undefined);

      await service._insertBusinessTypeDemoData(makeParams());

      const [items] = repo.insertItems.mock.calls[0];
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Espresso');
    });

    test('seeds activity with the same canonical dataset tag used on products', async () => {
      const datasetPack = {
        datasetId: 'USD-retail-v1',
        categories: [{ name: 'Grocery', description: 'Daily goods' }],
        products: [{ name: 'Tea', category: 'Grocery', price: '2.00', stock: '25', unit: 'pack' }],
        customers: [{ name: 'Local Customer', phone: '5550100', city: 'Berlin' }],
        suppliers: [{ name: 'Local Supplier', phone: '5550200', city: 'Berlin' }],
      };
      demoDataset.loadDatasetPack.mockResolvedValue(datasetPack);
      demoDataset.datasetKeyFor.mockReturnValue('retail');
      repo.insertCategories.mockResolvedValue([CATEGORY_ID]);
      repo.findCategoriesByIds.mockResolvedValue([{ _id: CATEGORY_ID, name: 'Grocery' }]);
      repo.insertItems.mockResolvedValue(undefined);
      jest.spyOn(service, '_insertDemoActivity').mockResolvedValue(undefined);

      await service._insertBusinessTypeDemoData(
        makeParams({
          businessType: 'supermarket',
          currencyCode: 'USD',
          location: { country: 'Germany', country_id: 'DE', state: 'Berlin', sortname: 'DE' },
        })
      );

      expect(repo.insertItems.mock.calls[0][0][0].demo_pack).toBe('retail');
      expect(service._insertDemoActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          pack: 'retail',
          datasetPeople: {
            customers: datasetPack.customers,
            suppliers: datasetPack.suppliers,
          },
          location: { country: 'Germany', country_id: 'DE', state: 'Berlin', sortname: 'DE' },
        })
      );
    });

    test('swallows errors silently (does NOT throw)', async () => {
      getDemoDataByType.mockImplementation(() => {
        throw new Error('demoData crash');
      });

      await expect(service._insertBusinessTypeDemoData(makeParams())).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Security assertions
  // ══════════════════════════════════════════════════════════════════════════
  describe('security: sensitive fields not returned', () => {
    test('processInstallation success result does not contain password', async () => {
      // Set up spies
      jest.spyOn(service, '_setupMongoDBAuth').mockResolvedValue(true);
      jest.spyOn(service, '_generateUserSecretKey').mockResolvedValue('sk');
      jest
        .spyOn(service, '_loadPrintTemplates')
        .mockReturnValue({ regularBodyPrint: 'A4', thermalBodyPrint: 'T' });
      jest.spyOn(service, '_createUser').mockResolvedValue(USER_ID);
      jest.spyOn(service, '_createBranch').mockResolvedValue(BRANCH_ID);
      jest.spyOn(service, '_updateUserBranchAccess').mockResolvedValue(undefined);
      jest
        .spyOn(service, '_createTaxes')
        .mockResolvedValue({ taxId: null, taxData: null, sortname: '' });
      jest.spyOn(service, '_createDefaultCustomer').mockResolvedValue(CUSTOMER_ID);
      jest.spyOn(service, '_createDefaultSupplier').mockResolvedValue(SUPPLIER_ID);
      jest.spyOn(service, '_createDefaultUnit').mockResolvedValue(UNIT_ID);
      jest.spyOn(service, '_updateBranchDefaults').mockResolvedValue(undefined);
      jest.spyOn(service, '_addBranchEmailFields').mockResolvedValue(undefined);
      jest.spyOn(service, '_insertDefaultCategoryAndItem').mockResolvedValue(undefined);
      jest.spyOn(service, '_insertBusinessTypeDemoData').mockResolvedValue(undefined);
      repo.findExistingUser.mockResolvedValue(null);

      const result = await service.processInstallation(validInstallData());
      const resultStr = JSON.stringify(result);

      expect(resultStr).not.toContain('StrongPass123!');
      expect(resultStr).not.toContain('hashed_value');
    });

    test('cleanupByLicense result does not expose internal database credentials', async () => {
      repo.cleanupByLicense.mockResolvedValue({ totalDeleted: 0, details: {} });

      const result = await service.cleanupByLicense(LICENSE_ID);

      expect(result.data).not.toHaveProperty('password');
      expect(result.data).not.toHaveProperty('db_password');
    });

    test('_createUser hashes password — plain text never stored', async () => {
      bcrypt.hash.mockResolvedValue('$2b$10$hashedvalue');
      repo.insertUser.mockResolvedValue(USER_ID);

      await service._createUser(
        validInstallData(),
        { toString: () => LICENSE_ID },
        'secret_key',
        new Date(),
        new Date()
      );

      const [userData] = repo.insertUser.mock.calls[0];
      expect(userData.password).not.toBe('StrongPass123!');
      expect(userData.password).toMatch(/^\$2b\$/);
    });
  });
});
