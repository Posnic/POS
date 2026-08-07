'use strict';

/**
 * Unit tests for src/services/settings.service.js
 *
 * File        : src/services/settings.service.js (674 lines, class singleton export)
 * Export type : SINGLETON — `module.exports = new SettingsService()`
 * Base class  : None — does NOT extend base.service.js
 *
 * Dependency  : settingsRepository (singleton, required at module top)
 *               Constructor assigns: this.repository = settingsRepository
 *
 * Methods (38):
 *   setModel(model)                          — sets model on repository
 *   ─── Tax ──────────────────────────────────────────────────────────
 *   getTaxAll(taxGroup)                      — delegates, no guard
 *   getTaxAjaxList(query)                    — delegates, no guard
 *   getTaxGroup()                            — delegates, no guard
 *   addTax(data)                             — delegates, no guard
 *   editTax(data)                            — delegates, no guard
 *   deleteTax(id)                            — ID guard + delegates
 *   addTaxGroup(data)                        — delegates, no guard
 *   editTaxGroup(data)                       — delegates, no guard
 *   deleteTaxGroup(id)                       — ID guard + delegates
 *   ─── Unit ─────────────────────────────────────────────────────────
 *   getUnitAll()                             — delegates, no guard
 *   getUnitAjaxList(query)                   — delegates, no guard
 *   addUnit(data)                            — delegates, no guard
 *   editUnit(data)                           — delegates, no guard
 *   deleteUnit(id)                           — ID guard + delegates
 *   ─── Denomination ─────────────────────────────────────────────────
 *   getDenomAll()                            — delegates, no guard
 *   addDenomForm(data)                       — delegates, no guard
 *   addDenomData(data)                       — delegates, no guard
 *   editDenomForm(data)                      — delegates, no guard
 *   deleteDenom(id)                          — ID guard + delegates
 *   ─── Payment ──────────────────────────────────────────────────────
 *   getPaymentAll()                          — delegates, no guard
 *   addPaymentData(data)                     — delegates, no guard
 *   editPaymentForm(data)                    — delegates, no guard
 *   deletePayment(id)                        — ID guard + delegates
 *   ─── Table Order ──────────────────────────────────────────────────
 *   getTableOrderAll()                       — delegates, no guard
 *   addTableOrderData(data)                  — delegates, no guard
 *   editTableOrderForm(data)                 — delegates, no guard
 *   deleteTableOrder(id)                     — ID guard + delegates
 *   ─── Settings ─────────────────────────────────────────────────────
 *   updateGeneralSetting(data)               — delegates, no guard
 *   updateCommonSettings(data)               — delegates, no guard
 *   updateOfflineSetting(data)               — delegates, no guard
 *   updateWay2SmsSetting(data)               — delegates, no guard
 *   updateTextLocalSmsSetting(data)          — delegates, no guard
 *   changePassword(data)                     — delegates, no guard
 *   updateCustomerSettings(id)              — ID guard + delegates
 *   updateSupplierSettings(id)              — ID guard + delegates
 *   ─── Theme ────────────────────────────────────────────────────────
 *   getThemeSettings()                       — delegates, no guard
 *   updateThemeSettings(data)                — delegates, no guard
 *
 * Mocked dependencies:
 *   settingsRepository — singleton, all 38 methods mocked
 */

// ─── Mock settingsRepository singleton ────────────────────────────────────────

