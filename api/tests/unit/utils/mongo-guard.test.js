'use strict';

const { findCodeOperator, parseFilterParam } = require('../../../src/utils/mongo-guard');

/*
 * The hole this closes.
 *
 * app.js strips '$' keys from req.query, but the list endpoints take their
 * filter as a JSON STRING - one ordinary-looking value the walk copies across
 * untouched, then parsed back in the controller with its operators intact and
 * spread into a live query. Eight controllers do it, so the enforcement sits
 * in app.js beside the sanitiser it completes.
 */
describe('mongo-guard', () => {
  test('a code operator is found at the top level', () => {
    expect(findCodeOperator({ $where: 'sleep(5000)' })).toBe('$where');
    expect(findCodeOperator({ $function: {} })).toBe('$function');
    expect(findCodeOperator({ $accumulator: {} })).toBe('$accumulator');
    expect(findCodeOperator({ $expr: {} })).toBe('$expr');
  });

  test('a code operator is found when nested', () => {
    /* A guard that only checked the top would be one that looks present: $or
       is spread into the same query and evaluated the same way. */
    expect(findCodeOperator({ $or: [{ name: 'x' }, { $where: '1' }] })).toBe('$where');
    expect(findCodeOperator({ a: { b: { c: { $function: {} } } } })).toBe('$function');
    expect(findCodeOperator([{ deep: { $where: '1' } }])).toBe('$where');
  });

  test('the ordinary query operators still pass', () => {
    /* This is the whole reason the guard is not a '$' strip. Sales History
       sends $ne to keep kitchen tickets out of the list, and date windows are
       $gte/$lte - stripping them would not harden anything, it would silently
       un-filter lists, and a list quietly showing rows it was told to hide is
       its own kind of bug. */
    expect(findCodeOperator({ sale_process: { $ne: 'KOT' } })).toBeNull();
    expect(
      findCodeOperator({ created_date: { $gte: '2026-01-01', $lte: '2026-02-01' } })
    ).toBeNull();
    expect(findCodeOperator({ status: { $in: ['open', 'sent'] } })).toBeNull();
    expect(findCodeOperator({ name: { $regex: 'shirt', $options: 'i' } })).toBeNull();
  });

  test('the recursion is bounded', () => {
    /* A hostile payload must not cost more to inspect than to run. */
    let deep = { $where: '1' };
    for (let i = 0; i < 40; i += 1) deep = { nest: deep };
    expect(() => findCodeOperator(deep)).not.toThrow();
    expect(findCodeOperator(deep)).toBeNull();
  });

  test('nothing sensible trips it', () => {
    expect(findCodeOperator(null)).toBeNull();
    expect(findCodeOperator('a string')).toBeNull();
    expect(findCodeOperator(42)).toBeNull();
    expect(findCodeOperator({})).toBeNull();
  });

  test('parseFilterParam refuses the string form, which is the actual attack', () => {
    const bad = parseFilterParam('{"$where":"sleep(5000)"}');
    expect(bad.rejected).toBe('$where');
    expect(bad.filters).toEqual({});
  });

  test('parseFilterParam keeps a legitimate filter intact', () => {
    const ok = parseFilterParam('{"sale_process":{"$ne":"KOT"}}');
    expect(ok.rejected).toBeNull();
    expect(ok.filters).toEqual({ sale_process: { $ne: 'KOT' } });
  });

  test('malformed input stays tolerated, as it was before', () => {
    /* Every one of these endpoints already ignored unparseable filters.
       Tightening that here would change what a malformed request does on
       eight screens at once, which is not what this guard is for. */
    const r = parseFilterParam('not json at all');
    expect(r.rejected).toBeNull();
    expect(r.filters).toEqual({});
  });

  test('an array or a bare value is not treated as a filter object', () => {
    expect(parseFilterParam('[1,2,3]').filters).toEqual({});
    expect(parseFilterParam('"x"').filters).toEqual({});
    expect(parseFilterParam(undefined).filters).toEqual({});
  });

  test('the object form is guarded too, not just the string', () => {
    /* Two controllers accept req.query.filters already parsed. */
    expect(parseFilterParam({ $where: '1' }).rejected).toBe('$where');
  });
});
