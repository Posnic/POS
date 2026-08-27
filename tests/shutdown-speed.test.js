/*
 * Why closing Posnic took ten seconds.
 *
 * The shutdown log said this, on a real installed machine:
 *
 *   16:49:25.162  Stopping bundled MongoDB (clean shutdown)...
 *   16:49:35.295  MongoDB did not exit in time - terminating
 *   16:49:35.674  MongoDB stopped cleanly
 *
 * Every other step of the shutdown - the scheduler, the sync agent, the API
 * server, the mongoose connection - totalled eleven milliseconds. The database
 * took 10,513, which is the ten second timeout expiring in full followed by a
 * kill. And the line after it still said "stopped cleanly".
 *
 * The cause was two ordinary-looking lines a long way apart:
 *
 *   1. stop() read .mongodb-credentials.json with JSON.parse and used its
 *      `uri`. The password is encrypted at rest, so that URI deliberately
 *      contains no credentials - credentials-store rebuilds it on read, after
 *      decrypting. So the shutdown command was sent anonymously to a mongod
 *      started with --auth.
 *
 *   2. The refusal was caught by `.catch(() => {})`, written for the genuine
 *      case that the server drops the connection while shutting down. An
 *      authorisation failure and a successful shutdown were indistinguishable.
 *
 * So it never was a clean shutdown. It was a hard kill with a ten second pause
 * in front of it, and a journal to replay on the next start - which is also
 * why the restart that followed felt slow.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const MANAGER = read('src/mongodb-manager.js');
const STOP = MANAGER.slice(MANAGER.indexOf('async stop()'));

test('the shutdown connects with the credentials the application uses', () => {
  /* Anything that reaches for the file's own `uri` first is reaching for the
     one with the credentials stripped out of it. */
  const envUse = STOP.indexOf('process.env.MONGODB_URI');
  const fileUse = STOP.indexOf('creds.uri');

  assert.ok(envUse > -1, 'stop() does not use the decrypted URI the app connects with');
  assert.ok(
    fileUse === -1 || envUse < fileUse,
    'the raw credentials file is preferred over the decrypted URI, so the ' +
      'shutdown command is sent unauthenticated to a server running --auth',
  );
});

test('a refused shutdown is reported rather than swallowed', () => {
  /*
   * The empty catch has to stay narrow. A dropped connection really is the
   * success signal here - the server closes the socket while executing the
   * command - but that is one specific error, not every error.
   */
  assert.doesNotMatch(
    STOP.slice(0, STOP.indexOf('Promise.race')),
    /command\(\{ shutdown: 1 \}\)\.catch\(\(\) => \{\}\)/,
    'the result of the shutdown command is discarded, so a server that ' +
      'refused it looks exactly like one that accepted it',
  );
  assert.match(
    STOP,
    /refused the shutdown command/,
    'nothing distinguishes a refusal from the expected dropped connection',
  );
});

test('a kill is not reported as a clean stop', () => {
  /* "MongoDB stopped cleanly" printed immediately after "did not exit in time
     - terminating" is how this stayed invisible: the log both admitted the
     kill and denied it, two lines apart, and the reassuring line was the one
     people read. */
  const timeout = STOP.slice(STOP.indexOf('if (timedOut)'));
  const body = timeout.slice(0, timeout.indexOf('\n    }') + 6);

  assert.doesNotMatch(
    body,
    /stopped cleanly/,
    'the timeout path reports a clean stop after killing the process',
  );
  assert.match(
    body,
    /terminat|recover/i,
    'the timeout path does not say that mongod was killed, or that the next ' +
      'start has a journal to recover',
  );
});

test('the shutdown budget still leaves room for the force exit', () => {
  /* The database is given ten seconds and the whole shutdown twenty-five. If
     the per-step budget ever exceeds the total, the force exit fires first and
     kills mongod mid-write - the exact thing the clean shutdown exists to
     avoid. */
  const MAIN = read('src/main.js');
  const block = MAIN.slice(MAIN.indexOf('const SHUTDOWN_TIMEOUTS'));
  const budget = block.slice(0, block.indexOf('});'));

  const num = (key) => {
    const m = new RegExp(key + ':\\s*(\\d+)').exec(budget);
    return m ? parseInt(m[1], 10) : null;
  };

  const steps = ['backupScheduler', 'apiServer', 'mongoose', 'bundledMongoDB']
    .map(num)
    .filter((n) => n !== null);
  const total = num('total');

  assert.ok(total, 'there is no total shutdown budget');
  assert.ok(
    steps.reduce((a, b) => a + b, 0) < total,
    'the individual shutdown steps can together exceed the total budget, so ' +
      'the force exit can fire while the database is still closing',
  );
});
