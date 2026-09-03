/**
 * Settings Repository
 * Data access layer for settings operations
 */

require('../constants/settings.constants');

class SettingsRepository {
  constructor() {
    this.settingModel = null; // Will be injected by service
  }

  /**
   * Set the setting model instance
   */
  setModel(settingModel) {
    this.settingModel = settingModel;
  }

  /**
   * Get all taxes
   */
  async getTaxAll(taxGroup = 'all') {
    return await this.settingModel.getTaxAllModel(taxGroup);
  }

  /**
   * Get tax ajax list for autocomplete
   */
  async getTaxAjaxList(query = '') {
    return await this.settingModel.getTaxAjaxListModel(query);
  }

  /**
   * Get tax group
   */
  async getTaxGroup() {
    return await this.settingModel.getTaxGroupModel();
  }

  /**
   * Add tax
   */
  async addTax(data) {
    return await this.settingModel.addTaxModel(data);
  }

  /**
   * Edit tax
   */
  async editTax(data) {
    return await this.settingModel.editTaxModel(data);
  }

  /**
   * Delete tax
   */
  async deleteTax(id) {
    return await this.settingModel.deleteTaxModel(id);
  }

  /**
   * Add tax group
   */
  async addTaxGroup(data) {
    return await this.settingModel.addTaxGroupModel(data);
  }

  /**
   * Edit tax group
   */
  async editTaxGroup(data) {
    return await this.settingModel.editTaxGroupModel(data);
  }

  /**
   * Delete tax group
   */
  async deleteTaxGroup(id) {
    return await this.settingModel.deleteTaxGroupModel(id);
  }

  /**
   * Get all units
   */
  async getUnitAll() {
    return await this.settingModel.getUnitAllModel();
  }

  /**
   * Get unit ajax list
   */
  async getUnitAjaxList(query = '') {
    return await this.settingModel.getUnitAjaxListModel(query);
  }

  /**
   * Add unit
   */
  async addUnit(data) {
    return await this.settingModel.addUnitModel(data);
  }

  /**
   * Edit unit
   */
  async editUnit(data) {
    return await this.settingModel.editUnitModel(data);
  }

  /**
   * Delete unit
   */
  async deleteUnit(id) {
    return await this.settingModel.deleteUnitModel(id);
  }

  /**
   * Get all denominations
   */
  async getDenomAll() {
    return await this.settingModel.getDenomAllModel();
  }

  /**
   * Add denomination form
   */
  async addDenomForm(data) {
    return await this.settingModel.addDenomModel(data);
  }

  /**
   * Add denomination data
   */
  async addDenomData(data) {
    return await this.settingModel.addDenomDataModel(data);
  }

  /**
   * Edit denomination form
   */
  async editDenomForm(data) {
    return await this.settingModel.editDenomFiledModel(data);
  }

  /**
   * Delete denomination
   */
  async deleteDenom(id) {
    return await this.settingModel.deleteDenomFiledModel(id);
  }

  /**
   * Get all payments
   */
  async getPaymentAll() {
    return await this.settingModel.getPaymentAllModel();
  }

  /**
   * Add payment data
   */
  async addPaymentData(data) {
    return await this.settingModel.addPaymentModel(data);
  }

  /**
   * Edit payment form
   */
  async editPaymentForm(data) {
    return await this.settingModel.editPaymentFiledModel(data);
  }

  /**
   * Delete payment
   */
  async deletePayment(id) {
    return await this.settingModel.deletePaymentFiledModel(id);
  }

  /**
   * Get all table orders
   */
  async getTableOrderAll() {
    return await this.settingModel.getTableOrderAllModel();
  }

  /**
   * Add table order data
   */
  async addTableOrderData(data) {
    return await this.settingModel.addTableOrderModel(data);
  }

  /**
   * Edit table order form
   */
  async editTableOrderForm(data) {
    return await this.settingModel.editTableOrderFiledModel(data);
  }

  /**
   * Delete table order
   */
  async deleteTableOrder(id) {
    return await this.settingModel.deleteTableOrderFiledModel(id);
  }

  /**
   * Update general setting
   */
  async updateGeneralSetting(data) {
    return await this.settingModel.editGeneralSetting(data);
  }

  async updateStarterLocale(data) {
    return await this.settingModel.updateStarterLocale(data);
  }

  /**
   * Update common settings
   */
  async updateCommonSettings(data) {
    return await this.settingModel.updateCommonSettings(data);
  }

  /**
   * Update offline setting
   */
  async updateWay2SmsSetting(data) {
    return await this.settingModel.updateWay2SmsSetting(data);
  }

