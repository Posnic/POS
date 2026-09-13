'use strict';

/*
 * Tell the counter a bill was asked for, instead of making it ask.
 *
 * THE WHOLE POINT, IN ONE SENTENCE: when a handset is on the shop's own Wi-Fi
 * it is talking to the till's OWN API, and that API is require()d into the
 * desktop app's main process - so the code that records the request and the
 * code that drives the printer are already in the same process, sharing
 * memory. Making them speak over a ten second poll was an errand nobody needed
 * to run.
 *
 * On LAN this turns "the waiter taps Print bill" into "the printer starts",
 * with nothing in between. On a cloud shop the till cannot be reached from
 * outside at all, so the poll underneath stays - it is the only way for a till
 * behind a router to learn anything, and it is also what catches a request
 * made while the app was starting or a print that failed.
 *
 * `process` is the bus on purpose, for exactly the reason kot-notify.js gives:
 * the API ships OUTSIDE the ASAR archive while bill-manager.js lives inside
 * it, so the two cannot reliably require the same module instance. A shared
 * emitter file would silently become two emitters and the event would go
 * nowhere. Both halves already have `process`.
 *
 * Nothing here may throw. A printer problem must never fail the request that a
 * waiter is standing at a table waiting on, so every call is wrapped and the
 * worst case is falling back to the poll that still runs underneath.
 */

const BILL_EVENT = 'posnic:bill-requested';

/**
 * Announce that a bill has been asked for from the floor.
 *
 * @param {object} details
 * @param {string} [details.branchId] the branch it belongs to, carried so the
 *                                    printer never has to be told which shop
 * @param {string} [details.table]    for the log line only
 * @param {number} [details.count]    how many tickets were marked
 */
function notifyBillRequested(details = {}) {
  try {
    const payload = {
      branchId: details.branchId ? String(details.branchId) : '',
      table: details.table ? String(details.table) : '',
      count: Number(details.count) || 0,
      at: Date.now(),
    };
    process.emit(BILL_EVENT, payload);
  } catch (e) {
    /* Deliberately swallowed. The request is already written; the fallback
       poll will find it within its interval. */
  }
}

module.exports = { notifyBillRequested, BILL_EVENT };
