'use strict';

/**
 * Unit tests for src/services/branches.service.js
 *
 * File confirmed  : src/services/branches.service.js (243 lines)
 * Classification  : Singleton service (exports `new BranchesService()`)
 *                   Does NOT extend base.service.js
 * Consumers       : src/controllers/branches.controller.js
 *
 * Related files (all mocked):
 *   src/repositories/branches.repository.js  — mocked (all DB calls)
 *   src/models/branch.model.js               — mocked (BranchModel named export)
 *   src/constants/branches.constants.js      — used as-is (pure constants)
 *   mongoose                                 — mocked (inline require in normalizeBranchId)
 *
 * Exported methods (8):
 *   getBranchStatistics()
 *   searchBranches(query, limit)
 *   toggleBranchStatus(branchId)
 *   getBranchOptions()
 *   getFirstBranch()
 *   normalizeBranchId(candidates)          — synchronous, no DB, complex logic
 *   resolveBranchForContext({ userBranchId, licenseId })
 *   getBranchById(id, { lean })
 *
 * PRODUCTION NOTES:
 *   - `normalizeBranchId` lazy-requires mongoose inside the method body.
 *     This is fine at runtime but is an anti-pattern; prefer a top-level import.
 *   - `branchModel` instance (`new BranchModel.BranchModel()`) is constructed
 *     in the service constructor but NEVER used by any service method — all
 *     DB access goes through `this.repository`. Dead code.
 *   - No CRUD create/update/delete methods in this service — those appear to
 *     live in the controller calling the repository directly.
 *   - `getFirstBranch` returns the raw result or null (no wrapper object),
 *     inconsistent with the `{status, message, data}` pattern used everywhere else.
 *   - `getBranchById` also returns raw result or null (no wrapper object).
 *   - `resolveBranchForContext` returns raw result or null (no wrapper object).
 */

// ─── Mock mongoose (used via inline require inside normalizeBranchId) ─────────
jest.mock('mongoose', () => {
  class MockObjectId {
    constructor(id) {
      this._rawId = id || 'mocked_objectid';
    }
    toString() {
      return this._rawId;
    }
  }
  return { Types: { ObjectId: MockObjectId } };
});

// ─── Mock branches.repository ─────────────────────────────────────────────────
jest.mock('../../../src/repositories/branch.repository', () => ({
  getBranchStats: jest.fn(),
  searchBranches: jest.fn(),
  findById: jest.fn(),
  getBranchOptions: jest.fn(),
  getFirstBranch: jest.fn(),
  findOne: jest.fn(),
}));

// ─── Mock branch.model (named export: { BranchModel: class }) ─────────────────
jest.mock('../../../src/models/branch.model', () => ({
  BranchModel: jest.fn().mockImplementation(() => ({})),
}));

// ─── Requires (after mocks) ───────────────────────────────────────────────────
const branchesRepository = require('../../../src/repositories/branch.repository');
const branchesService = require('../../../src/services/branch.service');
const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  BRANCH_STATUS,
} = require('../../../src/constants/branches.constants');