  /**
   * Update TextLocal SMS setting
   */
  async updateTextLocalSmsSetting(data) {
    return await this.settingModel.updateTextLocalSmsSetting(data);
  }

  /**
   * Update branch logo
   */
  async updateBranchLogo(file, branchId) {
    return await this.settingModel.updateBranchLogoModel(file, branchId);
  }

  /**
   * Update kiosk images
   */
  async updateKioskImages(files, branchId) {
    return await this.settingModel.updateKioskImagesModel(files, branchId);
  }

  /**
   * Store image data
   */
  async storedImageData(data) {
    return await this.settingModel.storedImageDataModel(data);
  }

  /**
   * Delete branch image
   */
  async branchImageDelete(imageName) {
    return await this.settingModel.branchImageDeleteModel(imageName);
  }

  /**
   * Update customer settings
   */
  async updateCustomerSettings(id) {
    return await this.settingModel.updateCommonCustomerSettings(id);
  }

  /**
   * Update supplier settings
   */
  async updateSupplierSettings(id) {
    return await this.settingModel.updateCommonSupplierSettings(id);
  }

  /**
   * Change password
   */
  async changePassword(data) {
    return await this.settingModel.changePasswordModel(data);
  }

  /**
   * Sales SMS receipt
   */
  async salesSmsReceipt(data) {
    return await this.settingModel.salesSmsReceiptModel(data);
  }

  /**
   * Payment key
   */
  async paymentsKey(data) {
    return await this.settingModel.paymentKeyModel(data);
  }

  /**
   * PhonePe payment key
   */
  async phonepepaymentsKey(data) {
    return await this.settingModel.phonepePaymentKeyModel(data);
  }

  /**
   * Delete collection
   */
  async deleteCollection(collection) {
    return await this.settingModel.deleteCollectionModel(collection);
  }

  /**
   * Delete all selected collections
   */
  async deleteAllSelectedCollection(data) {
    return await this.settingModel.deleteAllSelectedCollectionModel(data);
  }

  /**
   * Restore backup
   */
  async restoreBackup(data) {
    return await this.settingModel.restoreBackupModel(data);
  }

  /**
   * Get dashboard sales count
   */
  async getDasboardSalesCount() {
    return await this.settingModel.getDasboardSalesCountModel();
  }

  /**
   * Get recycle bin
   */
  async getRecycleBin(limit, page, filter, dateRange) {
    return await this.settingModel.getRecycleBinModel(limit, page, filter, dateRange);
  }

  /**
   * Auto suggestion recycle bin table field
   */
  async autoSuggestionRecycleBinTableField(query) {
    return await this.settingModel.autoSuggestionRecycleBinTableFieldModel(query);
  }

  /**
   * Get all collection total
   */
  async getAllCollectionTotal() {
    return await this.settingModel.getAllCollectionTotalModel();
  }

  /**
   * Email setting
   */
  async emailSetting(data) {
    return await this.settingModel.emailSettingModel(data);
  }

  /**
   * Kiosk account settings
   */
  async kioskAccountSettings(data) {
    return await this.settingModel.kioskAccountSettingsModel(data);
  }

  /**
   * Kiosk printer settings
   */
  async kioskPrinterSettings(data) {
    return await this.settingModel.kioskPrinterSettingsModel(data);
  }

  /**
   * Kiosk payment
   */
  async kioskPayment(data) {
    return await this.settingModel.kioskPaymentModel(data);
  }

  /**
   * Kiosk update info
   */
  async kioskupdateInfo(data) {
    return await this.settingModel.kioskupdateInfoModel(data);
  }

  /**
   * Get theme settings
   */
  async getThemeSettings() {
    return await this.settingModel.getThemeSettings();
  }

  /**
   * Update theme settings
   */
  async updateThemeSettings(data) {
    return await this.settingModel.editThemeSettings(data);
  }

  /**
   * Get default customer
   */
  async getDefaultCustomer(id) {
    return await this.settingModel.getDefaultCustomerModel(id);
  }

  /**
   * Get default supplier
   */
  async getDefaultSupplier(id) {
    return await this.settingModel.getDefaultSupplierModel(id);
  }

  /**
   * Get default customer and supplier
   */
  async getDefaultCustomerSupplier(customerId, supplierId) {
    return await this.settingModel.getDefaultCustomerSupplierModel(customerId, supplierId);
  }

  /**
   * Backup table
   */
  async backupTable(limit, page, filter, dateRange) {
    return await this.settingModel.backupTableModel(limit, page, filter, dateRange);
  }
}

module.exports = new SettingsRepository();
