// src/services/receiving.service.js
const ReceivingRepository = require('../repositories/receiving.repository');
const StockLogsRepository = require('../repositories/stock-log.repository');
const ItemRepository = require('../repositories/item.repository');
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const { DEFAULTS, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../constants/receivings.constants');

/**
 * Receiving Service
 * Contains business logic for receiving/purchase order operations
 * Acts as a bridge between controller and repository
 */
class ReceivingService {
  constructor() {
    this.repository = new ReceivingRepository();
    this.stockLogsRepository = new StockLogsRepository();
    this.itemRepository = new ItemRepository();
  }

  /**
   * Get all receivings with pagination and filters
   */
  async getAllReceivings(filters = {}, options = {}) {
    try {
      const queryFilters = {};

      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      if (filters.supplier) {
        queryFilters.supplier = new ObjectId(filters.supplier);
      }

      if (filters.status) {
        queryFilters.status = filters.status;
      }

      if (filters.payment_status) {
        queryFilters.payment_status = filters.payment_status;
      }

      if (filters.receiving_status) {
        queryFilters.receiving_status = filters.receiving_status;
      }

      // Handle date filters
      if (filters.updated_date) {
        queryFilters.updated_date = {};
        if (filters.updated_date.$gte) {
          const gteDate = new Date(filters.updated_date.$gte.trim());
          if (!isNaN(gteDate.getTime())) {
            queryFilters.updated_date.$gte = gteDate;
          }
        }
        if (filters.updated_date.$lte) {
          const lteDate = new Date(filters.updated_date.$lte.trim());
          if (!isNaN(lteDate.getTime())) {
            queryFilters.updated_date.$lte = lteDate;
          }
        }
      }

      if (filters.created_date) {
        queryFilters.created_date = {};
        if (filters.created_date.$gte) {
          const gteDate = new Date(filters.created_date.$gte.trim());
          if (!isNaN(gteDate.getTime())) {
            queryFilters.created_date.$gte = gteDate;
          }
        }
        if (filters.created_date.$lte) {
          const lteDate = new Date(filters.created_date.$lte.trim());
          if (!isNaN(lteDate.getTime())) {
            queryFilters.created_date.$lte = lteDate;
          }
        }
      }

      const result = await this.repository.findAll(queryFilters, options);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getAllReceivings:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receiving by ID
   */
  async getReceivingById(id) {
    try {
      const receiving = await this.repository.findById(id);

      if (!receiving) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.RECEIVING_NOT_FOUND,
        };
      }

      return {
        status: true,
        data: receiving,
        message: SUCCESS_MESSAGES.RECEIVING_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receiving by receiving_id (human-readable ID)
   */
  async getReceivingByReceivingId(receivingId) {
    try {
      const receiving = await this.repository.findByReceivingId(receivingId);

      if (!receiving) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.RECEIVING_NOT_FOUND,
        };
      }

      return {
        status: true,
        data: receiving,
        message: SUCCESS_MESSAGES.RECEIVING_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingByReceivingId:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create a new receiving
   */
  async createReceiving(receivingData) {
    try {
      // Validate required fields
      if (!receivingData.supplier) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.SUPPLIER_REQUIRED,
        };
      }

      if (!receivingData.items || receivingData.items.length === 0) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.ITEMS_REQUIRED,
        };
      }

      // Set defaults
      const dataToCreate = {
        ...receivingData,
        status: receivingData.status || DEFAULTS.STATUS,
        receiving_status: receivingData.receiving_status || DEFAULTS.RECEIVING_STATUS,
        payment_status: receivingData.payment_status || DEFAULTS.PAYMENT_STATUS,
        payment_method: receivingData.payment_method || DEFAULTS.PAYMENT_METHOD,
        tax: receivingData.tax || DEFAULTS.TAX,
        discount: receivingData.discount || DEFAULTS.DISCOUNT,
      };

      const receiving = await this.repository.create(dataToCreate);

      // Stock log integration (mirrors PHP line 411-415)
      // PHP: if ($_SESSION['PosnicPro']['settings']['stock_management'] === true && $documents['track_inventory'] === true && $data['status'] === 'Received')
      if (receivingData.status === 'Received' && receivingData.items) {
        // Get branch to check stock_management setting
        const branchDoc = await BaseModel.database.collection('branches').findOne({
          _id: BaseModel.currentBranch,
        });

        const stockManagement = branchDoc?.stock_management === true;
        const stockLogStatus = branchDoc?.stock_management_log !== false;

        console.log('[RECEIVING DEBUG] Stock log context:', {
          stockManagement: stockManagement,
          stockLogStatus: stockLogStatus,
          status: receivingData.status,
          itemCount: receivingData.items.length,
        });

        if (stockManagement) {
          const prefixId = receiving.receiving_id || receiving._id;
          const now = new Date();

          for (const item of receivingData.items) {
            if (!item.item_id || !item.item_quantity) continue;

            try {
              // Get item document to check track_inventory
              const itemDoc = await this.itemRepository.findById(item.item_id);

              console.log('[RECEIVING DEBUG] Item check:', {
                item_id: item.item_id,
                track_inventory: itemDoc?.track_inventory,
                track_inventory_type: typeof itemDoc?.track_inventory,
              });
              // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
              if (
                !itemDoc ||
                !(itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')
              )
                continue;

              const itemObjectId = new ObjectId(item.item_id);
              const itemQuantity = Number(item.item_quantity);
              const openingBalance = Number(itemDoc.available_quantity || 0);
              const closingBalance = openingBalance + itemQuantity;
              const count = String(itemQuantity);

              console.log('[RECEIVING DEBUG] Creating stock log for item:', item.item_id);

              // Create stock log (PHP line 413)
              const stockLogResult = await this.stockLogsRepository.createStockLog({
                stocklog: true,
                branch_id: BaseModel.currentBranch,
                view_item_id: itemObjectId,
                item_barcode_id: itemDoc.barcode_id || '',
                item_name: item.item_name || itemDoc.name || '',
                item_quantity: count,
                process: 'Add Receiving',
                reference: prefixId,
                opening_balance: openingBalance,
                closing_balance: closingBalance,
                count: count,
                date: now,
                action: 'Add',
                changed_by_userid: BaseModel.loggedUser,
                changed_by: BaseModel.loggedUserName || 'System',
              });

              if (!stockLogResult.status) {
                console.error('[RECEIVING] Stock log creation failed:', stockLogResult.message);
              }

              // Update item quantity (PHP line 414)
              await this.itemRepository.updateStock(itemObjectId, closingBalance);
            } catch (itemError) {
              console.error(
                `[RECEIVING ERROR] Stock log failed for item ${item.item_id}:`,
                itemError
              );
            }
          }
        } else {
          console.log('[RECEIVING DEBUG] Stock management disabled, skipping stock logs');
        }
      }

      return {
        status: true,
        data: receiving,
        message: SUCCESS_MESSAGES.RECEIVING_CREATED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.createReceiving:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update a receiving
   */
  async updateReceiving(id, updateData) {
    try {
      const existing = await this.repository.findById(id);

      if (!existing) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.RECEIVING_NOT_FOUND,
        };
      }

      // Prevent modification of received receivings
      if (existing.status === 'received' && updateData.status !== 'received') {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.CANNOT_MODIFY_RECEIVED,
        };
      }

      const receiving = await this.repository.update(id, updateData);

      // Stock log integration (mirrors PHP line 438-443)
      // PHP: if ($_SESSION['PosnicPro']['settings']['stock_management'] === true && $documents['track_inventory'] === true && $data['status'] === 'Received')
      if (updateData.status === 'Received' && updateData.items) {
        // Get branch to check stock_management setting
        const branchDoc = await BaseModel.database.collection('branches').findOne({
          _id: BaseModel.currentBranch,
        });

        const stockManagement = branchDoc?.stock_management === true;
        const stockLogStatus = branchDoc?.stock_management_log !== false;

        console.log('[RECEIVING DEBUG] Edit - Stock log context:', {
          stockManagement: stockManagement,
          stockLogStatus: stockLogStatus,
          status: updateData.status,
          itemCount: updateData.items.length,
        });

        if (stockManagement) {
          const alternativeId = updateData.alternative_id || id;
          const now = new Date();

          for (const item of updateData.items) {
            if (!item.item_id || !item.item_quantity) continue;

            try {
              // Get item document to check track_inventory
              const itemDoc = await this.itemRepository.findById(item.item_id);
              // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
              if (
                !itemDoc ||
                !(itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')
              )
                continue;

              const itemObjectId = new ObjectId(item.item_id);
              const itemQuantity = Number(item.item_quantity);
              const openingBalance = Number(itemDoc.available_quantity || 0);
              const closingBalance = openingBalance + itemQuantity;
              const count = String(itemQuantity);

              // Create stock log (PHP line 441)
              await this.stockLogsRepository.createStockLog({
                stocklog: true,
                branch_id: BaseModel.currentBranch,
                view_item_id: itemObjectId,
                item_barcode_id: itemDoc.barcode_id || '',
                item_name: item.item_name || itemDoc.name || '',
                item_quantity: count,
                process: 'Edit Receiving',
                reference: alternativeId,
                opening_balance: openingBalance,
                closing_balance: closingBalance,
                count: count,
                date: now,
                action: 'Add',
                changed_by_userid: BaseModel.loggedUser,
                changed_by: BaseModel.loggedUserName || 'System',
              });

              // Update item quantity (PHP line 442)
              await this.itemRepository.updateStock(itemObjectId, closingBalance);
            } catch (itemError) {
              console.error(
                `[RECEIVING ERROR] Stock log failed for item ${item.item_id}:`,
                itemError
              );
            }
          }
        } else {
          console.log('[RECEIVING DEBUG] Edit - Stock management disabled, skipping stock logs');
        }
      }

      return {
        status: true,
        data: receiving,
        message: SUCCESS_MESSAGES.RECEIVING_UPDATED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.updateReceiving:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Return receiving (mirrors PHP returnProductSubmit - line 555-566)
   * Returns items back from a receiving and updates inventory
   */
  async returnReceiving(receivingId, returnData) {
    try {
      // Stock log integration (mirrors PHP line 561-566)
      // PHP: if ($_SESSION['PosnicPro']['settings']['stock_management'] === true && $documents['track_inventory'] === true)

      // Get branch to check stock_management setting
      const branchDoc = await BaseModel.database.collection('branches').findOne({
        _id: BaseModel.currentBranch,
      });

      const stockManagement = branchDoc?.stock_management === true;
      const stockLogStatus = branchDoc?.stock_management_log !== false;

      console.log('[RECEIVING DEBUG] Return - Stock log context:', {
        stockManagement: stockManagement,
        stockLogStatus: stockLogStatus,
        itemCount: returnData.items?.length || 0,
      });

      if (stockManagement && returnData.items) {
        const now = new Date();

        // Process each returned item
        for (const item of returnData.items) {
          if (!item.item_id || !item.return_quantity) continue;

          try {
            const itemObjectId = new ObjectId(item.item_id);
            const itemDoc = await this.itemRepository.findById(item.item_id);

            // PHP checks: $documents['track_inventory'] === true (boolean or string 'true')
            if (
              !itemDoc ||
              !(itemDoc.track_inventory === true || itemDoc.track_inventory === 'true')
            )
              continue;

            const returnQuantity = Number(item.return_quantity);
            const openingBalance = Number(itemDoc.available_quantity || 0);
            const closingBalance = openingBalance - returnQuantity;
            const count = String(-returnQuantity);
            const alternativeId = returnData.alternative_id || receivingId;

            // Create stock log (PHP line 564)
            await this.stockLogsRepository.createStockLog({
              stocklog: true,
              branch_id: BaseModel.currentBranch,
              view_item_id: itemObjectId,
              item_barcode_id: itemDoc.barcode_id || '',
              item_name: item.item_name || itemDoc.name || '',
              item_quantity: count,
              process: 'Return Receiving',
              reference: alternativeId,
              opening_balance: openingBalance,
              closing_balance: closingBalance,
              count: count,
              date: now,
              action: 'Subtract',
              changed_by_userid: BaseModel.loggedUser,
              changed_by: BaseModel.loggedUserName || 'System',
            });

            // Update item quantity (PHP line 565)
            await this.itemRepository.updateStock(itemObjectId, closingBalance);
          } catch (error) {
            console.error(`[RECEIVING ERROR] Return failed for item ${item.item_id}:`, error);
          }
        }
      } else {
        console.log('[RECEIVING DEBUG] Stock management disabled, skipping return stock logs');
      }

      return {
        status: true,
        data: null,
        message: SUCCESS_MESSAGES.RECEIVING_RETURNED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.returnReceiving:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete a receiving
   */
  async deleteReceiving(id) {
    try {
      const receiving = await this.repository.hardDelete(id);

      return {
        status: true,
        data: receiving,
        message: SUCCESS_MESSAGES.RECEIVING_DELETED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.deleteReceiving:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk delete receivings
   */
  async bulkDeleteReceivings(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No IDs provided',
        };
      }

      const result = await this.repository.bulkHardDelete(ids);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_DELETED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.bulkDeleteReceivings:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receivings by supplier
   */
  async getReceivingsBySupplier(supplierId, options = {}) {
    try {
      const result = await this.repository.findBySupplier(supplierId, options);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingsBySupplier:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receivings by branch
   */
  async getReceivingsByBranch(branchId, options = {}) {
    try {
      const result = await this.repository.findByBranch(branchId, options);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingsByBranch:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receivings by status
   */
  async getReceivingsByStatus(status, options = {}) {
    try {
      const result = await this.repository.findByStatus(status, options);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingsByStatus:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get receivings by payment status
   */
  async getReceivingsByPaymentStatus(paymentStatus, options = {}) {
    try {
      const result = await this.repository.findByPaymentStatus(paymentStatus, options);

      return {
        status: true,
        data: result,
        message: SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.getReceivingsByPaymentStatus:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export receivings by IDs
   */
  async exportReceivings(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No IDs provided for export',
        };
      }

      const receivings = await this.repository.exportByIds(ids);

      return {
        status: true,
        data: receivings,
        message: SUCCESS_MESSAGES.RECEIVINGS_EXPORTED,
      };
    } catch (error) {
      console.error('Error in ReceivingService.exportReceivings:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = ReceivingService;
