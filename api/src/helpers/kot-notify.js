'use strict';

/*
 * Tell the printer a kitchen ticket exists, instead of making it ask.
 *
 * The API is require()d into the desktop app's main process (see startServer in
 * src/main.js), so the code that saves a KOT sale and the code that prints it
 * are already in the same process, sharing memory. Until now they spoke over
 * HTTP on a five second timer, which is what Hardware Manager needed back when
 * it was a separate application, and which is why that screen still asks for a
 * Branch ID: a poller is an outsider and has to say whose tickets it wants.
 *
 * `process` is the bus on purpose. The API ships outside the ASAR archive
 * (extraResources/server.js) while kot-manager.js lives inside it, so the two
 * cannot reliably require the same module instance - a shared emitter file
 * would silently become two emitters, and the event would go nowhere. Both
 * halves already have `process`.
 *
 * Nothing here may throw. A printer problem must never fail a sale that the
 * customer has already paid for, so every call is wrapped and failure is
 * limited to falling back to the poll that still runs underneath.
 */

const KOT_EVENT = 'posnic:kot-created';

/**
 * Announce that a kitchen ticket is ready to print.
 *
 * @param {object} details
 * @param {string} [details.branchId]  the branch that made the sale - carried so
 *                                     the printer never has to be told which
 *                                     shop it belongs to
 * @param {string} [details.saleId]    for the log line only
 * @param {string} [details.reason]    'created' or 'updated'
 */
function notifyKotReady(details = {}) {
  try {
    const payload = {
      branchId: details.branchId ? String(details.branchId) : '',
      saleId: details.saleId ? String(details.saleId) : '',
      reason: details.reason || 'created',
      at: Date.now(),
    };
    process.emit(KOT_EVENT, payload);
    // A speaker-only kitchen has no printer poller to read these changes.
    // Send only the committed delta, with a distinct identity per revision.
    if (Array.isArray(details.items)) {
      for (const kind of ['cancel', 'add']) {
        const items = details.items.filter((item) => item.process === kind);
        if (!items.length) continue;
        const eventKey = require('crypto')
          .createHash('sha256')
          .update(JSON.stringify([payload.saleId, details.revision, kind, items]))
          .digest('hex');
        require('./order-attention').notifyOrderAttention({
          branchId: payload.branchId,
          saleId: payload.saleId,
          eventKey,
          ticket: {
            table: String(details.table || ''),
            items,
            cancelled: kind === 'cancel',
            whole: details.whole === true,
            changed: kind === 'add',
          },
        });
      }
    }
  } catch (e) {
    /* Deliberately swallowed. The sale is already written; the fallback poll
       will find this ticket within its interval. */
  }
}

module.exports = { notifyKotReady, KOT_EVENT };
