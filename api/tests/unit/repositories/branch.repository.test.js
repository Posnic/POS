'use strict';

/**
 * Unit tests for src/repositories/branches.repository.js
 *
 * File        : src/repositories/branches.repository.js (217 lines, SINGLETON export)
 * Export type : SINGLETON — module.exports = new BranchesRepository()
 * Base class  : NONE — does NOT extend base.repository.js
 *
 * Pattern     : Direct Mongoose model wrapper.
 *               this.branchModel = Branch  (class reference, NOT an instance)
 *               create() uses  new this.branchModel(data).save()
 *               Other CRUD methods call static Mongoose methods directly.
 *
 * Error strategy: ALL methods RETHROW — no soft error returns.
 *
 * Query chaining: findById / findOne / find return Mongoose-style thenables
 *   that support  .select()  .lean()  .sort()  .skip()  .limit()
 *
 * Methods (11 + 1 getter):
 *   findById(id, options)                  — chainable, optional select/lean
 *   findOne(filter, options)               — chainable, optional select/lean/sort
 *   find(filter, options)                  — chainable, optional select/lean/sort/skip/limit
 *   countDocuments(filter)                 — direct promise
 *   create(data)                           — new Model(data).save()
 *   updateById(id, data, options)          — findByIdAndUpdate with new+runValidators
 *   deleteById(id)                         — findByIdAndDelete
 *   getBranchOptions()                     — find + lean → maps to {label,value}
 *   searchBranches(query, limit)           — $or regex on 3 fields + limit + lean
 *   getFirstBranch()                       — findOne + sort(created_date:1) + lean
 *   getBranchStats()                       — countDocuments() × 3 (total/active/inactive)
 *   get model()                            — getter, returns this.branchModel
 *
 * Branch model fields used:
 *   _id, branch_name, address, store_email, status, created_date
 *
 * Mocked dependency:
 *   src/models/branch.model — constructor + all static methods
 *
 * No production bugs found.
 */

// ─── Mock (hoisted before any require) ───────────────────────────────────────

jest.mock('../../../src/models/branch.model', () => {
  const mockSave = jest.fn();

  const MockBranch = jest.fn(function (data) {
    this.data = data;
    this.save = MockBranch.__mockSave;
  });

  MockBranch.__mockSave = mockSave;
  MockBranch.findById = jest.fn();
  MockBranch.findOne = jest.fn();
  MockBranch.find = jest.fn();
  MockBranch.countDocuments = jest.fn();
  MockBranch.findByIdAndUpdate = jest.fn();
  MockBranch.findByIdAndDelete = jest.fn();

  return MockBranch;
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const Branch = require('../../../src/models/branch.model');
const repository = require('../../../src/repositories/branch.repository');

// ─── Chainable query mock helper ──────────────────────────────────────────────

/**
 * Creates a thenable Mongoose-query-style mock.
 * await-ing the chain resolves to `result`.
 * Each chain method returns `this` so calls are chainable.
 */
const mkChain = (result) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn) => Promise.resolve(result).catch(fn);
  return chain;
};

// ─── Shared fake data ─────────────────────────────────────────────────────────

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';

const FAKE_BRANCH = {
  _id: FAKE_ID,
  branch_name: 'Main Branch',
  address: '123 Test Street',
  store_email: 'main@test.com',
  status: 'active',
  created_date: new Date('2026-01-01T00:00:00.000Z'),
};

