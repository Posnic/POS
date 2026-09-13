'use strict';

/*
 * One PowerShell, kept warm, instead of one per copy of every receipt.
 *
 * Owner: "receipt prniter is direct connection right, why its not fired
 * immediately... every seconds counts here. so give proper solution."
 *
 * Measured on a real Windows till before this:
 *
 *   powershell -File, trivial script       546 ms
 *   powershell -File, the real print script 350-550 ms   <- paid PER COPY
 *   cmd.exe, which cannot call winspool      18 ms
 *   this helper, once warm                    1-2 ms
 *
 * Most of the cost is not the shell, it is Add-Type compiling the C# interop
 * class on every run. Started once, it compiles once.
 *
 * The functional half only runs on Windows, because that is the only platform
 * with a spooler to talk to; mac and Linux go to `lp`, which starts in
 * milliseconds and needs nothing kept warm.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HW = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const SVC = fs.readFileSync(path.join(ROOT, 'src', 'raw-print-service.js'), 'utf8');

const onWindows = process.platform === 'win32';

test('the raw print path tries the warm helper before starting a process', () => {
  const send = HW.slice(HW.indexOf('async sendRawToPrinter('), HW.indexOf('_sendRawViaCups(printerName, buffer, docName) {'));
  assert.match(send, /const warm = await rawPrintService\.send\(\{ printer: printerName, file: tmpBin, doc: docName \}\);/,
    'the helper is not asked');
  /* And it is asked BEFORE the old spawn, or it saves nothing. */
  assert.ok(
    send.indexOf('rawPrintService.send(') < send.indexOf('execSync('),
    'the per-job spawn still runs first'
  );
});

test('a helper that cannot be used falls back instead of failing the receipt', () => {
  const send = HW.slice(HW.indexOf('async sendRawToPrinter('), HW.indexOf('_sendRawViaCups(printerName, buffer, docName) {'));
  assert.match(send, /if \(!warm\.unavailable\) \{/, 'an unusable helper is treated as a printer fault');
  assert.match(send, /execSync\(/, 'the fallback spawn is gone, so a broken helper means no receipt');
  assert.match(SVC, /unavailable: true/, 'the service cannot say it is unusable');
  /* A real printer failure must NOT fall back and print twice. */
  assert.match(send, /if \(warm\.success\) return \{ success: true, bytes: buffer\.length \};\s*return \{ success: false/,
    'a refused print falls through to the spawn and prints the receipt twice');
});

test('it is started at boot, so the first receipt does not pay for it', () => {
  assert.match(MAIN, /require\('\.\/raw-print-service'\)\.warm\(\)/, 'nothing warms the helper');
  assert.ok(
    MAIN.indexOf("require('./raw-print-service').warm()") < MAIN.indexOf('billManager.start();'),
    'the helper is warmed after the pollers that will use it'
  );
});

test('it gives up rather than hanging, and lets go when the counter is quiet', () => {
  assert.match(SVC, /const JOB_TIMEOUT_MS = 20000;/, 'a wedged spooler would hang the print forever');
  assert.match(SVC, /const IDLE_SHUTDOWN_MS = 10 \* 60 \* 1000;/, 'a closed shop holds a PowerShell open all night');
  assert.match(SVC, /this\.child\.kill\(\);[\s\S]{0,200}The printer did not answer in time/,
    'a job that never comes back leaves the helper wedged for the next one');
  /* Every reply carries its own id, so a slow job cannot be mistaken for the
     next one's answer. */
  assert.match(SVC, /const waiting = this\.pending\.get\(String\(id\)\);/);
});

test('the helper starts, answers, and is fast once warm', { skip: !onWindows && 'Windows only: there is no spooler to talk to' }, async () => {
  const service = require(path.join(ROOT, 'src', 'raw-print-service.js'));
  const file = path.join(os.tmpdir(), `posnic-print-test-${process.pid}.bin`);
  fs.writeFileSync(file, Buffer.from('\x1b@test\n\n\n'));
  try {
    assert.strictEqual(await service.warm(), true, 'the helper would not start');

    /* A printer that does not exist proves the whole round trip: the job was
       parsed, the spooler was asked, and the answer came back addressed to
       this job. It must be a refusal, not a crash and not a hang. */
    const answer = await service.send({ printer: 'No Such Printer 9x', file, doc: 'Test' });
    assert.strictEqual(answer.success, false);
    assert.ok(!answer.unavailable, 'a live helper reported itself unusable');
    assert.match(String(answer.error), /printer/i, 'the refusal does not say what went wrong');

    const started = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await service.send({ printer: 'No Such Printer 9x', file, doc: 'Test' });
    }
    const each = (Date.now() - started) / 3;
    assert.ok(each < 150, `a warm job took ${Math.round(each)} ms; the spawn it replaced took about 400`);
  } finally {
    service.stop();
    try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
  }
});

test('it is in the packaged build, or printing breaks only after install', () => {
  /*
   * build.files is an explicit allowlist. A module left out of it works all
   * the way through development and CI and then throws "Cannot find module"
   * the first time a customer prints - the failure landing on their counter
   * rather than in our tests. That has happened here before, to
   * printer-targets.js, and it is the reason this test exists.
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/raw-print-service.js'),
    'the print helper is not shipped; the installer will throw on the first receipt');
});
