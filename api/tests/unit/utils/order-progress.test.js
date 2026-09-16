'use strict';

/*
 * A customer is told what happened, and never what might.
 *
 * Stage 5 of the print roadmap - "the customer knows" - carries its own
 * warning: "Do not ship a stage nothing can move off. If `Ready` is
 * unreachable because nobody presses anything, a frozen tracker is worse
 * than none."
 *
 * Every test here is that sentence, checked from a different side. The
 * temptation in this feature is a four-rung ladder - Placed, Accepted,
 * Cooking, Ready - because that is what everybody has seen on a delivery
 * app. Three of those four rungs would be drawn and never reached:
 *
 *   Ready         nothing in this product sets it. Nobody presses anything.
 *   Cooking       we know a ticket PRINTED. Nothing tells us a cook started.
 *   Accepted      a shop on automatic never decides anything, so the word
 *                 describes a decision that was never made.
 *
 * A ladder would show a customer three grey rungs under a stuck dot while
 * their dinner was being cooked. So there is no ladder. There is a trail of
 * what has happened, and the only thing named ahead of time is the one move
 * the state machine guarantees: a held order must be answered.
 */

const { progressOf, STEP, SETTLED } = require('../../../src/utils/order-progress');

const AT = (iso) => new Date(iso);
const PLACED_AT = AT('2026-09-16T13:00:00.000Z');

/** An order as it exists the instant it is inserted. */
const anOrder = (over = {}) => ({
  _id: '6aa5509215e3686c543e5cc3',
  sale_process: 'KOT',
  payment_status: 'Unpaid',
  created_date: PLACED_AT,
  ...over,
});

const steps = (order) => progressOf(order).trail.map((entry) => entry.step);

/* ------------------------------------------------ the rung that is not there */

describe('there is no stage nothing can move off', () => {
  test('READY DOES NOT EXIST, because nothing in the product sets it', () => {
    /*
     * The whole reason this module is a trail and not a tracker. If `ready`
     * is ever added here, something must first exist that MOVES an order on
     * to it - and at that point this test is the thing that has to change,
     * deliberately, rather than a rung quietly appearing on ninety shops'
     * customers' phones and never lighting up.
     */
    expect(Object.values(STEP)).not.toContain('ready');
    expect(Object.values(STEP)).not.toContain('out_for_delivery');
    expect(Object.values(STEP)).not.toContain('collected');
  });

  test('and the trail never contains a step that has not happened', () => {
    /* A brand new order has exactly one true thing to say about itself. */
    expect(steps(anOrder({ order_state: 'pending' }))).toEqual([STEP.PLACED]);
    expect(progressOf(anOrder({ order_state: 'pending' })).trail).toHaveLength(1);
  });

  test('the step an order is at is always the last thing that happened to it', () => {
    /* Not a separate field that can drift from the history beside it. */
    for (const order of [
      anOrder({ order_state: 'pending' }),
      anOrder({ order_state: 'accepted', order_state_by: 'Ravi', order_state_at: PLACED_AT }),
      anOrder({ kitchen_printed_at: PLACED_AT }),
      anOrder({ order_state: 'rejected', order_state_at: PLACED_AT }),
      anOrder({ sale_process: 'cancelled' }),
    ]) {
      const progress = progressOf(order);
      expect(progress.step).toBe(progress.trail[progress.trail.length - 1].step);
    }
  });
});

/* --------------------------------------------------- a decision, not a state */

describe('accepted means a person decided', () => {
  test('A SHOP ON AUTOMATIC NEVER SAYS "ACCEPTED", because it decided nothing', () => {
    /*
     * decideOnArrival writes order_state `accepted` on arrival for a shop that
     * is not holding orders. Drawing that as a step would put two lines on the
     * customer's screen one second apart - "Placed 7:42", "Accepted 7:42" -
     * the second of which describes a decision nobody made.
     *
     * order_state_by is the difference: the approval queue writes the name of
     * whoever worked it, and arrival writes nothing.
     */
    const automatic = anOrder({ order_state: 'accepted', order_state_at: PLACED_AT });
    expect(steps(automatic)).toEqual([STEP.PLACED]);
  });

  test('and a shop that held it and answered does', () => {
    const answered = anOrder({
      order_state: 'accepted',
      order_state_at: AT('2026-09-16T13:04:00.000Z'),
      order_state_by: 'Ravi',
    });
    expect(steps(answered)).toEqual([STEP.PLACED, STEP.ACCEPTED]);
    expect(progressOf(answered).trail[1].at).toEqual(AT('2026-09-16T13:04:00.000Z'));
  });

  test('a refusal is always somebody, so it is always shown', () => {
    const refused = anOrder({
      order_state: 'rejected',
      order_state_at: AT('2026-09-16T13:06:00.000Z'),
      order_state_by: 'Ravi',
    });
    expect(steps(refused)).toEqual([STEP.PLACED, STEP.REFUSED]);
    /* And never alongside an "accepted" it passed through, because it did
       not pass through one. */
    expect(steps(refused)).not.toContain(STEP.ACCEPTED);
  });
});

