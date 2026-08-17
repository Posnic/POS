const mongoose = require('mongoose');
const { defineModel, getModel } = require('../db/model-registry');
const { currentConnection } = require('../db/tenant-context');
const { mergeAccess, sanitizePosInput } = require('../utils/access-resolver');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const ACL_MODULES = [
  'dashboard',
  'sales',
  'receiving',
  'customer',
  'supplier',
  'category',
  'item',
  'expense',
  'branch',
  'report',
  'user',
];

const createDefaultAccess = () => {
  const matrix = {};
  ACL_MODULES.forEach((module) => {
    matrix[module] = {
      read: false,
      write: false,
      delete: false,
    };
  });
  return matrix;
};

// Define the user schema
const userSchema = new mongoose.Schema(
  {
    // PHP: firstname
    firstname: {
      type: String,
      trim: true,
      maxlength: [20, 'First name cannot be more than 20 characters'],
    },
    // PHP: lastname
    lastname: {
      type: String,
      trim: true,
      maxlength: [20, 'Last name cannot be more than 20 characters'],
    },
    // PHP: username
    username: {
      type: String,
      trim: true,
      maxlength: [30, 'Username cannot be more than 30 characters'],
    },
    // Legacy name field for compatibility
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Name cannot be more than 100 characters'],
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (email) {
          if (!email) return true; // Allow empty for API users
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(email);
        },
        message: 'Please provide a valid email address',
      },
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      select: false,
    },
    // PHP: usertype (admin, super_admin, cashier, api, etc.)
    usertype: {
      type: String,
      default: 'staff',
    },
    // Legacy role field for compatibility
    role: {
      type: String,
      enum: {
        values: ['admin', 'manager', 'cashier', 'staff', 'super_admin', 'api'],
        message: 'Role must be one of: admin, manager, cashier, staff, super_admin, api',
      },
      default: 'staff',
    },
    // PHP: license
    license: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'License',
      select: false,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    branch_access: {
      // PHP line 184: ['branch_id' => new MongoDB\BSON\ObjectID(...), 'branch_name' => ..., 'branch_image' => ...]
      type: [
        {
          branch_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
          },
          branch_name: {
            type: String,
            required: true,
          },
          branch_image: {
            type: String,
            default: '',
          },
        },
      ],
      // Note: Do not use required:true at schema level - it conflicts with document creation
      // Validation is enforced by:
      // 1. Controller validation (lines 174-182)
      // 2. Model validation (lines 955-962, 1050-1058)
      // 3. Pre-save hooks (lines 456-479)
      // TEMPORARILY DISABLED to debug data flow
      // validate: {
      //   validator: function(v) {
      //     return Array.isArray(v) && v.length > 0;
      //   },
      //   message: 'At least one branch must be assigned to the user'
      // },
    },
    printing_design: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // PHP: image
    image: {
      type: String,
      default: 'user.svg',
    },
    profileImage: {
      type: String,
      default: 'default.jpg',
    },
    // PHP: activate
    activate: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      select: false,
    },
    // PHP: apikey (for API users)
    apikey: {
      type: String,
    },
    // PHP: userkey (for password reset)
    userkey: {
      type: String,
      select: false,
    },
    // PHP: expire_date (for password reset link expiry)
    expire_date: {
      type: Date,
      select: false,
    },
    // PHP: register_status
    register_status: {
      type: String,
      default: 'Closed',
    },
    // PHP: register_id
    register_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Register',
    },
    // PHP: register_name
    register_name: {
      type: String,
    },
    // PHP: current_registerid
    current_registerid: {
      type: mongoose.Schema.Types.ObjectId,
    },
    // PHP: activeregister_id
    activeregister_id: {
      type: String,
    },
    // PHP: activeregister_name
    activeregister_name: {
      type: String,
    },
    // PHP: registers
    registers: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // PHP: register_opendate
    register_opendate: {
      type: Date,
    },
    // PHP: register_closedate
    register_closedate: {
      type: Date,
    },
    // PHP: opening_float
    opening_float: {
      type: String,
    },
    // PHP: plan
    plan: {
      type: mongoose.Schema.Types.Mixed,
      default: { name: 'premium', max_sales: 'unlimited' },
    },
    // PHP: plan_access
    plan_access: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // PHP: preference
    preference: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // User preferences (plural) - includes time_zone
    preferences: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // User timezone
    timezone: {
      type: String,
    },
    // Alternative timezone field name
    time_zone: {
      type: String,
    },
    // PHP: session_id
    session_id: {
      type: String,
    },
    // PHP: sso_token
    sso_token: {
      type: String,
    },
    // PHP: sso_key
    sso_key: {
      type: String,
    },
    // PHP: sso_secret
    sso_secret: {
      type: String,
    },
    // PHP: created_by
    created_by: {
      type: String,
      select: false,
    },
    // PHP: created_by_id
    created_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      select: false,
    },
    // PHP: created_date
    created_date: {
      type: Date,
    },
    // PHP: updated_by
    updated_by: {
      type: String,
      select: false,
    },
    // PHP: updated_by_id
    updated_by_id: {
      type: mongoose.Schema.Types.ObjectId,
      select: false,
    },
    // PHP: updated_date
    updated_date: {
      type: Date,
    },
    // PHP: updated_registerId
    updated_registerId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    // PHP: document_name
    document_name: {
      type: String,
    },
    // PHP: document_backup_date
    document_backup_date: {
      type: Date,
    },
    passwordChangedAt: Date,
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      select: false,
    },
    access: {
      type: Object,
      default: createDefaultAccess,
    },
    // Phase 1 roles: the assigned role + any per-user overrides. The RESOLVED
    // matrix is stored on `access` (above) at write time via mergeAccess, so all
    // enforcement keeps reading `access` with no per-request role lookup.
    role_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      default: null,
    },
    access_overrides: {
      type: Object,
      default: {},
    },
    // Manager approval PIN (bcrypt hash) used to authorise a cashier's
    // restricted till action on the spot. Never selected by default; set only
    // by an authorised (super-admin) user via the manager-PIN endpoint.
    manager_pin: {
      type: String,
      select: false,
      default: null,
    },
    // RFID / swipe card. Stored as a SHA-256 hash of the normalised card UID -
    // an IDENTIFIER we look up (clock-by-card, swipe-to-approve), not a secret
    // we verify, so a fast indexed lookup is the right tool (unlike manager_pin).
    rfid_hash: {
      type: String,
      select: false,
      default: null,
    },
    // Optional hourly wage used by the labour / payout report (Phase 5) to turn
    // worked hours into a payout figure. 0 (or unset) => hours only, no payout.
    hourly_rate: {
      type: Number,
      default: 0,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
    },
    dateOfBirth: Date,
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer-not-to-say'],
    },
    preferredLanguage: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'hi', 'ta', 'te', 'kn', 'ml'],
    },
    themePreference: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system',
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },
    lastPasswordReset: Date,
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    accountLocked: {
      type: Boolean,
      default: false,
      select: false,
    },
    accountLockedUntil: {
      type: Date,
      select: false,
    },
    lastActive: Date,
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'pending'],
      default: 'active',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add plugins
