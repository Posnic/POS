'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const platform = require('./ask-posnic-platform.service');
const moment = require('moment-timezone');

const variants = (id) =>
  ObjectId.isValid(String(id)) ? [String(id), new ObjectId(String(id))] : [String(id)];
const forbidden = (message) => Object.assign(new Error(message), { statusCode: 403 });

// Owners also have explicit branch assignments. Never widen access from a role
// or from outlet IDs supplied in a question, body, token, or conversation.
async function authorized(req) {
  const scope = platform.scope(req);
  const db = await BaseModel.getDb();
  const user = await db.collection('users').findOne(
    {
      _id: { $in: variants(scope.user_id) },
      license: { $in: variants(scope.license) },
      isActive: { $ne: false },
      status: { $nin: ['inactive', 'suspended', 'pending', 'deleted'] },
    },
    { projection: { role: 1, usertype: 1, access: 1, branch_access: 1 } }
  );
  const financials =
    user &&
    (['role', 'usertype'].some((key) => ['admin', 'super_admin'].includes(user[key])) ||
      user.access?.dashboard?.financials === true);
  if (!financials || user.access?.sales?.session_filter === true)
    throw forbidden(
      'Outlet comparison requires financial access without a single-session restriction.'
    );
  if (!platform.capabilityAllowed(await platform.getPreferences(req), 'insights', user))
    throw forbidden('Insights are not enabled for your role.');
  const ids = [
    ...new Set(
      (user.branch_access || []).map((entry) => String(entry.branch_id || '')).filter(Boolean)
    ),
  ];
  if (!ids.includes(scope.branch_id))
    throw forbidden('Your current outlet is no longer available.');
  if (ids.length > 100)
    throw Object.assign(new Error('Outlet comparison supports up to 100 assigned outlets.'), {
      statusCode: 400,
    });
  const branches = await db
    .collection('branches')
    .find(
      {
        _id: { $in: ids.flatMap(variants) },
        license: { $in: variants(scope.license) },
        isActive: { $ne: false },
        status: { $nin: ['inactive', 'suspended', 'deleted'] },
      },
      { projection: { branch_name: 1, currency: 1 } }
    )
    .sort({ branch_name: 1, _id: 1 })
    .toArray();
  if (!branches.some((branch) => String(branch._id) === scope.branch_id))
    throw forbidden('Your current outlet is unavailable.');
  return { db, scope, branches };
}

async function read(req, range, timezone) {
  const { db, scope, branches } = await authorized(req);
  const from = new Date(range.start_date),
    to = new Date(range.end_date);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to || +to - +from > 367 * 86400000)
    throw Object.assign(new Error('A valid report period of up to one year is required.'), {
      statusCode: 400,
    });
  const rows = await db
    .collection('sales')
    .aggregate(
      [
        {
          $match: {
            license: { $in: variants(scope.license) },
            branch_id: { $in: branches.flatMap((branch) => variants(branch._id)) },
            date: { $gte: from, $lte: to },
            sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] },
          },
        },
        {
          $group: {
            _id: { $toString: '$branch_id' },
            transactions: { $sum: 1 },
            amount: { $sum: '$items_total' },
            latest_sale: { $max: '$date' },
          },
        },
      ],
      { maxTimeMS: 15000 }
    )
    .toArray();
  const byId = new Map(rows.map((row) => [row._id, row]));
  return {
    outlets: branches.map((branch) => {
      const row = byId.get(String(branch._id));
      return {
        branch_id: String(branch._id),
        outlet: branch.branch_name || 'Unnamed outlet',
        currency: branch.currency || 'Currency not configured',
        transactions: row?.transactions || 0,
        amount: Number(row?.amount || 0),
        latest_sale: row?.latest_sale || null,
      };
    }),
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: moment.tz.zone(timezone) ? timezone : 'UTC',
    as_of: new Date().toISOString(),
  };
}

function answer(result, period) {
  return {
    answer: `Sales by outlet for ${String(period).replace(/_/g, ' ')}: ${result.outlets.length} assigned outlet${result.outlets.length === 1 ? '' : 's'} in this shop. All outlets use the same report window (${result.timezone}). Each amount uses that outlet's configured currency; amounts are not combined across outlets. These are records currently available in this installation, so an offline outlet's unsynced sales are not included. Completed and partially returned sales are included; fully returned sales are excluded.`,
    metrics: result.outlets.map((row) => ({
      label: `${row.outlet} (${row.currency})`,
      value: `${row.amount.toFixed(2)} · ${row.transactions} transaction${row.transactions === 1 ? '' : 's'}`,
    })),
    source: 'Sales records by authorized outlet',
    link: '#/sales',
    scope: {
      outlets: result.outlets,
      from: result.from,
      to: result.to,
      timezone: result.timezone,
      as_of: result.as_of,
    },
  };
}

async function historyAccess(req) {
  try {
    return new Set((await authorized(req)).branches.map((branch) => String(branch._id)));
  } catch (_error) {
    return new Set();
  }
}

function canReadSaved(payload, allowed) {
  return (
    Array.isArray(payload?.scope?.outlets) &&
    payload.scope.outlets.length > 0 &&
    payload.scope.outlets.every((row) => allowed.has(String(row.branch_id)))
  );
}

module.exports = { authorized, read, answer, historyAccess, canReadSaved };
