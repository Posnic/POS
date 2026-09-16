'use strict';

/*
 * "Come to table seven."
 *
 * Owner: "i want option for customers call. example he is in table 7 and
 * wants to call waiter or captain... this biggest option i love. coz
 * everytime its annoying people see waiters to turn back."
 *
 * The single most common failure of table service, and not a staffing
 * problem: a table needs something, nobody is looking, and the customer
 * spends two minutes trying to catch an eye. The restaurant never learns it
 * happened, because the only evidence is somebody feeling ignored and saying
 * nothing about it.
 *
 * What this file guards is the pair of rules that keep the button worth
 * having: a call must say WHERE, and three taps are one call.
 */

const {
  canCall,
  tableOf,
  stillOpen,
  alreadyCalling,
  OPEN_FOR_MINUTES,
} = require('../../../src/utils/waiter-call');

describe('who may call', () => {
  test('a customer at a table in a shop that runs tables', () => {
    expect(canCall({ tableService: true, table: '7' })).toBe(true);
  });

  test('nobody, when the code named no table', () => {
    /*
     * A call that does not say where is worse than no call: somebody,
     * somewhere, wants something. The button simply is not drawn.
     */
    expect(canCall({ tableService: true, table: '' })).toBe(false);
    expect(canCall({ tableService: true, table: '   ' })).toBe(false);
    expect(canCall({ tableService: true })).toBe(false);
  });

  test('nobody, in a shop with no table service', () => {
    /* A takeaway counter has no waiters walking a floor to call. */
    expect(canCall({ tableService: false, table: '7' })).toBe(false);
    expect(canCall({ table: '7' })).toBe(false);
  });

  test('the switch has to be the boolean, not a truthy lookalike', () => {
    /* Settings have reached this codebase as the string "false" before. */
    expect(canCall({ tableService: 'false', table: '7' })).toBe(false);
    expect(canCall({ tableService: 1, table: '7' })).toBe(false);
  });
});

describe('the table a call is for', () => {
  test('trimmed, because a code can carry whitespace', () => {
    expect(tableOf('  7 ')).toBe('7');
  });

  test('bounded, because it arrives from the open internet', () => {
    expect(tableOf('x'.repeat(200)).length).toBe(40);
  });

  test('nothing is nothing', () => {
    expect(tableOf(null)).toBe('');
    expect(tableOf(undefined)).toBe('');
  });
});

describe('which calls still want somebody', () => {
  const now = new Date('2026-09-16T20:00:00Z').getTime();
  const minutesAgo = (n) => new Date(now - n * 60000).toISOString();

  test('a call nobody has answered yet', () => {
    expect(stillOpen({ called_at: minutesAgo(2) }, now)).toBe(true);
  });

  test('one somebody has acknowledged is done', () => {
    expect(stillOpen({ called_at: minutesAgo(2), seen_at: minutesAgo(1) }, now)).toBe(false);
  });

  test('one older than the window has stopped being actionable', () => {
    /*
     * The customer has either been served or given up, and either way a card
     * about it is noise on a queue that has to be read.
     */
    expect(stillOpen({ called_at: minutesAgo(OPEN_FOR_MINUTES + 1) }, now)).toBe(false);
    expect(stillOpen({ called_at: minutesAgo(OPEN_FOR_MINUTES) }, now)).toBe(true);
  });

  test('one with no time on it at all is not open', () => {
    expect(stillOpen({}, now)).toBe(false);
    expect(stillOpen(null, now)).toBe(false);
  });
});

describe('three taps are one call', () => {
  const now = new Date('2026-09-16T20:00:00Z').getTime();
  const open = [{ table_number: '7', called_at: new Date(now - 60000).toISOString() }];

  test('a table that is already calling does not call again', () => {
    /*
     * Somebody who taps three times has not asked three times - they have
     * asked once and doubted the button. Three cards would be three jobs
     * nobody needs, and would teach staff to skim a queue that must be read.
     */
    expect(alreadyCalling(open, '7', now)).toBe(true);
  });

  test('a different table is a different call', () => {
    expect(alreadyCalling(open, '9', now)).toBe(false);
  });

  test('the same table, once the first call was answered, may call again', () => {
    const answered = [
      {
        table_number: '7',
        called_at: new Date(now - 60000).toISOString(),
        seen_at: new Date().toISOString(),
      },
    ];
    expect(alreadyCalling(answered, '7', now)).toBe(false);
  });

  test('whitespace is not a different table', () => {
    expect(alreadyCalling(open, ' 7 ', now)).toBe(true);
  });

  test('no table is never already calling', () => {
    expect(alreadyCalling(open, '', now)).toBe(false);
  });
});