userSchema.plugin(toJSON);
userSchema.plugin(paginate);

// Indexes
userSchema.index({ phone: 1 }, { sparse: true });
userSchema.index({ branch: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return this.name;
});

// Virtual for user's initials
userSchema.virtual('initials').get(function () {
  if (!this.name) return '';
  return this.name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
});

// Pre-save middleware to hash password
// NOTE: PHP userInsertUpdate() receives already-hashed password from controller
// Controller hashes password with bcrypt.hash() before passing to model
// So we should NOT hash again here to avoid double-hashing
/*
 * Mongoose 9 stopped passing `next` to middleware. A hook that declared it got
 * undefined and threw "next is not a function" on the first call - which for
 * the pre-find hook below meant every user lookup in the application failed,
 * including login. Returning is now how a hook signals it is done, and throwing
 * is how it fails; an async hook's rejected promise is the error.
 */
userSchema.pre('save', async function () {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return;

  // Check if password is already hashed (starts with $2a$, $2b$, or $2y$ for bcrypt)
  const isAlreadyHashed = this.password && /^\$2[aby]\$\d{2}\$/.test(this.password);

  if (!isAlreadyHashed && this.password) {
    // Only hash if not already hashed (for backward compatibility or direct model usage)
    this.password = await bcrypt.hash(this.password, 12);
  }

  // Delete passwordConfirm field
  this.passwordConfirm = undefined;
});

// Pre-save middleware to set passwordChangedAt
userSchema.pre('save', function () {
  if (!this.isModified('password') || this.isNew) return;

  this.passwordChangedAt = Date.now() - 1000;
});

// Pre-save middleware to update timestamps
userSchema.pre('save', function () {
  const now = new Date();
  this.updatedAt = now;
  if (!this.createdAt) {
    this.createdAt = now;
  }
});

// CRITICAL: Pre-save validation to prevent empty branch_access
// PHP validation requires branch_id (line 160), so branch_access must never be empty
// TEMPORARILY DISABLED to debug data flow
// userSchema.pre("save", function (next) {
//   if (!this.branch_access || this.branch_access.length === 0) {
//     const error = new Error('Validation failed: At least one branch must be assigned to the user');
//     error.name = 'ValidationError';
//     return next(error);
//   }
//   next();
// });

// CRITICAL: Pre-update validation to prevent empty branch_access
// TEMPORARILY DISABLED to debug data flow
// userSchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
//   const update = this.getUpdate();
//   // Check if branch_access is being set in $set operation
//   if (update.$set && update.$set.branch_access !== undefined) {
//     if (!update.$set.branch_access || update.$set.branch_access.length === 0) {
//       const error = new Error('Validation failed: At least one branch must be assigned to the user');
//       error.name = 'ValidationError';
//       return next(error);
//     }
//   }
//   next();
// });

