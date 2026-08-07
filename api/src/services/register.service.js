// src/services/register.service.js
// Thin service layer for Register module.
// Delegates to RegisterModel so controllers do not access the DB layer directly.

const RegisterModel = require('../models/register.model');
const RegisterRepository = require('../repositories/register.repository');
const { SUCCESS_MESSAGES } = require('../constants/registers.constants');

class RegisterService {
  constructor(model) {
    // Allow injecting an existing RegisterModel instance so that
    // controller-set context (branchId, licenseId, user, etc.) is reused.
    const registerModel = model || new RegisterModel();
    this.model = registerModel;
    this.repository = new RegisterRepository(registerModel);
  }

  // Data sync
  async getDataChanges(moduleName, from) {
    return this.repository.getDataChanges(moduleName, from);
  }

  // Cash field metadata
  async getcashFieldData() {
    return this.repository.getcashFieldData();
  }

  // Register report table
  async registerReportPage(data, options) {
    return this.repository.registerReportPage(data, options);
  }

  // Register open date filter
  async registeropendateFilterPage(data) {
    return this.repository.registeropendateFilterPage(data);
  }

  // Find register status for user
  async userFindStatus(data) {
    return this.repository.userFindStatus(data);
  }

  // Open / add register
  async registeraddInsert(data) {
    return this.repository.registeraddInsert(data);
  }

  // Update register
  async registerUpdateList(data) {
    return this.repository.registerUpdateList(data);
  }

  // Register cash in/out detail
  async registerInOutDetail(data) {
    return this.repository.registerInOutDetail(data);
  }

  // Delete cash in/out entry
  async deleteCashInOut(data) {
    return this.repository.deleteCashInOut(data);
  }

  // Close register
  async registercloseUpdate(data) {
    return this.repository.registercloseUpdate(data);
  }

  // Open cash register manually
  async cashRegisterOpenManualModel(id) {
    return this.repository.cashRegisterOpenManualModel(id);
  }

  // Get cash register by ID
  async getCashRegisterModel(id) {
    return this.repository.getCashRegisterModel(id);
  }

  // Counted amount update
  async registerCountedAmount(data) {
    return this.repository.registerCountedAmount(data);
  }

  // Payment note update
  async registerPaymentNoteModel(data) {
    return this.repository.registerPaymentNoteModel(data);
  }

  // Register sale details page
  async registerSaleDetailsPage(data, options) {
    return this.repository.registerSaleDetailsPage(data, options);
  }

  // Register report details
  async getRegisterReportDetailsPage(data) {
    return this.repository.getRegisterReportDetailsPage(data);
  }

  // Register report details with calculated totals for PDF generation
  async getRegisterReportPdfDetails(data) {
    const result = await this.repository.getRegisterReportDetailsPage(data);

    if (result.status !== true) {
      return result;
    }

    const sourceData = result.data || {};
    const rawCommonDetails = sourceData.common_details;
    const commonDetails = Array.isArray(rawCommonDetails)
      ? rawCommonDetails[0] || {}
      : rawCommonDetails || {};

    const rawCashDetails = sourceData.cash_details;
    const cashDetails = Array.isArray(rawCashDetails)
      ? rawCashDetails[0] || {}
      : rawCashDetails || {};
    const saleDetails = sourceData.sale_details || [];

    const counted_amount = commonDetails.counted_amount || 0;

    let pendingtotal = 0;
    let refund = 0;
    let count = 0;
    let total = 0;
    let register_report_cash = 0;
    let register_report_Cheque = 0;
    let register_report_CreditCard = 0;

    for (let x = 0; x < saleDetails.length; x++) {
      const row = saleDetails[x] || {};

      refund += row.return_total || 0;
      count += row.count || 0;
      total += row.sale_total || 0;

      if (row.payment_mode === 'Cash') {
        register_report_cash = row.sale_total;
      }
      if (row.payment_mode === 'Cheque') {
        register_report_Cheque = row.sale_total;
      }
      if (row.payment_mode === 'CreditCard') {
        register_report_CreditCard = row.sale_total;
      }
      if (row.payment_mode === 'Pending') {
        pendingtotal += row.sale_total || 0;
      }
    }

    const payment_report = total + refund;
    const recive_payement = payment_report - pendingtotal;
    const total_amount = total - pendingtotal;
    const opening = commonDetails.opening_float || 0;
    const cashin = cashDetails.cashin_amount || 0;
    const cashout = cashDetails.cashout_amount || 0;
    const payment_data = total_amount + opening + cashin;
    const expectedval_data = payment_data - cashout;
    const netsale = recive_payement - refund;
    const difference = counted_amount - total;

    return {
      status: true,
      data: {
        common_details: commonDetails,
        cash_details: cashDetails,
        sale_details: saleDetails,
        calculated: {
          counted_amount,
          pendingtotal,
          refund,
          count,
          total,
          register_report_cash,
          register_report_Cheque,
          register_report_CreditCard,
          payment_report,
          recive_payement,
          total_amount,
          opening,
          cashin,
          cashout,
          payment_data,
          expectedval_data,
          netsale,
          difference,
        },
      },
      message: SUCCESS_MESSAGES.REGISTER_REPORT_DETAILS_RETRIEVED,
    };
  }

  // Cash denomination submit
  async registerDenomsubmitModel(data) {
    return this.repository.registerDenomsubmitModel(data);
  }

  // Edit cash denomination
  async editCashDenominationModel(id) {
    return this.repository.editCashDenominationModel(id);
  }

  // Delete cash denomination
  async deleteCashDenominationModel(data) {
    return this.repository.deleteCashDenominationModel(data);
  }
}

module.exports = RegisterService;
