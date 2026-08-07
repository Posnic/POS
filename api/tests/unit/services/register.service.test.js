'use strict';

/**
 * Unit tests for src/services/register.service.js
 *
 * File confirmed  : src/services/register.service.js (208 lines, class export)
 * Export type     : CLASS export — `module.exports = RegisterService`
 * Does NOT extend base.service.js.
 *
 * Constructor:
 *   Accepts optional `model` — falls back to `new RegisterModel()`
 *   `this.model      = model || new RegisterModel()`
 *   `this.repository = new RegisterRepository(this.model)`
 *
 * Methods (20):
 *   getDataChanges(moduleName, from)              — delegates to repository
 *   getcashFieldData()                            — delegates to repository
 *   registerReportPage(data, options)             — delegates to repository
 *   registeropendateFilterPage(data)              — delegates to repository
 *   userFindStatus(data)                          — delegates to repository
 *   registeraddInsert(data)                       — delegates to repository
 *   registerUpdateList(data)                      — delegates to repository
 *   registerInOutDetail(data)                     — delegates to repository
 *   deleteCashInOut(data)                         — delegates to repository
 *   registercloseUpdate(data)                     — delegates to repository
 *   cashRegisterOpenManualModel(id)               — delegates to repository
 *   getCashRegisterModel(id)                      — delegates to repository
 *   registerCountedAmount(data)                   — delegates to repository
 *   registerPaymentNoteModel(data)                — delegates to repository
 *   registerSaleDetailsPage(data, options)        — delegates to repository
 *   getRegisterReportDetailsPage(data)            — delegates to repository
 *   getRegisterReportPdfDetails(data)             — REAL LOGIC: calls repo, computes totals
 *   registerDenomsubmitModel(data)                — delegates to repository
 *   editCashDenominationModel(id)                 — delegates to repository
 *   deleteCashDenominationModel(data)             — delegates to repository
 *
 * External dependencies (all mocked):
 *   RegisterModel      — class constructor
 *   RegisterRepository — class constructor (receives model instance)
 *   registers.constants → SUCCESS_MESSAGES
 *
 * PRODUCTION ISSUES FOUND:
 *   1. `register_report_cash`, `register_report_Cheque`, `register_report_CreditCard`
 *      are ASSIGNED (=) not ACCUMULATED (+=) inside the for-loop in
 *      `getRegisterReportPdfDetails`. If multiple rows share the same payment_mode
 *      only the last row's total is recorded — earlier rows are silently overwritten.
 *      This is a bug in the aggregation logic (should use +=).
 *   2. `difference = counted_amount - total` — uses gross total before deducting
 *      refunds or pending, not the net sale figure. May not match expected business logic.
 *   3. `payment_report = total + refund` — adds positive refund to total, inflating
 *      gross if refund amounts are already positive values.
 *   4. All 19 pass-through methods propagate whatever the repository throws; there is
 *      no catch/wrap layer in the service, so repository errors bubble uncaught to
 *      the controller.
 */

// ─── Mock RegisterModel (class) ───────────────────────────────────────────────
jest.mock('../../../src/models/register.model', () => jest.fn());

// ─── Mock RegisterRepository (class) ─────────────────────────────────────────
jest.mock('../../../src/repositories/register.repository', () => jest.fn());

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const RegisterModel = require('../../../src/models/register.model');
const RegisterRepository = require('../../../src/repositories/register.repository');
const RegisterService = require('../../../src/services/register.service');
const { SUCCESS_MESSAGES } = require('../../../src/constants/registers.constants');

