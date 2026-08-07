const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'login',
        'logout',
        'create',
        'update',
        'delete',
        'password_change',
        'profile_update',
        'permission_change',
        'price_change',
        'discount',
        'refund',
        'cancel',
        'failed_login',
        'account_lockout',
      ],
    },
    entity: {
      type: String,
      required: true,
      enum: ['user', 'product', 'order', 'sale', 'inventory', 'auth', 'system'],
    },
    entityId: {
      type: mongoose.Schema.Types.Mixed,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    license: { type: mongoose.Schema.Types.ObjectId, ref: 'License' },
    userName: String,
    ipAddress: String,
    userAgent: String,
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
activityLogSchema.index({ user: 1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ entity: 1, entityId: 1 });
activityLogSchema.index({ license: 1, branch: 1, entity: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

// Static method to log an activity
activityLogSchema.statics.logActivity = async function (activityData) {
  try {
    const activity = await this.create(activityData);
    return activity;
  } catch (error) {
    console.error('Error logging activity:', error);
    return null;
  }
};

// Add pagination plugin
const mongoosePaginate = require('mongoose-paginate-v2');
activityLogSchema.plugin(mongoosePaginate);

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = ActivityLog;
