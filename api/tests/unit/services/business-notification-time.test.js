'use strict';
const { nextDaily, deferQuiet } = require('../../../src/services/business-notification-time');
const schedule = (extra = {}) => ({
  time: '23:00',
  timezone: 'Asia/Kolkata',
  quiet: { enabled: false, start: '22:00', end: '07:00' },
  ...extra,
});
test('a night digest defers through quiet hours without changing the business date', () => {
  const result = nextDaily(
    schedule({ quiet: { enabled: true, start: '22:00', end: '07:00' } }),
    new Date('2026-09-28T16:00:00Z')
  );
  expect(result.businessDate).toBe('2026-09-28');
  expect(result.scheduledAt.toISOString()).toBe('2026-09-28T17:30:00.000Z');
  expect(result.deliverAt.toISOString()).toBe('2026-09-29T01:30:00.000Z');
});
test('DST gaps shift forward, repeated hours schedule only once, and midnight is a valid time', () => {
  const spring = nextDaily(
    schedule({ timezone: 'America/New_York', time: '02:30' }),
    new Date('2026-03-08T05:00:00Z')
  );
  expect(spring.scheduledAt.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  const fall = schedule({ timezone: 'America/New_York', time: '01:30' });
  expect(nextDaily(fall, new Date('2026-11-01T04:00:00Z')).scheduledAt.toISOString()).toBe(
    '2026-11-01T05:30:00.000Z'
  );
  expect(nextDaily(fall, new Date('2026-11-01T05:45:00Z')).businessDate).toBe('2026-11-02');
  expect(
    nextDaily(schedule({ time: '00:00' }), new Date('2026-09-28T17:00:00Z')).businessDate
  ).toBe('2026-09-29');
});
test('quiet hours ending inside a repeated hour never return a past delivery time', () => {
  const value = schedule({
    timezone: 'America/New_York',
    quiet: { enabled: true, start: '23:00', end: '01:30' },
  });
  expect(deferQuiet(new Date('2026-11-01T06:15:00Z'), value).toISOString()).toBe(
    '2026-11-01T06:30:00.000Z'
  );
});
test('invalid clocks, unknown zones and an ambiguous full-day quiet interval are rejected', () => {
  for (const extra of [
    { time: '24:00' },
    { time: '1:00' },
    { timezone: 'Unknown/Zone' },
    { quiet: { enabled: true, start: '23:00', end: '23:00' } },
  ])
    expect(() => nextDaily(schedule(extra))).toThrow('invalid_schedule');
});
