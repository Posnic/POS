'use strict';

/**
 * Unit tests for src/repositories/settings.repository.js
 * SINGLETON export — module.exports = new SettingsRepository()
 * 442 lines, 57+ methods, pure delegation to injected settingModel
 */

const settingsRepository = require('../../../src/repositories/setting.repository');

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';

// ══════════════════════════════════════════════════════════════════════════════
describe('SettingsRepository', () => {
  let mockModel;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock model with all methods that the repository delegates to
    const modelMethods = [
      'getTaxAllModel',
      'getTaxAjaxListModel',
      'getTaxGroupModel',
      'addTaxModel',
      'editTaxModel',
      'deleteTaxModel',
      'addTaxGroupModel',
      'editTaxGroupModel',
      'deleteTaxGroupModel',
      'getUnitAllModel',
      'getUnitAjaxListModel',
      'addUnitModel',
      'editUnitModel',
      'deleteUnitModel',
      'getDenomAllModel',
      'addDenomModel',
      'addDenomDataModel',
      'editDenomFiledModel',
      'deleteDenomFiledModel',
      'getPaymentAllModel',
      'addPaymentModel',
      'editPaymentFiledModel',
      'deletePaymentFiledModel',
      'getTableOrderAllModel',
      'addTableOrderModel',
      'editTableOrderFiledModel',
      'deleteTableOrderFiledModel',
      'editGeneralSetting',
      'updateCommonSettings',
            'updateWay2SmsSetting',
      'updateTextLocalSmsSetting',
      'updateBranchLogoModel',
      'updateKioskImagesModel',
      'storedImageDataModel',
      'branchImageDeleteModel',
      'updateCommonCustomerSettings',
      'updateCommonSupplierSettings',
      'changePasswordModel',
      'salesSmsReceiptModel',
      'paymentKeyModel',
      'phonepePaymentKeyModel',
      'deleteCollectionModel',
      'deleteAllSelectedCollectionModel',
      'restoreBackupModel',
      'getDasboardSalesCountModel',
      'getRecycleBinModel',
      'autoSuggestionRecycleBinTableFieldModel',
      'getAllCollectionTotalModel',
      'emailSettingModel',
      'kioskAccountSettingsModel',
      'kioskPrinterSettingsModel',
      'kioskPaymentModel',
      'kioskupdateInfoModel',
      'getThemeSettings',
      'editThemeSettings',
      'getDefaultCustomerModel',
      'getDefaultSupplierModel',
      'getDefaultCustomerSupplierModel',
      'backupTableModel',
    ];

    mockModel = {};
    modelMethods.forEach((method) => {
      mockModel[method] = jest.fn().mockResolvedValue({ status: true, data: null });
    });

    settingsRepository.setModel(mockModel);
  });

  // ── setModel ────────────────────────────────────────────────────────────────

  describe('setModel', () => {
    test('injects the model instance', () => {
      expect(settingsRepository.settingModel).toBe(mockModel);
    });
  });

  // ── Tax ─────────────────────────────────────────────────────────────────────

  describe('Tax methods', () => {
    test('getTaxAll delegates to model.getTaxAllModel', async () => {
      mockModel.getTaxAllModel.mockResolvedValue({ status: true, data: [] });
      const r = await settingsRepository.getTaxAll('all');
      expect(mockModel.getTaxAllModel).toHaveBeenCalledWith('all');
      expect(r).toEqual({ status: true, data: [] });
    });

    test('getTaxAll uses default "all" when no arg', async () => {
      await settingsRepository.getTaxAll();
      expect(mockModel.getTaxAllModel).toHaveBeenCalledWith('all');
    });

    test('getTaxAjaxList delegates to model.getTaxAjaxListModel', async () => {
      await settingsRepository.getTaxAjaxList('gst');
      expect(mockModel.getTaxAjaxListModel).toHaveBeenCalledWith('gst');
    });

    test('getTaxGroup delegates to model.getTaxGroupModel', async () => {
      await settingsRepository.getTaxGroup();
      expect(mockModel.getTaxGroupModel).toHaveBeenCalledTimes(1);
    });

    test('addTax delegates to model.addTaxModel', async () => {
      const data = { name: 'GST', value: 18 };
      await settingsRepository.addTax(data);
      expect(mockModel.addTaxModel).toHaveBeenCalledWith(data);
    });

    test('editTax delegates to model.editTaxModel', async () => {
      const data = { id: FAKE_ID, name: 'Updated' };
      await settingsRepository.editTax(data);
      expect(mockModel.editTaxModel).toHaveBeenCalledWith(data);
    });

    test('deleteTax delegates to model.deleteTaxModel', async () => {
      await settingsRepository.deleteTax(FAKE_ID);
      expect(mockModel.deleteTaxModel).toHaveBeenCalledWith(FAKE_ID);
    });

    test('addTaxGroup delegates to model.addTaxGroupModel', async () => {
      const data = { name: 'Group A' };
      await settingsRepository.addTaxGroup(data);
      expect(mockModel.addTaxGroupModel).toHaveBeenCalledWith(data);
    });

    test('editTaxGroup delegates to model.editTaxGroupModel', async () => {
      const data = { id: FAKE_ID };
      await settingsRepository.editTaxGroup(data);
      expect(mockModel.editTaxGroupModel).toHaveBeenCalledWith(data);
    });

    test('deleteTaxGroup delegates to model.deleteTaxGroupModel', async () => {
      await settingsRepository.deleteTaxGroup(FAKE_ID);
      expect(mockModel.deleteTaxGroupModel).toHaveBeenCalledWith(FAKE_ID);
    });
  });

  // ── Unit ─────────────────────────────────────────────────────────────────────

  describe('Unit methods', () => {
    test('getUnitAll delegates to model.getUnitAllModel', async () => {
      await settingsRepository.getUnitAll();
      expect(mockModel.getUnitAllModel).toHaveBeenCalledTimes(1);
    });

    test('getUnitAjaxList delegates to model.getUnitAjaxListModel', async () => {
      await settingsRepository.getUnitAjaxList('kg');
      expect(mockModel.getUnitAjaxListModel).toHaveBeenCalledWith('kg');
    });

    test('addUnit delegates to model.addUnitModel', async () => {
      const data = { name: 'kg' };
      await settingsRepository.addUnit(data);
      expect(mockModel.addUnitModel).toHaveBeenCalledWith(data);
    });

    test('editUnit delegates to model.editUnitModel', async () => {
      const data = { id: FAKE_ID };
      await settingsRepository.editUnit(data);
      expect(mockModel.editUnitModel).toHaveBeenCalledWith(data);
    });

    test('deleteUnit delegates to model.deleteUnitModel', async () => {
      await settingsRepository.deleteUnit(FAKE_ID);
      expect(mockModel.deleteUnitModel).toHaveBeenCalledWith(FAKE_ID);
    });
  });

  // ── Denomination ────────────────────────────────────────────────────────────

  describe('Denomination methods', () => {
    test('getDenomAll delegates to model.getDenomAllModel', async () => {
      await settingsRepository.getDenomAll();
      expect(mockModel.getDenomAllModel).toHaveBeenCalledTimes(1);
    });

    test('addDenomForm delegates to model.addDenomModel', async () => {
      const data = { value: 10 };
      await settingsRepository.addDenomForm(data);
      expect(mockModel.addDenomModel).toHaveBeenCalledWith(data);
    });

    test('addDenomData delegates to model.addDenomDataModel', async () => {
      const data = { value: 20 };
      await settingsRepository.addDenomData(data);
      expect(mockModel.addDenomDataModel).toHaveBeenCalledWith(data);
    });

    test('editDenomForm delegates to model.editDenomFiledModel', async () => {
      const data = { id: FAKE_ID };
      await settingsRepository.editDenomForm(data);
      expect(mockModel.editDenomFiledModel).toHaveBeenCalledWith(data);
    });

    test('deleteDenom delegates to model.deleteDenomFiledModel', async () => {
      await settingsRepository.deleteDenom(FAKE_ID);
      expect(mockModel.deleteDenomFiledModel).toHaveBeenCalledWith(FAKE_ID);
    });
  });

  // ── Payment ──────────────────────────────────────────────────────────────────

  describe('Payment methods', () => {
    test('getPaymentAll delegates to model.getPaymentAllModel', async () => {
      await settingsRepository.getPaymentAll();
      expect(mockModel.getPaymentAllModel).toHaveBeenCalledTimes(1);
    });

    test('addPaymentData delegates to model.addPaymentModel', async () => {
      const data = { name: 'Cash' };
      await settingsRepository.addPaymentData(data);
      expect(mockModel.addPaymentModel).toHaveBeenCalledWith(data);
    });

    test('editPaymentForm delegates to model.editPaymentFiledModel', async () => {
      const data = { id: FAKE_ID };
      await settingsRepository.editPaymentForm(data);
      expect(mockModel.editPaymentFiledModel).toHaveBeenCalledWith(data);
    });

    test('deletePayment delegates to model.deletePaymentFiledModel', async () => {
      await settingsRepository.deletePayment(FAKE_ID);
      expect(mockModel.deletePaymentFiledModel).toHaveBeenCalledWith(FAKE_ID);
    });
  });

  // ── Table Order ──────────────────────────────────────────────────────────────

  describe('Table Order methods', () => {
    test('getTableOrderAll delegates to model.getTableOrderAllModel', async () => {
      await settingsRepository.getTableOrderAll();
      expect(mockModel.getTableOrderAllModel).toHaveBeenCalledTimes(1);
    });

    test('addTableOrderData delegates to model.addTableOrderModel', async () => {
      const data = { name: 'Table 1' };
      await settingsRepository.addTableOrderData(data);
      expect(mockModel.addTableOrderModel).toHaveBeenCalledWith(data);
    });

    test('editTableOrderForm delegates to model.editTableOrderFiledModel', async () => {
      const data = { id: FAKE_ID };
      await settingsRepository.editTableOrderForm(data);
      expect(mockModel.editTableOrderFiledModel).toHaveBeenCalledWith(data);
    });

    test('deleteTableOrder delegates to model.deleteTableOrderFiledModel', async () => {
      await settingsRepository.deleteTableOrder(FAKE_ID);
      expect(mockModel.deleteTableOrderFiledModel).toHaveBeenCalledWith(FAKE_ID);
    });
  });

  // ── General / Common Settings ────────────────────────────────────────────────

  describe('Settings update methods', () => {
    test('updateGeneralSetting delegates to model.editGeneralSetting', async () => {
      const data = { store_name: 'Test Store' };
      await settingsRepository.updateGeneralSetting(data);
      expect(mockModel.editGeneralSetting).toHaveBeenCalledWith(data);
    });

    test('updateCommonSettings delegates to model.updateCommonSettings', async () => {
      const data = { currency: 'INR' };
      await settingsRepository.updateCommonSettings(data);
      expect(mockModel.updateCommonSettings).toHaveBeenCalledWith(data);
    });


    test('updateWay2SmsSetting delegates to model.updateWay2SmsSetting', async () => {
      const data = { api_key: 'key' };
      await settingsRepository.updateWay2SmsSetting(data);
      expect(mockModel.updateWay2SmsSetting).toHaveBeenCalledWith(data);
    });

    test('updateTextLocalSmsSetting delegates to model.updateTextLocalSmsSetting', async () => {
      const data = { sender: 'TEST' };
      await settingsRepository.updateTextLocalSmsSetting(data);
      expect(mockModel.updateTextLocalSmsSetting).toHaveBeenCalledWith(data);
    });
  });

  // ── File / Image ─────────────────────────────────────────────────────────────

  describe('File/Image methods', () => {
    test('updateBranchLogo delegates to model.updateBranchLogoModel', async () => {
      const file = { name: 'logo.png' };
      const branchId = FAKE_ID;
      await settingsRepository.updateBranchLogo(file, branchId);
      expect(mockModel.updateBranchLogoModel).toHaveBeenCalledWith(file, branchId);
    });

    test('updateKioskImages delegates to model.updateKioskImagesModel', async () => {
      const files = [{ name: 'img1.png' }];
      const branchId = FAKE_ID;
      await settingsRepository.updateKioskImages(files, branchId);
      expect(mockModel.updateKioskImagesModel).toHaveBeenCalledWith(files, branchId);
    });

    test('storedImageData delegates to model.storedImageDataModel', async () => {
      const data = { image: 'base64' };
      await settingsRepository.storedImageData(data);
      expect(mockModel.storedImageDataModel).toHaveBeenCalledWith(data);
    });

    test('branchImageDelete delegates to model.branchImageDeleteModel', async () => {
      await settingsRepository.branchImageDelete('logo.png');
      expect(mockModel.branchImageDeleteModel).toHaveBeenCalledWith('logo.png');
    });
  });

  // ── Customer / Supplier ──────────────────────────────────────────────────────

  describe('Customer/Supplier settings', () => {
    test('updateCustomerSettings delegates to model.updateCommonCustomerSettings', async () => {
      await settingsRepository.updateCustomerSettings(FAKE_ID);
      expect(mockModel.updateCommonCustomerSettings).toHaveBeenCalledWith(FAKE_ID);
    });

    test('updateSupplierSettings delegates to model.updateCommonSupplierSettings', async () => {
      await settingsRepository.updateSupplierSettings(FAKE_ID);
      expect(mockModel.updateCommonSupplierSettings).toHaveBeenCalledWith(FAKE_ID);
    });

    test('getDefaultCustomer delegates to model.getDefaultCustomerModel', async () => {
      await settingsRepository.getDefaultCustomer(FAKE_ID);
      expect(mockModel.getDefaultCustomerModel).toHaveBeenCalledWith(FAKE_ID);
    });

    test('getDefaultSupplier delegates to model.getDefaultSupplierModel', async () => {
      await settingsRepository.getDefaultSupplier(FAKE_ID);
      expect(mockModel.getDefaultSupplierModel).toHaveBeenCalledWith(FAKE_ID);
    });

    test('getDefaultCustomerSupplier delegates to model.getDefaultCustomerSupplierModel', async () => {
      const customerId = 'cust1';
      const supplierId = 'supp1';
      await settingsRepository.getDefaultCustomerSupplier(customerId, supplierId);
      expect(mockModel.getDefaultCustomerSupplierModel).toHaveBeenCalledWith(
        customerId,
        supplierId
      );
    });
  });

  // ── Password / SMS ─────────────────────────────────────────────────────────

  describe('Password and SMS methods', () => {
    test('changePassword delegates to model.changePasswordModel', async () => {
      const data = { old: 'old', new: 'new' };
      await settingsRepository.changePassword(data);
      expect(mockModel.changePasswordModel).toHaveBeenCalledWith(data);
    });

    test('salesSmsReceipt delegates to model.salesSmsReceiptModel', async () => {
      const data = { sale_id: FAKE_ID };
      await settingsRepository.salesSmsReceipt(data);
      expect(mockModel.salesSmsReceiptModel).toHaveBeenCalledWith(data);
    });
  });

  // ── Payment Keys ─────────────────────────────────────────────────────────────

  describe('Payment key methods', () => {
    test('paymentsKey delegates to model.paymentKeyModel', async () => {
      const data = { key: 'secret' };
      await settingsRepository.paymentsKey(data);
      expect(mockModel.paymentKeyModel).toHaveBeenCalledWith(data);
    });

    test('phonepepaymentsKey delegates to model.phonepePaymentKeyModel', async () => {
      const data = { key: 'phonepe' };
      await settingsRepository.phonepepaymentsKey(data);
      expect(mockModel.phonepePaymentKeyModel).toHaveBeenCalledWith(data);
    });
  });

  // ── Collection / Backup / Recycle Bin ────────────────────────────────────────

  describe('Collection and backup methods', () => {
    test('deleteCollection delegates to model.deleteCollectionModel', async () => {
      await settingsRepository.deleteCollection('sales');
      expect(mockModel.deleteCollectionModel).toHaveBeenCalledWith('sales');
    });

    test('deleteAllSelectedCollection delegates to model.deleteAllSelectedCollectionModel', async () => {
      const data = { collections: ['sales', 'items'] };
      await settingsRepository.deleteAllSelectedCollection(data);
      expect(mockModel.deleteAllSelectedCollectionModel).toHaveBeenCalledWith(data);
    });

    test('restoreBackup delegates to model.restoreBackupModel', async () => {
      const data = { file: 'backup.zip' };
      await settingsRepository.restoreBackup(data);
      expect(mockModel.restoreBackupModel).toHaveBeenCalledWith(data);
    });

    test('getDasboardSalesCount delegates to model.getDasboardSalesCountModel', async () => {
      await settingsRepository.getDasboardSalesCount();
      expect(mockModel.getDasboardSalesCountModel).toHaveBeenCalledTimes(1);
    });

    test('getRecycleBin delegates to model.getRecycleBinModel', async () => {
      await settingsRepository.getRecycleBin(10, 1, {}, {});
      expect(mockModel.getRecycleBinModel).toHaveBeenCalledWith(10, 1, {}, {});
    });

    test('autoSuggestionRecycleBinTableField delegates to model.autoSuggestionRecycleBinTableFieldModel', async () => {
      await settingsRepository.autoSuggestionRecycleBinTableField('sa');
      expect(mockModel.autoSuggestionRecycleBinTableFieldModel).toHaveBeenCalledWith('sa');
    });

    test('getAllCollectionTotal delegates to model.getAllCollectionTotalModel', async () => {
      await settingsRepository.getAllCollectionTotal();
      expect(mockModel.getAllCollectionTotalModel).toHaveBeenCalledTimes(1);
    });

    test('backupTable delegates to model.backupTableModel', async () => {
      await settingsRepository.backupTable(10, 1, {}, {});
      expect(mockModel.backupTableModel).toHaveBeenCalledWith(10, 1, {}, {});
    });
  });

  // ── Email / Kiosk ────────────────────────────────────────────────────────────

  describe('Email and Kiosk methods', () => {
    test('emailSetting delegates to model.emailSettingModel', async () => {
      const data = { smtp: 'smtp.test.com' };
      await settingsRepository.emailSetting(data);
      expect(mockModel.emailSettingModel).toHaveBeenCalledWith(data);
    });

    test('kioskAccountSettings delegates to model.kioskAccountSettingsModel', async () => {
      const data = { account: 'test' };
      await settingsRepository.kioskAccountSettings(data);
      expect(mockModel.kioskAccountSettingsModel).toHaveBeenCalledWith(data);
    });

    test('kioskPrinterSettings delegates to model.kioskPrinterSettingsModel', async () => {
      const data = { printer: 'thermal' };
      await settingsRepository.kioskPrinterSettings(data);
      expect(mockModel.kioskPrinterSettingsModel).toHaveBeenCalledWith(data);
    });

    test('kioskPayment delegates to model.kioskPaymentModel', async () => {
      const data = { upi: 'upi@test' };
      await settingsRepository.kioskPayment(data);
      expect(mockModel.kioskPaymentModel).toHaveBeenCalledWith(data);
    });

    test('kioskupdateInfo delegates to model.kioskupdateInfoModel', async () => {
      const data = { info: 'v1.0' };
      await settingsRepository.kioskupdateInfo(data);
      expect(mockModel.kioskupdateInfoModel).toHaveBeenCalledWith(data);
    });
  });

  // ── Theme ────────────────────────────────────────────────────────────────────

  describe('Theme methods', () => {
    test('getThemeSettings delegates to model.getThemeSettings', async () => {
      await settingsRepository.getThemeSettings();
      expect(mockModel.getThemeSettings).toHaveBeenCalledTimes(1);
    });

    test('updateThemeSettings delegates to model.editThemeSettings', async () => {
      const data = { color: 'blue' };
      await settingsRepository.updateThemeSettings(data);
      expect(mockModel.editThemeSettings).toHaveBeenCalledWith(data);
    });
  });

  // ── Error propagation ──────────────────────────────────────────────────────────

  describe('Error propagation', () => {
    test('rejects when model method throws', async () => {
      mockModel.deleteTaxModel.mockRejectedValue(new Error('db fail'));
      await expect(settingsRepository.deleteTax(FAKE_ID)).rejects.toThrow('db fail');
    });

    test('returns error object when model returns failure', async () => {
      const errorResult = { status: false, message: 'Not found' };
      mockModel.getTaxAllModel.mockResolvedValue(errorResult);
      const r = await settingsRepository.getTaxAll();
      expect(r).toEqual(errorResult);
    });

    test('handles empty data payload', async () => {
      await settingsRepository.addTax({});
      expect(mockModel.addTaxModel).toHaveBeenCalledWith({});
    });

    test('handles null id', async () => {
      await settingsRepository.deleteTax(null);
      expect(mockModel.deleteTaxModel).toHaveBeenCalledWith(null);
    });
  });

  // ── Method existence ───────────────────────────────────────────────────────────

  describe('Method existence', () => {
    const expectedMethods = [
      'setModel',
      'getTaxAll',
      'getTaxAjaxList',
      'getTaxGroup',
      'addTax',
      'editTax',
      'deleteTax',
      'addTaxGroup',
      'editTaxGroup',
      'deleteTaxGroup',
      'getUnitAll',
      'getUnitAjaxList',
      'addUnit',
      'editUnit',
      'deleteUnit',
      'getDenomAll',
      'addDenomForm',
      'addDenomData',
      'editDenomForm',
      'deleteDenom',
      'getPaymentAll',
      'addPaymentData',
      'editPaymentForm',
      'deletePayment',
      'getTableOrderAll',
      'addTableOrderData',
      'editTableOrderForm',
      'deleteTableOrder',
      'updateGeneralSetting',
      'updateCommonSettings',
            'updateWay2SmsSetting',
      'updateTextLocalSmsSetting',
      'updateBranchLogo',
      'updateKioskImages',
      'storedImageData',
      'branchImageDelete',
      'updateCustomerSettings',
      'updateSupplierSettings',
      'changePassword',
      'salesSmsReceipt',
      'paymentsKey',
      'phonepepaymentsKey',
      'deleteCollection',
      'deleteAllSelectedCollection',
      'restoreBackup',
      'getDasboardSalesCount',
      'getRecycleBin',
      'autoSuggestionRecycleBinTableField',
      'getAllCollectionTotal',
      'emailSetting',
      'kioskAccountSettings',
      'kioskPrinterSettings',
      'kioskPayment',
      'kioskupdateInfo',
      'getThemeSettings',
      'updateThemeSettings',
      'getDefaultCustomer',
      'getDefaultSupplier',
      'getDefaultCustomerSupplier',
      'backupTable',
    ];

    test.each(expectedMethods)('has %s method', (method) => {
      expect(typeof settingsRepository[method]).toBe('function');
    });
  });
});
