const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

/*
 * Read at the point of use, never at module load.
 *
 * main.js requires this file at line 60 and does not resolve the ports until
 * app.whenReady, hundreds of lines later. As a module-scope constant this
 * captured the fallback, so mongod was started on 47017 while everything else
 * connected to the resolved 47590 and the app reported "MongoDB Service Not
 * Running" with a healthy database sitting right there.
 *
 * Same shape as the POSNIC_BRAND_DIR bug: a constant that reads the
 * environment before the environment is ready.
 */
function mongoPort() {
  return Number(process.env.POSNIC_MONGO_PORT) || 47017;
}
const READY_TIMEOUT_MS = 90_000; // first boot on old shop PCs can be slow
const READY_POLL_MS = 500;

/*
 * Turn a mongod exit code into something a shopkeeper can act on.
 *
 * Windows returns NTSTATUS values here, not ordinary exit codes, and the one
 * that matters is 0xC0000135 - STATUS_DLL_NOT_FOUND. mongod.exe is built
 * against the Microsoft Visual C++ runtime, which is present on any machine
 * that has ever had Office or Visual Studio installed and absent on a clean
 * Windows. So this never reproduces on a developer's machine and reliably
 * happens on a shop's brand new till.
 *
 * Reported as "Database could not be started", it sent people looking at their
 * data, their antivirus and their disk - anywhere except the one missing
 * download that fixes it in two minutes.
 */
const MISSING_RUNTIME = 0xC0000135 | 0;     // -1073741515 as a signed int

function describeMongodExit(code) {
  const unsigned = code >>> 0;
  if (unsigned === 0xC0000135) {
    return 'The database could not start because the Microsoft Visual C++ Runtime ' +
      'is not installed on this computer. Install the Microsoft Visual C++ ' +
      'Redistributable (x64) from microsoft.com, then start the app again. ' +
      '(mongod exit 0xC0000135, DLL not found)';
  }
  if (unsigned === 0xC0000142) {
    return 'The database could not start because a required component failed to ' +
      'initialise. Restarting the computer usually clears this. ' +
      '(mongod exit 0xC0000142)';
  }
  if (unsigned === 0xC000007B) {
    return 'The database could not start: the bundled database is 64-bit and ' +
      'something on this computer is providing a 32-bit component. Install the ' +
      'Microsoft Visual C++ Redistributable (x64). (mongod exit 0xC000007B)';
  }
  if (code === 100) {
    return 'The database could not start because its data folder is unreadable ' +
      'or already in use. (mongod exit 100)';
  }
  return `MongoDB exited with code ${code} before becoming ready`;
}

/* Repairing cannot help when the executable itself will not load. */
function isRepairable(code) {
  const unsigned = code >>> 0;
  return unsigned !== 0xC0000135 && unsigned !== 0xC0000142 && unsigned !== 0xC000007B;
}

