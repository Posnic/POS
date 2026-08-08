// src/models/Category.js
const mongoose = require('mongoose');
const { defineModel } = require('../db/model-registry');
const BaseModel = require('./base.model');

const categorySchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
    },
    branch_name: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    discount_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount_percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    image: {
      type: String,
      trim: true,
    },
    created_by: {
      type: String,
      trim: true,
    },
    created_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updated_by: {
      type: String,
      trim: true,
    },
    updated_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    license: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'License',
      required: false,
    },
  },
  {
    timestamps: {
      createdAt: 'created_date',
      updatedAt: 'updated_date',
    },
  }
);

// Add text index for search
categorySchema.index({ name: 'text', description: 'text' });

// Add compound index for unique category name per branch
categorySchema.index({ name: 1, branch_id: 1 }, { unique: true });

// Pre-save hook to validate discount fields
categorySchema.pre('save', function () {
  if (this.discount_amount > 0 && this.discount_percentage > 0) {
    throw new Error('Cannot set both discount_amount and discount_percentage');
  }
});

// Static methods
categorySchema.statics = {
  // Find categories by branch with pagination
  async findCategories({ branch_id, page = 1, limit = 10, search = '', status = 'active' }) {
    const query = { branch_id };

    // Add search condition
    if (search) {
      query.$text = { $search: search };
    }

    // Add status filter
    if (status === 'active' || status === 'inactive') {
      query.is_active = status === 'active';
    }

    const [categories, total] = await Promise.all([
      this.find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.countDocuments(query),
    ]);

    return {
      data: categories,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Check if category name is unique within a branch
  async isNameUnique(name, branch_id, excludeId = null) {
    const query = { name, branch_id };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    const count = await this.countDocuments(query);
    return count === 0;
  },

  // Import categories from CSV/Excel (legacy PHP: importCategoryModel)
  async importCategoryModel(rows, user = {}) {
    try {
      if (!Array.isArray(rows) || rows.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No categories to import',
        };
      }

      const branch_id =
        user.branch_id ||
        user.branch ||
        user.default_branch_id ||
        (user.branch && user.branch._id) ||
        null;

      const branch_name =
        user.branch_name ||
        (user.branch && (user.branch.branch_name || user.branch.name)) ||
        'Default Branch';

      const created_by = user.username || user.email || user.name || '';
      const created_by_id = user._id || user.id || null;

      if (!branch_id) {
        return {
          status: false,
          data: null,
          message: 'Branch context is missing for import',
        };
      }

      // Step 1: Deduplicate by name (case-insensitive)
      const uniqueByName = new Map();
      for (const row of rows) {
        const name = (row.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!uniqueByName.has(key)) {
          uniqueByName.set(key, row);
        }
      }

      const records = Array.from(uniqueByName.values());

      // Step 2: Validate fields & collect CSV-style errors
      const validationErrors = [];
      const validRecords = [];

      for (const row of records) {
        const name = (row.name || '').trim();
        const description = (row.description || '').trim();

        const discount_amount_raw =
          row.discount_amount !== undefined && row.discount_amount !== null
            ? String(row.discount_amount).trim()
            : '0';
        const discount_percentage_raw =
          row.discount_percentage !== undefined && row.discount_percentage !== null
            ? String(row.discount_percentage).trim()
            : '0';

        const discount_amount = Number(discount_amount_raw) || 0;
        const discount_percentage = Number(discount_percentage_raw) || 0;

        const errorFields = [];

        if (!name) {
          errorFields.push('name');
        }

        // Both discount fields set (>0) is not allowed
        if (discount_amount > 0 && discount_percentage > 0) {
          errorFields.push('Provide either a discount amount or percentage, not both');
        }

        if (errorFields.length > 0) {
          validationErrors.push({
            ...row,
            status: errorFields.join(', '),
          });
        } else {
          validRecords.push({
            name,
            description,
            discount_amount,
            discount_percentage,
          });
        }
      }

      // If there are validation errors, return them with CSV marker (matches PHP)
      if (validationErrors.length > 0) {
        return {
          status: true,
          data: validationErrors,
          message: 'CSV',
        };
      }

      if (validRecords.length === 0) {
        return {
          status: false,
          data: null,
          message: 'No valid category rows to import',
        };
      }

      // Step 3: Split into already-existing vs new categories
      const names = validRecords.map((r) => r.name);
      const existing = await this.find({
        branch_id,
        name: { $in: names },
      })
        .select('name discount_amount discount_percentage description')
        .lean();

      const existingByName = new Map(existing.map((doc) => [doc.name, doc]));

      const alreadyData = [];
      const newDocs = [];

      for (const row of validRecords) {
        const existingDoc = existingByName.get(row.name);
        if (existingDoc) {
          alreadyData.push({
            name: existingDoc.name,
            discount_amount: existingDoc.discount_amount,
            discount_percentage: existingDoc.discount_percentage,
            description: existingDoc.description || '',
          });
        } else {
          newDocs.push(row);
        }
      }

      if (newDocs.length === 0) {
        return {
          status: false,
          data: alreadyData,
          message: 'All categories are already imported',
        };
      }

      // Step 4: Prepare documents for insertion
      const now = new Date();
      const docsToInsert = newDocs.map((row) => ({
        branch_id,
        branch_name,
        name: row.name,
        description: row.description || '',
        discount_amount: row.discount_amount || 0,
        discount_percentage: row.discount_percentage || 0,
        image: row.image || 'category.svg',
        created_by: created_by,
        created_by_id: created_by_id,
        updated_by: created_by,
        updated_by_id: created_by_id,
        created_date: now,
        updated_date: now,
      }));

      const inserted = await this.insertMany(docsToInsert);

      const responseData = inserted.map((doc) => ({
        name: doc.name,
        discount_amount: doc.discount_amount,
        discount_percentage: doc.discount_percentage,
        description: doc.description || '',
      }));

      return {
        status: true,
        data: responseData,
        message: 'Category data imported successfully',
      };
    } catch (error) {
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  },
};

// Instance methods
categorySchema.methods = {
  // Toggle active status
  async toggleStatus(userId) {
    this.is_active = !this.is_active;
    this.updated_by = userId;
    return this.save();
  },
};

module.exports = defineModel('Category', categorySchema);
