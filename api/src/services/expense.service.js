// src/services/expense.service.js
const ExpenseRepository = require('../repositories/expense.repository');

/**
 * Expense Service
 * Business logic layer for expense operations
 * Follows customer/supplier service pattern
 */
class ExpenseService {
  constructor() {
    this.repository = new ExpenseRepository();
  }

  /**
   * Get all expenses with pagination and filters
   */
  async getAllExpenses(filters = {}, options = {}) {
    try {
      const [result, lastCreatedId] = await Promise.all([
        this.repository.findAll(filters, options),
        this.repository.findLatest(),
      ]);

      return {
        status: true,
        data: {
          list: result.data,
          total: result.total,
          current_page: result.page,
          per_page: result.limit,
          total_pages: result.totalPages,
          last_created_id: lastCreatedId,
        },
        message: 'Expenses retrieved successfully',
      };
    } catch (error) {
      console.error('Error in ExpenseService.getAllExpenses:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Get expense by ID
   */
  async getExpenseById(id) {
    try {
      const expense = await this.repository.findById(id);

      if (!expense) {
        return {
          status: false,
          data: null,
          message: 'Expense not found',
        };
      }

      return {
        status: true,
        data: expense,
        message: 'Expense retrieved successfully',
      };
    } catch (error) {
      console.error('Error in ExpenseService.getExpenseById:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Create new expense
   */
  async createExpense(expenseData) {
    try {
      // Validate required fields
      if (!expenseData.amount || !expenseData.type) {
        return {
          status: false,
          data: null,
          message: 'Amount and type are required',
        };
      }

      // Create expense
      const expense = await this.repository.create(expenseData);

      return {
        status: true,
        data: expense._id.toString(),
        message: 'Expense added successfully',
      };
    } catch (error) {
      console.error('Error in ExpenseService.createExpense:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update expense
   */
  async updateExpense(id, updateData) {
    try {
      // Check if expense exists
      const existingExpense = await this.repository.findById(id);
      if (!existingExpense) {
        return {
          status: false,
          data: null,
          message: 'Expense not found',
        };
      }

      // Update expense
      const expense = await this.repository.update(id, updateData);

      return {
        status: true,
        data: expense,
        message: 'Expense updated successfully',
      };
    } catch (error) {
      console.error('Error in ExpenseService.updateExpense:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Delete expenses (soft delete)
   */
  async deleteExpenses(ids) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: false,
          data: 0,
          message: 'No expense IDs provided',
        };
      }

      const deletedCount = await this.repository.softDeleteMany(ids);

      return {
        status: true,
        data: deletedCount,
        message: `${deletedCount} expense(s) deleted successfully`,
      };
    } catch (error) {
      console.error('Error in ExpenseService.deleteExpenses:', error);
      return {
        status: false,
        data: 0,
        message: error.message,
      };
    }
  }

  /**
   * Get expense summary/statistics
   */
  async getExpenseSummary(filters = {}) {
    try {
      const summary = await this.repository.getSummary(filters);

      return {
        status: true,
        data: summary,
        message: 'Expense summary retrieved successfully',
      };
    } catch (error) {
      console.error('Error in ExpenseService.getExpenseSummary:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }
}

module.exports = ExpenseService;