jest.mock('../../../src/repositories/setting.repository', () => ({
  setModel: jest.fn(),
  getTaxAll: jest.fn(),
  getTaxAjaxList: jest.fn(),
  getTaxGroup: jest.fn(),
  addTax: jest.fn(),
  editTax: jest.fn(),
  deleteTax: jest.fn(),
  addTaxGroup: jest.fn(),
  editTaxGroup: jest.fn(),
  deleteTaxGroup: jest.fn(),
  getUnitAll: jest.fn(),
  getUnitAjaxList: jest.fn(),
  addUnit: jest.fn(),
  editUnit: jest.fn(),
  deleteUnit: jest.fn(),
  getDenomAll: jest.fn(),
  addDenomForm: jest.fn(),
  addDenomData: jest.fn(),
  editDenomForm: jest.fn(),
  deleteDenom: jest.fn(),
  getPaymentAll: jest.fn(),
  addPaymentData: jest.fn(),
  editPaymentForm: jest.fn(),
  deletePayment: jest.fn(),
  getTableOrderAll: jest.fn(),
  addTableOrderData: jest.fn(),
  editTableOrderForm: jest.fn(),
  deleteTableOrder: jest.fn(),
  updateGeneralSetting: jest.fn(),
  updateCommonSettings: jest.fn(),
  updateOfflineSetting: jest.fn(),
  updateWay2SmsSetting: jest.fn(),
  updateTextLocalSmsSetting: jest.fn(),
  changePassword: jest.fn(),
  updateCustomerSettings: jest.fn(),
  updateSupplierSettings: jest.fn(),
  getThemeSettings: jest.fn(),
  updateThemeSettings: jest.fn(),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────

const settingsRepository = require('../../../src/repositories/setting.repository');
const settingsService = require('../../../src/services/setting.service');
const { ERROR_MESSAGES } = require('../../../src/constants/settings.constants');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const OK = (data) => ({ status: true, data });
const FAIL = (msg) => ({ status: false, data: null, message: msg });
const FAKE_ID = '64f8f2f4c2b9c0a1e4b12345';

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('SettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── setModel ────────────────────────────────────────────────────────────────

  describe('setModel', () => {
    test('calls repository.setModel with the provided model', () => {
      const fakeModel = { name: 'SettingModel' };
      settingsService.setModel(fakeModel);
      expect(settingsRepository.setModel).toHaveBeenCalledTimes(1);
      expect(settingsRepository.setModel).toHaveBeenCalledWith(fakeModel);
    });
  });

  // ── Tax ─────────────────────────────────────────────────────────────────────

  describe('getTaxAll', () => {
    test('delegates to repository.getTaxAll with taxGroup argument', async () => {
      const mockResult = OK([{ name: 'GST 18%' }]);
      settingsRepository.getTaxAll.mockResolvedValue(mockResult);

      const result = await settingsService.getTaxAll('all');
      expect(settingsRepository.getTaxAll).toHaveBeenCalledWith('all');
      expect(result).toBe(mockResult);
    });

    test('uses default taxGroup "all" when not provided', async () => {
      settingsRepository.getTaxAll.mockResolvedValue(OK([]));
      await settingsService.getTaxAll();
      expect(settingsRepository.getTaxAll).toHaveBeenCalledWith('all');
    });

    test('returns error object with error.message on repository failure', async () => {
      settingsRepository.getTaxAll.mockRejectedValue(new Error('DB timeout'));
      const result = await settingsService.getTaxAll('all');
      expect(result).toEqual(FAIL('DB timeout'));
    });

    test('falls back to TAX_NOT_FOUND when error has no message', async () => {
      settingsRepository.getTaxAll.mockRejectedValue({});
      const result = await settingsService.getTaxAll('all');
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.TAX_NOT_FOUND);
      expect(result.data).toBeNull();
    });
  });

  describe('getTaxAjaxList', () => {
    test('delegates to repository.getTaxAjaxList with query', async () => {
      const mockResult = OK([{ _id: 'id1', name: 'GST' }]);
      settingsRepository.getTaxAjaxList.mockResolvedValue(mockResult);

      const result = await settingsService.getTaxAjaxList('gst');
      expect(settingsRepository.getTaxAjaxList).toHaveBeenCalledWith('gst');
      expect(result).toBe(mockResult);
    });

    test('uses empty string default when query not provided', async () => {
      settingsRepository.getTaxAjaxList.mockResolvedValue(OK([]));
      await settingsService.getTaxAjaxList();
      expect(settingsRepository.getTaxAjaxList).toHaveBeenCalledWith('');
    });

    test('returns error object on repository failure', async () => {
      settingsRepository.getTaxAjaxList.mockRejectedValue(new Error('Network error'));
      const result = await settingsService.getTaxAjaxList('gst');
      expect(result).toEqual(FAIL('Network error'));
    });
  });

  describe('getTaxGroup', () => {
    test('delegates to repository.getTaxGroup', async () => {
      const mockResult = OK([{ group: 'IGST' }]);
      settingsRepository.getTaxGroup.mockResolvedValue(mockResult);

      const result = await settingsService.getTaxGroup();
      expect(settingsRepository.getTaxGroup).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResult);
    });

    test('falls back to TAX_GROUP_NOT_FOUND on error without message', async () => {
      settingsRepository.getTaxGroup.mockRejectedValue({});
      const result = await settingsService.getTaxGroup();
      expect(result.message).toBe(ERROR_MESSAGES.TAX_GROUP_NOT_FOUND);
    });
  });

  describe('addTax', () => {
    test('delegates to repository.addTax with data', async () => {
      const data = { name: 'GST', value: 18 };
      const mockResult = OK({ _id: 'tax1', ...data });
      settingsRepository.addTax.mockResolvedValue(mockResult);

      const result = await settingsService.addTax(data);
      expect(settingsRepository.addTax).toHaveBeenCalledWith(data);
      expect(result).toBe(mockResult);
    });

    test('falls back to TAX_ADD_FAILED on error without message', async () => {
      settingsRepository.addTax.mockRejectedValue({});
      const result = await settingsService.addTax({});
      expect(result.message).toBe(ERROR_MESSAGES.TAX_ADD_FAILED);
    });
  });

  describe('editTax', () => {
    test('delegates to repository.editTax with data', async () => {
      const data = { id: 'tax1', name: 'GST 12%', value: 12 };
      const mockResult = OK(data);
      settingsRepository.editTax.mockResolvedValue(mockResult);

      const result = await settingsService.editTax(data);
      expect(settingsRepository.editTax).toHaveBeenCalledWith(data);
      expect(result).toBe(mockResult);
    });

    test('returns error with TAX_UPDATE_FAILED fallback', async () => {
      settingsRepository.editTax.mockRejectedValue({});
      const result = await settingsService.editTax({ id: 'x' });
      expect(result.message).toBe(ERROR_MESSAGES.TAX_UPDATE_FAILED);
    });
  });

  describe('deleteTax', () => {
    test('returns ID_REQUIRED when id is undefined', async () => {
      const result = await settingsService.deleteTax(undefined);
      expect(result).toEqual(FAIL(ERROR_MESSAGES.ID_REQUIRED));
      expect(settingsRepository.deleteTax).not.toHaveBeenCalled();
    });

    test('returns ID_REQUIRED when id is null', async () => {
      const result = await settingsService.deleteTax(null);
      expect(result.message).toBe(ERROR_MESSAGES.ID_REQUIRED);
    });

    test('returns ID_REQUIRED when id is empty string', async () => {
      const result = await settingsService.deleteTax('');
      expect(result.message).toBe(ERROR_MESSAGES.ID_REQUIRED);
    });

    test('delegates to repository.deleteTax when id is provided', async () => {
      const mockResult = OK({ deletedCount: 1 });
      settingsRepository.deleteTax.mockResolvedValue(mockResult);

      const result = await settingsService.deleteTax(FAKE_ID);
      expect(settingsRepository.deleteTax).toHaveBeenCalledWith(FAKE_ID);
      expect(result).toBe(mockResult);
    });

    test('returns error with TAX_DELETE_FAILED fallback on throw', async () => {
      settingsRepository.deleteTax.mockRejectedValue({});
      const result = await settingsService.deleteTax(FAKE_ID);
      expect(result.message).toBe(ERROR_MESSAGES.TAX_DELETE_FAILED);
    });
  });

  describe('addTaxGroup', () => {
    test('delegates to repository.addTaxGroup', async () => {
      const data = { group_name: 'IGST' };
      const mockResult = OK({ _id: 'tg1', ...data });
      settingsRepository.addTaxGroup.mockResolvedValue(mockResult);

      expect(await settingsService.addTaxGroup(data)).toBe(mockResult);
      expect(settingsRepository.addTaxGroup).toHaveBeenCalledWith(data);
    });

    test('falls back to TAX_ADD_FAILED on error without message', async () => {
      settingsRepository.addTaxGroup.mockRejectedValue({});
      const result = await settingsService.addTaxGroup({});
      expect(result.message).toBe(ERROR_MESSAGES.TAX_ADD_FAILED);
    });
  });

  describe('editTaxGroup', () => {
    test('delegates to repository.editTaxGroup', async () => {
      const data = { id: 'tg1', group_name: 'GST Composite' };
      settingsRepository.editTaxGroup.mockResolvedValue(OK(data));
      await settingsService.editTaxGroup(data);
      expect(settingsRepository.editTaxGroup).toHaveBeenCalledWith(data);
    });

    test('falls back to TAX_UPDATE_FAILED on error without message', async () => {
      settingsRepository.editTaxGroup.mockRejectedValue({});
      const result = await settingsService.editTaxGroup({ id: 'x' });
      expect(result.message).toBe(ERROR_MESSAGES.TAX_UPDATE_FAILED);
    });
  });

  describe('deleteTaxGroup', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.deleteTaxGroup(null)).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect((await settingsService.deleteTaxGroup('')).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deleteTaxGroup).not.toHaveBeenCalled();
    });

    test('delegates to repository.deleteTaxGroup when id provided', async () => {
      settingsRepository.deleteTaxGroup.mockResolvedValue(OK({ deletedCount: 1 }));
      await settingsService.deleteTaxGroup(FAKE_ID);
      expect(settingsRepository.deleteTaxGroup).toHaveBeenCalledWith(FAKE_ID);
    });

    test('falls back to TAX_DELETE_FAILED on throw', async () => {
      settingsRepository.deleteTaxGroup.mockRejectedValue({});
      const result = await settingsService.deleteTaxGroup(FAKE_ID);
      expect(result.message).toBe(ERROR_MESSAGES.TAX_DELETE_FAILED);
    });
  });

  // ── Unit ─────────────────────────────────────────────────────────────────────

  describe('getUnitAll', () => {
    test('delegates to repository.getUnitAll', async () => {
      const mockResult = OK([{ name: 'kg' }]);
      settingsRepository.getUnitAll.mockResolvedValue(mockResult);
      expect(await settingsService.getUnitAll()).toBe(mockResult);
    });

    test('falls back to UNIT_NOT_FOUND on error without message', async () => {
      settingsRepository.getUnitAll.mockRejectedValue({});
      expect((await settingsService.getUnitAll()).message).toBe(ERROR_MESSAGES.UNIT_NOT_FOUND);
    });
  });

  describe('getUnitAjaxList', () => {
    test('delegates to repository.getUnitAjaxList with query', async () => {
      settingsRepository.getUnitAjaxList.mockResolvedValue(OK([]));
      await settingsService.getUnitAjaxList('kg');
      expect(settingsRepository.getUnitAjaxList).toHaveBeenCalledWith('kg');
    });

    test('uses empty string default when query not provided', async () => {
      settingsRepository.getUnitAjaxList.mockResolvedValue(OK([]));
      await settingsService.getUnitAjaxList();
      expect(settingsRepository.getUnitAjaxList).toHaveBeenCalledWith('');
    });

    test('falls back to UNIT_NOT_FOUND on error without message', async () => {
      settingsRepository.getUnitAjaxList.mockRejectedValue({});
      expect((await settingsService.getUnitAjaxList()).message).toBe(ERROR_MESSAGES.UNIT_NOT_FOUND);
    });
  });

  describe('addUnit', () => {
    test('delegates to repository.addUnit', async () => {
      const data = { unit_name: 'litre', unit_value: 'L' };
      settingsRepository.addUnit.mockResolvedValue(OK(data));
      await settingsService.addUnit(data);
      expect(settingsRepository.addUnit).toHaveBeenCalledWith(data);
    });

    test('falls back to UNIT_ADD_FAILED on error without message', async () => {
      settingsRepository.addUnit.mockRejectedValue({});
      expect((await settingsService.addUnit({})).message).toBe(ERROR_MESSAGES.UNIT_ADD_FAILED);
    });
  });

  describe('editUnit', () => {
    test('delegates to repository.editUnit', async () => {
      const data = { id: 'u1', unit_name: 'gram' };
      settingsRepository.editUnit.mockResolvedValue(OK(data));
      await settingsService.editUnit(data);
      expect(settingsRepository.editUnit).toHaveBeenCalledWith(data);
    });

    test('falls back to UNIT_UPDATE_FAILED on error without message', async () => {
      settingsRepository.editUnit.mockRejectedValue({});
      expect((await settingsService.editUnit({})).message).toBe(ERROR_MESSAGES.UNIT_UPDATE_FAILED);
    });
  });

  describe('deleteUnit', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.deleteUnit(null)).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect((await settingsService.deleteUnit('')).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deleteUnit).not.toHaveBeenCalled();
    });

    test('delegates to repository.deleteUnit when id provided', async () => {
      settingsRepository.deleteUnit.mockResolvedValue(OK({ deletedCount: 1 }));
      await settingsService.deleteUnit(FAKE_ID);
      expect(settingsRepository.deleteUnit).toHaveBeenCalledWith(FAKE_ID);
    });

    test('falls back to UNIT_DELETE_FAILED on throw', async () => {
      settingsRepository.deleteUnit.mockRejectedValue({});
      expect((await settingsService.deleteUnit(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.UNIT_DELETE_FAILED
      );
    });
  });

  // ── Denomination ─────────────────────────────────────────────────────────────

  describe('getDenomAll', () => {
    test('delegates to repository.getDenomAll', async () => {
      const mockResult = OK([{ value: 500 }]);
      settingsRepository.getDenomAll.mockResolvedValue(mockResult);
      expect(await settingsService.getDenomAll()).toBe(mockResult);
    });

    test('falls back to DENOM_NOT_FOUND on error without message', async () => {
      settingsRepository.getDenomAll.mockRejectedValue({});
      expect((await settingsService.getDenomAll()).message).toBe(ERROR_MESSAGES.DENOM_NOT_FOUND);
    });
  });

  describe('addDenomForm', () => {
    test('delegates to repository.addDenomForm', async () => {
      const data = { denom_value: '500', denom_type: 'note' };
      settingsRepository.addDenomForm.mockResolvedValue(OK(data));
      await settingsService.addDenomForm(data);
      expect(settingsRepository.addDenomForm).toHaveBeenCalledWith(data);
    });

    test('falls back to DENOM_ADD_FAILED on error without message', async () => {
      settingsRepository.addDenomForm.mockRejectedValue({});
      expect((await settingsService.addDenomForm({})).message).toBe(
        ERROR_MESSAGES.DENOM_ADD_FAILED
      );
    });
  });

  describe('addDenomData', () => {
    test('delegates to repository.addDenomData', async () => {
      const data = { count: 5, denom_id: 'd1' };
      settingsRepository.addDenomData.mockResolvedValue(OK(data));
      await settingsService.addDenomData(data);
      expect(settingsRepository.addDenomData).toHaveBeenCalledWith(data);
    });

    test('falls back to DENOM_ADD_FAILED on error without message', async () => {
      settingsRepository.addDenomData.mockRejectedValue({});
      expect((await settingsService.addDenomData({})).message).toBe(
        ERROR_MESSAGES.DENOM_ADD_FAILED
      );
    });
  });

  describe('editDenomForm', () => {
    test('delegates to repository.editDenomForm', async () => {
      const data = { id: 'd1', denom_value: '200' };
      settingsRepository.editDenomForm.mockResolvedValue(OK(data));
      await settingsService.editDenomForm(data);
      expect(settingsRepository.editDenomForm).toHaveBeenCalledWith(data);
    });

    test('falls back to DENOM_UPDATE_FAILED on error without message', async () => {
      settingsRepository.editDenomForm.mockRejectedValue({});
      expect((await settingsService.editDenomForm({})).message).toBe(
        ERROR_MESSAGES.DENOM_UPDATE_FAILED
      );
    });
  });

  describe('deleteDenom', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.deleteDenom(null)).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect((await settingsService.deleteDenom('')).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deleteDenom).not.toHaveBeenCalled();
    });

    test('delegates to repository.deleteDenom when id provided', async () => {
      settingsRepository.deleteDenom.mockResolvedValue(OK({ deletedCount: 1 }));
      await settingsService.deleteDenom(FAKE_ID);
      expect(settingsRepository.deleteDenom).toHaveBeenCalledWith(FAKE_ID);
    });

    test('falls back to DENOM_DELETE_FAILED on throw', async () => {
      settingsRepository.deleteDenom.mockRejectedValue({});
      expect((await settingsService.deleteDenom(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.DENOM_DELETE_FAILED
      );
    });
  });

  // ── Payment ───────────────────────────────────────────────────────────────────

  describe('getPaymentAll', () => {
    test('delegates to repository.getPaymentAll', async () => {
      const mockResult = OK([{ name: 'Cash' }, { name: 'UPI' }]);
      settingsRepository.getPaymentAll.mockResolvedValue(mockResult);
      expect(await settingsService.getPaymentAll()).toBe(mockResult);
    });

    test('falls back to PAYMENT_NOT_FOUND on error without message', async () => {
      settingsRepository.getPaymentAll.mockRejectedValue({});
      expect((await settingsService.getPaymentAll()).message).toBe(
        ERROR_MESSAGES.PAYMENT_NOT_FOUND
      );
    });
  });

  describe('addPaymentData', () => {
    test('delegates to repository.addPaymentData', async () => {
      const data = { name: 'NEFT', type: 'bank' };
      settingsRepository.addPaymentData.mockResolvedValue(OK(data));
      await settingsService.addPaymentData(data);
      expect(settingsRepository.addPaymentData).toHaveBeenCalledWith(data);
    });

    test('falls back to PAYMENT_ADD_FAILED on error without message', async () => {
      settingsRepository.addPaymentData.mockRejectedValue({});
      expect((await settingsService.addPaymentData({})).message).toBe(
        ERROR_MESSAGES.PAYMENT_ADD_FAILED
      );
    });
  });

  describe('editPaymentForm', () => {
    test('delegates to repository.editPaymentForm', async () => {
      const data = { id: 'pm1', name: 'Cheque' };
      settingsRepository.editPaymentForm.mockResolvedValue(OK(data));
      await settingsService.editPaymentForm(data);
      expect(settingsRepository.editPaymentForm).toHaveBeenCalledWith(data);
    });

    test('falls back to PAYMENT_UPDATE_FAILED on error without message', async () => {
      settingsRepository.editPaymentForm.mockRejectedValue({});
      expect((await settingsService.editPaymentForm({})).message).toBe(
        ERROR_MESSAGES.PAYMENT_UPDATE_FAILED
      );
    });
  });

  describe('deletePayment', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.deletePayment(null)).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect((await settingsService.deletePayment('')).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deletePayment).not.toHaveBeenCalled();
    });

    test('delegates to repository.deletePayment when id provided', async () => {
      settingsRepository.deletePayment.mockResolvedValue(OK({ deletedCount: 1 }));
      await settingsService.deletePayment(FAKE_ID);
      expect(settingsRepository.deletePayment).toHaveBeenCalledWith(FAKE_ID);
    });

    test('falls back to PAYMENT_DELETE_FAILED on throw', async () => {
      settingsRepository.deletePayment.mockRejectedValue({});
      expect((await settingsService.deletePayment(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.PAYMENT_DELETE_FAILED
      );
    });
  });

  // ── Table Order ───────────────────────────────────────────────────────────────

  describe('getTableOrderAll', () => {
    test('delegates to repository.getTableOrderAll', async () => {
      const mockResult = OK([{ table_number: 'T1' }, { table_number: 'T2' }]);
      settingsRepository.getTableOrderAll.mockResolvedValue(mockResult);
      expect(await settingsService.getTableOrderAll()).toBe(mockResult);
    });

    test('falls back to TABLE_ORDER_NOT_FOUND on error without message', async () => {
      settingsRepository.getTableOrderAll.mockRejectedValue({});
      expect((await settingsService.getTableOrderAll()).message).toBe(
        ERROR_MESSAGES.TABLE_ORDER_NOT_FOUND
      );
    });
  });

  describe('addTableOrderData', () => {
    test('delegates to repository.addTableOrderData', async () => {
      const data = { table_number: 'T5', seats: 4 };
      settingsRepository.addTableOrderData.mockResolvedValue(OK(data));
      await settingsService.addTableOrderData(data);
      expect(settingsRepository.addTableOrderData).toHaveBeenCalledWith(data);
    });

    test('falls back to TABLE_ORDER_ADD_FAILED on error without message', async () => {
      settingsRepository.addTableOrderData.mockRejectedValue({});
      expect((await settingsService.addTableOrderData({})).message).toBe(
        ERROR_MESSAGES.TABLE_ORDER_ADD_FAILED
      );
    });
  });

  describe('editTableOrderForm', () => {
    test('delegates to repository.editTableOrderForm', async () => {
      const data = { id: 'to1', table_number: 'T10' };
      settingsRepository.editTableOrderForm.mockResolvedValue(OK(data));
      await settingsService.editTableOrderForm(data);
      expect(settingsRepository.editTableOrderForm).toHaveBeenCalledWith(data);
    });

    test('falls back to TABLE_ORDER_UPDATE_FAILED on error without message', async () => {
      settingsRepository.editTableOrderForm.mockRejectedValue({});
      expect((await settingsService.editTableOrderForm({})).message).toBe(
        ERROR_MESSAGES.TABLE_ORDER_UPDATE_FAILED
      );
    });
  });

  describe('deleteTableOrder', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.deleteTableOrder(null)).message).toBe(
        ERROR_MESSAGES.ID_REQUIRED
      );
      expect((await settingsService.deleteTableOrder('')).message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deleteTableOrder).not.toHaveBeenCalled();
    });

    test('delegates to repository.deleteTableOrder when id provided', async () => {
      settingsRepository.deleteTableOrder.mockResolvedValue(OK({ deletedCount: 1 }));
      await settingsService.deleteTableOrder(FAKE_ID);
      expect(settingsRepository.deleteTableOrder).toHaveBeenCalledWith(FAKE_ID);
    });

    test('falls back to TABLE_ORDER_DELETE_FAILED on throw', async () => {
      settingsRepository.deleteTableOrder.mockRejectedValue({});
      expect((await settingsService.deleteTableOrder(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.TABLE_ORDER_DELETE_FAILED
      );
    });
  });

  // ── Settings Updates ─────────────────────────────────────────────────────────

  describe('updateGeneralSetting', () => {
    test('delegates to repository.updateGeneralSetting', async () => {
      const data = { store_name: 'My Shop', store_email: 'shop@test.com' };
      const mockResult = OK({ updated: true });
      settingsRepository.updateGeneralSetting.mockResolvedValue(mockResult);

      expect(await settingsService.updateGeneralSetting(data)).toBe(mockResult);
      expect(settingsRepository.updateGeneralSetting).toHaveBeenCalledWith(data);
    });

    test('returns error with UPDATE_FAILED fallback on throw', async () => {
      settingsRepository.updateGeneralSetting.mockRejectedValue({});
      expect((await settingsService.updateGeneralSetting({})).message).toBe(
        ERROR_MESSAGES.UPDATE_FAILED
      );
    });
  });

  describe('updateCommonSettings', () => {
    test('delegates to repository.updateCommonSettings', async () => {
      const data = { default_customer: 'Walk-in', currency: 'INR' };
      settingsRepository.updateCommonSettings.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateCommonSettings(data);
      expect(settingsRepository.updateCommonSettings).toHaveBeenCalledWith(data);
    });

    test('returns UPDATE_FAILED fallback on error without message', async () => {
      settingsRepository.updateCommonSettings.mockRejectedValue({});
      expect((await settingsService.updateCommonSettings({})).message).toBe(
        ERROR_MESSAGES.UPDATE_FAILED
      );
    });
  });

  describe('updateOfflineSetting', () => {
    test('delegates to repository.updateOfflineSetting', async () => {
      const data = { offline_mode: true };
      settingsRepository.updateOfflineSetting.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateOfflineSetting(data);
      expect(settingsRepository.updateOfflineSetting).toHaveBeenCalledWith(data);
    });

    test('returns UPDATE_FAILED fallback on error without message', async () => {
      settingsRepository.updateOfflineSetting.mockRejectedValue({});
      expect((await settingsService.updateOfflineSetting({})).message).toBe(
        ERROR_MESSAGES.UPDATE_FAILED
      );
    });
  });

  describe('updateWay2SmsSetting', () => {
    test('delegates to repository.updateWay2SmsSetting', async () => {
      const data = { way2sms_api: 'FAKE_API_KEY_TEST', way2sms_userid: 'testuser' };
      settingsRepository.updateWay2SmsSetting.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateWay2SmsSetting(data);
      expect(settingsRepository.updateWay2SmsSetting).toHaveBeenCalledWith(data);
    });

    test('returns SMS_SEND_FAILED fallback on error without message', async () => {
      settingsRepository.updateWay2SmsSetting.mockRejectedValue({});
      expect((await settingsService.updateWay2SmsSetting({})).message).toBe(
        ERROR_MESSAGES.SMS_SEND_FAILED
      );
    });

    test('returns error.message when repository throws with message', async () => {
      settingsRepository.updateWay2SmsSetting.mockRejectedValue(new Error('API key invalid'));
      const result = await settingsService.updateWay2SmsSetting({});
      expect(result.status).toBe(false);
      expect(result.message).toBe('API key invalid');
    });
  });

  describe('updateTextLocalSmsSetting', () => {
    test('delegates to repository.updateTextLocalSmsSetting', async () => {
      const data = { textlocal_api: 'FAKE_TL_KEY_TEST', textlocal_sender: 'MYSHOP' };
      settingsRepository.updateTextLocalSmsSetting.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateTextLocalSmsSetting(data);
      expect(settingsRepository.updateTextLocalSmsSetting).toHaveBeenCalledWith(data);
    });

    test('returns SMS_SEND_FAILED fallback on error without message', async () => {
      settingsRepository.updateTextLocalSmsSetting.mockRejectedValue({});
      expect((await settingsService.updateTextLocalSmsSetting({})).message).toBe(
        ERROR_MESSAGES.SMS_SEND_FAILED
      );
    });
  });

  // ── Password ─────────────────────────────────────────────────────────────────

  describe('changePassword', () => {
    test('delegates to repository.changePassword', async () => {
      const data = { old_password: 'TEST_FAKE_OLD', new_password: 'TEST_FAKE_NEW' };
      const mockResult = OK({ changed: true });
      settingsRepository.changePassword.mockResolvedValue(mockResult);

      expect(await settingsService.changePassword(data)).toBe(mockResult);
      expect(settingsRepository.changePassword).toHaveBeenCalledWith(data);
    });

    test('returns PASSWORD_CHANGE_FAILED fallback on error without message', async () => {
      settingsRepository.changePassword.mockRejectedValue({});
      expect((await settingsService.changePassword({})).message).toBe(
        ERROR_MESSAGES.PASSWORD_CHANGE_FAILED
      );
    });

    test('returns error.message when repository throws with message', async () => {
      settingsRepository.changePassword.mockRejectedValue(
        new Error(ERROR_MESSAGES.OLD_PASSWORD_INCORRECT)
      );
      const result = await settingsService.changePassword({ old_password: 'wrong' });
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.OLD_PASSWORD_INCORRECT);
    });
  });

  // ── Customer / Supplier Settings ─────────────────────────────────────────────

  describe('updateCustomerSettings', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.updateCustomerSettings(null)).message).toBe(
        ERROR_MESSAGES.ID_REQUIRED
      );
      expect((await settingsService.updateCustomerSettings('')).message).toBe(
        ERROR_MESSAGES.ID_REQUIRED
      );
      expect(settingsRepository.updateCustomerSettings).not.toHaveBeenCalled();
    });

    test('delegates to repository.updateCustomerSettings when id provided', async () => {
      settingsRepository.updateCustomerSettings.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateCustomerSettings(FAKE_ID);
      expect(settingsRepository.updateCustomerSettings).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns CUSTOMER_SETTINGS_FAILED fallback on throw', async () => {
      settingsRepository.updateCustomerSettings.mockRejectedValue({});
      expect((await settingsService.updateCustomerSettings(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.CUSTOMER_SETTINGS_FAILED
      );
    });
  });

  describe('updateSupplierSettings', () => {
    test('returns ID_REQUIRED when id is falsy', async () => {
      expect((await settingsService.updateSupplierSettings(null)).message).toBe(
        ERROR_MESSAGES.ID_REQUIRED
      );
      expect((await settingsService.updateSupplierSettings('')).message).toBe(
        ERROR_MESSAGES.ID_REQUIRED
      );
      expect(settingsRepository.updateSupplierSettings).not.toHaveBeenCalled();
    });

    test('delegates to repository.updateSupplierSettings when id provided', async () => {
      settingsRepository.updateSupplierSettings.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateSupplierSettings(FAKE_ID);
      expect(settingsRepository.updateSupplierSettings).toHaveBeenCalledWith(FAKE_ID);
    });

    test('returns SUPPLIER_SETTINGS_FAILED fallback on throw', async () => {
      settingsRepository.updateSupplierSettings.mockRejectedValue({});
      expect((await settingsService.updateSupplierSettings(FAKE_ID)).message).toBe(
        ERROR_MESSAGES.SUPPLIER_SETTINGS_FAILED
      );
    });
  });

  // ── Theme ─────────────────────────────────────────────────────────────────────

  describe('getThemeSettings', () => {
    test('delegates to repository.getThemeSettings', async () => {
      const mockResult = OK({ primary_color: '#FF5722', font: 'Roboto' });
      settingsRepository.getThemeSettings.mockResolvedValue(mockResult);
      expect(await settingsService.getThemeSettings()).toBe(mockResult);
      expect(settingsRepository.getThemeSettings).toHaveBeenCalledTimes(1);
    });

    test('returns error with THEME_NOT_FOUND fallback on error without message', async () => {
      settingsRepository.getThemeSettings.mockRejectedValue({});
      const result = await settingsService.getThemeSettings();
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.THEME_NOT_FOUND);
      expect(result.data).toBeNull();
    });

    test('returns error.message on error with message', async () => {
      settingsRepository.getThemeSettings.mockRejectedValue(new Error('Collection missing'));
      const result = await settingsService.getThemeSettings();
      expect(result.message).toBe('Collection missing');
    });
  });

  describe('updateThemeSettings', () => {
    test('delegates to repository.updateThemeSettings', async () => {
      const data = { primary_color: '#2196F3', logo_url: '/images/logo.png' };
      const mockResult = OK({ updated: true });
      settingsRepository.updateThemeSettings.mockResolvedValue(mockResult);

      expect(await settingsService.updateThemeSettings(data)).toBe(mockResult);
      expect(settingsRepository.updateThemeSettings).toHaveBeenCalledWith(data);
    });

    test('returns THEME_SETTINGS_FAILED fallback on error without message', async () => {
      settingsRepository.updateThemeSettings.mockRejectedValue({});
      const result = await settingsService.updateThemeSettings({});
      expect(result.message).toBe(ERROR_MESSAGES.THEME_SETTINGS_FAILED);
    });
  });

  // ── Shared error-handling pattern ─────────────────────────────────────────────

  describe('error-handling pattern (all methods)', () => {
    test.each([
      ['getTaxAll', () => settingsService.getTaxAll('all'), ERROR_MESSAGES.TAX_NOT_FOUND],
      ['getTaxAjaxList', () => settingsService.getTaxAjaxList('x'), ERROR_MESSAGES.TAX_NOT_FOUND],
      ['getTaxGroup', () => settingsService.getTaxGroup(), ERROR_MESSAGES.TAX_GROUP_NOT_FOUND],
      ['addTax', () => settingsService.addTax({}), ERROR_MESSAGES.TAX_ADD_FAILED],
      ['editTax', () => settingsService.editTax({}), ERROR_MESSAGES.TAX_UPDATE_FAILED],
      ['addTaxGroup', () => settingsService.addTaxGroup({}), ERROR_MESSAGES.TAX_ADD_FAILED],
      ['editTaxGroup', () => settingsService.editTaxGroup({}), ERROR_MESSAGES.TAX_UPDATE_FAILED],
      ['getUnitAll', () => settingsService.getUnitAll(), ERROR_MESSAGES.UNIT_NOT_FOUND],
      ['getUnitAjaxList', () => settingsService.getUnitAjaxList(), ERROR_MESSAGES.UNIT_NOT_FOUND],
      ['addUnit', () => settingsService.addUnit({}), ERROR_MESSAGES.UNIT_ADD_FAILED],
      ['editUnit', () => settingsService.editUnit({}), ERROR_MESSAGES.UNIT_UPDATE_FAILED],
      ['getDenomAll', () => settingsService.getDenomAll(), ERROR_MESSAGES.DENOM_NOT_FOUND],
      ['addDenomForm', () => settingsService.addDenomForm({}), ERROR_MESSAGES.DENOM_ADD_FAILED],
      ['addDenomData', () => settingsService.addDenomData({}), ERROR_MESSAGES.DENOM_ADD_FAILED],
      [
        'editDenomForm',
        () => settingsService.editDenomForm({}),
        ERROR_MESSAGES.DENOM_UPDATE_FAILED,
      ],
      ['getPaymentAll', () => settingsService.getPaymentAll(), ERROR_MESSAGES.PAYMENT_NOT_FOUND],
      [
        'addPaymentData',
        () => settingsService.addPaymentData({}),
        ERROR_MESSAGES.PAYMENT_ADD_FAILED,
      ],
      [
        'editPaymentForm',
        () => settingsService.editPaymentForm({}),
        ERROR_MESSAGES.PAYMENT_UPDATE_FAILED,
      ],
      [
        'getTableOrderAll',
        () => settingsService.getTableOrderAll(),
        ERROR_MESSAGES.TABLE_ORDER_NOT_FOUND,
      ],
      [
        'addTableOrderData',
        () => settingsService.addTableOrderData({}),
        ERROR_MESSAGES.TABLE_ORDER_ADD_FAILED,
      ],
      [
        'editTableOrderForm',
        () => settingsService.editTableOrderForm({}),
        ERROR_MESSAGES.TABLE_ORDER_UPDATE_FAILED,
      ],
      [
        'updateGeneralSetting',
        () => settingsService.updateGeneralSetting({}),
        ERROR_MESSAGES.UPDATE_FAILED,
      ],
      [
        'updateCommonSettings',
        () => settingsService.updateCommonSettings({}),
        ERROR_MESSAGES.UPDATE_FAILED,
      ],
      [
        'updateOfflineSetting',
        () => settingsService.updateOfflineSetting({}),
        ERROR_MESSAGES.UPDATE_FAILED,
      ],
      [
        'updateWay2SmsSetting',
        () => settingsService.updateWay2SmsSetting({}),
        ERROR_MESSAGES.SMS_SEND_FAILED,
      ],
      [
        'updateTextLocalSmsSetting',
        () => settingsService.updateTextLocalSmsSetting({}),
        ERROR_MESSAGES.SMS_SEND_FAILED,
      ],
      [
        'changePassword',
        () => settingsService.changePassword({}),
        ERROR_MESSAGES.PASSWORD_CHANGE_FAILED,
      ],
      [
        'getThemeSettings',
        () => settingsService.getThemeSettings(),
        ERROR_MESSAGES.THEME_NOT_FOUND,
      ],
      [
        'updateThemeSettings',
        () => settingsService.updateThemeSettings({}),
        ERROR_MESSAGES.THEME_SETTINGS_FAILED,
      ],
    ])(
      '%s returns { status:false, data:null, fallback message } when repo throws without message',
      async (name, invoke, fallback) => {
        const repoMethod = Object.keys(settingsRepository).find(
          (k) => settingsRepository[k].mockRejectedValue
        );
        // Clear prior mocks; the specific repo mock is already reset by beforeEach
        jest.clearAllMocks();

        // Make ALL repository methods reject with an empty error (no .message)
        Object.keys(settingsRepository).forEach((k) => {
          if (typeof settingsRepository[k].mockRejectedValue === 'function') {
            settingsRepository[k].mockRejectedValue({});
          }
        });

        const result = await invoke();
        expect(result.status).toBe(false);
        expect(result.data).toBeNull();
        expect(result.message).toBe(fallback);
      }
    );
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('repository returns result with status:false — service passes it through', async () => {
      const repoResult = { status: false, message: 'Not found', data: null };
      settingsRepository.getTaxAll.mockResolvedValue(repoResult);
      const result = await settingsService.getTaxAll('all');
      expect(result).toBe(repoResult);
    });

    test('repository returns result with empty array — service passes it through', async () => {
      const repoResult = { status: true, data: [] };
      settingsRepository.getUnitAll.mockResolvedValue(repoResult);
      const result = await settingsService.getUnitAll();
      expect(result).toBe(repoResult);
    });

    test('repository returns null — service passes null through', async () => {
      settingsRepository.getThemeSettings.mockResolvedValue(null);
      expect(await settingsService.getThemeSettings()).toBeNull();
    });

    test('updateGeneralSetting with empty payload delegates without guard', async () => {
      settingsRepository.updateGeneralSetting.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateGeneralSetting({});
      expect(settingsRepository.updateGeneralSetting).toHaveBeenCalledWith({});
    });

    test('updateCommonSettings with boolean-false values delegates unchanged', async () => {
      const data = { stock_management: false, round_off: false, sales_sms: false };
      settingsRepository.updateCommonSettings.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateCommonSettings(data);
      expect(settingsRepository.updateCommonSettings).toHaveBeenCalledWith(data);
    });

    test('updateCommonSettings with numeric-zero values delegates unchanged', async () => {
      const data = { tax_percentage: 0, discount: 0 };
      settingsRepository.updateCommonSettings.mockResolvedValue(OK({ updated: true }));
      await settingsService.updateCommonSettings(data);
      expect(settingsRepository.updateCommonSettings).toHaveBeenCalledWith(data);
    });

    test('deleteTax with numeric 0 treated as falsy — returns ID_REQUIRED', async () => {
      const result = await settingsService.deleteTax(0);
      expect(result.message).toBe(ERROR_MESSAGES.ID_REQUIRED);
      expect(settingsRepository.deleteTax).not.toHaveBeenCalled();
    });

    test('updateCustomerSettings with false treated as falsy — returns ID_REQUIRED', async () => {
      const result = await settingsService.updateCustomerSettings(false);
      expect(result.message).toBe(ERROR_MESSAGES.ID_REQUIRED);
    });

    test('error.message is used over fallback when provided', async () => {
      const customMsg = 'Custom DB error message';
      settingsRepository.editTax.mockRejectedValue(new Error(customMsg));
      const result = await settingsService.editTax({ id: 'x' });
      expect(result.status).toBe(false);
      expect(result.message).toBe(customMsg);
    });

    test('all catch paths return data: null', async () => {
      const methods = [
        () => settingsService.getTaxAll(),
        () => settingsService.getUnitAll(),
        () => settingsService.getDenomAll(),
        () => settingsService.getPaymentAll(),
        () => settingsService.getTableOrderAll(),
        () => settingsService.getThemeSettings(),
      ];

      for (const invoke of methods) {
        jest.clearAllMocks();
        Object.keys(settingsRepository).forEach((k) => {
          if (typeof settingsRepository[k].mockRejectedValue === 'function') {
            settingsRepository[k].mockRejectedValue(new Error('fail'));
          }
        });
        const result = await invoke();
        expect(result.data).toBeNull();
      }
    });
  });
});
