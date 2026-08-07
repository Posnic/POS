'use strict';

/**
 * Unit tests for src/services/base.service.js
 *
 * File confirmed  : src/services/base.service.js (125 lines)
 * Classification  : Singleton service (exports `new BaseService()`)
 *                   NOT a parent/base class — no other service extends it.
 *                   Handles autocomplete / suggestion operations only.
 * Consumer        : src/controllers/base.controller.js (only consumer)
 *
 * Related files:
 *   src/repositories/base.repository.js  — dependency (mocked)
 *   src/models/base.model.js             — used by repository (not direct dep)
 *
 * ORM       : Native MongoDB driver (via BaseModel/BaseRepository)
 * Framework : Jest (pre-configured)
 * Strategy  : Mock `base.repository` singleton at module level so that
 *             the service's `this.repository` reference points to the mock.
 *             No DB connection. No real MongoDB queries.
 *
 * Exported methods (3):
 *   getAutoSuggestions(field, collectionName, query, user)
 *   getReportAutoSuggestions(query, field, collectionName, branchIds, user)
 *   getDefaultSuggestions(module, query, user)
 *
 * Context building from user object (optional chaining):
 *   license  : user?.license  || user?.license_id  || null
 *   branchId : user?.branch_id || user?.default_branch_id || null
 *   userId   : user?._id || user?.id || null  (getAutoSuggestions only)
 *
 * Error handling: all methods catch any thrown error and return
 *   { status: false, data: [], message: error.message }
 *
 * PRODUCTION NOTES:
 *   - Uses `console.error` for logging instead of a structured logger.
 *     Should be replaced with the project logger (src/utils/logger.js).
 *   - `getAutoSuggestions` validates `collectionName` but
 *     `getReportAutoSuggestions` and `getDefaultSuggestions` do NOT —
 *     missing `collectionName` / `module` will reach the repository unchecked.
 *   - No tenant isolation validation at service level; trust is placed entirely
 *     in the repository to apply license/branch scoping.
 */

// ─── Mock base.repository before requiring the service ───────────────────────
// base.service.js does `this.repository = baseRepository` in constructor.
// Jest.mock hoisting ensures the mock is active before new BaseService() runs.
jest.mock('../../../src/repositories/base.repository', () => ({
  autoSuggestionTableField: jest.fn(),
  autoSuggestionReportTableField: jest.fn(),
  getDefaultSuggestion: jest.fn(),
}));

// ─── Requires ────────────────────────────────────────────────────────────────
const baseService = require('../../../src/services/base.service');
const baseRepository = require('../../../src/repositories/base.repository');

// ─── Mock data helpers ────────────────────────────────────────────────────────
function makeUser(overrides = {}) {
  return {
    license: 'license_abc123',
    branch_id: 'branch_xyz456',
    _id: 'user_001',
    ...overrides,
  };
}

const MOCK_RESULT = {
  status: true,
  data: [{ _id: 'item_1', name: 'Alpha Store' }],
};