// ─── Repo method factory ──────────────────────────────────────────────────────
function makeRepoMethods(overrides = {}) {
  return {
    getDataChanges: jest.fn(),
    getcashFieldData: jest.fn(),
    registerReportPage: jest.fn(),
    registeropendateFilterPage: jest.fn(),
    userFindStatus: jest.fn(),
    registeraddInsert: jest.fn(),
    registerUpdateList: jest.fn(),
    registerInOutDetail: jest.fn(),
    deleteCashInOut: jest.fn(),
    registercloseUpdate: jest.fn(),
    cashRegisterOpenManualModel: jest.fn(),
    getCashRegisterModel: jest.fn(),
    registerCountedAmount: jest.fn(),
    registerPaymentNoteModel: jest.fn(),
    registerSaleDetailsPage: jest.fn(),
    getRegisterReportDetailsPage: jest.fn(),
    registerDenomsubmitModel: jest.fn(),
    editCashDenominationModel: jest.fn(),
    deleteCashDenominationModel: jest.fn(),
    ...overrides,
  };
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const REGISTER_ID = 'register_id_123';
const USER_ID = 'user_id_123';
const BRANCH_ID = 'branch_id_123';

function makeMockRegister(overrides = {}) {
  return {
    _id: REGISTER_ID,
    register_name: 'Main Register',
    register_status: 'Opened',
    branch_id: BRANCH_ID,
    current_user: 'cashier1',
    current_user_id: USER_ID,
    opening_float: 1000,
    register_opendate: new Date('2026-01-01T09:00:00.000Z'),
    register_closedate: null,
    cashInOutDetail: [],
    ...overrides,
  };
}

function makeReportDetailsResult(overrides = {}) {
  return {
    status: true,
    data: {
      common_details: [{ opening_float: 1000, counted_amount: 2500 }],
      cash_details: [{ cashin_amount: 200, cashout_amount: 100 }],
      sale_details: [
        { payment_mode: 'Cash', sale_total: 1500, return_total: 50, count: 10 },
        { payment_mode: 'Cheque', sale_total: 500, return_total: 0, count: 3 },
        { payment_mode: 'CreditCard', sale_total: 300, return_total: 0, count: 2 },
        { payment_mode: 'Pending', sale_total: 100, return_total: 0, count: 1 },
      ],
    },
    message: 'ok',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterService', () => {
  let service;
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();

    const repoMethods = makeRepoMethods();
    const mockModelInstance = {};

    RegisterModel.mockImplementation(() => mockModelInstance);
    RegisterRepository.mockImplementation(() => repoMethods);

    service = new RegisterService();
    repo = service.repository;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('RegisterService exports a class (not a singleton)', () => {
      expect(typeof RegisterService).toBe('function');
    });

    test('creates a RegisterService instance', () => {
      expect(service).toBeInstanceOf(RegisterService);
    });

    test('instantiates RegisterModel when no model is injected', () => {
      expect(RegisterModel).toHaveBeenCalledTimes(1);
    });

    test('uses injected model instead of creating a new RegisterModel', () => {
      jest.clearAllMocks();
      const injectedModel = { name: 'injected' };
      const s = new RegisterService(injectedModel);
      expect(RegisterModel).not.toHaveBeenCalled();
      expect(s.model).toBe(injectedModel);
    });

    test('passes model (injected or created) to RegisterRepository', () => {
      const callArgs = RegisterRepository.mock.calls[0];
      expect(callArgs[0]).toBeDefined();
    });

    test('exposes service.model and service.repository', () => {
      expect(service.model).toBeDefined();
      expect(service.repository).toBeDefined();
    });

    test('exposes all 20 service methods', () => {
      const methods = [
        'getDataChanges',
        'getcashFieldData',
        'registerReportPage',
        'registeropendateFilterPage',
        'userFindStatus',
        'registeraddInsert',
        'registerUpdateList',
        'registerInOutDetail',
        'deleteCashInOut',
        'registercloseUpdate',
        'cashRegisterOpenManualModel',
        'getCashRegisterModel',
        'registerCountedAmount',
        'registerPaymentNoteModel',
        'registerSaleDetailsPage',
        'getRegisterReportDetailsPage',
        'getRegisterReportPdfDetails',
        'registerDenomsubmitModel',
        'editCashDenominationModel',
        'deleteCashDenominationModel',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Pass-through delegation tests
  // ════════════════════════════════════════════════════════════════════════════
  describe('getDataChanges', () => {
    test('delegates to repository.getDataChanges and returns result', async () => {
      const expected = { status: true, data: [{ _id: '1' }], message: 'ok' };
      repo.getDataChanges.mockResolvedValue(expected);

      const result = await service.getDataChanges('register', '2026-01-01');

      expect(repo.getDataChanges).toHaveBeenCalledWith('register', '2026-01-01');
      expect(result).toEqual(expected);
    });

    test('propagates repository error', async () => {
      repo.getDataChanges.mockRejectedValue(new Error('DB error'));

      await expect(service.getDataChanges('register', '')).rejects.toThrow('DB error');
    });
  });

  describe('getcashFieldData', () => {
    test('delegates to repository.getcashFieldData and returns result', async () => {
      const expected = { status: true, data: [{ denom: 100, count: 5 }], message: 'ok' };
      repo.getcashFieldData.mockResolvedValue(expected);

      const result = await service.getcashFieldData();

      expect(repo.getcashFieldData).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    test('propagates repository error', async () => {
      repo.getcashFieldData.mockRejectedValue(new Error('fetch failed'));

      await expect(service.getcashFieldData()).rejects.toThrow('fetch failed');
    });
  });

  describe('registerReportPage', () => {
    test('delegates to repository.registerReportPage with data and options', async () => {
      const data = { branch_id: BRANCH_ID };
      const options = { page: 1, limit: 10 };
      const expected = { status: true, data: {}, message: 'ok' };
      repo.registerReportPage.mockResolvedValue(expected);

      const result = await service.registerReportPage(data, options);

      expect(repo.registerReportPage).toHaveBeenCalledWith(data, options);
      expect(result).toEqual(expected);
    });
  });

  describe('registeropendateFilterPage', () => {
    test('delegates to repository.registeropendateFilterPage with data', async () => {
      const data = { from: '2026-01-01', to: '2026-01-31' };
      const expected = { status: true, data: [], message: 'ok' };
      repo.registeropendateFilterPage.mockResolvedValue(expected);

      const result = await service.registeropendateFilterPage(data);

      expect(repo.registeropendateFilterPage).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('userFindStatus', () => {
    test('delegates to repository.userFindStatus with data', async () => {
      const data = { user_id: USER_ID };
      const expected = { status: true, data: makeMockRegister(), message: 'ok' };
      repo.userFindStatus.mockResolvedValue(expected);

      const result = await service.userFindStatus(data);

      expect(repo.userFindStatus).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });

    test('returns result when no open register found for user', async () => {
      repo.userFindStatus.mockResolvedValue({ status: false, data: null, message: 'not found' });

      const result = await service.userFindStatus({ user_id: 'nobody' });

      expect(result.status).toBe(false);
    });
  });

  describe('registeraddInsert (open register)', () => {
    test('delegates to repository.registeraddInsert and returns result', async () => {
      const data = { opening_float: 1000, branch_id: BRANCH_ID };
      const expected = { status: true, data: makeMockRegister(), message: 'opened' };
      repo.registeraddInsert.mockResolvedValue(expected);

      const result = await service.registeraddInsert(data);

      expect(repo.registeraddInsert).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });

    test('propagates repository error without swallowing', async () => {
      repo.registeraddInsert.mockRejectedValue(new Error('insert failed'));

      await expect(service.registeraddInsert({})).rejects.toThrow('insert failed');
    });

    test('passes through with opening balance of zero', async () => {
      const data = { opening_float: 0 };
      repo.registeraddInsert.mockResolvedValue({
        status: true,
        data: makeMockRegister({ opening_float: 0 }),
        message: 'ok',
      });

      const result = await service.registeraddInsert(data);

      expect(repo.registeraddInsert).toHaveBeenCalledWith(data);
      expect(result.status).toBe(true);
    });

    test('passes through with decimal opening balance', async () => {
      const data = { opening_float: 1000.5 };
      repo.registeraddInsert.mockResolvedValue({
        status: true,
        data: makeMockRegister({ opening_float: 1000.5 }),
        message: 'ok',
      });

      const result = await service.registeraddInsert(data);

      expect(repo.registeraddInsert).toHaveBeenCalledWith(data);
      expect(result.status).toBe(true);
    });
  });

  describe('registerUpdateList', () => {
    test('delegates to repository.registerUpdateList with data', async () => {
      const data = { _id: REGISTER_ID, payment_note: 'test note' };
      const expected = { status: true, data: {}, message: 'updated' };
      repo.registerUpdateList.mockResolvedValue(expected);

      const result = await service.registerUpdateList(data);

      expect(repo.registerUpdateList).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('registerInOutDetail (cash in/out)', () => {
    test('delegates to repository.registerInOutDetail and returns result', async () => {
      const data = { register_id: REGISTER_ID, type: 'cash_in', amount: 200 };
      const expected = { status: true, data: {}, message: 'ok' };
      repo.registerInOutDetail.mockResolvedValue(expected);

      const result = await service.registerInOutDetail(data);

      expect(repo.registerInOutDetail).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });

    test('passes through cash-out entry', async () => {
      const data = { register_id: REGISTER_ID, type: 'cash_out', amount: 100 };
      repo.registerInOutDetail.mockResolvedValue({ status: true, data: {}, message: 'ok' });

      await service.registerInOutDetail(data);

      expect(repo.registerInOutDetail).toHaveBeenCalledWith(data);
    });

    test('passes through decimal cash amount', async () => {
      const data = { register_id: REGISTER_ID, type: 'cash_in', amount: 50.75 };
      repo.registerInOutDetail.mockResolvedValue({ status: true, data: {}, message: 'ok' });

      await service.registerInOutDetail(data);

      expect(repo.registerInOutDetail).toHaveBeenCalledWith(data);
    });
  });

  describe('deleteCashInOut', () => {
    test('delegates to repository.deleteCashInOut with data', async () => {
      const data = { _id: 'cash_entry_123' };
      const expected = { status: true, data: {}, message: 'deleted' };
      repo.deleteCashInOut.mockResolvedValue(expected);

      const result = await service.deleteCashInOut(data);

      expect(repo.deleteCashInOut).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('registercloseUpdate (close register)', () => {
    test('delegates to repository.registercloseUpdate and returns result', async () => {
      const data = { _id: REGISTER_ID, closing_float: 2500 };
      const expected = {
        status: true,
        data: makeMockRegister({ register_status: 'Closed' }),
        message: 'closed',
      };
      repo.registercloseUpdate.mockResolvedValue(expected);

      const result = await service.registercloseUpdate(data);

      expect(repo.registercloseUpdate).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });

    test('propagates error when repository throws', async () => {
      repo.registercloseUpdate.mockRejectedValue(new Error('close failed'));

      await expect(service.registercloseUpdate({})).rejects.toThrow('close failed');
    });
  });

  describe('cashRegisterOpenManualModel', () => {
    test('delegates to repository.cashRegisterOpenManualModel with id', async () => {
      const expected = { status: true, data: makeMockRegister(), message: 'opened' };
      repo.cashRegisterOpenManualModel.mockResolvedValue(expected);

      const result = await service.cashRegisterOpenManualModel(REGISTER_ID);

      expect(repo.cashRegisterOpenManualModel).toHaveBeenCalledWith(REGISTER_ID);
      expect(result).toEqual(expected);
    });

    test('propagates repository error', async () => {
      repo.cashRegisterOpenManualModel.mockRejectedValue(new Error('manual open failed'));

      await expect(service.cashRegisterOpenManualModel(REGISTER_ID)).rejects.toThrow(
        'manual open failed'
      );
    });
  });

  describe('getCashRegisterModel', () => {
    test('delegates to repository.getCashRegisterModel with id', async () => {
      const expected = { status: true, data: makeMockRegister(), message: 'ok' };
      repo.getCashRegisterModel.mockResolvedValue(expected);

      const result = await service.getCashRegisterModel(REGISTER_ID);

      expect(repo.getCashRegisterModel).toHaveBeenCalledWith(REGISTER_ID);
      expect(result).toEqual(expected);
    });

    test('returns not-found result when repository returns null data', async () => {
      repo.getCashRegisterModel.mockResolvedValue({
        status: false,
        data: null,
        message: 'not found',
      });

      const result = await service.getCashRegisterModel('invalid_id');

      expect(result.status).toBe(false);
    });
  });

  describe('registerCountedAmount', () => {
    test('delegates to repository.registerCountedAmount with data', async () => {
      const data = { _id: REGISTER_ID, counted_amount: 2500 };
      const expected = { status: true, data: {}, message: 'updated' };
      repo.registerCountedAmount.mockResolvedValue(expected);

      const result = await service.registerCountedAmount(data);

      expect(repo.registerCountedAmount).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('registerPaymentNoteModel', () => {
    test('delegates to repository.registerPaymentNoteModel with data', async () => {
      const data = { _id: REGISTER_ID, payment_note: 'End of day notes' };
      const expected = { status: true, data: {}, message: 'ok' };
      repo.registerPaymentNoteModel.mockResolvedValue(expected);

      const result = await service.registerPaymentNoteModel(data);

      expect(repo.registerPaymentNoteModel).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });

    test('passes through notes with special characters', async () => {
      const data = { _id: REGISTER_ID, payment_note: 'Cash < $100 & "tips" — special!' };
      repo.registerPaymentNoteModel.mockResolvedValue({ status: true, data: {}, message: 'ok' });

      await service.registerPaymentNoteModel(data);

      expect(repo.registerPaymentNoteModel).toHaveBeenCalledWith(data);
    });
  });

  describe('registerSaleDetailsPage', () => {
    test('delegates to repository.registerSaleDetailsPage with data and options', async () => {
      const data = { register_id: REGISTER_ID };
      const options = { page: 1, limit: 20 };
      const expected = { status: true, data: [], message: 'ok' };
      repo.registerSaleDetailsPage.mockResolvedValue(expected);

      const result = await service.registerSaleDetailsPage(data, options);

      expect(repo.registerSaleDetailsPage).toHaveBeenCalledWith(data, options);
      expect(result).toEqual(expected);
    });

    test('handles no-sales session gracefully', async () => {
      repo.registerSaleDetailsPage.mockResolvedValue({ status: true, data: [], message: 'ok' });

      const result = await service.registerSaleDetailsPage({ register_id: REGISTER_ID }, {});

      expect(result.data).toEqual([]);
    });
  });

  describe('getRegisterReportDetailsPage', () => {
    test('delegates to repository.getRegisterReportDetailsPage with data', async () => {
      const data = { register_id: REGISTER_ID };
      const expected = { status: true, data: {}, message: 'ok' };
      repo.getRegisterReportDetailsPage.mockResolvedValue(expected);

      const result = await service.getRegisterReportDetailsPage(data);

      expect(repo.getRegisterReportDetailsPage).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('registerDenomsubmitModel', () => {
    test('delegates to repository.registerDenomsubmitModel with data', async () => {
      const data = { denominations: [{ value: 100, count: 5 }] };
      const expected = { status: true, data: {}, message: 'ok' };
      repo.registerDenomsubmitModel.mockResolvedValue(expected);

      const result = await service.registerDenomsubmitModel(data);

      expect(repo.registerDenomsubmitModel).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  describe('editCashDenominationModel', () => {
    test('delegates to repository.editCashDenominationModel with id', async () => {
      const expected = { status: true, data: {}, message: 'ok' };
      repo.editCashDenominationModel.mockResolvedValue(expected);

      const result = await service.editCashDenominationModel(REGISTER_ID);

      expect(repo.editCashDenominationModel).toHaveBeenCalledWith(REGISTER_ID);
      expect(result).toEqual(expected);
    });
  });

  describe('deleteCashDenominationModel', () => {
    test('delegates to repository.deleteCashDenominationModel with data', async () => {
      const data = { _id: 'denom_entry_123' };
      const expected = { status: true, data: {}, message: 'deleted' };
      repo.deleteCashDenominationModel.mockResolvedValue(expected);

      const result = await service.deleteCashDenominationModel(data);

      expect(repo.deleteCashDenominationModel).toHaveBeenCalledWith(data);
      expect(result).toEqual(expected);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getRegisterReportPdfDetails — main logic method
  // ════════════════════════════════════════════════════════════════════════════
  describe('getRegisterReportPdfDetails', () => {
    const INPUT_DATA = { register_id: REGISTER_ID };

    // ── Early-return when upstream fails ─────────────────────────────────────
    test('returns upstream result immediately when status is false', async () => {
      const failResult = { status: false, data: null, message: 'not found' };
      repo.getRegisterReportDetailsPage.mockResolvedValue(failResult);

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result).toEqual(failResult);
    });

    test('returns upstream result immediately when status is not true (string "false")', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: 'false',
        data: {},
        message: 'bad',
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      // status !== true → early return
      expect(result.status).not.toBe(true);
      expect(result.data).toEqual({});
    });

    test('calls repository.getRegisterReportDetailsPage with input data', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(repo.getRegisterReportDetailsPage).toHaveBeenCalledWith(INPUT_DATA);
    });

    // ── Success shape ─────────────────────────────────────────────────────────
    test('returns {status:true, data:{...}, message} on success', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.REGISTER_REPORT_DETAILS_RETRIEVED);
      expect(result.data).toHaveProperty('calculated');
      expect(result.data).toHaveProperty('common_details');
      expect(result.data).toHaveProperty('cash_details');
      expect(result.data).toHaveProperty('sale_details');
    });

    // ── Calculation logic ─────────────────────────────────────────────────────
    test('sums count across all sale_details rows', async () => {
      // counts: 10+3+2+1 = 16
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.count).toBe(16);
    });

    test('sums total (sale_total) across all sale_details rows', async () => {
      // totals: 1500+500+300+100 = 2400
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.total).toBe(2400);
    });

    test('sums refund (return_total) across all sale_details rows', async () => {
      // return_totals: 50+0+0+0 = 50
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.refund).toBe(50);
    });

    test('sums pendingtotal for rows with payment_mode "Pending"', async () => {
      // pending total: 100
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.pendingtotal).toBe(100);
    });

    test('records register_report_cash from Cash payment row', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.register_report_cash).toBe(1500);
    });

    test('records register_report_Cheque from Cheque payment row', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.register_report_Cheque).toBe(500);
    });

    test('records register_report_CreditCard from CreditCard payment row', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.register_report_CreditCard).toBe(300);
    });

    test('computes payment_report = total + refund', async () => {
      // 2400 + 50 = 2450
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.payment_report).toBe(2450);
    });

    test('computes recive_payement = payment_report - pendingtotal', async () => {
      // 2450 - 100 = 2350
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.recive_payement).toBe(2350);
    });

    test('computes total_amount = total - pendingtotal', async () => {
      // 2400 - 100 = 2300
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.total_amount).toBe(2300);
    });

    test('reads opening from common_details.opening_float', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.opening).toBe(1000);
    });

    test('reads cashin from cash_details.cashin_amount', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.cashin).toBe(200);
    });

    test('reads cashout from cash_details.cashout_amount', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.cashout).toBe(100);
    });

    test('computes payment_data = total_amount + opening + cashin', async () => {
      // 2300 + 1000 + 200 = 3500
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.payment_data).toBe(3500);
    });

    test('computes expectedval_data = payment_data - cashout', async () => {
      // 3500 - 100 = 3400
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.expectedval_data).toBe(3400);
    });

    test('computes netsale = recive_payement - refund', async () => {
      // 2350 - 50 = 2300
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.netsale).toBe(2300);
    });

    test('computes difference = counted_amount - total', async () => {
      // counted=2500, total=2400 → difference=100
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.difference).toBe(100);
    });

    test('reads counted_amount from common_details', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue(makeReportDetailsResult());

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.counted_amount).toBe(2500);
    });

    // ── Array vs non-array common_details / cash_details ─────────────────────
    test('handles common_details as a plain object (not array)', async () => {
      const detailsResult = {
        status: true,
        data: {
          common_details: { opening_float: 500, counted_amount: 1000 },
          cash_details: { cashin_amount: 0, cashout_amount: 0 },
          sale_details: [],
        },
      };
      repo.getRegisterReportDetailsPage.mockResolvedValue(detailsResult);

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.data.calculated.opening).toBe(500);
    });

    test('handles cash_details as a plain object (not array)', async () => {
      const detailsResult = {
        status: true,
        data: {
          common_details: { opening_float: 0, counted_amount: 0 },
          cash_details: { cashin_amount: 150, cashout_amount: 75 },
          sale_details: [],
        },
      };
      repo.getRegisterReportDetailsPage.mockResolvedValue(detailsResult);

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.cashin).toBe(150);
      expect(result.data.calculated.cashout).toBe(75);
    });

    test('handles empty common_details array — uses empty object defaults', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: { common_details: [], cash_details: [], sale_details: [] },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.data.calculated.opening).toBe(0);
      expect(result.data.calculated.counted_amount).toBe(0);
    });

    test('handles null common_details — defaults to empty object', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: { common_details: null, cash_details: null, sale_details: [] },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.data.calculated.opening).toBe(0);
    });

    test('handles undefined result.data — returns all zero calculated fields', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({ status: true, data: undefined });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.data.calculated.total).toBe(0);
      expect(result.data.calculated.opening).toBe(0);
    });

    // ── Empty sale_details ────────────────────────────────────────────────────
    test('returns zero totals when sale_details is empty (no sales session)', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 500, counted_amount: 500 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      const c = result.data.calculated;
      expect(c.total).toBe(0);
      expect(c.refund).toBe(0);
      expect(c.count).toBe(0);
      expect(c.pendingtotal).toBe(0);
      expect(c.register_report_cash).toBe(0);
    });

    // ── Missing payment_mode rows ─────────────────────────────────────────────
    test('ignores rows with unknown payment_mode in cash/cheque/card buckets', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 0, counted_amount: 0 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [
            { payment_mode: 'BankTransfer', sale_total: 400, return_total: 0, count: 2 },
          ],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.data.calculated.register_report_cash).toBe(0);
      expect(result.data.calculated.register_report_Cheque).toBe(0);
      expect(result.data.calculated.register_report_CreditCard).toBe(0);
      expect(result.data.calculated.total).toBe(400);
    });

    // ── Missing/null field defaults in sale row ───────────────────────────────
    test('handles sale row with missing return_total/count/sale_total — defaults to 0', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 0, counted_amount: 0 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [{ payment_mode: 'Cash' }],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(result.status).toBe(true);
      expect(result.data.calculated.total).toBe(0);
      expect(result.data.calculated.refund).toBe(0);
    });

    // ── Only Pending sales ────────────────────────────────────────────────────
    test('handles all-pending sales correctly', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 0, counted_amount: 0 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [{ payment_mode: 'Pending', sale_total: 500, return_total: 0, count: 5 }],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      const c = result.data.calculated;
      expect(c.pendingtotal).toBe(500);
      expect(c.total_amount).toBe(0); // 500 - 500 = 0
      expect(c.netsale).toBe(0 - 0); // recive_payement - refund
    });

    // ── Large values ──────────────────────────────────────────────────────────
    test('handles very large sale totals without overflow', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 999999, counted_amount: 5000000 }],
          cash_details: [{ cashin_amount: 100000, cashout_amount: 50000 }],
          sale_details: [
            { payment_mode: 'Cash', sale_total: 4000000, return_total: 0, count: 100 },
          ],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      expect(typeof result.data.calculated.total).toBe('number');
      expect(result.data.calculated.total).toBe(4000000);
    });

    // ── Refund reduces netsale ────────────────────────────────────────────────
    test('netsale accounts for refund correctly', async () => {
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 0, counted_amount: 0 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [{ payment_mode: 'Cash', sale_total: 1000, return_total: 200, count: 8 }],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      const c = result.data.calculated;
      // payment_report   = 1000 + 200 = 1200
      // recive_payement  = 1200 - 0   = 1200
      // netsale          = 1200 - 200 = 1000
      expect(c.netsale).toBe(1000);
    });

    // ── Bug documentation test (= vs +=) ──────────────────────────────────────
    test('NOTE(production-bug): second Cash row overwrites first (= not +=)', async () => {
      // Two Cash rows — second overwrites the first due to assignment (=)
      repo.getRegisterReportDetailsPage.mockResolvedValue({
        status: true,
        data: {
          common_details: [{ opening_float: 0, counted_amount: 0 }],
          cash_details: [{ cashin_amount: 0, cashout_amount: 0 }],
          sale_details: [
            { payment_mode: 'Cash', sale_total: 300, return_total: 0, count: 3 },
            { payment_mode: 'Cash', sale_total: 700, return_total: 0, count: 7 },
          ],
        },
      });

      const result = await service.getRegisterReportPdfDetails(INPUT_DATA);

      // Bug: register_report_cash should be 1000 (accumulated) but is 700 (last value)
      expect(result.data.calculated.register_report_cash).toBe(700);
      // total still accumulates correctly
      expect(result.data.calculated.total).toBe(1000);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Edge cases — null/undefined/empty payloads for pass-through methods
  // ════════════════════════════════════════════════════════════════════════════
  describe('edge cases — null/undefined payloads for pass-through methods', () => {
    test('registeraddInsert with null data passes through to repository', async () => {
      repo.registeraddInsert.mockResolvedValue({ status: false, data: null, message: 'err' });

      await service.registeraddInsert(null);

      expect(repo.registeraddInsert).toHaveBeenCalledWith(null);
    });

    test('registercloseUpdate with undefined data passes through to repository', async () => {
      repo.registercloseUpdate.mockResolvedValue({ status: false, data: null, message: 'err' });

      await service.registercloseUpdate(undefined);

      expect(repo.registercloseUpdate).toHaveBeenCalledWith(undefined);
    });

    test('userFindStatus with empty object passes through to repository', async () => {
      repo.userFindStatus.mockResolvedValue({ status: false, data: null, message: 'err' });

      await service.userFindStatus({});

      expect(repo.userFindStatus).toHaveBeenCalledWith({});
    });

    test('registerInOutDetail with empty payload passes through to repository', async () => {
      repo.registerInOutDetail.mockResolvedValue({ status: true, data: {}, message: 'ok' });

      await service.registerInOutDetail({});

      expect(repo.registerInOutDetail).toHaveBeenCalledWith({});
    });

    test('getDataChanges with undefined "from" passes through to repository', async () => {
      repo.getDataChanges.mockResolvedValue({ status: true, data: [], message: 'ok' });

      await service.getDataChanges('register', undefined);

      expect(repo.getDataChanges).toHaveBeenCalledWith('register', undefined);
    });

    test('getCashRegisterModel with undefined id passes through to repository', async () => {
      repo.getCashRegisterModel.mockResolvedValue({
        status: false,
        data: null,
        message: 'not found',
      });

      await service.getCashRegisterModel(undefined);

      expect(repo.getCashRegisterModel).toHaveBeenCalledWith(undefined);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Return value passthrough — service never wraps/transforms pass-through results
  // ════════════════════════════════════════════════════════════════════════════
  describe('return value passthrough', () => {
    const REPO_METHODS_WITH_SINGLE_ARG = [
      ['getDataChanges', ['register', '2026-01-01'], { status: true, data: {} }],
      ['getcashFieldData', [], { status: true, data: [] }],
      ['registeropendateFilterPage', [{ from: '2026-01-01' }], { status: true, data: [] }],
      ['userFindStatus', [{ user_id: USER_ID }], { status: false, data: null }],
      ['registeraddInsert', [{ opening_float: 100 }], { status: true, data: {} }],
      ['registerUpdateList', [{ _id: REGISTER_ID }], { status: true, data: {} }],
      ['registerInOutDetail', [{ amount: 50 }], { status: true, data: {} }],
      ['deleteCashInOut', [{ _id: 'entry_1' }], { status: true, data: {} }],
      ['registercloseUpdate', [{ _id: REGISTER_ID }], { status: true, data: {} }],
      ['cashRegisterOpenManualModel', [REGISTER_ID], { status: true, data: {} }],
      ['getCashRegisterModel', [REGISTER_ID], { status: true, data: {} }],
      ['registerCountedAmount', [{ counted_amount: 500 }], { status: true, data: {} }],
      ['registerPaymentNoteModel', [{ note: 'text' }], { status: true, data: {} }],
      ['getRegisterReportDetailsPage', [{ register_id: REGISTER_ID }], { status: true, data: {} }],
      ['registerDenomsubmitModel', [{ denoms: [] }], { status: true, data: {} }],
      ['editCashDenominationModel', [REGISTER_ID], { status: true, data: {} }],
      ['deleteCashDenominationModel', [{ _id: 'denom_1' }], { status: true, data: {} }],
    ];

    test.each(REPO_METHODS_WITH_SINGLE_ARG)(
      '%s returns exactly what the repository returns (no wrapping)',
      async (method, args, repoReturn) => {
        repo[method].mockResolvedValue(repoReturn);

        const result = await service[method](...args);

        expect(result).toEqual(repoReturn);
      }
    );
  });
});
