/*
 * The exact instructions for scheduling Posnic's overnight work, with the real
 * paths filled in.
 *
 * Backups are a setInterval inside the application, so they only happen while
 * it is open. A shop that closes the till at nine and opens it at nine gets no
 * overnight backup, and the morning that matters is the one where the disk does
 * not come back.
 *
 * The Cloud edition does not have this problem - that work runs on the server,
 * on its own schedule, whether or not any till is switched on. This is for the
 * local edition, where the operating system's scheduler is the only thing that
 * can do it.
 *
 * The job itself runs inside main.js, launched as:
 *
 *     Posnic.exe --scheduled-task=backup
 *
 * and not as a script under ELECTRON_RUN_AS_NODE, which was the first attempt.
 * Under that flag require('electron') fails, so safeStorage is unreachable -
 * and the database password is wrapped with safeStorage. A plain script could
 * not decrypt its own credentials. Launched as the application, everything that
 * normally works works, and there is no environment variable for the scheduler
 * to carry.
 *
 * This module only describes. It is exported rather than merely printed so the
 * Backup Manager window and the user guide can show the same commands without
 * anybody retyping a path, because "point a scheduled task at your Node
 * installation" is not an instruction a shopkeeper can follow.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/* Tasks main.js knows how to run. Kept here so the two cannot disagree about
   what may be scheduled. */
const TASKS = ['backup'];

/*
 * Where the application keeps its data, reconstructed the way Electron builds
 * app.getPath('userData') - the platform's per-user application data directory
 * plus the name from package.json. Written this way so the same answer comes
 * out whether this is required by the application or by a script.
 */
function userDataPath() {
  if (process.env.POSNIC_USER_DATA) return process.env.POSNIC_USER_DATA;

  const name = 'posnic';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}

/* The ports this install derived, written by main.js on first run. Shown in the
   instructions because a shop asking for help should be able to read them off
   one screen rather than hunt for a file. */
function localPorts() {
  try {
    return JSON.parse(fs.readFileSync(path.join(userDataPath(), '.ports.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Everything needed to create, check, run and remove the scheduled job. */
function describe({ task = 'backup', frequency = 'daily', time = '22:00' } = {}) {
  if (!TASKS.includes(task)) {
    throw new Error(`unknown task "${task}"; known tasks: ${TASKS.join(', ')}`);
  }

  /* Posnic.exe in a packaged build, node.exe from a checkout. Either way it is
     the right answer for the machine it is read on. */
  const runner = process.execPath;
  const [rawHour, rawMinute] = String(time).split(':');
  const hour = String(rawHour || '22').padStart(2, '0');
  const minute = String(rawMinute || '00').padStart(2, '0');

  const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', hourly: 'HOURLY' };
  const schedule = FREQ[String(frequency).toLowerCase()] || 'DAILY';
  const taskLabel = `Posnic ${task.charAt(0).toUpperCase()}${task.slice(1)}`;

  return {
    platform: process.platform,
    task,
    runner,
    userData: userDataPath(),
    ports: localPorts(),
    schedule: { frequency, time: `${hour}:${minute}` },

    windows: {
      taskName: taskLabel,
      /* One command, nothing to install, no wrapper script. The application is
         launched with a flag, so there is no environment variable for schtasks
         to carry - it cannot set one. */
      create:
        `schtasks /Create /TN "${taskLabel}" /SC ${schedule} /ST ${hour}:${minute} ` +
        `/TR "\\"${runner}\\" --scheduled-task=${task}" /F`,
      verify: `schtasks /Query /TN "${taskLabel}"`,
      runNow: `schtasks /Run /TN "${taskLabel}"`,
      lastResult: `schtasks /Query /TN "${taskLabel}" /FO LIST /V | findstr /C:"Last Result"`,
      remove: `schtasks /Delete /TN "${taskLabel}" /F`,
    },

    unix: {
      /* No environment variable here either, for the same reason. */
      cron: `${minute} ${hour} * * *  "${runner}" --scheduled-task=${task}`,
      edit: 'crontab -e',
      verify: 'crontab -l',
    },

    notes: [
      'The task runs whether or not Posnic is open. It starts the database, takes the backup and stops again.',
      'It needs the same Windows account Posnic runs under - the database password is tied to that account.',
      'A failed run reports a non-zero exit code, so Task Scheduler shows it as failed rather than silently doing nothing.',
      'Copy backups somewhere else as well. A backup on the same disk as the original is not a backup.',
    ],
  };
}

/**
 * Printed form, for the log and for support.
 *
 * Takes either the options describe() takes or an already-described object, so
 * a caller that has added to the description - the backup destination, say -
 * gets its additions printed rather than silently dropped by a second call.
 */
function asText(options) {
  const d = options && options.windows ? options : describe(options);
  const isWindows = d.platform === 'win32';
  const lines = [
    `Scheduled ${d.task} for the local edition`,
    '',
    `  Application : ${d.runner}`,
    `  Data folder : ${d.userData}`,
    `  Database port: ${d.ports.mongoPort || 'not yet chosen'}`,
    `  Schedule    : ${d.schedule.frequency} at ${d.schedule.time}`,
  ];
  /* Where the files land. The commands say nothing about this, and it is the
     first thing anybody checks when asking whether the task really ran. */
  if (d.destination) lines.push(`  Backups to  : ${d.destination}`);
  lines.push(
    '',
    isWindows ? 'Create it (Command Prompt as administrator):' : 'Add this line to your crontab:',
    '',
    `  ${isWindows ? d.windows.create : d.unix.cron}`,
    '',
    isWindows ? 'Check it, and run it once now to be sure:' : 'Check it:',
    '',
    `  ${isWindows ? d.windows.verify : d.unix.verify}`
  );
  if (isWindows) lines.push(`  ${d.windows.runNow}`, `  ${d.windows.lastResult}`);
  lines.push('', ...d.notes.map((n) => `  - ${n}`));
  return lines.join('\n');
}

if (require.main === module) {
  console.log(asText());
}

module.exports = { describe, asText, userDataPath, localPorts, TASKS };
