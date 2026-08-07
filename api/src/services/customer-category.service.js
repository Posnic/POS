const { searchPattern } = require('../utils/safe-search');
// src/services/customer-category.service.js
const CustomerCategoryRepository = require('../repositories/customer-category.repository');
const { ObjectId } = require('mongodb');

/**
 * Customer Category Service
 * Contains business logic for customer category operations
 * Acts as a bridge between controller and repository
 */
class CustomerCategoryService {
  constructor() {
    this.repository = new CustomerCategoryRepository();
  }

  /**
   * Get all customer categories with pagination and filters
   */
  async getAllCustomerCategories(filters = {}, options = {}) {
    try {
      const queryFilters = {};

      if (filters.branch_id) {
        queryFilters.branch_id = new ObjectId(filters.branch_id);
      }

      // Handle name filter with regex
      if (filters.name) {
        if (typeof filters.name === 'object' && filters.name.$regex) {
          // Convert lookahead regex (?=.*word) to simple word matching
          const regexPattern = filters.name.$regex;

          // Extract words from lookahead pattern: (?=.*service)(?=.*man) -> service|man
          const words = regexPattern.match(/\(\?=\.\*([^)]+)\)/g);
          if (words && words.length > 0) {
            // Extract the actual words and create an $and condition
            const wordPatterns = words.map((w) => {
              const word = w.replace(/\(\?=\.\*|\)/g, '');
              return { name: { $regex: searchPattern(word), $options: 'i' } };
            });
            // Use $and to match all words
            if (!queryFilters.$and) {
              queryFilters.$and = [];
            }
            queryFilters.$and.push(...wordPatterns);
          } else {
            // Simple regex pattern
            queryFilters.name = {
              $regex: regexPattern,
              $options: filters.name.$options || 'i',
            };
          }
        } else if (typeof filters.name === 'string') {
          queryFilters.name = { $regex: filters.name, $options: 'i' };
        } else {
          queryFilters.name = filters.name;
        }
      }

      // Handle description filter with regex
      if (filters.description) {
        if (filters.description.$regex) {
          queryFilters.description = {
            $regex: filters.description.$regex.replace(/\(\?=\.\*|\)/g, ''),
            $options: filters.description.$options || 'i',
          };
        } else {
          queryFilters.description = new RegExp(filters.description, 'i');
        }
      }

      // Handle simple search (fallback - searches across all fields)
      if (filters.search && !filters.name && !filters.description) {
        queryFilters.$or = [
          { name: new RegExp(filters.search, 'i') },
          { description: new RegExp(filters.search, 'i') },
        ];
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
        message: 'Customer categories retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.getAllCustomerCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get customer category by ID
   */
  async getCustomerCategoryById(id) {
    try {
      const category = await this.repository.findById(id);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Customer category not found',
        };
      }

      return {
        status: true,
        data: category,
        message: 'Customer category retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.getCustomerCategoryById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create new customer category
   * Includes validation and business rules
   */
  async createCustomerCategory(categoryData) {
    try {
      // Validate required fields
      if (!categoryData.name) {
        return {
          status: false,
          data: null,
          message: 'Customer category name is required',
        };
      }

      if (!categoryData.branch_id) {
        return {
          status: false,
          data: null,
          message: 'Branch ID is required',
        };
      }

      // Check for duplicate name in same branch
      const existing = await this.repository.findByName(categoryData.name, categoryData.branch_id);
      if (existing) {
        return {
          status: false,
          data: null,
          message: 'This category details already exist in our system',
        };
      }

      // Create category
      const category = await this.repository.create(categoryData);

      return {
        status: true,
        data: category,
        message: 'Customer category created successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.createCustomerCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update customer category
   */
  async updateCustomerCategory(id, updateData) {
    try {
      // Check if category exists
      const existing = await this.repository.findById(id);
      if (!existing) {
        return {
          status: false,
          data: null,
          message: 'Customer category not found',
        };
      }

      // Check for duplicate name if name is being updated
      if (updateData.name && updateData.name !== existing.name) {
        const duplicate = await this.repository.findByName(updateData.name, existing.branch_id);
        if (duplicate && duplicate._id.toString() !== id) {
          return {
            status: false,
            data: null,
            message: 'This category details already exist in our system',
          };
        }
      }

      // Update category
      const category = await this.repository.update(id, updateData);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Failed to update customer category',
        };
      }

      return {
        status: true,
        data: category,
        message: 'Customer category updated successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.updateCustomerCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete customer category
   */
  async deleteCustomerCategory(id) {
    try {
      const deletedCount = await this.repository.softDelete(id);

      if (deletedCount === 0) {
        return {
          status: false,
          data: null,
          message: 'Customer category not found',
        };
      }

      return {
        status: true,
        data: { deletedCount },
        message: 'Customer category deleted successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.deleteCustomerCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete multiple customer categories
   */
  async deleteCustomerCategories(ids) {
    try {
      const deletedCount = await this.repository.softDeleteMany(ids);

      return {
        status: true,
        data: { deletedCount },
        // Match legacy PHP message used by the customerCategory controller
        message: 'Customer category deleted successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.deleteCustomerCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk import customer categories
   */
  async bulkImport(categoriesData) {
    try {
      const alreadyExists = [];
      const newData = [];
      const insertedRecords = [];

      // Check for duplicates
      for (const categoryData of categoriesData) {
        const existing = await this.repository.findByName(
          categoryData.name,
          categoryData.branch_id
        );

        if (existing) {
          alreadyExists.push({
            name: existing.name,
            description: existing.description || '',
          });
        } else {
          newData.push(categoryData);
        }
      }

      // If no new data to import
      if (newData.length === 0) {
        return {
          status: false,
          data: alreadyExists,
          message: 'Customer category data already imported',
        };
      }

      // Insert new records
      for (const categoryData of newData) {
        const inserted = await this.repository.create(categoryData);
        if (inserted) {
          insertedRecords.push({
            name: inserted.name,
            description: inserted.description || '',
          });
        }
      }

      return {
        status: true,
        data: insertedRecords,
        message: 'Customer category data imported successfully',
      };
    } catch (error) {
      console.error('Error in CustomerCategoryService.bulkImport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = CustomerCategoryService;
