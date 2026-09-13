'use strict';

/*
 * THE PRINT QUEUE.
 *
 * Owner: "there should be way to communicate the till via localhost or via
 * cloud. thats the whole point... need solution that which till need to send
 * for bill also there. so it needs to be seen in bigger picture."
 *
 * Three operations and nothing else: put a job on, take a job off, say it is
 * done. Everything that makes the cloud case work is in the fact that a job
 * CARRIES what to print, so a till never has to own the sale.
 *
 * The one part worth reading slowly is the claim.
 */

const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
/*
 * THE MODEL IS FETCHED WHEN IT IS USED, NOT WHEN THIS FILE LOADS.
 *
 * sale.repository.js requires this file, and a good many test suites require
 * sale.repository with mongoose stubbed out. A schema built at load time reads
 * `mongoose.Schema.Types` while that stub is in place and throws before a
 * single test has run - two suites died exactly that way, and neither of them
 * has anything to do with printing.
 *
 * Asking for the model inside each call costs one cached require and makes
 * this file safe to pull into anything.
 */
function printJobModel() {
  return require('../models/print-job.model');
}
const { announceJob } = require('../helpers/print-pace');

/* A till that takes a job and dies must not hold it for ever. After this it is
   fair game again. Long enough that a slow printer is not robbed mid-job. */
const STALE_AFTER_MS = 2 * 60 * 1000;

/* A job that has failed this many times is not going to print. It stays in the
   collection, failed, where somebody can see it - rather than cycling round
   the queue for the rest of the day. */
const MAX_ATTEMPTS = 5;

const asObjectId = (value) =>
  ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : value;

/**
 * Put something on the queue.
 *
 * @param {object} job
 * @param {string} job.branchId  the shop
 * @param {string} [job.tillId]  which machine; omitted means any
 * @param {string} [job.kind]    'bill' by default
 * @param {object} job.payload   what to print - carried, not referenced
 */
async function queuePrintJob(job = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!job.branchId) {
      return { status: false, message: 'A print job needs a branch', data: null };
    }
    const doc = await model.create({
      branch_id: asObjectId(job.branchId),
      till_id: job.tillId ? String(job.tillId).trim() : null,
      kind: job.kind || 'bill',
      payload: job.payload || {},
      label: job.label ? String(job.label).slice(0, 120) : '',
      sale_id: job.saleId ? asObjectId(job.saleId) : null,
      status: 'queued',
      created_at: new Date(),
    });
    /*
     * WAKE ANY TILL THAT IS HOLDING FOR THIS.
     *
     * A cloud till's claim can be held open for twenty seconds rather than
     * answered empty, which is both faster than polling and cheaper than it.
     * This is what ends the hold: the bill goes out the instant it is asked
     * for instead of on somebody's next tick.
     */
    announceJob(job.branchId);

    return { status: true, message: 'Queued', data: { id: String(doc._id) } };
  } catch (error) {
    console.error('Error in queuePrintJob:', error);
    return { status: false, message: 'Could not queue the print job', data: null };
  }
}

/**
 * A till asking "anything for me?", and taking it.
 *
 * THE CLAIM IS ONE ATOMIC UPDATE PER JOB, and that is the whole correctness
 * argument. Reading a list and then marking it is two operations with a gap,
 * and in that gap a second till reads the same list - so a shop with two tills
 * prints every bill twice, on the exact days it is busy enough to have two
 * tills running. findOneAndUpdate with the status in the FILTER cannot do
 * that: whoever loses the race matches nothing.
 *
 * A job whose till died mid-print is picked up again once it goes stale, which
 * is why `printing` is in the filter alongside `queued`.
 */
async function claimPrintJobs({ branchId, tillId, kind = 'bill', limit = 5 } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!branchId) return { status: true, message: 'No branch', data: [] };

    const stale = new Date(Date.now() - STALE_AFTER_MS);
    const mine = [];

    for (let i = 0; i < Math.max(1, Math.min(20, limit)); i += 1) {
      /* Serial on purpose: each claim must settle before the next, or one
         till races itself for the same job. */
      const claimed = await model
        .findOneAndUpdate(
          {
            branch_id: asObjectId(branchId),
            kind,
            attempts: { $lt: MAX_ATTEMPTS },
            /* Addressed to this till, or to nobody in particular. */
            $or: [{ till_id: null }, { till_id: '' }, { till_id: String(tillId || '') }],
            $and: [
              {
                $or: [
                  { status: 'queued' },
                  /* Abandoned by a till that took it and never came back. */
                  { status: 'printing', claimed_at: { $lt: stale } },
                ],
              },
            ],
          },
          {
            $set: {
              status: 'printing',
              claimed_by: String(tillId || ''),
              claimed_at: new Date(),
            },
            $inc: { attempts: 1 },
          },
          { sort: { created_at: 1 }, returnDocument: 'after' }
        )
        .lean();

      if (!claimed) break;
      mine.push(claimed);
    }

    return { status: true, message: 'success', data: mine };
  } catch (error) {
    console.error('Error in claimPrintJobs:', error);
    return { status: false, message: 'Could not read the print queue', data: [] };
  }
}

/**
 * The till reporting what happened to a job it took.
 *
 * A failure goes back to `queued` so somebody else - or this till on its next
 * pass - can try, until MAX_ATTEMPTS says stop. The attempt was already
 * counted at claim time, which is what makes a till that crashes mid-print
 * count too rather than looping for ever.
 */
async function finishPrintJob(id, { ok = true, error = '' } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!ObjectId.isValid(String(id))) {
      return { status: false, message: 'Not a job id', data: null };
    }
    const job = await model.findById(asObjectId(id)).lean();
    if (!job) return { status: false, message: 'No such job', data: null };

    const done = ok || job.attempts >= MAX_ATTEMPTS;
    await model.updateOne(
      { _id: asObjectId(id) },
      {
        $set: {
          status: ok ? 'done' : done ? 'failed' : 'queued',
          printed_at: ok ? new Date() : null,
          last_error: ok ? '' : String(error || '').slice(0, 300),
        },
      }
    );
    return { status: true, message: 'success', data: { id: String(id), ok: !!ok } };
  } catch (err) {
    console.error('Error in finishPrintJob:', err);
    return { status: false, message: 'Could not close the print job', data: null };
  }
}

module.exports = {
  queuePrintJob,
  claimPrintJobs,
  finishPrintJob,
  STALE_AFTER_MS,
  MAX_ATTEMPTS,
};
