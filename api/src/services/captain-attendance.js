'use strict';
const { ObjectId } = require('mongodb');
const { isIP } = require('node:net');
const { context, allowed } = require('../utils/branch-access');
const { fail } = require('./captain-access');
const { isMultiTenant } = require('../db/tenant-context');
const { getRequestDeviceId } = require('../utils/device-id.util');

// Attendance stays on the till. Do not trust X-Forwarded-For or a phone's
// claim that Wi-Fi is enabled; hosted servers must never attest LAN presence.
function localRequest(req) {
  const ip = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return process.env.POSNIC_DESKTOP === '1' && !isMultiTenant() &&
    !req.headers?.forwarded && !req.headers?.['x-forwarded-for'] &&
    isIP(ip) === 4 && (/^10\./.test(ip) || /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
}
async function scope(req) {
  if (!localRequest(req)) fail('ATTENDANCE_WIFI_REQUIRED', 'Connect to the shop Wi-Fi to record your shift.', 409);
  const c = await context(req);
  if ([false, 0, '0', 'false'].includes(c.branch.module_captain_enable))
    fail('CAPTAIN_DISABLED', 'Captain is disabled.');
  if (!ObjectId.isValid(String(req.user?._id))) fail('AUTH_REQUIRED', 'Sign in first.', 401);
  return { ...c, userId: new ObjectId(String(req.user._id)) };
}
const enabled = branch => branch.captain_attendance?.enabled === true &&
  ![false, 'false', 0, '0'].includes(branch.staff_shifts_enable);
const filter = c => ({ license: c.license, user_id: c.userId });
function visible(s) {
  if (!s) return null;
  return { id: String(s._id), branchId: String(s.branch_id), status: s.status,
    clockIn: s.clock_in, clockOut: s.clock_out, workedMinutes: s.worked_minutes,
    breakMinutes: s.break_minutes || 0 };
}
async function current(req) {
  const c = await scope(req), col = req.db.collection('shifts');
  const shift = await col.findOne({ ...filter(c), status: 'open' });
  return { enabled: enabled(c.branch), canManage: allowed(req.user, 'settings'),
    branchId: String(c.branchId), shift: visible(shift) };
}
async function settings(req) {
  const c = await scope(req);
  if (!allowed(req.user, 'settings')) fail('MANAGER_REQUIRED', 'Settings permission is required.');
  if (typeof req.body?.enabled !== 'boolean') fail('INVALID_SETTINGS', 'Choose whether to enable attendance.', 422);
  if (req.body.enabled && [false, 'false', 0, '0'].includes(c.branch.staff_shifts_enable))
    fail('SHIFTS_DISABLED', 'Enable staff shifts in POS first.', 409);
  await req.db.collection('branches').updateOne({ _id: c.branchId, license: c.license },
    { $set: { captain_attendance: { enabled: req.body.enabled }, updated_date: new Date() } });
  return { saved: true, enabled: req.body.enabled };
}
async function record(req) {
  const c = await scope(req), body = req.body || {}, col = req.db.collection('shifts');
  if (!['start', 'end'].includes(body.action)) fail('INVALID_ACTION', 'Invalid shift action.', 422);
  if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '')) fail('INVALID_REQUEST', 'A request ID is required.', 422);
  // Unique partial index protects concurrent phones, as well as desktop clock-in.
  // Existing duplicate open shifts intentionally fail closed for manager review.
  await col.createIndex({ license: 1, user_id: 1 }, {
    name: 'one_open_staff_shift', unique: true, partialFilterExpression: { status: 'open' },
  });
  let shift;
  if (body.action === 'start') {
    shift = await col.findOne({ ...filter(c), mobile_request_id: body.requestId });
    if (shift) return { confirmed: true, shift: visible(shift) };
    if (!enabled(c.branch)) fail('ATTENDANCE_DISABLED', 'Ask your manager to enable mobile attendance.', 403);
    shift = await col.findOne({ ...filter(c), status: 'open' });
    if (shift) fail('SHIFT_ALREADY_OPEN', 'You already have an open shift. Refresh to see it.', 409);
    const now = new Date();
    shift = { _id: new ObjectId(), ...filter(c), branch_id: c.branchId,
      user_name: req.user.username || req.user.name || req.user.email || '',
      status: 'open', clock_in: now, clock_out: null, worked_minutes: 0, break_minutes: 0,
      created_date: now, updated_date: now, device_id: getRequestDeviceId(req),
      mobile_request_id: body.requestId, source: 'captain',
      attendance_events: [{ action: 'start', at: now, request_id: body.requestId }] };
    try { await col.insertOne(shift); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const replay = await col.findOne({ ...filter(c), mobile_request_id: body.requestId });
      if (replay) return { confirmed: true, shift: visible(replay) };
      fail('SHIFT_ALREADY_OPEN', 'You already have an open shift. Refresh to see it.', 409);
    }
  } else {
    if (!ObjectId.isValid(String(body.shiftId))) fail('INVALID_SHIFT', 'Refresh your shift first.', 422);
    const query = { ...filter(c), _id: new ObjectId(String(body.shiftId)), branch_id: c.branchId };
    shift = await col.findOne(query);
    if (!shift) fail('SHIFT_NOT_FOUND', 'This shift belongs to another shop or staff member.', 404);
    // End remains available after a manager disables new mobile clock-ins.
    if (shift.status !== 'closed') {
      const now = new Date();
      const worked = Math.max(0, Math.round((now - new Date(shift.clock_in)) / 60000) - (Number(shift.break_minutes) || 0));
      await col.updateOne({ ...query, status: 'open' }, {
        $set: { status: 'closed', clock_out: now, worked_minutes: worked, updated_date: now },
        $push: { attendance_events: { action: 'end', at: now, request_id: body.requestId, device_id: getRequestDeviceId(req) } },
      });
      shift = await col.findOne(query);
    }
  }
  return { confirmed: true, shift: visible(shift) };
}
module.exports = { current, settings, record, localRequest, enabled };
