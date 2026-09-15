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

/* A till that takes a job and dies must not hold it for ever. Long enough that
   a slow printer is not robbed mid-job. */
const STALE_AFTER_MS = 2 * 60 * 1000;

/* A job that has failed this many times is not going to print. It stays in the
   collection, failed, where somebody can see it - rather than cycling round
   the queue for the rest of the day. */
const MAX_ATTEMPTS = 5;

/*
 * A CLAIM THAT EXPIRES DOES NOT GO BACK IN THE QUEUE. IT ASKS A PERSON.
 *
 * This is the rule the architecture document argued for and the queue did not
 * have. A stale `printing` job used to be fair game again, which reads as
 * resilience and is actually the duplicate machine:
 *
 *   A till claims a ticket. It sends the bytes. The printer takes the paper.
 *   The till dies before it can say so. Two minutes later the job looks
 *   abandoned, another pass claims it, and the kitchen gets the same order
 *   twice. A cook prepares what arrives; nobody compares it with what arrived
 *   a minute ago.
 *
 * "Printed but never confirmed" and "never printed" are INDISTINGUISHABLE from
 * the server. Guessing means being wrong half the time, and the two wrong
 * answers do not cost the same: a duplicate is silent and costs food, a miss is
 * loud and costs a reminder. So the queue stops guessing and asks.
 *
 * Owner, on who gets asked: a shop has one counter, so it is the till that took
 * the job. It sees "did this print?" with two buttons and the queue believes
 * the answer.
 */
const NEEDS_ATTENTION = 'needs_attention';

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

    /*
     * Clear what a dead till left behind BEFORE claiming anything new.
     *
     * Here rather than on a timer: the only moment that matters is when a till
     * is about to take work, and a timer is one more thing to start, own and
     * discover has stopped. This runs on the pass that would otherwise have
     * re-claimed the abandoned job and printed it twice.
     */
    await sweepStale({ branchId }, { Model: model });

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
            /*
             * ONLY queued. A job left in `printing` by a till that never came
             * back is NOT fair game: it may already be on paper. sweepStale
             * moves it to needs_attention, where a person decides.
             */
            status: 'queued',
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
 * Move abandoned claims to a person, rather than back into the queue.
 *
 * Run before claiming, so a till's own pass clears what it left behind last
 * time. Bounded and cheap: one updateMany over an indexed status.
 *
 * `attempts` is NOT incremented here. The attempt was already counted when the
 * job was claimed - counting it twice would retire a job on its third real try.
 */
async function sweepStale({ branchId } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    const stale = new Date(Date.now() - STALE_AFTER_MS);
    const where = { status: 'printing', claimed_at: { $lt: stale } };
    if (branchId) where.branch_id = asObjectId(branchId);

    const res = await model.updateMany(where, {
      $set: {
        status: NEEDS_ATTENTION,
        last_error:
          'The till took this job and did not report back. It may or may not have printed.',
      },
    });
    const moved = (res && (res.modifiedCount || res.nModified)) || 0;
    if (moved)
      console.warn(`[print-queue] ${moved} job(s) need somebody to say whether they printed`);
    return { status: true, message: 'success', data: { moved } };
  } catch (error) {
    console.error('Error in sweepStale:', error);
    return { status: false, message: 'Could not sweep the print queue', data: { moved: 0 } };
  }
}

/** What is waiting on a person, so a till can show it. */
async function jobsNeedingAttention({ branchId, limit = 20 } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!branchId) return { status: true, message: 'No branch', data: [] };
    const rows = await model
      .find({ branch_id: asObjectId(branchId), status: NEEDS_ATTENTION })
      .sort({ created_at: 1 })
      .limit(Math.max(1, Math.min(100, limit)))
      .lean();
    return { status: true, message: 'success', data: rows };
  } catch (error) {
    console.error('Error in jobsNeedingAttention:', error);
    return { status: false, message: 'Could not read what needs attention', data: [] };
  }
}

/**
 * A person has answered "did this print?".
 *
 * `printed: true` closes it. `printed: false` puts it back on the queue, which
 * is a DELIBERATE reprint by somebody who looked at the printer - the only kind
 * of retry this design allows, because it is the only kind that cannot be wrong
 * about what already came out.
 */
async function resolveAttention(id, { printed = false, by = '' } = {}, { Model } = {}) {
  const model = Model || printJobModel();
  try {
    if (!ObjectId.isValid(String(id))) {
      return { status: false, message: 'Not a job id', data: null };
    }
    const job = await model.findById(asObjectId(id)).lean();
    if (!job) return { status: false, message: 'No such job', data: null };
    if (job.status !== NEEDS_ATTENTION) {
      /* Two people answering the same question must not undo each other, and
         the second answer must not requeue something already closed. */
      return { status: true, message: 'Already answered', data: { id: String(id), already: true } };
    }

    await model.updateOne(
      { _id: asObjectId(id), status: NEEDS_ATTENTION },
      {
        $set: {
          status: printed ? 'done' : 'queued',
          printed_at: printed ? new Date() : null,
          claimed_by: '',
          claimed_at: null,
          last_error: printed
            ? ''
            : `Reprint asked for by ${String(by || 'the till').slice(0, 60)}`,
        },
      }
    );
    return { status: true, message: 'success', data: { id: String(id), printed: !!printed } };
  } catch (error) {
    console.error('Error in resolveAttention:', error);
    return { status: false, message: 'Could not answer the print job', data: null };
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

    /*
     * Out of attempts is not "give up quietly". Five failures is a printer a
     * person has to look at, so it joins the same list rather than sitting in
     * `failed` where only a developer would find it.
     */
    const exhausted = !ok && job.attempts >= MAX_ATTEMPTS;
    await model.updateOne(
      { _id: asObjectId(id) },
      {
        $set: {
          status: ok ? 'done' : exhausted ? NEEDS_ATTENTION : 'queued',
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
  sweepStale,
  jobsNeedingAttention,
  resolveAttention,
  NEEDS_ATTENTION,
  STALE_AFTER_MS,
  MAX_ATTEMPTS,
};
