// src/services/category.service.js
const CategoryRepository = require('../repositories/category.repository');
const { Types } = require('mongoose');
const BaseModel = require('../models/base.model');
const {
  sanitizeCategoryData,
  validateCategoryData,
  isCategoryNameUnique,
} = require('../helpers/categories.helper');

/**
 * Category Service
 * Contains business logic for category operations
 * Acts as a bridge between controller and repository
 */
class CategoryService {
  constructor() {
    this.repository = new CategoryRepository();
  }

  /**
   * Get all categories with pagination and filters
   */
  async getAllCategories(filters = {}, options = {}) {
    try {
      const queryFilters = {};

      // Handle single branch_id or multiple branch_ids
      if (filters.branch_id) {
        queryFilters.branch_id = new Types.ObjectId(filters.branch_id);
      } else if (filters.branch_ids && Array.isArray(filters.branch_ids)) {
        queryFilters.branch_id = {
          $in: filters.branch_ids.map((id) => new Types.ObjectId(id)),
        };
      }

      if (filters.license) {
        queryFilters.license = new Types.ObjectId(filters.license);
      }

      if (filters.branch_name) {
        queryFilters.branch_name = filters.branch_name;
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

      if (filters.status && filters.status !== 'all') {
        queryFilters.is_active = filters.status === 'active';
      }

      // Handle date filters - use BaseModel timezone parsing (matches PHP assignDateObject)
      const BaseModel = require('../models/base.model');
      const timeZone = BaseModel.currentTimeZone || 'Asia/Kolkata';

      if (filters.updated_date) {
        queryFilters.updated_date = {};
        if (filters.updated_date.$gte) {
          const gteDate = BaseModel.startingDate(filters.updated_date.$gte.trim(), timeZone);
          console.log(
            'Category Updated Date $gte - Input:',
            filters.updated_date.$gte,
            'Parsed:',
            gteDate
          );
          if (!isNaN(gteDate.getTime())) {
            queryFilters.updated_date.$gte = gteDate;
          }
        }
        if (filters.updated_date.$lte) {
          const lteDate = BaseModel.endingDate(filters.updated_date.$lte.trim(), timeZone);
          console.log(
            'Category Updated Date $lte - Input:',
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
          const gteDate = BaseModel.startingDate(filters.created_date.$gte.trim(), timeZone);
          console.log(
            'Category Created Date $gte - Input:',
            filters.created_date.$gte,
            'Parsed:',
            gteDate
          );
          if (!isNaN(gteDate.getTime())) {
            queryFilters.created_date.$gte = gteDate;
          }
        }
        if (filters.created_date.$lte) {
          const lteDate = BaseModel.endingDate(filters.created_date.$lte.trim(), timeZone);
          console.log(
            'Category Created Date $lte - Input:',
            filters.created_date.$lte,
            'Parsed:',
            lteDate
          );
          if (!isNaN(lteDate.getTime())) {
            queryFilters.created_date.$lte = lteDate;
          }
        }
      }

      console.log('Category Final queryFilters:', JSON.stringify(queryFilters, null, 2));

      const result = await this.repository.findAll(queryFilters, options);

      return {
        status: true,
        data: result,
        message: 'Categories retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getAllCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get category by ID
   */
  async getCategoryById(id) {
    try {
      const category = await this.repository.findById(id);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      return {
        status: true,
        data: category,
        message: 'Category retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getCategoryById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get category with item count
   */
  async getCategoryWithItemCount(id) {
    try {
      const category = await this.repository.getCategoryWithItemCount(id);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      return {
        status: true,
        data: category,
        message: 'Category retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getCategoryWithItemCount:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create new category
   * Includes validation and business rules
   */
  async createCategory(categoryData) {
    try {
      // Validate required fields
      if (!categoryData.name) {
        return {
          status: false,
          data: null,
          message: 'Category name is required',
        };
      }

      if (!categoryData.branch_id) {
        return {
          status: false,
          data: null,
          message: 'Branch ID is required',
        };
      }

      // Validate category data
      const validation = validateCategoryData(categoryData);
      if (!validation.valid) {
        return {
          status: false,
          data: null,
          message: validation.errors.join(', '),
        };
      }

      // Check for duplicate name in same branch
      const isUnique = await isCategoryNameUnique(
        categoryData.name,
        categoryData.branch_id,
        null,
        this.repository.findByName.bind(this.repository)
      );

      if (!isUnique) {
        return {
          status: false,
          data: null,
          message: 'Category with this name already exists in this branch',
        };
      }

      // Sanitize data
      const sanitizedData = sanitizeCategoryData(categoryData);

      // Create category
      const category = await this.repository.create(sanitizedData);

      return {
        status: true,
        data: category,
        message: 'Category created successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.createCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update category
   */
  async updateCategory(id, updateData) {
    try {
      // Check if category exists
      const existingCategory = await this.repository.findById(id);
      if (!existingCategory) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      // Check for duplicate name if name is being updated
      if (updateData.name && updateData.name !== existingCategory.name) {
        const isUnique = await isCategoryNameUnique(
          updateData.name,
          existingCategory.branch_id,
          id,
          this.repository.findByName.bind(this.repository)
        );

        if (!isUnique) {
          return {
            status: false,
            data: null,
            message: 'Category with this name already exists in this branch',
          };
        }
      }

      // Sanitize data
      const sanitizedData = sanitizeCategoryData(updateData);

      // Update category
      const updatedCategory = await this.repository.update(id, sanitizedData);

      return {
        status: true,
        data: updatedCategory,
        message: 'Category updated successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.updateCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete category (soft delete)
   */
  async deleteCategory(id) {
    try {
      const category = await this.repository.findById(id);
      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      // PHP backend allows deleting categories even when items exist.
      // For compatibility, do not block deletion based on associated items
      // in the Node service. Perform the delete operation directly.
      const deletedCategory = await this.repository.softDelete(id);

      return {
        status: true,
        data: deletedCategory,
        // Match legacy PHP wording used by the categories controller
        message: 'category deleted successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.deleteCategory:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk delete categories (hard delete with backup)
   */
  async bulkDeleteCategories(ids) {
    try {
      if (!ids || ids.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No category IDs provided',
        };
      }

      // PHP backend deletes categories without checking for associated items.
      // For compatibility, perform the hard delete directly and report how
      // many categories were removed.
      const result = await this.repository.bulkHardDelete(ids);

      return {
        status: true,
        // Match PHP response: data is the numeric deleted count
        data: result.deletedCount,
        // Use the same success message text as the legacy PHP API
        message: 'category deleted successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.bulkDeleteCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Search categories
   */
  async searchCategories(searchTerm, options = {}) {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        return this.getAllCategories({}, options);
      }

      const result = await this.repository.search(searchTerm, options);

      return {
        status: true,
        data: result,
        message: 'Search completed successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.searchCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get categories by branch
   */
  async getCategoriesByBranch(branchId, activeOnly = false, license = null) {
    try {
      const categories = await this.repository.findByBranch(branchId, { activeOnly, license });

      return {
        status: true,
        data: categories,
        message: 'Categories retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getCategoriesByBranch:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get categories by branch that have items
   * Mirrors legacy PHP categoryListWithValidItems which filters by both
   * branch and license and only returns categories that actually have
   * sellable items.
   */
  async getCategoriesWithItems(branchId, activeOnly = false, licenseId = null) {
    try {
      const categories = await this.repository.findByBranchWithItems(branchId, {
        activeOnly,
        license: licenseId,
      });

      return {
        status: true,
        data: categories,
        message: 'Categories with items retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getCategoriesWithItems:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get active categories for dropdown
   */
  async getActiveCategories(branchId) {
    try {
      const categories = await this.repository.getActiveCategories(branchId);

      return {
        status: true,
        data: categories,
        message: 'Active categories retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getActiveCategories:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Bulk import categories
   */
  async bulkImport(categoriesData) {
    try {
      if (!categoriesData || categoriesData.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No category data provided',
        };
      }

      const baseModel = new BaseModel();
      const maxImport = await baseModel.checkPlan('categories', 'import');
      const count =
        maxImport > 0 ? Math.min(maxImport, categoriesData.length) : categoriesData.length;

      const limitedCategories = categoriesData.slice(0, count);

      const uniqueValue = [];
      const seenRecords = new Set();

      for (const category of limitedCategories) {
        const normalized = Object.keys(category || {})
          .sort()
          .reduce((acc, key) => {
            acc[key] = category[key];
            return acc;
          }, {});
        const uniqueKey = JSON.stringify(normalized);
        if (!seenRecords.has(uniqueKey)) {
          seenRecords.add(uniqueKey);
          uniqueValue.push(category);
        }
      }

      const uniqueCSVRecords = {};
      for (const category of uniqueValue) {
        const normalizedCategory = {
          ...category,
          name: category?.name || '',
          discount_amount: category?.discount_amount ?? '',
          discount_percentage: category?.discount_percentage ?? '',
        };
        const key = normalizedCategory.name || '';
        if (!uniqueCSVRecords[key]) {
          uniqueCSVRecords[key] = normalizedCategory;
        }
      }

      const validationErrors = [];
      const requiredFields = ['name', 'discount_amount', 'discount_percentage'];

      Object.values(uniqueCSVRecords).forEach((category) => {
        const errorFields = [];
        requiredFields.forEach((field) => {
          const value = category[field];
          if ((value === undefined || value === null || value === '') && value !== '0') {
            errorFields.push(field);
          }
        });

        const discountAmount = parseFloat(category.discount_amount) || 0;
        const discountPercentage = parseFloat(category.discount_percentage) || 0;
        if (discountAmount > 0 && discountPercentage > 0) {
          errorFields.push('Provide either a discount amount or percentage, not both or none');
        }

        if (errorFields.length > 0) {
          validationErrors.push({
            ...category,
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

      for (const category of Object.values(uniqueCSVRecords)) {
        if (!category.name) {
          continue;
        }

        const existingCategory = await this.repository.findByNameBranchLicense(
          category.name,
          category.branch_id || BaseModel.currentBranch,
          category.license
        );

        if (existingCategory) {
          alreadyData.push({
            name: existingCategory.name,
            discount_amount: existingCategory.discount_amount,
            discount_percentage: existingCategory.discount_percentage,
            description: existingCategory.description || '',
          });
        } else {
          const sanitized = sanitizeCategoryData(category);
          if (category.branch_id) sanitized.branch_id = category.branch_id;
          if (category.branch_name) sanitized.branch_name = category.branch_name;
          if (category.created_by) sanitized.created_by = category.created_by;
          if (category.created_by_id) sanitized.created_by_id = category.created_by_id;
          if (category.license) sanitized.license = category.license;
          newData.push(sanitized);
        }
      }

      if (newData.length === 0) {
        return {
          status: false,
          data: alreadyData,
          message: 'All categories are already imported',
        };
      }

      const result = await this.repository.bulkCreate(newData);

      const responseData = result.map((doc) => ({
        name: doc.name || '',
        discount_amount: doc.discount_amount || 0,
        discount_percentage: doc.discount_percentage || 0,
        description: doc.description || '',
        status: 'Imported',
      }));

      return {
        status: true,
        data: responseData,
        message: 'Category data imported successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.bulkImport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Export categories data
   */
  async exportCategories(filters = {}) {
    try {
      const queryFilters = {};

      if (filters.branch_id) {
        queryFilters.branch_id = new Types.ObjectId(filters.branch_id);
      }

      const categories = await this.repository.exportData(queryFilters);

      return {
        status: true,
        data: categories,
        message: 'Categories exported successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.exportCategories:', error);
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
  async getDataChanges(fromDate, branchId) {
    try {
      const changes = await this.repository.getDataChanges(fromDate, branchId);

      return {
        status: true,
        data: changes,
        message: 'Data changes retrieved successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.getDataChanges:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Toggle category active status
   */
  async toggleActive(id) {
    try {
      const category = await this.repository.toggleActive(id);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      return {
        status: true,
        data: category,
        message: `Category ${category.is_active ? 'activated' : 'deactivated'} successfully`,
      };
    } catch (error) {
      console.error('Error in CategoryService.toggleActive:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update category sort order
   */
  async updateSortOrder(id, sortOrder) {
    try {
      const category = await this.repository.updateSortOrder(id, sortOrder);

      if (!category) {
        return {
          status: false,
          data: null,
          message: 'Category not found',
        };
      }

      return {
        status: true,
        data: category,
        message: 'Sort order updated successfully',
      };
    } catch (error) {
      console.error('Error in CategoryService.updateSortOrder:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = CategoryService;
