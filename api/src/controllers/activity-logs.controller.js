const activityLogger = require('../utils/activityLogger');
const { clientIp } = require('../utils/client-ip');
const catchAsync = require('../utils/catchAsync');
const { AppError } = require('../utils/appError');
const mongoose = require('mongoose');
const Sale = require('../models/sale.model');

/**
 * @desc    Get activity logs with filtering and pagination
 * @route   GET /api/activity-logs
 * @access  Private/Admin
 */
exports.getActivityLogs = catchAsync(async (req, res, next) => {
  const branch = req.tenantContext?.branchId;
  const license = req.tenantContext?.licenseId;
  const { userId, action, entity, entityId, startDate, endDate, page = 1, limit = 10 } = req.query;

  const logs = await activityLogger.getActivityLogs({
    userId,
    action,
    entity,
    entityId,
    branch,
    license,
    startDate,
    endDate,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });

  res.status(200).json({
    status: 'success',
    results: logs.docs ? logs.docs.length : 0,
    data: {
      logs: logs.docs || logs,
    },
    total: logs.total || logs.length,
    limit: logs.limit || parseInt(limit, 10),
    page: logs.page || parseInt(page, 10),
    pages: logs.pages || 1,
  });
});

exports.getSalesAuditLogs = catchAsync(async (req, res, next) => {
  const role = String(req.user?.usertype || req.user?.role || '').toLowerCase();
  if (!['manager', 'admin', 'super_admin'].includes(role)) {
    return next(new AppError('Only managers can view sales audit logs', 403));
  }

  const branch = req.tenantContext?.branchId;
  const license = req.tenantContext?.licenseId;
  const isCsvExport = req.query.export === 'csv';
  const requestedLimit = parseInt(req.query.limit || 25, 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 25, 1),
    isCsvExport ? 5000 : 100
  );
  let startDate = req.query.startDate;
  let endDate = req.query.endDate;
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const [year, month, day] = startDate.split('-').map(Number);
    startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const [year, month, day] = endDate.split('-').map(Number);
    endDate = new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  const logs = await activityLogger.getActivityLogs({
    userId: req.query.userId,
    action: req.query.action,
    entity: 'sale',
    entityId: req.query.entityId,
    branch,
    license,
    startDate,
    endDate,
    page: parseInt(req.query.page || 1, 10),
    limit,
  });

  const users =
    req.query.includeUsers === '1'
      ? await activityLogger.getActivityUsers({ entity: 'sale', branch, license })
      : undefined;

  const list = logs.docs || logs;
  const documentIds = list
    .map((log) => String(log.entityId || ''))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const sales = documentIds.length
    ? await Sale.find({ _id: { $in: documentIds }, branch_id: branch, license })
        .select('_id sales_id')
        .lean()
    : [];
  const salesIdByDocument = new Map(sales.map((sale) => [String(sale._id), sale.sales_id]));
  const enrichedList = list.map((log) => ({
    ...log,
    saleId:
      salesIdByDocument.get(String(log.entityId || '')) ||
      log.details?.changes?.sales_id ||
      log.entityId,
  }));

  res.status(200).json({
    type: 'success',
    message: 'Sales audit logs retrieved successfully',
    data: {
      list: enrichedList,
      total: logs.totalDocs || logs.total || 0,
      page: logs.page || 1,
      pages: logs.totalPages || logs.pages || 1,
      ...(users ? { users } : {}),
    },
  });
});

/**
 * @desc    Get a single activity log by ID
 * @route   GET /api/activity-logs/:id
 * @access  Private/Admin
 */
exports.getActivityLog = catchAsync(async (req, res, next) => {
  const scope = req.tenantContext && {
    branch: req.tenantContext.branchId,
    license: req.tenantContext.licenseId,
  };
  const log = scope
    ? await activityLogger.getActivityLog(req.params.id, scope)
    : await activityLogger.getActivityLog(req.params.id);

  if (!log) {
    return next(new AppError('No activity log found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      log,
    },
  });
});

/**
 * @desc    Create a new activity log
 * @route   POST /api/activity-logs
 * @access  Private/Admin
 */
exports.createActivityLog = catchAsync(async (req, res, next) => {
  const scope = req.tenantContext && {
    branch: req.tenantContext.branchId,
    license: req.tenantContext.licenseId,
    userName: req.user?.username || req.user?.name,
  };
  const log = await activityLogger.logActivity({
    userId: scope ? req.user?._id : req.body.userId,
    action: req.body.action,
    entity: req.body.entity,
    entityId: req.body.entityId,
    details: req.body.details,
    ipAddress: clientIp(req),
    userAgent: req.get('user-agent'),
    ...(scope || {}),
  });

  res.status(201).json({
    status: 'success',
    data: {
      log,
    },
  });
});

/**
 * @desc    Update an activity log
 * @route   PUT /api/activity-logs/:id
 * @access  Private/Admin
 */
exports.updateActivityLog = catchAsync(async (req, res, next) => {
  const { branch, branch_id, branchId, license, license_id, ...safeUpdate } = req.body;
  const scope = req.tenantContext && {
    branch: req.tenantContext.branchId,
    license: req.tenantContext.licenseId,
  };
  const log = scope
    ? await activityLogger.updateActivityLog(req.params.id, safeUpdate, scope)
    : await activityLogger.updateActivityLog(req.params.id, safeUpdate);

  if (!log) {
    return next(new AppError('No activity log found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      log,
    },
  });
});

/**
 * @desc    Delete an activity log
 * @route   DELETE /api/activity-logs/:id
 * @access  Private/Admin
 */
exports.delete = catchAsync(async (req, res, next) => {
  const scope = req.tenantContext && {
    branch: req.tenantContext.branchId,
    license: req.tenantContext.licenseId,
  };
  const log = scope
    ? await activityLogger.deleteActivityLog(req.params.id, scope)
    : await activityLogger.deleteActivityLog(req.params.id);

  if (!log) {
    return next(new AppError('No activity log found with that ID', 404));
  }

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
