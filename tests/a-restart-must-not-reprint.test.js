'use strict';

/*
 * A restart must not reprint what already printed.
 *
 * THE BUG, EXACTLY.
 *
 * kot-manager kept its record of printed tickets in `new Set()`, which lives in
 * memory. The only other guard is the server's "marked printed" flag, and that
 * is written AFTER the paper, in a separate request, for the whole batch.
 *
 * Print six tickets, crash before the request, restart. The Set is empty and
 * the server still says unprinted. All six print again. The kitchen cooks
 * twelve dishes and nobody notices, because a cook prepares what arrives and
 * does not compare it with what arrived a minute ago.
 *
 * Owner: "dupliate prints should not be there its loss for company. people wont
 * care and keep preparing what receied. they dont compare usaully what
 * received. so very carefull on that."
 *
 * THE FIX IS DELIBERATELY SMALL. A durable record, written BEFORE the paper,
 * consulted before printing. It does not retry, does not decide anything else,
 * and does not change when the server is told. Printing behaves exactly as it
 * did except that a restart no longer reprints.
 *
 * Written before rather than after because the record has to survive the thing
 * it protects against, and that thing is dying halfway. The cost is that a
 * ticket lost to a crash stays lost until a person notices - the trade argued
 * in Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ARCHITECTURE.md, and the one the
 * owner asked for: a duplicate is silent and costs food, a miss is loud and
 * costs a reminder.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const ledger = require(path.join(ROOT, 'src', 'print-ledger.js'));

/* KOTManager reaches for electron at load. It never touches a window here. */
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

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-ledger-'));

/* --------------------------------------------------------------- the ledger */

test('the same ticket cannot be claimed twice', () => {
  ledger.setDir(fresh());
  const key = ledger.keyFor({ sale: 'SB-1', items: ['Fish Curry'] });
  assert.strictEqual(ledger.claim(key, { saleId: 'SB-1' }), true, 'the first claim was refused');
  assert.strictEqual(ledger.claim(key, { saleId: 'SB-1' }), false, 'it was claimed twice');
});

test('AND IT SURVIVES THE PROCESS DYING, which is the whole point', () => {
  /*
   * The in-memory Set passed the test above too. This is the one it failed.
   * setDir(dir) again is a new process as far as this module is concerned: the
   * cache is dropped and the file is all that is left.
   */
  const dir = fresh();
  ledger.setDir(dir);
  const key = ledger.keyFor({ sale: 'SB-2', items: ['Barbeque'] });
  assert.strictEqual(ledger.claim(key, { saleId: 'SB-2' }), true);

  ledger.setDir(dir);                                  // "restart"
  assert.strictEqual(ledger.claim(key, { saleId: 'SB-2' }), false,
    'after a restart the ticket would have printed a second time');
  assert.strictEqual(ledger.attempted(key), true);
});

test('the record is on disk before the caller can print', () => {
  /*
   * Written afterwards it would be useless exactly when it is needed, because
   * what it protects against is dying between the two.
   */
  const dir = fresh();
  ledger.setDir(dir);
  const key = ledger.keyFor({ sale: 'SB-3' });
  ledger.claim(key, { saleId: 'SB-3' });
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'print-ledger.json'), 'utf8'));
  assert.ok(onDisk.entries[key], 'the claim had not reached the disk');
  assert.strictEqual(onDisk.entries[key].state, 'attempted');
});

test('a different ticket for the same sale is a different ticket', () => {
  /* An amended order must be able to print. Keying on the sale alone would
     silence every amendment after the first. */
  ledger.setDir(fresh());
  const first = ledger.keyFor({ sale: 'SB-4', items: ['Fish Curry'] });
  const second = ledger.keyFor({ sale: 'SB-4', items: ['Fish Curry', 'Naan'] });
  assert.notStrictEqual(first, second);
  assert.strictEqual(ledger.claim(first, {}), true);
  assert.strictEqual(ledger.claim(second, {}), true, 'an amendment was refused');
});

test('the outcome is recorded, and nothing reads it to decide anything', () => {
  /* Measurement this area has never had. Nobody knows today whether duplicates
     happen four times a week or forty. */
  ledger.setDir(fresh());
  const ok = ledger.keyFor({ sale: 'A' });
  const bad = ledger.keyFor({ sale: 'B' });
  ledger.claim(ok, { saleId: 'A' });
  ledger.claim(bad, { saleId: 'B' });
  ledger.settle(ok, true);
  ledger.settle(bad, false, 'The printer refused the data');

  const s = ledger.summary();
  assert.strictEqual(s.attempted, 2);
  assert.strictEqual(s.printed, 1);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.unsettled, 0);
});

test('a claim that never settled is counted, because that is the case to look at', () => {
  /* Attempted and never settled means the till died between the record and the
     paper. That is the case that used to duplicate and now needs a person. */
  ledger.setDir(fresh());
  ledger.claim(ledger.keyFor({ sale: 'C' }), { saleId: 'C' });
  assert.strictEqual(ledger.summary().unsettled, 1);
});

