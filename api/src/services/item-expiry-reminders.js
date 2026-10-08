'use strict';
const moment = require('moment-timezone');
const { context, allowed, fail } = require('../utils/branch-access');
function preference(branch) {
  const saved = branch.expiry_reminders;
  return {
    enabled: saved?.enabled === true,
    days: Number.isInteger(saved?.days) && saved.days >= 0 && saved.days <= 365 ? saved.days : 7,
  };
}
async function scoped(req, write = false) {
  if (!req.user || !allowed(req.user, 'item', 'read')) fail('Item permission is required.', 403);
  if (write && !['owner', 'super_admin', 'admin'].includes(req.user.usertype))
    fail('An administrator must configure expiry reminders.', 403);
  return context(req);
}
async function read(req) {
  return preference((await scoped(req)).branch);
}
async function save(req) {
  const c = await scoped(req, true);
  const { enabled, days } = req.body || {};
  if (typeof enabled !== 'boolean' || !Number.isInteger(days) || days < 0 || days > 365)
    fail('Choose a reminder period between 0 and 365 days.');
  await req.db
    .collection('branches')
    .updateOne(
      { _id: c.branchId, license: c.license },
      { $set: { expiry_reminders: { enabled, days }, updated_date: new Date() } }
    );
  return { enabled, days };
}
function windowFor(branch, days, now) {
  const timezone = moment.tz.zone(branch.time_zone) ? branch.time_zone : 'UTC';
  const today = moment(now).tz(timezone).format('YYYY-MM-DD');
  return { today, through: moment.utc(today).add(days, 'days').format('YYYY-MM-DD'), timezone };
}
async function list(req, now = new Date(), report = false) {
  const c = await scoped(req),
    settings = preference(c.branch);
  const page = Number(req.query?.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Choose a valid page.');
  const days = report ? Number(req.query?.days ?? 30) : settings.days;
  if (!Number.isInteger(days) || days < 0 || days > 365)
    fail('Choose a period between 0 and 365 days.');
  const status = report ? req.query?.status || 'all' : 'all';
  const sort = report ? req.query?.sort || 'asc' : 'asc';
  if (!['all', 'expired', 'upcoming'].includes(status) || !['asc', 'desc'].includes(sort))
    fail('Invalid report filter.');
  const search = report ? String(req.query?.search || '').trim() : '';
  if (search.length > 100) fail('Search must be at most 100 characters.');
  const range = windowFor(c.branch, days, now);
  if (!report && !settings.enabled)
    return {
      ...settings,
      ...range,
      canManage: ['owner', 'super_admin', 'admin'].includes(req.user.usertype),
      page,
      total: 0,
      rows: [],
    };
  const pipeline = [
    {
      $match: {
        license: c.license,
        $or: [{ branch_id: c.branchId }, { 'branch_access.branch_id': c.branchId }],
        item_status: { $ne: 'instant' },
        available_quantity: { $gt: 0 },
        ...(search
          ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
          : {}),
      },
    },
    // Item expiry is a calendar date; never shift it to the browser timezone.
    {
      $set: {
        expiryDay: {
          $substrCP: [
            { $convert: { input: '$items_expiry_date', to: 'string', onError: '', onNull: '' } },
            0,
            10,
          ],
        },
      },
    },
    {
      $match: {
        expiryDay: {
          $regex: '^\\d{4}-\\d{2}-\\d{2}$',
          $lte: range.through,
          ...(status === 'expired'
            ? { $lt: range.today }
            : status === 'upcoming'
              ? { $gte: range.today }
              : {}),
        },
      },
    },
    {
      $set: {
        expiryParsed: {
          $convert: { input: '$expiryDay', to: 'date', onError: null, onNull: null },
        },
      },
    },
    {
      $match: {
        expiryParsed: { $ne: null },
        $expr: {
          $eq: [
            '$expiryDay',
            { $dateToString: { date: '$expiryParsed', format: '%Y-%m-%d', onNull: '' } },
          ],
        },
      },
    },
    { $sort: { expiryDay: sort === 'desc' ? -1 : 1, _id: 1 } },
    {
      $facet: {
        count: [{ $count: 'total' }],
        rows: [
          { $skip: (page - 1) * 25 },
          { $limit: 25 },
          { $project: { name: 1, sku: 1, available_quantity: 1, expiryDay: 1 } },
        ],
      },
    },
  ];
  const [result] = await req.db
    .collection('items')
    .aggregate(pipeline, { maxTimeMS: 5000 })
    .toArray();
  return {
    ...settings,
    ...range,
    canManage: ['owner', 'super_admin', 'admin'].includes(req.user.usertype),
    page,
    total: result?.count[0]?.total || 0,
    rows: (result?.rows || []).map((row) => ({
      id: String(row._id),
      name: row.name,
      sku: row.sku || '',
      quantity: row.available_quantity,
      expiryDate: row.expiryDay,
      daysRemaining: moment.utc(row.expiryDay).diff(moment.utc(range.today), 'days'),
    })),
  };
}
module.exports = {
  read,
  save,
  list,
  report: (req, now) => list(req, now, true),
  preference,
  windowFor,
};
