// src/services/customer.service.js
const CustomerRepository = require('../repositories/customer.repository');
const { ObjectId } = require('mongodb');

/**
 * Customer Service
 * Contains business logic for customer operations
 * Acts as a bridge between controller and repository
 */
class CustomerService {
  constructor() {
    this.repository = new CustomerRepository();
  }

  /**
   * Get all customers with pagination and filters
   */
  async getAllCustomers(filters = {}, options = {}) {
    try {
      // Build query filters
      const queryFilters = {};

      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      // Handle name filter with regex
      if (filters.name) {
        if (filters.name.$regex) {
          // Complex regex from frontend
          queryFilters.name = {
            $regex: filters.name.$regex.replace(/\(\?=\.\*|\)/g, ''), // Clean up lookahead
            $options: filters.name.$options || 'i',
          };
        } else {
          // Simple string search
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
          console.log('Updated Date $gte - Input:', filters.updated_date.$gte, 'Parsed:', gteDate);
          if (!isNaN(gteDate.getTime())) {
            queryFilters.updated_date.$gte = gteDate;
          }
        }
        if (filters.updated_date.$lte) {
          const lteDate = new Date(filters.updated_date.$lte.trim());
          console.log('Updated Date $lte - Input:', filters.updated_date.$lte, 'Parsed:', lteDate);
          if (!isNaN(lteDate.getTime())) {
            queryFilters.updated_date.$lte = lteDate;
          }
        }
      }

      if (filters.created_date) {
        queryFilters.created_date = {};
        if (filters.created_date.$gte) {
          const gteDate = new Date(filters.created_date.$gte.trim());
          console.log('Created Date $gte - Input:', filters.created_date.$gte, 'Parsed:', gteDate);
          if (!isNaN(gteDate.getTime())) {
            queryFilters.created_date.$gte = gteDate;
          }
        }
        if (filters.created_date.$lte) {
          const lteDate = new Date(filters.created_date.$lte.trim());
          console.log('Created Date $lte - Input:', filters.created_date.$lte, 'Parsed:', lteDate);
          if (!isNaN(lteDate.getTime())) {
            queryFilters.created_date.$lte = lteDate;
          }
        }
      }

      if (filters.tier) {
        queryFilters['loyalty.tier'] = filters.tier;
      }

      console.log('Final queryFilters:', JSON.stringify(queryFilters, null, 2));

      const result = await this.repository.findAll(queryFilters, options);

      return {
        status: true,
        data: result,
        message: 'Customers retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getAllCustomers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer by ID
   */
  async getCustomerById(id) {
    try {
      const customer = await this.repository.findById(id);

      if (!customer) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      // Ensure country/state/city fields exist with defaults
      if (!customer.country) customer.country = 'India';
      if (!customer.state) customer.state = '';
      if (!customer.city) customer.city = '';

      return {
        status: true,
        data: customer,
        message: 'Customer retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getCustomerById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create new customer
   * Includes validation and business rules
   */
  async createCustomer(customerData) {
    try {
      // Validate required fields
      if (!customerData.name) {
        return {
          status: false,
          data: null,
          message: 'Customer name is required',
        };
      }

      // Check for duplicate email (only if email is provided)
      if (customerData.email) {
        const existingByEmail = await this.repository.findByEmail(customerData.email);
        if (existingByEmail) {
          return {
            status: false,
            data: null,
            message: 'Customer with this email already exists',
          };
        }
      }

      // Check for duplicate phone (only if phone is provided)
      if (customerData.phone) {
        const existingByPhone = await this.repository.findByPhone(customerData.phone);
        if (existingByPhone) {
          return {
            status: false,
            data: null,
            message: 'Customer with this phone number already exists',
          };
        }
      }

      // Initialize loyalty program if enabled
      if (customerData.enableLoyalty) {
        customerData.loyalty = {
          points: 0,
          tier: 'bronze',
          joinDate: new Date(),
        };
      }

      // Create customer
      const customer = await this.repository.create(customerData);

      return {
        status: true,
        data: customer,
        message: 'Customer created successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.createCustomer:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update customer
   */
  async updateCustomer(id, updateData) {
    try {
      // Check if customer exists
      const existing = await this.repository.findById(id);
      if (!existing) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      // Check for duplicate email if email is being updated
      if (updateData.email && updateData.email !== existing.email) {
        const existingByEmail = await this.repository.findByEmail(updateData.email);
        if (existingByEmail && existingByEmail._id.toString() !== id) {
          return {
            status: false,
            data: null,
            message: 'Another customer with this email already exists',
          };
        }
      }

      // Check for duplicate phone if phone is being updated
      if (updateData.phone && updateData.phone !== existing.phone) {
        const existingByPhone = await this.repository.findByPhone(updateData.phone);
        if (existingByPhone && existingByPhone._id.toString() !== id) {
          return {
            status: false,
            data: null,
            message: 'Another customer with this phone number already exists',
          };
        }
      }

      // Update customer
      const updateResult = await this.repository.update(id, updateData);

      // Fetch the updated customer to return
      const customer = await this.repository.findById(id);

      return {
        status: true,
        data: customer,
        message: 'Customer updated successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.updateCustomer:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete customer (soft delete)
   */
  async deleteCustomer(id) {
    try {
      // Check if customer exists
      const existing = await this.repository.findById(id);
      if (!existing) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      // Soft delete
      const customer = await this.repository.softDelete(id);

      return {
        status: true,
        data: customer,
        message: 'Customer deleted successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.deleteCustomer:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk delete customers
   */
  async bulkDeleteCustomers(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'Invalid customer IDs',
        };
      }

      const result = await this.repository.bulkSoftDelete(ids);

      return {
        status: true,
        data: { deletedCount: result.modifiedCount },
        // Match legacy PHP wording used by the customers controller
        message: 'Customer deleted successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.bulkDeleteCustomers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Search customers
   */
  async searchCustomers(searchTerm, options = {}) {
    try {
      if (!searchTerm) {
        return {
          status: false,
          data: null,
          message: 'Search term is required',
        };
      }

      const result = await this.repository.search(searchTerm, options);

      return {
        status: true,
        data: result,
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.searchCustomers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer summary with sales statistics
   */
  async getCustomerSummary(id) {
    try {
      const summary = await this.repository.getSummary(id);

      if (!summary) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      return {
        status: true,
        data: summary,
        message: 'Customer summary retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getCustomerSummary:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customers by loyalty tier
   */
  async getCustomersByTier(tier, options = {}) {
    try {
      const validTiers = ['bronze', 'silver', 'gold', 'platinum'];
      if (!validTiers.includes(tier)) {
        return {
          status: false,
          data: null,
          message: 'Invalid loyalty tier',
        };
      }

      const result = await this.repository.findByLoyaltyTier(tier, options);

      return {
        status: true,
        data: result,
        message: 'Customers retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getCustomersByTier:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Add loyalty points to customer
   * Includes tier upgrade logic
   */
  async addLoyaltyPoints(id, points, reason = '') {
    try {
      if (!points || points <= 0) {
        return {
          status: false,
          data: null,
          message: 'Invalid points amount',
        };
      }

      const customer = await this.repository.updateLoyaltyPoints(id, points, 'add');

      if (!customer) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      // Check for tier upgrade
      const newTier = this.calculateLoyaltyTier(customer.loyalty?.points || 0);
      if (newTier !== customer.loyalty?.tier) {
        await this.repository.update(id, {
          'loyalty.tier': newTier,
        });
      }

      return {
        status: true,
        data: customer,
        message: `${points} loyalty points added successfully`,
      };
    } catch (error) {
      console.error('Error in CustomerService.addLoyaltyPoints:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Redeem loyalty points
   */
  async redeemLoyaltyPoints(id, points) {
    try {
      if (!points || points <= 0) {
        return {
          status: false,
          data: null,
          message: 'Invalid points amount',
        };
      }

      // Check if customer has enough points
      const existing = await this.repository.findById(id);
      if (!existing) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      const currentPoints = existing.loyalty?.points || 0;
      if (currentPoints < points) {
        return {
          status: false,
          data: null,
          message: 'Insufficient loyalty points',
        };
      }

      const customer = await this.repository.updateLoyaltyPoints(id, points, 'redeem');

      return {
        status: true,
        data: customer,
        message: `${points} loyalty points redeemed successfully`,
      };
    } catch (error) {
      console.error('Error in CustomerService.redeemLoyaltyPoints:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Calculate loyalty tier based on points
   */
  calculateLoyaltyTier(points) {
    if (points >= 10000) return 'platinum';
    if (points >= 5000) return 'gold';
    if (points >= 1000) return 'silver';
    return 'bronze';
  }

  /**
   * Get customer outstanding report
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
      console.error('Error in CustomerService.getOutstandingReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get data changes for synchronization
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
      console.error('Error in CustomerService.getDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk import customers
   */
  async importCustomers(customersData, branchId) {
    try {
      if (!Array.isArray(customersData) || customersData.length === 0) {
        return {
          status: false,
          data: null,
          message: 'Invalid import data',
        };
      }

      // Check for duplicates in database (matching PHP implementation)
      const alreadyExists = [];
      const newCustomers = [];
      const errors = [];

      for (let i = 0; i < customersData.length; i++) {
        const customer = customersData[i];

        if (!customer.name || !customer.phone) {
          errors.push(`Row ${i + 1}: Name and phone are required`);
          continue;
        }

        // Check if customer already exists with same name and phone in this branch
        const existing = await this.repository.findByNameAndPhone(
          customer.name,
          customer.phone,
          branchId
        );

        if (existing) {
          alreadyExists.push({
            name: existing.name,
            phone: existing.phone,
            email: existing.email || '',
            address: existing.address || '',
            status: 'Already exists',
          });
        } else {
          newCustomers.push(customer);
        }
      }

      if (newCustomers.length === 0) {
        return {
          status: false,
          data: alreadyExists,
          message: 'All customers are already imported',
        };
      }

      const result = await this.repository.bulkCreate(newCustomers);

      // Format response data for frontend table display
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
        message: `${result.length} customers imported successfully`,
      };
    } catch (error) {
      console.error('Error in CustomerService.importCustomers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export customers data
   */
  async exportCustomers(filters = {}) {
    try {
      const queryFilters = {};

      // Handle IDs filter for specific customer export
      if (filters.ids && Array.isArray(filters.ids) && filters.ids.length > 0) {
        queryFilters._id = { $in: filters.ids.map((id) => new ObjectId(id)) };
      }

      // Handle branch filter
      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      const customers = await this.repository.exportData(queryFilters);

      return {
        status: true,
        data: customers,
        message: 'Customers exported successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.exportCustomers:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer payment details
   */
  async getPaymentDetails(id) {
    try {
      const details = await this.repository.getPaymentDetails(id);

      return {
        status: true,
        data: details,
        message: 'Payment details retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getPaymentDetails:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer transactions
   */
  async getTransactions(id, options = {}) {
    try {
      const transactions = await this.repository.getTransactions(id, options);

      return {
        status: true,
        data: transactions,
        message: 'Transactions retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.getTransactions:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update customer preferences
   */
  async updatePreferences(id, preferences) {
    try {
      const customer = await this.repository.update(id, { preferences });

      if (!customer) {
        return {
          status: false,
          data: null,
          message: 'Customer not found',
        };
      }

      return {
        status: true,
        data: customer,
        message: 'Preferences updated successfully',
      };
    } catch (error) {
      console.error('Error in CustomerService.updatePreferences:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer graphical reports (sales by day of week)
   * PHP: customer_model.php -> getCustomerGraphicalReports()
   */
  async getCustomerGraphicalReports(params) {
    try {
      const result = await this.repository.getCustomerGraphicalReports(params);
      return result;
    } catch (error) {
      console.error('Error in CustomerService.getCustomerGraphicalReports:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer outstanding report
   * PHP: customer_model.php -> customerOutstandingReportPage()
   */
  async getCustomerOutstandingReport(params) {
    try {
      const result = await this.repository.getCustomerOutstandingReport(params);
      return result;
    } catch (error) {
      console.error('Error in CustomerService.getCustomerOutstandingReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = CustomerService;
