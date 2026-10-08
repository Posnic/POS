'use strict';
const Money = require('../utils/currency');
const indexes = new WeakMap();
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: 422 });
};
async function collection(db) {
  if (!indexes.has(db))
    indexes.set(
      db,
      db
        .collection('extension_payments')
        .createIndex(
          { license: 1, branch_id: 1, extensionId: 1, status: 1, paidAt: -1, _id: -1 },
          { name: 'extension_paid_history' }
        )
        .catch((error) => {
          indexes.delete(db);
          throw error;
        })
    );
  await indexes.get(db);
  return db.collection('extension_payments');
}
function filter(scope, descriptor) {
  return {
    license: scope.license,
    branch_id: scope.branchId,
    extensionId: descriptor.id,
    status: 'paid',
  };
}
async function listSales({ db, scope, descriptor, after = '' }) {
  const match = filter(scope, descriptor);
  if (after) {
    if (typeof after !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z~[a-f0-9]{64}$/.test(after))
      fail('extension_history_cursor_invalid');
    const [instant, id] = after.split('~'),
      date = new Date(instant);
    if (!Number.isFinite(date.getTime())) fail('extension_history_cursor_invalid');
    match.$or = [{ paidAt: { $lt: date } }, { paidAt: date, _id: { $lt: id } }];
  }
  const rows = await (
    await collection(db)
  )
    .find(match, {
      projection: {
        saleId: 1,
        paidAt: 1,
        valueMinor: 1,
        currency: 1,
        method: 1,
        'payload.customer_name': 1,
      },
    })
    .sort({ paidAt: -1, _id: -1 })
    .limit(51)
    .maxTimeMS(5000)
    .toArray();
  const page = rows.slice(0, 50);
  return {
    sales: page.map((row) => ({
      id: String(row.saleId),
      paidAt: row.paidAt.toISOString(),
      valueMinor: row.valueMinor,
      currency: row.currency,
      method: row.method,
      customer: row.payload?.customer_name || 'Walk-in customer',
    })),
    next: rows.length > 50 ? `${page.at(-1).paidAt.toISOString()}~${page.at(-1)._id}` : null,
  };
}
async function dailySales({ db, scope, descriptor, day, endDay = day }) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    fail('extension_report_date_invalid');
  const utc = new Date(day + 'T00:00:00.000Z');
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== day)
    fail('extension_report_date_invalid');
  const endUtc = new Date(endDay + 'T00:00:00.000Z');
  if (typeof endDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDay) || !Number.isFinite(+endUtc) || endUtc.toISOString().slice(0,10) !== endDay || endDay < day || +endUtc - +utc > 366 * 86400000)
    fail('extension_report_date_invalid');
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branchId, license: scope.license });
  if (!branch) fail('extension_branch_unavailable');
  const timeZone = branch.time_zone || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(utc);
  } catch {
    fail('extension_report_timezone_invalid');
  }
  // Indexed coarse UTC window, then exact shop-local calendar day (including DST).
  const rows = await (
    await collection(db)
  )
    .aggregate(
      [
        {
          $match: {
            ...filter(scope, descriptor),
            paidAt: { $gte: new Date(+utc - 36 * 3600000), $lt: new Date(+endUtc + 60 * 3600000) },
          },
        },
        {
          $match: {
            $expr: {
              $and: [
                { $gte: [{ $dateToString: { date: '$paidAt', format: '%Y-%m-%d', timezone: timeZone } }, day] },
                { $lte: [{ $dateToString: { date: '$paidAt', format: '%Y-%m-%d', timezone: timeZone } }, endDay] },
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              code: '$currency.currencyCode',
              digits: '$currency.currencyDigits',
              method: '$method',
            },
            valueMinor: { $sum: '$valueMinor' },
          },
        },
      ],
      { maxTimeMS: 5000 }
    )
    .toArray();
  const groups = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.valueMinor)) fail('extension_report_total_invalid');
    const key = `${row._id.code}:${row._id.digits}`;
    if (!groups.has(key))
      groups.set(key, {
        currency: Money.policy({ currencyCode: row._id.code, currencyDigits: row._id.digits }),
        cashMinor: 0,
        cardMinor: 0,
      });
    if (row._id.method === 'cash') groups.get(key).cashMinor = row.valueMinor;
    if (row._id.method === 'card') groups.get(key).cardMinor = row.valueMinor;
  }
  return { day, endDay, timeZone, totals: [...groups.values()] };
}
module.exports = { listSales, dailySales };
