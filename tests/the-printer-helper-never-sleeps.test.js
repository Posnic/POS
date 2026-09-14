'use strict';

/*
 * The print helper never sleeps, and never lies about having printed.
 *
 * TWO FAULTS, FOUND THE SAME EVENING, ON A LIVE SHOP.
 *
 * Owner: "i saw log printed in the kot print logs. but didnt print... also if i
 * give kot order from desktop app its printing immediate. may be check print
 * process is sleeping. when active its printing ??? ... after i give print from
 * desktop if i give order from mobile then it was working."
 *
 * He named both of them before the code was read.
 *
 * THE FIRST: the resident helper talks to winspool, and every return value
 * except OpenPrinter and StartDocPrinter was piped to Out-Null. StartPage,
 * Write, EndPage and EndDoc could all fail and the helper still answered OK, so
 * the ticket went into the day's log as printed and no paper came out. That is
 * the worst way for a printer to fail: the one place anybody would look says it
 * worked. The count of bytes written was never compared to the count sent
 * either, so a short write was a silent one.
 *
 * THE SECOND: the helper shut itself down after ten minutes with nothing to
 * print, to avoid holding a PowerShell open on a till closed for the night.
 * Ten minutes is shorter than a quiet afternoon. The shop goes half an hour
 * without an order, the helper stops, and the next ticket - the one somebody is
 * standing and waiting for - pays the spawn and the C# compile again. Printing
 * from the till woke it, which is why every handset order after that was
 * instant.
 *
 * Owner, on being shown it: "i want always awake. i dont want idel stuff. coz
 * whenever order came then it should print."
 *
 * So it stays up for as long as the app does, restarts itself without waiting
 * for the next ticket to discover it is gone, and proves it can still answer.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVC_PATH = path.join(ROOT, 'src', 'raw-print-service.js');
const SVC = fs.readFileSync(SVC_PATH, 'utf8');
const service = require(SVC_PATH);
const onWindows = process.platform === 'win32';

/* ------------------------------------------------- it never reports a lie */

test('every winspool call is checked, not thrown away', () => {
  /*
   * The exact shape of the bug. `| Out-Null` on a call whose answer is the only
   * evidence the print happened is how a failed write became a logged success.
   */
  for (const call of ['StartPagePrinter', 'WritePrinter', 'EndPagePrinter', 'EndDocPrinter']) {
    const line = SVC.split('\n').find((l) => l.includes(`::${call}(`) && l.includes('$hPrinter'));
    assert.ok(line, call + ' is no longer called at all');
    assert.ok(!/\|\s*Out-Null/.test(line), call + ' has its answer thrown away again');
  }
});

test('a short write is a failure, not a success', () => {
  /* WritePrinter can return true having taken fewer bytes than it was given.
     Nothing on the roll says so. */
  assert.match(SVC, /\$w -ne \$bytes\.Length/, 'the bytes written are not compared to the bytes sent');
  assert.match(SVC, /Only \$w of \$\(\$bytes\.Length\) bytes reached the printer/);
});

test('OK is written on exactly one path, and it is the good one', () => {
  const okLines = SVC.split('\n').filter((l) => /WriteLine\("OK \$id"\)/.test(l));
  /* One for a finished print, one for the heartbeat that never touches a
     printer. Any more means a failure path answers OK again. */
  assert.strictEqual(okLines.length, 2, 'OK is written from ' + okLines.length + ' places');
});

test('each failure says which step failed, because they need different answers', () => {
  /* "Printing failed" sends a shopkeeper to check the paper when the printer is
     switched off, and to check the cable when the spooler refused the job. */
  for (const said of [
    /The printer refused the page/,
    /The printer refused the data \(win32 \$code\)/,
    /The printer did not close the job/,
    /Could not open printer \(win32 \$code\)/,
    /StartDocPrinter failed/,
  ]) assert.match(SVC, said);
});

/* --------------------------------------------------------- it never sleeps */

test('there is no idle shutdown left anywhere', () => {
  /* The owner's words: "i want always awake. i dont want idel stuff." */
  assert.ok(!/IDLE_SHUTDOWN_MS/.test(SVC), 'the idle shutdown is back');
  assert.ok(!/_touchIdle/.test(SVC), 'something still arms an idle timer');
  assert.ok(!/idleTimer/.test(SVC));
  assert.strictEqual(service.IDLE_SHUTDOWN_MS, undefined, 'it is still exported');
});

