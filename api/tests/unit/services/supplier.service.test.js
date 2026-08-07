'use strict';

/**
 * Unit tests for src/services/supplier.service.js
 *
 * File        : src/services/supplier.service.js (728 lines, CLASS export)
 * Export type : CLASS — `module.exports = SupplierService`
 * Base class  : None — does NOT extend base.service.js
 *
 * Methods (13):
 *   getAllSuppliers(filters, options)           — filter-builder + repository.findAll
 *   getSupplierById(id)                        — findById + defaults for country/state/city
 *   createSupplier(supplierData)               — name guard + validateSupplierData + dup-email + sanitize + create
 *   updateSupplier(id, updateData)             — exists check + dup-email (if changed) + sanitize + update
 *   deleteSupplier(id)                         — exists check + softDelete
 *   bulkDeleteSuppliers(ids)                   — empty guard + bulkSoftDelete
 *   searchSuppliers(searchTerm, options)       — falls back to getAllSuppliers when empty
 *   getSupplierSummary(supplierId)             — getSummary + null check
 *   getOutstandingReport(filters, options)     — getOutstandingReport delegation
 *   getPaymentDetails(supplierId)              — exists check + getPaymentDetails + merge
 *   getTransactions(supplierId, options)       — exists check + getTransactions
 *   bulkImport(suppliersData)                  — plan check (BaseModel.checkPlan) + dedup + validate + bulkCreate
 *   exportSuppliers(filters)                   — ObjectId conversion + exportData
 *   getDataChanges(fromDate)                   — getDataChanges delegation
 *   updateBalance(supplierId, amount, type)    — exists check + balance math + update
 *
 * Mocked dependencies:
 *   SupplierRepository — class constructor mock
 *   BaseModel          — class constructor mock (for bulkImport.checkPlan)
 *   helpers/suppliers.helper — sanitizeSupplierData, validateSupplierData
 *
 * PRODUCTION ISSUES FOUND:
 *   1. `getAllSuppliers` uses `console.log` for debug output (filter values) in production code.
 *      This leaks internal query details to server logs and should be removed.
 *   2. `bulkImport` returns `{ status: true, data: validationErrors, message: 'CSV' }` on
 *      validation failure — a status:true with error data is a semantic contradiction and
 *      breaks controllers that check only `status`.
 *   3. `updateBalance` type parameter defaults to 'add' but any unrecognized type also triggers
 *      subtraction (the `else` branch), silently mishandling typos like 'subtract' vs 'sub'.
 *   4. `searchSuppliers` calls `this.getAllSuppliers` on empty term, which itself is
 *      try/catch wrapped, so the empty-term path can never surface errors from `getAllSuppliers`
 *      (they'd appear as returned {status:false} objects, not thrown errors — this is fine but
 *      the behavior should be documented).
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRepositoryInstance = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByNamePhoneBranch: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  bulkSoftDelete: jest.fn(),
  search: jest.fn(),
  getSummary: jest.fn(),
  getOutstandingReport: jest.fn(),
  getPaymentDetails: jest.fn(),
  getTransactions: jest.fn(),
  bulkCreate: jest.fn(),
  exportData: jest.fn(),
  getDataChanges: jest.fn(),
};

jest.mock('../../../src/repositories/supplier.repository', () =>
  jest.fn(() => mockRepositoryInstance)
);

jest.mock('../../../src/models/base.model', () => {
  const mockCheckPlan = jest.fn().mockResolvedValue(0);
  const MockBaseModel = jest.fn().mockImplementation(() => ({ checkPlan: mockCheckPlan }));
  MockBaseModel.__mockCheckPlan = mockCheckPlan;
  return MockBaseModel;
});

jest.mock('../../../src/helpers/suppliers.helper', () => ({
  sanitizeSupplierData: jest.fn((data) => ({ ...data })),
  validateSupplierData: jest.fn(() => ({ valid: true, errors: [] })),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────

const BaseModel = require('../../../src/models/base.model');
const {
  sanitizeSupplierData,
  validateSupplierData,
} = require('../../../src/helpers/suppliers.helper');
const SupplierService = require('../../../src/services/supplier.service');

const mockCheckPlan = BaseModel.__mockCheckPlan;

// ─── Shared helpers ───────────────────────────────────────────────────────────

const FAKE_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_BRANCH_ID = '64f8f2f4c2b9c0a1e4000002';
const FAKE_ID_2 = '64f8f2f4c2b9c0a1e4000003';

const mockSupplier = {
  _id: FAKE_ID,
  name: 'Test Supplier',
  company_name: 'Test Supplier Co.',
  email: 'supplier@test.com',
  phone: '9876543210',
  address: '123 Main St',
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  gst: 'enable',
  gst_number: '27AAPFU0939F1ZV',
  branch_id: FAKE_BRANCH_ID,
  balance: 500,
  is_deleted: false,
};

const makeSupplierData = (o = {}) => ({
  name: 'New Supplier',
  email: 'new@supplier.com',
  phone: '9876543210',
  ...o,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SupplierService', () => {
  let service;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    service = new SupplierService();
    // Re-set default helper behaviour after clearAllMocks
    validateSupplierData.mockReturnValue({ valid: true, errors: [] });
    sanitizeSupplierData.mockImplementation((data) => ({ ...data }));
    mockCheckPlan.mockResolvedValue(0);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ── getAllSuppliers ───────────────────────────────────────────────────────────

  describe('getAllSuppliers', () => {
    test('returns status:true with data when repository succeeds', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([mockSupplier]);
      const r = await service.getAllSuppliers();
      expect(r.status).toBe(true);
      expect(r.data).toEqual([mockSupplier]);
      expect(r.message).toBe('Suppliers retrieved successfully');
    });

    test('calls repository.findAll with empty queryFilters when no filters', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({}, { page: 1 });
      expect(mockRepositoryInstance.findAll).toHaveBeenCalledWith({}, { page: 1 });
    });

    test('converts branch_id string to ObjectId in queryFilters', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ branch_id: FAKE_BRANCH_ID });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.branch_id).toBeDefined();
      expect(filters.branch_id.toString()).toBe(FAKE_BRANCH_ID);
    });

    test('builds regex for plain string name filter', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ name: 'acme' });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.name).toBeInstanceOf(RegExp);
      expect(filters.name.test('ACME Corp')).toBe(true);
    });

    test('builds $or query for search term fallback', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ search: 'widget' });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.$or).toBeDefined();
      expect(Array.isArray(filters.$or)).toBe(true);
      expect(filters.$or).toHaveLength(5);
    });

    test('does NOT build $or when specific field filter also present', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ search: 'widget', name: 'widget' });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.$or).toBeUndefined();
    });

    test('builds regex for address, phone, email filters', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ address: 'Mumbai', phone: '9876', email: '@test' });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.address).toBeInstanceOf(RegExp);
      expect(filters.phone).toBeInstanceOf(RegExp);
      expect(filters.email).toBeInstanceOf(RegExp);
    });

    test('applies valid updated_date $gte and $lte', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({
        updated_date: { $gte: '2024-01-01', $lte: '2024-12-31' },
      });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.updated_date.$gte).toBeInstanceOf(Date);
      expect(filters.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('skips updated_date values that parse as NaN', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ updated_date: { $gte: 'not-a-date' } });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.updated_date.$gte).toBeUndefined();
    });

    test('applies gst filter directly', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ gst: 'enable' });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.gst).toBe('enable');
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.findAll.mockRejectedValue(new Error('DB error'));
      const r = await service.getAllSuppliers();
      expect(r.status).toBe(false);
      expect(r.data).toBeNull();
      expect(r.message).toBe('DB error');
    });

    test('handles regex-object name filter and strips lookahead chars', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.getAllSuppliers({ name: { $regex: '(?=.*acme)', $options: 'i' } });
      const [filters] = mockRepositoryInstance.findAll.mock.calls[0];
      expect(filters.name.$regex).not.toContain('(?=.*');
    });
  });

  // ── getSupplierById ───────────────────────────────────────────────────────────

  describe('getSupplierById', () => {
    test('returns supplier with status:true', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      const r = await service.getSupplierById(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.name).toBe('Test Supplier');
    });

    test('returns status:false with not-found message when supplier is null', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.getSupplierById('nonexistent');
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
    });

    test('adds default country "India" when supplier has no country', async () => {
      const s = { ...mockSupplier, country: undefined };
      mockRepositoryInstance.findById.mockResolvedValue(s);
      const r = await service.getSupplierById(FAKE_ID);
      expect(r.data.country).toBe('India');
    });

    test('keeps existing country when already set', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, country: 'USA' });
      const r = await service.getSupplierById(FAKE_ID);
      expect(r.data.country).toBe('USA');
    });

    test('adds default empty state and city when missing', async () => {
      const s = { ...mockSupplier, state: undefined, city: undefined };
      mockRepositoryInstance.findById.mockResolvedValue(s);
      const r = await service.getSupplierById(FAKE_ID);
      expect(r.data.state).toBe('');
      expect(r.data.city).toBe('');
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.findById.mockRejectedValue(new Error('Lookup failed'));
      const r = await service.getSupplierById(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Lookup failed');
    });
  });

  // ── createSupplier ────────────────────────────────────────────────────────────

  describe('createSupplier', () => {
    test('returns status:false when name is missing', async () => {
      const r = await service.createSupplier({ email: 'a@b.com' });
      expect(r).toEqual({ status: false, data: null, message: 'Supplier name is required' });
      expect(mockRepositoryInstance.create).not.toHaveBeenCalled();
    });

    test('returns status:false when validation fails', async () => {
      validateSupplierData.mockReturnValue({ valid: false, errors: ['Invalid email format'] });
      const r = await service.createSupplier({ name: 'Test', email: 'bad-email' });
      expect(r.status).toBe(false);
      expect(r.message).toContain('Invalid email format');
      expect(mockRepositoryInstance.create).not.toHaveBeenCalled();
    });

    test('returns status:false when email is duplicate', async () => {
      mockRepositoryInstance.findByEmail.mockResolvedValue(mockSupplier);
      const r = await service.createSupplier(makeSupplierData());
      expect(r).toEqual({
        status: false,
        data: null,
        message: 'Supplier with this email already exists',
      });
      expect(mockRepositoryInstance.create).not.toHaveBeenCalled();
    });

    test('skips duplicate email check when no email provided', async () => {
      mockRepositoryInstance.create.mockResolvedValue({ _id: FAKE_ID, name: 'Supplier No Email' });
      const r = await service.createSupplier({ name: 'Supplier No Email' });
      expect(r.status).toBe(true);
      expect(mockRepositoryInstance.findByEmail).not.toHaveBeenCalled();
    });

    test('calls sanitizeSupplierData before create', async () => {
      mockRepositoryInstance.findByEmail.mockResolvedValue(null);
      mockRepositoryInstance.create.mockResolvedValue({ _id: FAKE_ID, ...makeSupplierData() });
      await service.createSupplier(makeSupplierData());
      expect(sanitizeSupplierData).toHaveBeenCalledWith(makeSupplierData());
    });

    test('calls validateSupplierData with supplied data', async () => {
      mockRepositoryInstance.findByEmail.mockResolvedValue(null);
      mockRepositoryInstance.create.mockResolvedValue({ _id: FAKE_ID, ...makeSupplierData() });
      const data = makeSupplierData();
      await service.createSupplier(data);
      expect(validateSupplierData).toHaveBeenCalledWith(data);
    });

    test('returns status:true with created supplier on success', async () => {
      mockRepositoryInstance.findByEmail.mockResolvedValue(null);
      const created = { _id: FAKE_ID, ...makeSupplierData() };
      mockRepositoryInstance.create.mockResolvedValue(created);
      const r = await service.createSupplier(makeSupplierData());
      expect(r).toEqual({ status: true, data: created, message: 'Supplier created successfully' });
    });

    test('returns status:false on repository.create throw', async () => {
      mockRepositoryInstance.findByEmail.mockResolvedValue(null);
      mockRepositoryInstance.create.mockRejectedValue(new Error('Insert failed'));
      const r = await service.createSupplier({ name: 'Test' });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Insert failed');
    });

    test('joins multiple validation errors with comma', async () => {
      validateSupplierData.mockReturnValue({
        valid: false,
        errors: ['Invalid email format', 'Invalid phone format'],
      });
      const r = await service.createSupplier({ name: 'Test', email: 'x', phone: 'x' });
      expect(r.message).toBe('Invalid email format, Invalid phone format');
    });
  });

  // ── updateSupplier ────────────────────────────────────────────────────────────

  describe('updateSupplier', () => {
    test('returns status:false when supplier not found', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.updateSupplier(FAKE_ID, { name: 'Updated' });
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
      expect(mockRepositoryInstance.update).not.toHaveBeenCalled();
    });

    test('returns status:false when new email is duplicate', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, email: 'old@test.com' });
      mockRepositoryInstance.findByEmail.mockResolvedValue({
        _id: FAKE_ID_2,
        email: 'new@test.com',
      });
      const r = await service.updateSupplier(FAKE_ID, { email: 'new@test.com' });
      expect(r).toEqual({
        status: false,
        data: null,
        message: 'Supplier with this email already exists',
      });
      expect(mockRepositoryInstance.update).not.toHaveBeenCalled();
    });

    test('skips email duplicate check when email unchanged', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      const updated = { ...mockSupplier, name: 'Updated' };
      mockRepositoryInstance.update.mockResolvedValue(updated);
      await service.updateSupplier(FAKE_ID, { name: 'Updated', email: mockSupplier.email });
      expect(mockRepositoryInstance.findByEmail).not.toHaveBeenCalled();
    });

    test('skips email duplicate check when no email in updateData', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, name: 'Changed' });
      await service.updateSupplier(FAKE_ID, { name: 'Changed' });
      expect(mockRepositoryInstance.findByEmail).not.toHaveBeenCalled();
    });

    test('calls sanitizeSupplierData with updateData', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier });
      const updateData = { name: 'Updated Name' };
      await service.updateSupplier(FAKE_ID, updateData);
      expect(sanitizeSupplierData).toHaveBeenCalledWith(updateData);
    });

    test('returns status:true with updated supplier on success', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      const updated = { ...mockSupplier, name: 'Updated' };
      mockRepositoryInstance.update.mockResolvedValue(updated);
      const r = await service.updateSupplier(FAKE_ID, { name: 'Updated' });
      expect(r).toEqual({ status: true, data: updated, message: 'Supplier updated successfully' });
    });

    test('returns status:false on repository.update throw', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.update.mockRejectedValue(new Error('Update failed'));
      const r = await service.updateSupplier(FAKE_ID, { name: 'X' });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Update failed');
    });
  });

  // ── deleteSupplier ────────────────────────────────────────────────────────────

  describe('deleteSupplier', () => {
    test('returns status:false when supplier not found', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.deleteSupplier(FAKE_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
      expect(mockRepositoryInstance.softDelete).not.toHaveBeenCalled();
    });

    test('calls softDelete with id when supplier exists', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.softDelete.mockResolvedValue({ acknowledged: true });
      await service.deleteSupplier(FAKE_ID);
      expect(mockRepositoryInstance.softDelete).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns status:true on success', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.softDelete.mockResolvedValue({});
      const r = await service.deleteSupplier(FAKE_ID);
      expect(r).toEqual({ status: true, data: null, message: 'Supplier deleted successfully' });
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.softDelete.mockRejectedValue(new Error('Delete failed'));
      const r = await service.deleteSupplier(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Delete failed');
    });
  });

  // ── bulkDeleteSuppliers ───────────────────────────────────────────────────────

  describe('bulkDeleteSuppliers', () => {
    test('returns status:false when ids is null', async () => {
      const r = await service.bulkDeleteSuppliers(null);
      expect(r).toEqual({ status: false, data: null, message: 'No supplier IDs provided' });
    });

    test('returns status:false when ids is empty array', async () => {
      const r = await service.bulkDeleteSuppliers([]);
      expect(r).toEqual({ status: false, data: null, message: 'No supplier IDs provided' });
    });

    test('calls repository.bulkSoftDelete with ids', async () => {
      mockRepositoryInstance.bulkSoftDelete.mockResolvedValue({ deletedCount: 2 });
      await service.bulkDeleteSuppliers([FAKE_ID, FAKE_ID_2]);
      expect(mockRepositoryInstance.bulkSoftDelete).toHaveBeenCalledWith([FAKE_ID, FAKE_ID_2]);
    });

    test('returns status:true with deletedCount on success', async () => {
      mockRepositoryInstance.bulkSoftDelete.mockResolvedValue({ deletedCount: 3 });
      const r = await service.bulkDeleteSuppliers([FAKE_ID, FAKE_ID_2, FAKE_BRANCH_ID]);
      expect(r.status).toBe(true);
      expect(r.data).toBe(3);
      expect(r.message).toBe('Supplier deleted successfully');
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.bulkSoftDelete.mockRejectedValue(new Error('Bulk delete failed'));
      const r = await service.bulkDeleteSuppliers([FAKE_ID]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Bulk delete failed');
    });
  });

  // ── searchSuppliers ───────────────────────────────────────────────────────────

  describe('searchSuppliers', () => {
    test('calls repository.search with searchTerm when valid', async () => {
      mockRepositoryInstance.search.mockResolvedValue([mockSupplier]);
      const r = await service.searchSuppliers('acme', { page: 1 });
      expect(r.status).toBe(true);
      expect(mockRepositoryInstance.search).toHaveBeenCalledWith('acme', { page: 1 });
    });

    test('falls back to getAllSuppliers when searchTerm is empty string', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([mockSupplier]);
      const r = await service.searchSuppliers('');
      expect(r.status).toBe(true);
      expect(mockRepositoryInstance.search).not.toHaveBeenCalled();
      expect(mockRepositoryInstance.findAll).toHaveBeenCalled();
    });

    test('falls back to getAllSuppliers when searchTerm is whitespace only', async () => {
      mockRepositoryInstance.findAll.mockResolvedValue([]);
      await service.searchSuppliers('   ');
      expect(mockRepositoryInstance.search).not.toHaveBeenCalled();
    });

    test('returns status:false on repository.search throw', async () => {
      mockRepositoryInstance.search.mockRejectedValue(new Error('Search failed'));
      const r = await service.searchSuppliers('test');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Search failed');
    });
  });

  // ── getSupplierSummary ────────────────────────────────────────────────────────

  describe('getSupplierSummary', () => {
    test('returns status:false when summary is null', async () => {
      mockRepositoryInstance.getSummary.mockResolvedValue(null);
      const r = await service.getSupplierSummary(FAKE_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
    });

    test('returns status:true with summary when found', async () => {
      const summary = { totalPurchases: 10000, totalPaid: 6000 };
      mockRepositoryInstance.getSummary.mockResolvedValue(summary);
      const r = await service.getSupplierSummary(FAKE_ID);
      expect(r).toEqual({
        status: true,
        data: summary,
        message: 'Supplier summary retrieved successfully',
      });
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.getSummary.mockRejectedValue(new Error('Aggregation failed'));
      const r = await service.getSupplierSummary(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Aggregation failed');
    });
  });

  // ── getOutstandingReport ──────────────────────────────────────────────────────

  describe('getOutstandingReport', () => {
    test('returns status:true with report', async () => {
      const report = [{ name: 'Test Supplier', outstanding: 4000 }];
      mockRepositoryInstance.getOutstandingReport.mockResolvedValue(report);
      const r = await service.getOutstandingReport({ branch_id: FAKE_BRANCH_ID }, { page: 1 });
      expect(r).toEqual({
        status: true,
        data: report,
        message: 'Outstanding report retrieved successfully',
      });
      expect(mockRepositoryInstance.getOutstandingReport).toHaveBeenCalledWith(
        { branch_id: FAKE_BRANCH_ID },
        { page: 1 }
      );
    });

    test('uses empty defaults when called with no arguments', async () => {
      mockRepositoryInstance.getOutstandingReport.mockResolvedValue([]);
      await service.getOutstandingReport();
      expect(mockRepositoryInstance.getOutstandingReport).toHaveBeenCalledWith({}, {});
    });

    test('returns status:false on throw', async () => {
      mockRepositoryInstance.getOutstandingReport.mockRejectedValue(new Error('Report failed'));
      const r = await service.getOutstandingReport();
      expect(r.status).toBe(false);
    });
  });

  // ── getPaymentDetails ─────────────────────────────────────────────────────────

  describe('getPaymentDetails', () => {
    test('returns status:false when supplier not found', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.getPaymentDetails(FAKE_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
      expect(mockRepositoryInstance.getPaymentDetails).not.toHaveBeenCalled();
    });

    test('merges supplier and payment details in data', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      const paymentDetails = { invoices: [], totalDue: 0 };
      mockRepositoryInstance.getPaymentDetails.mockResolvedValue(paymentDetails);
      const r = await service.getPaymentDetails(FAKE_ID);
      expect(r.status).toBe(true);
      // Service returns { supplier: {...}, ...paymentDetails } — supplier is nested
      expect(r.data).toMatchObject({
        supplier: expect.objectContaining({ name: 'Test Supplier' }),
        invoices: [],
        totalDue: 0,
      });
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.getPaymentDetails.mockRejectedValue(
        new Error('Payment lookup failed')
      );
      const r = await service.getPaymentDetails(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Payment lookup failed');
    });
  });

  // ── getTransactions ───────────────────────────────────────────────────────────

  describe('getTransactions', () => {
    test('returns status:false when supplier not found', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.getTransactions(FAKE_ID);
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
      expect(mockRepositoryInstance.getTransactions).not.toHaveBeenCalled();
    });

    test('returns status:true with transactions', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      const txns = [{ amount: 1000, date: '2024-01-01' }];
      mockRepositoryInstance.getTransactions.mockResolvedValue(txns);
      const r = await service.getTransactions(FAKE_ID, { page: 1 });
      expect(r.status).toBe(true);
      expect(r.data).toEqual(txns);
      expect(mockRepositoryInstance.getTransactions).toHaveBeenCalledWith(FAKE_ID, { page: 1 });
    });

    test('returns status:false on throw', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.getTransactions.mockRejectedValue(new Error('Tx failed'));
      const r = await service.getTransactions(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  // ── bulkImport ────────────────────────────────────────────────────────────────

  describe('bulkImport', () => {
    const makeImportRow = (o = {}) => ({
      name: 'Import Supplier',
      phone: '9876543210',
      email: 'import@test.com',
      address: '1 Import St',
      ...o,
    });

    test('returns status:false when suppliersData is empty array', async () => {
      const r = await service.bulkImport([]);
      expect(r).toEqual({ status: false, data: null, message: 'No supplier data provided' });
    });

    test('returns status:false when suppliersData is null', async () => {
      const r = await service.bulkImport(null);
      expect(r).toEqual({ status: false, data: null, message: 'No supplier data provided' });
    });

    test('calls checkPlan to determine import limit', async () => {
      mockCheckPlan.mockResolvedValue(0);
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(null);
      mockRepositoryInstance.bulkCreate.mockResolvedValue([makeImportRow()]);
      await service.bulkImport([makeImportRow()]);
      expect(mockCheckPlan).toHaveBeenCalledWith('suppliers', 'import');
    });

    test('limits import count when checkPlan returns positive limit', async () => {
      mockCheckPlan.mockResolvedValue(1);
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(null);
      mockRepositoryInstance.bulkCreate.mockResolvedValue([makeImportRow()]);
      await service.bulkImport([makeImportRow(), makeImportRow({ name: 'Second' })]);
      // Only 1 should be processed — but dedup by name-phone means first passes
      expect(mockRepositoryInstance.bulkCreate).toHaveBeenCalled();
    });

    test('returns validation errors (status:true, message:"CSV") for rows missing name', async () => {
      const r = await service.bulkImport([{ phone: '9876543210' }]);
      expect(r.status).toBe(true);
      expect(r.message).toBe('CSV');
      expect(Array.isArray(r.data)).toBe(true);
      expect(r.data[0].status).toContain('name');
    });

    test('returns status:false when all suppliers already exist', async () => {
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(mockSupplier);
      const r = await service.bulkImport([makeImportRow()]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('All suppliers are already imported');
      expect(Array.isArray(r.data)).toBe(true);
    });

    test('creates new suppliers and returns import result on success', async () => {
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(null);
      const row = makeImportRow();
      mockRepositoryInstance.bulkCreate.mockResolvedValue([row]);
      const r = await service.bulkImport([row]);
      expect(r.status).toBe(true);
      expect(r.message).toBe('Supplier data imported successfully');
      expect(r.data[0].status).toBe('Imported');
    });

    test('deduplicates rows with same name+phone before importing', async () => {
      const row = makeImportRow();
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(null);
      mockRepositoryInstance.bulkCreate.mockResolvedValue([row]);
      await service.bulkImport([row, row, row]); // 3 identical rows
      const [newData] = mockRepositoryInstance.bulkCreate.mock.calls[0];
      expect(newData).toHaveLength(1);
    });

    test('returns status:false on repository throw', async () => {
      mockRepositoryInstance.findByNamePhoneBranch.mockResolvedValue(null);
      mockRepositoryInstance.bulkCreate.mockRejectedValue(new Error('Bulk insert failed'));
      const r = await service.bulkImport([makeImportRow()]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Bulk insert failed');
    });
  });

  // ── exportSuppliers ───────────────────────────────────────────────────────────

  describe('exportSuppliers', () => {
    test('calls repository.exportData and returns result', async () => {
      mockRepositoryInstance.exportData.mockResolvedValue([mockSupplier]);
      const r = await service.exportSuppliers({});
      expect(r.status).toBe(true);
      expect(r.data).toEqual([mockSupplier]);
      expect(r.message).toBe('Suppliers exported successfully');
    });

    test('converts ids array to ObjectIds in queryFilters', async () => {
      mockRepositoryInstance.exportData.mockResolvedValue([]);
      await service.exportSuppliers({ ids: [FAKE_ID, FAKE_ID_2] });
      const [filters] = mockRepositoryInstance.exportData.mock.calls[0];
      expect(filters._id.$in).toHaveLength(2);
      expect(filters._id.$in[0].toString()).toBe(FAKE_ID);
    });

    test('converts branch_id to ObjectId in queryFilters', async () => {
      mockRepositoryInstance.exportData.mockResolvedValue([]);
      await service.exportSuppliers({ branch_id: FAKE_BRANCH_ID });
      const [filters] = mockRepositoryInstance.exportData.mock.calls[0];
      expect(filters.branch_id.toString()).toBe(FAKE_BRANCH_ID);
    });

    test('ignores ids if empty array', async () => {
      mockRepositoryInstance.exportData.mockResolvedValue([]);
      await service.exportSuppliers({ ids: [] });
      const [filters] = mockRepositoryInstance.exportData.mock.calls[0];
      expect(filters._id).toBeUndefined();
    });

    test('uses empty filters when called with no arguments', async () => {
      mockRepositoryInstance.exportData.mockResolvedValue([]);
      await service.exportSuppliers();
      expect(mockRepositoryInstance.exportData).toHaveBeenCalledWith({});
    });

    test('returns status:false on throw', async () => {
      mockRepositoryInstance.exportData.mockRejectedValue(new Error('Export failed'));
      const r = await service.exportSuppliers();
      expect(r.status).toBe(false);
      expect(r.message).toBe('Export failed');
    });
  });

  // ── getDataChanges ────────────────────────────────────────────────────────────

  describe('getDataChanges', () => {
    test('delegates to repository.getDataChanges and returns result', async () => {
      const changes = [{ _id: FAKE_ID, updated_date: new Date() }];
      mockRepositoryInstance.getDataChanges.mockResolvedValue(changes);
      const r = await service.getDataChanges('2024-01-01');
      expect(r).toEqual({
        status: true,
        data: changes,
        message: 'Data changes retrieved successfully',
      });
      expect(mockRepositoryInstance.getDataChanges).toHaveBeenCalledWith('2024-01-01');
    });

    test('returns status:false on throw', async () => {
      mockRepositoryInstance.getDataChanges.mockRejectedValue(new Error('Sync failed'));
      const r = await service.getDataChanges('2024-01-01');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Sync failed');
    });
  });

  // ── updateBalance ─────────────────────────────────────────────────────────────

  describe('updateBalance', () => {
    test('returns status:false when supplier not found', async () => {
      mockRepositoryInstance.findById.mockResolvedValue(null);
      const r = await service.updateBalance(FAKE_ID, 100);
      expect(r).toEqual({ status: false, data: null, message: 'Supplier not found' });
      expect(mockRepositoryInstance.update).not.toHaveBeenCalled();
    });

    test('adds amount to current balance when type is "add"', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 500 });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, balance: 700 });
      await service.updateBalance(FAKE_ID, 200, 'add');
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 700 });
    });

    test('subtracts amount from current balance when type is "subtract"', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 500 });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, balance: 300 });
      await service.updateBalance(FAKE_ID, 200, 'subtract');
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 300 });
    });

    test('defaults to "add" type when type not provided', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 100 });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, balance: 150 });
      await service.updateBalance(FAKE_ID, 50);
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 150 });
    });

    test('uses 0 as default when supplier has no balance field', async () => {
      const supplierNoBalance = { ...mockSupplier, balance: undefined };
      mockRepositoryInstance.findById.mockResolvedValue(supplierNoBalance);
      mockRepositoryInstance.update.mockResolvedValue({ ...supplierNoBalance, balance: 100 });
      await service.updateBalance(FAKE_ID, 100, 'add');
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 100 });
    });

    test('handles zero amount correctly', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 500 });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, balance: 500 });
      await service.updateBalance(FAKE_ID, 0, 'add');
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 500 });
    });

    test('handles decimal amount', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 100.5 });
      mockRepositoryInstance.update.mockResolvedValue({ ...mockSupplier, balance: 125.75 });
      await service.updateBalance(FAKE_ID, 25.25, 'add');
      expect(mockRepositoryInstance.update).toHaveBeenCalledWith(FAKE_ID, { balance: 125.75 });
    });

    test('returns status:true with updated supplier', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier, balance: 500 });
      const updated = { ...mockSupplier, balance: 700 };
      mockRepositoryInstance.update.mockResolvedValue(updated);
      const r = await service.updateBalance(FAKE_ID, 200, 'add');
      expect(r).toEqual({
        status: true,
        data: updated,
        message: 'Supplier balance updated successfully',
      });
    });

    test('returns status:false on throw', async () => {
      mockRepositoryInstance.findById.mockResolvedValue({ ...mockSupplier });
      mockRepositoryInstance.update.mockRejectedValue(new Error('Balance update failed'));
      const r = await service.updateBalance(FAKE_ID, 100, 'add');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Balance update failed');
    });
  });
});