// Pre-find middleware to only include active users
userSchema.pre(/^find/, function () {
  // Only include active users in queries unless explicitly told not to
  if (this.getQuery().includeInactive !== true) {
    this.find({ isActive: { $ne: false } });
  }
});

// Instance method to check if password is correct
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// Instance method to check if password was changed after token was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }

  // False means NOT changed
  return false;
};

// The vestigial `permissions` enum + hasPermission/hasAnyRole helpers were
// retired (P2): nothing enforced through them - the `access` matrix (resolved
// from roles) is the single authority, read via base.controller.checkPermission.

// Instance method to lock user account
userSchema.methods.lockAccount = async function () {
  this.accountLocked = true;
  this.accountLockedUntil = Date.now() + 30 * 60 * 1000; // Lock for 30 minutes
  await this.save({ validateBeforeSave: false });
};

// Instance method to unlock user account
userSchema.methods.unlockAccount = async function () {
  this.accountLocked = false;
  this.accountLockedUntil = undefined;
  this.failedLoginAttempts = 0;
  await this.save({ validateBeforeSave: false });
};

// Static method to find user by credentials
userSchema.statics.findByCredentials = async function (email, password) {
  const user = await this.findOne({ email }).select('+password');

  if (!user) {
    throw new Error('Unable to login');
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    user.failedLoginAttempts += 1;

    // Lock account after 5 failed attempts
    if (user.failedLoginAttempts >= 5) {
      await user.lockAccount();
      throw new Error('Account locked due to too many failed login attempts');
    }

    await user.save({ validateBeforeSave: false });
    throw new Error('Unable to login');
  }

  // Reset failed login attempts on successful login
  if (user.failedLoginAttempts > 0) {
    user.failedLoginAttempts = 0;
    await user.save({ validateBeforeSave: false });
  }

  return user;
};

// Static method to find user by email
userSchema.statics.findByEmail = async function (email) {
  return this.findOne({ email });
};

// Static method to check if email is taken
userSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

// Static method to get users by role
userSchema.statics.getUsersByRole = async function (role) {
  return this.find({ role });
};

