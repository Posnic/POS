'use strict';

/*
 * When the kitchen usually has an order ready.
 *
 * A customer places an order, gets a token number, and then hears nothing. The
 * order list says "With the kitchen" and that is the whole of it - which is the
 * point at which somebody walks up to the counter to ask, the one interruption
 * an ordering channel exists to remove.
 *
 * What this must never become is a promise nobody can keep. Nothing in this
 * product knows when food is actually FINISHED - no cook marks a ticket done -
 * so there is no "ready" signal to report and this does not invent one. It
 * offers an estimate from two things the shop really has told us, and says
 * nothing at all when it has not.
 */

const { cookingMinutes, readyBy } = require('../../../src/utils/ready-by');

const lines = (...mins) => mins.map((prep_minutes) => ({ prep_minutes }));

describe('how long the kitchen should take', () => {
  test('the slowest dish, not the sum of them', () => {
    /*
     * THE DECISION THIS FILE TURNS ON. A kitchen does not cook the biryani,
     * then the naan, then the dal - several hands work at once and the order
     * leaves the pass when the slowest thing on it is done. Adding them up
     * would quote an hour for a meal that takes twenty-five minutes, and an
     * estimate always wrong in the same direction stops being read.
     */
    expect(cookingMinutes({ lines: lines(30, 8, 15) })).toBe(30);
  });

  test('the queue is added on top, because it is time the food is not cooking', () => {
    expect(cookingMinutes({ lines: lines(25), queueMinutes: 20 })).toBe(45);
  });

  test('it lands on a five', () => {
    expect(cookingMinutes({ lines: lines(13), queueMinutes: 0 })).toBe(15);
  });

  test('a dish that states nothing is ignored, not counted as instant', () => {
    /* Missing is not zero - the same rule the nutrition figures follow. */
    expect(cookingMinutes({ lines: lines(0, 0, 20) })).toBe(20);
  });
});

describe('when it says nothing at all', () => {
  test('an order where no dish states a time', () => {
    /*
     * THE HONESTY RULE, and the case that shaped the whole feature. Falling
     * back to the queue alone would quote the customer the time their food
     * spends WAITING and none of the time it spends cooking - a smaller number
     * than the truth, which is the worst direction to be wrong in.
     */
    expect(cookingMinutes({ lines: lines(0, 0), queueMinutes: 20 })).toBe(0);
    expect(cookingMinutes({ lines: [] })).toBe(0);
    expect(cookingMinutes({})).toBe(0);
  });

  test('nonsense is not a prep time', () => {
    expect(cookingMinutes({ lines: lines('soon', -5, NaN, null) })).toBe(0);
    expect(cookingMinutes({ lines: lines('soon', 10) })).toBe(10);
  });

  test('a queue that is not a number does not become one', () => {
    for (const bad of ['lots', null, undefined, NaN, -10]) {
      expect(cookingMinutes({ lines: lines(20), queueMinutes: bad })).toBe(20);
    }
  });
});

describe('the clock time', () => {
  test('counted from when the kitchen was told', () => {
    const told = new Date('2026-09-16T14:00:00.000Z');
    expect(readyBy(told, 25)).toBe('2026-09-16T14:25:00.000Z');
  });

  test('an ISO string is as good as a date', () => {
    expect(readyBy('2026-09-16T14:00:00.000Z', 30)).toBe('2026-09-16T14:30:00.000Z');
  });

  test('no minutes, no time', () => {
    /* The page must be able to ask without checking first, and get back
       something it can safely draw nothing from. */
    expect(readyBy(new Date(), 0)).toBe('');
    expect(readyBy(new Date(), null)).toBe('');
    expect(readyBy(new Date(), 'soon')).toBe('');
  });

  test('no start, no time', () => {
    expect(readyBy(null, 25)).toBe('');
    expect(readyBy('not a date', 25)).toBe('');
    expect(readyBy(undefined, 25)).toBe('');
  });
});

describe('the whole thing, as an order would use it', () => {
  test('a busy kitchen and a slow dish', () => {
    /*
     * Chicken biryani at thirty minutes, on a kitchen two rounds behind. The
     * customer is told an hour rather than half of one, which is the number
     * they would otherwise have found out by waiting.
     */
    const minutes = cookingMinutes({ lines: lines(30, 8), queueMinutes: 30 });
    expect(minutes).toBe(60);
    expect(readyBy('2026-09-16T13:00:00.000Z', minutes)).toBe('2026-09-16T14:00:00.000Z');
  });

  test('a shop that has entered nothing tells the customer nothing', () => {
    const minutes = cookingMinutes({ lines: lines(0, 0), queueMinutes: 30 });
    expect(minutes).toBe(0);
    expect(readyBy(new Date(), minutes)).toBe('');
  });
});