test('a broken ledger file behaves like no ledger at all', () => {
  /*
   * The safe direction to fail in: an unreadable file leaves the behaviour we
   * already had, rather than refusing to print.
   */
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'print-ledger.json'), 'not json {{{');
  ledger.setDir(dir);
  assert.doesNotThrow(() => ledger.claim(ledger.keyFor({ sale: 'D' }), {}));
  assert.strictEqual(ledger.claim(ledger.keyFor({ sale: 'D2' }), {}), true);
});

test('a directory it cannot write to never throws', () => {
  /* A ledger problem must not become a printing problem. There is a customer
     standing there and the ticket matters more than the bookkeeping. */
  ledger.setDir('\0 not a directory');
  assert.doesNotThrow(() => {
    ledger.claim(ledger.keyFor({ sale: 'E' }), {});
    ledger.settle(ledger.keyFor({ sale: 'E' }), true);
    ledger.summary();
  });
});

test('it cannot grow without bound', () => {
  /* A ledger that filled a disk would be a worse bug than the one it prevents. */
  assert.ok(ledger.MAX_ENTRIES > 0 && ledger.MAX_ENTRIES <= 20000);
  assert.ok(ledger.KEEP_DAYS >= 1 && ledger.KEEP_DAYS <= 7);
});

/* ------------------------------------------------ and through kot-manager */

test('A SECOND RUN OF THE TILL DOES NOT REPRINT THE SAME TICKET', () => {
  /*
   * The regression, end to end. Two managers over one ledger directory is a
   * till that has been restarted. Before this existed, the second one printed
   * everything the first one had.
   */
  const dir = fresh();
  const hardware = { sendRawToPrinter: async () => ({ success: true }) };

  /* The constructor points the ledger at the app's own data directory, so the
     redirect has to come AFTER it or these tests write to the real one - which
     is how the first version of this test passed for the wrong reason. */
  const first = new KOTManager({ hardware });
  ledger.setDir(dir);
  const key = 'SB-9:kot:abc123';
  assert.strictEqual(first._claimForPrint(key, { saleId: 'SB-9' }), true,
    'the first run refused to print a new ticket');

  const second = new KOTManager({ hardware });          // the restart
  ledger.setDir(dir);
  assert.strictEqual(second._claimForPrint(key, { saleId: 'SB-9' }), false,
    'the restarted till would have printed it again');
});

test('a ticket it has never seen still prints after a restart', () => {
  /* The other half. A guard that refuses everything would also pass the test
     above, and would be a far worse bug. */
  const dir = fresh();
  const a = new KOTManager({ hardware: { sendRawToPrinter: async () => ({ success: true }) } });
  ledger.setDir(dir);
  assert.strictEqual(a._claimForPrint('SB-10:kot:aaa', { saleId: 'SB-10' }), true);

  const b = new KOTManager({ hardware: { sendRawToPrinter: async () => ({ success: true }) } });
  ledger.setDir(dir);
  assert.strictEqual(b._claimForPrint('SB-11:kot:bbb', { saleId: 'SB-11' }), true,
    'a ticket that has never printed was refused');
});

/* ----------------------------------------------------------- what it is not */

test('it is written down BEFORE the paper, in both print paths', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  for (const block of [
    src.slice(src.indexOf('const jobResults'), src.indexOf('printedSaleIds.push(saleId);')),
    src.slice(src.indexOf('const results = await this.silentPrint')),
  ]) {
    assert.ok(block.length, 'a print path has moved; check this test still covers it');
  }
  /* The claim must precede the print in the source, in both places. */
  const jobClaim = src.indexOf('_claimForPrint(jobKey');
  const jobPrint = src.indexOf('const jobResults = await this.silentPrint');
  assert.ok(jobClaim > -1 && jobClaim < jobPrint, 'the job path prints before it records');

  const saleClaim = src.indexOf('_claimForPrint(key,');
  const salePrint = src.indexOf('const results = await this.silentPrint');
  assert.ok(saleClaim > -1 && saleClaim < salePrint, 'the sale path prints before it records');
});

test('nothing here retries a failed print', () => {
  /*
   * The instinct on a failed print is to try again, and that instinct is what
   * prints twice: "failed" and "succeeded but the reply was lost" are
   * indistinguishable from the till. Retrying is Stage 2 and a real decision.
   */
  /*
   * Checked as a MECHANISM, not as a word. The file's own comments say "does
   * not retry", and a text search cannot tell a promise from a breach - the
   * first version of this test failed on the promise.
   */
  assert.deepStrictEqual(
    Object.keys(ledger).filter((k) => /retry|again|resend|reprint/i.test(k)),
    [],
    'the ledger has grown a retry in its API'
  );
  const src = fs.readFileSync(path.join(ROOT, 'src', 'print-ledger.js'), 'utf8');
  assert.ok(!/setTimeout|setInterval/.test(src), 'the ledger has grown a timer');
  /* And the print path never reads an outcome back to decide anything. */
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.ok(!/printLedger\.summary/.test(kot),
    'the print path has started reading outcomes to make a decision');
});

test('the module is in the packaged build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/print-ledger.js'));
});