test('a helper that dies is brought back without waiting for the next ticket', () => {
  /*
   * This is what makes it "always awake" rather than "restarted on demand".
   * Restarting when the next print arrives still makes THAT print pay for it,
   * and that print is the one somebody is waiting on.
   */
  assert.match(SVC, /if \(!this\.stopped\) this\._scheduleRestart\(\);/);
  assert.ok(Array.isArray(service.RESTART_DELAYS_MS) && service.RESTART_DELAYS_MS.length > 1);
  assert.ok(service.RESTART_DELAYS_MS[0] <= 500, 'the first retry is slow enough to be noticed');
  assert.ok(service.RESTART_DELAYS_MS[service.RESTART_DELAYS_MS.length - 1] >= 10000,
    'a machine where PowerShell cannot run would be hammered');
});

test('only a deliberate stop keeps it down', () => {
  /* Otherwise quitting the app and a crash look the same, and one of them must
     come back. */
  assert.match(SVC, /stop\(\) \{\s*\n\s*this\.stopped = true;/);
  assert.match(SVC, /warm\(\) \{[\s\S]{0,200}this\.stopped = false;/);
});

test('a heartbeat proves it can still answer, and costs no paper', () => {
  /* A wedged PowerShell is alive and deaf, and from outside that looks exactly
     like one waiting for work. */
  assert.ok(service.HEARTBEAT_MS > 0 && service.HEARTBEAT_MS <= 5 * 60 * 1000);
  assert.match(SVC, /if \(\$job\.ping\) \{ \[Console\]::Out\.WriteLine\("OK \$id"\)/,
    'the ping opens a printer, so proving liveness wastes a receipt');
  assert.match(SVC, /if \(!this\.child \|\| this\.pending\.size\) return;/,
    'the heartbeat fires while a real print is in flight');
});

test('a job that answers clears the crash backoff', () => {
  /* A bad spell in the morning must not make the evening slow to recover. */
  assert.match(SVC, /this\.restarts = 0;/);
});

test('it is still started before the first sale', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/raw-print-service'\)\.warm\(\)/, 'nothing warms the helper');
});

test('it is in the packaged build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/raw-print-service.js'));
});

/* ------------------------------------------------ and it does all this live */

test('it starts, answers a ping, and comes back from being killed', {
  skip: !onWindows && 'Windows only: there is no winspool to talk to',
}, async () => {
  const { RawPrintService } = service;
  const svc = new RawPrintService();
  try {
    assert.strictEqual(await svc.warm(), true, 'the helper would not start');

    const first = await svc.send({ ping: true });
    assert.strictEqual(first.success, true, 'a warm helper did not answer a ping');

    /* Kill it the way a crash would, and let its own restart bring it back.
       Nothing here asks it to print: that is the point. */
    const killed = svc.child;
    assert.ok(killed, 'there is no child to kill');
    killed.kill();

    const backAt = Date.now();
    let alive = false;
    while (Date.now() - backAt < 15000) {
      /* eslint-disable-next-line no-await-in-loop -- polling for a restart */
      await new Promise((r) => setTimeout(r, 250));
      if (svc.child && svc.child !== killed) { alive = true; break; }
    }
    assert.ok(alive, 'the helper did not restart itself within 15s');

    const after = await svc.send({ ping: true });
    assert.strictEqual(after.success, true, 'the restarted helper does not answer');
  } finally {
    svc.stop();
  }
});

test('a print to a printer that is not there fails, and says so', {
  skip: !onWindows && 'Windows only: there is no winspool to talk to',
}, async () => {
  /*
   * The regression that matters. Before the return values were checked, this
   * came back success and the day's log recorded a print that never happened.
   */
  const { RawPrintService } = service;
  const svc = new RawPrintService();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-print-test-'));
  const file = path.join(dir, 'job.bin');
  fs.writeFileSync(file, Buffer.from('hello', 'latin1'));
  try {
    await svc.warm();
    const res = await svc.send({ printer: 'Posnic No Such Printer 9f3a', file, doc: 'test' });
    assert.strictEqual(res.success, false, 'printing to a printer that does not exist reported success');
    assert.match(String(res.error), /Could not open printer|refused|not answer/);
  } finally {
    svc.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
});