// Static method to get users with pagination and filters (Matches PHP userPage)
userSchema.statics.userPage = async function (filters = {}, options = {}, context = {}) {
  try {
    const BaseModel = require('./base.model');
    const baseModel = new BaseModel();

    // Define fields for filter processing (Matches PHP UserModel::$fields)
    const fields = {
      _id: { type: 'ObjectId', select: true, name: 'id' },
      access: { type: 'Array', select: true },
      activate: { type: 'Bool', select: true },
      activeregister_id: { type: 'String', select: true },
      activeregister_name: { type: 'String', select: true },
      apikey: { type: 'String', select: true },
      branch_access: { type: 'Array', select: true },
      Collection: { type: 'String', select: true },
      created_by: { type: 'String', select: false },
      created_by_id: { type: 'ObjectId', select: false },
      created_date: { type: 'Date', select: true },
      current_registerid: { type: 'ObjectId', select: true },
      document_name: { type: 'String', select: true },
      document_backup_date: { type: 'Date', select: true },
      email: { type: 'String', select: true },
      expire_date: { type: 'Date', select: true },
      firstname: { type: 'String', select: true },
      image: { type: 'String', select: true },
      lastname: { type: 'String', select: true },
      license: { type: 'ObjectId', select: false },
      opening_float: { type: 'String', select: true },
      password: { type: 'String', select: false },
      plan: { type: 'Object', select: true, defaultValue: [] },
      preference: { type: 'Object', select: true },
      printing_design: { type: 'Object', select: true },
      register_closedate: { type: 'Date', select: true },
      register_id: { type: 'ObjectId', select: true },
      register_name: { type: 'String', select: true },
      register_opendate: { type: 'Date', select: true },
      register_status: { type: 'String', select: true },
      registers: { type: 'Array', select: true },
      session_id: { type: 'String', select: true },
      sso_token: { type: 'String', select: true },
      sso_key: { type: 'String', select: true },
      sso_secret: { type: 'String', select: true },
      updated_by: { type: 'String', select: false },
      updated_by_id: { type: 'ObjectId', select: false },
      updated_date: { type: 'Date', select: true },
      updated_registerId: { type: 'ObjectId', select: true },
      userkey: { type: 'String', select: true },
      username: { type: 'String', select: true },
      usertype: { type: 'String', select: true },
      plan_access: { type: 'Array', select: true },
    };

    // 1. Process filters using assignFilterObjects (handles types, dates, timezones)
    filters = baseModel.assignFilterObjects(filters, fields);

    // 2. Apply Branch Filter (PHP: $filters['branch_access.branch_id'] = self::$currentBranch)
    if (context.currentBranch) {
      const mongoose = require('mongoose');
      const branchId = mongoose.Types.ObjectId.isValid(context.currentBranch)
        ? new mongoose.Types.ObjectId(context.currentBranch)
        : context.currentBranch;

      filters['branch_access.branch_id'] = branchId;
    }

    // 3. Apply License Filter
    if (context.license) {
      filters.license = context.license;
    }

    // 4. Check Plan Limit (PHP: parent::checkPlan(self::$collectionName, 'getAll'))
    const planLimit = await baseModel.checkPlan('users', 'getAll', context.user);

    let limit = parseInt(options.limit) || 10;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;
    const sort = options.sort || { _id: -1 };

    // Apply plan limit if stricter
    if (planLimit > 0) {
      if (limit > planLimit) {
        limit = planLimit;
      }
    }

    // 5. Execute Query
    // Set includeInactive: true to match PHP behavior of showing all users
    const query = this.find(filters)
      .setOptions({ includeInactive: true })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-password -sso_token -sso_key -sso_secret') // Exclude sensitive fields by default
      .lean();

    const rawList = await query.exec();
    const list = rawList.map((doc) => {
      const simplified = BaseModel.simplifyFields(doc);
      // Ensure defaults for arrays that might be missing in lean()
      if (!simplified.registers) simplified.registers = [];
      if (!simplified.branch_access) simplified.branch_access = [];
      return simplified;
    });

    // Count documents (ensure includeInactive is respected)
    const total = await this.countDocuments(filters).setOptions({
      includeInactive: true,
    });

    return {
      status: true,
      data: {
        list: list,
        total: total,
        current_page: page,
        per_page: limit,
        total_pages: Math.ceil(total / limit),
        page: page,
        limit: limit,
        pages: Math.ceil(total / limit),
      },
      message: 'success',
    };
  } catch (error) {
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

// Static method for user status report page (ported from PHP)
userSchema.statics.userstatusReportPage = async function (data, options = {}) {
  try {
    const mongoose = require('mongoose');

    // Parse dates - similar to PHP startingDate and endingDate methods
    let fromDate = new Date(0);
    let toDate = new Date();

    if (data.starting_date) {
      fromDate = new Date(data.starting_date);
      if (isNaN(fromDate.getTime())) fromDate = new Date(0);
    }

    if (data.ending_date) {
      toDate = new Date(data.ending_date);
      if (isNaN(toDate.getTime())) toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else {
      toDate.setHours(23, 59, 59, 999);
    }

    // Convert branch IDs to ObjectIds
    const branchIds = Array.isArray(data.branchid) ? data.branchid : [];
    const objectBranchIds = branchIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    // Build filters (PHP: $filters['$and'] includes branch_id, updated_date, and license)
    const dateAndLicenseFilter = { updated_date: { $gte: fromDate, $lte: toDate } };
    if (data.license && mongoose.Types.ObjectId.isValid(data.license)) {
      dateAndLicenseFilter.license = new mongoose.Types.ObjectId(data.license);
    }

    const filters = {
      $and: [{ branch_id: { $in: objectBranchIds } }, dateAndLicenseFilter],
    };

    // Add user_id filter if provided
    if (data.user_id && mongoose.Types.ObjectId.isValid(data.user_id)) {
      filters.user_id = new mongoose.Types.ObjectId(data.user_id);
    }

    // Get the staff_activities collection
    // Try to get existing model, otherwise use raw collection
    let StaffActivity;
    try {
      StaffActivity = getModel('StaffActivity');
    } catch (err) {
      // Model doesn't exist, use raw collection
      const db = currentConnection(mongoose.connection).db;
      if (!db) {
        throw new Error('Database connection not established', { cause: err });
      }
      const collection = db.collection('staff_activities');

      // Calculate pagination
      const limit = parseInt(options.limit) || 5;
      const page = parseInt(options.page) || 1;
      const skip = (page - 1) * limit;

      // Execute query with pagination using raw collection
      const list = await collection
        .find(filters)
        .sort({ updated_date: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // Format dates for each record
      const formattedList = list.map((record) => {
        const dateValue = record.updated_date || record.date || new Date();
        const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);

        // Format as MM/DD/YYYY HH:mm am/pm
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const year = dateObj.getFullYear();
        let hours = dateObj.getHours();
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;

        return {
          ...record,
          string_date: `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`,
        };
      });

      // Get total count for pagination
      const total = await collection.countDocuments(filters);

      return {
        status: true,
        message: 'User status report retrieved successfully',
        data: {
          list: formattedList,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    }

    // Calculate pagination
    const limit = parseInt(options.limit) || 5;
    const page = parseInt(options.page) || 1;
    const skip = (page - 1) * limit;

    // Execute query with pagination using Mongoose model
    const list = await StaffActivity.find(filters)
      .sort({ updated_date: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Format dates for each record
    const formattedList = list.map((record) => {
      const dateValue = record.updated_date || record.date || new Date();
      const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);

      // Format as MM/DD/YYYY HH:mm am/pm
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const year = dateObj.getFullYear();
      let hours = dateObj.getHours();
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;

      return {
        ...record,
        string_date: `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`,
      };
    });

    // Get total count for pagination
    const total = await StaffActivity.countDocuments(filters);

    return {
      status: true,
      message: 'User status report retrieved successfully',
      data: {
        list: formattedList,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  } catch (error) {
    console.error('Error in userstatusReportPage:', error);
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

// Static method to get data changes
userSchema.statics.getDataChanges = async function (module, from) {
  const BaseModel = require('./base.model');
  const baseModel = new BaseModel();
  return await baseModel.getAllDataChanges(module, null, from);
};

/**
 * Static method to insert or update user
 * Matches PHP user_model.php userInsertUpdate($data, $id)
 * @param {Object} data - User data from request body
 * @param {string} id - User ID for edit operation (empty string for add)
 * @param {Object} context - Context object with user, license, etc.
 * @returns {Object} Response object with status, data, and message
 */
/*
 * Lazy backfill (Phase 2): a user saved before the explicit POS matrix shipped
 * has no access.pos, which the till treats as fail-open - so a legacy cashier
 * could void without approval. Called once at login: derive the matrix from
 * their role when they have one, else from their usertype (admin types get
 * full authority, everyone else the cashier preset), persist it, and return
 * the patched access. Any error leaves access untouched - login never breaks
 * over a backfill.
 */
userSchema.statics.backfillPosAccess = async function (userDoc) {
  const access = (userDoc && userDoc.access) || {};
  if (access.pos && typeof access.pos === 'object') return access;

  const { DEFAULT_ROLES } = require('../constants/roles.constants');
  const roleByKey = (key) => DEFAULT_ROLES.find((r) => r.key === key);

  let pos = null;
  let mgr = [];
  if (userDoc.role_id) {
    try {
      const db = currentConnection(mongoose.connection).db;
      const roleDoc = db
        ? await db.collection('roles').findOne({ _id: userDoc.role_id })
        : null;
      if (roleDoc && roleDoc.pos && typeof roleDoc.pos === 'object') {
        pos = roleDoc.pos;
        mgr = Array.isArray(roleDoc.requires_manager_approval)
          ? roleDoc.requires_manager_approval
          : [];
      }
    } catch (e) {
      pos = null;
    }
  }
  const type = String(userDoc.usertype || '').toLowerCase();
  if (!pos) {
    const keyByType = {
      super_admin: 'owner',
      owner: 'owner',
      admin: 'admin',
      manager: 'store_manager',
      store_manager: 'store_manager',
      api: 'api',
    };
    const fallback = roleByKey(keyByType[type] || 'cashier') || {};
    pos = fallback.pos || {};
    mgr = Array.isArray(fallback.requires_manager_approval)
      ? fallback.requires_manager_approval
      : [];
  }

  const set = { 'access.pos': pos, 'access.pos_manager_approval': mgr };
  let matrix = access;

  /*
   * Stamping access.pos is also the moment a manager loses the blanket
   * checkPermission bypass (see base.controller) - so their module matrix must
   * be complete when that happens. Union it with the Store Manager preset:
   * anything they could already do stays, anything a store manager should be
   * able to do is added. Role-holding managers already resolved a full matrix.
   */
  if (!userDoc.role_id && (type === 'manager' || type === 'store_manager')) {
    const preset = (roleByKey('store_manager') || {}).access || {};
    matrix = { ...access };
    Object.keys(preset).forEach((m) => {
      const pm = preset[m] && typeof preset[m] === 'object' ? preset[m] : {};
      const em = access[m] && typeof access[m] === 'object' ? access[m] : {};
      const merged = { ...pm, ...em };
      Object.keys(pm).forEach((a) => {
        if (pm[a] === true) merged[a] = true;
      });
      matrix[m] = merged;
    });
    Object.keys(matrix).forEach((m) => {
      if (!['pos', 'pos_manager_approval'].includes(m)) set[`access.${m}`] = matrix[m];
    });
  }

  await this.updateOne({ _id: userDoc._id }, { $set: set });
  return { ...matrix, pos, pos_manager_approval: mgr };
};

userSchema.statics.userInsertUpdate = async function (data, id, context) {
  try {
    const bcrypt = require('bcryptjs');
    const { ObjectId } = require('mongodb');
    const Branch = require('./branch.model');
    const BaseModel = require('./base.model');
    const baseModel = new BaseModel('users');

    // PHP lines 115-120: Password handling
    const verify_password = data.check_password;
    let password = '';
    if (verify_password === 'yes' && data.usertype !== 'api') {
      // PHP: 'password' => 'trim|base64_encode' filter applied first
      const base64Password = Buffer.from(data.password).toString('base64');
      password = await bcrypt.hash(base64Password, 12);
    }

    // PHP lines 122-123: Generate userkey
    const random = new Date().toLocaleDateString('en-GB').replace(/\//g, '') + Math.random();
    const userSecretKey = await bcrypt.hash(random, 10);

    // PHP lines 124-137: Check for duplicate users
    let recordsFiltered = null;
    if (data.usertype !== 'api') {
      recordsFiltered = await this.findOne({
        $or: [{ username: data.name }, { email: data.email }],
        license: context.license,
      }).lean();
    } else {
      recordsFiltered = await this.findOne({
        $or: [{ username: data.app_name }, { apikey: data.app_key }],
        license: context.license,
      }).lean();
    }

    // PHP lines 138-146: Check if duplicate exists (excluding current user if editing)
    if (recordsFiltered && recordsFiltered._id.toString() !== id) {
      return {
        status: 'exist',
        data: null,
        message: 'This user details already exist in our system',
      };
    }

    // PHP lines 149-179: Check plan limits for adding users
    const checkResponse = await baseModel.checkPlan('users', 'add', context.user);
    const maxUsers = checkResponse;
    if (maxUsers > 0 && !id) {
      // Only check limit when adding new user
      const startingMonth = new Date();
      startingMonth.setDate(1);
      startingMonth.setHours(0, 0, 0, 0);

      const endingMonth = new Date(startingMonth.getFullYear(), startingMonth.getMonth() + 1, 0);
      endingMonth.setHours(23, 59, 59, 999);

      const totalCount = await this.countDocuments({
        updated_date: { $gte: startingMonth, $lte: endingMonth },
        license: context.license,
      });

      if (totalCount >= maxUsers) {
        return {
          status: 'error',
          data: null,
          message: 'User adding limit reached. Please upgrade to the Premium Plan.',
        };
      }
    }

    // PHP lines 181-185: Process branch data
    // PHP: $branchValue = $data['branch_data'];
    // PHP: foreach ($branchValue AS $branchdocument) {
    // PHP:   $branch_data[] = ['branch_id' => new MongoDB\BSON\ObjectID($branchdocument['branch_id']),
    // PHP:                      'branch_name' => $branchdocument['branch_name'],
    // PHP:                      'branch_image' => $branchdocument['branch_image']];
    const branchValue = data.branch_data || [];

    // CRITICAL: Prevent empty branch_access - PHP validation requires branch_id (line 160)
    if (!branchValue || branchValue.length === 0) {
      return {
        status: false,
        data: null,
        message: 'At least one branch must be selected',
      };
    }

    const branch_data = branchValue.map((b) => ({
      // PHP accesses $branchdocument['branch_id'], $branchdocument['branch_name'], $branchdocument['branch_image']
      branch_id: new ObjectId(b.branch_id || b.id),
      branch_name: b.branch_name || b.text || b.name || '',
      branch_image: b.branch_image || b.image || 'store.png',
    }));

    // PHP lines 186-236: Construct access matrix
    const userType = context.user._id.toString();

    // Editing your own record must not grant you anything. Historically a
    // self-edit forced usertype to super_admin and self-managed the
    // branch/report/user rights - a privilege escalation for anyone below the
    // owner. Only the tenant's own top account keeps elevated self-rights.
    const selfEdit = userType === id;
    const selfElevate =
      selfEdit &&
      ['super_admin', 'owner'].includes(String(context.user.usertype || '').toLowerCase());
    // PHP uses isset() which checks if key exists AND is not null
    // JavaScript equivalent: check if property exists and is truthy
    const constructAccess = (readKey, writeKey, deleteKey) => ({
      read: readKey in data && data[readKey] ? true : false,
      write: writeKey in data && data[writeKey] ? true : false,
      delete: deleteKey in data && data[deleteKey] ? true : false,
    });

    let access = {
      dashboard: {
        read: 'dashboard_read' in data && data.dashboard_read ? true : false,
        // The money-health layer - profit, cost, margin, expenses, cash, dues.
        // Off by default; granted per user so a salesperson sees they sold well
        // without seeing what the owner keeps after every other cost.
        financials: 'dashboard_financials' in data && data.dashboard_financials ? true : false,
      },
      sales: constructAccess('sales_read', 'sales_write', 'sales_delete'),
      receiving: constructAccess('receiving_read', 'receiving_write', 'receiving_delete'),
      customer: constructAccess('customer_read', 'customer_write', 'customer_delete'),
      supplier: constructAccess('supplier_read', 'supplier_write', 'supplier_delete'),
      category: constructAccess('category_read', 'category_write', 'category_delete'),
      item: constructAccess('item_read', 'item_write', 'item_delete'),
      expense: constructAccess('expense_read', 'expense_write', 'expense_delete'),
      branch: {
        read: 'branch_read' in data && data.branch_read ? true : false,
        write: selfElevate,
        delete: selfElevate,
      },
      report: {
        read: 'report_read' in data && data.report_read ? true : false,
        write: selfElevate,
        delete: selfElevate,
      },
      user: {
        read: 'user_read' in data && data.user_read ? true : false,
        write: selfElevate,
        delete: selfElevate,
      },
      plan: {
        read: context.user.access?.plan?.read || false,
      },
    };

    // Phase 1 (roles): if a role is chosen, the user's effective access = the
    // role's access merged with any per-user overrides. Users created without a
    // role_id keep the flat-form matrix above (fully backward-compatible).
    // plan.read stays an entitlement (from the creating user); editing your own
    // record still keeps self-management. Fails open to the flat-form matrix.
    if (data.role_id) {
      try {
        const roleDb = currentConnection(mongoose.connection).db;
        const roleDoc = roleDb
          ? await roleDb.collection('roles').findOne({
            _id: new ObjectId(data.role_id),
            license: context.license,
          })
          : null;
        if (roleDoc && roleDoc.access) {
          access = mergeAccess(roleDoc.access, data.access_overrides || {});
          access.plan = { read: context.user.access?.plan?.read || false };
          // Carry the role's granular POS permissions + manager-approval list
          // onto the user so the till can gate void / refund / discount etc.
          // without another lookup. These sit alongside the CRUD matrix.
          access.pos = roleDoc.pos && typeof roleDoc.pos === 'object' ? roleDoc.pos : {};
          access.pos_manager_approval = Array.isArray(roleDoc.requires_manager_approval)
            ? roleDoc.requires_manager_approval
            : [];
          if (selfElevate) {
            ['branch', 'report', 'user'].forEach((m) => {
              access[m] = { ...(access[m] || {}), write: true, delete: true };
            });
          }
        }
      } catch (roleErr) {
        console.error('[userInsertUpdate] role resolve failed:', roleErr && roleErr.message);
      }
    }

    // Phase 2 (till actions): a user saved without a role - or whose role could
    // not be resolved - takes the form's explicit POS matrix, so till gating
    // never rests on an absent `pos` object (absent fails open at the till for
    // legacy sessions). Only whitelisted action keys are accepted.
    if (!access.pos && data.pos && typeof data.pos === 'object') {
      access.pos = sanitizePosInput(data.pos);
      access.pos_manager_approval = [];
    }

    // PHP lines 238-266: Get branch printing design details
    // PHP lines 239-242: Convert branch_id strings to ObjectID for query
    // $branchValues = $data['branch_data'];
    // foreach ($branchValues as $key => $value) {
    //     $array_merge[$key] = new MongoDB\BSON\ObjectID($value['branch_id']);
    // }
    const branchIds = branchValue.map((b) => new ObjectId(b.branch_id || b.id));

    // PHP lines 244-247: Build condition with ObjectIDs
    const branches = await Branch.find({
      _id: { $in: branchIds },
      license: context.license,
    }).lean();

    // CRITICAL: Prevent empty branch_access - if no branches found, it means invalid branch IDs or license mismatch
    if (branches.length === 0) {
      console.error('[userInsertUpdate] ERROR: No branches found in database!');
      console.error(
        '[userInsertUpdate] Query was: { _id: { $in:',
        branchIds.map((id) => id.toString()),
        '}, license:',
        context.license,
        '}'
      );
      return {
        status: false,
        data: null,
        message:
          'Selected branches not found or do not belong to your license. Please select valid branches.',
      };
    }

    // PHP lines 254-266: Build branchesValue array with printing design details
    // PHP line 262: isset($c->_id->print_type) ?? 'standard' - incorrect syntax but evaluates to true when property exists
    // The actual PHP-stored document shows boolean true values, not strings
    const branchesValue = branches.map((b) => ({
      branch_id: b._id,
      printing_design: b.print_type !== undefined ? true : 'standard',
      printing_max_char: b.print_character !== undefined ? true : 'default',
      printing_size: b.print_size !== undefined ? true : 'receipt_medium',
    }));

    // PHP lines 268-279: Prepare user data based on usertype
    const mongoDate = new Date();
    let userName, userPass, userEmail, appKey;

    if (data.usertype !== 'api') {
      userPass = password;
      userName = data.name;
      userEmail = data.email;
      appKey = '';
    } else {
      userName = data.app_name;
      appKey = data.app_key;
      userPass = '';
      userEmail = '';
    }

    // PHP lines 280-287: insertData
    const insertData = {
      userkey: userSecretKey.trim(),
      password: userPass.trim(),
      created_date: mongoDate,
      created_by: context.user.username,
      created_by_id: context.user._id,
      license: context.license,
    };

    // Registers this user may operate (empty = no restriction, all of the
    // branch's registers). Sanitized to {register_id, register_name} pairs.
    const registers = Array.isArray(data.registers)
      ? data.registers
          .filter((r) => r && (r.register_id || r.id))
          .map((r) => ({
            register_id: new ObjectId(String(r.register_id || r.id)),
            register_name: String(r.register_name || r.name || '').trim(),
          }))
      : null;

    // PHP lines 289-310: updateData
    const updateData = {
      firstname: (data.firstname || '').trim(),
      lastname: (data.lastname || '').trim(),
      username: userType === id ? context.user.username : userName,
      email: userType === id ? context.user.email : userEmail,
      apikey: appKey.trim(),
      branch_access: branch_data,
      printing_design: branchesValue,
      access: access,
      role_id: data.role_id ? new ObjectId(data.role_id) : null,
      ...(registers !== null ? { registers } : {}),
      access_overrides:
        data.access_overrides && typeof data.access_overrides === 'object' ? data.access_overrides : {},
      plan: {
        name: context.user.plan?.name || 'premium',
        max_sales: context.user.plan?.max_sales || 'unlimited',
      },
      // Self-edit preserves the editor's real type - it must never mint a
      // super_admin out of whoever edits their own record.
      usertype: selfEdit ? context.user.usertype || data.usertype : data.usertype,
      activate: data.user_status === 'active' ? true : false,
      image: (data.image || '').trim(),
      register_status: 'Closed',
      updated_date: mongoDate,
      updated_by: context.user.username,
      updated_by_id: context.user._id,
      license: context.license,
    };

    // PHP line 312: Merge insertData and updateData
    const userCollectionData = { ...insertData, ...updateData };

    // PHP lines 313-333: Add new user
    if (id === '') {
      const insertOneResult = await this.create(userCollectionData);
      const lastInsertedId = insertOneResult._id;

      const branch_array_data = {
        user_id: lastInsertedId,
        user_name: userName,
        user_image: data.image,
      };

      // Update branches with new user access
      await Branch.updateMany(
        { _id: { $in: branchIds }, license: context.license },
        { $push: { user_access: branch_array_data } }
      );

      // Change log
      await baseModel.changeLog('users', context.user._id, lastInsertedId, 'insert');

      return {
        status: true,
        data: lastInsertedId.toString(),
        message: 'User added successfully',
      };
    } else {
      // PHP lines 334-360: Edit existing user
      const objectId = new ObjectId(id);
      const updateResult = await this.updateOne(
        { _id: objectId, license: context.license },
        { $set: updateData }
      );

      // Change log
      await baseModel.changeLog('users', context.user._id, objectId, 'update');

      // Pull old user access from branches
      await Branch.updateMany(
        { _id: { $in: branchIds }, license: context.license },
        { $pull: { user_access: { user_id: objectId } } }
      );

      // Push new user access to branches
      const branch_array_data = {
        user_id: objectId,
        user_name: userName,
        user_image: data.image,
      };

      await Branch.updateMany(
        { _id: { $in: branchIds }, license: context.license },
        { $push: { user_access: branch_array_data } }
      );

      return {
        status: true,
        data: objectId.toString(),
        message: 'User updated successfully',
      };
    }
  } catch (error) {
    return {
      status: false,
      data: '',
      message: error.message,
    };
  }
};

// Create the User model
const User = defineModel('User', userSchema);

console.log('[USER_MODEL] Module loaded at:', new Date().toISOString());

// Add the getUserByEmail method to the User model
User.getUserByEmail = async function (email) {
  return this.findOne({ email }).select('+password');
};

/**
 * Export User Order
 * Matches PHP user_model.php exportUserOrder()
 * Exports selected users with specific fields
 * @param {Array|Object} data - Array of user IDs to export
 * @param {String} license - License ID for filtering
 * @returns {Promise<Object>} - Response with user data
 */
User.exportUserOrder = async function (data, license) {
  try {
    // PHP lines 1043-1045: Convert IDs to ObjectIDs
    const arrayMerge = [];

    // Check if data is an array or object
    const ids = Array.isArray(data) ? data : Object.values(data);

    for (let i = 0; i < ids.length; i++) {
      if (ids[i]) {
        arrayMerge.push(new mongoose.Types.ObjectId(ids[i]));
      }
    }

    if (arrayMerge.length === 0) {
      return {
        status: false,
        data: null,
        message: 'No user IDs provided',
      };
    }

    // PHP lines 1046-1049: Find users with specific fields
    // Export fields from PHP: firstname, lastname, username, email, usertype
    const cursor = await this.find({
      _id: { $in: arrayMerge },
      license: new mongoose.Types.ObjectId(license),
    })
      .select('firstname lastname username email usertype')
      .sort({ _id: -1 })
      .lean();

    // PHP lines 1050-1054: Return response
    return {
      status: true,
      data: cursor,
      message: 'User Data Exported',
    };
  } catch (error) {
    // PHP lines 1055-1061: Catch exception
    console.error('Error in exportUserOrder:', error);
    return {
      status: false,
      data: null,
      message: error.message,
    };
  }
};

module.exports = User;
