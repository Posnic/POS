'use strict';
/*
 * Whether an order goes straight to the kitchen, or waits for somebody to say
 * yes.
 *
 * TWO SHOPS, TWO ANSWERS.
 *
 * A busy quick-service counter wants every order on the griddle the second it
 * lands: a human gate is a queue, and the gate itself becomes the slowest part
 * of the kitchen. A restaurant taking orders from a hotel across the road
 * wants to look first - is the kitchen still open, is that dish really on, is
 * this a prank order at 2am - because a ticket printed is food started and
 * food started is money spent.
 *
 * So it is a setting, and both answers are legitimate.
 *
 * WHY THE TICKET IS THE THING BEING GATED.
 *
 * The order is always SAVED. Approval decides only whether the kitchen is told.
 * Refusing to save would lose the customer's order on a network they cannot
 * see and cannot retry into; saving and holding means the worst case is a
 * short wait and a visible queue somebody can act on.
 *
 * That also makes the failure direction safe. If the approval flag cannot be
 * read - no settings document, a bad value, a database blip - this answers
 * AUTO, because an order that reaches the kitchen and should not have is a
 * conversation, and an order that silently waits for an approval screen nobody
 * knows to open is a customer sitting in a hotel room wondering where dinner
 * is.
 *
 * NO DATABASE IMPORTS.
 */

/** How a shop handles an incoming order. */
const APPROVAL = Object.freeze({
  /* Straight to the kitchen. The app still makes a small noise, because a
     ticket printing in another room is not something anyone at the till sees. */
  AUTO: 'auto',
  /* Held until a person accepts it. The app raises an alarm, because nobody is
     watching a screen they have no reason to be watching. */
  MANUAL: 'manual',
});

/** Where an order stands. */
const ORDER_STATE = Object.freeze({
  /* Waiting for a person. Nothing has printed. */
  PENDING: 'pending',
  /* Accepted, and the kitchen has been told. */
  ACCEPTED: 'accepted',
  /* Turned away. Nothing printed, and the customer is told why. */
  REJECTED: 'rejected',
});

const ORDER_STATES = Object.freeze(Object.values(ORDER_STATE));

/**
 * Which mode this shop is in.
 *
 * Anything that is not the exact word `manual` is auto, deliberately. A typo,
 * a missing document or a half-migrated setting must not put a shop into a
 * mode where orders quietly stop reaching the kitchen - see the note above
 * about which failure is survivable.
 */
function approvalMode(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === APPROVAL.MANUAL
    ? APPROVAL.MANUAL
    : APPROVAL.AUTO;
}

/** Does an order arriving now need a person before the kitchen hears about it? */
function needsApproval(mode) {
  return approvalMode(mode) === APPROVAL.MANUAL;
}

/**
 * What to record on a new order, and what to do about it.
 *
 * Returned as one object so a caller cannot save the state and forget the
 * ticket, or print a ticket for an order it recorded as pending - the two have
 * to move together or the kitchen and the screen disagree about what is
 * cooking.
 *
 * @param {string} mode
 * @returns {{state: string, printKitchenTicket: boolean, alert: string}}
 */
function decideOnArrival(mode) {
  if (needsApproval(mode)) {
    return {
      state: ORDER_STATE.PENDING,
      printKitchenTicket: false,
      /* An alarm, not a chime. Nobody is watching this screen: the point is to
         reach someone in another room, on another page, or not looking. */
      alert: 'waiting',
    };
  }

  return {
    state: ORDER_STATE.ACCEPTED,
    printKitchenTicket: true,
    /* A short noise. The ticket is already printing, so this only has to tell
       whoever is at the till that it happened. */
    alert: 'received',
  };
}

/**
 * Moving an order on, and whether that move prints.
 *
 * The kitchen is told exactly once, on the move from pending to accepted.
 * Accepting something already accepted must not print a second ticket - a
 * double-tap on a slow screen is the ordinary way that happens, and two
 * tickets for one order is two lots of food.
 *
 * @param {string} from  the state the order is in
 * @param {string} to    the state somebody is asking for
 * @returns {{allowed: boolean, state: string, printKitchenTicket: boolean, reason: string}}
 */
function transition(from, to) {
  const current = ORDER_STATES.includes(from) ? from : ORDER_STATE.PENDING;
  const wanted = ORDER_STATES.includes(to) ? to : null;

  if (!wanted) {
    return { allowed: false, state: current, printKitchenTicket: false, reason: 'unknown state' };
  }

  if (current === wanted) {
    /* Not an error - somebody pressed twice - but nothing happens, and above
       all nothing prints. */
    return { allowed: true, state: current, printKitchenTicket: false, reason: 'no change' };
  }

  if (current === ORDER_STATE.PENDING) {
    return {
      allowed: true,
      state: wanted,
      printKitchenTicket: wanted === ORDER_STATE.ACCEPTED,
      reason: '',
    };
  }

  /*
   * Once it is accepted or rejected it stays there. Rejecting an order the
   * kitchen has already started is not a state change, it is a conversation
   * and then a void - and a void is a different operation with a different
   * audit trail, which this must not quietly stand in for.
   */
  return {
    allowed: false,
    state: current,
    printKitchenTicket: false,
    reason: `an order that is already ${current} cannot be marked ${wanted}`,
  };
}

module.exports = {
  APPROVAL,
  ORDER_STATE,
  ORDER_STATES,
  approvalMode,
  decideOnArrival,
  needsApproval,
  transition,
};
