'use strict';

const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const BaseModel = require('../models/base.model');
const { runWithTenant } = require('../db/tenant-context');
const { runWithRequestContext } = require('../utils/request-context');
const platform = require('./ask-posnic-platform.service');
const schedules = require('./ask-posnic-schedule.service');
const assistant = require('./ask-posnic.service');

const idMatch = (value) => ({ $in: ObjectId.isValid(String(value)) ? [String(value), new ObjectId(String(value))] : [String(value)] });
const isOwner = (user) => ['role', 'usertype'].some((key) => ['owner', 'admin', 'super_admin'].includes(String(user?.[key] || '').toLowerCase()));

async function authorize(db, schedule) {
  const user = await db.collection('users').findOne({ _id: idMatch(schedule.user_id), license: idMatch(schedule.license), isActive: { $ne: false }, status: { $nin: ['inactive', 'suspended', 'pending'] } });
  if (!isOwner(user) || !(user.branch_access || []).some((entry) => String(entry.branch_id) === schedule.branch_id)) throw new Error('Schedule owner no longer has access to this outlet.');
  const branch = await db.collection('branches').findOne({ _id: idMatch(schedule.branch_id), license: idMatch(schedule.license) });
  if (!branch) throw new Error('Scheduled outlet is unavailable.');
  const req = { user, tenantContext: { licenseId: schedule.license, branchId: schedule.branch_id, branchName: branch.branch_name || '' } };
  if (!platform.capabilityAllowed(await platform.getPreferences(req), 'insights', user)) throw new Error('Insights are disabled for the schedule owner.');
  return { req, branch };
}

function reportRange(schedule, at = new Date()) {
  const end = moment.tz(at, schedule.timezone || 'UTC').startOf('day');
  const start = end.clone().subtract(schedule.frequency === 'weekly' ? 7 : 1, 'days');
  return { starting_date: start.toDate(), ending_date: end.subtract(1, 'millisecond').toDate(), filter: 'custom' };
}

async function buildReport(schedule, at, db) {
  const { req, branch } = await authorize(db, schedule);
  return runWithRequestContext({ currentBranch: schedule.branch_id, license: schedule.license, loggedUser: req.user._id }, async () => {
    const DashboardModel = require('../models/dashboard.model');
    const model = new DashboardModel();
    model.branchId = schedule.branch_id;
    model.licenseId = schedule.license;
    model.timeZone = schedule.timezone;
    const range = reportRange(schedule, at);
    const overview = await model.getOverviewModel(range, { financials: true });
    if (!overview.status) throw new Error('The report could not be loaded.');
    return { ...assistant.answerOverview(schedule.report, overview.data, schedule.frequency === 'weekly' ? 'the previous seven complete days' : 'yesterday'), branch, range };
  });
}

async function deliver(schedule, report) {
  const metrics = (report.metrics || []).map((metric) => `${metric.label}: ${metric.value}`).join('\n');
  const text = `${report.answer}\n\n${metrics}\n\nOutlet: ${report.branch.branch_name || schedule.branch_id}\nSource: ${report.source}\nPeriod: ${report.range.starting_date.toISOString()} to ${report.range.ending_date.toISOString()}`;
  if (schedule.channel === 'whatsapp') {
    const MessagingService = require('./messaging.service');
    const sent = await new MessagingService().sendWhatsapp(schedule.branch_id, schedule.destination, text, {
      scheduled: { id: String(schedule._id), license: schedule.license, branch_id: schedule.branch_id, user_id: schedule.user_id, claim: schedule.running_claim },
    });
    if (!sent.ok || typeof sent.messageId !== 'string' || !sent.messageId.trim()) throw new Error('WhatsApp delivery was not acknowledged.');
    return { status: sent.queued ? 'queued' : 'sent', provider: sent.provider, reference: sent.messageId };
  }
  const { resolveShopTransport } = require('../utils/email');
  const { transporter, from } = resolveShopTransport(report.branch);
  if (transporter.options?.jsonTransport) throw new Error('Configure email delivery before enabling scheduled summaries.');
  const info = await transporter.sendMail({ from, to: schedule.destination, subject: `Posnic ${schedule.report.replace('_', ' ')} summary`, text, scheduledReport: true });
  if (info.rejected?.length || !Array.isArray(info.accepted) || !info.accepted.some(address => String(address?.address || address).toLowerCase() === schedule.destination.toLowerCase()) || !info.messageId) throw new Error('The email provider did not acknowledge the destination.');
  return { status: 'sent', provider: transporter.options?.brevo ? 'brevo' : 'smtp', reference: String(info.messageId) };
}

// Called inside the database scope of exactly one tenant by both server modes.
async function sweep({ db, at = new Date(), context, build = buildReport, send = deliver } = {}) {
  db = db || await BaseModel.getDb();
  try { await require('./ask-posnic-retention.service').sweep(db, { licenseId: context?.licenseId, at }); }
  catch (_error) { console.warn('[ask-posnic] retention cleanup failed'); }
  await schedules.reconcileQueued(db, { context, at });
  const filter = { enabled: true, next_run_at: { $lte: at }, ...(context ? { license: String(context.licenseId), branch_id: String(context.branchId) } : {}) };
  const due = await db.collection(schedules.COLLECTION).find(filter).limit(500).toArray();
  const scopes = new Map(due.map((row) => [`${row.license}:${row.branch_id}`, { licenseId: row.license, branchId: row.branch_id }]));
  const outcomes = [];
  for (const scope of scopes.values()) outcomes.push(...await schedules.runDue(scope, (row) => build(row, at, db), async (row, report) => {
    // Recheck owner access immediately before delivering financial data.
    await authorize(db, row);
    return send(row, report);
  }, at));
  return outcomes;
}

function start({ tenants, everyMs = 60000 } = {}) {
  const stopIndexing = require('./ask-posnic-semantic.service').start({ tenants, everyMs });
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (tenants) {
        const seen = new Set();
        for (const tenant of tenants()) {
          if (tenant.suspended || seen.has(tenant.tenantDb)) continue;
          seen.add(tenant.tenantDb);
          try { await runWithTenant(tenant, () => sweep({ db: tenant.db })); }
          catch (_error) { console.warn('[ask-posnic] tenant schedule sweep failed'); }
        }
      } else await sweep();
    } catch (_error) { console.warn('[ask-posnic] schedule sweep failed'); }
    finally { running = false; }
  }, everyMs);
  timer.unref?.();
  return () => { clearInterval(timer); stopIndexing(); };
}

module.exports = { start, sweep, authorize, reportRange, buildReport, deliver };
