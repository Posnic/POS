const activityLogger = require('../utils/activityLogger');

const auditTrail = (req, res, next) => {
  // Skip logging for health checks and static files
  if (req.path === '/health' || req.path.startsWith('/static')) {
    return next();
  }

  const start = Date.now();
  const originalJson = res.json;

  // Override res.json to capture the response
  res.json = function (data) {
    res.locals.responseData = data;
    return originalJson.call(this, data);
  };

  // Function to log the activity after response is sent
  res.on('finish', async () => {
    try {
      // Skip logging for non-API routes or if request is not finished
      if (!req.originalUrl.startsWith('/api') || !res.locals.responseData) {
        return;
      }

      const duration = Date.now() - start;
      const { statusCode } = res;
      const { method, originalUrl, user, body, query, params } = req;

      // Determine the action based on the HTTP method
      let action;
      switch (method.toLowerCase()) {
        case 'post':
          action = 'create';
          break;
        case 'put':
        case 'patch':
          action = 'update';
          break;
        case 'delete':
          action = 'delete';
          break;
        default:
          action = 'view';
      }

      // Determine the entity from the URL
      const entity = originalUrl.split('/')[2] || 'unknown';

      // Prepare activity data
      const activityData = {
        userId: user?._id || null,
        action,
        entity,
        entityId: params.id || null,
        details: {
          method,
          url: originalUrl,
          statusCode,
          duration: `${duration}ms`,
          query: Object.keys(query).length > 0 ? query : undefined,
          params: Object.keys(params).length > 0 ? params : undefined,
          requestBody: method !== 'GET' ? body : undefined,
          response: res.locals.responseData,
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: statusCode >= 400 ? 'failed' : 'success',
      };

      // Log the activity
      await activityLogger.logActivity(activityData);
    } catch (error) {
      console.error('Error in audit trail middleware:', error);
    }
  });

  next();
};

module.exports = auditTrail;
