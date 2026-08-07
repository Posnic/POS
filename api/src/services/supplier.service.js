// src/services/supplier.service.js
const SupplierRepository = require('../repositories/supplier.repository');
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { sanitizeSupplierData, validateSupplierData } = require('../helpers/suppliers.helper');

/**
 * Supplier Service
 * Contains business logic for supplier operations
 * Acts as a bridge between controller and repository
 */
class SupplierService {
  constructor() {
    this.repository = new SupplierRepository();
  }

  /**
   * Get all suppliers with pagination and filters
   */
  async getAllSuppliers(filters = {}, options = {}) {
    try {
      const queryFilters = {};

      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      // Handle name filter with regex
      if (filters.name) {
        if (filters.name.$regex) {
          queryFilters.name = {
            $regex: filters.name.$regex.replace(/\(\?=\.\*|\)/g, ''),
            $options: filters.name.$options || 'i',
          };
        } else {
          queryFilters.name = new RegExp(filters.name, 'i');
        }
      }

      // Handle address filter with regex
      if (filters.address) {
        if (filters.address.$regex) {
          queryFilters.address = {
            $regex: filters.address.$regex.replace(/\(\?=\.\*|\)/g, ''),
            $options: filters.address.$options || 'i',
          };
        } else {
          queryFilters.address = new RegExp(filters.address, 'i');
        }
      }

      // Handle phone filter with regex
      if (filters.phone) {
        if (filters.phone.$regex) {
          queryFilters.phone = {
            $regex: filters.phone.$regex.replace(/\(\?=\.\*|\)/g, ''),
            $options: filters.phone.$options || 'i',
          };
        } else {
          queryFilters.phone = new RegExp(filters.phone, 'i');
        }
      }

      // Handle email filter with regex
      if (filters.email) {
        if (filters.email.$regex) {
          queryFilters.email = {
            $regex: filters.email.$regex.replace(/\(\?=\.\*|\)/g, ''),
            $options: filters.email.$options || 'i',
          };
        } else {
          queryFilters.email = new RegExp(filters.email, 'i');
        }
      }

      // Handle simple search (fallback - searches across all fields)
      if (filters.search && !filters.name && !filters.address && !filters.phone && !filters.email) {
        queryFilters.$or = [
          { name: new RegExp(filters.search, 'i') },
          { company_name: new RegExp(filters.search, 'i') },
          { email: new RegExp(filters.search, 'i') },
          { phone: new RegExp(filters.search, 'i') },
          { address: new RegExp(filters.search, 'i') },
        ];
      }

      // Handle date filters
      if (filters.updated_date) {
        queryFilters.updated_date = {};
        if (filters.updated_date.$gte) {
          const gteDate = new Date(filters.updated_date.$gte.trim());
          console.log(
            'Supplier Updated Date $gte - Input:',
            filters.updated_date.$gte,
            'Parsed:',
            gteDate
          );
          if (!isNaN(gteDate.getTime())) {
            queryFilters.updated_date.$gte = gteDate;
          }
        }
        if (filters.updated_date.$lte) {
          const lteDate = new Date(filters.updated_date.$lte.trim());
          console.log(
            'Supplier Updated Date $lte - Input:',
            filters.updated_date.$lte,
            'Parsed:',
            lteDate
          );
          if (!isNaN(lteDate.getTime())) {
            queryFilters.updated_date.$lte = lteDate;
          }
        }
      }

      if (filters.created_date) {
        queryFilters.created_date = {};
        if (filters.created_date.$gte) {
          const gteDate = new Date(filters.created_date.$gte.trim());
          console.log(
            'Supplier Created Date $gte - Input:',
            filters.created_date.$gte,
            'Parsed:',
            gteDate
          );
          if (!isNaN(gteDate.getTime())) {
            queryFilters.created_date.$gte = gteDate;
          }
        }
        if (filters.created_date.$lte) {
          const lteDate = new Date(filters.created_date.$lte.trim());
          console.log(
            'Supplier Created Date $lte - Input:',
            filters.created_date.$lte,
            'Parsed:',
            lteDate
          );
          if (!isNaN(lteDate.getTime())) {
            queryFilters.created_date.$lte = lteDate;
          }
        }
      }

      if (filters.gst) {
        queryFilters.gst = filters.gst;
      }

      console.log('Supplier Final queryFilters:', JSON.stringify(queryFilters, null, 2));

      const result = await this.repository.findAll(queryFilters, options);

      return {
        status: true,
        data: result,
        message: 'Suppliers retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getAllSuppliers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get supplier by ID
   */
  async getSupplierById(id) {
    try {
      const supplier = await this.repository.findById(id);

      if (!supplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      // Ensure country/state/city fields exist with defaults
      if (!supplier.country) supplier.country = 'India';
      if (!supplier.state) supplier.state = '';
      if (!supplier.city) supplier.city = '';

      return {
        status: true,
        data: supplier,
        message: 'Supplier retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getSupplierById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create new supplier
   * Includes validation and business rules
   */
  async createSupplier(supplierData) {
    try {
      // Validate required fields
      if (!supplierData.name) {
        return {
          status: false,
          data: null,
          message: 'Supplier name is required',
        };
      }

      // Validate supplier data
      const validation = validateSupplierData(supplierData);
      if (!validation.valid) {
        return {
          status: false,
          data: null,
          message: validation.errors.join(', '),
        };
      }

      // Check for duplicate email
      if (supplierData.email) {
        const existingSupplier = await this.repository.findByEmail(supplierData.email);
        if (existingSupplier) {
          return {
            status: false,
            data: null,
            message: 'Supplier with this email already exists',
          };
        }
      }

      // Sanitize data
      const sanitizedData = sanitizeSupplierData(supplierData);

      // Create supplier
      const supplier = await this.repository.create(sanitizedData);

      return {
        status: true,
        data: supplier,
        message: 'Supplier created successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.createSupplier:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update supplier
   */
  async updateSupplier(id, updateData) {
    try {
      // Check if supplier exists
      const existingSupplier = await this.repository.findById(id);
      if (!existingSupplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      // Check for duplicate email if email is being updated
      if (updateData.email && updateData.email !== existingSupplier.email) {
        const duplicateSupplier = await this.repository.findByEmail(updateData.email);
        if (duplicateSupplier) {
          return {
            status: false,
            data: null,
            message: 'Supplier with this email already exists',
          };
        }
      }

      // Sanitize data
      const sanitizedData = sanitizeSupplierData(updateData);

      // Update supplier
      const updatedSupplier = await this.repository.update(id, sanitizedData);

      return {
        status: true,
        data: updatedSupplier,
        message: 'Supplier updated successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.updateSupplier:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete supplier (soft delete)
   */
  async deleteSupplier(id) {
    try {
      const supplier = await this.repository.findById(id);
      if (!supplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      await this.repository.softDelete(id);

      return {
        status: true,
        data: null,
        message: 'Supplier deleted successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.deleteSupplier:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk delete suppliers
   */
  async bulkDeleteSuppliers(ids) {
    try {
      if (!ids || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No supplier IDs provided',
        };
      }

      const result = await this.repository.bulkSoftDelete(ids);

      return {
        status: true,
        // Match legacy PHP response: numeric deleted count and fixed
        // success message 'Supplier deleted successfully'
        data: result.deletedCount,
        message: 'Supplier deleted successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.bulkDeleteSuppliers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Search suppliers
   */
  async searchSuppliers(searchTerm, options = {}) {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        return this.getAllSuppliers({}, options);
      }

      const result = await this.repository.search(searchTerm, options);

      return {
        status: true,
        data: result,
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.searchSuppliers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get supplier summary with purchase statistics
   */
  async getSupplierSummary(supplierId) {
    try {
      const summary = await this.repository.getSummary(supplierId);

      if (!summary) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      return {
        status: true,
        data: summary,
        message: 'Supplier summary retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getSupplierSummary:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get outstanding report
   */
  async getOutstandingReport(filters = {}, options = {}) {
    try {
      const report = await this.repository.getOutstandingReport(filters, options);

      return {
        status: true,
        data: report,
        message: 'Outstanding report retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getOutstandingReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get supplier payment details
   */
  async getPaymentDetails(supplierId) {
    try {
      const supplier = await this.repository.findById(supplierId);
      if (!supplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      const paymentDetails = await this.repository.getPaymentDetails(supplierId);

      return {
        status: true,
        data: {
          supplier,
          ...paymentDetails,
        },
        message: 'Payment details retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getPaymentDetails:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get supplier transactions
   */
  async getTransactions(supplierId, options = {}) {
    try {
      const supplier = await this.repository.findById(supplierId);
      if (!supplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      const result = await this.repository.getTransactions(supplierId, options);

      return {
        status: true,
        data: result,
        message: 'Transactions retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getTransactions:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk import suppliers
   */
  async bulkImport(suppliersData) {
    try {
      if (!suppliersData || suppliersData.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No supplier data provided',
        };
      }

      const baseModel = new BaseModel();
      const maxImport = await baseModel.checkPlan('suppliers', 'import');
      const count =
        maxImport > 0 ? Math.min(maxImport, suppliersData.length) : suppliersData.length;

      const limitedSuppliers = suppliersData.slice(0, count);

      const uniqueValue = [];
      const seenRecords = new Set();

      for (const supplier of limitedSuppliers) {
        const normalized = Object.keys(supplier || {})
          .sort()
          .reduce((acc, key) => {
            acc[key] = supplier[key];
            return acc;
          }, {});
        const uniqueKey = JSON.stringify(normalized);
        if (!seenRecords.has(uniqueKey)) {
          seenRecords.add(uniqueKey);
          uniqueValue.push(supplier);
        }
      }

      const uniqueCSVRecords = {};
      for (const supplier of uniqueValue) {
        const normalizedSupplier = {
          ...supplier,
          name: supplier?.name || '',
          phone: supplier?.phone || '',
          email: supplier?.email || '',
          address: supplier?.address || '',
        };
        const key = `${normalizedSupplier.name}-${normalizedSupplier.phone}`;
        if (!uniqueCSVRecords[key]) {
          uniqueCSVRecords[key] = normalizedSupplier;
        }
      }

      const validationErrors = [];
      const requiredFields = ['name'];

      Object.values(uniqueCSVRecords).forEach((supplier) => {
        const errorFields = [];
        requiredFields.forEach((field) => {
          const value = supplier[field];
          if ((value === undefined || value === null || value === '') && value !== '0') {
            errorFields.push(field);
          }
        });

        if (errorFields.length > 0) {
          validationErrors.push({
            ...supplier,
            status: errorFields.join(', '),
          });
        }
      });

      if (validationErrors.length > 0) {
        return {
          status: true,
          data: validationErrors,
          message: 'CSV',
        };
      }

      const alreadyData = [];
      const newData = [];

      for (const supplier of Object.values(uniqueCSVRecords)) {
        if (!supplier.name) {
          continue;
        }

        const existingSupplier = await this.repository.findByNamePhoneBranch(
          supplier.name,
          supplier.phone,
          supplier.branch_id
        );

        if (existingSupplier) {
          alreadyData.push({
            name: existingSupplier.name,
            phone: existingSupplier.phone,
            email: existingSupplier.email || '',
            address: existingSupplier.address || '',
          });
        } else {
          newData.push(sanitizeSupplierData(supplier));
        }
      }

      if (newData.length === 0) {
        return {
          status: false,
          data: alreadyData,
          message: 'All suppliers are already imported',
        };
      }

      const result = await this.repository.bulkCreate(newData);

      const responseData = result.map((doc) => ({
        name: doc.name || '',
        email: doc.email || '',
        phone: doc.phone || '',
        address: doc.address || '',
        status: 'Imported',
      }));

      return {
        status: true,
        data: responseData,
        message: 'Supplier data imported successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.bulkImport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export suppliers data
   */
  async exportSuppliers(filters = {}) {
    try {
      const queryFilters = {};

      // Handle IDs filter for specific supplier export
      if (filters.ids && Array.isArray(filters.ids) && filters.ids.length > 0) {
        queryFilters._id = { $in: filters.ids.map((id) => new ObjectId(id)) };
      }

      // Handle branch filter
      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      const suppliers = await this.repository.exportData(queryFilters);

      return {
        status: true,
        data: suppliers,
        message: 'Suppliers exported successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.exportSuppliers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get data changes for sync
   */
  async getDataChanges(fromDate) {
    try {
      const changes = await this.repository.getDataChanges(fromDate);

      return {
        status: true,
        data: changes,
        message: 'Data changes retrieved successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.getDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update supplier balance
   */
  async updateBalance(supplierId, amount, type = 'add') {
    try {
      const supplier = await this.repository.findById(supplierId);
      if (!supplier) {
        return {
          status: false,
          data: null,
          message: 'Supplier not found',
        };
      }

      const currentBalance = supplier.balance || 0;
      const newBalance = type === 'add' ? currentBalance + amount : currentBalance - amount;

      const updatedSupplier = await this.repository.update(supplierId, {
        balance: newBalance,
      });

      return {
        status: true,
        data: updatedSupplier,
        message: 'Supplier balance updated successfully',
      };
    } catch (error) {
      console.error('Error in SupplierService.updateBalance:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = SupplierService;
