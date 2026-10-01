'use strict';

const { ObjectId } = require('mongodb');
const moment = require('moment-timezone');
const crypto = require('node:crypto');
const BaseModel = require('../models/base.model');

const COLLECTION = 'ask_posnic_schedules';
const FREQUENCIES = new Set(['daily', 'weekly']);
const REPORTS = new Set(['sales', 'profit', 'low_stock']);
const bounded = (value, fallback, maximum) => Number.isInteger(Number(value)) && value !== null && value !== '' && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : fallback;

function nextRun(schedule, from = new Date()) {
  const zone = moment.tz.zone(schedule.timezone) ? schedule.timezone : 'UTC';
  const hour = bounded(schedule.hour, 8, 23);
  const next = moment.tz(from, zone).startOf('hour').hour(hour).minute(0).second(0).millisecond(0);
  if (schedule.frequency === 'weekly') {
    const weekday = bounded(schedule.weekday, 1, 6);
    while (next.day() !== weekday || !next.isAfter(moment(from))) next.add(1, 'day');
  } else if (!next.isAfter(moment(from))) next.add(1, 'day');
  return next.toDate();
}

async function save(context, input) {
  if (!context.licenseId || !context.branchId || !context.userId) throw new Error('A shop, outlet and owner are required.');
  if (!FREQUENCIES.has(input.frequency)) throw new Error('Schedule must be daily or weekly.');
  if (!REPORTS.has(input.report)) throw new Error('Choose a supported report.');
  let destination = String(input.destination || '').trim().toLowerCase();
  const channel = input.channel === 'whatsapp' ? 'whatsapp' : 'email';
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) throw new Error('Enter a valid delivery email.');
  if (channel === 'whatsapp' && !/^\+?[0-9]{8,15}$/.test(destination.replace(/[\s()-]/g, ''))) throw new Error('Enter a valid WhatsApp phone number.');
  if (channel === 'whatsapp') destination = destination.replace(/[\s()-]/g, '');
  const doc = {
    license: String(context.licenseId || ''), branch_id: String(context.branchId || ''), user_id: String(context.userId || ''),
    report: input.report, frequency: input.frequency, weekday: bounded(input.weekday, 1, 6), hour: bounded(input.hour, 8, 23),
    timezone: moment.tz.zone(input.timezone) ? input.timezone : 'UTC', channel, destination,
    enabled: input.enabled !== false, updated_at: new Date(),
  };
  doc.next_run_at = nextRun(doc);
  const col = await (new BaseModel(COLLECTION)).getCollection(COLLECTION);
  if (input.id && ObjectId.isValid(String(input.id))) {
    const result = await col.findOneAndUpdate({ _id: new ObjectId(String(input.id)), license: doc.license, branch_id: doc.branch_id, running_at: { $exists: false }, last_status: { $ne: 'needs_review' } }, { $set: doc }, { returnDocument: 'after' });
    if (!result) throw new Error('Schedule not found or its interrupted delivery needs operator review.');
    const visible = { ...result };
    delete visible.execution_owner; delete visible.running_claim; delete visible.recovery;
    return visible;
  }
  doc.created_at = new Date();
  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function list(context) {
  return (await (new BaseModel(COLLECTION)).getCollection(COLLECTION)).find({ license: String(context.licenseId || ''), branch_id: String(context.branchId || '') }, { projection: { execution_owner: 0, running_claim: 0, recovery: 0 } }).sort({ created_at: -1 }).toArray();
}

async function remove(context, id) {
  if (!ObjectId.isValid(String(id))) return false;
  const result = await (await (new BaseModel(COLLECTION)).getCollection(COLLECTION)).deleteOne({ _id: new ObjectId(String(id)), license: String(context.licenseId || ''), branch_id: String(context.branchId || ''), running_at: { $exists: false }, last_status: { $ne: 'needs_review' } });
  return result.deletedCount === 1;
}

async function runDue(context, buildReport, deliver, at = new Date()) {
  const col = await (new BaseModel(COLLECTION)).getCollection(COLLECTION);
  // A crash may occur after the provider accepted a message. Require a human
  // review instead of retrying a delivery whose outcome cannot be established.
  await col.updateMany({ license: String(context.licenseId), branch_id: String(context.branchId), running_at: { $lte: new Date(at.getTime() - 15 * 60 * 1000) } }, { $set: { enabled: false, last_status: 'needs_review', last_error: 'Delivery was interrupted. Verify the worker stopped and review delivery history before recovery.' } });
  const due = await col.find({ license: String(context.licenseId || ''), branch_id: String(context.branchId || ''), enabled: true, next_run_at: { $lte: at } }).limit(25).toArray();
  const outcomes = [];
  for (const schedule of due) {
    const claim = await col.findOneAndUpdate({ _id: schedule._id, next_run_at: schedule.next_run_at, enabled: true, running_at: { $exists: false } }, { $set: { running_at: at, running_claim: crypto.randomUUID(), execution_owner: require('./ask-posnic-execution-owner').current() }, $inc: { run_attempts: 1 } }, { returnDocument: 'after' });
    if (!claim) continue;
    const claimed = { _id: schedule._id, running_claim: claim.running_claim };
    let delivering = false;
    try {
      const report = await buildReport(schedule);
      const permission = await col.updateOne({ ...claimed, enabled: true }, { $set: { delivering_at: new Date() } });
      if (permission.matchedCount !== 1) throw new Error('Delivery was paused or its claim changed.');
      delivering = true;
      await deliver(schedule, report);
      const following = nextRun(schedule, new Date(at.getTime() + 1000));
      await col.updateOne(claimed, { $set: { next_run_at: following, last_run_at: at, last_status: 'sent', last_error: null }, $unset: { running_at: '', running_claim: '', delivering_at: '' } });
      outcomes.push({ id: String(schedule._id), status: 'sent' });
    } catch (error) {
      const status = delivering ? 'needs_review' : 'failed';
      await col.updateOne(claimed, { $set: { next_run_at: new Date(at.getTime() + 15 * 60 * 1000), last_run_at: at, last_status: status, last_error: delivering ? 'Delivery was not confirmed. Check the provider before re-enabling.' : 'The report could not be prepared. Check owner access and report settings.', ...(delivering ? { enabled: false } : {}) }, $unset: { running_at: '', running_claim: '', delivering_at: '' } });
      outcomes.push({ id: String(schedule._id), status });
    }
  }
  return outcomes;
}

module.exports = { save, list, remove, runDue, nextRun, COLLECTION, FREQUENCIES, REPORTS };
