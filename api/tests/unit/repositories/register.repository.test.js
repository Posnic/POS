'use strict';

/**
 * Unit tests for src/repositories/register.repository.js
 * CLASS export, 1785 lines, 21 methods, receives model via constructor
 */

jest.mock('../../../src/constants/registers.constants', () => ({
  REGISTER_STATUS: { OPENED: 'Opened', CLOSED: 'Closed' },
  ERROR_MESSAGES: {
    DOCUMENT_NOT_FOUND: 'Document Not Found',
    REGISTER_NOT_FOUND: 'Register Not Found',
    REGISTER_NOT_OPENED: 'Register is not opened',
    INVALID_REGISTER_ID: 'Invalid register ID',
    FAILED_FETCH_REGISTER_REPORT: 'Failed to fetch register report',
    FAILED_FETCH_REGISTER_SALE_DETAILS: 'Failed to fetch register sale details',
    NOT_VALID_INPUT: 'Not valid Input',
    UNAUTHORIZED: 'Unauthorized',
    SALES_DETAILS_NOT_FOUND: 'Sales Details Not Found',
  },
  SUCCESS_MESSAGES: {
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
  },
}));

jest.mock('../../../src/helpers/registers.helper', () => ({
  formatRegisterDate: jest.fn((d) => (d ? new Date(d).toISOString() : null)),
}));

jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => String(id), toHexString: () => String(id) }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

jest.mock('../../../src/repositories/base.repository', () => ({
  getAllDataChanges: jest.fn().mockResolvedValue({ status: true, data: [] }),
}));

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(c) {
    this.collectionName = c;
  }
  MockBaseModel.prototype.toObjectId = jest.fn((id) => id);
  MockBaseModel.prototype.checkPlan = jest.fn().mockResolvedValue(0);
  MockBaseModel.prototype.assignFilterObjects = jest.fn((f) => f);
  MockBaseModel.prototype.startingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-01-01')));
  MockBaseModel.prototype.endingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-12-31')));
  MockBaseModel.prototype.getCollection = jest.fn().mockResolvedValue({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'fake' }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  });
  MockBaseModel.startingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-01-01')));
  MockBaseModel.endingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-12-31')));
  MockBaseModel.simplifyFields = jest.fn((d) => d);
  MockBaseModel.getSelectFields = jest.fn(() => ({}));
  MockBaseModel.getAllDataChanges = jest.fn().mockResolvedValue([]);
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({});
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = null;
  return MockBaseModel;
});

jest.mock(
  '../../../src/models/register.model',
  () =>
    class RegisterModel {
      constructor() {
        this.collectionName = 'cashregister';
        this.fields = { register_name: {}, register_status: {} };
        this.branchId = null;
        this.licenseId = null;
        this.user = null;
        this.branchName = null;
        this.timeZone = 'Asia/Kolkata';
        this.loggedUserId = null;
      }
      getCollection(name) {
        return Promise.resolve({});
      }
      getSelectFields(fields) {
        return fields;
      }
    }
);

const RegisterRepository = require('../../../src/repositories/register.repository');
const BaseModel = require('../../../src/models/base.model');
const baseRepository = require('../../../src/repositories/base.repository');
const { ObjectId } = require('mongodb');
require('../../../src/helpers/registers.helper');
const {
  REGISTER_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} = require('../../../src/constants/registers.constants');

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000003';
const FAKE_REG = '64f9a1c2e3b4d5e6f7000004';
const FAKE_USER = '64f9a1c2e3b4d5e6f7000005';

const mkChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});
const mkAgg = (result) => ({ toArray: jest.fn().mockResolvedValue(result) });
const mkIter = (docs) => ({
  [Symbol.asyncIterator]: async function* () {
    for (const d of docs) yield d;
  },
});

