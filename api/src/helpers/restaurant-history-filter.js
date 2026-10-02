'use strict';
const moment = require('moment-timezone');
const { normalizeDayparts } = require('../utils/online-ordering');

// Applied before pagination and counting; existing date/security filters remain an intersection.
function restaurantHistoryFilter(query, periods, timezone) {
  const clauses = [];
  if (query.table_number) {
    if (typeof query.table_number !== 'string' || query.table_number.length > 80) {
      throw Object.assign(new Error('Choose a valid table.'), { statusCode: 400 });
    }
    const number = query.table_number.trim();
    const values = [number];
    if (String(Number(number)) === number) values.push(Number(number));
    clauses.push({ table_number: { $in: values } });
  }
  if (query.tables_only === 'true')
    clauses.push({ table_number: { $exists: true, $nin: [null, '', 0, '0'] } });
  if (query.serving_period) {
    const period = normalizeDayparts(periods).find((p) => p.id === query.serving_period);
    if (!period || !period.hours)
      throw Object.assign(
        new Error('This serving period has no saved times. Check Restaurant settings.'),
        { statusCode: 400 }
      );
    const zone = moment.tz.zone(timezone) ? timezone : 'UTC';
    const date = {
      $convert: {
        input: { $ifNull: ['$date', '$created_date'] },
        to: 'date',
        onError: null,
        onNull: null,
      },
    };
    const parts = { date, timezone: zone };
    const minute = { $add: [{ $multiply: [{ $hour: parts }, 60] }, { $minute: parts }] };
    const weekday = { $dayOfWeek: parts };
    const windows = [];
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((day, index) => {
      for (const window of period.hours[day] || []) {
        const range = (d, start, end) => ({
          $and: [{ $eq: [weekday, d] }, { $gte: [minute, start] }, { $lt: [minute, end] }],
        });
        if (window.close < window.open) {
          windows.push(
            range(index + 1, window.open, 1440),
            range(((index + 1) % 7) + 1, 0, window.close)
          );
        } else windows.push(range(index + 1, window.open, window.close));
      }
    });
    clauses.push({ $expr: windows.length ? { $or: windows } : { $eq: [1, 0] } });
  }
  return clauses;
}
module.exports = { restaurantHistoryFilter };
