/**
 * Settings Service
 * Business logic layer for settings operations
 */

const settingsRepository = require('../repositories/setting.repository');
const { ERROR_MESSAGES } = require('../constants/settings.constants');

class SettingsService {
  constructor() {
    this.repository = settingsRepository;
  }

  /**
   * Set setting model instance for repository
   */
  setModel(settingModel) {
    this.repository.setModel(settingModel);
  }

  /**
   * Get all taxes
   */
  async getTaxAll(taxGroup = 'all') {
    try {
      const result = await this.repository.getTaxAll(taxGroup);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Get tax ajax list
   */
  async getTaxAjaxList(query = '') {
    try {
      const result = await this.repository.getTaxAjaxList(query);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Get tax group
   */
  async getTaxGroup() {
    try {
      const result = await this.repository.getTaxGroup();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_GROUP_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Add tax
   */
  async addTax(data) {
    try {
      const result = await this.repository.addTax(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit tax
   */
  async editTax(data) {
    try {
      const result = await this.repository.editTax(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete tax
   */
  async deleteTax(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deleteTax(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Add tax group
   */
  async addTaxGroup(data) {
    try {
      const result = await this.repository.addTaxGroup(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit tax group
   */
  async editTaxGroup(data) {
    try {
      const result = await this.repository.editTaxGroup(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete tax group
   */
  async deleteTaxGroup(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deleteTaxGroup(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TAX_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get all units
   */
  async getUnitAll() {
    try {
      const result = await this.repository.getUnitAll();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UNIT_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Get unit ajax list
   */
  async getUnitAjaxList(query = '') {
    try {
      const result = await this.repository.getUnitAjaxList(query);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UNIT_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Add unit
   */
  async addUnit(data) {
    try {
      const result = await this.repository.addUnit(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UNIT_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit unit
   */
  async editUnit(data) {
    try {
      const result = await this.repository.editUnit(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UNIT_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete unit
   */
  async deleteUnit(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deleteUnit(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UNIT_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get all denominations
   */
  async getDenomAll() {
    try {
      const result = await this.repository.getDenomAll();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.DENOM_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Add denomination form
   */
  async addDenomForm(data) {
    try {
      const result = await this.repository.addDenomForm(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.DENOM_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Add denomination data
   */
  async addDenomData(data) {
    try {
      const result = await this.repository.addDenomData(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.DENOM_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit denomination form
   */
  async editDenomForm(data) {
    try {
      const result = await this.repository.editDenomForm(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.DENOM_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete denomination
   */
  async deleteDenom(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deleteDenom(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.DENOM_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get all payments
   */
  async getPaymentAll() {
    try {
      const result = await this.repository.getPaymentAll();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.PAYMENT_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Add payment data
   */
  async addPaymentData(data) {
    try {
      const result = await this.repository.addPaymentData(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.PAYMENT_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit payment form
   */
  async editPaymentForm(data) {
    try {
      const result = await this.repository.editPaymentForm(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.PAYMENT_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete payment
   */
  async deletePayment(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deletePayment(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.PAYMENT_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get all table orders
   */
  async getTableOrderAll() {
    try {
      const result = await this.repository.getTableOrderAll();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TABLE_ORDER_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Add table order data
   */
  async addTableOrderData(data) {
    try {
      const result = await this.repository.addTableOrderData(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TABLE_ORDER_ADD_FAILED,
        data: null,
      };
    }
  }

  /**
   * Edit table order form
   */
  async editTableOrderForm(data) {
    try {
      const result = await this.repository.editTableOrderForm(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TABLE_ORDER_UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Delete table order
   */
  async deleteTableOrder(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.deleteTableOrder(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.TABLE_ORDER_DELETE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update general setting
   */
  async updateGeneralSetting(data) {
    try {
      const result = await this.repository.updateGeneralSetting(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UPDATE_FAILED,
        data: null,
      };
    }
  }

  async updateStarterLocale(data) {
    try {
      const result = await this.repository.updateStarterLocale(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update common settings
   */
  async updateCommonSettings(data) {
    try {
      const result = await this.repository.updateCommonSettings(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update offline setting
   */
  async updateOfflineSetting(data) {
    try {
      const result = await this.repository.updateOfflineSetting(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.UPDATE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update Way2SMS setting
   */
  async updateWay2SmsSetting(data) {
    try {
      const result = await this.repository.updateWay2SmsSetting(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.SMS_SEND_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update TextLocal SMS setting
   */
  async updateTextLocalSmsSetting(data) {
    try {
      const result = await this.repository.updateTextLocalSmsSetting(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.SMS_SEND_FAILED,
        data: null,
      };
    }
  }

  /**
   * Change password
   */
  async changePassword(data) {
    try {
      const result = await this.repository.changePassword(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.PASSWORD_CHANGE_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update customer settings
   */
  async updateCustomerSettings(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.updateCustomerSettings(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.CUSTOMER_SETTINGS_FAILED,
        data: null,
      };
    }
  }

  /**
   * Update supplier settings
   */
  async updateSupplierSettings(id) {
    try {
      if (!id) {
        return {
          status: false,
          message: ERROR_MESSAGES.ID_REQUIRED,
          data: null,
        };
      }
      const result = await this.repository.updateSupplierSettings(id);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.SUPPLIER_SETTINGS_FAILED,
        data: null,
      };
    }
  }

  /**
   * Get theme settings
   */
  async getThemeSettings() {
    try {
      const result = await this.repository.getThemeSettings();
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.THEME_NOT_FOUND,
        data: null,
      };
    }
  }

  /**
   * Update theme settings
   */
  async updateThemeSettings(data) {
    try {
      const result = await this.repository.updateThemeSettings(data);
      return result;
    } catch (error) {
      return {
        status: false,
        message: error.message || ERROR_MESSAGES.THEME_SETTINGS_FAILED,
        data: null,
      };
    }
  }
}

module.exports = new SettingsService();