// ─── Mock data helpers ────────────────────────────────────────────────────────
function makeMockBranch(overrides = {}) {
  return {
    _id: 'branch_abc123',
    name: 'Main Branch',
    status: BRANCH_STATUS.ACTIVE,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const MOCK_STATS = { total: 5, active: 4, inactive: 1 };
const MOCK_OPTIONS = [{ _id: 'branch_abc123', name: 'Main Branch' }];

// ══════════════════════════════════════════════════════════════════════════════
describe('BranchesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Service initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('branchesService is a singleton object (not a class)', () => {
      expect(typeof branchesService).toBe('object');
      expect(branchesService).not.toBeNull();
    });

    test('exposes all 8 service methods', () => {
      expect(typeof branchesService.getBranchStatistics).toBe('function');
      expect(typeof branchesService.searchBranches).toBe('function');
      expect(typeof branchesService.toggleBranchStatus).toBe('function');
      expect(typeof branchesService.getBranchOptions).toBe('function');
      expect(typeof branchesService.getFirstBranch).toBe('function');
      expect(typeof branchesService.normalizeBranchId).toBe('function');
      expect(typeof branchesService.resolveBranchForContext).toBe('function');
      expect(typeof branchesService.getBranchById).toBe('function');
    });

    test('repository points to the mocked branchesRepository', () => {
      expect(branchesService.repository).toBe(branchesRepository);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getBranchStatistics
  // ══════════════════════════════════════════════════════════════════════════
  describe('getBranchStatistics', () => {
    test('returns {status:true, message, data:stats} on success', async () => {
      branchesRepository.getBranchStats.mockResolvedValue(MOCK_STATS);

      const result = await branchesService.getBranchStatistics();

      expect(result).toEqual({
        status: true,
        message: SUCCESS_MESSAGES.RETRIEVED,
        data: MOCK_STATS,
      });
    });

    test('calls repository.getBranchStats with no arguments', async () => {
      branchesRepository.getBranchStats.mockResolvedValue(MOCK_STATS);
      await branchesService.getBranchStatistics();
      expect(branchesRepository.getBranchStats).toHaveBeenCalledWith();
    });

    test('returns {status:false, message:error.message, data:null} on error', async () => {
      branchesRepository.getBranchStats.mockRejectedValue(new Error('DB unreachable'));

      const result = await branchesService.getBranchStatistics();

      expect(result).toEqual({
        status: false,
        message: 'DB unreachable',
        data: null,
      });
    });

    test('falls back to ERROR_MESSAGES.NOT_FOUND when error has no message', async () => {
      branchesRepository.getBranchStats.mockRejectedValue({});

      const result = await branchesService.getBranchStatistics();

      expect(result.message).toBe(ERROR_MESSAGES.NOT_FOUND);
      expect(result.status).toBe(false);
    });

    test('does not re-throw on error', async () => {
      branchesRepository.getBranchStats.mockRejectedValue(new Error('fail'));
      await expect(branchesService.getBranchStatistics()).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // searchBranches
  // ══════════════════════════════════════════════════════════════════════════
  describe('searchBranches', () => {
    // ── validation ──────────────────────────────────────────────────────────
    test('returns early error when query is null', async () => {
      const result = await branchesService.searchBranches(null);
      expect(result).toEqual({
        status: false,
        message: 'Search query must be at least 2 characters',
        data: null,
      });
    });

    test('returns early error when query is undefined', async () => {
      const result = await branchesService.searchBranches(undefined);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Search query must be at least 2 characters');
    });

    test('returns early error when query is empty string', async () => {
      const result = await branchesService.searchBranches('');
      expect(result.status).toBe(false);
    });

    test('returns early error when query is 1 character', async () => {
      const result = await branchesService.searchBranches('a');
      expect(result.status).toBe(false);
      expect(result.message).toBe('Search query must be at least 2 characters');
    });

    test('does NOT call repository when query is too short', async () => {
      await branchesService.searchBranches('a');
      expect(branchesRepository.searchBranches).not.toHaveBeenCalled();
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('returns {status:true, data:branches} when query is 2+ chars', async () => {
      const branches = [makeMockBranch()];
      branchesRepository.searchBranches.mockResolvedValue(branches);

      const result = await branchesService.searchBranches('Ma');

      expect(result).toEqual({
        status: true,
        message: SUCCESS_MESSAGES.LIST_RETRIEVED,
        data: branches,
      });
    });

    test('passes query and default limit (10) to repository', async () => {
      branchesRepository.searchBranches.mockResolvedValue([]);

      await branchesService.searchBranches('Main');

      expect(branchesRepository.searchBranches).toHaveBeenCalledWith('Main', 10);
    });

    test('passes custom limit to repository', async () => {
      branchesRepository.searchBranches.mockResolvedValue([]);

      await branchesService.searchBranches('Main', 25);

      expect(branchesRepository.searchBranches).toHaveBeenCalledWith('Main', 25);
    });

    test('handles query with spaces and special characters', async () => {
      branchesRepository.searchBranches.mockResolvedValue([]);

      await branchesService.searchBranches('Main & Sub');

      expect(branchesRepository.searchBranches).toHaveBeenCalledWith('Main & Sub', 10);
    });

    test('handles empty result list correctly', async () => {
      branchesRepository.searchBranches.mockResolvedValue([]);

      const result = await branchesService.searchBranches('xyz');

      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    // ── error handling ───────────────────────────────────────────────────────
    test('returns {status:false, message} on repository error', async () => {
      branchesRepository.searchBranches.mockRejectedValue(new Error('Search failed'));

      const result = await branchesService.searchBranches('Main');

      expect(result).toEqual({ status: false, message: 'Search failed', data: null });
    });

    test('does not re-throw on error', async () => {
      branchesRepository.searchBranches.mockRejectedValue(new Error('fail'));
      await expect(branchesService.searchBranches('Main')).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toggleBranchStatus
  // ══════════════════════════════════════════════════════════════════════════
  describe('toggleBranchStatus', () => {
    test('returns {status:false, NOT_FOUND} when branch not found', async () => {
      branchesRepository.findById.mockResolvedValue(null);

      const result = await branchesService.toggleBranchStatus('nonexistent_id');

      expect(result).toEqual({
        status: false,
        message: ERROR_MESSAGES.NOT_FOUND,
        data: null,
      });
    });

    test('does NOT call branch.save when branch is not found', async () => {
      branchesRepository.findById.mockResolvedValue(null);
      const mockBranch = makeMockBranch();

      await branchesService.toggleBranchStatus('bad_id');
      expect(mockBranch.save).not.toHaveBeenCalled();
    });

    test('toggles status from active to inactive', async () => {
      const mockBranch = makeMockBranch({ status: BRANCH_STATUS.ACTIVE });
      branchesRepository.findById.mockResolvedValue(mockBranch);

      await branchesService.toggleBranchStatus('branch_abc123');

      expect(mockBranch.status).toBe(BRANCH_STATUS.INACTIVE);
    });

    test('toggles status from inactive to active', async () => {
      const mockBranch = makeMockBranch({ status: BRANCH_STATUS.INACTIVE });
      branchesRepository.findById.mockResolvedValue(mockBranch);

      await branchesService.toggleBranchStatus('branch_abc123');

      expect(mockBranch.status).toBe(BRANCH_STATUS.ACTIVE);
    });

    test('calls branch.save() after toggling status', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.findById.mockResolvedValue(mockBranch);

      await branchesService.toggleBranchStatus('branch_abc123');

      expect(mockBranch.save).toHaveBeenCalled();
    });

    test('returns {status:true, STATUS_TOGGLED, data:branch} on success', async () => {
      const mockBranch = makeMockBranch({ status: BRANCH_STATUS.ACTIVE });
      branchesRepository.findById.mockResolvedValue(mockBranch);

      const result = await branchesService.toggleBranchStatus('branch_abc123');

      expect(result).toEqual({
        status: true,
        message: SUCCESS_MESSAGES.STATUS_TOGGLED,
        data: mockBranch,
      });
    });

    test('returns updated branch (with new status) in data', async () => {
      const mockBranch = makeMockBranch({ status: BRANCH_STATUS.ACTIVE });
      branchesRepository.findById.mockResolvedValue(mockBranch);

      const result = await branchesService.toggleBranchStatus('branch_abc123');

      expect(result.data.status).toBe(BRANCH_STATUS.INACTIVE);
    });

    test('returns {status:false, UPDATE_FAILED} when repository throws', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('Lock timeout'));

      const result = await branchesService.toggleBranchStatus('branch_abc123');

      expect(result).toEqual({ status: false, message: 'Lock timeout', data: null });
    });

    test('falls back to UPDATE_FAILED message when error has no message', async () => {
      branchesRepository.findById.mockRejectedValue({});

      const result = await branchesService.toggleBranchStatus('branch_abc123');

      expect(result.message).toBe(ERROR_MESSAGES.UPDATE_FAILED);
    });

    test('does not re-throw on repository error', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('fail'));
      await expect(branchesService.toggleBranchStatus('id')).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getBranchOptions
  // ══════════════════════════════════════════════════════════════════════════
  describe('getBranchOptions', () => {
    test('returns {status:true, data:options} on success', async () => {
      branchesRepository.getBranchOptions.mockResolvedValue(MOCK_OPTIONS);

      const result = await branchesService.getBranchOptions();

      expect(result).toEqual({
        status: true,
        message: SUCCESS_MESSAGES.LIST_RETRIEVED,
        data: MOCK_OPTIONS,
      });
    });

    test('calls repository.getBranchOptions with no arguments', async () => {
      branchesRepository.getBranchOptions.mockResolvedValue([]);
      await branchesService.getBranchOptions();
      expect(branchesRepository.getBranchOptions).toHaveBeenCalledWith();
    });

    test('returns {status:false} on repository error', async () => {
      branchesRepository.getBranchOptions.mockRejectedValue(new Error('Query failed'));

      const result = await branchesService.getBranchOptions();

      expect(result.status).toBe(false);
      expect(result.message).toBe('Query failed');
      expect(result.data).toBeNull();
    });

    test('does not re-throw on error', async () => {
      branchesRepository.getBranchOptions.mockRejectedValue(new Error('fail'));
      await expect(branchesService.getBranchOptions()).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getFirstBranch
  // ══════════════════════════════════════════════════════════════════════════
  describe('getFirstBranch', () => {
    test('returns branch document on success', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.getFirstBranch.mockResolvedValue(mockBranch);

      const result = await branchesService.getFirstBranch();

      expect(result).toBe(mockBranch);
    });

    test('calls repository.getFirstBranch with no arguments', async () => {
      branchesRepository.getFirstBranch.mockResolvedValue(null);
      await branchesService.getFirstBranch();
      expect(branchesRepository.getFirstBranch).toHaveBeenCalledWith();
    });

    test('returns null on error (NOT a wrapper object)', async () => {
      branchesRepository.getFirstBranch.mockRejectedValue(new Error('fail'));

      const result = await branchesService.getFirstBranch();

      expect(result).toBeNull();
    });

    test('returns null when repository returns null', async () => {
      branchesRepository.getFirstBranch.mockResolvedValue(null);
      const result = await branchesService.getFirstBranch();
      expect(result).toBeNull();
    });

    test('does not re-throw on error', async () => {
      branchesRepository.getFirstBranch.mockRejectedValue(new Error('fail'));
      await expect(branchesService.getFirstBranch()).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // normalizeBranchId (synchronous — no DB)
  // ══════════════════════════════════════════════════════════════════════════
  describe('normalizeBranchId', () => {
    // ── null / empty inputs ──────────────────────────────────────────────────
    test('returns null for empty candidates array', () => {
      expect(branchesService.normalizeBranchId([])).toBeNull();
    });

    test('returns null when all candidates are null', () => {
      expect(branchesService.normalizeBranchId([null, null])).toBeNull();
    });

    test('returns null when all candidates are undefined', () => {
      expect(branchesService.normalizeBranchId([undefined, undefined])).toBeNull();
    });

    test('returns null when all candidates are falsy (0, false, "")', () => {
      expect(branchesService.normalizeBranchId([0, false, ''])).toBeNull();
    });

    // ── plain strings ────────────────────────────────────────────────────────
    test('returns trimmed plain string as-is', () => {
      expect(branchesService.normalizeBranchId(['branch_123'])).toBe('branch_123');
    });

    test('trims leading/trailing whitespace from string', () => {
      expect(branchesService.normalizeBranchId(['  branch_123  '])).toBe('branch_123');
    });

    test('returns null for string "null"', () => {
      expect(branchesService.normalizeBranchId(['null'])).toBeNull();
    });

    test('returns null for string "NULL" (case-insensitive)', () => {
      expect(branchesService.normalizeBranchId(['NULL'])).toBeNull();
    });

    test('returns null for string "undefined"', () => {
      expect(branchesService.normalizeBranchId(['undefined'])).toBeNull();
    });

    test('returns null for string "UNDEFINED" (case-insensitive)', () => {
      expect(branchesService.normalizeBranchId(['UNDEFINED'])).toBeNull();
    });

    test('returns null for whitespace-only string', () => {
      expect(branchesService.normalizeBranchId(['   '])).toBeNull();
    });

    // ── ObjectId string patterns ─────────────────────────────────────────────
    test('extracts hex ID from ObjectId("...") format', () => {
      const id = 'abc123def456abc123def456';
      expect(branchesService.normalizeBranchId([`ObjectId("${id}")`])).toBe(id);
    });

    test("extracts hex ID from ObjectId('...') single-quote format", () => {
      const id = 'abc123def456abc123def456';
      expect(branchesService.normalizeBranchId([`ObjectId('${id}')`])).toBe(id);
    });

    test('extracts hex ID from ObjectId(...) without quotes', () => {
      const id = 'abc123def456abc123def456';
      expect(branchesService.normalizeBranchId([`ObjectId(${id})`])).toBe(id);
    });

    test('extracts hex ID case-insensitively: OBJECTID("...")', () => {
      const id = 'abc123def456abc123def456';
      expect(branchesService.normalizeBranchId([`OBJECTID("${id}")`])).toBe(id);
    });

    // ── JSON-encoded objects ─────────────────────────────────────────────────
    test('extracts $oid from JSON-encoded object string: \'{"$oid":"..."}\'', () => {
      const id = 'abc123def456abc123def456';
      const jsonStr = JSON.stringify({ $oid: id });
      expect(branchesService.normalizeBranchId([jsonStr])).toBe(id);
    });

    test('extracts _id from JSON-encoded object string: \'{"_id":"..."}\'', () => {
      const id = 'branch_xyz';
      const jsonStr = JSON.stringify({ _id: id });
      expect(branchesService.normalizeBranchId([jsonStr])).toBe(id);
    });

    test('returns null for malformed JSON object string', () => {
      expect(branchesService.normalizeBranchId(['{bad:json}'])).toBe('{bad:json}');
    });

    // ── URL-encoded JSON ─────────────────────────────────────────────────────
    test('decodes and extracts from URL-encoded JSON: %7B"$oid":"..."%7D', () => {
      const id = 'abc123def456abc123def456';
      const encoded = encodeURIComponent(JSON.stringify({ $oid: id }));
      expect(branchesService.normalizeBranchId([encoded])).toBe(id);
    });

    // ── plain objects ────────────────────────────────────────────────────────
    test('returns $oid from object with $oid property', () => {
      const id = 'abc123def456abc123def456';
      expect(branchesService.normalizeBranchId([{ $oid: id }])).toBe(id);
    });

    test('recursively resolves _id string from object', () => {
      expect(branchesService.normalizeBranchId([{ _id: 'branch_inner' }])).toBe('branch_inner');
    });

    test('resolves id string from object with id property', () => {
      expect(branchesService.normalizeBranchId([{ id: 'branch_id_val' }])).toBe('branch_id_val');
    });

    test('returns toString() result from object if not "[object Object]"', () => {
      const obj = { toString: () => 'custom_string_id' };
      expect(branchesService.normalizeBranchId([obj])).toBe('custom_string_id');
    });

    test('returns null from plain object with no recognized fields', () => {
      expect(branchesService.normalizeBranchId([{ foo: 'bar' }])).toBeNull();
    });

    // ── MongoDB ObjectId-like (_bsontype) ─────────────────────────────────────
    test('returns toString() of ObjectId-like object (_bsontype: "ObjectID")', () => {
      const objectIdLike = {
        _bsontype: 'ObjectID',
        toString: () => 'bson_id_abc123',
      };
      expect(branchesService.normalizeBranchId([objectIdLike])).toBe('bson_id_abc123');
    });

    // ── first-valid logic ────────────────────────────────────────────────────
    test('returns the first valid candidate (skips null, returns second)', () => {
      expect(branchesService.normalizeBranchId([null, 'second_valid'])).toBe('second_valid');
    });

    test('returns the first valid candidate from many', () => {
      expect(
        branchesService.normalizeBranchId([null, undefined, '', 'branch_first', 'branch_second'])
      ).toBe('branch_first');
    });

    test('returns null only when NO candidate produces a valid ID', () => {
      expect(
        branchesService.normalizeBranchId([null, undefined, '', 'null', 'undefined'])
      ).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // resolveBranchForContext
  // ══════════════════════════════════════════════════════════════════════════
  describe('resolveBranchForContext', () => {
    test('calls repository.findById when userBranchId is provided', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.findById.mockResolvedValue(mockBranch);

      const result = await branchesService.resolveBranchForContext({
        userBranchId: 'branch_abc123',
      });

      expect(branchesRepository.findById).toHaveBeenCalledWith('branch_abc123', { lean: true });
      expect(result).toBe(mockBranch);
    });

    test('does NOT call repository.findOne when userBranchId is provided', async () => {
      branchesRepository.findById.mockResolvedValue(makeMockBranch());
      await branchesService.resolveBranchForContext({ userBranchId: 'b1', licenseId: 'lic1' });
      expect(branchesRepository.findOne).not.toHaveBeenCalled();
    });

    test('calls repository.findOne with license filter when only licenseId provided', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.findOne.mockResolvedValue(mockBranch);

      const result = await branchesService.resolveBranchForContext({
        licenseId: 'lic_abc',
      });

      expect(branchesRepository.findOne).toHaveBeenCalledWith(
        { license: 'lic_abc' },
        { lean: true }
      );
      expect(result).toBe(mockBranch);
    });

    test('calls repository.findOne with empty filter when neither arg provided', async () => {
      branchesRepository.findOne.mockResolvedValue(null);

      await branchesService.resolveBranchForContext({});

      expect(branchesRepository.findOne).toHaveBeenCalledWith({}, { lean: true });
    });

    test('calls repository.findOne with empty filter when called with no args', async () => {
      branchesRepository.findOne.mockResolvedValue(null);

      await branchesService.resolveBranchForContext();

      expect(branchesRepository.findOne).toHaveBeenCalledWith({}, { lean: true });
    });

    test('returns null on error (NOT a wrapper object)', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('DB timeout'));

      const result = await branchesService.resolveBranchForContext({
        userBranchId: 'branch_abc123',
      });

      expect(result).toBeNull();
    });

    test('does not re-throw on error', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('fail'));
      await expect(
        branchesService.resolveBranchForContext({ userBranchId: 'id' })
      ).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getBranchById
  // ══════════════════════════════════════════════════════════════════════════
  describe('getBranchById', () => {
    test('calls repository.findById with id and {lean:true} by default', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.findById.mockResolvedValue(mockBranch);

      await branchesService.getBranchById('branch_abc123');

      expect(branchesRepository.findById).toHaveBeenCalledWith('branch_abc123', { lean: true });
    });

    test('returns branch document on success', async () => {
      const mockBranch = makeMockBranch();
      branchesRepository.findById.mockResolvedValue(mockBranch);

      const result = await branchesService.getBranchById('branch_abc123');

      expect(result).toBe(mockBranch);
    });

    test('passes lean:false when overridden', async () => {
      branchesRepository.findById.mockResolvedValue(makeMockBranch());

      await branchesService.getBranchById('branch_abc123', { lean: false });

      expect(branchesRepository.findById).toHaveBeenCalledWith('branch_abc123', { lean: false });
    });

    test('returns null when repository returns null', async () => {
      branchesRepository.findById.mockResolvedValue(null);
      const result = await branchesService.getBranchById('nonexistent');
      expect(result).toBeNull();
    });

    test('returns null on error (NOT a wrapper object)', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('fail'));
      const result = await branchesService.getBranchById('branch_abc123');
      expect(result).toBeNull();
    });

    test('does not re-throw on error', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('crash'));
      await expect(branchesService.getBranchById('id')).resolves.not.toThrow();
    });
  });
});
