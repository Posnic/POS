/*
 * The scheduled-task instructions, and the contract main.js has to honour for
 * them to be true.
 *
 * This module only prints text, so there is nothing to run and assert on. What
 * matters is that the text is correct for the machine reading it - a command
 * with a wrong path in it is worse than no command, because the shopkeeper
 * runs it, sees no error, and believes the backups are happening.
 *
 * The other half is the flag itself. The instructions promise Posnic.exe
 * understands --scheduled-task=backup, exits non-zero on failure, and stops the
 * database again afterwards. Those live in main.js, and if any of them drifts
 * the printed command becomes a lie.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const st = require('../scheduled-task');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('only tasks main.js can actually run may be scheduled', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function runScheduledTaskAndExit'));
  for (const task of st.TASKS) {
    assert.match(
      fn.slice(0, 600),
      new RegExp(`['"]${task}['"]`),
      `scheduled-task.js offers to schedule "${task}" but main.js has no ` +
        'branch for it, so the task would be created and fail every night.',
    );
  }
  assert.throws(() => st.describe({ task: 'rm -rf' }), /unknown task/);
});

test('the command points at this machine, not at a documented example', () => {
  const d = st.describe();

  assert.strictEqual(d.runner, process.execPath);
  assert.ok(d.windows.create.includes(process.execPath), 'the real binary path is not in the command');
  assert.ok(path.isAbsolute(d.userData), 'userData must be absolute');
});

test('and it does not depend on Node being installed', () => {
  /* The first attempt ran a script under ELECTRON_RUN_AS_NODE, where
     require('electron') fails and safeStorage - which holds the key to the
     database password - is unreachable. Nothing in the instructions may go
     back to that. */
  const text = st.asText();
  assert.doesNotMatch(text, /ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(text, /\bnode(\.exe)?\b\s+["']?[^"'\n]*\.js/i);
});

test('the time is normalised, so 9:5 does not become an invalid schedule', () => {
  const d = st.describe({ time: '9:5' });
  assert.strictEqual(d.schedule.time, '09:05');
  assert.ok(d.windows.create.includes('/ST 09:05'));
  assert.ok(d.unix.cron.startsWith('05 09 * * *'));
});

test('frequency maps to what schtasks accepts, and an unknown one is not passed through', () => {
  assert.ok(st.describe({ frequency: 'weekly' }).windows.create.includes('/SC WEEKLY'));
  assert.ok(st.describe({ frequency: 'nightly' }).windows.create.includes('/SC DAILY'));
});

test('a path with a space in it survives quoting', () => {
  /* "C:\Program Files\Posnic\Posnic.exe" is the normal case, not the edge one.
     schtasks takes the whole command as one /TR argument, so the inner quotes
     have to be escaped or the task runs "C:\Program". */
  const d = st.describe();
  const tr = d.windows.create.match(/\/TR "(.+)" \/F/);
  assert.ok(tr, '/TR is not quoted as one argument');
  assert.match(tr[1], /^\\"[^"]+\\" --scheduled-task=/, 'the executable inside /TR is not escaped');
});

test('main.js takes the scheduled path instead of starting the application', () => {
  /* A scheduled task must not put a window on the screen of whoever happens to
     be logged in at ten at night. The dispatch has to return, not fall through
     into the normal startup that follows it. */
  /* Anchored on the dispatch itself. The flag name now appears earlier too -
     the splash checks it so a scheduled backup does not flash a window - and
     matching the first occurrence read the wrong block entirely. */
  const at = MAIN.indexOf('const scheduledArg = process.argv.find(');
  assert.ok(at > -1, 'main.js does not look for --scheduled-task at all');

  const dispatch = MAIN.slice(at, at + 400);
  assert.match(
    dispatch,
    /await runScheduledTaskAndExit\(.*\);\s*return;/,
    'the scheduled branch does not return, so startup continues and a window ' +
      'opens on top of whoever is logged in',
  );
});

test('main.js exits non-zero when the task fails', () => {
  /* Task Scheduler shows Last Result. If a failed backup exits 0 it reports
     success for something that did not happen, which is the one outcome worse
     than no scheduled backup at all. */
  const fn = MAIN.slice(MAIN.indexOf('async function runScheduledTaskAndExit'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  assert.match(body, /let code = 0;/, 'the exit code does not start at success');
  const failure = body.slice(body.indexOf('} catch'));
  assert.match(
    failure.slice(0, 300),
    /code = 1;/,
    'a failed scheduled task does not set a non-zero exit code, so Task ' +
      'Scheduler reports success for a backup that did not happen',
  );
  assert.match(body, /app\.exit\(code\)/, 'the exit code is computed but never used');
});

test('and stops the database again whatever happened', () => {
  const fn = MAIN.slice(MAIN.indexOf('async function runScheduledTaskAndExit'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  assert.match(body, /finally\s*{/, 'there is no finally block, so a thrown error leaves mongod running');
  const finallyBlock = body.slice(body.indexOf('finally'));
  assert.match(finallyBlock, /\.stop\(/, 'the finally block does not stop the database');
});

test('the store is resolved from resources/, which is where it is packaged', () => {
  /* scheduled runs are the only path that reads the credentials without the
     API having started, so this require is the one that breaks alone. */
  const fn = MAIN.slice(MAIN.indexOf('async function runScheduledTaskAndExit'));
  assert.match(
    fn.slice(0, 4000),
    /process\.resourcesPath,\s*'credentials-store'/,
    'the scheduled path must find credentials-store outside the asar',
  );
});

test('the backup destination is printed when the caller knows it', () => {
  /* asText has to accept an already-described object, or a caller that added
     the destination gets it dropped by a second describe() call. */
  const d = { ...st.describe(), destination: 'D:\\Shop backups' };
  assert.match(st.asText(d), /Backups to\s*: D:\\Shop backups/);
  assert.doesNotMatch(st.asText(), /Backups to/, 'nothing to print without a caller');
});

test('the screen the user guide sends people to actually exists', () => {
  /* The guide says Posnic writes the command for you. If nothing renders it,
     that sentence sends a shopkeeper looking for a button that is not there. */
  const ui = fs.readFileSync(path.join(ROOT, 'backup-manager.html'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

  assert.match(ui, /id="btnShowSchedule"/, 'no control to show the command');
  assert.match(ui, /getScheduleInstructions\(/, 'the control is not wired to the bridge');
  assert.match(
    preload,
    /getScheduleInstructions:.*invoke\('backup:schedule-instructions'/s,
    'preload does not expose the schedule instructions',
  );
  assert.match(
    MAIN,
    /ipcMain\.handle\('backup:schedule-instructions'/,
    'nothing in main.js answers backup:schedule-instructions',
  );
});

test('and the guide points at where that control really is', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'USER_GUIDE.md'), 'utf8');
  assert.match(
    guide,
    /Backup Manager → Settings/,
    'the guide names a screen that does not match the UI',
  );
});

test('the user guide prints the same command shape the code generates', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'USER_GUIDE.md'), 'utf8');
  const d = st.describe();

  for (const fragment of ['schtasks /Create', '/SC DAILY', '--scheduled-task=backup']) {
    assert.ok(guide.includes(fragment), `the user guide is missing "${fragment}"`);
  }
  assert.ok(
    guide.includes(d.windows.remove.replace(/Posnic Backup/, 'Posnic Backup')),
    'the guide does not say how to remove the task',
  );
});
