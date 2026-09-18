'use strict';

/*
 * A CANCELLATION THAT DID NOT PRINT, AND ONE THAT PRINTED LATE.
 *
 * Owner: "sometime cancel not getting printed. what would be reason. or
 * printing after few minutes."
 *
 * Both, and they are the same event seen twice: a printer that was busy,
 * asleep, out of paper or switched off for a moment.
 *
 * NOT PRINTED. The ticket was written down before the paper - right, and
 * unchanged, because a till that dies must not reprint. But the same
 * record also closed the door on a ticket whose printer had simply
 * ANSWERED NO, which is a different thing entirely: nothing came out, we
 * know nothing came out, and there is no paper to duplicate. Worse,
 * markKitchenPrinted reported the sale id whatever happened, so the
 * server stopped offering it too. Two locks and no key, and the failure
 * was silent - on a cancellation that means a kitchen carries on cooking.
 *
 * PRINTED LATE. The next poll was scheduled when the last one FINISHED,
 * so the gap was thirty seconds plus however long the printing took. A
 * printer that is off answers in twenty (JOB_TIMEOUT_MS), and the helper
 * is then killed and restarted, which costs up to eight more on the next
 * ticket. A handful of those and the following poll is minutes away, with
 * everything raised in the meantime behind it. And a nudge arriving
 * mid-pass started a SECOND pass over the same tickets, doubling the work
 * at the worst possible moment.
 *
 * Driven end to end - a stubbed server, a printer that can be told to
 * refuse - because every one of these faults is invisible in the source.
 * The constructor has claimed for months that the poll underneath
 * "recovers a ticket that failed to print". It could not. A text search
 * would have found the promise and called it the fix.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const ledger = require(path.join(ROOT, 'src', 'print-ledger.js'));

/* KOTManager reaches for electron at load. A BrowserWindow here would mean the
   ticket fell back to the slow HTML path, which is a failure of its own. */
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      BrowserWindow: class { constructor() { throw new Error('the window path was used'); } },
      app: { getPath: () => os.tmpdir() },
    };
  }
  return load.call(this, request, ...rest);
};
const KOTManager = require(path.join(ROOT, 'src', 'kot-manager.js'));
Module._load = load;

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-cancel-'));

/* One cancelled dish on table six, shaped the way multiKitchenPrint sends it. */
function cancelledSale(id = '68c0000000000000000000a1') {
  return {
    _id: id,
    sales_id: 'SB-77',
    sale_process: 'cancelled',
    table_number: '6',
    dine_type: 'Dine-in',
    created_date: new Date().toISOString(),
    print_jobs: [
      {
        type: 'cancel',
        timestamp: new Date().toISOString(),
        change_index: 2,
        items: [{ item_id: 'i1', item_name: 'Chicken Biryani', item_quantity: 2, process: 'cancel' }],
      },
    ],
    new_last_printed_change_index: 1,
    items: [{ item_id: 'i1', item_name: 'Chicken Biryani', item_quantity: 2 }],
  };
}

/**
 * A till with a stubbed server and a printer that can be told to refuse.
 */
