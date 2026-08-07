const {
  mongoDateFormat,
  branchTimezone,
  dateDisplay,
  DEFAULT_TIMEZONE,
} = require('../../../src/utils/date-preference');

/*
 * A date that reads as a different date is not a formatting preference.
 *
 * The sales report printed month-first whatever Configuration said, so
 * 08/03/2026 in a Goa shop read as 8 March and meant 3 August. Nothing errors
 * and nothing looks broken - the two readings simply disagree by five months on
 * a document used for accounting and for arguing with a customer.
 */

describe('the date order the shop chose', () => {
  it('honours each of the three orders Configuration offers', () => {
    expect(mongoDateFormat({ client_dateformat: 'dd/mm/yyyy' })).toBe('%d/%m/%Y %H:%M');
    expect(mongoDateFormat({ client_dateformat: 'yyyy/mm/dd' })).toBe('%Y/%m/%d %H:%M');
    expect(mongoDateFormat({ client_dateformat: 'mm/dd/yyyy' })).toBe('%m/%d/%Y %H:%M');
  });

  it('defaults to day-first, which is what the setting defaults to', () => {
    // Not month-first. Every shop running this reads dates day-first, and a
    // default that is wrong for all of them is worse than no default.
    expect(mongoDateFormat({})).toBe('%d/%m/%Y %H:%M');
    expect(mongoDateFormat(null)).toBe('%d/%m/%Y %H:%M');
    expect(mongoDateFormat({ client_dateformat: '  DD/MM/YYYY  ' })).toBe('%d/%m/%Y %H:%M');
  });

  it('falls back rather than emitting a format nobody asked for', () => {
    expect(mongoDateFormat({ client_dateformat: 'swahili' })).toBe('%d/%m/%Y %H:%M');
  });

  it('can leave the time off, for a column that only needs the day', () => {
    expect(mongoDateFormat({ client_dateformat: 'dd/mm/yyyy' }, { withTime: false })).toBe(
      '%d/%m/%Y'
    );
  });
});

describe("the clock a branch's day runs on", () => {
  it("uses the branch's own timezone", () => {
    expect(branchTimezone({ time_zone: 'Asia/Dubai' })).toBe('Asia/Dubai');
  });

  it("never falls back to UTC, which is nobody's trading day", () => {
    /*
     * This one moves takings between days. A sale at 9:30pm in Goa is 16:00
     * UTC; group by UTC and the last two and a half hours of every day land on
     * tomorrow's sheet, which a shopkeeper counting cash at closing will notice
     * and be unable to explain.
     */
    expect(branchTimezone({})).toBe(DEFAULT_TIMEZONE);
    expect(branchTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(branchTimezone({ time_zone: '' })).toBe(DEFAULT_TIMEZONE);
    expect(branchTimezone({ time_zone: '   ' })).toBe(DEFAULT_TIMEZONE);
  });

  it('lets a deployment override the default', () => {
    process.env.DEFAULT_TIMEZONE = 'Europe/London';
    expect(branchTimezone({})).toBe('Europe/London');
    delete process.env.DEFAULT_TIMEZONE;
  });
});

describe('both together, as an aggregation stage wants them', () => {
  it('returns the pair', () => {
    expect(dateDisplay({ client_dateformat: 'dd/mm/yyyy', time_zone: 'Asia/Kolkata' })).toEqual({
      format: '%d/%m/%Y %H:%M',
      timezone: 'Asia/Kolkata',
    });
  });

  it('survives a branch document that has neither', () => {
    // Older branches predate both settings and must still produce a report.
    expect(dateDisplay({})).toEqual({ format: '%d/%m/%Y %H:%M', timezone: DEFAULT_TIMEZONE });
  });
});
