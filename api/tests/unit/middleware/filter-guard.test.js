'use strict';

const { filterGuard } = require('../../../src/middleware/filter-guard');

/*
 * The middleware that closes the JSON-string gap. See filter-guard.js for why
 * the app-level '$' sanitiser cannot see inside req.query.filters.
 */
const run = (req) => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nexted = false;
  filterGuard(req, res, () => {
    nexted = true;
  });
  return { res, nexted };
};

describe('filterGuard', () => {
  let warn;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test('the actual attack is refused with 400, naming the operator', () => {
    const { res, nexted } = run({ query: { filters: '{"$where":"sleep(5000)"}' } });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.type).toBe('error');
    /* Named, not silently emptied - a dropped filter reads as "no results"
       and sends somebody hunting for missing data. */
    expect(res.body.message).toContain('$where');
  });

  test('a code operator nested inside $or is refused too', () => {
    const { res, nexted } = run({
      query: { filters: '{"$or":[{"name":"x"},{"$function":{}}]}' },
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  test('the body is checked as well as the query', () => {
    const { res, nexted } = run({ query: {}, body: { where: '{"$where":"1"}' } });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  test('a legitimate filter passes straight through', () => {
    /* Sales History depends on this exact shape. If the guard ever became a
       '$' strip, kitchen tickets would reappear in the list. */
    const { res, nexted } = run({ query: { filters: '{"sale_process":{"$ne":"KOT"}}' } });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  test('a date window passes', () => {
    const { nexted } = run({
      query: { filters: '{"created_date":{"$gte":"2026-01-01","$lte":"2026-02-01"}}' },
    });
    expect(nexted).toBe(true);
  });

  test('ordinary parameters are not parsed as filters', () => {
    const { nexted } = run({ query: { page: '1', limit: '25', search: 'shirt' } });
    expect(nexted).toBe(true);
  });

  test('a string that merely starts with a brace is not an error', () => {
    /* Only things that could be JSON are parsed, and unparseable input stays
       tolerated - every one of these endpoints already ignored it. */
    const { nexted } = run({ query: { search: '{not json' } });
    expect(nexted).toBe(true);
  });

  test('a missing query or body does not throw', () => {
    expect(() => run({})).not.toThrow();
    expect(run({}).nexted).toBe(true);
  });
});
