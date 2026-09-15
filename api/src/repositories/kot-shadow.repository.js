'use strict';

/*
 * THE KITCHEN QUEUE, WATCHING AND PRINTING NOTHING.
 *
 * Step 1 of Stage 2 in Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ROADMAP.md,
 * and the step that is usually skipped:
 *
 *   "Write print_jobs rows and drain nothing. Compare, for a week, what the
 *   queue says should print against what actually printed. Any disagreement is
 *   a bug found before it can cost anything."
 *
 * WHY NOT JUST SWITCH THE KITCHEN OVER
 *
 * Ninety shops print every kitchen ticket through multiKitchenPrint today. It
 * is the path that feeds the cooks, and the failure mode of getting a cutover
 * wrong is not an error message - it is a dish nobody made, or two dishes where
 * one was ordered. Owner: "printing dont bring me new issues. keep changes
 * safely."
 *
 * So the queue records what it BELIEVES should print, the old path keeps
 * printing exactly as it does, and the two are compared. Nothing here can
 * change what comes out of a printer: no till ever claims a `kot` job, because
 * the till only ever asks for `kind: 'bill'`.
 *
 * WHAT A DISAGREEMENT MEANS
 *
 *   queued, never reported   the server expected a ticket the till never said
 *                            it printed. Either the till never saw it, or it
 *                            printed and the report was lost. Both are worth
 *                            knowing and neither is visible today.
 *
 *   reported, never queued   the till printed something the server did not
 *                            expect. That is the shape a duplicate has.
 *
 * Both were invisible before, which is why nobody could say whether duplicates
 * happen four times a week or forty.
 *
 * NOTHING HERE MAY THROW INTO THE PRINTING PATH. It is a bystander. A shadow
 * that breaks a service is worse than no shadow at all.
 */

const mongoose = require('mongoose');
const { kotJobKeys, kotFallbackKey } = require('../utils/kot-job-key');

function printJobModel() {
  return require('../models/print-job.model');
}

const asObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value))
    ? new mongoose.Types.ObjectId(String(value))
    : value;

/** Every ticket a sale is asking for, named the way the till names it. */
function ticketsOf(sale = {}) {
  const named = kotJobKeys(sale);
  if (named.length) return named;

  /*
   * A sale with no print_jobs array is named by the other scheme. Leaving
   * those out would make the shadow silently blind to a whole class of ticket
   * and then report perfect agreement, which is the worst possible outcome for
   * a measurement.
   */
  const proc = String(sale.sale_process || '').toUpperCase();
  if (!proc.includes('KOT') && !proc.includes('CANCEL')) return [];
  const cancelled = proc.includes('CANCEL');
  return [
    {
      key: kotFallbackKey(sale, { cancelled }),
      type: cancelled ? 'cancel' : 'kot',
      job: null,
    },
  ];
}

/**
 * Record what the queue believes should print. Prints nothing.
 *
 * Idempotent by ticket name: handing the same sale out on ten polls writes one
 * row. That is enforced by the unique index rather than by a read-then-write,
 * because two tills polling at once would both read "absent" and both insert.
 */
async function recordExpected(sales = [], { branchId } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  const out = { seen: 0, written: 0 };
  try {
    if (!branchId || !Array.isArray(sales) || !sales.length) return { status: true, data: out };

    for (const sale of sales) {
      const saleId = sale && sale._id ? String(sale._id) : '';
      for (const ticket of ticketsOf(sale)) {
        out.seen += 1;
        try {
          await model.updateOne(
            { branch_id: asObjectId(branchId), ticket_key: ticket.key },
            {
              $setOnInsert: {
                branch_id: asObjectId(branchId),
                kind: 'kot',
                ticket_key: ticket.key,
                sale_id: mongoose.Types.ObjectId.isValid(saleId) ? asObjectId(saleId) : null,
                /*
                 * SHADOW, so no till can take it. `claimPrintJobs` only ever
                 * looks for `queued`, and the till only ever asks for bills -
                 * but a status nothing claims is a second lock on the door.
                 */
                status: 'shadow',
                label: `${ticket.type} ${saleId}`.trim(),
                payload: {},
                created_at: new Date(),
              },
            },
            { upsert: true }
          );
          out.written += 1;
        } catch (e) {
          /* A duplicate key is the normal case on every poll after the first,
             and is not worth a line in a log that a shop reads. */
          if (!e || e.code !== 11000) {
            console.warn('[kot-shadow] could not record a ticket:', e && e.message);
          }
        }
      }
    }
    return { status: true, data: out };
  } catch (error) {
    console.warn('[kot-shadow] recording skipped:', error && error.message);
    return { status: true, data: out };
  }
}

/**
 * The till has reported a ticket printed. Close the shadow row.
 *
 * Called with the keys the till used, so a row closes only when the SAME
 * ticket was reported - not merely when something for that sale was.
 */
async function markShadowPrinted(keys = [], { branchId, saleIds = [] } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!branchId) return { status: true, data: { closed: 0, by: 'none' } };
    const list = (Array.isArray(keys) ? keys : []).map(String).filter(Boolean);

    if (list.length) {
      const res = await model.updateMany(
        { branch_id: asObjectId(branchId), ticket_key: { $in: list }, status: 'shadow' },
        { $set: { status: 'done', printed_at: new Date() } }
      );
      return {
        status: true,
        data: { closed: (res && (res.modifiedCount || res.nModified)) || 0, by: 'key' },
      };
    }

    /*
     * A TILL THAT DOES NOT YET SEND KEYS STILL CLOSES ITS ROWS.
     *
     * Ticket names are new on the wire. Closing only by key would leave every
     * row from every till on an older build open for ever, and the very first
     * report would say the whole estate is failing - which would make the
     * measurement worthless exactly when it is meant to be establishing a
     * baseline.
     *
     * By sale is less precise: a sale with two tickets closes both when the
     * till reported one. That understates disagreement rather than inventing
     * it, which is the safe direction for a number nobody has yet.
     */
    const ids = (Array.isArray(saleIds) ? saleIds : [])
      .map(String)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map(asObjectId);
    if (!ids.length) return { status: true, data: { closed: 0, by: 'none' } };

    const res = await model.updateMany(
      { branch_id: asObjectId(branchId), sale_id: { $in: ids }, status: 'shadow' },
      { $set: { status: 'done', printed_at: new Date() } }
    );
    return {
      status: true,
      data: { closed: (res && (res.modifiedCount || res.nModified)) || 0, by: 'sale' },
    };
  } catch (error) {
    console.warn('[kot-shadow] could not close a ticket:', error && error.message);
    return { status: true, data: { closed: 0, by: 'error' } };
  }
}

/**
 * What the two paths disagree about.
 *
 * `olderThanMs` exists so a ticket the till is printing RIGHT NOW is not
 * reported as missing. Anything still open after a few minutes is a real
 * disagreement, not a race.
 */
async function disagreements(
  { branchId, olderThanMs = 5 * 60 * 1000, limit = 50 } = {},
  { Model } = {}
) {
  const model = Model || printJobModel();
  try {
    if (!branchId) return { status: true, data: [] };
    const before = new Date(Date.now() - olderThanMs);
    const rows = await model
      .find({ branch_id: asObjectId(branchId), status: 'shadow', created_at: { $lt: before } })
      .sort({ created_at: 1 })
      .limit(Math.max(1, Math.min(200, limit)))
      .lean();
    return { status: true, data: rows };
  } catch (error) {
    console.warn('[kot-shadow] could not read disagreements:', error && error.message);
    return { status: true, data: [] };
  }
}

module.exports = { recordExpected, markShadowPrinted, disagreements, ticketsOf };
