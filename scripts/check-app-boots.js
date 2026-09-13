#!/usr/bin/env node
'use strict';
/*
 * The packaged application must actually start.
 *
 * Every test suite passed on the build that shipped a duplicate
 * `ipcMain.handle`. Electron refuses the second registration by throwing, the
 * throw landed inside the boot chain, and setup stopped part-way: the window
 * sat on "Starting services" forever with nothing on it to say why. The only
 * evidence was one FATAL line in app.log, in AppData, which nobody reads until
 * somebody complains.
 *
 * Unit tests cannot see that. They import modules; they never boot the thing.
 * check-native-runtime.js already walks the packaged app for a different class
 * of failure that only appears once it is packaged - this is the same idea,
 * one step further: start it and wait for it to answer.
 *
 *   node scripts/check-app-boots.js [dist/win-unpacked]
 *
 * WHAT COUNTS AS BOOTED. The API the app serves on its own port. That is the
 * last thing to come up and everything before it has to have worked, so one
 * successful response proves the whole chain: MongoDB started, the API
 * process started, and main.js got far enough to wait for it. In the failure
 * above it never got there.
 *
 * Exits 0 when it answers, 1 with the reason when it does not.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked');
const exe = path.join(target, 'Posnic.exe');

/* Long enough for a cold first boot on a slow machine - MongoDB has to create
   its data directory - and short enough that a hang is still a failed build
   rather than a hung job. */
const BOOT_TIMEOUT_MS = Number(process.env.POSNIC_BOOT_TIMEOUT_MS || 180_000);
const PORT = Number(process.env.POSNIC_APP_PORT || 5555);

const logPath = path.join(os.homedir(), 'AppData', 'Roaming', 'posnic', 'app.log');

const say = (m) => console.log(m);
/*
 * WHATEVER THE APPLICATION MANAGED TO SAY, printed with the failure.
 *
 * "exited with code 134" is a fact and not a reason, and on a CI runner the
 * log it would have been in is thrown away with the machine. A build that
 * fails here and takes its only evidence with it costs a whole round trip to
 * learn one line.
 *
 * Declared as a function rather than a const arrow so it can be used above
 * newLogLines without depending on the order the consts happen to be in.
 */
/*
 * Whatever the child printed, kept for `die` below.
 *
 * Declared up here rather than beside the spawn: `die` runs for failures that
 * happen before the spawn - no packaged application, for one - and `typeof` on
 * a `let` that has not been reached yet THROWS rather than answering
 * "undefined", so the diagnostic would have crashed instead of reporting.
 *
 * Capped, so an application looping on warnings cannot fill the runner.
 */
let said = '';
const keep = (chunk) => {
  said += chunk.toString();
  if (said.length > 16000) said = said.slice(-16000);
};

function die(m) {
  console.error(`\n  FAILED: ${m}\n`);
  const spoke = (typeof said === 'string' ? said : '').trim();
  if (spoke) {
    console.error('  What it printed before it stopped:');
    for (const line of spoke.split(/\r?\n/).slice(-40)) console.error(`    ${line}`);
    console.error('');
  }

  const tail = newLogLines().trim();
  if (tail) {
    console.error('  What the application logged during this run:');
    for (const line of tail.split(/\r?\n/).slice(-40)) console.error(`    ${line}`);
    console.error('');
  } else if (!spoke) {
    console.error(`  It printed nothing and logged nothing to ${logPath}.\n`);
  }
  process.exit(1);
}

if (!fs.existsSync(exe)) die(`no packaged application at ${exe}`);

/* Where the log already ends, so only THIS run's lines are read. A previous
   run's FATAL must not fail a build that is fine. */
let logFrom = 0;
try { logFrom = fs.statSync(logPath).size; } catch { /* first ever boot */ }

/* A function declaration, not a const arrow: `die` above calls this, and it
   runs for failures that happen before this line is reached. */
