'use strict';

const moment = require('moment-timezone');

// A calendar period belongs to the registration timezone, not the server's.
function calendarPeriod({ from, through, timezone }) {
  if (!moment.tz.zone(timezone)) throw new RangeError('A valid reporting timezone is required');
  const start = moment.tz(from, 'YYYY-MM-DD', true, timezone);
  const last = moment.tz(through, 'YYYY-MM-DD', true, timezone);
  if (!start.isValid() || !last.isValid() || last.isBefore(start)) {
    throw new RangeError('A valid inclusive calendar date range is required');
  }
  return {
    from,
    through,
    timezone,
    start: start.toDate(),
    endExclusive: last.add(1, 'day').startOf('day').toDate(),
  };
}

module.exports = { calendarPeriod };
