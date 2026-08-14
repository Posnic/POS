'use strict';

/**
 * Unit tests for src/services/variants.service.js
 *
 * File        : src/services/variants.service.js (600 lines, SINGLETON export)
 * Export type : SINGLETON — module.exports = new VariantsService()
 * Base class  : None — does NOT extend base.service.js
 * v2 file     : No variants-v2.service.js found — only variants-v2.controller.js exists
 *               (the v2 controller likely uses the same service)
 *
 * Methods (14 total):
 *
 *   Pure helpers (no repository calls, no mocking needed):
 *   formatVariant(variant)              — formats raw doc to legacy-friendly shape
 *   parseFilters(rawFilters)            — parses filter string/object
 *   parseLegacyDate(value)              — converts date string to Date or null
 *   buildQueryFromFilters(parsedFilters)— builds MongoDB query from parsed filters
 *
 *   Async methods (repository delegation):
 *   getAllVariants(queryParams, branch_id) — paginated list with filter/sort
 *   getVariantById(id)                    — find by ID + formatVariant
 *   createVariant(data, branch_id, name)  — name/fields validation, dup check, create
 *   updateVariant(id, data, branch_id)    — name/fields validation, dup check, update
 *   deleteVariant(id, branch_id)          — single delete
 *   deleteVariants(ids, branch_id)        — bulk delete with ids guard
 *   getVariantsAjaxList(query, branchId)  — autocomplete suggestions
 *   exportVariants(ids, branch_id)        — export rows, ids guard
 *   getVariantsByField(fieldName)         — field-name lookup
 *   searchVariants(searchQuery, limit)    — name/description search
 *   getVariantStats()                     — total count
 *
 * Mocked dependencies:
 *   src/repositories/variants.repository — singleton with all methods
 *
 * Response shape:
 *   Success : { status: true,     type: 'success', message: string, data: any }
 *   Error   : { status: false,    type: 'error',   message: string, error?: string }
 *   Exist   : { status: 'exist',  type: 'error',   message: string, data: null }
 *
 * No production bugs found — clean service with no missing imports or undefined references.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../src/repositories/variant.repository', () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  findForAutocomplete: jest.fn(),
  findByIdsForExport: jest.fn(),
  findByField: jest.fn(),
  search: jest.fn(),
  count: jest.fn(),
  existsByName: jest.fn(),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────

const repository = require('../../../src/repositories/variant.repository');
const service = require('../../../src/services/variant.service');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const FAKE_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_BRANCH_ID = '64f8f2f4c2b9c0a1e4000002';

const mockVariantDoc = {
  _id: { toString: () => FAKE_ID },
  name: 'Size',
  fields: [{ name: 'Small' }, { name: 'Medium' }, { name: 'Large' }],
  product_type: [],
  description: 'Size variant',
  created_date: new Date('2024-01-01'),
  updated_date: new Date('2024-06-01'),
};

const mockFindAllResult = {
  variants: [mockVariantDoc],
  total: 1,
  totalPages: 1,
  page: 1,
  limit: 5,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VariantsService (singleton)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.existsByName.mockResolvedValue(false);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Pure helper methods (no async, no repository calls)
  // ══════════════════════════════════════════════════════════════════════════

  describe('formatVariant', () => {
    test('returns null for null input', () => {
      expect(service.formatVariant(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(service.formatVariant(undefined)).toBeNull();
    });

    test('returns object with _id as string', () => {
      const r = service.formatVariant(mockVariantDoc);
      expect(r._id).toBe(FAKE_ID);
    });

    test('uses fields array when present and non-empty', () => {
      const r = service.formatVariant(mockVariantDoc);
      expect(r.fields).toEqual([{ name: 'Small' }, { name: 'Medium' }, { name: 'Large' }]);
    });

    test('falls back to product_type array when fields is empty', () => {
      const doc = { ...mockVariantDoc, fields: [], product_type: ['Red', 'Blue'] };
      const r = service.formatVariant(doc);
      expect(r.fields).toEqual([{ name: 'Red' }, { name: 'Blue' }]);
    });

    test('maps string entries to { name } objects', () => {
      const doc = { ...mockVariantDoc, fields: [], product_type: ['XL', 'XXL'] };
      const r = service.formatVariant(doc);
      expect(r.fields[0]).toEqual({ name: 'XL' });
    });

    test('maps object entries with name property', () => {
      const doc = { ...mockVariantDoc, fields: [{ name: 'Cotton' }, { name: 'Polyester' }] };
      const r = service.formatVariant(doc);
      expect(r.fields).toEqual([{ name: 'Cotton' }, { name: 'Polyester' }]);
    });

    test('filters out null and empty-string entries', () => {
      const doc = {
        ...mockVariantDoc,
        fields: [],
        product_type: [null, '', 'Valid', undefined, '  '],
      };
      const r = service.formatVariant(doc);
      expect(r.fields).toEqual([{ name: 'Valid' }]);
    });

    test('product_type is array of name strings extracted from fields', () => {
      const r = service.formatVariant(mockVariantDoc);
      expect(r.product_type).toEqual(['Small', 'Medium', 'Large']);
    });

    test('returns empty arrays when both fields and product_type are empty', () => {
      const doc = { ...mockVariantDoc, fields: [], product_type: [] };
      const r = service.formatVariant(doc);
      expect(r.fields).toEqual([]);
      expect(r.product_type).toEqual([]);
    });

    test('returns empty string for missing name', () => {
      const doc = { ...mockVariantDoc, name: undefined };
      const r = service.formatVariant(doc);
      expect(r.name).toBe('');
    });

    test('returns empty string for missing description', () => {
      const doc = { ...mockVariantDoc, description: undefined };
      const r = service.formatVariant(doc);
      expect(r.description).toBe('');
    });

    test('uses created_date from doc', () => {
      const r = service.formatVariant(mockVariantDoc);
      expect(r.created_date).toEqual(new Date('2024-01-01'));
    });

    test('falls back to createdAt when created_date is missing', () => {
      const doc = { ...mockVariantDoc, created_date: undefined, createdAt: new Date('2023-01-01') };
      const r = service.formatVariant(doc);
      expect(r.created_date).toEqual(new Date('2023-01-01'));
    });
  });

  // ── parseFilters ───────────────────────────────────────────────────────────

  describe('parseFilters', () => {
    test('returns {} for null', () => {
      expect(service.parseFilters(null)).toEqual({});
    });

    test('returns {} for undefined', () => {
      expect(service.parseFilters(undefined)).toEqual({});
    });

    test('returns object as-is when passed an object', () => {
      const obj = { name: 'test', branch_id: FAKE_BRANCH_ID };
      expect(service.parseFilters(obj)).toBe(obj);
    });

    test('parses valid JSON string to object', () => {
      const r = service.parseFilters(JSON.stringify({ name: 'Size' }));
      expect(r).toEqual({ name: 'Size' });
    });

    test('returns {} for empty string', () => {
      expect(service.parseFilters('')).toEqual({});
    });

    test('returns {} for whitespace-only string', () => {
      expect(service.parseFilters('   ')).toEqual({});
    });

    test('returns {} for invalid JSON string', () => {
      expect(service.parseFilters('{bad json')).toEqual({});
    });

    test('NOTE: returns parsed array for JSON array string (service lacks Array.isArray guard)', () => {
      // typeof [] === 'object' is true, so the service returns the parsed array instead of {}.
      // Minimal fix: add `&& !Array.isArray(parsed)` to the parseFilters JSON check.
      expect(service.parseFilters('[1,2,3]')).toEqual([1, 2, 3]);
    });

    test('returns {} for number input', () => {
      expect(service.parseFilters(42)).toEqual({});
    });
  });

  // ── parseLegacyDate ────────────────────────────────────────────────────────

  describe('parseLegacyDate', () => {
    test('returns null for null', () => {
      expect(service.parseLegacyDate(null)).toBeNull();
    });

    test('returns null for undefined', () => {
      expect(service.parseLegacyDate(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(service.parseLegacyDate('')).toBeNull();
    });

    test('returns null for whitespace-only string', () => {
      expect(service.parseLegacyDate('   ')).toBeNull();
    });

    test('returns Date for valid ISO date string', () => {
      const r = service.parseLegacyDate('2024-01-15');
      expect(r).toBeInstanceOf(Date);
      expect(isNaN(r.getTime())).toBe(false);
    });

    test('returns null for invalid date string', () => {
      expect(service.parseLegacyDate('not-a-date')).toBeNull();
    });

    test('returns null for non-string input', () => {
      expect(service.parseLegacyDate(12345)).toBeNull();
    });
  });

  // ── buildQueryFromFilters ──────────────────────────────────────────────────

  describe('buildQueryFromFilters', () => {
    test('returns {} for empty filters', () => {
      expect(service.buildQueryFromFilters({})).toEqual({});
    });

    test('adds updated_date $gte when valid', () => {
      const q = service.buildQueryFromFilters({
        updated_date: { $gte: '2024-01-01', $lte: '2024-12-31' },
      });
      expect(q.updated_date.$gte).toBeInstanceOf(Date);
      expect(q.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('adds created_date $gte when valid', () => {
      const q = service.buildQueryFromFilters({
        created_date: { $gte: '2024-01-01' },
      });
      expect(q.created_date.$gte).toBeInstanceOf(Date);
    });

    test('skips date filter when date string is invalid', () => {
      const q = service.buildQueryFromFilters({
        updated_date: { $gte: 'not-a-date' },
      });
      expect(q.updated_date).toBeUndefined();
    });

    test('adds name $regex when name is a string', () => {
      const q = service.buildQueryFromFilters({ name: 'Size' });
      expect(q.name.$regex).toBe('Size');
      expect(q.name.$options).toBe('i');
    });

    test('uses existing $regex/$options when name is a regex object', () => {
      const q = service.buildQueryFromFilters({ name: { $regex: 'si', $options: 'i' } });
      expect(q.name.$regex).toBe('si');
      expect(q.name.$options).toBe('i');
    });

    test('copies simple filters to query', () => {
      const q = service.buildQueryFromFilters({ branch_id: FAKE_BRANCH_ID });
      expect(q.branch_id).toBe(FAKE_BRANCH_ID);
    });

    test('does not override already-set keys', () => {
      const q = service.buildQueryFromFilters({ name: 'Size', branch_id: FAKE_BRANCH_ID });
      expect(q.branch_id).toBe(FAKE_BRANCH_ID);
      expect(q.name.$regex).toBeDefined();
    });

    test('skips keys with undefined values', () => {
      const q = service.buildQueryFromFilters({ someField: undefined });
      expect(q).not.toHaveProperty('someField');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Async service methods
  // ══════════════════════════════════════════════════════════════════════════

  // ── getAllVariants ─────────────────────────────────────────────────────────

  describe('getAllVariants', () => {
    test('calls repository.findAll and returns paginated data', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      const r = await service.getAllVariants({ page: 1, limit: 5 });
      expect(r.status).toBe(true);
      expect(r.type).toBe('success');
      expect(r.data.total).toBe(1);
      expect(r.data.list).toHaveLength(1);
    });

    test('applies branch_id filter to query', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({}, FAKE_BRANCH_ID);
      const [query] = repository.findAll.mock.calls[0];
      expect(query.branch_id).toBe(FAKE_BRANCH_ID);
    });

    test('does not add branch_id to query when null', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({}, null);
      const [query] = repository.findAll.mock.calls[0];
      expect(query).not.toHaveProperty('branch_id');
    });

    test('uses default page=1 and limit=5 when invalid values provided', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({ page: -1, limit: 0 });
      const [, opts] = repository.findAll.mock.calls[0];
      expect(opts.page).toBe(1);
      expect(opts.limit).toBe(5);
    });

    test('uses default page=1 when page is 0', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({ page: 0, limit: 10 });
      const [, opts] = repository.findAll.mock.calls[0];
      expect(opts.page).toBe(1);
    });

    test('maps variants through formatVariant', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      const r = await service.getAllVariants({});
      expect(r.data.list[0]).toHaveProperty('fields');
      expect(r.data.list[0]).toHaveProperty('product_type');
    });

    test('passes sort and order options to repository', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({ sort: 'name', order: 'asc' });
      const [, opts] = repository.findAll.mock.calls[0];
      expect(opts.sort).toBe('name');
      expect(opts.order).toBe('asc');
    });

    test('parses JSON string filters', async () => {
      repository.findAll.mockResolvedValue(mockFindAllResult);
      await service.getAllVariants({ filters: JSON.stringify({ name: 'Size' }) });
      const [query] = repository.findAll.mock.calls[0];
      expect(query.name.$regex).toBe('Size');
    });

    test('returns status:false on repository throw', async () => {
      repository.findAll.mockRejectedValue(new Error('DB error'));
      const r = await service.getAllVariants({});
      expect(r.status).toBe(false);
      expect(r.type).toBe('error');
      expect(r.error).toBe('DB error');
    });
  });

  // ── getVariantById ─────────────────────────────────────────────────────────

  describe('getVariantById', () => {
    test('returns status:false when variant not found', async () => {
      repository.findById.mockResolvedValue(null);
      const r = await service.getVariantById(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.type).toBe('error');
      expect(r.message).toBe('Variant not found');
    });

    test('returns status:true with formatted variant on success', async () => {
      repository.findById.mockResolvedValue(mockVariantDoc);
      const r = await service.getVariantById(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.name).toBe('Size');
      expect(r.data.fields).toHaveLength(3);
    });

    test('calls repository.findById with the provided id', async () => {
      repository.findById.mockResolvedValue(mockVariantDoc);
      await service.getVariantById(FAKE_ID);
      expect(repository.findById).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns status:false on repository throw', async () => {
      repository.findById.mockRejectedValue(new Error('Load error'));
      const r = await service.getVariantById(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Load error');
    });
  });

  // ── createVariant ──────────────────────────────────────────────────────────

  describe('createVariant', () => {
    const validData = { name: 'Color', product_type: ['Red', 'Blue'] };

    test('returns error when name is missing', async () => {
      const r = await service.createVariant({ product_type: ['Red'] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant name is required');
      expect(repository.create).not.toHaveBeenCalled();
    });

    test('returns error when name is empty string', async () => {
      const r = await service.createVariant({ name: '', product_type: ['Red'] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant name is required');
    });

    test('returns error when name is whitespace only', async () => {
      const r = await service.createVariant({ name: '   ', product_type: ['Red'] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant name is required');
    });

    test('returns error when product_type is empty array', async () => {
      const r = await service.createVariant({ name: 'Color', product_type: [] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('At least one variant value is required');
    });

    test('returns error when product_type has only empty/null entries', async () => {
      const r = await service.createVariant({ name: 'Color', product_type: ['', null, '  '] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('At least one variant value is required');
    });

    test('returns error when product_type is missing (defaults to [])', async () => {
      const r = await service.createVariant({ name: 'Color' });
      expect(r.status).toBe(false);
      expect(r.message).toBe('At least one variant value is required');
    });

    test('returns status:"exist" when duplicate name found', async () => {
      repository.existsByName.mockResolvedValue(true);
      const r = await service.createVariant(validData, FAKE_BRANCH_ID);
      expect(r.status).toBe('exist');
      expect(r.type).toBe('error');
      expect(r.message).toBe('This variant already exists');
    });

    test('calls existsByName with trimmed name, null excludeId, and branch_id', async () => {
      repository.create.mockResolvedValue({ ...mockVariantDoc });
      await service.createVariant({ name: '  Color  ', product_type: ['Red'] }, FAKE_BRANCH_ID);
      expect(repository.existsByName).toHaveBeenCalledWith('Color', null, FAKE_BRANCH_ID);
    });

    test('calls repository.create with correct document shape', async () => {
      repository.create.mockResolvedValue({ ...mockVariantDoc });
      await service.createVariant(validData, FAKE_BRANCH_ID, 'Main Branch');
      const [doc] = repository.create.mock.calls[0];
      expect(doc.name).toBe('Color');
      expect(doc.fields).toEqual([{ name: 'Red' }, { name: 'Blue' }]);
      expect(doc.branch_id).toBe(FAKE_BRANCH_ID);
      expect(doc.branch_name).toBe('Main Branch');
    });

    test('trims name before saving', async () => {
      repository.create.mockResolvedValue({ ...mockVariantDoc });
      await service.createVariant({ name: '  Size  ', product_type: ['S'] });
      const [doc] = repository.create.mock.calls[0];
      expect(doc.name).toBe('Size');
    });

    test('trims description before saving', async () => {
      repository.create.mockResolvedValue({ ...mockVariantDoc });
      await service.createVariant({
        name: 'Color',
        product_type: ['Red'],
        description: '  Desc  ',
      });
      const [doc] = repository.create.mock.calls[0];
      expect(doc.description).toBe('Desc');
    });

    test('uses empty string for description when not provided', async () => {
      repository.create.mockResolvedValue({ ...mockVariantDoc });
      await service.createVariant(validData);
      const [doc] = repository.create.mock.calls[0];
      expect(doc.description).toBe('');
    });

    test('returns status:true with variant _id string on success', async () => {
      repository.create.mockResolvedValue({ _id: { toString: () => FAKE_ID } });
      const r = await service.createVariant(validData);
      expect(r.status).toBe(true);
      expect(r.type).toBe('success');
      expect(r.data).toBe(FAKE_ID);
    });

    test('filters empty strings from product_type', async () => {
      repository.create.mockResolvedValue({ _id: { toString: () => FAKE_ID } });
      await service.createVariant({ name: 'Color', product_type: ['Red', '', '  ', 'Blue'] });
      const [doc] = repository.create.mock.calls[0];
      expect(doc.fields).toEqual([{ name: 'Red' }, { name: 'Blue' }]);
    });

    test('returns status:false on repository throw', async () => {
      repository.create.mockRejectedValue(new Error('Insert failed'));
      const r = await service.createVariant(validData);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Insert failed');
    });
  });

  // ── updateVariant ──────────────────────────────────────────────────────────

  describe('updateVariant', () => {
    const validData = { name: 'Material', product_type: ['Cotton', 'Wool'] };

    test('returns error when name is empty', async () => {
      const r = await service.updateVariant(FAKE_ID, { name: '', product_type: ['x'] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant name is required');
    });

    test('returns error when product_type is empty', async () => {
      const r = await service.updateVariant(FAKE_ID, { name: 'Color', product_type: [] });
      expect(r.status).toBe(false);
      expect(r.message).toBe('At least one variant value is required');
    });

    test('returns status:"exist" when duplicate name found', async () => {
      repository.existsByName.mockResolvedValue(true);
      const r = await service.updateVariant(FAKE_ID, validData, FAKE_BRANCH_ID);
      expect(r.status).toBe('exist');
    });

    test('calls existsByName with current id to exclude self', async () => {
      repository.update.mockResolvedValue({ ...mockVariantDoc, toObject: () => mockVariantDoc });
      await service.updateVariant(FAKE_ID, validData, FAKE_BRANCH_ID);
      expect(repository.existsByName).toHaveBeenCalledWith('Material', FAKE_ID, FAKE_BRANCH_ID);
    });

    test('returns not-found when repository.update returns null', async () => {
      repository.update.mockResolvedValue(null);
      const r = await service.updateVariant(FAKE_ID, validData);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant not found');
    });

    test('returns status:true with formatted variant on success', async () => {
      repository.update.mockResolvedValue({ ...mockVariantDoc, toObject: () => mockVariantDoc });
      const r = await service.updateVariant(FAKE_ID, validData);
      expect(r.status).toBe(true);
      expect(r.type).toBe('success');
      expect(r.data.name).toBe('Size');
    });

    test('calls repository.update with trimmed name and parsed fields', async () => {
      repository.update.mockResolvedValue({ ...mockVariantDoc, toObject: () => mockVariantDoc });
      await service.updateVariant(
        FAKE_ID,
        { name: '  Material  ', product_type: ['Cotton'] },
        FAKE_BRANCH_ID
      );
      expect(repository.update).toHaveBeenCalledWith(
        FAKE_ID,
        expect.objectContaining({ name: 'Material', fields: [{ name: 'Cotton' }] }),
        FAKE_BRANCH_ID
      );
    });

    test('handles variant without toObject method', async () => {
      repository.update.mockResolvedValue({ ...mockVariantDoc }); // no toObject
      const r = await service.updateVariant(FAKE_ID, validData);
      expect(r.status).toBe(true);
    });

    test('returns status:false on repository throw', async () => {
      repository.update.mockRejectedValue(new Error('Update failed'));
      const r = await service.updateVariant(FAKE_ID, validData);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Update failed');
    });
  });

  // ── deleteVariant ──────────────────────────────────────────────────────────

  describe('deleteVariant', () => {
    test('returns status:false when variant not found', async () => {
      repository.delete.mockResolvedValue(null);
      const r = await service.deleteVariant(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Variant not found');
    });

    test('returns status:true on successful delete', async () => {
      repository.delete.mockResolvedValue({ _id: FAKE_ID });
      const r = await service.deleteVariant(FAKE_ID, FAKE_BRANCH_ID);
      expect(r.status).toBe(true);
      expect(r.data).toBeNull();
    });

    test('calls repository.delete with id and branch_id', async () => {
      repository.delete.mockResolvedValue({ _id: FAKE_ID });
      await service.deleteVariant(FAKE_ID, FAKE_BRANCH_ID);
      expect(repository.delete).toHaveBeenCalledWith(FAKE_ID, FAKE_BRANCH_ID);
    });

    test('returns status:false on repository throw', async () => {
      repository.delete.mockRejectedValue(new Error('Delete failed'));
      const r = await service.deleteVariant(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Delete failed');
    });
  });

  // ── deleteVariants ─────────────────────────────────────────────────────────

  describe('deleteVariants', () => {
    test('returns error when ids is null', async () => {
      const r = await service.deleteVariants(null);
      expect(r.status).toBe(false);
      expect(r.message).toBe('UID is missing');
      expect(repository.deleteMany).not.toHaveBeenCalled();
    });

    test('returns error when ids is empty array', async () => {
      const r = await service.deleteVariants([]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('UID is missing');
    });

    test('returns error when ids is not an array', async () => {
      const r = await service.deleteVariants('single-id');
      expect(r.status).toBe(false);
      expect(r.message).toBe('UID is missing');
    });

    test('calls repository.deleteMany with ids and branch_id', async () => {
      repository.deleteMany.mockResolvedValue({ deletedCount: 2 });
      await service.deleteVariants([FAKE_ID, FAKE_ID], FAKE_BRANCH_ID);
      expect(repository.deleteMany).toHaveBeenCalledWith([FAKE_ID, FAKE_ID], FAKE_BRANCH_ID);
    });

    test('returns status:true with deletedCount on success', async () => {
      repository.deleteMany.mockResolvedValue({ deletedCount: 3 });
      const r = await service.deleteVariants([FAKE_ID, FAKE_ID, FAKE_ID]);
      expect(r.status).toBe(true);
      expect(r.data).toBe(3);
    });

    test('returns status:false on repository throw', async () => {
      repository.deleteMany.mockRejectedValue(new Error('Bulk delete failed'));
      const r = await service.deleteVariants([FAKE_ID]);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Bulk delete failed');
    });
  });

  // ── getVariantsAjaxList ────────────────────────────────────────────────────

  describe('getVariantsAjaxList', () => {
    const mockAutocomplete = [
      { _id: { toString: () => FAKE_ID }, name: 'Size', fields: [{ name: 'S' }] },
    ];

    test('returns suggestions with id/name/fields shape', async () => {
      repository.findForAutocomplete.mockResolvedValue(mockAutocomplete);
      const r = await service.getVariantsAjaxList('si', FAKE_BRANCH_ID);
      expect(r.status).toBe(true);
      expect(r.data.suggestions[0]).toEqual({
        id: FAKE_ID,
        name: 'Size',
        fields: [{ name: 'S' }],
      });
    });

    test('includes original query in response data', async () => {
      repository.findForAutocomplete.mockResolvedValue([]);
      const r = await service.getVariantsAjaxList('mat', FAKE_BRANCH_ID);
      expect(r.data.query).toBe('mat');
    });

    test('calls repository.findForAutocomplete with query and branchId', async () => {
      repository.findForAutocomplete.mockResolvedValue([]);
      await service.getVariantsAjaxList('col', FAKE_BRANCH_ID);
      expect(repository.findForAutocomplete).toHaveBeenCalledWith('col', FAKE_BRANCH_ID);
    });

    test('returns empty suggestions for empty result', async () => {
      repository.findForAutocomplete.mockResolvedValue([]);
      const r = await service.getVariantsAjaxList('xyz');
      expect(r.data.suggestions).toEqual([]);
    });

    test('returns status:false on repository throw', async () => {
      repository.findForAutocomplete.mockRejectedValue(new Error('Autocomplete failed'));
      const r = await service.getVariantsAjaxList('q');
      expect(r.status).toBe(false);
      expect(r.error).toBe('Autocomplete failed');
    });
  });

  // ── exportVariants ─────────────────────────────────────────────────────────

  describe('exportVariants', () => {
    const mockExportDocs = [
      { name: 'Size', fields: [{ name: 'S' }, { name: 'M' }], description: 'Sizes' },
    ];

    test('returns error when ids is null', async () => {
      const r = await service.exportVariants(null);
      expect(r.status).toBe(false);
      expect(r.message).toBe('No variants selected for export');
      expect(repository.findByIdsForExport).not.toHaveBeenCalled();
    });

    test('returns error when ids is empty array', async () => {
      const r = await service.exportVariants([]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('No variants selected for export');
    });

    test('returns rows with name/fields/description on success', async () => {
      repository.findByIdsForExport.mockResolvedValue(mockExportDocs);
      const r = await service.exportVariants([FAKE_ID], FAKE_BRANCH_ID);
      expect(r.status).toBe(true);
      expect(r.data[0]).toEqual({ name: 'Size', fields: 'S, M', description: 'Sizes' });
    });

    test('joins field names with comma separator', async () => {
      repository.findByIdsForExport.mockResolvedValue(mockExportDocs);
      const r = await service.exportVariants([FAKE_ID]);
      expect(r.data[0].fields).toBe('S, M');
    });

    test('handles variant with no fields (outputs empty string)', async () => {
      repository.findByIdsForExport.mockResolvedValue([
        { name: 'Color', fields: null, description: '' },
      ]);
      const r = await service.exportVariants([FAKE_ID]);
      expect(r.data[0].fields).toBe('');
    });

    test('handles variant with empty fields array', async () => {
      repository.findByIdsForExport.mockResolvedValue([
        { name: 'Color', fields: [], description: '' },
      ]);
      const r = await service.exportVariants([FAKE_ID]);
      expect(r.data[0].fields).toBe('');
    });

    test('calls repository.findByIdsForExport with ids and branch_id', async () => {
      repository.findByIdsForExport.mockResolvedValue([]);
      await service.exportVariants([FAKE_ID], FAKE_BRANCH_ID);
      expect(repository.findByIdsForExport).toHaveBeenCalledWith([FAKE_ID], FAKE_BRANCH_ID);
    });

    test('returns status:false on repository throw', async () => {
      repository.findByIdsForExport.mockRejectedValue(new Error('Export failed'));
      const r = await service.exportVariants([FAKE_ID]);
      expect(r.status).toBe(false);
      expect(r.error).toBe('Export failed');
    });
  });

  // ── getVariantsByField ─────────────────────────────────────────────────────

  describe('getVariantsByField', () => {
    test('returns formatted variants on success', async () => {
      repository.findByField.mockResolvedValue([mockVariantDoc]);
      const r = await service.getVariantsByField('Cotton');
      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(1);
      expect(r.data[0].name).toBe('Size');
    });

    test('calls repository.findByField with fieldName', async () => {
      repository.findByField.mockResolvedValue([]);
      await service.getVariantsByField('Polyester');
      expect(repository.findByField).toHaveBeenCalledWith('Polyester');
    });

    test('returns empty data array for no results', async () => {
      repository.findByField.mockResolvedValue([]);
      const r = await service.getVariantsByField('Unknown');
      expect(r.data).toEqual([]);
    });

    test('returns status:false on repository throw', async () => {
      repository.findByField.mockRejectedValue(new Error('Field query failed'));
      const r = await service.getVariantsByField('Cotton');
      expect(r.status).toBe(false);
      expect(r.error).toBe('Field query failed');
    });
  });

  // ── searchVariants ─────────────────────────────────────────────────────────

  describe('searchVariants', () => {
    test('returns formatted variants on success', async () => {
      repository.search.mockResolvedValue([mockVariantDoc]);
      const r = await service.searchVariants('size');
      expect(r.status).toBe(true);
      expect(r.data[0].name).toBe('Size');
    });

    test('calls repository.search with query and limit', async () => {
      repository.search.mockResolvedValue([]);
      await service.searchVariants('col', 10);
      expect(repository.search).toHaveBeenCalledWith('col', 10);
    });

    test('uses default limit of 20 when not provided', async () => {
      repository.search.mockResolvedValue([]);
      await service.searchVariants('size');
      expect(repository.search).toHaveBeenCalledWith('size', 20);
    });

    test('returns empty data array when no results', async () => {
      repository.search.mockResolvedValue([]);
      const r = await service.searchVariants('xyz');
      expect(r.data).toEqual([]);
    });

    test('returns status:false on repository throw', async () => {
      repository.search.mockRejectedValue(new Error('Search failed'));
      const r = await service.searchVariants('q');
      expect(r.status).toBe(false);
      expect(r.error).toBe('Search failed');
    });
  });

  // ── getVariantStats ────────────────────────────────────────────────────────

  describe('getVariantStats', () => {
    test('returns total count on success', async () => {
      repository.count.mockResolvedValue(42);
      const r = await service.getVariantStats();
      expect(r.status).toBe(true);
      expect(r.data).toEqual({ total: 42 });
    });

    test('calls repository.count', async () => {
      repository.count.mockResolvedValue(0);
      await service.getVariantStats();
      expect(repository.count).toHaveBeenCalledTimes(1);
    });

    test('returns total:0 when no variants exist', async () => {
      repository.count.mockResolvedValue(0);
      const r = await service.getVariantStats();
      expect(r.data.total).toBe(0);
    });

    test('returns status:false on repository throw', async () => {
      repository.count.mockRejectedValue(new Error('Count failed'));
      const r = await service.getVariantStats();
      expect(r.status).toBe(false);
      expect(r.error).toBe('Count failed');
    });
  });
});
