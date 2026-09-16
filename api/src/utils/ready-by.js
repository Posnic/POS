'use strict';
/*
 * When the kitchen usually has an order ready.
 *
 * A customer places an order, gets a token number, and then hears nothing. On
 * every food app they have ever used, the next thing they see is a time. Here
 * they see "With the kitchen" and are left to guess, which is the point at
 * which somebody walks up to the counter to ask - the one interruption an
 * ordering channel exists to remove.
 *
 * WHAT WE CAN HONESTLY SAY, AND WHAT WE CANNOT.
 *
 * Nothing in this product knows when food is actually finished. No cook marks
 * a ticket done, so there is no "ready" signal to report and this does not
 * pretend there is one. What the shop HAS told us is how long each dish takes
 * and how many tickets are ahead of this one, and those two together are an
 * honest estimate - offered as one, in the shop's own numbers, and withheld
 * entirely when the numbers are not there.
 *
 * THE LONGEST DISH, NOT THE SUM.
 *
 * A kitchen does not cook a biryani, then a naan, then a dal. Several hands
 * work at once and the order leaves the pass when the SLOWEST thing on it is
 * done. Adding the dishes up would quote an hour for a meal that takes
 * twenty-five minutes, and an estimate that is always wrong in the same
 * direction is worse than no estimate: people stop reading it.
 *
 * FROZEN AT THE MOMENT IT IS MADE.
 *
 * The number is worked out once and stored on the order. A figure recomputed
 * on every refresh would creep as other orders arrive, and a promise that
 * moves while somebody watches it is worse than one that is a little wrong -
 * they can plan around wrong; they cannot plan around moving.
 *
 * NO DATABASE IMPORTS.
 */

/** Minutes, to the nearest five: a wait is not a train timetable. */
function toFive(minutes) {
  return Math.round(minutes / 5) * 5;
}

/**
 * How long this order should take the kitchen, or 0 when nobody can say.
 *
 * @param {object} order
 *   lines         the sale lines, each with the dish's stated prep_minutes
 *   queueMinutes  what the queue adds, from kitchenLoad; 0 when not busy
 * @returns {number} minutes, or 0 meaning "do not say anything"
 */
function cookingMinutes({ lines, queueMinutes } = {}) {
  const stated = (Array.isArray(lines) ? lines : [])
    .map((line) => Number(line && line.prep_minutes))
    .filter((n) => Number.isFinite(n) && n > 0);

  /*
   * NOT ONE DISH OF THIS ORDER SAYS HOW LONG IT TAKES.
   *
   * Then there is no estimate. Falling back to the queue alone would quote a
   * customer the time their food spends WAITING and none of the time it spends
   * cooking, which is a smaller number than the truth and the worst kind of
   * wrong to be. Same rule as the health badges: say nothing rather than
   * something the numbers do not support.
   */
  if (!stated.length) return 0;

  const slowest = Math.max(...stated);
  const queue = Number(queueMinutes);
  const waiting = Number.isFinite(queue) && queue > 0 ? queue : 0;
  return toFive(slowest + waiting);
}

/**
 * The clock time to show, as an instant.
 *
 * Counted from when the KITCHEN was told, which is not always when the order
 * was placed: a shop that holds orders for approval may accept one twenty
 * minutes later, and counting from the tap would have the food ready before
 * anybody started it.
 *
 * @param {Date|string} startedAt  when the kitchen was told
 * @param {number} minutes         from cookingMinutes
 * @returns {string} an ISO instant, or '' when there is nothing to say
 */
function readyBy(startedAt, minutes) {
  const at = startedAt instanceof Date ? startedAt : new Date(startedAt || NaN);
  const cooking = Number(minutes);
  if (isNaN(at.getTime()) || !Number.isFinite(cooking) || cooking <= 0) return '';
  return new Date(at.getTime() + cooking * 60000).toISOString();
}

module.exports = { cookingMinutes, readyBy };
