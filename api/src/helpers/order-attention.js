'use strict';
/*
 * Make a noise when an order arrives.
 *
 * WHY A SOUND AND NOT A BADGE.
 *
 * The person who needs to know is not looking at the screen. They are at the
 * pass, in the kitchen, serving a table, or - the owner's own words - watching
 * a movie. A number that goes up in the corner of a page nobody is facing is
 * not a notification, it is a record of something that was missed. Online
 * orders are the one part of this product where nobody is standing in front of
 * the till when the event happens.
 *
 * TWO SOUNDS, BECAUSE THEY MEAN DIFFERENT THINGS.
 *
 *   received   the order is accepted and the ticket is already printing. A
 *              short chime: this is information, not a task.
 *   waiting    the order is held and will sit there until somebody says yes.
 *              An alarm, and one worth repeating, because until it is answered
 *              the customer is waiting and the kitchen does not know they
 *              exist.
 *
 * Collapsing them into one sound would train staff to ignore the one that
 * matters, which is exactly how alarms stop working.
 *
 * `process` IS THE BUS, for the same reason kot-notify uses it: the API ships
 * outside the ASAR archive while the desktop code lives inside it, so the two
 * halves cannot reliably require the same module instance. A shared emitter
 * file would quietly become two emitters and the event would go nowhere. Both
 * halves already have `process`.
 *
 * NOTHING HERE MAY THROW. A sound card, a muted device or a missing listener
 * must never fail an order a customer has already placed.
 */

const ATTENTION_EVENT = 'posnic:order-attention';

/**
 * Announce that an order wants somebody's attention.
 *
 * @param {object} details
 * @param {string} [details.branchId]  whose order it is, so a device serving
 *                                     one branch can ignore another's
 * @param {string} [details.saleId]
 * @param {string} [details.alert]     'received' or 'waiting'
 * @param {string} [details.state]     the order's state, for the queue badge
 * @param {number} [details.total]
 */
function notifyOrderAttention(details = {}) {
  try {
    const payload = {
      branchId: details.branchId ? String(details.branchId) : '',
      saleId: details.saleId ? String(details.saleId) : '',
      /* Anything unrecognised is the quieter sound. A new alert type added
         later must not accidentally start setting off alarms on shops running
         an older desktop build. */
      alert: details.alert === 'waiting' ? 'waiting' : 'received',
      state: details.state ? String(details.state) : '',
      total: Number(details.total) || 0,
      at: new Date().toISOString(),
    };

    process.emit(ATTENTION_EVENT, payload);
    return true;
  } catch (e) {
    /* A notification that fails is a quiet shop, not a lost order. */
    console.warn('[order-attention] could not announce an order:', e.message);
    return false;
  }
}

module.exports = { ATTENTION_EVENT, notifyOrderAttention };