function newLogLines() {
  try {
    const fd = fs.openSync(logPath, 'r');
    const size = fs.statSync(logPath).size;
    if (size <= logFrom) { fs.closeSync(fd); return ''; }
    const buf = Buffer.alloc(size - logFrom);
    fs.readSync(fd, buf, 0, buf.length, logFrom);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/*
 * ANOTHER COPY ALREADY RUNNING IS NOT A FAILED BOOT.
 *
 * Posnic takes a single-instance lock. Start a second copy while one is open
 * and the new process exits 0 immediately, in silence - which is
 * indistinguishable from the silent non-start this script exists to catch, and
 * on a developer's machine it is by far the commoner of the two. It reported a
 * perfectly good build as broken within an hour of being written.
 *
 * CI never hits this; a person running it locally hits it constantly. So it is
 * detected and said plainly rather than guessed at either way.
 */
if (process.platform === 'win32') {
  try {
    const { execSync } = require('child_process');
    const out = execSync('tasklist /FI "IMAGENAME eq Posnic.exe" /NH', { encoding: 'utf8', timeout: 15000 });
    if (/Posnic\.exe/i.test(out)) {
      say('');
      say('  SKIPPED: Posnic is already running, and it holds the single-instance lock.');
      say('  A second copy exits immediately, which would read here as a failed boot.');
      say('  Close it and run this again.');
      say('');
      process.exit(0);
    }
  } catch (e) {
    /* tasklist missing or refused: carry on and let the boot speak for itself. */
  }
}

say(`  starting ${exe}`);
/*
 * PIPED, NOT IGNORED.
 *
 * A main process that dies before its own logger starts says why on stderr and
 * nowhere else, and `stdio: 'ignore'` throws that away - which left a build
 * failing with "exited with code 134" and no reason anywhere, on a runner that
 * is deleted a minute later.
 *
 * Kept to the last few kilobytes. An application that loops printing warnings
 * must not be able to fill the runner's memory through this.
 */
/*
 * ELECTRON_RUN_AS_NODE IS REMOVED, NOT BLANKED.
 *
 * Electron tests whether the variable is PRESENT, not what it says. Setting it
 * to "" in a workflow still defines it on Windows, so Posnic.exe started as
 * plain Node, hit
 *
 *   Assertion failed: (isolate_data->snapshot_data()) != nullptr
 *
 * and aborted with 134 before it could log a thing - and this script reported
 * a perfectly good build as an application that would not start. Two days of
 * "the till does not boot" were this line.
 *
 * Deleted here rather than only in the workflow, because the same leak comes
 * from a developer's shell and from the harness that runs this locally, and
 * the check has to be right wherever it is run from.
 */
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(exe, [], {
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: childEnv,
});
if (child.stdout) child.stdout.on('data', keep);
if (child.stderr) child.stderr.on('data', keep);

let done = false;
const finish = (code, message) => {
  if (done) return;
  done = true;
  try { child.kill(); } catch { /* already gone */ }
  /* Give it a moment to put its own shutdown in the log, then stop. */
  setTimeout(() => {
    if (code === 0) { say(`\n  ${message}\n`); process.exit(0); }
    die(message);
  }, 1500);
};

child.on('error', (e) => finish(1, `the application could not be started: ${e.message}`));
child.on('exit', (code) => {
  if (!done) {
    /*
     * Exiting 0 within seconds has two ordinary causes and neither is a broken
     * build. Naming them beats making somebody rediscover them.
     */
    const quick = Date.now() - started < 5000;
    const hint = quick && code === 0
      ? [
        '',
        '    Exiting 0 within seconds usually means one of two things:',
        '    ELECTRON_RUN_AS_NODE is set in this shell, which makes Posnic.exe',
        '    run as plain Node; or another copy holds the single-instance lock.',
      ].join('\n')
      : '';
    finish(1, `the application exited with code ${code} before its API answered${hint}`);
  }
});

const started = Date.now();

const ask = () => {
  if (done) return;

  /* A fatal is decisive and instant: no point waiting out the timeout for an
     application that has already told us it gave up. */
  const fatal = newLogLines().split(/\r?\n/).find((l) => /\[FATAL\]/.test(l));
  if (fatal) return finish(1, `the application logged a fatal error during boot:\n    ${fatal.trim().slice(0, 400)}`);

  if (Date.now() - started > BOOT_TIMEOUT_MS) {
    return finish(1,
      `the API never answered on port ${PORT} within ${Math.round(BOOT_TIMEOUT_MS / 1000)}s.\n` +
      `    That is what a till showing "Starting services" forever looks like.\n` +
      `    Log: ${logPath}`);
  }

  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api', timeout: 4000 }, (res) => {
    res.resume();
    /* 404 counts. The question is whether something is listening and routing,
       not whether /api itself is a page. */
    if (res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 401) {
      return finish(0, `the application booted and its API answered ${res.statusCode} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    setTimeout(ask, 1000);
  });
  req.on('timeout', () => { req.destroy(); setTimeout(ask, 1000); });
  req.on('error', () => setTimeout(ask, 1000));
};

setTimeout(ask, 2000);
