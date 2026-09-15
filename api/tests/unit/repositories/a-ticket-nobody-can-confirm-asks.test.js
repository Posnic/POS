'use strict';

/*
 * A claim that expires does not go back in the queue. It asks a person.
 *
 * THE RULE THE QUEUE DID NOT HAVE
 *
 * Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ARCHITECTURE.md argues it, and the
 * queue shipped without it: a job left in `printing` by a till that never came
 * back was fair game again after two minutes. That reads as resilience and is
 * actually the duplicate machine.
 *
 *   A till claims a ticket. It sends the bytes. The printer takes the paper.
 *   The till dies before it can say so. Two minutes later the job looks
 *   abandoned, the next pass claims it, and the kitchen cooks the same order
 *   twice - because a cook prepares what arrives and does not compare it with
 *   what arrived a minute ago.
 *
 * Owner: "dupliate prints should not be there its loss for company. people wont
 * care and keep preparing what receied. they dont compare usaully what
 * received. so very carefull on that."
 *
 * "Printed but never confirmed" and "never printed" are INDISTINGUISHABLE from
 * the server. The two wrong answers do not cost the same - a duplicate is
 * silent and costs food, a miss is loud and costs a reminder - so the queue
 * stops guessing and asks the till that took the job.
 */

const {
  claimPrintJobs,
  finishPrintJob,
  sweepStale,
  jobsNeedingAttention,
  resolveAttention,
  NEEDS_ATTENTION,
  STALE_AFTER_MS,
  MAX_ATTEMPTS,
} = require('../../../src/repositories/print-job.repository');

const BRANCH = '507f1f77bcf86cd799439011';
const JOB = '507f1f77bcf86cd799439012';

/** A stand-in for the mongoose model, recording what it was asked to do. */
function fakeModel({ jobs = [], claimable = [] } = {}) {
  const calls = { updateMany: [], updateOne: [], findOneAndUpdate: [] };
  const queue = [...claimable];
  return {
    calls,
    updateMany(where, update) {
      calls.updateMany.push({ where, update });
      return Promise.resolve({ modifiedCount: 1 });
    },
    updateOne(where, update) {
      calls.updateOne.push({ where, update });
      return Promise.resolve({ modifiedCount: 1 });
    },
    findById(id) {
      const found = jobs.find((j) => String(j._id) === String(id)) || null;
      return { lean: () => Promise.resolve(found) };
    },
    findOneAndUpdate(where, update, opts) {
      calls.findOneAndUpdate.push({ where, update, opts });
      const next = queue.shift() || null;
      return { lean: () => Promise.resolve(next) };
    },
    find(where) {
      calls.find = where;
      const chain = {
        sort: () => chain,
        limit: () => chain,
        lean: () => Promise.resolve(jobs.filter((j) => j.status === where.status)),
      };
      return chain;
    },
  };
}

describe('a claim that expires asks a person', () => {
  test('A STALE CLAIM IS NEVER RE-CLAIMED, it is moved to needs_attention', async () => {
    const Model = fakeModel();
    await sweepStale({ branchId: BRANCH }, { Model });

    expect(Model.calls.updateMany).toHaveLength(1);
    const { where, update } = Model.calls.updateMany[0];
    expect(where.status).toBe('printing');
    expect(where.claimed_at.$lt).toBeInstanceOf(Date);
    expect(update.$set.status).toBe(NEEDS_ATTENTION);
  });

  test('and the claim query no longer looks at printing jobs at all', async () => {
    /*
     * The regression this guards. If `printing` returns to the filter, the
     * duplicate comes back and nothing else here would notice.
     */
    const Model = fakeModel();
    await claimPrintJobs({ branchId: BRANCH, tillId: 'till-1' }, { Model });

    const filter = Model.calls.findOneAndUpdate[0].where;
    expect(filter.status).toBe('queued');
    expect(JSON.stringify(filter)).not.toContain('printing');
  });

  test('the sweep runs BEFORE the claim, on the same pass', async () => {
    /*
     * Not on a timer. The only moment that matters is when a till is about to
     * take work, and a timer is one more thing to start, own, and discover has
     * stopped.
     */
    const Model = fakeModel();
    await claimPrintJobs({ branchId: BRANCH, tillId: 'till-1' }, { Model });
    expect(Model.calls.updateMany).toHaveLength(1);
    expect(Model.calls.updateMany[0].update.$set.status).toBe(NEEDS_ATTENTION);
  });

  test('the sweep does not count another attempt', async () => {
    /* The attempt was counted when the job was claimed. Counting it twice
       retires a job on its third real try. */
    const Model = fakeModel();
    await sweepStale({ branchId: BRANCH }, { Model });
    expect(Model.calls.updateMany[0].update.$inc).toBeUndefined();
  });

  test('it says what it does not know, rather than calling it a failure', async () => {
    const Model = fakeModel();
    await sweepStale({ branchId: BRANCH }, { Model });
    expect(Model.calls.updateMany[0].update.$set.last_error).toMatch(/may or may not have printed/);
  });
});

