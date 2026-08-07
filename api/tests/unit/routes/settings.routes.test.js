'use strict';

jest.mock('../../../src/controllers/settings.controller', () => {
  const make = jest.fn();
  return {
    getJSONCountry: make,
    getJSONState: make,
    getJSONCurrency: make,
    getJSONTimeZone: make,
    forgotPassword: make,
    getDefaultCustomer: make,
    getDefaultSupplier: make,
    getDefaultCustomerSupplier: make,
    backupTable: make,
    updateGeneralSetting: make,
    updateCommonSettings: make,
    getTaxAll: make,
    getTaxAjaxList: make,
    getTaxGroup: make,
    addTax: make,
    editTax: make,
    deleteTax: make,
    getUnitAll: make,
    getUnitAjaxList: make,
    addUnit: make,
    editUnit: make,
    deleteUnit: make,
    addTaxGroup: make,
    editTaxGroup: make,
    deleteTaxGroup: make,
    addDenomForm: make,
    addDenomData: make,
    getDenomAll: make,
    editDenomForm: make,
    deleteDenom: make,
    getPaymentAll: make,
    addPaymentData: make,
    editPaymentForm: make,
    deletePayment: make,
    updateWay2SmsSetting: make,
    updateTextLocalSmsSetting: make,
    updateOfflineSetting: make,
    updateBranchLogo: make,
    updateKioskImages: make,
    storedImageData: make,
    branchImageDelete: make,
    updateCustomerSettings: make,
    updateSupplierSettings: make,
    changePassword: make,
    salesSmsReceipt: make,
    saveWhatsAppReceipt: make,
    getWhatsAppReceipt: make,
    paymentsKey: make,
    phonepepaymentsKey: make,
    deleteCollection: make,
    deleteAllSelectedCollection: make,
    getJSONGstState: make,
    restoreBackup: make,
    getDasboardSalesCount: make,
    getRecycleBin: make,
    autoSuggestionRecycleBinTableField: make,
    getAllCollectionTotal: make,
    emailSetting: make,
    kioskAccountSettings: make,
    kioskPrinterSettings: make,
    kioskPayment: make,
    kioskupdateInfo: make,
    addTableOrderData: make,
    getTableOrderAll: make,
    editTableOrderForm: make,
    deleteTableOrder: make,
    getThemeSettings: make,
    updateThemeSettings: make,
  };
});

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/validation', () => ({
  handleValidationErrors: jest.fn((req, res, next) => next()),
}));
jest.mock('../../../src/middleware/upload', () => ({
  single: jest.fn(() => (req, res, next) => next()),
  fields: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../src/middleware/settings.validation', () => ({
  validateGeneralSetting: [],
  validateTax: [],
  validateUnit: [],
  validateTaxGroup: [],
  validateDenom: [],
  validatePayment: [],
  validateCommonSettings: [],
  validateChangePassword: [],
  validateWay2SmsSetting: [],
  validateTextLocalSmsSetting: [],
}));

const router = require('../../../src/routes/settings.routes');

describe('settings.routes', () => {
  test('exposes settings routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(10);
  });
});