/* ------------------------------------------------------ paper, in a kitchen */

describe('"in the kitchen" means a printer produced paper', () => {
  test('IT IS THE TILL REPORTING A PRINT, not the server sending an order', () => {
    /*
     * kitchen_printed_at is written by markKitchenPrintedModel, which runs
     * when a till says it printed. Anything earlier - the order arriving, the
     * queue holding a row - is us talking about our own intentions, and the
     * customer cannot eat those.
     */
    const printed = anOrder({ kitchen_printed_at: AT('2026-09-16T13:02:00.000Z') });
    expect(steps(printed)).toEqual([STEP.PLACED, STEP.IN_THE_KITCHEN]);
    expect(progressOf(printed).trail[1].at).toEqual(AT('2026-09-16T13:02:00.000Z'));
  });

  test('an older row with the flag but no time still counts, without inventing one', () => {
    const printed = anOrder({ kitchen_printed: true });
    expect(steps(printed)).toEqual([STEP.PLACED, STEP.IN_THE_KITCHEN]);
    expect(progressOf(printed).trail[1].at).toBeNull();
  });

  test('AND A SHOP WHOSE PRINTER NEVER REPORTS SIMPLY SHOWS LESS', () => {
    /*
     * The case the ladder gets wrong. A kitchen printer switched off, a till
     * not running, a shop that prints nothing at all: the order is accepted
     * and being cooked, and no ticket is ever reported. A ladder draws a grey
     * rung and a stuck dot. A trail shows the two true lines and claims
     * nothing - which is why a trail cannot freeze.
     */
    const neverPrinted = anOrder({
      order_state: 'accepted',
      order_state_by: 'Ravi',
      order_state_at: AT('2026-09-16T13:01:00.000Z'),
    });
    const progress = progressOf(neverPrinted);
    expect(progress.step).toBe(STEP.ACCEPTED);
    expect(progress.waiting_for).toBe('');
    expect(JSON.stringify(progress)).not.toContain('kitchen');
  });
});

/* ------------------------------------------------------------- the endings */

describe('an ending is the last line of the history, not an erasure of it', () => {
  test('A LATE CANCELLATION STILL SHOWS THAT THE KITCHEN HAD IT', () => {
    /*
     * The difference between "fine" and "I should go and say something". A
     * customer who called the order off two minutes late needs to know the
     * ticket had already printed; hiding the earlier trail hides exactly the
     * thing they would act on.
     */
    const cancelledLate = anOrder({
      sale_process: 'cancelled',
      payment_status: 'Cancelled',
      kitchen_printed_at: AT('2026-09-16T13:02:00.000Z'),
      customer_cancelled_at: AT('2026-09-16T13:04:00.000Z'),
    });
    expect(steps(cancelledLate)).toEqual([STEP.PLACED, STEP.IN_THE_KITCHEN, STEP.CANCELLED]);
    expect(progressOf(cancelledLate).trail[2].at).toEqual(AT('2026-09-16T13:04:00.000Z'));
  });

  test('a cancellation the shop made carries the time it was touched', () => {
    const cancelled = anOrder({
      sale_process: 'cancelled',
      updated_date: AT('2026-09-16T13:09:00.000Z'),
    });
    expect(progressOf(cancelled).trail[1].at).toEqual(AT('2026-09-16T13:09:00.000Z'));
  });

  test('payment_status alone is enough to be cancelled', () => {
    expect(progressOf(anOrder({ payment_status: 'Cancelled' })).step).toBe(STEP.CANCELLED);
  });

  test('NOTHING MOVES OFF AN ENDING, so the phone is told to stop asking', () => {
    expect(progressOf(anOrder({ sale_process: 'cancelled' })).settled).toBe(true);
    expect(progressOf(anOrder({ order_state: 'rejected' })).settled).toBe(true);
    /* And everything else can still move, so it must not be settled. */
    expect(progressOf(anOrder({ order_state: 'pending' })).settled).toBe(false);
    expect(progressOf(anOrder({ kitchen_printed_at: PLACED_AT })).settled).toBe(false);
    expect(SETTLED).toEqual([STEP.REFUSED, STEP.CANCELLED]);
  });
});

/* ------------------------------------------- the one thing named in advance */

