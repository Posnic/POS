'use strict';

/*
 * HOW LONG AN UNANSWERED ORDER IS ALLOWED TO GO UNNOTICED.
 *
 * Stage 3 of Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ROADMAP.md, which says
 * what to replace:
 *
 *   "Replace 20 seconds x 15 then silence with: acknowledge stops it, escalate
 *   in reach rather than volume, back off, then the shop's declared default
 *   fires."
 *
 * WHAT WAS THERE
 *
 * order-alert.js repeated every 20 seconds, fifteen times, and then stopped -
 * with the order still unanswered and the customer still waiting. Its own
 * comment is honest about why: "An alarm that never stops is one somebody mutes
 * at the speaker, and then it is gone for every future order too."
 *
 * That reasoning is right and the conclusion is wrong. The choice is not
 * between nagging for ever and giving up; it is between the same volume for
 * ever and BACKING OFF. After five minutes the shop has either not heard it or
 * cannot act yet, and repeating at the same pace teaches people to ignore it.
 * Going silent teaches them the alarm handles itself.
 *
 *   Today an order can sit until closing time and nothing says so.
 *
 * FOUR RULES
 *
 *   1. ACKNOWLEDGING STOPS IT. Not answering - acknowledging. "I have seen
 *      this" is a different act from "I have accepted it", and a shop mid-rush
 *      needs to be able to do the first without the second. Nothing else should
 *      silence an alarm, which is why muting is not offered.
 *
 *   2. IT BACKS OFF, it does not stop. 20s, then a minute, then five, then
 *      every fifteen for as long as it takes. A slow heartbeat is still a
 *      signal; silence is not.
 *
 *   3. IT ESCALATES IN REACH, NOT VOLUME. Louder is how an alarm gets muted.
 *      Further is how it gets answered: the till, then the handsets, then the
 *      owner's phone.
 *
 *   4. THEN THE SHOP'S DECLARED DEFAULT FIRES. Owner: "let restaurent owner
 *      decide that. give option auto cancel or auto accept. based ont time he
 *      defines it. by default dont accpept or reject."
 *
 * Pure, and returns a DECISION rather than performing one: the deciding is what
 * is worth testing, and it cannot be tested inside a timer.
 */

/*
 * Backoff, in seconds since the order arrived.
 *
 * Chosen so the first two minutes are insistent - that is when somebody is most
 * likely nearby and the customer is most likely still watching their phone -
 * and the tail is a heartbeat rather than a nag.
 */
const STEPS = Object.freeze([
  { after: 0, everyMs: 20 * 1000, reach: 'till' },
  { after: 120, everyMs: 60 * 1000, reach: 'till' },
  { after: 300, everyMs: 5 * 60 * 1000, reach: 'handsets' },
  { after: 900, everyMs: 15 * 60 * 1000, reach: 'owner' },
]);

/** What a shop may choose to happen when nobody answers at all. */
const ON_SILENCE = Object.freeze(['nothing', 'accept', 'cancel']);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * What should happen to this order, right now.
 *
 * @param {object} order
 * @param {number} order.waitingMs        how long since it arrived
 * @param {boolean} [order.acknowledged]  somebody has said "I have seen this"
 * @param {number} [order.lastAlertedMs]  how long since it last made a noise
 * @param {string} [order.source]         where it came from, for the aggregator rule
 * @param {object} policy                 the shop's settings
 * @returns {{alert: boolean, reach: string, decide: string, reason: string, nextInMs: number}}
 */
function decide(order = {}, policy = {}) {
  const waitingMs = num(order.waitingMs, 0);
  const sinceAlert = num(order.lastAlertedMs, Infinity);
  const waitingSec = waitingMs / 1000;

  const step = [...STEPS].reverse().find((s) => waitingSec >= s.after) || STEPS[0];

  /*
   * ACKNOWLEDGED IS NOT ANSWERED.
   *
   * The noise stops because somebody is dealing with it. The order is still
   * waiting, so the shop's declared default still fires on time - otherwise
   * "acknowledge" becomes a way to make the timer go away and an order can be
   * parked for ever by tapping a button.
   */
  const alert = !order.acknowledged && sinceAlert >= step.everyMs;

  const decision = decideOnSilence(order, policy, waitingMs);

  return {
    alert,
    reach: step.reach,
    decide: decision.decide,
    reason: decision.reason,
    nextInMs: step.everyMs,
  };
}

/**
 * The shop's declared default, when nobody has answered in time.
 *
 * Absent means NOTHING, on purpose. Owner: "by default dont accpept or reject."
 * A product that cancels a customer's order because a shop never opened a
 * settings page has made a decision that was not its to make.
 */
function decideOnSilence(order, policy, waitingMs) {
  const onSilence = ON_SILENCE.includes(policy.onSilence) ? policy.onSilence : 'nothing';
  const afterMs = num(policy.decideAfterMinutes, 0) * 60 * 1000;

  if (onSilence === 'nothing') {
    return { decide: 'nothing', reason: 'This shop has not asked for anything to happen by itself.' };
  }
  if (!afterMs) {
    return { decide: 'nothing', reason: 'No time has been set, so nothing happens by itself.' };
  }
  if (waitingMs < afterMs) {
    return { decide: 'nothing', reason: 'Still inside the time the shop allows.' };
  }

  /*
   * An aggregator's clock is not ours.
   *
   * Swiggy and Zomato reject on their own timer and count it against the shop,
   * so a decision of ours that lands after theirs is worse than none: the order
   * is already gone and we have recorded the opposite. A shop can only act
   * INSIDE their window, never after it.
   */
  if (decideAfterTheirs(order, policy)) {
    return {
      decide: 'nothing',
      reason:
        'The delivery partner decides this one on its own clock, and that clock ran out first.',
    };
  }

  return {
    decide: onSilence,
    reason: `Nobody answered within ${policy.decideAfterMinutes} minutes, and this shop asked for "${onSilence}".`,
  };
}

/** Has the partner's own deadline already passed? */
function decideAfterTheirs(order, policy) {
  const partnerWindow = num(policy.partnerWindowMinutes, 0) * 60 * 1000;
  if (!partnerWindow) return false;
  const fromPartner = String(order.source || '').toLowerCase() === 'marketplace';
  if (!fromPartner) return false;
  return num(order.waitingMs, 0) >= partnerWindow;
}

/**
 * What the CUSTOMER can do while they wait, which is not a setting.
 *
 * Owner: "have option to retry from customer end. or let them contact
 * restaurant."
 *
 * Never configurable, and that is the point. If a shop never sets a timer the
 * order sits - so the one thing that must always be true is that the person
 * waiting is not trapped in silence. A shop can choose what IT does; it cannot
 * choose to leave a customer with no way out.
 */
function customerOptions(order = {}) {
  return {
    canRetry: true,
    canContactShop: true,
    waitingMinutes: Math.floor(num(order.waitingMs, 0) / 60000),
  };
}

module.exports = { decide, customerOptions, STEPS, ON_SILENCE };
