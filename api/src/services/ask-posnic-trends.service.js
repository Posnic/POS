'use strict';

const moment = require('moment-timezone');

async function read(model, range, interval) {
  if (!model.branchId || !model.licenseId) throw new Error('An authenticated shop and outlet are required for trends.');
  if (!['hour', 'day'].includes(interval)) throw new Error('Unsupported trend interval.');
  const from = new Date(range.start_date), to = new Date(range.end_date);
  if (!Number.isFinite(+from) || !Number.isFinite(+to)) throw new Error('A valid report period is required.');
  if (from > to) return [];
  if (+to - +from > 367 * 86400000) throw new Error('Sales trends support periods up to one year.');
  const timezone = moment.tz.zone(model.timeZone) ? model.timeZone : 'UTC';
  const match = model.getContextMatch({ date: { $gte: from, $lte: to }, sale_process: { $in: ['Add', 'Edit', 'PartialReturn'] } });
  const sales = await model.getCollection('sales');
  const rows = await sales.aggregate([
    { $match: match },
    { $group: {
      _id: { $dateToString: { date: '$date', format: interval === 'hour' ? '%H:00' : '%Y-%m-%d', timezone } },
      transactions: { $sum: 1 },
      amount: { $sum: '$items_total' },
    } },
    { $sort: { _id: 1 } },
  ], { maxTimeMS: 15000 }).toArray();
  return rows.map((row) => ({ label: row._id, transactions: row.transactions, amount: Math.round(Number(row.amount || 0) * 100) / 100 }));
}

function answer(rows, interval, period, timezone) {
  const visible = interval === 'day' ? rows.slice(-31) : rows;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const transactions = rows.reduce((sum, row) => sum + row.transactions, 0);
  const label = interval === 'hour' ? 'Hourly' : 'Daily';
  const peak = rows.reduce((best, row) => !best || row.transactions > best.transactions ? row : best, null);
  const notes = interval === 'hour' ? 'Hours combine the same local hour across the selected period.' : rows.length > 31 ? 'Showing the latest 31 days with sales; totals cover the full period.' : 'Days without sales are omitted.';
  return {
    answer: rows.length ? `${label} sales for ${String(period).replace(/_/g, ' ')} (${timezone}). ${interval === 'hour' ? `Busiest hour by transaction count: ${peak.label} (${peak.transactions}). ` : ''}${notes} Recorded totals follow the sales dashboard: completed and partially returned sales are included; fully returned sales are excluded.` : `No sales were recorded for ${String(period).replace(/_/g, ' ')}.`,
    metrics: [{ label: 'Sales', value: total.toFixed(2) }, { label: 'Transactions', value: transactions }, ...visible.map((row) => ({ label: row.label, value: `${row.amount.toFixed(2)} · ${row.transactions} transaction${row.transactions === 1 ? '' : 's'}` }))],
    source: `${label} sales records`, link: '#/sales',
  };
}

module.exports = { read, answer };
