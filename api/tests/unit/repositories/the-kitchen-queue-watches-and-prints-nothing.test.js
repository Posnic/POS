'use strict';

/*
 * The kitchen queue, watching. Printing nothing.
 *
 * Step 1 of Stage 2 in the print roadmap, and the step usually skipped:
 *
 *   "Write print_jobs rows and drain nothing. Compare, for a week, what the
 *   queue says should print against what actually printed. Any disagreement is
 *   a bug found before it can cost anything."
 *
 * WHY IT IS WORTH A WHOLE CHANGE TO PRINT NOTHING
 *
 * Ninety shops feed their kitchens through multiKitchenPrint. The failure mode
 * of a bad cutover is not an error message - it is a dish nobody made, or two
 * dishes where one was ordered. Owner: "printing dont bring me new issues. keep
 * changes safely."
 *
 * So the queue records what it believes should print, the old path keeps
 * printing exactly as it does, and the two are compared. Nobody yet knows
 * whether duplicates happen four times a week or forty; this is the thing that
 * can answer it, and it can answer it without touching a printer.
 *
 * THE TEST THAT MATTERS MOST is that a shadow row can never reach a printer.
 */

const shadow = require('../../../src/repositories/kot-shadow.repository');
const { kotJobKey, kotFallbackKey } = require('../../../src/utils/kot-job-key');
const { claimPrintJobs } = require('../../../src/repositories/print-job.repository');

const BRANCH = '507f1f77bcf86cd799439011';
const SALE = '507f1f77bcf86cd799439012';

function fakeModel({ rows = [] } = {}) {
  const calls = { updateOne: [], updateMany: [], findOneAndUpdate: [], find: [] };
  return {
    calls,
    updateOne(where, update, opts) {
      calls.updateOne.push({ where, update, opts });
      return Promise.resolve({ upsertedCount: 1 });
    },
    updateMany(where, update) {
      calls.updateMany.push({ where, update });
      return Promise.resolve({ modifiedCount: 1 });
    },
    findOneAndUpdate(where, update, opts) {
      calls.findOneAndUpdate.push({ where, update, opts });
      return { lean: () => Promise.resolve(null) };
    },
    find(where) {
      calls.find.push(where);
      const chain = {
        sort: () => chain,
        limit: () => chain,
        lean: () => Promise.resolve(rows),
      };
      return chain;
    },
  };
}

const aSale = (over = {}) => ({
  _id: SALE,
  sale_process: 'KOT',
  print_jobs: [{ type: 'KOT', timestamp: new Date(1757800000000), items: [{ n: 'Idli' }] }],
  ...over,
});

describe('it cannot print', () => {
  test('A SHADOW ROW IS WRITTEN WITH A STATUS NO TILL CLAIMS', async () => {
    const Model = fakeModel();
    await shadow.recordExpected([aSale()], { branchId: BRANCH }, { Model });

    const { update } = Model.calls.updateOne[0];
    expect(update.$setOnInsert.status).toBe('shadow');
    expect(update.$setOnInsert.kind).toBe('kot');
  });

  test('and the claim query would never match it', async () => {
    /*
     * The guarantee, checked against the real claim rather than asserted. If
     * claimPrintJobs ever widens to `shadow`, this fails and a watching row
     * becomes paper in a kitchen.
     */
    const Model = fakeModel();
    await claimPrintJobs({ branchId: BRANCH, tillId: 'till-1', kind: 'kot' }, { Model });

    const filter = Model.calls.findOneAndUpdate[0].where;
    expect(filter.status).toBe('queued');
    expect(JSON.stringify(filter)).not.toContain('shadow');
  });

  test('it writes no payload, so there is nothing to print even by accident', async () => {
    const Model = fakeModel();
    await shadow.recordExpected([aSale()], { branchId: BRANCH }, { Model });
    expect(Model.calls.updateOne[0].update.$setOnInsert.payload).toEqual({});
  });
});

describe('what it records', () => {
  test('the ticket is named the way the TILL names it', async () => {
    /* The whole point. A name the till does not use answers no question. */
    const sale = aSale();
    const Model = fakeModel();
    await shadow.recordExpected([sale], { branchId: BRANCH }, { Model });

    const expected = kotJobKey(SALE, sale.print_jobs[0]);
    expect(Model.calls.updateOne[0].where.ticket_key).toBe(expected);
  });

  test('a sale with no print_jobs is named by the OTHER scheme, not skipped', async () => {
    /*
     * Skipping them would make the shadow blind to a whole class of ticket and
     * then report perfect agreement - the worst outcome a measurement can have.
     */
    const sale = { _id: SALE, sale_process: 'KOT', items: [{ n: 'Idli' }], print_jobs: [] };
    const Model = fakeModel();
    await shadow.recordExpected([sale], { branchId: BRANCH }, { Model });

    expect(Model.calls.updateOne).toHaveLength(1);
    expect(Model.calls.updateOne[0].where.ticket_key).toBe(
      kotFallbackKey(sale, { cancelled: false })
    );
  });

  test('a cancellation is recorded as a cancellation', async () => {
    const sale = { _id: SALE, sale_process: 'Cancelled KOT', items: [], print_jobs: [] };
    const Model = fakeModel();
    await shadow.recordExpected([sale], { branchId: BRANCH }, { Model });
    expect(Model.calls.updateOne[0].where.ticket_key).toBe(
      kotFallbackKey(sale, { cancelled: true })
    );
  });

  test('a sale that is neither a KOT nor a cancellation is not recorded', async () => {
    const Model = fakeModel();
    await shadow.recordExpected(
      [{ _id: SALE, sale_process: 'SALE', print_jobs: [] }],
      { branchId: BRANCH },
      { Model }
    );
    expect(Model.calls.updateOne).toHaveLength(0);
  });

  test('EVERY POLL WRITES ONE ROW, not one per poll', async () => {
    /*
     * The same sale comes back on every poll until the till reports it. Upsert
     * by ticket name rather than read-then-write, because two tills polling at
     * once would both read "absent" and both insert.
     */
    const Model = fakeModel();
    const sale = aSale();
    await shadow.recordExpected([sale], { branchId: BRANCH }, { Model });
    await shadow.recordExpected([sale], { branchId: BRANCH }, { Model });

    expect(Model.calls.updateOne[0].opts.upsert).toBe(true);
    expect(Model.calls.updateOne[0].update.$setOnInsert).toBeDefined();
    expect(Model.calls.updateOne[0].update.$set).toBeUndefined();
    expect(Model.calls.updateOne[0].where.ticket_key).toBe(
      Model.calls.updateOne[1].where.ticket_key
    );
  });

  test('an amended order is a second row, because it is a second ticket', async () => {
    const at = new Date(1757800000000);
    const first = aSale({ print_jobs: [{ type: 'KOT', timestamp: at, items: [{ n: 'Idli' }] }] });
    const second = aSale({
      print_jobs: [{ type: 'KOT', timestamp: at, items: [{ n: 'Idli' }, { n: 'Naan' }] }],
    });
    const Model = fakeModel();
    await shadow.recordExpected([first, second], { branchId: BRANCH }, { Model });
    expect(Model.calls.updateOne[0].where.ticket_key).not.toBe(
      Model.calls.updateOne[1].where.ticket_key
    );
  });
});