// ══════════════════════════════════════════════════════════════════════════════
describe('BaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Service initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('baseService is an object (singleton export, not a class)', () => {
      expect(typeof baseService).toBe('object');
      expect(baseService).not.toBeNull();
    });

    test('exposes getAutoSuggestions method', () => {
      expect(typeof baseService.getAutoSuggestions).toBe('function');
    });

    test('exposes getReportAutoSuggestions method', () => {
      expect(typeof baseService.getReportAutoSuggestions).toBe('function');
    });

    test('exposes getDefaultSuggestions method', () => {
      expect(typeof baseService.getDefaultSuggestions).toBe('function');
    });

    test('repository points to the mocked baseRepository singleton', () => {
      expect(baseService.repository).toBe(baseRepository);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAutoSuggestions
  // ══════════════════════════════════════════════════════════════════════════
  describe('getAutoSuggestions', () => {
    // ── validation ──────────────────────────────────────────────────────────
    test('returns early error when collectionName is undefined', async () => {
      const result = await baseService.getAutoSuggestions('name', undefined, 'alpha', makeUser());
      expect(result).toEqual({ status: false, data: [], message: 'Module is required' });
    });

    test('returns early error when collectionName is null', async () => {
      const result = await baseService.getAutoSuggestions('name', null, 'alpha', makeUser());
      expect(result).toEqual({ status: false, data: [], message: 'Module is required' });
    });

    test('returns early error when collectionName is empty string', async () => {
      const result = await baseService.getAutoSuggestions('name', '', 'alpha', makeUser());
      expect(result).toEqual({ status: false, data: [], message: 'Module is required' });
    });

    test('does NOT call repository when collectionName is missing', async () => {
      await baseService.getAutoSuggestions('name', null, 'alpha', makeUser());
      expect(baseRepository.autoSuggestionTableField).not.toHaveBeenCalled();
    });

    // ── context building ────────────────────────────────────────────────────
    test('passes license, branchId, userId from primary user fields', async () => {
      const user = makeUser({ license: 'lic_1', branch_id: 'br_1', _id: 'usr_1' });
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test', user);

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        { license: 'lic_1', branchId: 'br_1', userId: 'usr_1' }
      );
    });

    test('falls back to license_id when license is not set', async () => {
      const user = { license_id: 'lic_fallback', branch_id: 'br_1', _id: 'usr_1' };
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test', user);

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        expect.objectContaining({ license: 'lic_fallback' })
      );
    });

    test('falls back to default_branch_id when branch_id is not set', async () => {
      const user = { license: 'lic_1', default_branch_id: 'br_fallback', _id: 'usr_1' };
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test', user);

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        expect.objectContaining({ branchId: 'br_fallback' })
      );
    });

    test('falls back to id when _id is not set', async () => {
      const user = { license: 'lic_1', branch_id: 'br_1', id: 'usr_fallback' };
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test', user);

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        expect.objectContaining({ userId: 'usr_fallback' })
      );
    });

    test('passes null context values when user is null', async () => {
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test', null);

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        { license: null, branchId: null, userId: null }
      );
    });

    test('passes null context values when user is omitted (default param)', async () => {
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('name', 'items', 'test');

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        'test',
        { license: null, branchId: null, userId: null }
      );
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('returns the repository result directly on success', async () => {
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      const result = await baseService.getAutoSuggestions('name', 'items', 'alpha', makeUser());

      expect(result).toBe(MOCK_RESULT);
    });

    test('calls repository with field, collectionName, query in correct order', async () => {
      baseRepository.autoSuggestionTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getAutoSuggestions('phone', 'customers', 'john', makeUser());

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'phone',
        'customers',
        'john',
        expect.any(Object)
      );
    });

    test('handles empty string query correctly', async () => {
      baseRepository.autoSuggestionTableField.mockResolvedValue({ status: true, data: [] });

      const result = await baseService.getAutoSuggestions('name', 'items', '', makeUser());

      expect(baseRepository.autoSuggestionTableField).toHaveBeenCalledWith(
        'name',
        'items',
        '',
        expect.any(Object)
      );
      expect(result).toEqual({ status: true, data: [] });
    });

    // ── error handling ───────────────────────────────────────────────────────
    test('catches repository error and returns {status:false, data:[], message}', async () => {
      baseRepository.autoSuggestionTableField.mockRejectedValue(new Error('DB connection lost'));

      const result = await baseService.getAutoSuggestions('name', 'items', 'test', makeUser());

      expect(result).toEqual({ status: false, data: [], message: 'DB connection lost' });
    });

    test('does NOT re-throw on repository error', async () => {
      baseRepository.autoSuggestionTableField.mockRejectedValue(new Error('timeout'));

      await expect(
        baseService.getAutoSuggestions('name', 'items', 'test', makeUser())
      ).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getReportAutoSuggestions
  // ══════════════════════════════════════════════════════════════════════════
  describe('getReportAutoSuggestions', () => {
    // ── context building ────────────────────────────────────────────────────
    test('passes only license in context (no branchId or userId)', async () => {
      const user = makeUser({ license: 'lic_report' });
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getReportAutoSuggestions('john', 'name', 'customers', ['br_1'], user);

      expect(baseRepository.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'john',
        'name',
        'customers',
        ['br_1'],
        { license: 'lic_report' }
      );
    });

    test('falls back to license_id when license is not set', async () => {
      const user = { license_id: 'lic_fallback' };
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getReportAutoSuggestions('q', 'f', 'col', ['br'], user);

      expect(baseRepository.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'q',
        'f',
        'col',
        ['br'],
        { license: 'lic_fallback' }
      );
    });

    test('passes null license context when user is null', async () => {
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getReportAutoSuggestions('test', 'name', 'items', [], null);

      expect(baseRepository.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'test',
        'name',
        'items',
        [],
        { license: null }
      );
    });

    test('passes null license context when user is omitted', async () => {
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getReportAutoSuggestions('test', 'name', 'items', []);

      expect(baseRepository.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'test',
        'name',
        'items',
        [],
        { license: null }
      );
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('returns repository result on success', async () => {
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      const result = await baseService.getReportAutoSuggestions(
        'john',
        'name',
        'customers',
        ['branch_1'],
        makeUser()
      );

      expect(result).toBe(MOCK_RESULT);
    });

    test('forwards branchIds array to repository unchanged', async () => {
      const branchIds = ['br_1', 'br_2', 'br_3'];
      baseRepository.autoSuggestionReportTableField.mockResolvedValue(MOCK_RESULT);

      await baseService.getReportAutoSuggestions('q', 'f', 'col', branchIds, makeUser());

      expect(baseRepository.autoSuggestionReportTableField).toHaveBeenCalledWith(
        'q',
        'f',
        'col',
        branchIds,
        expect.any(Object)
      );
    });

    test('handles empty branchIds array', async () => {
      baseRepository.autoSuggestionReportTableField.mockResolvedValue({ status: true, data: [] });

      const result = await baseService.getReportAutoSuggestions('q', 'f', 'col', [], makeUser());

      expect(result).toEqual({ status: true, data: [] });
    });

    // ── error handling ───────────────────────────────────────────────────────
    test('catches repository error and returns {status:false, data:[], message}', async () => {
      baseRepository.autoSuggestionReportTableField.mockRejectedValue(
        new Error('Aggregation timeout')
      );

      const result = await baseService.getReportAutoSuggestions(
        'q',
        'name',
        'items',
        ['br'],
        makeUser()
      );

      expect(result).toEqual({ status: false, data: [], message: 'Aggregation timeout' });
    });

    test('does NOT re-throw on repository error', async () => {
      baseRepository.autoSuggestionReportTableField.mockRejectedValue(new Error('fail'));

      await expect(
        baseService.getReportAutoSuggestions('q', 'f', 'col', [], makeUser())
      ).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getDefaultSuggestions
  // ══════════════════════════════════════════════════════════════════════════
  describe('getDefaultSuggestions', () => {
    // ── context building ────────────────────────────────────────────────────
    test('passes license and branchId in context', async () => {
      const user = makeUser({ license: 'lic_def', branch_id: 'br_def' });
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('customers', 'john', user);

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith('customers', 'john', {
        license: 'lic_def',
        branchId: 'br_def',
      });
    });

    test('falls back to license_id and default_branch_id when primary fields absent', async () => {
      const user = { license_id: 'lic_fb', default_branch_id: 'br_fb' };
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('suppliers', 'acme', user);

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith('suppliers', 'acme', {
        license: 'lic_fb',
        branchId: 'br_fb',
      });
    });

    test('passes null context when user is null', async () => {
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('customers', 'test', null);

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith('customers', 'test', {
        license: null,
        branchId: null,
      });
    });

    test('passes null context when user is omitted', async () => {
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('customers', 'test');

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith('customers', 'test', {
        license: null,
        branchId: null,
      });
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('returns repository result on success', async () => {
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      const result = await baseService.getDefaultSuggestions('customers', 'john', makeUser());

      expect(result).toBe(MOCK_RESULT);
    });

    test('forwards module and query to repository in correct order', async () => {
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('suppliers', 'acme corp', makeUser());

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith(
        'suppliers',
        'acme corp',
        expect.any(Object)
      );
    });

    test('handles empty query string', async () => {
      baseRepository.getDefaultSuggestion.mockResolvedValue({ status: true, data: [] });

      const result = await baseService.getDefaultSuggestions('customers', '', makeUser());

      expect(result).toEqual({ status: true, data: [] });
    });

    test('handles query with spaces and special characters', async () => {
      const query = '  John & Sons (Pvt) Ltd.  ';
      baseRepository.getDefaultSuggestion.mockResolvedValue(MOCK_RESULT);

      await baseService.getDefaultSuggestions('customers', query, makeUser());

      expect(baseRepository.getDefaultSuggestion).toHaveBeenCalledWith(
        'customers',
        query,
        expect.any(Object)
      );
    });

    // ── error handling ───────────────────────────────────────────────────────
    test('catches repository error and returns {status:false, data:[], message}', async () => {
      baseRepository.getDefaultSuggestion.mockRejectedValue(new Error('Index not found'));

      const result = await baseService.getDefaultSuggestions('customers', 'john', makeUser());

      expect(result).toEqual({ status: false, data: [], message: 'Index not found' });
    });

    test('does NOT re-throw on repository error', async () => {
      baseRepository.getDefaultSuggestion.mockRejectedValue(new Error('crash'));

      await expect(
        baseService.getDefaultSuggestions('customers', 'q', makeUser())
      ).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Cross-method: error response shape contract
  // ══════════════════════════════════════════════════════════════════════════
  describe('error response shape', () => {
    test('getAutoSuggestions error response has status:false, data:[], message', async () => {
      baseRepository.autoSuggestionTableField.mockRejectedValue(new Error('err1'));
      const r = await baseService.getAutoSuggestions('f', 'col', 'q', makeUser());
      expect(r).toMatchObject({ status: false, data: [], message: 'err1' });
    });

    test('getReportAutoSuggestions error response has status:false, data:[], message', async () => {
      baseRepository.autoSuggestionReportTableField.mockRejectedValue(new Error('err2'));
      const r = await baseService.getReportAutoSuggestions('q', 'f', 'col', [], makeUser());
      expect(r).toMatchObject({ status: false, data: [], message: 'err2' });
    });

    test('getDefaultSuggestions error response has status:false, data:[], message', async () => {
      baseRepository.getDefaultSuggestion.mockRejectedValue(new Error('err3'));
      const r = await baseService.getDefaultSuggestions('mod', 'q', makeUser());
      expect(r).toMatchObject({ status: false, data: [], message: 'err3' });
    });

    test('collectionName-missing error response has status:false, data:[], message', async () => {
      const r = await baseService.getAutoSuggestions('f', null, 'q', makeUser());
      expect(r).toMatchObject({ status: false, data: [], message: 'Module is required' });
    });
  });
});
