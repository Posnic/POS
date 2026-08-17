/**
 * Session Filter Utility
 * Handles session-based date filtering for dashboard and reports
 * Matches PHP project behavior
 */

require('mongodb');

class SessionFilterUtil {
  constructor() {
    this.collectionName = 'user_sessions';
  }

  /**
   * Get database connection
   */
  getDatabase(req) {

    if (!req.app?.locals?.mongoClient) {
      console.error('❌ No MongoDB client available in app.locals');
      return null;
    }

    const dbName = process.env.MONGODB_URI?.split('/')?.pop()?.split('?')[0] || 'PosnicPro';

    return req.app.locals.mongoClient.db(dbName);
  }

  /**
   * Check if user has session filter permission
   */
  hasSessionFilterPermission(user) {
    return user?.access?.sales?.session_filter === true;
  }

  /**
   * Get user's active session data
   */
  async getUserSessionData(req) {
    if (!req.user?._id) {
      return null;
    }

    const db = this.getDatabase(req);
    if (!db) {
      return null;
    }

    const dbName = process.env.MONGODB_URI?.split('/')?.pop()?.split('?')[0] || 'PosnicPro';

    try {

      const userSessionsCollection = db.collection(this.collectionName);

      // Find active session for this user
      const sessionData = await userSessionsCollection.findOne({
        user_id: req.user._id,
        logout_time: null,
        is_active: true,
      });


      if (sessionData) {
        return sessionData;
      } else {
        console.log('⚠️ No active session found for user:', req.user._id);
        return null;
      }
    } catch (error) {
      console.error('❌ Error fetching user session data:', error.message);
      return null;
    }
  }

  /**
   * Apply session-based date filtering to query parameters
   */
  async applySessionFilter(req, originalDateRange = null) {
    const user = req.user;


    // Check if user has session filter permission
    const hasPermission = this.hasSessionFilterPermission(user);

    if (!hasPermission) {
      return originalDateRange;
    }


    // Get user's session data
    const sessionData = await this.getUserSessionData(req);

    if (!sessionData || !sessionData.login_time) {
      console.log('⚠️ No session data available - using original date range');
      return originalDateRange;
    }

    // Apply session-based filtering
    const sessionLoginTime = new Date(sessionData.login_time);

    // If original date range is provided, use the later of session login or original start
    let filteredDateRange;

    if (originalDateRange && originalDateRange.start_date) {
      const originalStart = new Date(originalDateRange.start_date);
      const effectiveStart = sessionLoginTime > originalStart ? sessionLoginTime : originalStart;

      filteredDateRange = {
        ...originalDateRange,
        start_date: effectiveStart,
        session_applied: true,
        session_login_time: sessionLoginTime,
      };

    } else {
      // No original date range, use session login time as start
      const now = new Date();
      filteredDateRange = {
        start_date: sessionLoginTime,
        end_date: now,
        session_applied: true,
        session_login_time: sessionLoginTime,
      };

    }


    return filteredDateRange;
  }

  /**
   * Apply session filter to MongoDB aggregation pipeline
   */
  async applySessionFilterToPipeline(req, pipeline, dateField = 'date') {
    const user = req.user;

    // Check if user has session filter permission
    if (!this.hasSessionFilterPermission(user)) {
      return pipeline;
    }

    // Get user's session data
    const sessionData = await this.getUserSessionData(req);

    if (!sessionData || !sessionData.login_time) {
      console.log('⚠️ No session data available - pipeline unchanged');
      return pipeline;
    }

    // Add session filter to pipeline
    const sessionLoginTime = new Date(sessionData.login_time);

    // Find the $match stage and add session filter
    const matchStageIndex = pipeline.findIndex((stage) => stage.$match);

    if (matchStageIndex !== -1) {
      // Add session filter to existing $match stage
      const existingMatch = pipeline[matchStageIndex].$match;

      if (existingMatch[dateField]) {
        // If date field already has conditions, merge with session filter
        if (existingMatch[dateField].$gte) {
          // Use the later of existing start date or session login time
          existingMatch[dateField].$gte =
            sessionLoginTime > existingMatch[dateField].$gte
              ? sessionLoginTime
              : existingMatch[dateField].$gte;
        } else {
          // Add session filter as start date
          existingMatch[dateField].$gte = sessionLoginTime;
        }
      } else {
        // Add session filter to date field
        existingMatch[dateField] = { $gte: sessionLoginTime };
      }

    } else {
      // Add new $match stage with session filter
      pipeline.unshift({
        $match: {
          [dateField]: { $gte: sessionLoginTime },
        },
      });

    }

    return pipeline;
  }

  /**
   * Apply session filter to sales query filters
   */
  async applySessionFilterToSalesFilters(req, filters) {
    const user = req.user;

    // Check if user has session filter permission
    if (!this.hasSessionFilterPermission(user)) {
      return filters;
    }

    // Get user's session data
    const sessionData = await this.getUserSessionData(req);

    if (!sessionData || !sessionData.login_time) {
      console.log('⚠️ No session data available - sales filters unchanged');
      return filters;
    }

    // Apply session filter to date range in sales filters
    const sessionLoginTime = new Date(sessionData.login_time);

    // Handle different date field structures in sales filters
    if (filters.date) {
      if (filters.date.$gte) {
        // If there's already a start date, use the later of session login or existing start
        filters.date.$gte =
          sessionLoginTime > filters.date.$gte ? sessionLoginTime : filters.date.$gte;
      } else {
        // Add session filter as start date
        filters.date.$gte = sessionLoginTime;
      }
    } else if (filters.created_date) {
      // Alternative date field
      if (filters.created_date.$gte) {
        filters.created_date.$gte =
          sessionLoginTime > filters.created_date.$gte
            ? sessionLoginTime
            : filters.created_date.$gte;
      } else {
        filters.created_date = { $gte: sessionLoginTime };
      }
    } else {
      // Add date filter if none exists
      filters.date = { $gte: sessionLoginTime };
    }

    return filters;
  }

  /**
   * Get session filter info for response
   */
  async getSessionFilterInfo(req) {
    const user = req.user;

    if (!this.hasSessionFilterPermission(user)) {
      return {
        session_filter_enabled: false,
        reason: 'User does not have session filter permission',
      };
    }

    const sessionData = await this.getUserSessionData(req);

    if (!sessionData) {
      return {
        session_filter_enabled: false,
        reason: 'No active session found',
      };
    }

    return {
      session_filter_enabled: true,
      session_login_time: sessionData.login_time,
      session_id: sessionData._id,
      user_id: sessionData.user_id,
    };
  }
}

module.exports = new SessionFilterUtil();
