const ActivityLog = require('../models/activity-log.model');

const activityLogger = {
  /**
   * Log a user activity
   * @param {Object} options - Log options
   * @param {string} options.userId - User ID
   * @param {string} options.action - Action performed
   * @param {string} options.entity - Entity type
   * @param {string} [options.entityId] - Entity ID
   * @param {Object} [options.details] - Additional details
   * @param {string} [options.ipAddress] - IP address
   * @param {string} [options.userAgent] - User agent
   * @param {'success'|'failed'} [options.status='success'] - Status of the action
   * @returns {Promise<Object>} The created activity log
   */
  logActivity: async (options) => {
    try {
      const activity = await ActivityLog.logActivity({
        ...options,
        user: options.user || options.userId,
      });
      return activity;
    } catch (error) {
      console.error('Error in logActivity:', error);
      throw error;
    }
  },

  /**
   * Get activity logs with pagination and filtering
   * @param {Object} options - Query options
   * @param {string} [options.userId] - Filter by user ID
   * @param {string} [options.action] - Filter by action
   * @param {string} [options.entity] - Filter by entity
   * @param {string} [options.entityId] - Filter by entity ID
   * @param {Date} [options.startDate] - Filter by start date
   * @param {Date} [options.endDate] - Filter by end date
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.limit=10] - Items per page
   * @returns {Promise<Object>} Paginated activity logs
   */
  getActivityLogs: async ({
    userId,
    action,
    entity,
    entityId,
    branch,
    license,
    startDate,
    endDate,
    page = 1,
    limit = 10,
  } = {}) => {
    try {
      const query = {};

      if (userId) query.user = userId;
      if (action) query.action = action;
      if (entity) query.entity = entity;
      if (entityId) query.entityId = entityId;
      if (branch) query.branch = branch;
      if (license) query.license = license;

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const options = {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        sort: { createdAt: -1 },
        populate: 'user',
        lean: true,
      };

      const result = await ActivityLog.paginate(query, options);
      return result;
    } catch (error) {
      console.error('Error in getActivityLogs:', error);
      throw error;
    }
  },

  getActivityUsers: async ({ entity, branch, license } = {}) => {
    const query = {};
    if (entity) query.entity = entity;
    if (branch) query.branch = branch;
    if (license) query.license = license;

    const logs = await ActivityLog.find(query)
      .select('user userName')
      .populate('user', 'username name email')
      .sort({ createdAt: -1 })
      .lean();
    const users = new Map();
    logs.forEach((log) => {
      const id = log.user?._id || log.user;
      if (!id || users.has(String(id))) return;
      users.set(String(id), {
        id: String(id),
        name: log.userName || log.user?.username || log.user?.name || log.user?.email || 'User',
      });
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Get a single activity log by ID
   * @param {string} id - Activity log ID
   * @returns {Promise<Object>} The activity log
   */
  getActivityLog: async (id, { branch, license } = {}) => {
    try {
      return await ActivityLog.findOne({ _id: id, branch, license }).populate('user').lean();
    } catch (error) {
      console.error('Error in getActivityLog:', error);
      throw error;
    }
  },

  /**
   * Update an activity log
   * @param {string} id - Activity log ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} The updated activity log
   */
  updateActivityLog: async (id, updateData, { branch, license } = {}) => {
    try {
      return await ActivityLog.findOneAndUpdate(
        { _id: id, branch, license },
        { $set: updateData },
        { new: true, runValidators: true }
      ).lean();
    } catch (error) {
      console.error('Error in updateActivityLog:', error);
      throw error;
    }
  },

  /**
   * Delete an activity log
   * @param {string} id - Activity log ID
   * @returns {Promise<Object>} The deleted activity log
   */
  deleteActivityLog: async (id, { branch, license } = {}) => {
    try {
      return await ActivityLog.findOneAndDelete({ _id: id, branch, license }).lean();
    } catch (error) {
      console.error('Error in deleteActivityLog:', error);
      throw error;
    }
  },
};

/**
 * Convenience wrapper used by controllers to log simple CRUD-style activities.
 * This is intentionally best-effort: logging failures are logged to console
 * but do NOT throw, so they never break the main request flow.
 *
 * Usage example:
 *   await createActivityLog({
 *     action: 'UPDATE',
 *     entity: 'Variant',
 *     entityId: variant._id,
 *     description: 'Variant updated',
 *     user: req.user?._id,
 *     changes: req.body,
 *   });
 */
const createActivityLog = async ({
  user,
  userId,
  action,
  entity,
  entityId,
  description,
  changes,
  status = 'success',
  ipAddress,
  userAgent,
  branch,
  license,
  userName,
} = {}) => {
  try {
    const finalUserId = userId || user || undefined;

    await activityLogger.logActivity({
      userId: finalUserId,
      action,
      entity,
      entityId,
      details: {
        description,
        changes,
      },
      status,
      ipAddress,
      userAgent,
      branch,
      license,
      userName,
    });
  } catch (error) {
    console.error('Error in createActivityLog:', error);
    // Swallow error to avoid impacting main request handling
  }
};

module.exports = {
  ...activityLogger,
  createActivityLog,
};