describe('answering the question', () => {
  test('"it printed" closes the job and never reprints', async () => {
    const Model = fakeModel({ jobs: [{ _id: JOB, status: NEEDS_ATTENTION, attempts: 1 }] });
    const res = await resolveAttention(JOB, { printed: true, by: 'counter' }, { Model });

    expect(res.status).toBe(true);
    expect(Model.calls.updateOne[0].update.$set.status).toBe('done');
    expect(Model.calls.updateOne[0].update.$set.printed_at).toBeInstanceOf(Date);
  });

  test('"it did not" puts it back, which is the ONLY retry this design allows', async () => {
    /*
     * A deliberate reprint by somebody who looked at the printer. That is the
     * only kind of retry that cannot be wrong about what already came out.
     */
    const Model = fakeModel({ jobs: [{ _id: JOB, status: NEEDS_ATTENTION, attempts: 1 }] });
    await resolveAttention(JOB, { printed: false, by: 'Sriram' }, { Model });

    const set = Model.calls.updateOne[0].update.$set;
    expect(set.status).toBe('queued');
    expect(set.claimed_by).toBe('');
    expect(set.claimed_at).toBeNull();
    expect(set.last_error).toMatch(/Reprint asked for by Sriram/);
  });

  test('TWO PEOPLE ANSWERING DO NOT UNDO EACH OTHER', async () => {
    /*
     * A busy counter has two staff and one question on screen. The second
     * answer must not requeue something the first already closed - that would
     * be a duplicate created by the very mechanism meant to prevent one.
     */
    const Model = fakeModel({ jobs: [{ _id: JOB, status: 'done', attempts: 1 }] });
    const res = await resolveAttention(JOB, { printed: false }, { Model });

    expect(res.data.already).toBe(true);
    expect(Model.calls.updateOne).toHaveLength(0);
  });

  test('and the write itself is guarded, not only the read', async () => {
    /* The check above is a read; between it and the write another till can
       answer. The update names the status it expects. */
    const Model = fakeModel({ jobs: [{ _id: JOB, status: NEEDS_ATTENTION, attempts: 1 }] });
    await resolveAttention(JOB, { printed: true }, { Model });
    expect(Model.calls.updateOne[0].where.status).toBe(NEEDS_ATTENTION);
  });

  test('a job id that is not one is refused rather than guessed at', async () => {
    const Model = fakeModel();
    const res = await resolveAttention('not-an-id', { printed: true }, { Model });
    expect(res.status).toBe(false);
    expect(Model.calls.updateOne).toHaveLength(0);
  });
});

describe('a printer nobody can fix', () => {
  test('OUT OF ATTEMPTS ASKS A PERSON, it does not die quietly', async () => {
    /*
     * Five failures is a printer somebody has to look at. `failed` put it
     * where only a developer would find it.
     */
    const Model = fakeModel({ jobs: [{ _id: JOB, status: 'printing', attempts: MAX_ATTEMPTS }] });
    await finishPrintJob(JOB, { ok: false, error: 'out of paper' }, { Model });
    expect(Model.calls.updateOne[0].update.$set.status).toBe(NEEDS_ATTENTION);
  });

  test('but a failure with attempts left just goes back on the queue', async () => {
    const Model = fakeModel({ jobs: [{ _id: JOB, status: 'printing', attempts: 1 }] });
    await finishPrintJob(JOB, { ok: false, error: 'busy' }, { Model });
    expect(Model.calls.updateOne[0].update.$set.status).toBe('queued');
  });

  test('a success is a success whatever the attempt count', async () => {
    const Model = fakeModel({ jobs: [{ _id: JOB, status: 'printing', attempts: MAX_ATTEMPTS }] });
    await finishPrintJob(JOB, { ok: true }, { Model });
    expect(Model.calls.updateOne[0].update.$set.status).toBe('done');
  });
});

describe('showing it to somebody', () => {
  test('a till can ask what is waiting on a person', async () => {
    const Model = fakeModel({
      jobs: [
        { _id: JOB, status: NEEDS_ATTENTION },
        { _id: '507f1f77bcf86cd799439013', status: 'queued' },
      ],
    });
    const res = await jobsNeedingAttention({ branchId: BRANCH }, { Model });
    expect(res.data).toHaveLength(1);
    expect(String(res.data[0]._id)).toBe(JOB);
  });

  test('without a branch it answers empty rather than every shop', async () => {
    const Model = fakeModel({ jobs: [{ _id: JOB, status: NEEDS_ATTENTION }] });
    const res = await jobsNeedingAttention({}, { Model });
    expect(res.data).toEqual([]);
  });

  test('the stale window is long enough not to rob a slow printer', () => {
    /* A thermal printer on a long job, or a till on bad Wi-Fi, must not be
       declared dead while it is still working. */
    expect(STALE_AFTER_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});
