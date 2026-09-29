'use strict';
const { MetricError } = require('./business-metrics');
const id = (value) => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);

function reportingJobKind(job) {
  const kind = job.summaryKind ?? 'daily';
  if (!id(job.branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(job.businessDate || ''))
    throw new MetricError('invalid_reporting_job');
  const day = new Date(job.businessDate + 'T00:00:00.000Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== job.businessDate)
    throw new MetricError('invalid_reporting_job');
  if (kind === 'register-session') {
    if (
      job.registerSummaryVersion !== 1 ||
      !id(job.sessionId) ||
      !/^[a-f\d]{64}$/.test(job.closeRevision || '') ||
      job._id !== job.branchId + ':session:' + job.sessionId
    )
      throw new MetricError('invalid_reporting_job');
  } else if (
    kind !== 'daily' ||
    job._id !== job.branchId + ':' + job.businessDate ||
    job.sessionId !== undefined ||
    job.closeRevision !== undefined ||
    job.registerSummaryVersion !== undefined
  )
    throw new MetricError('invalid_reporting_job');
  return kind;
}

function preparedSummaryKey(branchId, summary) {
  if (summary?.metricDefinitionVersion === 'register-session-v1') {
    if (
      !id(branchId) ||
      summary.branchId !== branchId ||
      summary.close?.branchId !== branchId ||
      !id(summary.close.sessionId) ||
      summary.schemaVersion !== 1
    )
      throw new MetricError('invalid_reporting_summary');
    return branchId + ':session:' + summary.close.sessionId;
  }
  // Retain the existing daily key; a session document cannot replace that day.
  if (
    !id(branchId) ||
    summary?.schemaVersion !== 2 ||
    summary.branchId !== branchId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(summary.businessDate || '')
  )
    throw new MetricError('invalid_reporting_summary');
  return branchId + ':' + summary.businessDate;
}
module.exports = { reportingJobKind, preparedSummaryKey };
