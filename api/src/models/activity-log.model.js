const mongoose = require('mongoose');
/* Registered through defineModel rather than mongoose.model, so the model
   resolves to the shop the request belongs to. mongoose.model binds to the
   connection that exists at import, which in a process serving several shops is
   whichever database it happened to connect to first. */
const { defineModel } = require('../db/model-registry');

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

/*
 * THE FIELD THE SYNC AGENT LOOKS FOR.
 *
 * The agent only ever pushes documents that HAVE an `updated_date`:
 *
 *     { updated_date: { $exists: true } }
 *
 * This schema uses Mongoose `timestamps: true`, which writes `createdAt` and
 * `updatedAt` in camelCase and no `updated_date` at all. Every other synced
 * collection declares one; this was the odd one out, and the consequence was
 * not a lag but a wall: no activity log could EVER be pushed.
 *
 * The shop's own monitoring is what found it. Three mails in a row, a day
 * apart, with the gap widening every time:
 *
 *     activitylogs till 102 vs cloud 3 (+99)
 *     activitylogs till 106 vs cloud 3 (+103)
 *     activitylogs till 108 vs cloud 3 (+105)
 *
 * A till climbing and a cloud frozen at three is not a till mid-upload. It is
 * a query that can never match.
 *
 * Set from `createdAt` rather than the clock, because an activity log is
 * written once and never edited: the moment it happened IS the moment it last
 * changed, and using `new Date()` here would push a row whose timestamp says
 * it changed at whatever time the process happened to save it.
 */
activityLogSchema.pre('save', function stampSyncDates() {
  const at = this.createdAt || this.updated_date || new Date();
  if (!this.created_date) this.created_date = at;
  this.updated_date = at;
});

/*
 * And the same for the bulk paths, which never run a document hook.
 *
 * insertMany and the various updates go straight to the driver, so a hook that
 * only covers save() leaves exactly the rows a busy shop writes most.
 */
activityLogSchema.pre('insertMany', function stampManySyncDates(next, docs) {
  if (Array.isArray(docs)) {
    const now = new Date();
    for (const doc of docs) {
      if (!doc) continue;
      const at = doc.createdAt || doc.created_date || now;
      if (!doc.created_date) doc.created_date = at;
      doc.updated_date = at;
    }
  }
  next();
});

// Indexes for better query performance
activityLogSchema.index({ user: 1 });
/* The agent pushes in `updated_date` order and pages on it, so it is indexed
   for the same reason every other synced collection indexes its own. */
activityLogSchema.index({ updated_date: 1 });
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

const ActivityLog = defineModel('ActivityLog', activityLogSchema);

module.exports = ActivityLog;