const FAKE_BRANCH_2 = {
  _id: '64f9a1c2e3b4d5e6f7000002',
  branch_name: 'East Branch',
  address: '456 East Ave',
  store_email: 'east@test.com',
  status: 'inactive',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BranchesRepository (singleton)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Restore default resolved values after clearAllMocks
    Branch.countDocuments.mockResolvedValue(0);
    Branch.findByIdAndUpdate.mockResolvedValue(FAKE_BRANCH);
    Branch.findByIdAndDelete.mockResolvedValue(FAKE_BRANCH);
    Branch.__mockSave.mockResolvedValue(FAKE_BRANCH);
  });

  // ── module load / constructor ────────────────────────────────────────────

  describe('module load (constructor)', () => {
    test('exports a singleton object', () => {
      expect(typeof repository).toBe('object');
      expect(repository).not.toBeNull();
    });

    test('this.branchModel is the Branch class (not an instance)', () => {
      expect(repository.branchModel).toBe(Branch);
    });
  });

  // ── get model ────────────────────────────────────────────────────────────

  describe('get model', () => {
    test('returns this.branchModel via getter', () => {
      expect(repository.model).toBe(repository.branchModel);
    });

    test('returns the Branch class', () => {
      expect(repository.model).toBe(Branch);
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    test('calls Branch.findById with the given id', async () => {
      Branch.findById.mockReturnValue(mkChain(FAKE_BRANCH));
      await repository.findById(FAKE_ID);
      expect(Branch.findById).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns the found branch document', async () => {
      Branch.findById.mockReturnValue(mkChain(FAKE_BRANCH));
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(FAKE_BRANCH);
    });

    test('applies select option when provided', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findById.mockReturnValue(chain);
      await repository.findById(FAKE_ID, { select: 'branch_name address' });
      expect(chain.select).toHaveBeenCalledWith('branch_name address');
    });

    test('applies lean option when provided', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findById.mockReturnValue(chain);
      await repository.findById(FAKE_ID, { lean: true });
      expect(chain.lean).toHaveBeenCalled();
    });

    test('does NOT call select when not in options', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findById.mockReturnValue(chain);
      await repository.findById(FAKE_ID, {});
      expect(chain.select).not.toHaveBeenCalled();
    });

    test('returns null when branch is not found', async () => {
      Branch.findById.mockReturnValue(mkChain(null));
      const r = await repository.findById('nonexistent');
      expect(r).toBeNull();
    });

    test('rethrows error from Branch.findById', async () => {
      Branch.findById.mockImplementationOnce(() => {
        throw new Error('DB error');
      });
      await expect(repository.findById(FAKE_ID)).rejects.toThrow('DB error');
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    const FILTER = { branch_name: 'Main Branch' };

    test('calls Branch.findOne with the given filter', async () => {
      Branch.findOne.mockReturnValue(mkChain(FAKE_BRANCH));
      await repository.findOne(FILTER);
      expect(Branch.findOne).toHaveBeenCalledWith(FILTER);
    });

    test('returns the found branch', async () => {
      Branch.findOne.mockReturnValue(mkChain(FAKE_BRANCH));
      const r = await repository.findOne(FILTER);
      expect(r).toEqual(FAKE_BRANCH);
    });

    test('applies select option', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.findOne(FILTER, { select: 'branch_name' });
      expect(chain.select).toHaveBeenCalledWith('branch_name');
    });

    test('applies lean option', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.findOne(FILTER, { lean: true });
      expect(chain.lean).toHaveBeenCalled();
    });

    test('applies sort option', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.findOne(FILTER, { sort: { created_date: -1 } });
      expect(chain.sort).toHaveBeenCalledWith({ created_date: -1 });
    });

    test('does NOT call sort when not in options', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.findOne(FILTER, {});
      expect(chain.sort).not.toHaveBeenCalled();
    });

    test('returns null when branch not found', async () => {
      Branch.findOne.mockReturnValue(mkChain(null));
      const r = await repository.findOne({ branch_name: 'Ghost' });
      expect(r).toBeNull();
    });

    test('rethrows error from Branch.findOne', async () => {
      Branch.findOne.mockImplementationOnce(() => {
        throw new Error('FindOne failed');
      });
      await expect(repository.findOne(FILTER)).rejects.toThrow('FindOne failed');
    });
  });

  // ── find ─────────────────────────────────────────────────────────────────

  describe('find', () => {
    test('calls Branch.find with the given filter', async () => {
      Branch.find.mockReturnValue(mkChain([FAKE_BRANCH]));
      await repository.find({ status: 'active' });
      expect(Branch.find).toHaveBeenCalledWith({ status: 'active' });
    });

    test('uses empty object as default filter', async () => {
      Branch.find.mockReturnValue(mkChain([]));
      await repository.find();
      expect(Branch.find).toHaveBeenCalledWith({});
    });

    test('returns array of branches', async () => {
      Branch.find.mockReturnValue(mkChain([FAKE_BRANCH, FAKE_BRANCH_2]));
      const r = await repository.find({ status: 'active' });
      expect(r).toHaveLength(2);
      expect(r[0]).toEqual(FAKE_BRANCH);
    });

    test('returns empty array when no branches match', async () => {
      Branch.find.mockReturnValue(mkChain([]));
      const r = await repository.find({ status: 'deleted' });
      expect(r).toEqual([]);
    });

    test('applies select option', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, { select: 'branch_name' });
      expect(chain.select).toHaveBeenCalledWith('branch_name');
    });

    test('applies lean option', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, { lean: true });
      expect(chain.lean).toHaveBeenCalled();
    });

    test('applies sort option', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, { sort: { branch_name: 1 } });
      expect(chain.sort).toHaveBeenCalledWith({ branch_name: 1 });
    });

    test('applies skip option', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, { skip: 10 });
      expect(chain.skip).toHaveBeenCalledWith(10);
    });

    test('applies limit option', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, { limit: 5 });
      expect(chain.limit).toHaveBeenCalledWith(5);
    });

    test('does NOT apply skip/limit/sort when not in options', async () => {
      const chain = mkChain([]);
      Branch.find.mockReturnValue(chain);
      await repository.find({}, {});
      expect(chain.skip).not.toHaveBeenCalled();
      expect(chain.limit).not.toHaveBeenCalled();
      expect(chain.sort).not.toHaveBeenCalled();
    });

    test('rethrows error from Branch.find', async () => {
      Branch.find.mockImplementationOnce(() => {
        throw new Error('Find failed');
      });
      await expect(repository.find({ status: 'active' })).rejects.toThrow('Find failed');
    });
  });

  // ── countDocuments ────────────────────────────────────────────────────────

  describe('countDocuments', () => {
    test('calls Branch.countDocuments with the given filter', async () => {
      Branch.countDocuments.mockResolvedValueOnce(3);
      await repository.countDocuments({ status: 'active' });
      expect(Branch.countDocuments).toHaveBeenCalledWith({ status: 'active' });
    });

    test('uses empty object as default filter', async () => {
      Branch.countDocuments.mockResolvedValueOnce(10);
      await repository.countDocuments();
      expect(Branch.countDocuments).toHaveBeenCalledWith({});
    });

    test('returns the count on success', async () => {
      Branch.countDocuments.mockResolvedValueOnce(7);
      const r = await repository.countDocuments({ status: 'active' });
      expect(r).toBe(7);
    });

    test('returns 0 when collection is empty', async () => {
      Branch.countDocuments.mockResolvedValueOnce(0);
      const r = await repository.countDocuments({});
      expect(r).toBe(0);
    });

    test('rethrows error from Branch.countDocuments', async () => {
      Branch.countDocuments.mockRejectedValueOnce(new Error('Count failed'));
      await expect(repository.countDocuments({})).rejects.toThrow('Count failed');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const NEW_DATA = {
      branch_name: 'New Branch',
      address: '789 New St',
      store_email: 'new@test.com',
    };

    test('calls new Branch(data) constructor with the provided data', async () => {
      await repository.create(NEW_DATA);
      expect(Branch).toHaveBeenCalledWith(NEW_DATA);
    });

    test('calls .save() on the new branch instance', async () => {
      await repository.create(NEW_DATA);
      expect(Branch.__mockSave).toHaveBeenCalled();
    });

    test('returns the saved branch document', async () => {
      Branch.__mockSave.mockResolvedValueOnce(FAKE_BRANCH);
      const r = await repository.create(NEW_DATA);
      expect(r).toEqual(FAKE_BRANCH);
    });

    test('rethrows error when save() fails', async () => {
      Branch.__mockSave.mockRejectedValueOnce(new Error('Save failed'));
      await expect(repository.create(NEW_DATA)).rejects.toThrow('Save failed');
    });
  });

  // ── updateById ────────────────────────────────────────────────────────────

  describe('updateById', () => {
    const UPDATE_DATA = { branch_name: 'Updated Branch' };

    test('calls Branch.findByIdAndUpdate with id and data', async () => {
      await repository.updateById(FAKE_ID, UPDATE_DATA);
      expect(Branch.findByIdAndUpdate).toHaveBeenCalledWith(
        FAKE_ID,
        UPDATE_DATA,
        expect.objectContaining({ new: true, runValidators: true })
      );
    });

    test('always passes new:true and runValidators:true', async () => {
      await repository.updateById(FAKE_ID, UPDATE_DATA, {});
      const callArgs = Branch.findByIdAndUpdate.mock.calls[0][2];
      expect(callArgs.new).toBe(true);
      expect(callArgs.runValidators).toBe(true);
    });

    test('merges extra options with defaults', async () => {
      await repository.updateById(FAKE_ID, UPDATE_DATA, { upsert: true });
      const callArgs = Branch.findByIdAndUpdate.mock.calls[0][2];
      expect(callArgs.upsert).toBe(true);
      expect(callArgs.new).toBe(true);
    });

    test('returns the updated branch document', async () => {
      Branch.findByIdAndUpdate.mockResolvedValueOnce({ ...FAKE_BRANCH, branch_name: 'Updated' });
      const r = await repository.updateById(FAKE_ID, UPDATE_DATA);
      expect(r.branch_name).toBe('Updated');
    });

    test('returns null when branch is not found', async () => {
      Branch.findByIdAndUpdate.mockResolvedValueOnce(null);
      const r = await repository.updateById('nonexistent', UPDATE_DATA);
      expect(r).toBeNull();
    });

    test('rethrows error from findByIdAndUpdate', async () => {
      Branch.findByIdAndUpdate.mockRejectedValueOnce(new Error('Update failed'));
      await expect(repository.updateById(FAKE_ID, UPDATE_DATA)).rejects.toThrow('Update failed');
    });
  });

  // ── deleteById ────────────────────────────────────────────────────────────

  describe('deleteById', () => {
    test('calls Branch.findByIdAndDelete with the given id', async () => {
      await repository.deleteById(FAKE_ID);
      expect(Branch.findByIdAndDelete).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns the deleted branch document', async () => {
      Branch.findByIdAndDelete.mockResolvedValueOnce(FAKE_BRANCH);
      const r = await repository.deleteById(FAKE_ID);
      expect(r).toEqual(FAKE_BRANCH);
    });

    test('returns null when branch does not exist', async () => {
      Branch.findByIdAndDelete.mockResolvedValueOnce(null);
      const r = await repository.deleteById('nonexistent');
      expect(r).toBeNull();
    });

    test('rethrows error from findByIdAndDelete', async () => {
      Branch.findByIdAndDelete.mockRejectedValueOnce(new Error('Delete failed'));
      await expect(repository.deleteById(FAKE_ID)).rejects.toThrow('Delete failed');
    });
  });

  // ── getBranchOptions ──────────────────────────────────────────────────────

  describe('getBranchOptions', () => {
    const RAW_BRANCHES = [
      { _id: 'B001', branch_name: 'Main Branch' },
      { _id: 'B002', branch_name: 'East Branch' },
    ];

    test('calls Branch.find with empty filter and name+id projection', async () => {
      Branch.find.mockReturnValue(mkChain(RAW_BRANCHES));
      await repository.getBranchOptions();
      expect(Branch.find).toHaveBeenCalledWith({}, 'branch_name _id');
    });

    test('calls .lean() on the query', async () => {
      const chain = mkChain(RAW_BRANCHES);
      Branch.find.mockReturnValue(chain);
      await repository.getBranchOptions();
      expect(chain.lean).toHaveBeenCalled();
    });

    test('maps results to {label, value} format', async () => {
      Branch.find.mockReturnValue(mkChain(RAW_BRANCHES));
      const r = await repository.getBranchOptions();
      expect(r).toEqual([
        { label: 'Main Branch', value: 'B001' },
        { label: 'East Branch', value: 'B002' },
      ]);
    });

    test('uses _id.toString() for the value field', async () => {
      const branchWithObjectId = [{ _id: { toString: () => 'OBJ001' }, branch_name: 'OID Branch' }];
      Branch.find.mockReturnValue(mkChain(branchWithObjectId));
      const r = await repository.getBranchOptions();
      expect(r[0].value).toBe('OBJ001');
    });

    test('returns empty array when no branches exist', async () => {
      Branch.find.mockReturnValue(mkChain([]));
      const r = await repository.getBranchOptions();
      expect(r).toEqual([]);
    });

    test('rethrows error from Branch.find', async () => {
      Branch.find.mockImplementationOnce(() => {
        throw new Error('Options failed');
      });
      await expect(repository.getBranchOptions()).rejects.toThrow('Options failed');
    });
  });

  // ── searchBranches ────────────────────────────────────────────────────────

  describe('searchBranches', () => {
    const SEARCH_QUERY = 'main';

    test('calls Branch.find with $or regex filter on 3 fields', async () => {
      Branch.find.mockReturnValue(mkChain([FAKE_BRANCH]));
      await repository.searchBranches(SEARCH_QUERY);
      const calledFilter = Branch.find.mock.calls[0][0];
      expect(calledFilter).toHaveProperty('$or');
      expect(calledFilter.$or).toHaveLength(3);
    });

    test('searches branch_name with case-insensitive regex', async () => {
      Branch.find.mockReturnValue(mkChain([FAKE_BRANCH]));
      await repository.searchBranches(SEARCH_QUERY);
      const orClauses = Branch.find.mock.calls[0][0].$or;
      const nameClause = orClauses.find((c) => c.branch_name);
      expect(nameClause.branch_name).toEqual({ $regex: SEARCH_QUERY, $options: 'i' });
    });

    test('searches address and store_email fields', async () => {
      Branch.find.mockReturnValue(mkChain([FAKE_BRANCH]));
      await repository.searchBranches(SEARCH_QUERY);
      const orClauses = Branch.find.mock.calls[0][0].$or;
      const addrClause = orClauses.find((c) => c.address);
      const emailClause = orClauses.find((c) => c.store_email);
      expect(addrClause.address).toEqual({ $regex: SEARCH_QUERY, $options: 'i' });
      expect(emailClause.store_email).toEqual({ $regex: SEARCH_QUERY, $options: 'i' });
    });

    test('applies .limit() with the provided limit', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.searchBranches(SEARCH_QUERY, 20);
      expect(chain.limit).toHaveBeenCalledWith(20);
    });

    test('uses default limit of 10 when not specified', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.searchBranches(SEARCH_QUERY);
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    test('calls .lean() on the query', async () => {
      const chain = mkChain([FAKE_BRANCH]);
      Branch.find.mockReturnValue(chain);
      await repository.searchBranches(SEARCH_QUERY);
      expect(chain.lean).toHaveBeenCalled();
    });

    test('rethrows error from Branch.find', async () => {
      Branch.find.mockImplementationOnce(() => {
        throw new Error('Search failed');
      });
      await expect(repository.searchBranches(SEARCH_QUERY)).rejects.toThrow('Search failed');
    });
  });

  // ── getFirstBranch ────────────────────────────────────────────────────────

  describe('getFirstBranch', () => {
    test('calls Branch.findOne with empty filter and _id projection', async () => {
      Branch.findOne.mockReturnValue(mkChain(FAKE_BRANCH));
      await repository.getFirstBranch();
      expect(Branch.findOne).toHaveBeenCalledWith({}, '_id');
    });

    test('calls .sort({ created_date: 1 }) for ascending order', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.getFirstBranch();
      expect(chain.sort).toHaveBeenCalledWith({ created_date: 1 });
    });

    test('calls .lean() on the query', async () => {
      const chain = mkChain(FAKE_BRANCH);
      Branch.findOne.mockReturnValue(chain);
      await repository.getFirstBranch();
      expect(chain.lean).toHaveBeenCalled();
    });

    test('returns the first branch document', async () => {
      Branch.findOne.mockReturnValue(mkChain(FAKE_BRANCH));
      const r = await repository.getFirstBranch();
      expect(r).toEqual(FAKE_BRANCH);
    });

    test('rethrows error from Branch.findOne', async () => {
      Branch.findOne.mockImplementationOnce(() => {
        throw new Error('First branch failed');
      });
      await expect(repository.getFirstBranch()).rejects.toThrow('First branch failed');
    });
  });

  // ── getBranchStats ────────────────────────────────────────────────────────

  describe('getBranchStats', () => {
    test('calls countDocuments three times (total, active, inactive)', async () => {
      Branch.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);
      await repository.getBranchStats();
      expect(Branch.countDocuments).toHaveBeenCalledTimes(3);
    });

    test('calls countDocuments with empty filter for total', async () => {
      Branch.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);
      await repository.getBranchStats();
      expect(Branch.countDocuments).toHaveBeenCalledWith({});
    });

    test('calls countDocuments with { status: "active" } for active count', async () => {
      Branch.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);
      await repository.getBranchStats();
      expect(Branch.countDocuments).toHaveBeenCalledWith({ status: 'active' });
    });

    test('calls countDocuments with { status: "inactive" } for inactive count', async () => {
      Branch.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);
      await repository.getBranchStats();
      expect(Branch.countDocuments).toHaveBeenCalledWith({ status: 'inactive' });
    });

    test('returns { total, active, inactive } object', async () => {
      Branch.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);
      const r = await repository.getBranchStats();
      expect(r).toEqual({ total: 10, active: 7, inactive: 3 });
    });

    test('rethrows error when countDocuments fails', async () => {
      Branch.countDocuments.mockRejectedValueOnce(new Error('Stats failed'));
      await expect(repository.getBranchStats()).rejects.toThrow('Stats failed');
    });
  });
});