describe('RegisterRepository', () => {
  let repo, col, modelMock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    BaseModel.license = FAKE_LICENSE;
    BaseModel.currentBranch = FAKE_BRANCH;
    BaseModel.loggedUser = FAKE_USER;
    BaseModel.loggedUserName = 'Test User';
    BaseModel.simplifyFields.mockImplementation((d) => d);
    BaseModel.getSelectFields.mockReturnValue({});

    col = {
      find: jest.fn().mockReturnValue(mkChain([])),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      createIndex: jest.fn().mockResolvedValue('one_open_session_per_register'),
      aggregate: jest.fn().mockReturnValue(mkAgg([])),
    };

    BaseModel.prototype.getCollection = jest.fn().mockResolvedValue(col);

    modelMock = {
      collectionName: 'cashregister',
      fields: { register_name: {}, register_status: {} },
      branchId: FAKE_BRANCH,
      licenseId: FAKE_LICENSE,
      user: { _id: FAKE_USER, username: 'admin', firstname: 'Admin' },
      branchName: 'Main Branch',
      timeZone: 'Asia/Kolkata',
      loggedUserId: FAKE_USER,
      getCollection: jest.fn().mockResolvedValue(col),
      getSelectFields: jest.fn().mockReturnValue({}),
    };

    repo = new RegisterRepository(modelMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    test('uses injected model', () => {
      expect(repo.model).toBe(modelMock);
    });
    test('creates default model when none provided', () => {
      const r = new RegisterRepository();
      expect(r.model).toBeDefined();
    });
  });

  describe('getDataChanges', () => {
    test('delegates to baseRepository', async () => {
      await repo.getDataChanges('registers', '2026-01-01');
      expect(baseRepository.getAllDataChanges).toHaveBeenCalledWith(
        'cashregister',
        'registers',
        '2026-01-01',
        expect.any(Object)
      );
    });
    test('returns error on exception', async () => {
      baseRepository.getAllDataChanges.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getDataChanges('registers', '2026-01-01');
      expect(r.status).toBe(false);
      expect(r.message).toBe('fail');
    });
  });

  describe('getcashFieldData', () => {
    test('returns denomination data', async () => {
      const dc = {
        aggregate: jest
          .fn()
          .mockReturnValue(mkAgg([{ _id: FAKE_ID, cash_fields: { field_value: 100 } }])),
      };
      BaseModel.prototype.getCollection = jest.fn().mockResolvedValue(dc);
      const r = await repo.getcashFieldData();
      expect(r.status).toBe(true);
      expect(r.data).toEqual([{ cashfield: 100, cashfiled_id: FAKE_ID }]);
    });
    test('skips null cash fields', async () => {
      const dc = {
        aggregate: jest
          .fn()
          .mockReturnValue(mkAgg([{ _id: FAKE_ID, cash_fields: { field_value: null } }])),
      };
      BaseModel.prototype.getCollection = jest.fn().mockResolvedValue(dc);
      const r = await repo.getcashFieldData();
      expect(r.data).toEqual([]);
    });
    test('returns error on exception', async () => {
      BaseModel.prototype.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.getcashFieldData();
      expect(r.status).toBe(false);
    });
  });

  describe('registerReportPage', () => {
    test('returns paginated report with payment data', async () => {
      const doc = {
        _id: FAKE_ID,
        register_name: 'Reg1',
        opening_float: 100,
        cashin_amount: 50,
        cashout_amount: 20,
        register_sales: [
          { register_amount: 200, grand_total: 200, return_total: 0, payment_mode: 'Cash' },
        ],
        register_opendate: new Date('2026-01-01'),
        register_closedate: new Date('2026-01-02'),
      };
      col.find.mockReturnValue(mkChain([doc]));
      col.countDocuments.mockResolvedValue(1);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerReportPage({}, {});
      expect(r.status).toBe(true);
      expect(r.total).toBe(1);
      expect(r.list).toHaveLength(1);
    });
    test('provides default Cash payment when empty', async () => {
      const doc = { _id: FAKE_ID, register_name: 'Reg1', register_sales: [] };
      col.find.mockReturnValue(mkChain([doc]));
      col.countDocuments.mockResolvedValue(1);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerReportPage({}, {});
      expect(r.data).toEqual([{ payment_mode: 'Cash', sale_total: 0, return_total: 0, count: 0 }]);
    });
    test('uses default pagination', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerReportPage({}, {});
      expect(r.current_page).toBe(1);
      expect(r.per_page).toBe(5);
    });
    test('returns error on exception', async () => {
      BaseModel.prototype.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerReportPage({}, {});
      expect(r.status).toBe(false);
    });
  });

  describe('registeropendateFilterPage', () => {
    test('returns date range for valid register', async () => {
      col.aggregate.mockReturnValue(
        mkAgg([
          {
            startingDate: new Date('2026-01-01'),
            endingDate: new Date('2026-01-02'),
            register_name: 'Reg1',
            branch_name: 'Main',
          },
        ])
      );
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registeropendateFilterPage({ registerid: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.data.register_name).toBe('Reg1');
    });
    test('returns error for invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.registeropendateFilterPage({ registerid: 'bad' });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.INVALID_REGISTER_ID);
    });
    test('returns not found when empty', async () => {
      col.aggregate.mockReturnValue(mkAgg([]));
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registeropendateFilterPage({ registerid: FAKE_ID });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.REGISTER_NOT_FOUND);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registeropendateFilterPage({ registerid: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('userFindStatus', () => {
    test('returns register data and updates current register', async () => {
      const docs = [
        {
          _id: {
            register_id: FAKE_ID,
            register_name: 'Reg1',
            register_status: 'Opened',
            current_registerId: FAKE_REG,
          },
        },
      ];
      const uc = {
        aggregate: jest.fn().mockReturnValue(mkIter(docs)),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      modelMock.getCollection = jest
        .fn()
        .mockImplementation((n) => (n === 'users' ? Promise.resolve(uc) : Promise.resolve(col)));
      const r = await repo.userFindStatus({ registerid: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.data.register_data).toHaveLength(1);
      expect(uc.updateOne).toHaveBeenCalled();
    });
    test('returns empty data when no matches', async () => {
      const uc = {
        aggregate: jest.fn().mockReturnValue(mkIter([])),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      modelMock.getCollection = jest
        .fn()
        .mockImplementation((n) => (n === 'users' ? Promise.resolve(uc) : Promise.resolve(col)));
      const r = await repo.userFindStatus({ registerid: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.data.register_data).toEqual([]);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.userFindStatus({ registerid: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('registeraddInsert', () => {
    test('creates new register', async () => {
      col.findOne.mockResolvedValue(null);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registeraddInsert({ register_Id: FAKE_ID, opening_float: '100' });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.REGISTER_OPENED);
      expect(col.insertOne).toHaveBeenCalled();
    });
    test('updates existing opened register', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID, register_status: 'Opened' });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registeraddInsert({ register_Id: FAKE_ID, opening_float: '200' });
      expect(r.status).toBe(true);
      expect(col.updateOne).toHaveBeenCalled();
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registeraddInsert({ register_Id: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('registerUpdateList', () => {
    test('updates register name and opening_float', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerUpdateList({
        cash_register_id: FAKE_ID,
        register_name: '  New Name  ',
        opening_float: '150.50',
      });
      expect(r.status).toBe(true);
      expect(r.data.register_name).toBe('New Name');
      expect(r.data.opening_float).toBe(150.5);
    });
    test('returns error for invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.registerUpdateList({ cash_register_id: 'bad' });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.INVALID_REGISTER_ID);
    });
    test('returns error when no fields', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerUpdateList({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.NOT_VALID_INPUT);
    });
    test('returns not found when no match', async () => {
      col.updateOne.mockResolvedValue({ matchedCount: 0 });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerUpdateList({ cash_register_id: FAKE_ID, register_name: 'X' });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.REGISTER_NOT_FOUND);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerUpdateList({ cash_register_id: FAKE_ID, register_name: 'X' });
      expect(r.status).toBe(false);
    });
  });

  describe('registerInOutDetail', () => {
    test('pushes cash detail', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerInOutDetail({
        cash_register_id: FAKE_ID,
        in_amount: '50',
        out_amount: '20',
        in_description: 'Deposit',
        out_description: 'Withdrawal',
      });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.REGISTER_CASHDETAIL_UPDATED);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({ $push: expect.any(Object) })
      );
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerInOutDetail({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('deleteCashInOut', () => {
    test('unsets and pulls entry', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.deleteCashInOut({ register_id: FAKE_ID, index: 0 });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.REGISTER_CASH_ENTRY_DELETED);
      expect(col.updateOne).toHaveBeenCalledTimes(2);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.deleteCashInOut({ register_id: FAKE_ID, index: 0 });
      expect(r.status).toBe(false);
    });
  });

  describe('registercloseUpdate', () => {
    test('closes register', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registercloseUpdate({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.REGISTER_CLOSED);
      expect(r.data.register_status).toBe(REGISTER_STATUS.CLOSED);
    });

    test('persists expected/counted/over_short from the session at close', async () => {
      col.findOne.mockResolvedValue({
        _id: FAKE_ID,
        register_status: REGISTER_STATUS.OPENED,
        opening_float: '100',
        register_sales: [
          { register_paymentmode: 'Cash', register_amount: '250' },
          { register_paymentmode: 'Card', register_amount: '400' },
          { multi_payment: { cash: 50, card: 30 } },
        ],
        cashInOutDetail: [{ cashin_amount: '20' }, { cashout_amount: '70' }],
        countedAmount: [{ paymenttype: 'Cash', value: '340' }],
      });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registercloseUpdate({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(true);
      // 100 float + 250 cash + 50 multi-cash + 20 in - 70 out = 350 expected
      expect(r.data.closing_expected).toBe(350);
      expect(r.data.closing_counted).toBe(340);
      expect(r.data.over_short).toBe(-10);
    });

    test('a blind close (nothing counted) stores expected with null counted', async () => {
      col.findOne.mockResolvedValue({
        _id: FAKE_ID,
        register_status: REGISTER_STATUS.OPENED,
        opening_float: 100,
        register_sales: [],
        cashInOutDetail: [],
        countedAmount: [],
      });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registercloseUpdate({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.data.closing_expected).toBe(100);
      expect(r.data.closing_counted).toBeNull();
      expect(r.data.over_short).toBeNull();
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registercloseUpdate({ cash_register_id: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('cashRegisterOpenManualModel', () => {
    test('error when not found', async () => {
      col.findOne.mockResolvedValue(null);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
    });
    test('error when not opened', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID, register_status: 'Closed' });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.REGISTER_NOT_OPENED);
    });
    test('returns with payment tally', async () => {
      const doc = {
        _id: FAKE_ID,
        register_status: 'Opened',
        register_sales: [
          { register_paymentmode: 'Cash', register_amount: '100' },
          { register_paymentmode: 'Card', register_amount: '50' },
        ],
        cashInOutDetail: [],
        opening_float: 50,
      };
      col.findOne.mockResolvedValue(doc);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.paymentTally.Cash).toBe(150);
      expect(r.data.paymentTally.Card).toBe(50);
    });
    test('handles multi_payment', async () => {
      const doc = {
        _id: FAKE_ID,
        register_status: 'Opened',
        register_sales: [{ multi_payment: JSON.stringify({ cash: 80, card: 20 }) }],
        cashInOutDetail: [],
        opening_float: 0,
      };
      col.findOne.mockResolvedValue(doc);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.paymentTally.Cash).toBe(80);
      expect(r.data.paymentTally.Card).toBe(20);
    });
    test('handles cashInOutDetail', async () => {
      const doc = {
        _id: FAKE_ID,
        register_status: 'Opened',
        register_sales: [{ register_paymentmode: 'Cash', register_amount: '100' }],
        cashInOutDetail: [{ cashin_amount: 30, cashout_amount: 10 }],
        opening_float: 0,
      };
      col.findOne.mockResolvedValue(doc);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.paymentTally.Cash).toBe(120);
    });
    test('normalizes Creditcard to Card', async () => {
      const doc = {
        _id: FAKE_ID,
        register_status: 'Opened',
        register_sales: [{ register_paymentmode: 'CreditCard', register_amount: '100' }],
        cashInOutDetail: [],
        opening_float: 0,
      };
      col.findOne.mockResolvedValue(doc);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.paymentTally.Card).toBe(100);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.cashRegisterOpenManualModel(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('getCashRegisterModel', () => {
    test('returns register', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID, register_name: 'Reg1' });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.getCashRegisterModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.register_name).toBe('Reg1');
    });
    test('error when not found', async () => {
      col.findOne.mockResolvedValue(null);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.getCashRegisterModel(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.getCashRegisterModel(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('registerCountedAmount', () => {
    test('pushes new counted amount', async () => {
      col.findOne.mockResolvedValue(null);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerCountedAmount({
        register_row_Id: FAKE_ID,
        payment_Type: 'Cash',
        countedAmount: '500',
      });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.AMOUNT_UPDATED);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({ $push: expect.any(Object) })
      );
    });
    test('updates existing counted amount', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerCountedAmount({
        register_row_Id: FAKE_ID,
        payment_Type: 'Cash',
        countedAmount: '500',
      });
      expect(r.status).toBe(true);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything(), 'countedAmount.paymenttype': 'Cash' }),
        expect.objectContaining({ $set: expect.any(Object) })
      );
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerCountedAmount({
        register_row_Id: FAKE_ID,
        payment_Type: 'Cash',
        countedAmount: '500',
      });
      expect(r.status).toBe(false);
    });
  });

  describe('registerPaymentNoteModel', () => {
    test('updates payment note', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerPaymentNoteModel({ id: FAKE_ID, note: 'Test note' });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.PAYMENT_NOTE_UPDATED);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({ $set: { payment_note: 'Test note' } })
      );
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerPaymentNoteModel({ id: FAKE_ID, note: 'Test' });
      expect(r.status).toBe(false);
    });
  });

  describe('registerSaleDetailsPage', () => {
    test('returns paginated sales', async () => {
      const reg = {
        _id: FAKE_ID,
        register_name: 'Reg1',
        register_sales: [
          { sale_no: 'S001', register_amount: 100, register_paymentmode: 'Cash', date: new Date() },
        ],
        register_opendate: new Date(),
        register_closedate: null,
        current_user: 'Admin',
        branch_name: 'Main',
        register_status: 'Opened',
      };
      col.findOne.mockResolvedValue(reg);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerSaleDetailsPage({ id: FAKE_ID }, {});
      expect(r.status).toBe(true);
      expect(r.list).toHaveLength(1);
      expect(r.details.register_name).toBe('Reg1');
    });
    test('returns error for invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.registerSaleDetailsPage({ id: 'bad' }, {});
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.INVALID_REGISTER_ID);
    });
    test('returns not found', async () => {
      col.findOne.mockResolvedValue(null);
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerSaleDetailsPage({ id: FAKE_ID }, {});
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.REGISTER_NOT_FOUND);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerSaleDetailsPage({ id: FAKE_ID }, {});
      expect(r.status).toBe(false);
    });
  });

  describe('getRegisterReportDetailsPage', () => {
    test('returns report details', async () => {
      col.aggregate.mockImplementation(() =>
        mkAgg([
          {
            _id: { register_id: FAKE_ID, register_paymentmode: 'Cash' },
            register_amount: 100,
            register_return_total: 0,
            count: 1,
          },
        ])
      );
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.getRegisterReportDetailsPage({
        starting_date: '2026-01-01',
        ending_date: '2026-12-31',
        register_id: FAKE_ID,
      });
      expect(r.status).toBe(true);
      expect(r.data.sale_details).toBeDefined();
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.getRegisterReportDetailsPage({
        starting_date: '2026-01-01',
        ending_date: '2026-12-31',
        register_id: FAKE_ID,
      });
      expect(r.status).toBe(false);
    });
  });

  describe('registerDenomsubmitModel', () => {
    test('submits denomination', async () => {
      col.updateOne.mockResolvedValue({ matchedCount: 1 });
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.registerDenomsubmitModel({
        register_id: FAKE_ID,
        denomination_values: [100, 200],
      });
      expect(r.status).toBe(true);
      expect(r.message).toBe('Cash added successfully');
      expect(col.updateOne).toHaveBeenCalledTimes(2);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.registerDenomsubmitModel({ register_id: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('editCashDenominationModel', () => {
    test('returns denomination data', async () => {
      col.aggregate.mockReturnValue(
        mkAgg([{ cashDenomDetail: { remove_id: FAKE_ID, 0: [{ value: 100 }] } }])
      );
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.editCashDenominationModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data.cashfield).toBeDefined();
    });
    test('returns empty when none', async () => {
      col.aggregate.mockReturnValue(mkAgg([]));
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.editCashDenominationModel(FAKE_ID);
      expect(r.status).toBe(true);
      expect(r.data).toEqual({});
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.editCashDenominationModel(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('deleteCashDenominationModel', () => {
    test('deletes denomination', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.deleteCashDenominationModel({ register_id: FAKE_ID });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.DELETE_SUCCESS);
    });
    test('returns error for invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.deleteCashDenominationModel({ register_id: 'bad' });
      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.INVALID_REGISTER_ID);
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.deleteCashDenominationModel({ register_id: FAKE_ID });
      expect(r.status).toBe(false);
    });
  });

  describe('addSaleRegisterEntry', () => {
    test('pushes sale entry', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.addSaleRegisterEntry({
        registerId: FAKE_ID,
        licenseId: FAKE_LICENSE,
        registerData: { sale_id: FAKE_ID },
      });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.CHANGES_RETRIEVED);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything(), license: FAKE_LICENSE }),
        expect.objectContaining({ $push: expect.any(Object) })
      );
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.addSaleRegisterEntry({
        registerId: FAKE_ID,
        licenseId: FAKE_LICENSE,
        registerData: {},
      });
      expect(r.status).toBe(false);
    });
  });

  describe('updateSaleRegisterEntry', () => {
    test('updates sale entry', async () => {
      modelMock.getCollection = jest.fn().mockResolvedValue(col);
      const r = await repo.updateSaleRegisterEntry({
        saleId: FAKE_ID,
        licenseId: FAKE_LICENSE,
        registerData: {
          date: new Date(),
          register_amount: 100,
          register_discount: 0,
          register_tax: 0,
          register_paymentmode: 'Cash',
          multi_payment: [],
        },
      });
      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.CHANGES_RETRIEVED);
      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'register_sales.sale_id': expect.anything(),
          license: FAKE_LICENSE,
        }),
        expect.objectContaining({ $set: expect.any(Object) })
      );
    });
    test('returns error on exception', async () => {
      modelMock.getCollection = jest.fn().mockRejectedValue(new Error('fail'));
      const r = await repo.updateSaleRegisterEntry({
        saleId: FAKE_ID,
        licenseId: FAKE_LICENSE,
        registerData: {},
      });
      expect(r.status).toBe(false);
    });
  });
});