class MongoDBManager {
  constructor() {
    this.mongoProcess = null;
    this.isRunning = false;
    this.usingExternal = false; // true when reusing an already-listening mongod
    this.onUnexpectedExit = null; // main process can hook restarts/health here

    // Determine base path for MongoDB binary (read-only in packaged app)
    let binBasePath;
    let isPackaged = false;
    try {
      const { app } = require('electron');
      isPackaged = app.isPackaged;
    } catch (e) {
      // Electron not available, assume dev mode
    }

    if (isPackaged && process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'mongodb'))) {
      // Packaged app - mongod.exe in resources path
      binBasePath = process.resourcesPath;
    } else {
      // Development - use __dirname
      binBasePath = __dirname;
    }

    // Determine writable base path for data/log/credentials
    // In packaged app, use userData folder (writable)
    // In dev, use __dirname
    let writableBasePath = __dirname;
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        writableBasePath = app.getPath('userData');
        const userMongoDir = path.join(writableBasePath, 'mongodb');
        if (!fs.existsSync(userMongoDir)) {
          fs.mkdirSync(userMongoDir, { recursive: true });
        }
      }
    } catch (e) {
      // Electron not available, use __dirname
    }

    /*
     * The database binary, whatever this machine calls it.
     *
     * This was hardcoded to mongod.exe, so the macOS and Linux packages looked
     * for a Windows executable, never found one, and refused to start - telling
     * the user to run download-mongodb.bat, a batch file, on a Mac. Those builds
     * were not degraded; they could not open at all.
     */
    this.mongoPath = path.join(
      binBasePath,
      'mongodb',
      'bin',
      process.platform === 'win32' ? 'mongod.exe' : 'mongod'
    );
    this.dataPath = path.join(writableBasePath, 'mongodb', 'data');
    this.logPath = path.join(writableBasePath, 'mongodb', 'log', 'mongodb.log');
    this.credentialsPath = path.join(writableBasePath, '.mongodb-credentials.json');
  }

  checkBundledMongoExists() {
    return fs.existsSync(this.mongoPath);
  }

  ensureDirectories() {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
    const logDir = path.dirname(this.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Clean up lock files (prevents startup issues after unclean shutdown)
    const lockFiles = [
      path.join(this.dataPath, 'mongod.lock'),
      path.join(this.dataPath, 'WiredTiger.lock'),
      path.join(this.dataPath, 'diagnostic.data', 'mongod.lock')
    ];

    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        try {
          console.log('🧹 Found existing lock file. Cleaning up:', path.basename(lockFile));
          fs.unlinkSync(lockFile);
        } catch (err) {
          console.warn('⚠️ Could not remove lock file:', err.message);
        }
      }
    }
  }

  // mongod writes its pid into mongod.lock inside the data directory while it
  // runs, and truncates the file on a clean shutdown. A live pid there means
  // the listener on 27018 is ours.
  _ownsRunningMongo() {
    try {
      const lock = path.join(this.dataPath, 'mongod.lock');
      if (!fs.existsSync(lock)) return false;
      const pid = parseInt(String(fs.readFileSync(lock, 'utf8')).trim(), 10);
      if (!pid) return false;
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  isPortOpen(timeoutMs = 1000) {
    return new Promise((resolve) => {
      const socket = net.connect({ port: mongoPort(), host: '127.0.0.1' });
      const done = (result) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  async _waitForReady(proc, timeoutMs = READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        const err = new Error(describeMongodExit(proc.exitCode));
        // Carried so the caller can tell a data problem from a machine problem
        // without parsing the message back out.
        err.exitCode = proc.exitCode;
        throw err;
      }
      if (await this.isPortOpen()) return;
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
    throw new Error(`MongoDB did not accept connections within ${timeoutMs / 1000}s`);
  }

  _spawnMongod(extraArgs = []) {
    const authEnabled = fs.existsSync(this.credentialsPath);
    const args = [
      '--dbpath', this.dataPath,
      '--logpath', this.logPath,
      '--logappend',
      '--port', String(mongoPort()),
      '--bind_ip', '127.0.0.1',
      ...extraArgs
    ];
    if (authEnabled && !extraArgs.includes('--repair')) {
      args.push('--auth');
    }
    const proc = spawn(this.mongoPath, args, {
      detached: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    if (proc.stderr) {
      proc.stderr.on('data', (data) => console.error('MongoDB stderr:', data.toString()));
    }
    return proc;
  }

  /**
   * Repair after unclean shutdown/corruption (power cuts are a reality on
   * POS machines). Runs mongod --repair and waits for it to finish.
   */
  _runRepair() {
    return new Promise((resolve) => {
      console.warn('🔧 Attempting automatic MongoDB repair (--repair)...');
      const proc = this._spawnMongod(['--repair']);
      const killTimer = setTimeout(() => {
        console.error('🔧 Repair timed out; killing repair process');
        try { proc.kill(); } catch (e) { /* ignore */ }
      }, 10 * 60_000);
      proc.on('exit', (code) => {
        clearTimeout(killTimer);
        console.warn(`🔧 Repair finished with code ${code}`);
        resolve(code === 0);
      });
      proc.on('error', () => {
        clearTimeout(killTimer);
        resolve(false);
      });
    });
  }

  async _startOnce() {
    const proc = this._spawnMongod();
    this.mongoProcess = proc;

    try {
      await this._waitForReady(proc);
    } catch (err) {
      try { proc.kill(); } catch (e) { /* ignore */ }
      this.mongoProcess = null;
      throw err;
    }

    this.isRunning = true;
    proc.on('exit', (code) => {
      const wasRunning = this.isRunning;
      this.isRunning = false;
      this.mongoProcess = null;
      if (wasRunning && code !== 0 && code !== null) {
        console.error(`❌ MongoDB exited unexpectedly with code ${code}`);
        if (typeof this.onUnexpectedExit === 'function') {
          this.onUnexpectedExit(code);
        }
      }
    });
  }

  async start() {
    if (this.isRunning) {
      console.log('✅ Bundled MongoDB is already running');
      return true;
    }

    if (!this.checkBundledMongoExists()) {
      console.error('❌ Bundled MongoDB not found at:', this.mongoPath);
      console.error(
        process.platform === 'win32'
          ? '📥  Please run: download-mongodb.bat'
          : '📥  The bundled database is missing from this build.'
      );
      throw new Error('Bundled MongoDB not found');
    }

    // A mongod is already listening (leftover from a crashed session, or a
    // system service). Reuse it instead of failing with a port conflict —
    // it serves the same data directory in the leftover case.
    if (await this.isPortOpen()) {
      console.warn('♻️ MongoDB already listening on 127.0.0.1:' + mongoPort() + ' — reusing existing instance');
      // The port is fixed, so a second data profile (--user-data-dir) would
      // silently attach to whichever shop is already open and then sync that
      // shop's records to the wrong cloud tenant. Say so loudly.
      if (!this._ownsRunningMongo()) {
        console.warn('⚠️ That MongoDB is not serving this profile\'s data directory:', this.dataPath);
        console.warn('⚠️ If another POSNIC profile is open, close it first — otherwise this window shows the other shop\'s data.');
      }
      this.isRunning = true;
      this.usingExternal = true;
      return true;
    }

    this.ensureDirectories();

    console.log('🚀 Starting bundled MongoDB...');
    console.log('   MongoDB Path:', this.mongoPath);
    console.log('   Data Path:', this.dataPath);
    console.log('   Log Path:', this.logPath);
    console.log('   Authentication:', fs.existsSync(this.credentialsPath) ? 'Enabled 🔐' : 'Disabled');

    try {
      await this._startOnce();
    } catch (firstError) {
      // Most common field failure: WiredTiger corruption after a power cut.
      // Repair once and retry before giving up.
      console.error('❌ MongoDB failed to start:', firstError.message);

      // Unless the executable itself would not load. Repair runs the same
      // mongod.exe, so it fails identically - it just spends another ten
      // minutes doing it and buries the real message under a second one.
      if (firstError.exitCode !== undefined && !isRepairable(firstError.exitCode)) {
        console.error('   Not a data problem; skipping repair.');
        throw firstError;
      }

      const repaired = await this._runRepair();
      if (!repaired) {
        throw firstError;
      }
      this.ensureDirectories(); // repair can leave lock files behind
      await this._startOnce();
      console.log('✅ MongoDB recovered after automatic repair');
    }

    console.log('✅ Bundled MongoDB started successfully');
    console.log('   Listening on: mongodb://127.0.0.1:' + mongoPort());
    return true;
  }

  async stop() {
    if (this.usingExternal) {
      // We did not spawn this mongod; leave it to its owner.
      this.isRunning = false;
      this.usingExternal = false;
      return;
    }
    if (!this.isRunning || !this.mongoProcess) {
      console.log('MongoDB is not running');
      return;
    }

    console.log('🛑 Stopping bundled MongoDB (clean shutdown)...');
    this.isRunning = false; // suppress onUnexpectedExit for intentional stop
    const proc = this.mongoProcess;
    const exited = new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', resolve);
    });

    // Windows has no signals - kill() would TERMINATE mongod mid-write and
    // force WiredTiger recovery on next start. Ask mongod to shut down
    // cleanly instead (flushes journal, checkpoints, releases locks).
    try {
      const { MongoClient } = require('mongodb');
      let uri = `mongodb://127.0.0.1:${mongoPort()}/admin`;

      /*
       * The URI the application itself connects with, not the one on disk.
       *
       * The password is encrypted at rest, so the `uri` stored in
       * .mongodb-credentials.json deliberately carries no credentials at all -
       * credentials-store rebuilds it on read, after decrypting. Reading the
       * file directly, as this did, therefore produced
       * mongodb://127.0.0.1:<port>/PosnicPro?authSource=admin and connected
       * anonymously to a server started with --auth.
       *
       * Which is why closing was slow. The shutdown command was refused, the
       * refusal was discarded, and the close then waited the full ten seconds
       * before killing mongod - so every clean close was really a hard kill
       * with a ten second pause in front of it, and the next start had a
       * journal to recover.
       *
       * main.js has already decrypted this and put it in the environment,
       * which also avoids requiring credentials-store from here: it lives
       * outside the asar and would need the same absolute-path dance main.js
       * does.
       */
      if (process.env.MONGODB_URI) {
        uri = process.env.MONGODB_URI;
      } else if (fs.existsSync(this.credentialsPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
          if (creds.uri) uri = creds.uri;
        } catch (e) { /* fall back to no-auth uri */ }
      }
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
      });
      await client.connect();
      /*
       * The server closes our connection while executing shutdown, so a network
       * error here is the expected success signal - but it is not the only
       * thing that can land in this catch, and everything used to be discarded
       * alike.
       *
       * That mattered: with authentication on, `shutdown` needs the
       * hostManager role, and a user without it is refused. The refusal looked
       * exactly like success, so the close then waited the full ten seconds for
       * an exit that had never been asked for, killed mongod, and reported a
       * clean shutdown. Every close was ten seconds and nothing said why.
       *
       * A dropped connection is success. Anything the server actually answered
       * with is a real refusal and gets logged.
       */
      await client.db('admin').command({ shutdown: 1 }).catch((err) => {
        const dropped = /connection|closed|ECONNRESET|EPIPE|socket|topology/i
          .test(String(err && err.message));
        if (!dropped) {
          console.warn(
            '[MongoDB] The server refused the shutdown command, so it will have '
            + 'to be terminated: ' + (err && err.message),
          );
        }
      });
      await client.close().catch(() => {});
    } catch (err) {
      console.warn('Clean shutdown command failed, will fall back to kill:', err.message);
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 10_000)),
    ]);
    if (timedOut) {
      /* A kill is not a clean stop. WiredTiger replays its journal on the next
         start, which is part of why the restart that follows one of these is
         slow too - so this must not be reported as if nothing happened. */
      console.warn('[MongoDB] Did not exit within 10s of being asked; terminating');
      try { proc.kill(); } catch (e) { /* already gone */ }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
      this.mongoProcess = null;
      console.warn('[MongoDB] Stopped, but by termination - the next start will recover its journal');
      return;
    }
    this.mongoProcess = null;
    console.log('✅ MongoDB stopped cleanly');
  }
}

module.exports = MongoDBManager;
