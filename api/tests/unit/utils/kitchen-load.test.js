'use strict';

/*
 * Telling somebody the kitchen is busy, and by how much.
 *
 * Owner: "when kitchen have many order have so many order we might notify
 * online order customer deley might expecteed. example shop having total 10
 * tables. 10 order in the process. then kitchen is full."
 *
 * The rule this guards is the same one the health badges follow: never claim
 * more than the shop's own numbers earn. A wait in minutes is a promise, and a
 * promise nobody can keep is worse than saying nothing - so the moment any of
 * the three inputs is missing, this falls back to the weaker true statement
 * rather than the stronger invented one.
 */

const { kitchenLoad, typicalRound, MOST_MINUTES } = require('../../../src/utils/kitchen-load');

const shop = (over) => Object.assign({ tableService: true, capacity: 10, round: 15 }, over);

describe('when it says nothing at all', () => {
  test('a shop that does not run tables', () => {
    /*
     * Deliberately out of scope. A takeaway counter or a grocer has never been
     * asked for a capacity and never will be, so any number here would be
     * invented. Owner scoped it the same way: "for this restaurant module
     * enabled and number of table also given".
     */
    const out = kitchenLoad(shop({ tableService: false, open: 40 }));
    expect(out.busy).toBe(false);
    expect(out.extra_minutes).toBe(0);
  });

  test('a restaurant part-way through its setup, with no tables typed in', () => {
    /*
     * No tables is not an empty restaurant. It is a manager who has switched
     * the module on and not finished, and guessing a capacity for them would
     * put a wait on the page out of nothing.
     */
    expect(kitchenLoad(shop({ capacity: 0, open: 30 })).busy).toBe(false);
  });

  test('a kitchen with room to spare', () => {
    expect(kitchenLoad(shop({ open: 0 })).busy).toBe(false);
    expect(kitchenLoad(shop({ open: 4 })).busy).toBe(false);
  });

  test('a kitchen exactly full is not yet a kitchen behind', () => {
    /*
     * The owner's own example: ten tables, ten orders. Every ticket is in
     * flight and none is queueing, so the next order joins the pass rather
     * than waiting behind a round. Warning here would cry wolf on an
     * ordinary busy evening and teach people to ignore the notice.
     */
    const out = kitchenLoad(shop({ open: 10 }));
    expect(out.busy).toBe(false);
    expect(out.open).toBe(10);
    expect(out.capacity).toBe(10);
  });
});

describe('when it says the kitchen is busy', () => {
  test('one round behind adds one round of cooking', () => {
    const out = kitchenLoad(shop({ open: 11 }));
    expect(out.busy).toBe(true);
    expect(out.extra_minutes).toBe(15);
  });

  test('two rounds behind adds two', () => {
    expect(kitchenLoad(shop({ open: 21 })).extra_minutes).toBe(30);
  });

  test('minutes land on a five, because a wait is not a timetable', () => {
    /* 13 minutes twice over is 26, and nobody says "about 26 minutes". */
    expect(kitchenLoad(shop({ open: 21, round: 13 })).extra_minutes).toBe(25);
  });

  test('past an hour it stops pretending to be precise', () => {
    /*
     * A kitchen twelve rounds deep is not eleven times more precisely
     * measurable than one four rounds deep; it is simply swamped. The number
     * stops at an hour and `over` tells the page to say so in words.
     */
    const out = kitchenLoad(shop({ open: 101, round: 20 }));
    expect(out.extra_minutes).toBe(MOST_MINUTES);
    expect(out.over).toBe(true);
  });

  test('busy but no figure, when the shop has entered no prep times', () => {
    /*
     * THE HONESTY RULE. The queue is real and can be stated; the minutes
     * cannot, because nothing on this menu says how long a dish takes. So the
     * page gets busy:true with no number and says the weaker true thing.
     */
    const out = kitchenLoad(shop({ open: 30, round: 0 }));
    expect(out.busy).toBe(true);
    expect(out.extra_minutes).toBe(0);
    expect(out.over).toBe(false);
  });
});

describe("the shop's own typical dish", () => {
  test('the median, not the mean', () => {
    /*
     * One slow roast on a menu of dosas would drag an average somewhere no
     * customer will ever wait. The median describes the dish the kitchen
     * actually turns out.
     */
    expect(typicalRound([5, 10, 15, 10, 90])).toBe(10);
  });

  test('an even count takes the middle pair', () => {
    expect(typicalRound([10, 20])).toBe(15);
  });

  test('a dish that states nothing is left out, not counted as instant', () => {
    /* Missing is not zero - the same rule the nutrition figures follow. */
    expect(typicalRound([0, 0, 20, 30])).toBe(25);
  });

  test('a menu that states nothing at all has no typical dish', () => {
    expect(typicalRound([])).toBe(0);
    expect(typicalRound([0, 0, 0])).toBe(0);
    expect(typicalRound(null)).toBe(0);
  });

  test('nonsense is not a prep time', () => {
    expect(typicalRound(['soon', -5, NaN, null, 10])).toBe(10);
  });
});

describe('what it refuses to be confused by', () => {
  test('a count that is not a count', () => {
    for (const bad of [null, undefined, NaN, 'lots', -3, {}]) {
      expect(kitchenLoad(shop({ open: bad })).busy).toBe(false);
    }
  });

  test('the switch must be the boolean, not a truthy lookalike', () => {
    /* Settings have reached this codebase as the string "false" and read as
       ON through a loose check. */
    expect(kitchenLoad(shop({ tableService: 'false', open: 40 })).busy).toBe(false);
    expect(kitchenLoad(shop({ tableService: 1, open: 40 })).busy).toBe(false);
  });

  test('half a table is no table', () => {
    expect(kitchenLoad(shop({ capacity: 0.4, open: 40 })).busy).toBe(false);
  });
});