describe('what is waited on', () => {
  test('ONLY A HELD ORDER NAMES ITS NEXT MOVE, and only because it is guaranteed', () => {
    /*
     * order-approval.js allows pending to move to accepted or rejected and to
     * nothing else, and waiting-order-policy.js keeps asking until somebody
     * does one of them. That is a guarantee of the state machine. Every other
     * "next" - a printer, a cook, a delivery - is a hope, and hopes are not
     * put on a customer's screen.
     */
    expect(progressOf(anOrder({ order_state: 'pending' })).waiting_for).toBe('acceptance');
  });

  test('and nothing else does', () => {
    for (const order of [
      anOrder({ order_state: 'accepted' }),
      anOrder({ order_state: 'accepted', order_state_by: 'Ravi' }),
      anOrder({ kitchen_printed_at: PLACED_AT }),
      anOrder({ order_state: 'rejected' }),
      anOrder({ sale_process: 'cancelled' }),
      anOrder({}),
    ]) {
      expect(progressOf(order).waiting_for).toBe('');
    }
  });

  test('a cancelled order is not still waiting to be accepted', () => {
    /* It can happen: a customer calls off an order the shop never opened. */
    const gone = anOrder({ order_state: 'pending', sale_process: 'cancelled' });
    expect(progressOf(gone).waiting_for).toBe('');
    expect(progressOf(gone).settled).toBe(true);
  });
});

/* ---------------------------------------------------------- a whole evening */

test('THE TRAIL ONLY EVER GROWS, through the life of one order', () => {
  /*
   * A customer watching this page sees it redraw every fifteen seconds. A
   * line that appeared and then vanished would be worse than no line: it
   * reads as the shop changing its mind about something that already
   * happened.
   */
  const life = [
    anOrder({ order_state: 'pending' }),
    anOrder({ order_state: 'accepted', order_state_by: 'Ravi', order_state_at: PLACED_AT }),
    anOrder({
      order_state: 'accepted',
      order_state_by: 'Ravi',
      order_state_at: PLACED_AT,
      kitchen_printed_at: AT('2026-09-16T13:05:00.000Z'),
    }),
  ];

  let before = [];
  for (const moment of life) {
    const now = steps(moment);
    expect(now.slice(0, before.length)).toEqual(before);
    expect(now.length).toBeGreaterThanOrEqual(before.length);
    before = now;
  }
  expect(before).toEqual([STEP.PLACED, STEP.ACCEPTED, STEP.IN_THE_KITCHEN]);
});

/* ------------------------------------------------------------- rubbish in */

describe('nonsense never becomes a confident answer', () => {
  test('no order, no progress', () => {
    expect(progressOf(null)).toBeNull();
    expect(progressOf(undefined)).toBeNull();
  });

  test('AN UNREADABLE DATE IS NO DATE, never the words "Invalid Date"', () => {
    /* Which is what a customer would otherwise read on their own receipt. */
    for (const created_date of ['', 'soon', null, 0, {}, 'not a date']) {
      const at = progressOf(anOrder({ created_date })).trail[0].at;
      expect(at === null || Number.isFinite(at.getTime())).toBe(true);
    }
  });

  test('a date stored as a string is still a date', () => {
    const progress = progressOf(anOrder({ created_date: '2026-09-16T13:00:00.000Z' }));
    expect(progress.trail[0].at).toEqual(PLACED_AT);
  });

  test('an order with nothing on it is still placed', () => {
    const progress = progressOf({});
    expect(progress.step).toBe(STEP.PLACED);
    expect(progress.trail[0].at).toBeNull();
    expect(progress.settled).toBe(false);
  });

  test('a state nobody recognises is not treated as a state', () => {
    /* A newer build, a half-migrated row, a typo in a script. */
    const odd = anOrder({ order_state: 'ACCEPTED_BY_ROBOT', order_state_by: 'Ravi' });
    expect(steps(odd)).toEqual([STEP.PLACED]);
    expect(progressOf(odd).waiting_for).toBe('');
  });

  test('a name made only of spaces is not a person deciding', () => {
    const blank = anOrder({ order_state: 'accepted', order_state_by: '   ' });
    expect(steps(blank)).toEqual([STEP.PLACED]);
  });
});

/* ----------------------------------------------- it says facts, not sentences */

test('NO SENTENCE IS COMPOSED HERE, because the page has a dictionary and this does not', () => {
  /*
   * /order carries its own Tamil runtime keyed by the English sentence
   * (order/assets/i18n.js). A sentence built on the server arrives as English
   * the dictionary cannot reach, so the customer gets a page in two languages
   * - and nobody notices until a Tamil-reading customer is standing at a
   * counter. Keys and times out; words on the page.
   *
   * Checked by ALLOW-LIST rather than by searching for prose, because a
   * search for prose passes on anything it fails to think of - which is how
   * an assertion ends up matching nothing at all.
   */
  const allowed = new Set([...Object.values(STEP), 'acceptance', '']);
  const progress = progressOf(
    anOrder({
      order_state: 'accepted',
      order_state_by: 'Ravi',
      order_state_at: PLACED_AT,
      kitchen_printed_at: PLACED_AT,
    })
  );

  const strings = [];
  (function walk(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object' && !(value instanceof Date)) {
      Object.values(value).forEach(walk);
    }
  })(progress);

  expect(strings.length).toBeGreaterThan(0);
  for (const said of strings) {
    expect(allowed.has(said)).toBe(true);
  }
  /* And nothing the shop typed: a staff name is not the customer's. */
  expect(JSON.stringify(progress)).not.toContain('Ravi');
});
