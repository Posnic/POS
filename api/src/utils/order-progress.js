'use strict';

/*
 * WHERE AN ORDER HAS GOT TO, IN THE ONLY TERMS THAT ARE TRUE.
 *
 * Stage 5 of Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ROADMAP.md - "the
 * customer knows" - with the warning that stage carries printed on it:
 *
 *   "Do not ship a stage nothing can move off. If `Ready` is unreachable
 *   because nobody presses anything, a frozen tracker is worse than none."
 *
 * So this is not a tracker. A tracker is a ladder with the future drawn on
 * it, and the future is exactly the part we cannot promise: nothing in this
 * product sets "ready", nobody presses "out for delivery", and a shop whose
 * kitchen printer is off never reports a ticket at all. A ladder would draw
 * three greyed rungs and stop on the first one, which tells a customer their
 * order is stuck when it is being cooked.
 *
 * WHAT THIS IS INSTEAD: a TRAIL. Only what has actually happened, each entry
 * with the moment it happened, newest last. A trail cannot freeze, because it
 * never claims anything about what comes next. If the kitchen step never
 * arrives the customer sees "Placed 7:42" and nothing missing - not a promise
 * with a hole in it.
 *
 * The one thing it does name ahead of time is `waiting_for`, and only for the
 * single case where the next move is guaranteed by the state machine rather
 * than hoped for: an order held for approval MUST be accepted or refused by
 * somebody, and order-approval.js is what makes that true. Nothing else is
 * ever named before it happens.
 *
 * NO SENTENCES HERE, only keys and times. The ordering pages carry their own
 * Tamil runtime with an English-keyed dictionary (assets/i18n.js); a sentence
 * composed on the server arrives as English that no dictionary can reach. The
 * page owns the words, this owns the facts, and neither can drift into the
 * other's job.
 *
 * WHERE EACH FACT COMES FROM, and every one of them is written today by
 * something other than this feature - which is the point. A progress view
 * that needs new writes is a progress view that reports on itself:
 *
 *   placed           created_date, written when the order is inserted
 *   accepted         order_state + order_state_at + order_state_by, written
 *                    by the approval queue when a PERSON decides
 *   in the kitchen   kitchen_printed_at, written when a till reports that a
 *                    ticket actually came out of a printer
 *   refused          order_state `rejected`
 *   cancelled        sale_process `cancelled` / payment_status `Cancelled`
 */

/** The only steps that exist. There is deliberately no `ready`. */
const STEP = Object.freeze({
  PLACED: 'placed',
  ACCEPTED: 'accepted',
  IN_THE_KITCHEN: 'in_the_kitchen',
  REFUSED: 'refused',
  CANCELLED: 'cancelled',
});

/** Nothing moves off these, so the page can stop asking. */
const SETTLED = Object.freeze([STEP.REFUSED, STEP.CANCELLED]);

/** A date, or null - never an Invalid Date, which renders as the word. */
function when(value) {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

const text = (value) => String(value == null ? '' : value).trim();

/**
 * Was this order accepted by a PERSON, or did it simply never stop?
 *
 * A shop on automatic never held the order and never decided anything, so
 * saying "Accepted 7:42" alongside "Placed 7:42" describes a decision nobody
 * made - two lines, one second apart, one of them fiction. `order_state_by`
 * carries the name of whoever worked the queue and is empty on arrival, which
 * is exactly the difference.
 */
function aPersonDecided(order) {
  return text(order.order_state_by) !== '';
}

/**
 * The trail this order has left, and where that leaves it now.
 *
 * @param {object} order  the sale document, as stored
 * @returns {{step: string, trail: Array<{step: string, at: Date|null}>,
 *            waiting_for: string, settled: boolean}|null}
 */
function progressOf(order) {
  if (!order) return null;

  const process = text(order.sale_process).toLowerCase();
  const paymentStatus = text(order.payment_status);
  const state = text(order.order_state).toLowerCase();

  const cancelled = process === 'cancelled' || paymentStatus === 'Cancelled';
  const refused = state === 'rejected';

  const trail = [{ step: STEP.PLACED, at: when(order.created_date) || when(order.date) }];

  /*
   * A DECISION, not a state. Only where somebody made one - and refusals are
   * always somebody's, so they are always shown.
   */
  if (state === 'accepted' && aPersonDecided(order)) {
    trail.push({ step: STEP.ACCEPTED, at: when(order.order_state_at) });
  }

  /*
   * Paper, in a kitchen. Not "the server sent it" and not "the queue holds
   * it": a till reported that a printer produced it, which is the only form
   * of this fact worth showing a customer.
   */
  const kitchenAt = when(order.kitchen_printed_at);
  if (kitchenAt || order.kitchen_printed === true) {
    trail.push({ step: STEP.IN_THE_KITCHEN, at: kitchenAt });
  }

  /*
   * An ending is the last line of the history, never an erasure of it.
   *
   * A customer who cancelled two minutes late wants to know the kitchen had
   * already started - that is the difference between "fine" and "I should go
   * and say something", and hiding the earlier trail hides it.
   */
  if (refused) {
    trail.push({ step: STEP.REFUSED, at: when(order.order_state_at) });
  }
  if (cancelled) {
    trail.push({
      step: STEP.CANCELLED,
      at: when(order.customer_cancelled_at) || when(order.updated_date),
    });
  }

  const step = trail[trail.length - 1].step;

  /*
   * THE ONE THING NAMED BEFORE IT HAPPENS.
   *
   * A pending order has to be answered: order-approval.js allows pending to
   * move only to accepted or rejected, and waiting-order-policy.js keeps
   * asking until somebody does. So this is a guarantee of the state machine,
   * not an expectation of a printer. Every other "next" is left unsaid.
   */
  const waitingFor = !cancelled && !refused && state === 'pending' ? 'acceptance' : '';

  return {
    step,
    trail,
    waiting_for: waitingFor,
    settled: SETTLED.includes(step),
  };
}

module.exports = { progressOf, STEP, SETTLED };