function rig({ printerWorks = true } = {}) {
  const dir = fresh();
  const sent = [];
  const marked = [];

  const hardware = {
    sendRawToPrinter: async (name, bytes, label) => {
      sent.push({ name, label, bytes: bytes && bytes.length });
      return printerWorks
        ? { success: true }
        : { success: false, error: 'The printer did not answer in time' };
    },
  };

  const manager = new KOTManager({ hardware });
  /* After the constructor, which points the ledger at the real userData. */
  ledger.setDir(dir);

  manager.config = {
    branchId: 'b1',
    printerNames: ['Kitchen'],
    printers: [{ name: 'Kitchen', pageSize: '80mm', copies: 1 }],
    pageSize: '80mm',
  };
  manager.isPolling = true;

  let pending = [cancelledSale()];

  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (String(url).includes('multiKitchenPrint')) {
      return { ok: true, status: 200, json: async () => ({ status: true, message: 'ok', data: pending }) };
    }
    if (String(url).includes('markKitchenPrinted')) {
      marked.push(body);
      /* What the real server does: stop offering what was reported. */
      pending = pending.filter((s) => !(body.saleIds || []).includes(String(s._id)));
      return { ok: true, status: 200, json: async () => ({ status: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  return {
    manager,
    sent,
    marked,
    setPrinter: (works) => { printerWorks = works; },
    stillOffered: () => pending.length,
    done: () => { global.fetch = realFetch; },
  };
}

test('a cancellation whose printer refused is NOT reported as printed', async () => {
  /*
   * The bug, exactly. markKitchenPrinted pushed the sale id whatever happened,
   * so the one thing that stops the server offering a ticket again was told
   * "done" about a ticket that never reached paper. Between that and the
   * ledger refusing a second attempt, a failed cancellation had two locks on
   * it and no key: the kitchen carried on cooking a dish nobody wanted.
   */
  const r = rig({ printerWorks: false });
  try {
    await r.manager._pollOnce();

    assert.strictEqual(r.sent.length, 1, 'it never tried to print at all');
    assert.deepStrictEqual(r.marked, [],
      'the server was told a cancellation printed when nothing came out');
    assert.strictEqual(r.stillOffered(), 1, 'the ticket has left the queue for good');
  } finally { r.done(); }
});

test('AND IT COMES BACK on the next poll, and prints', async () => {
  /*
   * The half that matters. Refusing to report it is only useful if the ticket
   * is actually tried again - the ledger used to refuse any key it had seen,
   * settled or not, so the sale came back and was skipped in silence.
   */
  const r = rig({ printerWorks: false });
  try {
    await r.manager._pollOnce();
    assert.strictEqual(r.sent.length, 1);

    r.setPrinter(true);                       // somebody put paper in
    await r.manager._pollOnce();

    assert.strictEqual(r.sent.length, 2, 'the cancellation was never tried again');
    assert.strictEqual(r.marked.length, 1, 'a ticket that printed was not reported');
    assert.ok(r.marked[0].saleIds.includes('68c0000000000000000000a1'));
    assert.ok(r.marked[0].printedKeys.length > 0, 'the printed ticket was not named');
  } finally { r.done(); }
});

test('it gives up rather than printing for ever at a printer that is off', async () => {
  const r = rig({ printerWorks: false });
  try {
    for (let i = 0; i < 8; i += 1) {
      /* eslint-disable-next-line no-await-in-loop */
      await r.manager._pollOnce();
      if (r.stillOffered() === 0) break;
    }
    assert.strictEqual(r.sent.length, ledger.MAX_ATTEMPTS,
      'the number of attempts against a dead printer is not bounded');
    assert.strictEqual(r.stillOffered(), 0,
      'a ticket with no tries left still sits in the queue, so every poll re-fetches it');
  } finally { r.done(); }
});

test('a ticket that printed first time is still printed exactly once', async () => {
  /* The regression this must not cause. */
  const r = rig({ printerWorks: true });
  try {
    await r.manager._pollOnce();
    await r.manager._pollOnce();
    assert.strictEqual(r.sent.length, 1, 'a cancellation printed twice');
  } finally { r.done(); }
});

/* ------------------------------------------------------- and the clock --- */

test('the next poll is measured from when this one STARTED', async () => {
  /*
   * Owner: "or printing after few minutes."
   *
   * The next poll used to be scheduled after the printing finished, so the gap
   * was thirty seconds PLUS however long the printer took. A printer that is
   * off answers in twenty (raw-print-service JOB_TIMEOUT_MS) and the helper is
   * killed and restarted after it, so a handful of tickets against a sleeping
   * printer pushed the next poll minutes out - and every ticket raised in the
   * meantime waited behind it.
   */
  const r = rig({ printerWorks: true });
  try {
    const waits = [];
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { waits.push(ms); return realTimeout(() => {}, 0); };

    r.manager._scheduleNextPoll(Date.now() - 25000);     // a pass that took 25s
    global.setTimeout = realTimeout;

    assert.strictEqual(waits.length, 1);
    assert.ok(waits[0] <= 6000,
      'a slow pass is still added to the interval instead of eating into it, waited ' + waits[0]);
    assert.ok(waits[0] >= 1000, 'there is no floor, so a slow till would spin');
  } finally { r.done(); }
});

test('a pass that overran the interval waits the floor, not zero', () => {
  const r = rig({ printerWorks: true });
  try {
    const waits = [];
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { waits.push(ms); return realTimeout(() => {}, 0); };

    r.manager._scheduleNextPoll(Date.now() - 600000);    // ten minutes
    global.setTimeout = realTimeout;

    assert.strictEqual(waits[0], 1000,
      'a pass longer than the interval turns into a tight loop against a struggling printer');
  } finally { r.done(); }
});

test('a nudge during a pass takes a note instead of starting a second one', async () => {
  /*
   * _onKotEvent clears the scheduled timer before polling, but a pass that is
   * mid-print has no timer to clear - so the guard guarded nothing and two
   * passes ran over the same tickets and the same printer queue. Nothing
   * printed twice, because the ledger holds that line, but the work doubled at
   * exactly the wrong moment.
   */
  const r = rig({ printerWorks: true });
  try {
    r.manager._passRunning = true;
    await r.manager._poll();
    assert.strictEqual(r.sent.length, 0, 'a second pass ran on top of the first');
    assert.strictEqual(r.manager._pollAgain, true, 'the nudge was dropped instead of noted');
  } finally { r.done(); }
});

test('the note is honoured as soon as the pass ends, not thirty seconds later', () => {
  const r = rig({ printerWorks: true });
  try {
    const waits = [];
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { waits.push(ms); return realTimeout(() => {}, 0); };

    r.manager._pollAgain = true;
    r.manager._scheduleNextPoll(Date.now());
    global.setTimeout = realTimeout;

    assert.ok(waits[0] <= 1000, 'a ticket that arrived mid-pass waits for the next interval');
    assert.strictEqual(r.manager._pollAgain, false, 'the note was not cleared, so it would loop');
  } finally { r.done(); }
});
