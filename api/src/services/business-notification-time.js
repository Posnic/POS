'use strict';
const moment = require('moment-timezone');
const clock = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function validateSchedule(schedule) {
  if (
    !schedule ||
    !clock(schedule.time) ||
    typeof schedule.timezone !== 'string' ||
    !moment.tz.zone(schedule.timezone) ||
    !schedule.quiet ||
    typeof schedule.quiet.enabled !== 'boolean' ||
    !clock(schedule.quiet.start) ||
    !clock(schedule.quiet.end) ||
    (schedule.quiet.enabled && schedule.quiet.start === schedule.quiet.end)
  )
    throw new Error('invalid_schedule');
}
function wall(day, time, zone) {
  return moment.tz(day + ' ' + time, 'YYYY-MM-DD HH:mm', true, zone);
}
function deferQuiet(at, schedule) {
  validateSchedule(schedule);
  const date = moment(at).tz(schedule.timezone);
  if (!date.isValid()) throw new Error('invalid_schedule');
  if (!schedule.quiet.enabled) return date.toDate();
  const { start, end } = schedule.quiet,
    time = date.format('HH:mm');
  const overnight = start > end;
  const inside = overnight ? time >= start || time < end : time >= start && time < end;
  if (!inside) return date.toDate();
  const day = date
    .clone()
    .add(overnight && time >= start ? 1 : 0, 'day')
    .format('YYYY-MM-DD');
  let until = wall(day, end, schedule.timezone);
  // If quiet hours end in a repeated hour, choose its remaining occurrence
  // rather than returning an instant that has already passed.
  if (until.valueOf() <= date.valueOf()) {
    const later = until.clone().add(until.utcOffset() - date.utcOffset(), 'minutes');
    if (later.format('YYYY-MM-DD HH:mm') === day + ' ' + end && later.valueOf() > date.valueOf())
      until = later;
    else until = wall(date.clone().add(1, 'day').format('YYYY-MM-DD'), end, schedule.timezone);
  }
  return until.toDate();
}
/** One logical digest per local calendar day. Nonexistent DST times shift by
 * the gap; repeated times use the first occurrence, never two notifications. */
function nextDaily(schedule, after = new Date()) {
  validateSchedule(schedule);
  const from = moment(after).tz(schedule.timezone);
  if (!from.isValid()) throw new Error('invalid_schedule');
  for (let offset = 0; offset < 4; offset++) {
    const businessDate = from.clone().add(offset, 'day').format('YYYY-MM-DD');
    const planned = wall(businessDate, schedule.time, schedule.timezone);
    if (planned.valueOf() <= from.valueOf()) continue;
    return {
      businessDate,
      scheduledAt: planned.toDate(),
      deliverAt: deferQuiet(planned.toDate(), schedule),
    };
  }
  throw new Error('invalid_schedule');
}
module.exports = { validateSchedule, deferQuiet, nextDaily };