describe('closing a row when the till reports', () => {
  test('by ticket name when the till sent them', async () => {
    const Model = fakeModel();
    const res = await shadow.markShadowPrinted(['SB1:kot:abc'], { branchId: BRANCH }, { Model });

    expect(res.data.by).toBe('key');
    expect(Model.calls.updateMany[0].where.ticket_key.$in).toEqual(['SB1:kot:abc']);
    expect(Model.calls.updateMany[0].where.status).toBe('shadow');
  });

  test('AND BY SALE WHEN AN OLDER TILL SENT NONE', async () => {
    /*
     * Ticket names are new on the wire. Closing only by key would leave every
     * row from every till on an older build open for ever, and the first report
     * would say the whole estate is failing - worthless exactly when it is
     * meant to establish a baseline.
     */
    const Model = fakeModel();
    const res = await shadow.markShadowPrinted(
      [],
      { branchId: BRANCH, saleIds: [SALE] },
      { Model }
    );

    expect(res.data.by).toBe('sale');
    expect(Model.calls.updateMany[0].where.sale_id.$in).toHaveLength(1);
  });

  test('it only ever closes shadow rows, never a real print job', async () => {
    const Model = fakeModel();
    await shadow.markShadowPrinted(['SB1:kot:abc'], { branchId: BRANCH }, { Model });
    await shadow.markShadowPrinted([], { branchId: BRANCH, saleIds: [SALE] }, { Model });
    for (const call of Model.calls.updateMany) expect(call.where.status).toBe('shadow');
  });

  test('nothing to go on closes nothing', async () => {
    const Model = fakeModel();
    const res = await shadow.markShadowPrinted([], { branchId: BRANCH, saleIds: [] }, { Model });
    expect(res.data.closed).toBe(0);
    expect(Model.calls.updateMany).toHaveLength(0);
  });
});

describe('reading the disagreement', () => {
  test('a ticket being printed RIGHT NOW is not called a disagreement', async () => {
    /* Without the age window every poll would report its own fresh rows as
       failures, which is a measurement that reports its own shadow. */
    const Model = fakeModel();
    await shadow.disagreements({ branchId: BRANCH }, { Model });
    const where = Model.calls.find[0];
    expect(where.status).toBe('shadow');
    expect(where.created_at.$lt).toBeInstanceOf(Date);
    expect(Date.now() - where.created_at.$lt.getTime()).toBeGreaterThanOrEqual(60 * 1000);
  });

  test('without a branch it answers empty rather than every shop', async () => {
    const Model = fakeModel({ rows: [{ _id: 'x' }] });
    const res = await shadow.disagreements({}, { Model });
    expect(res.data).toEqual([]);
  });
});

describe('it is a bystander', () => {
  test('A BROKEN SHADOW NEVER FAILS THE PRINTING PATH', async () => {
    /*
     * It runs inside multiKitchenPrint, which feeds every kitchen. A shadow
     * that breaks a service is worse than no shadow at all.
     */
    const exploding = {
      updateOne: () => Promise.reject(new Error('database is gone')),
      updateMany: () => Promise.reject(new Error('database is gone')),
      find: () => {
        throw new Error('database is gone');
      },
    };
    await expect(
      shadow.recordExpected([aSale()], { branchId: BRANCH }, { Model: exploding })
    ).resolves.toMatchObject({ status: true });
    await expect(
      shadow.markShadowPrinted(['k'], { branchId: BRANCH }, { Model: exploding })
    ).resolves.toMatchObject({ status: true });
    await expect(
      shadow.disagreements({ branchId: BRANCH }, { Model: exploding })
    ).resolves.toMatchObject({ status: true, data: [] });
  });

  test('and nothing to record is not an error', async () => {
    const Model = fakeModel();
    await expect(shadow.recordExpected([], { branchId: BRANCH }, { Model })).resolves.toMatchObject(
      { status: true }
    );
    expect(Model.calls.updateOne).toHaveLength(0);
  });
});
