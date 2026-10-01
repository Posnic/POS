'use strict';

const moment = require('moment-timezone');

/** Half-open daily windows: a noon sale belongs to lunch, never both meals. */
function dailyReportPeriod(query, timezone) {
  const zone = moment.tz.zone(timezone) ? timezone : 'UTC';
  const parseDay = (value) => {
    const text = String(value || '').trim();
    const prefix = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
    const day = prefix ? prefix.slice(1).join('-') : text;
    return moment.tz(day, ['YYYY-MM-DD', 'MM/DD/YYYY'], true, zone).startOf('day');
  };
  const first = parseDay(query.starting_date),
    last = parseDay(query.ending_date);
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  if (!first.isValid() || !last.isValid() || last.isBefore(first))
    fail('Select a valid date range.');
  const from = query.start_time,
    to = query.end_time;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((from || to) && (!time.test(from || '') || !time.test(to || '') || from === to)) {
    fail('Choose different valid start and end times.');
  }
  const windows = [];
  if (!from && !to)
    windows.push({ start: first.toDate(), end: last.clone().add(1, 'day').toDate() });
  else {
    if (last.diff(first, 'days') > 366) fail('Choose up to 367 days when filtering by time.');
    for (const day = first.clone(); !day.isAfter(last); day.add(1, 'day')) {
      const start = moment.tz(day.format('YYYY-MM-DD') + ' ' + from, 'YYYY-MM-DD HH:mm', zone);
      const endDay = day.clone().add(to < from ? 1 : 0, 'day');
      const end = moment.tz(endDay.format('YYYY-MM-DD') + ' ' + to, 'YYYY-MM-DD HH:mm', zone);
      windows.push({ start: start.toDate(), end: end.toDate() });
    }
  }
  const names = { '06:00/12:00': 'Breakfast', '12:00/18:00': 'Lunch', '18:00/00:00': 'Dinner' };
  const name = names[from + '/' + to] || 'Custom time';
  return {
    start: windows[0].start,
    end: windows[windows.length - 1].end,
    label: from
      ? `${name} · ${from}–${to}${to < from ? ' (next day)' : ''} · ${zone}`
      : `Full day · ${zone}`,
    // Keep the user's session permission as an intersection, never widen it to midnight.
    match(field, sessionStart) {
      return {
        $or: windows.map((w) => ({
          [field]: {
            $gte: sessionStart && sessionStart > w.start ? sessionStart : w.start,
            $lt: w.end,
          },
        })),
      };
    },
  };
}

module.exports = { dailyReportPeriod };
