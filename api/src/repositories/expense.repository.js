// src/repositories/expense.repository.js
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

/**
 * Expense Repository
 * Handles all database operations for expenses
 * Follows customer/supplier repository pattern
 */
class ExpenseRepository extends BaseModel {
  constructor() {
    super('expenses');
  }

  /**
   * Find all expenses with pagination and filters
   */
  async findAll(filters = {}, options = {}) {
    const { page = 1, limit = 10, sort = { created_date: -1 } } = options;

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const collection = await this.getCollection(this.collectionName);

    const [expenses, total] = await Promise.all([
      collection
        .find(query)
        .sort(sort)
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: expenses,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find the most recently created expense
   */
  async findLatest() {
    const collection = await this.getCollection(this.collectionName);
    const result = await collection.findOne(
      {
        license: BaseModel.license,
        is_deleted: { $ne: true },
      },
      { sort: { created_date: -1 }, projection: { _id: 1 } }
    );
    return result ? result._id.toString() : null;
  }

  /**
   * Find expense by ID
   */
  async findById(id) {
    const collection = await this.getCollection(this.collectionName);
    return await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
      ...(BaseModel.currentBranch ? { branch_id: BaseModel.currentBranch } : {}),
      is_deleted: { $ne: true },
    });
  }

  /**
   * Create new expense
   */
  async create(expenseData) {
    const collection = await this.getCollection(this.collectionName);

    const now = new Date();

    // Handle date parsing
    let expenseDate = now;
    if (expenseData.date) {
      const parsed = new Date(expenseData.date);
      expenseDate = isNaN(parsed.getTime()) ? now : parsed;
    }

    const document = {
      amount: parseFloat(expenseData.amount),
      type: expenseData.type,
      date: expenseDate,
      category: expenseData.category || '',
      recipientname: expenseData.recipientname || '',
      approvedby: expenseData.approvedby || '',
      description: expenseData.description || '',
      branch_id: expenseData.branch_id,
      branch_name: expenseData.branch_name || '',
      license: BaseModel.license,
      created_date: now,
      updated_date: now,
      created_by: expenseData.created_by || '',
      created_by_id: expenseData.created_by_id || null,
      updated_by: expenseData.created_by || '',
      updated_by_id: expenseData.created_by_id || null,
      is_deleted: false,
    };

    const result = await collection.insertOne(document);
    return await this.findById(result.insertedId);
  }

  /**
   * Update expense
   */
  async update(id, updateData) {
    const collection = await this.getCollection(this.collectionName);

    const now = new Date();

    // Handle date parsing
    let expenseDate;
    if (updateData.date) {
      const parsed = new Date(updateData.date);
      expenseDate = isNaN(parsed.getTime()) ? undefined : parsed;
    }

    const updateFields = {
      updated_date: now,
      updated_by: updateData.updated_by || '',
      updated_by_id: updateData.updated_by_id || null,
    };

    // Only add fields that are provided — never modify created_date/created_by
    if (updateData.amount !== undefined) updateFields.amount = parseFloat(updateData.amount);
    if (updateData.type) updateFields.type = updateData.type;
    if (expenseDate) updateFields.date = expenseDate;
    if (updateData.category !== undefined) updateFields.category = updateData.category;
    if (updateData.recipientname !== undefined)
      updateFields.recipientname = updateData.recipientname;
    if (updateData.approvedby !== undefined) updateFields.approvedby = updateData.approvedby;
    if (updateData.description !== undefined) updateFields.description = updateData.description;

    // Safeguard: ensure created_date is never overwritten during updates
    delete updateFields.created_date;
    delete updateFields.created_by;
    delete updateFields.created_by_id;

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        license: BaseModel.license,
        is_deleted: { $ne: true },
      },
      {
        $set: updateFields,
      },
      { returnDocument: 'after' }
    );

    return result.value;
  }

  /**
   * Hard delete expense (with recycle_bin backup)
   */
  async softDelete(id) {
    const collection = await this.getCollection(this.collectionName);

    // Get document before deletion for backup
    const expense = await collection.findOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    if (expense) {
      // Backup to recycle_bin before deletion
      await BaseModel.deletedDocumentBackup('expenses', expense);
    }

    // Hard delete the document
    const result = await collection.deleteOne({
      _id: new ObjectId(id),
      license: BaseModel.license,
    });

    return result.deletedCount;
  }

  /**
   * Hard delete multiple expenses (with recycle_bin backup)
   */
  async softDeleteMany(ids) {
    const collection = await this.getCollection(this.collectionName);

    const objectIds = ids.map((id) => new ObjectId(id));

    // Get documents before deletion for backup
    const documents = await collection
      .find({
        _id: { $in: objectIds },
        license: BaseModel.license,
      })
      .toArray();

    // Backup each expense to recycle_bin before deletion
    for (const expense of documents) {
      await BaseModel.deletedDocumentBackup('expenses', expense);
    }

    // Hard delete the documents
    const result = await collection.deleteMany({
      _id: { $in: objectIds },
      license: BaseModel.license,
    });

    return result.deletedCount;
  }

  /**
   * Get expense summary/statistics
   */
  async getSummary(filters = {}) {
    const collection = await this.getCollection(this.collectionName);

    const query = {
      ...filters,
      license: BaseModel.license,
      is_deleted: { $ne: true },
    };

    const result = await collection
      .aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' },
          },
        },
      ])
      .toArray();

    if (result.length === 0) {
      return {
        totalAmount: 0,
        count: 0,
        avgAmount: 0,
      };
    }

    return result[0];
  }

  /**
   * Search expenses by query
   */
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 10, branchId = null } = options;

    const query = {
      license: BaseModel.license,
      is_deleted: { $ne: true },
      $or: [
        { category: new RegExp(searchTerm, 'i') },
        { recipientname: new RegExp(searchTerm, 'i') },
        { description: new RegExp(searchTerm, 'i') },
        { type: new RegExp(searchTerm, 'i') },
      ],
    };

    if (branchId) {
      query.branch_id = new ObjectId(branchId);
    }

    const collection = await this.getCollection(this.collectionName);

    const [expenses, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_date: -1 })
        .skip(Math.max(0, (page - 1) * limit))
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return { data: expenses, total };
  }
}

module.exports = ExpenseRepository;
