const electron = require('electron');

// Safety: if main.js is loaded as plain Node (not via Electron binary),
// `require('electron')` returns a string path. Detect and bail out clearly.
if (typeof electron === 'string') {
  console.error('❌ main.js was loaded as plain Node, not Electron.');
  console.error('   Please run via: npm run start  OR  electron .');
  process.exit(1);
}

const {
  app, BrowserWindow, ipcMain: rawIpcMain, Menu, Notification, session, dialog, shell, Tray,
  /* The OS keystore, used to unwrap the key that decrypts the database
     password. Available here because this is the main process of a real
     Electron application - a script run under ELECTRON_RUN_AS_NODE cannot even
     require('electron'), which is why scheduled work runs as the app. */
  safeStorage
} = electron;

/*
 * Every ipcMain handler in this file goes through the guard, which refuses a
 * message from any frame that is not one of this application's own pages.
 * rawIpcMain is kept for the places that need to pass the real object on -
 * pin-lock-ipc.js wraps it again itself.
 *
 * There were 78 handlers across this file and three others, and not one looked
 * at event.senderFrame. backup:restore and backup:delete were among them.
 */
const ipcMain = require('./ipc-guard').guard(rawIpcMain);
const {
  showSplash,
  closeSplash,
  splashIsOpen,
  showShutdown,
  setShutdownProgress,
  showWaitingForPrevious,
} = require('./splash');
const shutdownState = require('./shutdown-state');
const path = require('path');
const http = require('http');
const fs = require('fs');
const {
  hasUnexpiredAuthCookie,
  validateSavedLogin,
  clearStaleLogin
} = require('./startup-auth');

// === SINGLE INSTANCE PROTECTION ===
// Acquire this before loading hardware/database modules so a second launch
// exits before it can start another MongoDB or API server.
const hasSingleInstanceLock = app.requestSingleInstanceLock({
  startedAt: new Date().toISOString(),
  pid: process.pid
});

/*
 * Failing to get the lock means one of two very different things.
 *
 * Either another till is genuinely open - in which case the running instance
 * gets a 'second-instance' event, focuses itself, and this process should go
 * away - or the previous instance is still closing and has not let go yet.
 *
 * The second case used to be handled as if it were the first: exit(0), no
 * window, no message. Closing Posnic and immediately reopening it is an
 * ordinary thing to do, and for the ten seconds mongod takes to close its
 * files the icon simply did nothing. Clicking again did nothing again.
 *
 * So this asks which it is. The answer decides whether to leave, or to wait
 * and start - and waiting is handled after `ready`, because saying so needs a
 * window and there is no window before then.
 */
let waitingForPreviousShutdown = null;
if (!hasSingleInstanceLock) {
  try {
    waitingForPreviousShutdown = shutdownState.findInProgress(app.getPath('userData'));
  } catch (e) {
    waitingForPreviousShutdown = null;
  }

  if (!waitingForPreviousShutdown) {
    console.log('[Main] Another Posnic instance is already running');
    app.exit(0);
  } else {
    console.log(
      `[Main] The previous instance (pid ${waitingForPreviousShutdown.pid}) is still ` +
      'closing; waiting for it rather than exiting',
    );
  }
}

/*
 * posnic:// deep links ("Open my POS" on the website).
 *
 * Only from a packaged build. A development run registers process.execPath,
 * which is electron.exe - so the browser then asks "Open Electron?" and names
 * a program the shop has never heard of, for a link on their own account page.
 * Worse, it persists: the registry entry outlives the dev run, and the machine
 * keeps offering Electron until something overwrites it.
 *
 * The installer registers the scheme properly through build.protocols in
 * package.json, which is where a shop's machine gets it. This line is for the
 * case where the app has been moved or the registration lost, and it can only
 * ever point at a real installed Posnic.
 *
 * A second launch via the protocol lands in the existing second-instance
 * handler, which focuses the window; a cold start just opens the app normally.
 */
try {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('posnic');
  }
} catch (err) {
  console.log('[Main] protocol registration skipped:', err.message);
}

// === CRYPTO POLYFILL (for MongoDB driver 7.x in Electron) ===
// Some Electron versions don't expose globalThis.crypto which mongodb 7.x needs
try {
  const nodeCrypto = require('crypto');
  if (!globalThis.crypto && nodeCrypto.webcrypto) {
    globalThis.crypto = nodeCrypto.webcrypto;
  }
} catch (e) {
  console.error('Failed to polyfill crypto:', e.message);
}

const { HardwareManager } = require('./hardware-manager');
const { setupHardwareIPC } = require('./hardware-ipc');
const MongoDBManager = require('./mongodb-manager');
const KOTManager = require('./kot-manager');
const SyncAgentManager = require('./sync-agent-manager');
const { AssetUpdater } = require('./asset-updater');

// === FILE-BASED LOGGING (for packaged exe debugging) ===
// Title bar height in pixels. Windows draws its own at roughly 32 and
// shrinks it when maximised; 44 keeps the title readable either way.
const TITLEBAR_HEIGHT = Number(process.env.POSNIC_TITLEBAR_HEIGHT) || 44;
const LOG_FILE = path.join(app.getPath('userData'), 'app.log');
const OLD_LOG_FILE = path.join(app.getPath('userData'), 'app-old.log');
const LOG_DATE_FILE = path.join(app.getPath('userData'), '.app-log-date');
const HEALTH_FILE = path.join(app.getPath('userData'), 'health-status.json');
const crypto = require('crypto');
const HEALTH_DISMISS_FILE = path.join(app.getPath('userData'), 'health-dismissed.json');
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;

// Findings the shop chose not to be reminded about, keyed by a hash of the
// finding list, so anything new still surfaces. Errors are never suppressed.
function readHealthDismissals() {
  try { return JSON.parse(fs.readFileSync(HEALTH_DISMISS_FILE, 'utf8')); } catch { return []; }
}
function writeHealthDismissals(list) {
  try { fs.writeFileSync(HEALTH_DISMISS_FILE, JSON.stringify(list.slice(-20), null, 2)); }
  catch (e) { console.warn('[Health] could not save dismissal:', e.message); }
}
const WARNING_SUMMARY_INTERVAL_MS = 60 * 1000;
const WARNING_SUMMARY_COUNT = 25;
const repeatedWarnings = new Map();
const LOG_LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50
});
const DEFAULT_LOG_LEVEL = app.isPackaged ? 'INFO' : 'DEBUG';
const REQUESTED_LOG_LEVEL = String(
  process.argv.includes('--debug-logs')
    ? 'DEBUG'
    : (process.env.POSNIC_LOG_LEVEL || DEFAULT_LOG_LEVEL)
).toUpperCase();
const ACTIVE_LOG_LEVEL = LOG_LEVELS[REQUESTED_LOG_LEVEL]
  ? REQUESTED_LOG_LEVEL
  : DEFAULT_LOG_LEVEL;
const ACTIVE_LOG_LEVEL_VALUE =
  LOG_LEVELS[ACTIVE_LOG_LEVEL];

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function redactSecrets(value) {
  return String(value)
    .replace(/(mongodb(?:\+srv)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/((?:gh_token|jwt_secret|session_secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]');
}

function formatLogValue(value, seen = new WeakSet()) {
  if (value instanceof Error) {
    const details = {
      name: value.name,
      message: value.message,
      code: value.code,
      errno: value.errno,
      syscall: value.syscall,
      path: value.path,
      url: value.url,
      stack: value.stack,
      cause: value.cause
    };
    return redactSecrets(JSON.stringify(details, null, 2));
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return redactSecrets(JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue === 'object' && nestedValue !== null) {
          if (seen.has(nestedValue)) return '[Circular]';
          seen.add(nestedValue);
        }
        return nestedValue;
      }, 2));
    } catch (error) {
      return `[Unserializable ${value.constructor?.name || 'Object'}: ${error.message}]`;
    }
  }

  return redactSecrets(value);
}

function ensureDailyLog() {
  const today = getLocalDateKey();
  let activeDate = '';
  try {
    activeDate = fs.existsSync(LOG_DATE_FILE)
      ? fs.readFileSync(LOG_DATE_FILE, 'utf8').trim()
      : '';
  } catch (_) { }

  if (activeDate !== today || !fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(
      LOG_FILE,
      `=== Posnic Daily Log: ${today} ===\n`,
      'utf8'
    );
    fs.writeFileSync(LOG_DATE_FILE, today, 'utf8');
  }
}

function rotateLogIfNeeded(incomingBytes = 0) {
  try {
    if (!fs.existsSync(LOG_FILE)) return;

    const currentSize = fs.statSync(LOG_FILE).size;
    if (currentSize + incomingBytes <= MAX_LOG_SIZE_BYTES) return;

    if (fs.existsSync(OLD_LOG_FILE)) {
      fs.unlinkSync(OLD_LOG_FILE);
    }
    fs.renameSync(LOG_FILE, OLD_LOG_FILE);

    fs.writeFileSync(
      LOG_FILE,
      `=== Posnic Daily Log: ${getLocalDateKey()} ===\n` +
      `=== Log rotated at ${new Date().toISOString()} | previous=${path.basename(OLD_LOG_FILE)} | maxSizeMB=10 ===\n`,
      'utf8'
    );
  } catch (error) {
    try {
      // If Windows temporarily blocks rename, preserve logging by truncating
      // the active file and recording the rotation problem.
      fs.writeFileSync(
        LOG_FILE,
        `=== Posnic Daily Log: ${getLocalDateKey()} ===\n` +
        `=== Log rotation fallback at ${new Date().toISOString()} | error=${redactSecrets(error.message)} ===\n`,
        'utf8'
      );
    } catch (_) { }
  }
}

function shouldWriteLog(level) {
  return (LOG_LEVELS[level] || LOG_LEVELS.INFO) >= ACTIVE_LOG_LEVEL_VALUE;
}

function safeStringifyLogArg(value) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null) {
    // Null-prototype objects (e.g. req.query parsed by qs) have no
    // toString/valueOf, so String() throws "Cannot convert object to
    // primitive value". JSON.stringify works regardless of prototype.
    try {
      return JSON.stringify(value);
    } catch (_) {
      return Object.prototype.toString.call(value);
    }
  }
  try {
    return String(value);
  } catch (_) {
    return Object.prototype.toString.call(value);
  }
}

function inferInfoLevel(args) {
  const text = args
    .map(safeStringifyLogArg)
    .join(' ')
    .trim();

  const isVerboseDiagnostic =
    /(^|\s|\[)(debug|trace)(\]|\s|:|-)/i.test(text) ||
    /\[(dashboard context|pending activities)\]/i.test(text) ||
    /session filter|permission check result|session_applied/i.test(text);

  return isVerboseDiagnostic
    ? 'DEBUG'
    : 'INFO';
}

function getWarningKey(args) {
  const text = args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.name}:${arg.message}`;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch (_) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');

  return text
    .replace(/\bhttps?:\/\/[^\s"']+/gi, match => {
      try {
        const url = new URL(match.replace(/[),.;]+$/, ''));
        return `${url.origin}${url.pathname}`;
      } catch (_) {
        return match;
      }
    })
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, '<timestamp>')
    .replace(/\b\d{6,}\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function writeRepeatedWarningSummary(key, state) {
  if (!state || state.duplicateCount === 0) return;

  writeLog(
    'WARN',
    `${state.label} repeated ${state.duplicateCount} times`,
    {
      firstSeen: state.firstSeen,
      lastSeen: state.lastSeen,
      warningKey: key.slice(0, 300)
    }
  );
  state.duplicateCount = 0;
  state.lastSummaryAt = Date.now();
}

function flushRepeatedWarningSummaries() {
  for (const [key, state] of repeatedWarnings) {
    writeRepeatedWarningSummary(key, state);
  }
}

function writeWarningWithSuppression(args) {
  const key = getWarningKey(args);
  const now = Date.now();
  const existing = repeatedWarnings.get(key);

  if (!existing) {
    repeatedWarnings.set(key, {
      duplicateCount: 0,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      lastSummaryAt: now,
      label: String(args[0] || 'Warning').slice(0, 160)
    });
    writeLog('WARN', ...args);
    return;
  }

  existing.duplicateCount += 1;
  existing.lastSeen = new Date(now).toISOString();

  if (
    existing.duplicateCount >= WARNING_SUMMARY_COUNT ||
    now - existing.lastSummaryAt >= WARNING_SUMMARY_INTERVAL_MS
  ) {
    writeRepeatedWarningSummary(key, existing);
  }
}

try {
  if (!fs.existsSync(app.getPath('userData'))) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
  }
  ensureDailyLog();
  const sessionHeader =
    `\n=== Application session started at ${new Date().toISOString()} | version=${app.getVersion()} | packaged=${app.isPackaged} | pid=${process.pid} | logLevel=${ACTIVE_LOG_LEVEL} ===\n`;
  rotateLogIfNeeded(Buffer.byteLength(sessionHeader, 'utf8'));
  fs.appendFileSync(LOG_FILE, sessionHeader);
} catch (e) {
  // Ignore
}

function writeLog(level, ...args) {
  try {
    if (!shouldWriteLog(level)) return;
    ensureDailyLog();
    const msg = args.map(arg => formatLogValue(arg)).join(' ');
    const entry = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
    rotateLogIfNeeded(Buffer.byteLength(entry, 'utf8'));
    fs.appendFileSync(LOG_FILE, entry);
  } catch (e) {
    // Ignore
  }
}

function updateHealthStatus(patch) {
  try {
    let current = {};
    if (fs.existsSync(HEALTH_FILE)) {
      try {
        current = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
      } catch (_) { }
    }

    const next = {
      ...current,
      version: app.getVersion(),
      packaged: app.isPackaged,
      pid: process.pid,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const tempFile = `${HEALTH_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(next, null, 2), 'utf8');
    if (fs.existsSync(HEALTH_FILE)) {
      fs.unlinkSync(HEALTH_FILE);
    }
    fs.renameSync(tempFile, HEALTH_FILE);
  } catch (error) {
    console.warn('[Health] Could not update health status file:', error.message);
  }
}

// Override console methods to also write to log file
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
const origDebug = console.debug;
console.log = (...args) => {
  origLog(...args);
  writeLog(inferInfoLevel(args), ...args);
};
console.info = (...args) => {
  origLog(...args);
  writeLog('INFO', ...args);
};
console.debug = (...args) => {
  origDebug(...args);
  writeLog('DEBUG', ...args);
};
console.error = (...args) => { origError(...args); writeLog('ERROR', ...args); };
console.warn = (...args) => {
  origWarn(...args);
  writeWarningWithSuppression(args);
};

// Catch uncaught errors
process.on('uncaughtException', (err) => {
  writeLog('FATAL', 'Uncaught Exception:', err);
  console.error('FATAL Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  writeLog('FATAL', 'Unhandled Rejection:', reason, { promise: String(promise) });
  console.error('FATAL Unhandled Rejection:', reason);
});
process.on('warning', warning => {
  console.warn('PROCESS WARNING:', warning);
});

console.log(`📝 Log file: ${LOG_FILE}`);

console.log(`[Health] Status file: ${HEALTH_FILE}`);

updateHealthStatus({
  lastStartup: new Date().toISOString(),
  status: 'starting',
  mongodb: 'starting',
  api: 'pending',
  interface: 'pending',
  dashboard: 'pending',
  login: 'pending',
  lastError: null
});

// === SINGLE PORT CONFIGURATION ===
/*
 * Read the port when it is asked for, never at module load.
 *
 * This was `const API_PORT = process.env.PORT || 5555`. That line runs when
 * main.js is first required, which is long before app.whenReady calls
 * resolveLocalPorts - so PORT was unset and API_PORT froze at 5555 for the
 * life of the process. resolveLocalPorts then derived the real port from the
 * app name, wrote it to .ports.json, printed it at startup... and startServer()
 * set process.env.PORT back to the captured 5555 before handing over to
 * server.js. Stock Posnic advertised 42590 and served 5555.
 *
 * Two things fell out of that. Derived ports exist so two brands can be
 * installed side by side without colliding, and both would have collided on
 * 5555. And 5555 is a common development port, so anything else already using
 * it took the app down on a machine that had done nothing wrong.
 *
 * docs/DEVELOPMENT.md has warned about exactly this shape since three earlier
 * production failures: read process.env inside a function, because a module
 * scope const captures the fallback. This was the fourth.
 */
function apiPort() {
  return Number(process.env.PORT) || 5555;
}

let mainWindow;
let apiServer;
let hardwareManager;
let kotManager;
let hardwareWindow;
let backupWindow;
let mongoDBManager;
let syncAgentManager = null;
let pendingSecondInstanceFocus = false;
let shutdownInProgress = false;
/*
 * Set when the shop asked to restart rather than to quit.
 *
 * app.relaunch() only spawns the replacement on Electron's normal quit
 * sequence, and this application's shutdown ends with app.exit(0), which
 * bypasses it - so Restart App closed the till and started nothing. That is a
 * worse outcome than the button not existing. See the before-quit handler.
 */
let relaunchAfterQuit = false;
/* Set once the update IPC is wired. The quit handler needs it to ask whether a
   downloaded update should be applied as this process exits. */
let updateService = null;
const SHUTDOWN_TIMEOUTS = Object.freeze({
  backupScheduler: 1000,
  apiServer: 4000,
  mongoose: 4000,
  bundledMongoDB: 14000, // clean shutdown: admin command + wait for real exit
  total: 25000
});
const startupPerformance = {
  startedAt: Date.now(),
  mongoStartedAt: null,
  mongoReadyMs: null,
  apiModulesMs: null,
  databaseConnectMs: null,
  interfaceVisibleMs: null,
  summaryWritten: false
};
const STARTUP_READY_FILE = path.join(
  app.getPath('userData'),
  `.startup-ready-${app.getVersion()}`
);

function focusPrimaryWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingSecondInstanceFocus = true;
    return;
  }

  // During warm startup the window intentionally stays hidden until the
  // dashboard/login DOM is ready. Do not reveal an empty window.
  if (!mainWindow.webContents.getURL()) {
    pendingSecondInstanceFocus = true;
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.setAlwaysOnTop(true);
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
  pendingSecondInstanceFocus = false;
  console.info('[Main] Existing Posnic window focused');
}

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    /*
     * Not while closing. The other process is not a duplicate launch to be
     * turned away - it is somebody reopening the till, and it is already
     * waiting for this one to finish and let go. Focusing windows that are
     * hidden or half torn down would fight that, and could bring a dead window
     * back to the screen on the way out.
     */
    if (shutdownInProgress) {
      console.info('[Main] A launch arrived while closing; it will start once this one exits');
      return;
    }

    console.info('[Main] Duplicate launch prevented', {
      workingDirectory,
      requestedPid: additionalData?.pid,
      argumentsCount: Array.isArray(argv) ? argv.length : 0
    });
    global.__posnicStartHidden = false;
    focusPrimaryWindow();
    // Windows Jump List tasks arrive as args on the second instance
    const openArg = (argv || []).find((a) => a.startsWith('--open='));
    if (openArg) {
      const target = openArg.split('=')[1];
      if (target === 'hardware') openHardwareManager();
      else if (target === 'backup') openBackupManager();
      else if (target === 'update') openUpdateManager();
      else if (target === 'cloud') openCloudManager();
    }
  });
}

// Native right-click menus (cut/copy/paste) in every window - Electron
// ships without them, and their absence is the #1 "not a real app" tell.
app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_e, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push({ role: 'copy' });
    }
    if (template.length) {
      Menu.buildFromTemplate(template).popup();
    }
  });
});

function isWarmStartup() {
  return fs.existsSync(STARTUP_READY_FILE);
}

function rememberSuccessfulStartup() {
  try {
    fs.writeFileSync(STARTUP_READY_FILE, new Date().toISOString());
  } catch (error) {
    console.warn('[Main] Could not save startup state:', error.message);
  }
}

function formatStartupDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return 'not measured';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function writeStartupPerformanceSummary(interfaceName) {
  if (startupPerformance.summaryWritten) return;

  startupPerformance.interfaceVisibleMs =
    Date.now() - startupPerformance.startedAt;
  startupPerformance.summaryWritten = true;

  console.info('[Startup Performance Summary]');
  console.info(
    `  MongoDB ready: ${formatStartupDuration(startupPerformance.mongoReadyMs)}`
  );
  console.info(
    `  API modules loaded: ${formatStartupDuration(startupPerformance.apiModulesMs)}`
  );
  console.info(
    `  Database connected: ${formatStartupDuration(startupPerformance.databaseConnectMs)}`
  );
  console.info(
    `  ${interfaceName} visible: ${formatStartupDuration(startupPerformance.interfaceVisibleMs)}`
  );
  console.info(
    `  Total startup: ${formatStartupDuration(startupPerformance.interfaceVisibleMs)}`
  );
}

function markInterfaceReady(interfaceName) {
  const normalized = String(interfaceName).toLowerCase();
  updateHealthStatus({
    status: 'ready',
    interface: 'ready',
    dashboard: normalized.includes('dashboard') ? 'ready' : 'not-active',
    login: normalized.includes('login') ? 'ready' : 'not-active',
    installationWizard: normalized.includes('installation wizard')
      ? 'ready'
      : 'not-active',
    lastReadyAt: new Date().toISOString(),
    startupPerformance: {
      mongodbMs: startupPerformance.mongoReadyMs,
      apiModulesMs: startupPerformance.apiModulesMs,
      databaseConnectMs: startupPerformance.databaseConnectMs,
      totalMs: startupPerformance.interfaceVisibleMs
    }
  });
}

function withTimeout(label, operation, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;

      if (status === 'timeout') {
        console.warn(`[Shutdown] ${label} timed out`, { timeoutMs, durationMs });
      } else if (status === 'error') {
        console.error(`[Shutdown] ${label} failed`, error);
      } else {
        console.info(`[Shutdown] ${label} completed`, { durationMs });
      }
      resolve({ label, status, durationMs });
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(() => finish('completed'))
      .catch(error => finish('error', error));
  });
}

function closeApiServer() {
  const server = global.apiServer || apiServer;
  if (!server || typeof server.close !== 'function') return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });

    // Stop waiting for persistent keep-alive connections where supported.
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  });
}

/*
 * The shutdown, as a list, so it can be walked and counted.
 *
 * It was five `await withTimeout(...)` calls in a row, which is the same work
 * but cannot be reported on: nothing could say which step was running or how
 * many were left. Written this way, the progress on screen is generated from
 * the same list that does the work, so the two cannot disagree about what
 * Posnic is doing - a screen that says "closing the database" while something
 * else is happening would be worse than no screen.
 *
 * The labels are what a shopkeeper would call these things. "Bundled MongoDB
 * process" is what the log says, and the log is for us.
 */
function shutdownSteps() {
  return [
    {
      label: 'Backup scheduler',
      says:  'Stopping scheduled backups...',
      ms:    SHUTDOWN_TIMEOUTS.backupScheduler,
      run:   () => { if (backupManager) backupManager.stopScheduler(); },
    },
    {
      label: 'Sync agent',
      says:  'Stopping the sync agent...',
      ms:    SHUTDOWN_TIMEOUTS.backupScheduler,
      run:   () => { if (syncAgentManager) syncAgentManager.stop(); },
    },
    {
      label: 'API server',
      says:  'Finishing anything still in progress...',
      ms:    SHUTDOWN_TIMEOUTS.apiServer,
      run:   closeApiServer,
    },
    {
      label: 'MongoDB connection',
      says:  'Disconnecting from the database...',
      ms:    SHUTDOWN_TIMEOUTS.mongoose,
      run:   async () => {
        if (global.mongooseConnection) await global.mongooseConnection.close(false);
      },
    },
    {
      /* The long one, and the one that must not be interrupted: mongod is
         flushing its journal and checkpointing. Everything above it is
         milliseconds. */
      label: 'Bundled MongoDB process',
      says:  'Saving your data and closing the database safely...',
      ms:    SHUTDOWN_TIMEOUTS.bundledMongoDB,
      run:   async () => { if (mongoDBManager) await mongoDBManager.stop(); },
    },
  ];
}

/*
 * Make the application disappear, without ending it.
 *
 * hide() rather than destroy(): a destroyed window fires 'closed' handlers and
 * can re-enter the quit path, and there is nothing to gain from tearing down
 * renderers we are about to exit anyway. Hiding takes them off the screen and
 * out of the taskbar immediately, which is the whole point - the shop should
 * see the till close when they close it, not watch a frozen window for the ten
 * seconds mongod needs.
 */
function hideAllWindowsForQuit() {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed()) continue;
      win.setSkipTaskbar(true);
      win.hide();
    } catch (e) { /* one window failing must not stop the others */ }
  }
  try {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
  } catch (e) { /* not fatal */ }
}

async function performGracefulShutdown(onProgress) {
  const shutdownStartedAt = Date.now();
  console.info('[Shutdown] Graceful shutdown started');
  flushRepeatedWarningSummaries();

  const steps = shutdownSteps();
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    /* Announced before it runs, not after: the step that takes ten seconds
       should be named while it is taking them. */
    if (onProgress) {
      try { onProgress(i, steps.length, step.says); } catch (e) { /* never stop a shutdown to draw */ }
    }
    await withTimeout(step.label, step.run, step.ms);
  }
  if (onProgress) {
    try { onProgress(steps.length, steps.length, 'Closed safely.'); } catch (e) { /* as above */ }
  }

  console.info('[Shutdown] Graceful shutdown finished', {
    totalDurationMs: Date.now() - shutdownStartedAt
  });
  updateHealthStatus({
    status: 'stopped',
    api: 'stopped',
    mongodb: 'stopped',
    interface: 'closed',
    lastShutdown: new Date().toISOString()
  });
  flushRepeatedWarningSummaries();
}

function isExpectedNavigationAbort(error) {
  return error &&
    (error.code === 'ERR_ABORTED' || error.errno === -3);
}

/**
 * Run one scheduled job with no window, then quit.
 *
 * Deliberately does not reuse the normal startup path. That path builds
 * windows, a tray, a menu, hardware IPC and the API server, and a backup needs
 * none of them - it needs MongoDB running and the credentials to reach it.
 * Threading a headless flag through all of that would put a second set of
 * conditions into the code that starts a shop's till every morning, which is
 * the last place to add branches.
 *
 * Exit codes matter here: Task Scheduler records them, and a scheduler that
 * reports success for a backup that did not happen is worse than no scheduler.
 */
async function runScheduledTaskAndExit(taskName) {
  const started = Date.now();
  console.log(`[scheduled] ${taskName} starting`);

  let mongo = null;
  let code = 0;

  try {
    if (taskName !== 'backup') {
      throw new Error(`unknown scheduled task "${taskName}"`);
    }

    mongo = new MongoDBManager();
    if (mongo.checkBundledMongoExists()) {
      await mongo.start();
      console.log('[scheduled] database started');
    } else {
      console.log('[scheduled] no bundled database; using whatever is already running');
      mongo = null;
    }

    /*
     * The credentials, read the way the application reads them.
     *
     * Not via setup-mongodb.js: that runs from resources/, outside the asar,
     * and main.js cannot require it by a relative path. credentials-store is
     * the thing that actually knows how to decrypt the password - which works
     * here precisely because this is a real Electron process with safeStorage,
     * and would not from a plain script.
     *
     * It lives in resources/ rather than the asar, and is reached by an
     * absolute path, because setup-mongodb.js and the API also require it and
     * electron-builder will not put one file on both sides of the asar
     * boundary: listing it in extraResources removes it from the archive.
     */
    const store = require(
      app.isPackaged
        ? path.join(process.resourcesPath, 'credentials-store')
        : path.join(__dirname, 'credentials-store')
    );
    const userData = app.getPath('userData');
    const creds = store.read(
      [
        path.join(userData, '.mongodb-credentials.json'),
        path.join(__dirname, '.mongodb-credentials.json'),
      ],
      userData,
      safeStorage
    );

    if (creds && creds.uri) {
      process.env.MONGODB_URI = creds.uri;
    } else if (!process.env.MONGODB_URI) {
      /* No stored credentials: an install where MongoDB runs without
         authentication. The derived port still has to be right. */
      process.env.MONGODB_URI = `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`;
    }

    const result = await getBackupManager().runBackup({
      force: true,
      _manual: true,
      reason: 'scheduled-task',
    });

    if (!result || result.success === false) {
      throw new Error(result && result.message ? result.message : 'backup reported failure');
    }
    console.log(`[scheduled] backup finished in ${Date.now() - started}ms`);
  } catch (error) {
    console.error(`[scheduled] ${taskName} failed: ${error.message}`);
    code = 1;
  } finally {
    if (mongo) {
      try {
        await mongo.stop();
        console.log('[scheduled] database stopped');
      } catch (stopError) {
        console.warn(`[scheduled] could not stop the database: ${stopError.message}`);
      }
    }
  }

  /* exit rather than quit: nothing is open to close, and quit would wait for
     window lifecycle events that will never arrive. */
  app.exit(code);
}

function loadPageAndReveal(url) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('Main window is not available'));
      return;
    }

    /* Tell the loading-screen timer to stand down: the real interface is on its
       way, and a loading screen shown now would abort this navigation. */
    global.__posnicInterfaceLoading = true;

    let settled = false;
    const reveal = () => {
      if (settled || !mainWindow || mainWindow.isDestroyed()) return;
      settled = true;
      cleanup();
      rememberSuccessfulStartup();
      if (!global.__posnicStartHidden && !mainWindow.isVisible()) mainWindow.show();
      if (!global.__posnicStartHidden) mainWindow.focus();
      if (pendingSecondInstanceFocus) focusPrimaryWindow();
      resolve();
    };
    const fail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || settled || errorCode === -3) return;
      settled = true;
      cleanup();
      const error = new Error(`${errorDescription} (${errorCode}) loading '${validatedURL}'`);
      error.errno = errorCode;
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(fallback);
      /* Cleared here rather than in reveal(), because every way out of this
         promise - revealed, failed, rejected - passes through cleanup, and a
         flag left set would suppress the loading screen for the rest of the
         session. */
      global.__posnicInterfaceLoading = false;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.removeListener('dom-ready', revealIfCorrectPage);
      mainWindow.webContents.removeListener('did-fail-load', fail);
    };

    /*
     * dom-ready is enough to paint the application shell. Large dashboard
     * assets and data requests can continue after the user sees the window.
     *
     * But it has to be dom-ready for the page that was asked for. This listened
     * for any dom-ready at all, and the loading screen produces one: a timer
     * further down shows loading.html once startup passes 2.5 seconds, and that
     * aborts whatever navigation is in flight. When startup landed just the
     * wrong side of that line - 2.75s on the run that exposed it - the sequence
     * was:
     *
     *   loading.html replaces the dashboard navigation
     *   loading.html reaches dom-ready
     *   reveal fires and the promise resolves
     *   the log says "Dashboard visible" and "Saved login found"
     *   the till shows a spinner for ever
     *
     * The abort was invisible because did-fail-load ignores error -3, which is
     * exactly what an aborted navigation reports. So every signal said the
     * interface was ready while the user watched a progress ring.
     */
    const wantedPage = (() => {
      try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
      } catch {
        return url;
      }
    })();

    const isTheRequestedPage = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      try {
        const current = new URL(mainWindow.webContents.getURL());
        return `${current.origin}${current.pathname}` === wantedPage;
      } catch {
        return false;
      }
    };

    const revealIfCorrectPage = () => {
      if (settled) return;
      /* Something else got here first - almost always the loading screen. Keep
         waiting: either the requested page arrives, or the fallback below shows
         whatever is on screen, so the user is never left with nothing. */
      if (!isTheRequestedPage()) return;
      reveal();
    };

    mainWindow.webContents.on('dom-ready', revealIfCorrectPage);
    mainWindow.webContents.on('did-fail-load', fail);

    /* The safety net. If the requested page never arrives, show what there is
       rather than hanging - and say so, because it means this race, or
       something like it, happened again. */
    const fallback = setTimeout(() => {
      if (settled) return;
      if (!isTheRequestedPage()) {
        const showing = mainWindow && !mainWindow.isDestroyed()
          ? mainWindow.webContents.getURL()
          : 'none';
        console.warn(`[Startup] ${url} did not load within 3s; showing ${showing} instead`);
      }
      reveal();
    }, 3000);

    mainWindow.loadURL(url).catch(error => {
      if (!isExpectedNavigationAbort(error) && !settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  });
}

function updateStartupStatus(stage, text, details, progress) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = [stage, text, details, progress]
    .map(value => JSON.stringify(value))
    .join(',');
  mainWindow.webContents
    .executeJavaScript(`window.updateStartupStatus?.(${payload})`)
    .catch(() => { });
}

// Startup-failure actions used by the loading screen's error state
ipcMain.handle('startup:retry', () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('startup:open-log', () => shell.openPath(LOG_FILE));

// ---------------------------------------------------------------------------
// Posnic Cloud activation (used by the install wizard and the settings window)
// ---------------------------------------------------------------------------
const CLOUD_CONFIG_FILE = path.join(app.getPath('userData'), 'posnic-cloud.json');

/*
 * A stable identity for this machine, so re-activating replaces this till's
 * registration instead of adding another.
 *
 * The cloud gives every activation a fresh random device id, so reinstalling
 * used to leave the previous registration behind, still holding a working
 * token for the shop's data. Sending something stable lets the gateway retire
 * the old one.
 *
 * Stored in userData, which survives an uninstall by design, so the common
 * case - uninstall, reinstall, sign in again - is recognised as the same till.
 * A genuinely fresh machine gets a new id and registers separately, which is
 * correct: it is a different till.
 */
function getMachineId() {
  const file = path.join(app.getPath('userData'), '.machine-id');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (e) { /* first run on this machine */ }
  const id = require('crypto').randomUUID();
  try {
    fs.writeFileSync(file, id, 'utf8');
  } catch (e) {
    // Unwritable userData is not worth failing activation over; the shop just
    // registers as a new till, which is what happened before this existed.
    console.warn('[cloud] could not persist machine id:', e.message);
  }
  return id;
}

ipcMain.handle('cloud:activate', async (_event, { serverUrl, email, password } = {}) => {
  try {
    if (!serverUrl || !email || !password) {
      return { ok: false, error: 'Server, email and password are required' };
    }
    const base = String(serverUrl).trim().replace(/\/+$/, '');
    const deviceName = require('os').hostname();

    const response = await fetch(`${base}/v1/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, deviceName, machineId: getMachineId() }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const msg = response.status === 401
        ? 'Invalid email or password'
        : `Cloud server error (${response.status})`;
      return { ok: false, error: msg };
    }
    const { deviceToken, deviceId, syncUrl } = await response.json();

    /*
     * Where this till syncs is decided by the server, not by what was typed
     * here.
     *
     * With one gateway the address entered at activation is the address to sync
     * with, and that is what this stored. With several machines it stops being
     * true: a shop lives on one of them and only the server knows which. It now
     * says so, and the till believes it.
     *
     * Falling back to what was typed keeps every existing installation working,
     * and keeps activation possible against an estate that has not been told
     * its own addresses yet.
     */
    const gatewayUrl = syncUrl ? String(syncUrl).replace(/\/+$/, '') : base;
    if (syncUrl && gatewayUrl !== base) {
      console.log(`[Cloud] this shop syncs with ${gatewayUrl}`);
    }

    // Local installs enable MongoDB auth during setup; the agent must use
    // the same credentials. Fresh cloud-mode installs have no auth yet.
    let localUri = `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;
    try {
      const credFile = path.join(app.getPath('userData'), '.mongodb-credentials.json');
      if (fs.existsSync(credFile)) {
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (creds.uri) localUri = creds.uri;
      }
    } catch (credErr) {
      console.warn('[Cloud] Could not read MongoDB credentials:', credErr.message);
    }

    fs.writeFileSync(CLOUD_CONFIG_FILE, JSON.stringify({
      gatewayUrl,
      deviceToken,
      deviceId,
      localUri,
      localDb: 'PosnicPro',
      statusPort: 5055
    }, null, 2));

    if (!syncAgentManager) syncAgentManager = new SyncAgentManager({ app });
    syncAgentManager.stop();
    syncAgentManager.stopped = false;
    const started = syncAgentManager.start();
    if (!started) {
      return { ok: false, error: 'Sync agent is not installed in this build' };
    }
    console.log('[Cloud] Device activated:', deviceId);
    createMenu(); // refresh: local-only entries (e.g. Backup Manager) hide
    if (tray && tray.rebuildMenu) tray.rebuildMenu();
    refreshBrand().catch(() => {});  // white label, if this shop has one
    refreshLimits().catch(() => {}); // how many outlets they may run
    return { ok: true, deviceId };
  } catch (error) {
    console.error('[Cloud] Activation failed:', error.message);
    const friendly = /abort|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(String(error.message))
      ? 'Could not reach the cloud server. Check the address and your internet connection.'
      : error.message;
    return { ok: false, error: friendly };
  }
});

/*
 * White label. The shop's logo and name come from the cloud and are cached
 * here, so changing a logo costs a relaunch rather than a reinstall. The API
 * reads this folder and serves the images on the stock logo paths.
 *
 * Never allowed to break startup: a shop with no branding, or no internet, or
 * a cloud that is down, simply keeps whatever it already had.
 */
const BRAND_DIR = path.join(app.getPath('userData'), 'brand');

/*
 * Frontend files applied after install, and the machinery to undo them.
 *
 * The public key is the whole security model: without it this refuses every
 * update rather than trusting them, so a build that ships without one is inert
 * rather than dangerous. Signing keys are generated per product and only the
 * public half is ever in the repository.
 */
const ASSET_PUBLIC_KEY_FILE = path.join(process.resourcesPath || __dirname, 'asset-signing-key.pub');
const assetUpdater = new AssetUpdater({
  root: path.join(app.getPath('userData'), 'assets'),
  baseline: path.join(process.resourcesPath || __dirname, 'frontend', 'public'),
  publicKey: (() => {
    try {
      return fs.existsSync(ASSET_PUBLIC_KEY_FILE)
        ? fs.readFileSync(ASSET_PUBLIC_KEY_FILE, 'utf8') : null;
    } catch (e) { return null; }
  })(),
  log: (m) => console.log(m),
});
const BRAND_FILE = path.join(BRAND_DIR, 'brand.json');

async function refreshBrand() {
  if (!fs.existsSync(CLOUD_CONFIG_FILE)) return;
  const cfg = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
  if (!cfg.gatewayUrl || !cfg.deviceToken) return;
  const base = String(cfg.gatewayUrl).replace(/\/+$/, '');
  const headers = { authorization: 'Bearer ' + cfg.deviceToken };

  const response = await fetch(`${base}/v1/brand`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return;                       // suspended, or an older gateway
  const brand = await response.json();

  fs.mkdirSync(BRAND_DIR, { recursive: true });
  const files = ['brand.json', 'brand-logo.png', 'brand-login-logo.png']
    .map((f) => path.join(BRAND_DIR, f));

  if (!brand.enabled) {
    for (const f of files) if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log('[Brand] no white label for this shop');
    return;
  }

  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8')); } catch (e) { /* first run */ }

  // Images are only re-fetched when the cloud says they changed.
  if (previous.version !== brand.version) {
    for (const [flag, which, file] of [
      [brand.hasLogo, 'app', 'brand-logo.png'],
      [brand.hasLoginLogo, 'login', 'brand-login-logo.png'],
    ]) {
      const target = path.join(BRAND_DIR, file);
      if (!flag) { if (fs.existsSync(target)) fs.unlinkSync(target); continue; }
      const img = await fetch(`${base}/v1/brand/logo?which=${which}`, { headers, signal: AbortSignal.timeout(20_000) });
      if (!img.ok) continue;
      fs.writeFileSync(target, Buffer.from(await img.arrayBuffer()));
    }
  }

  fs.writeFileSync(BRAND_FILE, JSON.stringify(brand, null, 2));
  console.log(`[Brand] applied "${brand.name}"`);
}

/*
 * How many outlets this shop may run. Cached next to the brand so the API can
 * read it without a network call on every branch screen. A shop that has never
 * connected to the cloud has no file here and no limit, which is what the free
 * edition means.
 */
async function refreshLimits() {
  if (!fs.existsSync(CLOUD_CONFIG_FILE)) return;
  const cfg = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
  if (!cfg.gatewayUrl || !cfg.deviceToken) return;
  const base = String(cfg.gatewayUrl).replace(/\/+$/, '');

  const response = await fetch(`${base}/v1/limits`, {
    headers: { authorization: 'Bearer ' + cfg.deviceToken },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return;              // suspended, or an older gateway
  const limits = await response.json();
  fs.mkdirSync(BRAND_DIR, { recursive: true });
  fs.writeFileSync(path.join(BRAND_DIR, 'limits.json'), JSON.stringify(limits, null, 2));
  console.log(`[Limits] outlets: ${limits.branches ?? 'unlimited'} (${limits.source})`);
}

/*
 * The page telling the window what colour it just became.
 *
 * Called on every theme change and once on load, so the bar follows a theme
 * switched in Config without a restart.
 */
ipcMain.handle('theme:chrome', async (_event, theme) => applyWindowChrome(theme));

/*
 * What the settings windows ask for.
 *
 * Hardware Manager and friends are separate windows with their own stylesheets
 * and no sight of the app's, which is why they were fixed blue while the till
 * was dark. They read the palette the app last applied and dress themselves.
 */
/*
 * The title bar's buttons, now that the page draws them.
 *
 * close() honours the existing close handler, so it still hides to the tray and
 * still locks on the way out rather than quitting behind the shop's back.
 */
ipcMain.handle('window:minimize', async () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', async () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

/*
 * Whether the window is maximised, so the page can draw the right button.
 *
 * The title bar is drawn by the page, and its middle button was a fixed square
 * whatever the window was doing. Every other application on the machine shows
 * two overlapping squares once maximised, because that button then means
 * "restore", not "maximise" - so ours was telling the shop the wrong thing
 * about what the click would do.
 *
 * Asked for on load, and pushed on change, because a window can be maximised by
 * double-clicking the bar or by Windows snapping it - not only by this button.
 */
ipcMain.handle('window:is-maximized', async () => Boolean(mainWindow && mainWindow.isMaximized()));
ipcMain.handle('window:close', async () => { if (mainWindow) mainWindow.close(); });

ipcMain.handle('theme:palette', async () => {
  try {
    if (fs.existsSync(CHROME_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CHROME_FILE, 'utf8'));
      if (saved && saved.palette) return saved.palette;
    }
  } catch (err) { /* the window falls back to its own colours */ }
  return null;
});

ipcMain.handle('cloud:status', async () => {
  const connected = fs.existsSync(CLOUD_CONFIG_FILE);
  let sync = null;
  try {
    const response = await fetch('http://127.0.0.1:5055/status', {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) sync = await response.json();
  } catch (e) {
    // agent not running - connected but no live status
  }
  return { connected, sync };
});

ipcMain.handle('cloud:signup', () => shell.openExternal('https://posnic.com/cloud'));

// Does the local database contain an actual business (post-download check)?
ipcMain.handle('cloud:check-data', async () => {
  try {
    const { MongoClient } = require('mongodb');
    let uri = `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;
    const credFile = path.join(app.getPath('userData'), '.mongodb-credentials.json');
    if (fs.existsSync(credFile)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (creds.uri) uri = creds.uri;
      } catch (e) { /* fall through */ }
    }
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    const db = client.db('PosnicPro');
    const users = await db.collection('users').countDocuments();
    const branches = await db.collection('branches').countDocuments();
    await client.close();
    return { ok: true, users, branches };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('cloud:disconnect', async () => {
  try {
    if (syncAgentManager) syncAgentManager.stop();
    if (fs.existsSync(CLOUD_CONFIG_FILE)) fs.unlinkSync(CLOUD_CONFIG_FILE);
    createMenu();
    if (tray && tray.rebuildMenu) tray.rebuildMenu();
    console.log('[Cloud] Device disconnected from cloud');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// Desktop tools — lets the web UI open the same managers the File menu and
// tray expose (discoverability; menu/tray remain the crash-safe fallback).
ipcMain.handle('desktop:open', (_event, target) => {
  switch (target) {
    case 'hardware': openHardwareManager(); break;
    case 'backup': if (!fs.existsSync(CLOUD_CONFIG_FILE)) openBackupManager(); break;
    case 'update': openUpdateManager(); break;
    case 'cloud': openCloudManager(); break;
    /* The viewer rather than the file. shell.openPath handed a 40,000 line
       log to whatever the machine associates with .log - Notepad on Windows,
       often nothing at all on Linux - which is not a thing a shopkeeper can
       use. openLogViewer keeps a way out to the folder. */
    case 'log': openLogViewer(); break;
    /* The renderer names an intent and this decides the address. Letting a page
       pass its own URL here would turn an allowlist into an open redirect for
       anything that can reach this channel. */
    case 'releases': shell.openExternal('https://github.com/Posnic/POS/releases'); break;
    default: return false;
  }
  return true;
});
ipcMain.handle('desktop:capabilities', () => ({
  desktop: true,
  backup: !fs.existsSync(CLOUD_CONFIG_FILE)
}));

async function clearStartupBrowserCache() {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['cachestorage']
    });
    console.log('[Main] Browser cache cleaned before startup');
  } catch (error) {
    console.warn('[Main] Browser cache cleanup skipped:', error.message);
  }
}

// Check if API server is ready
function waitForApiServer(callback, attempts = 0) {
  if (attempts === 0) {
    console.log('Waiting for API server to start...\n');
  }

  if (attempts >= 60) {
    console.error('\nERROR: API server failed to start after 60 attempts');
    console.error('Please check if MongoDB is running and accessible\n');
    return;
  }

  http.get(`http://localhost:${apiPort()}/api`, (res) => {
    if (res.statusCode === 200 || res.statusCode === 404) {
      console.log('\nAPI server is ready!');
      console.log(`API Endpoint: http://localhost:${apiPort()}/api\n`);
      callback();
    } else {
      setTimeout(() => waitForApiServer(callback, attempts + 1), 500);
    }
  }).on('error', () => {
    if (attempts === 0 || attempts % 10 === 0) {
      console.log(`Waiting for API server... (${attempts + 1}/60)`);
    }
    setTimeout(() => waitForApiServer(callback, attempts + 1), 500);
  });
}

// First successful launch shows progress. Later launches initialize in the
// background and reveal the window only when login/dashboard is ready.
function createWindow(showStartupLoader = !isWarmStartup()) {
  console.log('Creating Electron window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    /*
     * Opened in the colours this shop chose, not in white.
     *
     * The window is painted by Windows before a single line of the app runs,
     * so a default here is a white flash on every launch of a dark till - and
     * the window controls stayed white permanently, which read as a light
     * application wearing a dark skin. Remembered from the last run, because
     * the renderer that knows the theme has not started yet.
     */
    backgroundColor: rememberedChrome().background,
    autoHideMenuBar: true, // clean chrome; menu on Alt, tools in tray + in-app
    icon: appIconPath(),
    /*
     * Hidden, and with no overlay at all.
     *
     * The OS title bar is whatever height Windows decides and shrinks when
     * maximised, which is why no stylesheet ever changed it. Hiding it and
     * letting Windows overlay only the buttons handed the height back - but
     * that overlay is a surface Windows paints its own way, so the strip showed
     * two shades however carefully it was handed one colour, and a shop
     * reported it three times.
     *
     * The page draws the buttons instead, in PosnicPro.js, so the strip is one
     * element with one background and there is nothing left to disagree.
     */
    /*
     * On macOS this leaves the traffic lights in place and removes only the
     * title strip - which is why the window had two sets of controls: Apple's
     * three circles top-left, and ours top-right, drawn by the page because
     * Windows needed them.
     *
     * hiddenInset keeps the single-colour strip the comment above is about and
     * insets the native buttons so they sit level with the bar rather than
     * crowding its edge. The page hides its own set - see the
     * window:native-controls flag below - so there is one way to close the
     * window, in the place a Mac user already looks for it.
     */
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    /* Room for the traffic lights, so the page's own toolbar does not start
       underneath them. */
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: (TITLEBAR_HEIGHT - 16) / 2 } }
      : {}),
    show: showStartupLoader && !global.__posnicStartHidden,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* sandbox and webSecurity match the main window. They were absent here,
         which made these the weakest renderers in the application. */
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  /*
   * The splash goes as soon as there is a real window to look at.
   *
   * On 'show' rather than 'ready-to-show': a warm start creates the window
   * hidden and reveals it later, and taking the splash down at creation would
   * leave the screen empty again for the gap in between.
   *
   * The timeout is the backstop. If startup fails in a way that never shows a
   * window, a splash that sits there forever with a moving bar is a worse
   * failure than the one underneath it.
   */
  mainWindow.once('show', closeSplash);
  /* A cold start creates the window with show: true, so that event has
     already fired by the time this listener is attached. */
  if (mainWindow.isVisible()) closeSplash();
  setTimeout(closeSplash, 90 * 1000);

  /*
   * One set of window buttons on macOS, not two.
   *
   * The page draws minimise, maximise and close itself because Windows needed
   * that - see the titleBarStyle comment in createWindow. macOS keeps its own
   * traffic lights whatever the title bar style, so a Mac showed Apple's three
   * circles top-left and ours top-right, and neither looked like a mistake on
   * its own.
   *
   * Injected from here rather than changed in the page: the page is shared
   * with the browser build, where there is no native chrome to defer to and
   * its buttons are the only ones there are. A stylesheet applied only to this
   * window says "this window has native controls" without teaching the page
   * about operating systems.
   */
  if (process.platform === 'darwin') {
    const macChrome = `
      .posnic-window-controls { display: none !important; }
      /* Clear the traffic lights, which sit at the left of the same strip. */
      .posnic-titlebar, .posnic-topbar { padding-left: 78px !important; }
    `;
    const applyMacChrome = () => {
      mainWindow.webContents.insertCSS(macChrome).catch(() => { /* page gone */ });
    };
    /* Every navigation, not just the first: the till moves between pages and a
       stylesheet inserted once does not survive that. */
    mainWindow.webContents.on('dom-ready', applyMacChrome);
  }

  // Prevent "Not Responding" by responding to system events
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('[Renderer] Main window started loading:', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === -3) {
        console.log('[Renderer] Navigation replaced/aborted:', validatedURL);
        return;
      }
      console.error('[Renderer] Page load failed:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
    }
  );

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[Renderer] Preload script failed:', { preloadPath }, error);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer] Render process gone:', details);
  });

  mainWindow.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.warn('[Renderer console]', { level, message, line, sourceId });
      }
    }
  );

  mainWindow.on('unresponsive', () => {
    console.error('[Renderer] Main window became unresponsive', {
      url: mainWindow?.webContents?.getURL()
    });
  });

  mainWindow.on('responsive', () => {
    console.log('[Renderer] Main window became responsive again');
  });

  // Close-to-tray (Slack behavior): X hides the window, the app and its
  // database keep running. Quit via tray or File menu performs the real
  // graceful shutdown.
  mainWindow.on('close', (event) => {
    if (shutdownInProgress) return; // real quit in progress - allow close
    event.preventDefault();

    /*
     * Lock on the way to the tray.
     *
     * Pressing X hides the window rather than quitting, so the page is never
     * reloaded and the lock that runs on load never gets a chance to. Somebody
     * stepping away and closing the till reasonably believes they have put it
     * away; without this anyone could restore it from the tray and carry on in
     * their session. The page ignores this when the shop has the lock off.
     */
    try { mainWindow.webContents.send('lock:now'); } catch (e) { /* window gone */ }

    mainWindow.hide();
    if (tray && !closeToTrayHintShown) {
      closeToTrayHintShown = true;
      try {
        tray.displayBalloon({
          title: 'Posnic is still running',
          content: 'Billing and sync continue in the background. Right-click this icon to open or quit.'
        });
      } catch (e) { /* balloon unsupported - fine */ }
    }
  });

  if (showStartupLoader) {
    mainWindow.loadFile('loading.html');
    console.log('Electron window created with loading screen\n');
  } else {
    console.log('Warm startup - checks running in background\n');

    /*
     * Do not stay invisible for a whole minute.
     *
     * A warm start keeps the window hidden and reveals it once login is
     * ready, which is fine when that takes a second. It does not: measured
     * startups here run 27 to 58 seconds, and every new build re-extracts the
     * dependency archive on top of that. All the shop sees in that time is a
     * tray icon, so the app looks like it failed to open - which is exactly
     * what it was reported as.
     *
     * If we are still hidden after a couple of seconds, show the loading
     * screen. Someone waiting on a progress bar is waiting; someone staring at
     * an empty desktop is filing a bug or double-clicking again.
     */
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible() || global.__posnicStartHidden) return;

      /*
       * Not if the real interface is already on its way.
       *
       * The only guard here was isVisible(), and a page that is loading is not
       * yet visible - so when startup finished at almost exactly this timeout,
       * loading.html aborted the dashboard navigation, satisfied the dom-ready
       * that loadPageAndReveal was waiting for, and left the till showing a
       * spinner while every log line claimed success.
       *
       * loadPageAndReveal sets this before it navigates. If it is set, the
       * interface is seconds away and the loading screen would only get in
       * front of it.
       */
      if (global.__posnicInterfaceLoading) {
        console.log('Startup is taking a moment, but the interface is already loading');
        return;
      }

      mainWindow.loadFile('loading.html').catch(() => {});
      mainWindow.show();
      console.log('Startup is taking a moment; showing the loading screen');
    }, 2500);
  }

  // Initialize update system (production-only, electron-updater based)
  const { setupUpdateIPC } = require('./update-integration');
  /* Kept so the quit handler can ask whether an update is waiting. */
  updateService = setupUpdateIPC({
    beforeInstall: async () => {
      const result = await getBackupManager().runBackup({
        force: true,
        _manual: true,
        reason: 'before-update-install'
      });

      if (!result || !result.success) {
        throw new Error(result?.error || 'Backup failed before update install');
      }

      return result;
    },

    /* So the Updates window can offer "go back" beside the button that applied
       the update, rather than only from a menu a shopkeeper never opens. */
    assetUpdater,
  });

  // Make updateMenuBadge available globally for UpdateService
  global.updateMenuBadge = updateMenuBadge;

  // Handle new window requests - allow downloads but prevent empty windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // For PDF URLs, trigger download and prevent window
    if (url.includes('Pdf') || url.includes('pdf') || url.includes('PDF')) {
      // Download the file using Electron's download manager
      mainWindow.webContents.downloadURL(url);
      return { action: 'deny' };
    }

    let parsed = null;
    try { parsed = new URL(url); } catch (e) { parsed = null; }
    const isLocalApp =
      parsed && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

    // Internal app pages opened with target="_blank" (Customer Display,
    // Catalog Display, etc.) must open as a real second window pointing at
    // the bundled server instead of being blocked.
    if (isLocalApp) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1024,
          height: 768,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            preload: path.join(__dirname, 'preload.js')
          }
        }
      };
    }

    // Any genuinely external link opens in the user's default browser.
    if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      shell.openExternal(url);
    }

    // Deny other popup windows
    return { action: 'deny' };
  });

  /*
   * Deny every permission, and every navigation away from our own pages.
   *
   * Neither of these existed. Electron's default is to hand a permission
   * request straight to Chromium's own logic, which for a desktop application
   * means a page could ask for the camera, the microphone, geolocation,
   * notifications or clipboard-read and get them - and the pages loaded here
   * include a legacy frontend served with 'unsafe-eval' in its CSP.
   *
   * A point of sale needs none of them. Printing goes through IPC to the main
   * process; it is not a browser permission.
   */
  const ALLOWED_PERMISSIONS = new Set([
    /* Fullscreen: the customer display uses it, and it grants no access to
       anything. */
    'fullscreen',
    /* Clipboard and notifications: a copy button or a toast is ordinary POS
       behaviour, and a library may reach for the permissioned API rather than
       document.execCommand. Neither can read anything the page cannot. */
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
    'pointerLock',
  ]);

  /*
   * What is deliberately NOT on that list: camera, microphone, geolocation,
   * display-capture, serial, usb, hid, midi and idle-detection. A point of sale
   * needs none of them, and the scale and printer are driven from the main
   * process through IPC rather than through the Web Serial API - denying
   * 'serial' here does not touch them.
   *
   * Every refusal is logged with its name, so if some page turns out to need
   * one, it says so in app.log rather than failing silently.
   */

  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowed = ALLOWED_PERMISSIONS.has(permission);
      if (!allowed) {
        console.log(`[Security] denied permission request: ${permission}`);
      }
      callback(allowed);
    }
  );

  /* The synchronous sibling. Some permissions are checked rather than
     requested, and a handler that only covers the asynchronous path leaves
     those at Chromium's default. */
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => ALLOWED_PERMISSIONS.has(permission)
  );

  /*
   * Top-level navigation may only go to pages this application serves. Without
   * this, one crafted link - or one injected script in a frontend that allows
   * inline JavaScript - can move the main window to a remote origin while
   * keeping the preload bridge alive.
   */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed = null;
    try { parsed = new URL(url); } catch { parsed = null; }

    /* Any loopback port, not only the API's. A second local port - a customer
       display, a catalog window - is ordinary, and pinning this to one port
       would break it for no security gain: anything already running on this
       machine's loopback interface can reach the API anyway. */
    const local =
      parsed &&
      ((parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === '[::1]')) ||
        parsed.protocol === 'file:');

    if (!local) {
      console.log(`[Security] blocked navigation to ${url}`);
      event.preventDefault();
      /* Somewhere to go is better than a dead click: send it to the browser,
         which is where an external link belonged in the first place. */
      if (parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });

  /* Attaching a webview would create a renderer this file never configured. */
  mainWindow.webContents.on('will-attach-webview', (event) => {
    console.log('[Security] blocked a webview attachment');
    event.preventDefault();
  });

  // Handle downloads - show save dialog
  mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
    // setSavePath must happen during will-download. If we wait on the async
    // dialog promise, Chromium may already start writing to its default path.
    const filename = item.getFilename ? item.getFilename() : path.basename(item.getURL());
    const defaultPath = path.join(app.getPath('downloads'), filename || 'download');
    const ext = path.extname(filename || '').replace('.', '');
    const filters = ext
      ? [
          { name: `${ext.toUpperCase()} files`, extensions: [ext] },
          { name: 'All files', extensions: ['*'] }
        ]
      : [{ name: 'All files', extensions: ['*'] }];

    const result = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save file',
      defaultPath,
      buttonLabel: 'Save',
      filters
    });

    if (!result) {
      try { item.cancel(); } catch (e) { /* ignore */ }
      return;
    }

    try {
      item.setSavePath(result);
    } catch (e) {
      console.error('Failed to set save path for download:', e.message);
      try { item.cancel(); } catch (cancelError) { /* ignore */ }
      return;
    }

    item.on('updated', (evt, state) => {
      if (state === 'interrupted') {
        console.warn('Download interrupted:', filename);
      }
    });

    item.once('done', (evt, state) => {
      if (state === 'completed') {
        console.log('Download completed:', result);
      } else {
        console.error('Download failed:', state);
      }
    });
  });

  // Chromium does not show its normal beforeunload prompt inside Electron.
  // Surface an explicit native warning for protected unsaved forms instead.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Stay', 'Leave'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved Changes',
      message: 'You have unsaved changes.',
      detail: 'Leave this page without saving your changes?',
      noLink: true,
    });
    if (choice === 1) {
      // In Electron, preventDefault here means ignore the renderer's block
      // and allow the requested close/navigation to continue.
      event.preventDefault();
    }
  });

  /*
   * Tell the page whenever the window is maximised or restored.
   *
   * Not only when its own button is pressed: double-clicking the title bar, the
   * Windows snap gesture and Win+Up all do it too, and a button that only knew
   * about its own clicks would go out of step the first time a shop used any of
   * them.
   */
  for (const [event, maximized] of [['maximize', true], ['unmaximize', false]]) {
    mainWindow.on(event, () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('window:maximize-changed', maximized);
        }
      } catch (e) { /* the page will ask again on its next load */ }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Redirect to installation wizard for first time setup
async function redirectToWizard() {
  if (mainWindow) {
    await mainWindow.loadFile('install-wizard.html');
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    writeStartupPerformanceSummary('Installation wizard');
    markInterfaceReady('Installation wizard');
    console.log('Redirected to installation wizard\n');

    // Print setup message
    console.log('=======================================================');
    console.log('   FIRST TIME SETUP - INSTALLATION WIZARD');
    console.log('=======================================================');
    console.log(`Server:          http://localhost:${apiPort()}`);
    console.log(`  - API Endpoint:  http://localhost:${apiPort()}/api`);
    console.log('Please complete the installation wizard to continue');
    console.log('=======================================================\n');
  }
}

// Redirect to login page when server is ready
async function redirectToLogin() {
  if (mainWindow) {
    const origin = `http://localhost:${apiPort()}`;
    const cookies = await session.defaultSession.cookies.get({ url: origin });
    const hasSavedCookie = hasUnexpiredAuthCookie(cookies);
    const hasSavedLogin = hasSavedCookie
      ? await validateSavedLogin(origin, cookies)
      : false;

    if (hasSavedCookie && !hasSavedLogin) {
      console.warn('[Auth] Saved login is no longer valid; clearing stale session');
      await clearStaleLogin(session.defaultSession.cookies, origin, console);
    }

    const targetUrl = hasSavedLogin
      ? `${origin}/public/dashboard.html#/dashboard`
      : `${origin}/public/login.html`;

    await loadPageAndReveal(targetUrl);
    if (!hasSavedLogin) {
      mainWindow.webContents.executeJavaScript(`
        localStorage.removeItem('posnic_jwt_token');
        document.cookie = 'loginuser=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      `).catch(error => console.warn('[Auth] Renderer token cleanup skipped:', error.message));
    }
    writeStartupPerformanceSummary(hasSavedLogin ? 'Dashboard' : 'Login');
    markInterfaceReady(hasSavedLogin ? 'Dashboard' : 'Login');
    console.log(hasSavedLogin
      ? 'Saved login found - redirected directly to dashboard\n'
      : 'Redirected to login page\n');

    // Start backup scheduler now that everything is ready
    try {
      const mgr = getBackupManager();
      const config = mgr.loadConfig();
      if (config.enabled) {
        mgr.startScheduler();
        console.log('📦 Backup scheduler started');
      } else {
        console.log('📦 Backup scheduler disabled in config');
      }
    } catch (e) {
      console.error('Failed to start backup scheduler:', e.message);
    }

    // Print success message
    console.log('=======================================================');
    console.log('   APPLICATION STARTED SUCCESSFULLY!');
    console.log('=======================================================');
    console.log(`Server:          http://localhost:${apiPort()}`);
    console.log(`  - API Endpoint:  http://localhost:${apiPort()}/api`);
    console.log(`  - web:      http://localhost:${apiPort()}/public/login.html`);
    console.log('Database:        PosnicPro');
    console.log('=======================================================\n');
  }
}

// Stop servers
function stopServers() {
  console.log('\nStopping servers...');
  if (apiServer && apiServer.close) {
    apiServer.close(() => {
      console.log('Server stopped');
    });
  }
}

// Global variable to track update status for menu badge
let _updateMenuStatus = {
  available: false,
  downloaded: false,
  version: null
};

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Hardware Manager',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            openHardwareManager();
          }
        },
        // Local file backup/export is a local-edition feature; cloud
        // subscribers' data is backed up by Posnic Cloud.
        ...(fs.existsSync(CLOUD_CONFIG_FILE) ? [] : [{
          label: 'Backup Manager',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            openBackupManager();
          }
        }]),
        {
          label: getUpdateMenuLabel(),
          accelerator: 'CmdOrCtrl+U',
          click: () => {
            openUpdateManager();
          }
        },
        {
          label: 'Posnic Cloud...',
          click: () => {
            openCloudManager();
          }
        },
        // Cache, sign-out, DevTools and the reset now live under Maintenance,
        // together, rather than scattered down File where nobody found them.
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'F5',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          }
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
            }
          }
        }
      ]
    },
    {
      /*
       * Maintenance lives in the shell, not in a page.
       *
       * Every item here is for the case where the app itself is misbehaving -
       * a stuck cache, a window dragged off a screen that is no longer
       * attached, a log somebody needs to send. A page inside the app cannot
       * be relied on to open at exactly the moment these are wanted.
       */
      label: 'Maintenance',
      submenu: [
        {
          label: 'Clear Cache',
          click: () => { clearHistoryAndCache(); }
        },
        {
          label: 'Clear Cookies && Sign-in',
          click: () => { clearCookiesAndStorage(); }
        },
        { type: 'separator' },
        {
          label: 'Open Log Folder',
          click: () => { openLogFolder(); }
        },
        {
          label: 'Copy Diagnostics',
          click: () => {
            const { clipboard, dialog } = require('electron');
            clipboard.writeText(JSON.stringify(collectDiagnostics(), null, 2));
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Diagnostics Copied',
              message: 'System information copied to the clipboard.',
              detail: 'Paste it into your support message. It contains the app '
                + 'version, this machine\'s details and its device id - no sales, '
                + 'customer or item data.',
            });
          }
        },
        {
          /*
           * One file to attach to a support message.
           *
           * The alternative is asking a shopkeeper to find %APPDATA%, copy a
           * log, and separately describe their version and platform. This is
           * the offline half of reporting a problem: it works with no cloud
           * account and no network, and the shop can read the file before
           * sending it, which is the honest way to ask for someone's logs.
           */
          label: 'Save Support Bundle...',
          click: async () => {
            const { dialog } = require('electron');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Save Support Bundle',
              defaultPath: path.join(app.getPath('desktop'), `support-${stamp}.txt`),
              filters: [{ name: 'Text', extensions: ['txt'] }],
            });
            if (canceled || !filePath) return;
            try {
              const body = '=== SYSTEM INFORMATION ===\n'
                + JSON.stringify(collectDiagnostics(), null, 2)
                + '\n\n=== APPLICATION LOG (most recent) ===\n'
                + tailLog();
              fs.writeFileSync(filePath, body, 'utf8');
              require('electron').shell.showItemInFolder(filePath);
            } catch (e) {
              dialog.showErrorBox('Could not save', e.message);
            }
          }
        },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          /*
           * Undo the last update, without needing a network.
           *
           * A pointer move and a restart. The machine most likely to need this
           * is the one that cannot reach us, so it must not depend on being
           * able to download anything.
           */
          label: 'Revert Last Update',
          click: async () => {
            const { dialog } = require('electron');
            const status = assetUpdater.status();
            if (!status.active) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Nothing to Revert',
                message: 'This installation is running the version it was installed with.',
              });
              return;
            }
            const target = status.previous || 'the installed version';
            const answer = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Revert & Restart', 'Cancel'],
              defaultId: 1,
              title: 'Revert Last Update',
              message: `Go back to ${target}?`,
              detail: `Currently running ${status.active}.\n\n`
                + 'Only the application files change. Sales, items, customers '
                + 'and settings are not touched.',
            });
            if (answer.response !== 0) return;
            const result = assetUpdater.revert();
            if (!result.ok) {
              dialog.showErrorBox('Could not revert', result.reason || 'unknown');
              return;
            }
            app.relaunch();
            app.exit(0);
          }
        },
        {
          label: 'Reset Window Size && Position',
          click: () => { resetWindowState(); }
        },
        {
          label: 'Remove Account && Reset Installation',
          click: () => { confirmFullAccountRemoval(); }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Contact Support…',
          click: () => { openSupportRequest(); }
        },
        {
          /* The first thing support asks for, so it is one click from the
             menu bar rather than a path somebody has to be talked through. */
          label: 'View Application Log',
          click: () => { openLogViewer(); }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => { openAboutWindow(); }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Get dynamic label for Software Updates menu item
function getUpdateMenuLabel() {
  if (_updateMenuStatus.downloaded) {
    return `Software Updates  🔄 Restart to Update`;
  } else if (_updateMenuStatus.available) {
    return `Software Updates  🔴 New Version Available`;
  } else {
    return 'Software Updates';
  }
}

// Update menu when update status changes
function updateMenuBadge(status) {
  _updateMenuStatus.available = (status === 'available' || status === 'downloading' || status === 'downloaded');
  _updateMenuStatus.downloaded = (status === 'downloaded');

  // Recreate menu with new badge
  createMenu();
}

/* ------------------------------------------------------------------ *
 * Window chrome that follows the shop's theme
 *
 * The title bar is drawn by Windows, before the app has run, so it cannot ask
 * the page what colour to be. It is told after each theme change and remembers
 * the answer for next launch - which is why a dark till now opens dark instead
 * of flashing white and then settling.
 * ------------------------------------------------------------------ */

const CHROME_FILE = path.join(app.getPath('userData'), 'window-chrome.json');
const { chromeFor, CHROME_FALLBACK } = require('./window-chrome');

function rememberedChrome() {
  try {
    if (fs.existsSync(CHROME_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CHROME_FILE, 'utf8'));
      if (saved && saved.color && saved.symbolColor) {
        return { ...CHROME_FALLBACK, ...saved };
      }
    }
  } catch (err) { /* first run, or unreadable - the default is fine */ }
  return CHROME_FALLBACK;
}

/*
 * Take the colours the page just applied.
 *
 * Wrapped so that a theme this cannot parse leaves the window exactly as it
 * was. A wrong-coloured title bar is a blemish; a crash here would be a till
 * that will not open, and the two are not close.
 */
function applyWindowChrome(theme) {
  try {
    const chrome = chromeFor(theme || {});
    /*
     * The overlay is a Windows feature.
     *
     * The method exists on every platform, so the `setTitleBarOverlay` check
     * above passed on Linux and then threw "Titlebar overlay is not enabled" -
     * an error logged on every theme change, for a call that was never going
     * to do anything there. macOS and Linux draw their own controls, which is
     * why titleBarStyle differs per platform in createWindow.
     *
     * The colours still reach the page either way; this is only the strip
     * Windows paints itself.
     */
    if (process.platform === 'win32'
        && mainWindow && !mainWindow.isDestroyed() && mainWindow.setTitleBarOverlay) {
      mainWindow.setTitleBarOverlay({
        color: chrome.color,
        symbolColor: chrome.symbolColor,
        height: TITLEBAR_HEIGHT - 1,
      });
    }
    fs.writeFileSync(CHROME_FILE, JSON.stringify({ ...chrome, palette: theme || null }));
    return { ok: true, ...chrome };
  } catch (err) {
    console.warn('[chrome] could not apply theme to the window:', err.message);
    return { ok: false, error: err.message };
  }
}

/*
 * About: what build is this, and where do I get help.
 *
 * The old one was a hardcoded "Posnic" gradient with a version number, which
 * told a white-labelled shop the wrong product name and told support nothing
 * it could act on. This carries the brand the build actually shipped with, the
 * numbers a support call opens with, and the one button that saves the call
 * ten minutes.
 */
/* ---- asking for help, from inside the till ------------------------------
 *
 * Where a support request goes is derived from the cloud the till is already
 * talking to, rather than hardcoded to ours.
 *
 * This is open source and people run their own. A shop whose till syncs to
 * gateway.theirsupplier.com should reach *their* supplier when they press
 * Contact Support - not us, who have never heard of them and cannot help.
 * Hardcoding posnic.com would make the button actively misleading for every
 * deployment that is not ours.
 *
 * The rule is: take the host the till syncs to and drop the leftmost label.
 *
 *   gateway.posnic.com      -> posnic.com
 *   sync.theirsupplier.com  -> theirsupplier.com
 *   posnic.com              -> posnic.com      (already the bare domain)
 *
 * Two labels are left alone, so a gateway that is already the apex is not
 * reduced to a public suffix. A till with no cloud configured falls back to
 * ours, because a Community Edition user has nobody else to ask and we would
 * rather hear from them.
 */
const SUPPORT_FALLBACK = 'https://posnic.com';

function supportBaseUrl() {
  try {
    if (!fs.existsSync(CLOUD_CONFIG_FILE)) return SUPPORT_FALLBACK;
    const cfg = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
    if (!cfg.gatewayUrl) return SUPPORT_FALLBACK;

    const url = new URL(cfg.gatewayUrl);
    const labels = url.hostname.split('.');
    /* An IP address or a single-label host has no subdomain to strip. */
    const isIp = /^\d+(\.\d+){3}$/.test(url.hostname);
    const host = (isIp || labels.length <= 2) ? url.hostname : labels.slice(1).join('.');
    return `${url.protocol}//${host}${url.port ? ':' + url.port : ''}`;
  } catch (err) {
    return SUPPORT_FALLBACK;
  }
}

/*
 * What the machine can say about itself, so the shop does not have to.
 *
 * Asking a shopkeeper for their operating system version and how much memory
 * they have is asking them to do our job badly. This is the same information
 * we would end up requesting over three emails, gathered in one step - and
 * shown to them before it is sent, because a support form that quietly
 * collects things is not one people should trust.
 */
function supportSystemInfo() {
  const os = require('os');
  let cloud = null;
  try {
    if (fs.existsSync(CLOUD_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
      /* The gateway and device id, never the device token - that is a
         credential and has no business in a support email. */
      cloud = { gatewayUrl: cfg.gatewayUrl || null, deviceId: cfg.deviceId || null };
    }
  } catch (err) { /* not connected */ }

  return {
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform} ${os.release()} (${process.arch})`,
    osName: { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform,
    memoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    locale: app.getLocale(),
    uptimeMinutes: Math.round(process.uptime() / 60),
    cloud,
  };
}

const SUPPORT_LOG_LINES = 300;
const SUPPORT_ATTACH_MAX = 8 * 1024 * 1024;   // per request, across all files

ipcMain.handle('support:context', () => {
  let logTail = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      const text = fs.readFileSync(LOG_FILE, 'utf8');
      logTail = text.split(/\r?\n/).filter(Boolean).slice(-SUPPORT_LOG_LINES);
    }
  } catch (err) { /* a missing log must not stop somebody asking for help */ }

  const system = supportSystemInfo();

  return {
    endpoint: `${supportBaseUrl()}/api/support`,
    baseUrl: supportBaseUrl(),
    system,
    logTail,
    logLines: logTail.length,
    /*
     * Which door this shop should be sent to.
     *
     * A Cloud subscriber is paying for someone to answer, so their report goes
     * to that someone by email. Community Edition has no such contract - and
     * pretending otherwise, by taking their report into an inbox nobody has
     * promised to read, is worse than saying so. Their problem belongs on the
     * issue tracker, where it is public, searchable, and where the next person
     * with the same problem finds the answer.
     */
    isCloud: Boolean(system.cloud && system.cloud.gatewayUrl),
  };
});

/*
 * A GitHub issue, opened with everything already filled in.
 *
 * A Community Edition user reporting a bug should not have to work out what
 * version they are on or which platform - that is the part they get wrong,
 * and the part that makes an issue unanswerable.
 *
 * The log is deliberately not in the URL. A few hundred lines will not fit in
 * a query string, and half a log is worse than none; the window offers it as
 * a copy instead, so they can paste what matters.
 */
ipcMain.handle('support:open-issue', (_event, details) => {
  try {
    const d = details && typeof details === 'object' ? details : {};
    const s = supportSystemInfo();
    const body = [
      '### What happened',
      String(d.detail || '').slice(0, 4000) || '_Describe the problem here._',
      '',
      '### This computer',
      '```',
      `Posnic   ${s.app}`,
      `System   ${s.osName} ${s.platform}`,
      `Memory   ${s.memoryGB} GB`,
      `Electron ${s.electron} / Node ${s.node}`,
      `Locale   ${s.locale}`,
      'Edition  Community (no cloud connected)',
      '```',
      '',
      '### Log',
      '_Paste the log here — the Contact Support window has a button that copies it._',
    ].join('\n');

    const url = 'https://github.com/Posnic/POS/issues/new'
      + '?title=' + encodeURIComponent(String(d.subject || '').slice(0, 120))
      + '&body=' + encodeURIComponent(body);

    /* Only ever our issue tracker, whatever the page asked for. */
    shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('support:submit', async (_event, payload) => {
  try {
    const body = payload && typeof payload === 'object' ? payload : {};
    const size = JSON.stringify(body.attachments || []).length;
    if (size > SUPPORT_ATTACH_MAX) {
      return { ok: false, error: 'Those attachments are too large. Please keep them under 8 MB.' };
    }

    const res = await fetch(`${supportBaseUrl()}/api/support`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `The server replied ${res.status}` };
    return { ok: true, reference: data.reference || null };
  } catch (err) {
    /* Named plainly: a shop with no internet needs to know to phone instead,
       not to keep pressing a button. */
    return {
      ok: false,
      error: /fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(err.message)
        ? 'Could not reach the support server. Check the internet connection, or call the helpline.'
        : err.message,
    };
  }
});

let supportWindow = null;

function openSupportRequest() {
  if (supportWindow && !supportWindow.isDestroyed()) {
    supportWindow.focus();
    return;
  }
  supportWindow = new BrowserWindow({
    width: 760,
    height: 700,
    icon: appIconPath(),
    title: 'Contact Support',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  supportWindow.setMenuBarVisibility(false);
  supportWindow.loadFile('support-request.html');
  supportWindow.on('closed', () => { supportWindow = null; });
}

/*
 * Somewhere a shop can read their own log.
 *
 * The only route in was "Open Log", which called shell.openPath on a file that
 * can be tens of thousands of lines. On Windows that is Notepad; on a Linux
 * desktop with no handler for .log it is nothing at all, so the button did
 * visibly nothing. Neither helps somebody trying to tell us what went wrong.
 *
 * The window reads the file through IPC rather than loading it with a file://
 * URL, so the page keeps the same restrictions as every other window here -
 * no node integration, sandboxed, and a preload that exposes two calls.
 */
let logWindow = null;

function openLogViewer() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }
  logWindow = new BrowserWindow({
    width: 900,
    height: 640,
    icon: appIconPath(),
    title: 'Application Log',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  logWindow.setMenuBarVisibility(false);
  logWindow.loadFile('log-viewer.html');
  logWindow.on('closed', () => { logWindow = null; });
}

/*
 * Hand the log to the viewer.
 *
 * Capped rather than streamed: a log that has been running for months is
 * larger than a renderer should be asked to hold, and the part anybody wants
 * is the end. The cap is reported so the page can say it is showing a portion
 * rather than implying the file is short.
 */
const LOG_VIEW_MAX_BYTES = 2 * 1024 * 1024;

ipcMain.handle('logs:read', () => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { ok: true, lines: [], path: LOG_FILE, truncated: false };
    }
    const size = fs.statSync(LOG_FILE).size;
    const truncated = size > LOG_VIEW_MAX_BYTES;
    let text;
    if (truncated) {
      const fd = fs.openSync(LOG_FILE, 'r');
      try {
        const buf = Buffer.alloc(LOG_VIEW_MAX_BYTES);
        fs.readSync(fd, buf, 0, LOG_VIEW_MAX_BYTES, size - LOG_VIEW_MAX_BYTES);
        text = buf.toString('utf8');
        /* The first line of a mid-file read is usually half a line. */
        text = text.slice(text.indexOf('\n') + 1);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      text = fs.readFileSync(LOG_FILE, 'utf8');
    }
    return {
      ok: true,
      path: LOG_FILE,
      truncated,
      lines: text.split(/\r?\n/).filter((l) => l.length),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('logs:reveal', () => {
  try {
    shell.showItemInFolder(LOG_FILE);
    return true;
  } catch (err) {
    return false;
  }
});

function openAboutWindow() {
  const d = collectDiagnostics();
  /*
   * Whoever runs this shop's cloud, not necessarily us.
   *
   * The same reasoning as the support form: a till syncing to
   * gateway.theirsupplier.com should offer their supplier's support page, not
   * ours. Sending a white-label customer to a helpline that has never heard
   * of them is worse than offering no link at all.
   */
  const provider = supportBaseUrl();
  const win = new BrowserWindow({
    width: 480,
    /* Taller than it was: the content is grouped into three sections now, and
       a fixed window that clips its own footer is worse than one extra inch. */
    height: 660,
    icon: appIconPath(),
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;

  /* Inlined: this window is a data: URL, so it has no origin to resolve a
     file path against. */
  let logoTag = '';
  try {
    const mark = path.join(__dirname, 'builds', 'icon-256.png');
    if (fs.existsSync(mark)) {
      logoTag = `<img alt="" src="data:image/png;base64,${fs.readFileSync(mark).toString('base64')}">`;
    }
  } catch (e) { /* the window is still useful without the mark */ }

  /* Links leave for the shop's browser. Navigating this window instead would
     point a window that has a preload at a page we do not control. */
  /*
   * An allowlist, extended to whoever runs this shop's cloud.
   *
   * It was posnic.com and github.com only - so the moment the links above
   * started following the provider, a white-label customer's support link
   * would have been silently dropped and the link would have done nothing.
   * A silent no-op is the worst of the three outcomes here.
   *
   * Still an allowlist rather than "any https": this window has a preload,
   * and the point is that it never navigates to a page we did not choose.
   */
  const allowedOrigins = new Set(['https://posnic.com', 'https://github.com']);
  try { allowedOrigins.add(new URL(provider).origin); } catch (e) { /* keep the defaults */ }
  const opensExternally = (url) => {
    try { return allowedOrigins.has(new URL(url).origin); } catch (e) { return false; }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (opensExternally(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (opensExternally(url)) shell.openExternal(url);
  });
  /*
   * Grouped rather than one flat table.
   *
   * It was eight rows of unlabelled facts, which reads as a debug dump: the
   * version a shop is asked for on the phone sat between "Electron" and
   * "Build", equally weighted, so the one number that matters was the hardest
   * to find. Now the version is the headline, the rest is grouped under what
   * it is about, and the repository address is shown in full and copyable -
   * a link is no use to somebody reading it out or typing it on another
   * machine, which is exactly what an AGPL notice is for.
   */
  /* A value is escaped unless it is explicitly marked as markup we built
     ourselves - which is only ever the status pills below. Escaping by
     default and opting out once is safer than escaping and then unescaping
     with a regular expression, which is how a shop's own brand name could
     end up as markup in this window. */
  const asHtml = (markup) => ({ __html: markup });
  const rows = (pairs) => pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const cell = v && v.__html !== undefined ? v.__html : esc(v);
      return `<tr><th>${esc(k)}</th><td>${cell}</td></tr>`;
    })
    .join('');

  const REPO = 'https://github.com/Posnic/POS';

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { font-family: system-ui, "Segoe UI", sans-serif; margin: 0;
             background: #0f1420; color: #e8ecf5; font-size: 13px; }

      .hero { padding: 26px 24px 22px; text-align: center;
              background: linear-gradient(160deg, #223055, #131a2b);
              border-bottom: 1px solid rgba(255,255,255,.07); }
      .hero img { width: 58px; height: 58px; margin-bottom: 11px; background: #fff;
                  border-radius: 15px; padding: 7px; }
      .hero h1 { margin: 0; font-size: 23px; letter-spacing: -.01em; font-weight: 650; }
      .hero .ver { display: inline-block; margin-top: 8px; padding: 3px 12px;
                   border-radius: 999px; background: rgba(127,178,232,.16);
                   color: #9ec9f2; font-size: 12.5px; font-weight: 600;
                   font-variant-numeric: tabular-nums; }
      .hero .by { margin: 9px 0 0; font-size: 11.5px; opacity: .5; }

      .body { padding: 4px 0 0; }
      .sec { padding: 14px 24px 4px; }
      .sec h2 { margin: 0 0 7px; font-size: 10.5px; letter-spacing: .09em;
                text-transform: uppercase; color: #7f8ba3; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 5px 0; vertical-align: top; }
      th { color: #97a1b5; font-weight: 400; width: 44%; }
      td { font-variant-numeric: tabular-nums; }

      .pill { display: inline-block; padding: 1px 9px; border-radius: 999px;
              font-size: 11.5px; font-weight: 600; }
      .pill.on  { background: rgba(52,199,123,.16); color: #6ee7a8; }
      .pill.off { background: rgba(255,255,255,.08); color: #a9b3c6; }

      .repo { margin: 6px 24px 0; padding: 10px 12px; border-radius: 9px;
              background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); }
      .repo .u { font-family: ui-monospace, Consolas, monospace; font-size: 12px;
                 color: #9ec9f2; user-select: all; word-break: break-all; }
      .repo .n { margin-top: 5px; font-size: 11.5px; color: #8d97ab; line-height: 1.5; }

      .links { display: flex; flex-wrap: wrap; gap: 6px 16px;
               padding: 16px 24px 6px; border-top: 1px solid rgba(255,255,255,.07);
               margin-top: 14px; }
      .links a { color: #7fb2e8; text-decoration: none; font-size: 12.5px; }
      .links a:hover { text-decoration: underline; }

      .foot { padding: 6px 24px 22px; font-size: 11.5px; color: #8d97ab; line-height: 1.6; }
    </style></head><body>
    <div class="hero">
      ${logoTag}
      <h1>${esc(d.app.name)}</h1>
      <div class="ver">Version ${esc(d.app.version)}</div>
      ${d.app.name === 'Posnic'
        ? '<p class="by">by Posnic Innovations Private Limited &middot; Tamil Nadu, India</p>'
        : `<p class="by">powered by Posnic &middot; ${esc(new URL(provider).hostname)}</p>`}
    </div>

    <div class="body">
      <div class="sec">
        <h2>Your licence</h2>
        <table>${rows([
          ['Edition', d.cloud.connected ? 'Posnic Cloud' : 'Community Edition (free)'],
          ['Cloud sync', asHtml(d.cloud.connected
            ? '<span class="pill on">connected</span>'
            : '<span class="pill off">not connected</span>')],
          ['Outlets allowed', d.limits ? (d.limits.branches ?? 'unlimited') : null],
          ['Device id', d.cloud.connected ? d.cloud.deviceId : null],
        ])}</table>
      </div>

      <div class="sec">
        <h2>This computer</h2>
        <table>${rows([
          ['Operating system', d.machine.platform + ' ' + d.machine.release + ' (' + d.machine.arch + ')'],
          ['Timezone', d.machine.timezone],
          ['Build', d.app.packaged ? 'packaged release' : 'development'],
          ['Electron / Node', d.app.electron + ' / ' + d.app.node],
        ])}</table>
      </div>

      <div class="sec">
        <h2>Source code</h2>
      </div>
      <div class="repo">
        <div class="u">${esc(REPO)}</div>
        <div class="n">Posnic is free software under the <b>GNU AGPL-3.0</b>. Every line running
          on this computer is published there — you may read it, change it and pass it on.
          Select the address above to copy it.</div>
      </div>

      <div class="links">
        <a href="${provider}/support.html">Support &amp; helpline</a>
        <a href="${provider}/privacy.html">Privacy</a>
        <a href="${provider}/terms.html">Terms</a>
        <a href="${REPO}">Repository</a>
        <a href="${REPO}/issues">Report a problem</a>
        <a href="${REPO}/releases">Releases</a>
      </div>
      <div class="foot">
        Your sales and customers stay on this computer. Nothing here is sent anywhere
        unless you connect Posnic Cloud.<br>
        <b>Help &rarr; Contact Support</b> gathers all of this for you when you report a problem.
      </div>
    </div>
  </body></html>`;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/*
 * What a support person needs before they can help.
 *
 * A shop reporting "it stopped working" cannot be expected to find a version
 * number, a log file and a device id. This gathers the things that are asked
 * for on every single support call, so the answer to "what have you got?" is
 * one button rather than a conversation.
 *
 * Deliberately does not include the database, customer records or anything a
 * shop would be uncomfortable sending: version, platform, and its own settings.
 */
function collectDiagnostics() {
  const os = require('os');
  let brand = {};
  try {
    if (fs.existsSync(BRAND_FILE)) brand = JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8'));
  } catch (e) { /* unbranded build */ }

  let cloud = { connected: false };
  try {
    if (fs.existsSync(CLOUD_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8'));
      // The device id identifies the till to support. The token never leaves.
      cloud = { connected: true, gatewayUrl: cfg.gatewayUrl, deviceId: cfg.deviceId };
    }
  } catch (e) { /* not connected */ }

  let limits = null;
  try {
    const f = path.join(BRAND_DIR, 'limits.json');
    if (fs.existsSync(f)) limits = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { /* free edition */ }

  let assets = null;
  try { assets = assetUpdater.status(); } catch (e) { /* never blocks a report */ }

  return {
    app: {
      name: brand.name || app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      packaged: app.isPackaged,
    },
    // Which frontend is actually running, which is not always the one the
    // installer put there - the first question worth asking about a bug that
    // only one shop can reproduce.
    assets: assets && {
      active: assets.active || '(as installed)',
      previous: assets.previous,
      verifiesSignatures: assets.verifies,
      bootAttempts: assets.boot && assets.boot.attempts,
    },
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      memoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      locale: app.getLocale(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      machineId: getMachineId(),
    },
    cloud,
    limits,
    paths: { userData: app.getPath('userData'), log: LOG_FILE },
    collectedAt: new Date().toISOString(),
  };
}

/* The last of the log, capped so a report stays sendable. */
function tailLog(bytes = 200_000) {
  try {
    if (!fs.existsSync(LOG_FILE)) return '(no log file)';
    const stat = fs.statSync(LOG_FILE);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '(log unreadable: ' + e.message + ')';
  }
}

/*
 * Show the folder the log lives in.
 *
 * Support asks for the log on most calls, and talking somebody through
 * %APPDATA% over the phone is its own small ordeal.
 */
function openLogFolder() {
  const { shell } = require('electron');
  try {
    if (fs.existsSync(LOG_FILE)) shell.showItemInFolder(LOG_FILE);
    else shell.openPath(app.getPath('userData'));
  } catch (e) {
    console.warn('[Maintenance] could not open log folder:', e.message);
  }
}

/*
 * Put the window back to a sane size and position.
 *
 * For the case where a till is left with a window dragged half off a screen
 * that is no longer attached, which cannot be fixed from inside the window.
 */
function resetWindowState() {
  if (!mainWindow) return;
  try {
    mainWindow.unmaximize();
    mainWindow.setFullScreen(false);
    mainWindow.setSize(1280, 800);
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  } catch (e) {
    console.warn('[Maintenance] could not reset window:', e.message);
  }
}

/*
 * Sign this machine out without touching anything else.
 *
 * Separate from Clear History & Cache because the two are wanted at different
 * times: cache is a "it is behaving oddly" fix, cookies is "somebody else needs
 * to sign in here".
 */
function clearCookiesAndStorage() {
  const { dialog, session } = require('electron');
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Clear & Restart', 'Cancel'],
    defaultId: 1,
    title: 'Clear Cookies & Sign-in',
    message: 'Sign this machine out?',
    detail: 'Clears cookies and stored sign-in for this device.\n\n'
      + 'Sales, items and settings are NOT affected - nothing is deleted from '
      + 'the database. Whoever uses the till next will need to sign in.',
  }).then(async (result) => {
    if (result.response !== 0) return;
    try {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
      });
      console.log('[Maintenance] cookies and storage cleared');
    } catch (e) {
      console.error('[Maintenance] clear failed:', e.message);
    }
    app.relaunch();
    app.exit(0);
  });
}

// Clear history and cache (only Electron cache, NOT database)
function clearHistoryAndCache() {
  const { dialog } = require('electron');

  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Clear & Restart', 'Cancel'],
    defaultId: 1,
    title: 'Clear History & Cache',
    message: 'Clear application cache?',
    detail: 'This will:\n• Clear application cache\n• Clear local storage\n• Clear session data\n• Restart the application\n\nNote: Database will NOT be affected.'
  }).then(async result => {
    if (result.response !== 0) return;

    // User clicked "Clear & Restart"
    try {
      console.log('🧹 Clearing cache and local storage...');
      await clearRendererStorage();
      console.log('✅ Cache and storage cleared');

      // app.exit() below skips 'before-quit', so the API server, mongoose
      // connection and bundled MongoDB process are never released here.
      // The relaunched instance then fails to rebind those same ports.
      // Run the same graceful shutdown used by account reset / app quit
      // before relaunching so the new instance starts on a clean slate.
      console.log('🛑 Shutting down services before restart...');
      await performGracefulShutdown();

      console.log('🔄 Restarting application...');
      app.relaunch();
      app.exit(0);
    } catch (error) {
      console.error('❌ Error clearing history:', error);
      dialog.showErrorBox('Error', 'Failed to clear history and cache: ' + error.message);
    }
  });
}

function removePathIfExists(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function assertResetPathIsSafe(targetPath, allowedRoots) {
  const resolvedTarget = path.resolve(targetPath);
  const isAllowed = allowedRoots
    .filter(Boolean)
    .map(root => path.resolve(root))
    .some(root => resolvedTarget === root || resolvedTarget.startsWith(root + path.sep));

  if (!isAllowed) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedTarget}`);
  }
}

async function clearRendererStorage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  await Promise.all([
    mainWindow.webContents.session.clearCache(),
    mainWindow.webContents.session.clearStorageData({
      storages: ['appcache', 'cookies', 'localstorage', 'sessionstorage', 'websql', 'indexdb']
    })
  ]);
}

async function dropPosnicDatabase() {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI || `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });

  await client.connect();
  try {
    await client.db('PosnicPro').dropDatabase();
  } finally {
    await client.close();
  }
}

async function removeFullAccountData() {
  console.log('[AccountReset] Full account removal started');

  if (backupManager) backupManager.stopScheduler();
  await clearRendererStorage();
  await withTimeout(
    'Account reset API server',
    closeApiServer,
    SHUTDOWN_TIMEOUTS.apiServer
  );

  if (global.mongooseConnection) {
    await withTimeout(
      'Account reset MongoDB connection',
      () => global.mongooseConnection.close(false),
      SHUTDOWN_TIMEOUTS.mongoose
    );
  }

  try {
    await dropPosnicDatabase();
    console.log('[AccountReset] PosnicPro database dropped');
  } catch (error) {
    console.warn('[AccountReset] Database drop failed; local data files will still be removed if available:', error.message);
  }

  if (mongoDBManager) {
    await withTimeout(
      'Account reset bundled MongoDB process',
      () => mongoDBManager.stop(),
      SHUTDOWN_TIMEOUTS.bundledMongoDB
    );
  }

  const userDataPath = app.getPath('userData');
  const safeRoots = [
    path.join(userDataPath, 'mongodb'),
    path.join(__dirname, 'mongodb')
  ];

  const pathsToRemove = [
    path.join(userDataPath, '.mongodb-credentials.json'),
    path.join(userDataPath, '.mongodb-setup-done'),
    path.join(__dirname, '.mongodb-credentials.json'),
    path.join(__dirname, '.mongodb-setup-done'),
    path.join(__dirname, 'api', '.mongodb-credentials.json'),
    mongoDBManager?.dataPath,
    mongoDBManager?.logPath ? path.dirname(mongoDBManager.logPath) : null
  ].filter(Boolean);

  for (const targetPath of pathsToRemove) {
    const isMongoFolder = targetPath.includes(`${path.sep}mongodb${path.sep}`);
    if (isMongoFolder) {
      assertResetPathIsSafe(targetPath, safeRoots);
    }

    if (removePathIfExists(targetPath)) {
      console.log('[AccountReset] Removed:', targetPath);
    }
  }

  console.log('[AccountReset] Full account removal finished; relaunching');
}

function confirmFullAccountRemoval() {
  const { dialog } = require('electron');
  const focused = BrowserWindow.getFocusedWindow() || mainWindow;

  dialog.showMessageBox(focused, {
    type: 'warning',
    buttons: ['Cancel', 'Continue'],
    defaultId: 0,
    cancelId: 0,
    title: 'Remove Account & Reset Installation',
    message: 'Remove this Posnic account and database?',
    detail: 'This will permanently remove the local Posnic database, login/session data, and installation setup state. Backup folders in Documents\\Posnic-Backups will not be deleted.'
  }).then(first => {
    if (first.response !== 1) return;

    return dialog.showMessageBox(focused, {
      type: 'error',
      buttons: ['Cancel', 'Remove Account'],
      defaultId: 0,
      cancelId: 0,
      title: 'Final Confirmation',
      message: 'This action cannot be undone.',
      detail: 'After removal, Posnic will restart and show the installation wizard again. Use this only when you intentionally want a fresh account.'
    });
  }).then(second => {
    if (!second || second.response !== 1) return;

    removeFullAccountData()
      .then(() => {
        app.relaunch();
        app.exit(0);
      })
      .catch(error => {
        console.error('[AccountReset] Failed:', error);
        dialog.showErrorBox('Account Removal Failed', error.message);
      });
  }).catch(error => {
    console.error('[AccountReset] Confirmation failed:', error);
    dialog.showErrorBox('Account Removal Failed', error.message);
  });
}

// IPC handler for page navigation from install wizard
ipcMain.on('load-page', (event, page) => {
  if (page === 'login' && mainWindow) {
    redirectToLogin();
  }
});

// IPC handler to expose API port to renderer
ipcMain.handle('get-api-port', () => apiPort());

// =====================================================
// BACKUP MANAGER - Initialize and IPC handlers
// =====================================================
const BackupManager = require('./backup-manager');

let backupManager = null;

function getBackupManager() {
  if (!backupManager) {
    backupManager = new BackupManager({
      userDataPath: app.getPath('userData'),
      getMongoUri: () => process.env.MONGODB_URI || `mongodb://localhost:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`,
      dbName: 'PosnicPro'
    });

    // Wrap runBackup to add notifications for scheduled (auto) backups
    const originalRunBackup = backupManager.runBackup.bind(backupManager);
    backupManager.runBackup = async function (options = {}) {
      const isManual = !!options._manual;
      const result = await originalRunBackup(options);

      // Only show OS notification for scheduled (non-manual) backups
      // Manual backups get toast in the backup-manager.html
      if (!isManual) {
        try {
          showBackupNotification(result);
        } catch (e) {
          console.error('Failed to show backup notification:', e.message);
        }
      }

      // Broadcast to backup window if open (to refresh UI)
      try {
        if (backupWindow && !backupWindow.isDestroyed()) {
          backupWindow.webContents.send('backup:result', result);
        }
      } catch (e) { }

      return result;
    };
  }
  return backupManager;
}

function showBackupNotification(result) {
  if (!Notification || !Notification.isSupported || !Notification.isSupported()) return;

  let title, body, icon;
  if (result.success) {
    if (result.skipped) {
      title = '💾 Backup Skipped';
      body = 'No data changes since last backup (deduplication)';
    } else {
      title = '✅ Backup Complete';
      const sizeMB = ((result.size || 0) / 1024 / 1024).toFixed(2);
      body = `${result.collections} collections, ${result.totalDocuments} docs, ${sizeMB} MB`;
    }
  } else {
    title = '❌ Backup Failed';
    body = result.error || 'Unknown error';
  }

  const notification = new Notification({ title, body, silent: false });
  notification.show();
}

// Get default backup path (Documents/Posnic-Backups)
ipcMain.handle('backup:get-default-path', () => {
  try {
    const documentsPath = app.getPath('documents');
    return path.join(documentsPath, 'Posnic-Backups');
  } catch (e) {
    return path.join(app.getPath('userData'), 'backups');
  }
});

// Open folder picker
ipcMain.handle('backup:browse-folder', async () => {
  const { dialog } = require('electron');
  const focused = BrowserWindow.getFocusedWindow() || mainWindow;

  const result = await dialog.showOpenDialog(focused, {
    title: 'Select Backup Folder',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use This Folder'
  });

  if (result.canceled || !result.filePaths.length) return null;

  /*
   * Remember that the person at the keyboard chose this folder.
   *
   * Restore reads a database out of whatever folder it is handed and writes it
   * over the shop's data, and it is reachable from renderer IPC - so a page
   * that managed to run someone else's script could point it at a prepared
   * folder and replace the till's books. Restricting it to the configured
   * backup root would close that, and would also stop the legitimate case this
   * dialog exists for: restoring from a USB stick after a machine dies.
   *
   * So the main process keeps the paths that came back from its own dialog.
   * A renderer cannot add to this list; it can only name something already on
   * it. See backupManager.grantRestorePath.
   */
  if (backupManager) backupManager.grantRestorePath(result.filePaths[0]);
  return result.filePaths[0];
});

// Save backup config
ipcMain.handle('backup:save-config', (event, config) => {
  try {
    const mgr = getBackupManager();
    const saved = mgr.saveConfig(config);

    // Restart scheduler with new config
    mgr.stopScheduler();
    if (saved.enabled) {
      mgr.startScheduler();
    }

    return { success: true, config: saved };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get backup config
ipcMain.handle('backup:get-config', () => {
  try {
    return { success: true, config: getBackupManager().loadConfig() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/*
 * The commands for scheduling a backup with the operating system, with this
 * machine's real paths already in them.
 *
 * Backups are a timer inside the application, so a shop that shuts the till
 * down every evening never gets an overnight one. The scheduler is the only
 * thing that can run it with the app closed, and "point a scheduled task at
 * your Node installation" is not an instruction a shopkeeper can follow - so
 * the exact line is generated here to be copied rather than typed.
 */
ipcMain.handle('backup:schedule-instructions', (event, options) => {
  try {
    const scheduled = require('./scheduled-task');
    const config = getBackupManager().loadConfig();

    /* Default to whatever the shop already chose for the in-app schedule, so
       the printed command and the setting on screen agree. */
    const described = scheduled.describe({
      task: 'backup',
      frequency: (options && options.frequency) || config.frequency || 'daily',
      time: (options && options.time) || config.time || '22:00',
    });

    return {
      success: true,
      instructions: { ...described, destination: config.path },
      text: scheduled.asText(described),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Run backup now (manual trigger)
ipcMain.handle('backup:run-now', async (event, force) => {
  try {
    return await getBackupManager().runBackup({ force: !!force, _manual: true });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// List all backups
ipcMain.handle('backup:list', () => {
  try {
    return { success: true, backups: getBackupManager().listBackups() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Restore from backup
ipcMain.handle('backup:restore', async (event, folderPath, options) => {
  try {
    const result = await getBackupManager().restoreBackup(folderPath, options || {});

    // After successful restore: full app restart for a clean state.
    // Why a full restart? Because the live app has cached state at multiple layers:
    //   • web: JWT token in localStorage, in-memory React/JS state
    //   • API server: Mongoose connection pool, query caches, schema validators
    //   • Auth: JWT tokens signed pre-restore that reference old user IDs
    // Clearing only browser storage is not enough; the API server keeps stale
    // mongoose models/connections that cause 401s and crashes.
    // A clean restart guarantees everything reloads with the restored data.
    if (result.success) {
      // Schedule restart AFTER returning the success response to the renderer,
      // so the UI can show the success toast first.
      setTimeout(() => {
        try {
          console.log('🔄 Restore complete - restarting app for clean state...');

          // Clear all storage caches just to be safe
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.session.clearStorageData({
              storages: ['localstorage', 'sessionstorage', 'cookies', 'indexdb', 'cachestorage']
            }).catch(() => { });
          }

          app.relaunch();
          app.exit(0);
        } catch (e) {
          console.error('Failed to restart app:', e.message);
        }
      }, 2000); // 2 second delay so user sees the success toast
    }

    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete a backup
ipcMain.handle('backup:delete', (event, folderPath) => {
  try {
    return getBackupManager().deleteBackup(folderPath);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Get backup history
ipcMain.handle('backup:get-history', () => {
  try {
    return { success: true, history: getBackupManager().loadHistory() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open backup manager window
let tray = null;
let trayBranches = { branches: [], currentName: null };
let closeToTrayHintShown = false;
global.__posnicStartHidden = process.argv.includes('--hidden');

// 16x16 red status dot, drawn in code (BGRA) - no image asset needed
function makeStatusDot() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 8, cy = 8, r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r) {
        const i = (y * size + x) * 4;
        buf[i] = 60;      // B
        buf[i + 1] = 60;  // G
        buf[i + 2] = 235; // R
        buf[i + 3] = 255; // A
      }
    }
  }
  return electron.nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// Taskbar overlay dot when cloud sync is offline (cloud-activated devices only)
let syncBadgeTimer = null;
function startSyncBadgeWatcher() {
  const redDot = makeStatusDot();
  const check = async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!fs.existsSync(CLOUD_CONFIG_FILE)) {
      mainWindow.setOverlayIcon(null, '');
      return;
    }
    try {
      const response = await fetch('http://127.0.0.1:5055/status', { signal: AbortSignal.timeout(2000) });
      const status = response.ok ? await response.json() : null;
      if (status && status.online === false) {
        mainWindow.setOverlayIcon(redDot, 'Cloud sync offline');
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    } catch (e) {
      // agent not running yet - no badge
      mainWindow.setOverlayIcon(null, '');
    }
  };
  check();
  syncBadgeTimer = setInterval(check, 60_000);
}

function showMainWindowIfAllowed() {
  if (global.__posnicStartHidden) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
}

// The web UI reports the logged-in user's branch list (and reacts to switch
// requests) so the tray can offer one-click branch switching.
ipcMain.handle('tray:set-branches', (_event, data) => {
  trayBranches = {
    branches: Array.isArray(data?.branches) ? data.branches.slice(0, 20) : [],
    currentName: data?.currentName || null
  };
  if (tray && tray.rebuildMenu) tray.rebuildMenu();
  return true;
});

/*
 * The application icon, in a format this operating system can read.
 *
 * .ico is a Windows container. macOS and Linux cannot load one, so every place
 * that asked for app.ico got nothing off Windows - the tray silently failed
 * with "Failed to load image from path", and the windows fell back to a
 * generic icon. A shop on Ubuntu had an unbranded application and no tray at
 * all, which is also how the "close to tray" behaviour quietly stopped
 * existing there.
 *
 * PNG works on all three, so only Windows needs the .ico - and it genuinely
 * does, because that is what Windows wants for a taskbar and tray at multiple
 * sizes from one file.
 */
function appIconPath() {
  const file = process.platform === 'win32' ? 'app.ico' : 'app.png';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, file), path.join(process.resourcesPath, 'app.ico')]
    : [
        path.join(__dirname, 'builds', file === 'app.png' ? 'icon-256.png' : 'app.ico'),
        path.join(__dirname, 'builds', 'app.ico'),
      ];
  /* The .ico is kept as a last resort rather than returning nothing: a wrong
     icon is better than a missing window. */
  return candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || candidates[0];
}

function createTray() {
  try {
    const iconPath = appIconPath();
    if (!fs.existsSync(iconPath)) return;

    tray = new Tray(iconPath);
    tray.setToolTip('Posnic');

    const rebuild = () => {
      const branchItems = trayBranches.branches.length
        ? [
            {
              label: trayBranches.currentName
                ? `Branch: ${trayBranches.currentName}`
                : 'Switch Branch',
              submenu: trayBranches.branches.map((b) => ({
                label: b.name,
                type: 'radio',
                checked: !!b.current,
                click: () => {
                  if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send('tray:switch-branch', b.id);
                  }
                }
              }))
            },
            { type: 'separator' }
          ]
        : [];

      tray.setContextMenu(Menu.buildFromTemplate([
        {
          label: 'Open Posnic',
          click: () => { global.__posnicStartHidden = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
        },
        { type: 'separator' },
        ...branchItems,
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
          }
        },
        { label: 'Hardware Manager', click: () => openHardwareManager() },
        ...(fs.existsSync(CLOUD_CONFIG_FILE) ? [] : [
          { label: 'Backup Manager', click: () => openBackupManager() }
        ]),
        { label: 'Software Update', click: () => openUpdateManager() },
        { label: 'Posnic Cloud...', click: () => openCloudManager() },
        { type: 'separator' },
        {
          label: 'Restart App',
          /* The flag rather than app.relaunch() here: the graceful shutdown has to
             run first, stopping the API and the database, and the relaunch is armed
             at the end of it on the quit path that actually honours it. */
          click: () => { relaunchAfterQuit = true; app.quit(); }
        },
        { label: 'Quit Posnic', click: () => app.quit() }
      ]));
    };
    rebuild();
    tray.rebuildMenu = rebuild;
    tray.on('click', () => { global.__posnicStartHidden = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (err) {
    console.warn('[Tray] Could not create tray icon:', err.message);
  }
}

let cloudWindow = null;
function openCloudManager() {
  if (cloudWindow && !cloudWindow.isDestroyed()) {
    cloudWindow.focus();
    return;
  }
  cloudWindow = new BrowserWindow({
    width: 560,
    height: 680,
    icon: appIconPath(),
    title: 'Posnic Cloud',
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* sandbox and webSecurity match the main window. They were absent here,
         which made these the weakest renderers in the application. */
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  cloudWindow.setMenuBarVisibility(false);
  cloudWindow.on('closed', () => { cloudWindow = null; });
  cloudWindow.loadFile('cloud-setup.html').catch((error) => {
    console.error('Failed to load Posnic Cloud window:', error);
  });
}

function openBackupManager() {
  if (backupWindow) {
    backupWindow.focus();
    return;
  }

  backupWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: appIconPath(),
    title: 'Backup Manager',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* sandbox and webSecurity match the main window. They were absent here,
         which made these the weakest renderers in the application. */
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  backupWindow.setMenuBarVisibility(false);

  backupWindow.loadFile('backup-manager.html').catch((error) => {
    console.error('Failed to load Backup Manager:', error);
    if (backupWindow && !backupWindow.isDestroyed()) {
      backupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <html>
          <body style="font-family:Arial;padding:40px;background:#f5f6fa">
            <h2>Backup Manager could not be opened</h2>
            <p>${String(error.message || error)}</p>
            <p>Please install the latest Posnic build.</p>
          </body>
        </html>
      `)}`);
    }
  });

  backupWindow.on('closed', () => {
    backupWindow = null;
  });
}

// Open hardware manager window
function openHardwareManager() {
  if (hardwareWindow) {
    hardwareWindow.focus();
    return;
  }

  hardwareWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* sandbox and webSecurity match the main window. They were absent here,
         which made these the weakest renderers in the application. */
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  hardwareWindow.setMenuBarVisibility(false);

  hardwareWindow.loadFile('hardware-manager.html');

  hardwareWindow.on('closed', () => {
    hardwareWindow = null;
  });

  if (hardwareManager) {
    hardwareManager.setMainWindow(hardwareWindow);
  }
}

// Open update manager window
let updateWindow = null;
function openUpdateManager() {
  if (updateWindow) {
    updateWindow.focus();
    return;
  }

  updateWindow = new BrowserWindow({
    width: 700,
    height: 800,
    icon: appIconPath(),
    title: 'Software Update Manager',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      /* sandbox and webSecurity match the main window. They were absent here,
         which made these the weakest renderers in the application. */
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    },
    parent: mainWindow,
    modal: false
  });
  updateWindow.setMenuBarVisibility(false);

  updateWindow.loadFile('update-manager.html');

  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

// App ready
/**
 * Wait for the closing instance to actually go, then take the lock.
 *
 * @returns {Promise<boolean>} true if this process may now start
 *
 * Two things have to become true, and they are not the same thing: the old
 * process has to exit, and this one has to succeed in acquiring the lock it
 * previously failed to get. Checking only the pid would race - the process can
 * be gone a moment before the lock is released - so this asks for the lock
 * each time round and only believes it when it is granted.
 */
async function awaitPreviousShutdown(previous) {
  showWaitingForPrevious(require('electron'));

  const deadline = Date.now() + 45_000;   // longer than the 25s shutdown budget
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));

    if (app.requestSingleInstanceLock({ startedAt: new Date().toISOString(), pid: process.pid })) {
      const waited = Math.round((45_000 - (deadline - Date.now())) / 100) / 10;
      console.log(`[Main] The previous instance has closed after ${waited}s; starting`);
      return true;
    }

    /* If the old process has gone but the lock is still not ours, something
       else holds it - a genuinely separate instance - and waiting longer will
       not help. */
    if (!shutdownState.isAlive(previous.pid)) {
      console.log('[Main] The previous process has gone but the lock is held elsewhere');
      return false;
    }
  }
  return false;
}

app.whenReady().then(async () => {
  console.log('='.repeat(55));
  /* Named the platform it is actually on. The banner said "Windows" in
     every log, including the ones a Linux and macOS shop send us when
     something is wrong - which is a small thing that makes a support
     reader doubt everything under it. */
  const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform]
    || process.platform;
  console.log(`   Posnic for ${PLATFORM_NAME}`);
  console.log('='.repeat(55));
  console.log('');

  /*
   * Before anything else, so a double-click has something to show for itself.
   *
   * Ports, the database and the API take a few seconds, and with nothing on
   * screen the shop assumes the click missed and clicks again. It is closed by
   * closeSplash() as soon as a real window is up - see createWindow.
   */
  showSplash(require('electron'), {
    /* Not for a scheduled backup, which runs with nobody watching and must
       not put a window on the screen of whoever is logged in at ten at
       night; nor for a start minimised to the tray. */
    hidden: global.__posnicStartHidden
      || process.argv.some((a) => a.startsWith('--scheduled-task=')),
  });

  /*
   * If the last session is still closing, wait for it here.
   *
   * Nothing below this can run until it has finished: it still holds the
   * database files and the ports. So this blocks startup deliberately - but it
   * blocks it with a window on screen saying why, which is the entire
   * difference between this and what happened before.
   */
  if (waitingForPreviousShutdown) {
    const opened = await awaitPreviousShutdown(waitingForPreviousShutdown);
    if (!opened) {
      /* It never let go. Two instances sharing one database is far worse than
         a launch that gives up, so this gives up - loudly, in the log, and
         with the splash taken down rather than left spinning. */
      console.error('[Main] The previous instance never released the lock; exiting');
      closeSplash();
      app.exit(0);
      return;
    }
  }

  /*
   * Settle the local ports before anything tries to bind one.
   *
   * Everything downstream - the bundled database, the API, the sync agent and
   * the saved credentials - reads these from the environment, so this is the
   * only place the numbers are decided.
   */
  try {
    const { resolveLocalPorts } = require('./local-ports');
    const ports = await resolveLocalPorts({
      appName: app.getName(),
      userDataPath: app.getPath('userData'),
    });
    process.env.POSNIC_MONGO_PORT = String(ports.mongoPort);
    process.env.PORT = String(ports.apiPort);
    if (!process.env.MONGODB_URI) {
      process.env.MONGODB_URI = `mongodb://localhost:${ports.mongoPort}/PosnicPro`;
    }
    console.log(`  - database port: ${ports.mongoPort}${ports.reused ? ' (as before)' : ''}`);
    console.log(`  - application port: ${ports.apiPort}`);
    if (ports.movedFromPreferred) {
      console.log('    (something else held the usual port, so a free one was taken)');
    }
  } catch (err) {
    // Nothing can work without ports, so say so plainly and stop rather than
    // failing later with a stack trace about a socket.
    //
    // Only a genuine port clash gets the "close the other program" advice.
    // Everything else that can go wrong here - a module missing from the
    // package, a read-only data folder - is our problem, not the shop's, and
    // telling them to close another program sends them hunting for something
    // that is not there.
    console.error('[startup] ' + (err && err.stack ? err.stack : err));
    const isPortClash = err && err.code === 'NO_FREE_PORT';
    dialog.showErrorBox(
      'Cannot start',
      isPortClash
        ? `${err.message}\n\nClose the other program and start again, or contact support.`
        : `${err && err.message ? err.message : err}\n\nThis is a fault in the application, not ` +
          `something you can fix. Please contact support and quote the message above.`
    );
    app.quit();
    return;
  }
  console.log('');
  console.log('Environment:');
  console.log('  - isPackaged:', app.isPackaged);
  console.log('  - __dirname:', __dirname);
  console.log('  - process.resourcesPath:', process.resourcesPath);
  console.log('  - app.getAppPath():', app.getAppPath());
  console.log('');

  // Clearing cache every time forces the frontend to reload every asset.
  // Keep it available as an opt-in troubleshooting operation.
  if (process.env.POSNIC_CLEAR_CACHE === '1') {
    await clearStartupBrowserCache();
  }

  // POS product names trigger squiggles everywhere - not a document editor
  try { session.defaultSession.setSpellCheckerEnabled(false); } catch (e) { /* older electron */ }

  // Windows taskbar Jump List (right-click the taskbar icon)
  try {
    app.setUserTasks([
      { program: process.execPath, arguments: '--open=hardware', title: 'Hardware Manager', description: 'Printers, scanners, scales', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--open=backup', title: 'Backup Manager', description: 'Local backups', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--open=update', title: 'Software Update', description: 'Check for updates', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--open=cloud', title: 'Posnic Cloud', description: 'Sync status', iconPath: process.execPath, iconIndex: 0 }
    ]);
  } catch (e) { /* non-Windows or unsupported */ }

  /*
   * A scheduled run: do the job and leave, without ever showing a window.
   *
   * Backups are a setInterval inside this application, so they only happen
   * while it is open. A shop that closes at nine and opens at nine gets no
   * overnight backup, and the morning that matters is the one where the disk
   * does not come back. The Cloud edition has no such problem - that work runs
   * on the server - so this is for the local edition, where the operating
   * system's scheduler is the only thing that can do it.
   *
   * It runs as the real application rather than as a bare script, and that is
   * the point. ELECTRON_RUN_AS_NODE would be lighter, but under it
   * require('electron') fails, so safeStorage is unreachable - and the database
   * password is wrapped with safeStorage. A plain script could not decrypt its
   * own credentials. Started this way, everything that normally works works.
   *
   * scheduled-task.js generates the exact command with the real paths filled
   * in; docs/USER_GUIDE.md explains it for a shopkeeper.
   */
  const scheduledArg = process.argv.find((a) => a.startsWith('--scheduled-task='));
  if (scheduledArg) {
    await runScheduledTaskAndExit(scheduledArg.split('=')[1]);
    return;
  }

  // Show UI immediately while MongoDB and the API initialize.
  createWindow();
  createMenu();
  createTray();
  startSyncBadgeWatcher();

  // Initialize MongoDB manager
  mongoDBManager = new MongoDBManager();
  startupPerformance.mongoStartedAt = Date.now();
  updateStartupStatus('mongo', 'Starting database...', 'Preparing local data', 15);

  // Try to start bundled MongoDB first
  if (mongoDBManager.checkBundledMongoExists()) {
    console.log(' Bundled MongoDB found');
    try {
      await mongoDBManager.start();
      startupPerformance.mongoReadyMs =
        Date.now() - startupPerformance.mongoStartedAt;
      updateHealthStatus({
        mongodb: 'ready',
        mongodbReadyAt: new Date().toISOString(),
        mongodbReadyMs: startupPerformance.mongoReadyMs,
        api: 'starting'
      });
      updateStartupStatus('api', 'Starting API Server...', 'Loading application services', 45);
      console.log(' Bundled MongoDB is running\n');
    } catch (error) {
      updateHealthStatus({
        status: 'error',
        mongodb: 'failed',
        lastError: {
          name: error.name,
          message: error.message,
          code: error.code
        }
      });
      console.error('  Failed to start bundled MongoDB:', error.message);
      console.log('Checking for a system MongoDB service...\n');
      // Fail fast with an actionable screen instead of hanging on a dead DB.
      const systemMongoAvailable = await mongoDBManager.isPortOpen(2000);
      if (!systemMongoAvailable) {
        updateStartupStatus(
          'error',
          'Database could not be started',
          'Automatic repair was attempted. Click Restart App; if this repeats, open the log file and contact Posnic support.'
        );
        return; // do not start the API against a dead database
      }
      console.log(` System MongoDB responding on ${process.env.POSNIC_MONGO_PORT} - continuing\n`);
    }
    // If the database process dies mid-session (power event, OOM), restart it
    // once automatically instead of leaving the POS frozen.
    mongoDBManager.onUnexpectedExit = async () => {
      updateHealthStatus({ mongodb: 'crashed', mongodbCrashedAt: new Date().toISOString() });
      try {
        await mongoDBManager.start();
        updateHealthStatus({ mongodb: 'ready', mongodbRestartedAt: new Date().toISOString() });
        console.log('MongoDB restarted after unexpected exit');
      } catch (restartError) {
        console.error('MongoDB restart failed:', restartError.message);
        updateHealthStatus({ status: 'error', mongodb: 'failed' });
        dialog.showErrorBox(
          'Posnic - Database stopped',
          'The local database stopped and could not be restarted automatically.\n' +
          'Please close and reopen Posnic. If the problem repeats, contact support.'
        );
      }
    };
  } else {
    console.log(' Bundled MongoDB not found');
    const systemMongoAvailable = await mongoDBManager.isPortOpen(2000);
    if (!systemMongoAvailable) {
      updateStartupStatus(
        'error',
        'Database not found',
        'This installation is missing its database component. Please reinstall Posnic.'
      );
      return;
    }
    console.log(` Using system MongoDB on ${process.env.POSNIC_MONGO_PORT}\n`);
  }

  // Initialize hardware manager
  hardwareManager = new HardwareManager();
  console.log('HardwareManager initialized');

  // Initialize KOT manager
  kotManager = new KOTManager();
  console.log('KOTManager initialized');

  // Setup IPC handlers
  setupHardwareIPC(hardwareManager, kotManager);
  console.log('Hardware IPC handlers registered');

  // Start server
  startServer();
});

/*
 * Put the brand shipped inside the installer in place, once.
 *
 * refreshBrand() fetches branding from the cloud, but gives up immediately
 * when the till has not paired yet -- which is every fresh install. So a
 * customer who paid for white label, uploaded their logo and built their own
 * installer still met a Posnic sign-in screen, the first thing their staff
 * ever see. A branded build now carries the same three files the cloud would
 * have sent, and this copies them across on first launch.
 *
 * Only when there is nothing there already: the cloud is the authority once a
 * till is paired, and this must never overwrite a newer logo with the one
 * baked in months ago.
 */
function seedBrandFromBuild() {
  try {
    const seedDir = app.isPackaged
      ? path.join(process.resourcesPath, 'brand-seed')
      : path.join(__dirname, 'builds', 'brand-seed');
    if (!fs.existsSync(path.join(seedDir, 'brand.json'))) return;   // stock build

    /*
     * Re-seed when the installer carries different artwork to what is on disk.
     *
     * This used to return the moment a brand file existed, so reinstalling
     * with corrected logos changed nothing: the first install's artwork stayed
     * for ever and the only way out was deleting the folder by hand.
     *
     * A brand fetched from the cloud still wins and is never touched. The
     * cloud is the authority once a shop connects, and its descriptor is
     * recognisable: it carries a numeric version and an updatedAt, where a
     * seed's version is the string written when the installer was branded.
     */
    if (fs.existsSync(BRAND_FILE)) {
      let current = null;
      try { current = JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8')); } catch { /* rewrite it */ }

      const fromCloud = current && (typeof current.version === 'number' || current.updatedAt);
      if (fromCloud) return;

      const seeded = JSON.parse(fs.readFileSync(path.join(seedDir, 'brand.json'), 'utf8'));
      const sameArtwork = ['brand-logo.png', 'brand-login-logo.png'].every((f) => {
        const a = path.join(seedDir, f);
        const b = path.join(BRAND_DIR, f);
        if (fs.existsSync(a) !== fs.existsSync(b)) return false;
        if (!fs.existsSync(a)) return true;
        return fs.readFileSync(a).equals(fs.readFileSync(b));
      });
      if (sameArtwork && current && current.name === seeded.name && current.version === seeded.version) {
        return;
      }
      console.log('[Brand] installer carries different artwork; re-seeding');
    }

    fs.mkdirSync(BRAND_DIR, { recursive: true });
    for (const f of ['brand.json', 'brand-logo.png', 'brand-login-logo.png']) {
      const from = path.join(seedDir, f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(BRAND_DIR, f));
    }
    console.log('[Brand] applied the brand shipped with this installer');
  } catch (err) {
    // Branding must never be the reason a till fails to start.
    console.warn('[Brand] seed failed:', err.message);
  }
}

/*
 * Credentials for this machine's own setup endpoint.
 *
 * /api/install/add seeds a shop and /api/install/cleanup erases one, so the
 * API refuses both unless a key and secret are configured. That is right for
 * the cloud - the previous build shipped a fixed key in a public repository,
 * which meant anyone who read it could wipe any shop - but the desktop had no
 * key at all, so the API turned away its own setup wizard with "Installation
 * is not configured on this server" and no shop could be created.
 *
 * Generate a pair per installation and keep it in userData. Random, so it is
 * useless anywhere else, and never in the repository.
 */
function getInstallCredentials() {
  const file = path.join(app.getPath('userData'), '.install-credentials.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && saved.key && saved.secret) return saved;
  } catch (e) { /* first run, or the file was removed */ }

  const crypto = require('crypto');
  const creds = {
    key: crypto.randomBytes(24).toString('hex'),
    secret: crypto.randomBytes(24).toString('hex'),
  };
  try {
    fs.writeFileSync(file, JSON.stringify(creds), { mode: 0o600 });
  } catch (e) {
    // Not fatal: the pair still works for this run, it just is not reused.
    console.warn('[install] could not persist setup credentials:', e.message);
  }
  return creds;
}

// The wizard runs in a renderer and has to send the same pair the API checks.
ipcMain.handle('install:credentials', () => getInstallCredentials());

/*
 * Secrets this installation signs and encrypts with.
 *
 * These used to be constants in api/src/config/config.js, which meant every
 * Posnic in the world signed its tokens with the same string and guarded its
 * kiosk endpoints with the same key. Anyone reading the source could mint a
 * valid session for any till. Publishing the repository turns that from a
 * latent problem into an open door.
 *
 * Generated once per machine, kept beside the install credentials. Nothing to
 * configure, nothing shared between shops, and a copy of the source tells an
 * attacker nothing about anybody's installation.
 */
function getLocalSecrets() {
  const file = path.join(app.getPath('userData'), '.local-secrets.json');
  const NEEDED = ['jwtSecret', 'sessionSecret', 'encryptionKey', 'encryptionIv', 'kioskKey'];

  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && NEEDED.every((k) => saved[k])) return saved;
  } catch (e) { /* first run, or the file was removed */ }

  const crypto = require('crypto');
  const secrets = {
    jwtSecret: crypto.randomBytes(48).toString('hex'),
    sessionSecret: crypto.randomBytes(48).toString('hex'),
    // AES-256-CBC wants a 32 byte key and a 16 byte IV. The shipped defaults
    // were an 18 character word and a 12 character one - the IV was not even a
    // legal length, so something downstream must have been padding it.
    encryptionKey: crypto.randomBytes(16).toString('hex'),
    encryptionIv: crypto.randomBytes(8).toString('hex'),
    kioskKey: crypto.randomBytes(32).toString('hex'),
  };
  try {
    fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  } catch (e) {
    // Not fatal, but worth saying: regenerating these on every launch signs
    // every device out each time the app restarts.
    console.warn('[secrets] could not persist local secrets:', e.message);
  }
  return secrets;
}

function startServer() {
  // process.env.PORT already holds the port resolveLocalPorts derived and wrote
  // to .ports.json. It used to be overwritten here with a constant captured at
  // module load, which is how a build that advertised 42590 served 5555.

  // The setup endpoint checks these; without them it refuses every request,
  // including the wizard's own.
  const installCreds = getInstallCredentials();
  process.env.POSNIC_KEY = installCreds.key;
  process.env.POSNIC_SECRET = installCreds.secret;

  /*
   * Hand this machine's own secrets to the API before it reads its config.
   *
   * Set here rather than shipped in the source, so no two installations share
   * a signing key and reading the published repository reveals nothing about
   * any running till.
   */
  const localSecrets = getLocalSecrets();
  process.env.JWT_SECRET = localSecrets.jwtSecret;
  process.env.SESSION_SECRET = localSecrets.sessionSecret;
  process.env.ENCRYPTION_KEY = localSecrets.encryptionKey;
  process.env.ENCRYPTION_IV = localSecrets.encryptionIv;
  process.env.KIOSK_API_KEY = localSecrets.kioskKey;

  /*
   * The PIN lock, tied to this machine.
   *
   * The install secret goes into the key derivation, so the encrypted session
   * blob carried to another computer decrypts to nothing there even with the
   * right PIN.
   */
  /* rawIpcMain, not the guarded one: pin-lock-ipc.js wraps what it is given,
     and wrapping a wrapper would only validate the same frame twice. */
  require('./pin-lock-ipc').registerPinLockIPC(rawIpcMain, app, localSecrets.encryptionKey);

  // Where the API looks for this shop's white-label logo and name. Seeded
  // before the API reads it, so the very first page load is already branded.
  seedBrandFromBuild();
  process.env.POSNIC_BRAND_DIR = BRAND_DIR;

  /*
   * Decide which frontend to serve, before the API starts serving it.
   *
   * beginBoot counts this start. A version that has already failed to reach a
   * working state twice is put back here, before any of its code runs - which
   * is the only recovery a shop staring at a blank till actually has, because
   * there is nothing on the screen for them to click.
   *
   * With no update ever applied, activeDir() is the directory that shipped in
   * the installer and this changes nothing.
   */
  try {
    const boot = assetUpdater.beginBoot();
    if (boot.reverted) {
      console.warn(`[assets] ${boot.from} would not start - reverted to `
        + (boot.to || 'the installed version'));
    }
    process.env.POSNIC_ASSET_DIR = assetUpdater.activeDir() || '';
  } catch (err) {
    // Never let the update mechanism be the reason a till will not open.
    console.error('[assets] boot check failed, serving installed assets:', err.message);
    process.env.POSNIC_ASSET_DIR = '';
  }
  console.log('Starting api Node.js Server...');
  console.log('MongoDB URI: ' + (process.env.MONGODB_URI || '(not set)'));
  console.log('Connecting to local database...\n');

  // Determine correct path to server.js (now in extraResources)
  let serverPath;
  if (app.isPackaged) {
    // server.js stays outside ASAR; api dependencies use a dedicated archive.
    serverPath = path.join(process.resourcesPath, 'server.js');
    console.log('Loading server from extraResources:', serverPath);

    if (!require('fs').existsSync(serverPath)) {
      console.error('ERROR: server.js not found at:', serverPath);
      console.error('Trying fallback locations...');
      const candidates = [
        path.join(process.resourcesPath, 'app', 'server.js'),
        path.join(process.resourcesPath, 'app.asar', 'server.js'),
        path.join(__dirname, 'server.js')
      ];
      serverPath = candidates.find(p => require('fs').existsSync(p)) || serverPath;
      console.log('Using fallback:', serverPath);
    }
  } else {
    // In dev mode, use relative path
    serverPath = './server';
  }

  // Server startup is now async due to MongoDB setup
  const startServerFn = require(serverPath);
  startServerFn({
    onProgress: ({ stage, text, details, progress }) => {
      if (stage === 'timing' && details) {
        if (details.name === 'apiModulesLoaded') {
          startupPerformance.apiModulesMs = details.durationMs;
          updateHealthStatus({
            api: 'loading-modules',
            apiModulesMs: details.durationMs
          });
        } else if (details.name === 'databaseConnected') {
          startupPerformance.databaseConnectMs = details.durationMs;
          updateHealthStatus({
            database: 'ready',
            databaseConnectMs: details.durationMs
          });
        }
        return;
      }
      if (stage === 'database-health-result' && details) {
        updateHealthStatus({ databaseHealth: details });
        updateStartupStatus(
          stage,
          text,
          details.status === 'healthy'
            ? 'Connection, indexes and settings verified'
            : `${details.warnings.length} warning(s), ${details.errors.length} error(s)`,
          progress
        );
        return;
      }
      updateStartupStatus(stage, text, details, progress);
    }
  }).then(async (result) => {
    if (result && result.success) {
      updateHealthStatus({
        api: 'ready',
        apiReadyAt: new Date().toISOString()
      });

      /*
       * This version works. Clear its strikes.
       *
       * Recorded here rather than when the window opens, because a version
       * that paints a blank screen and then dies would otherwise clear its own
       * record and never be abandoned. The API answering means the app got far
       * enough to actually be a till.
       */
      try { assetUpdater.markHealthy(); } catch (e) { /* not fatal */ }

      // Start optional cloud sync agent (no-op unless installed + activated)
      try {
        syncAgentManager = new SyncAgentManager({ app });
        syncAgentManager.start();
      } catch (syncErr) {
        console.warn('[SyncAgent] failed to start:', syncErr.message);
      }
      // Pick up a changed logo or name without needing a reinstall. Hourly is
      // plenty: branding is not something a shop changes mid-shift.
      refreshBrand().catch((e) => console.warn('[Brand] refresh failed:', e.message));
      refreshLimits().catch((e) => console.warn('[Limits] refresh failed:', e.message));
      setInterval(() => {
        refreshBrand().catch(() => {});
        refreshLimits().catch(() => {});
      }, 3600_000);
      // Check if installation wizard is needed
      if (result.needsWizard) {
        console.log('\n First time setup - showing installation wizard...\n');
        await redirectToWizard();
      } else {
        updateStartupStatus('ready', 'Loading Interface...', 'Preparing login screen', 95);
        await redirectToLogin();
      }
      if (result.databaseHealth && result.databaseHealth.status !== 'healthy') {
        const health = result.databaseHealth;
        const lines = [
          ...health.errors.map((entry) => `Error: ${entry}`),
          ...health.warnings.map((entry) => `Warning: ${entry}`),
          ...health.repairs.filter((entry) => entry.repaired).map((entry) => `Repaired: ${entry.repaired} ${entry.type}`),
        ];
        const summary = lines.slice(0, 8).join('\n');

        // Some findings (legacy duplicate bill numbers, for instance) are real
        // but not actionable day to day. Once the shop has dismissed a given
        // set of findings, stay quiet unless something new appears. Errors are
        // never silenced.
        const fingerprint = crypto.createHash('sha1')
          .update(lines.slice().sort().join('|')).digest('hex');
        const dismissed = health.errors.length ? [] : (readHealthDismissals() || []);
        if (!dismissed.includes(fingerprint)) {
          const buttons = health.errors.length
            ? ['OK', 'Open Diagnostic File']
            : ['OK', 'Open Diagnostic File', "Don't show this again"];
          const response = await dialog.showMessageBox(mainWindow, {
            type: health.errors.length ? 'error' : 'warning',
            title: 'Database Health Diagnostic',
            message: health.errors.length ? 'Database requires attention' : 'Database check completed with warnings',
            detail: `${summary}\n\nFull diagnostic: ${HEALTH_FILE}`,
            buttons,
            defaultId: 0,
            cancelId: 0,
          });
          if (response.response === 1) shell.showItemInFolder(HEALTH_FILE);
          if (response.response === 2) {
            writeHealthDismissals([...dismissed, fingerprint]);
            console.log('[Health] findings dismissed; new problems will still be reported');
          }
        } else {
          console.log('[Health] known findings, dialog suppressed:', fingerprint.slice(0, 8));
        }
      }
    } else {
      updateHealthStatus({
        status: 'error',
        api: 'failed',
        lastError: 'API server failed to start'
      });
      console.error(' Server failed to start - MongoDB not available');
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { 
                font-family: Arial; 
                padding: 40px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
              }
              .container {
                max-width: 700px;
                margin: 0 auto;
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 15px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
              }
              h1 { 
                margin-bottom: 20px; 
                font-size: 32px;
                text-align: center;
              }
              .option {
                background: rgba(255,255,255,0.15);
                padding: 20px;
                margin: 15px 0;
                border-radius: 10px;
                border-left: 4px solid #ffd700;
              }
              .option h3 {
                margin-top: 0;
                color: #ffd700;
              }
              .option ol {
                text-align: left;
                line-height: 1.8;
              }
              .recommended {
                border-left-color: #00ff00;
              }
              .recommended h3 {
                color: #00ff00;
              }
              a { color: #ffd700; text-decoration: none; font-weight: bold; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1> MongoDB Service Not Running</h1>
              
              <div class="option recommended">
                <h3> Option 1: Quick Start (Recommended)</h3>
                <ol>
                  <li>Find <strong>start-mongodb.bat</strong> in the app folder</li>
                  <li>Right-click it and select <strong>"Run as administrator"</strong></li>
                  <li>Restart this application</li>
                </ol>
              </div>

              <div class="option">
                <h3> Option 2: Manual Start</h3>
                <ol>
                  <li>Open Command Prompt as Administrator</li>
                  <li>Run: <code style="background: rgba(0,0,0,0.3); padding: 5px;">net start MongoDB</code></li>
                  <li>Restart this application</li>
                </ol>
              </div>

              <div class="option">
                <h3> Option 3: Install MongoDB</h3>
                <p>If MongoDB is not installed:</p>
                <ol>
                  <li>Download from: <a href="https://www.mongodb.com/try/download/community" target="_blank">mongodb.com</a></li>
                  <li>Install with "Install as Service" option</li>
                  <li>Use Option 1 or 2 above</li>
                </ol>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
                <button onclick="window.electronAPI?.startup?.retry()" style="background:#fff;color:#667eea;border:none;border-radius:8px;padding:12px 20px;font-weight:600;cursor:pointer">Restart App</button>
                <button onclick="window.electronAPI?.desktop?.open('log')" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.5);border-radius:8px;padding:12px 20px;cursor:pointer">Open Log</button>
              </div>
            </div>
          </body>
          </html>
        `)}`);
      }
    }
  }).catch((error) => {
    if (isExpectedNavigationAbort(error)) {
      console.log('[Main] Expected page redirect completed');
      return;
    }
    updateHealthStatus({
      status: 'error',
      api: 'failed',
      lastError: {
        name: error.name,
        message: error.message,
        code: error.code
      }
    });
    console.error('Failed to start server:', error);
    console.error('Error stack:', error.stack);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <html>
          <body style="font-family:Arial;padding:40px;background:#f5f6fa;color:#222">
            <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,.08)">
              <h2 style="margin-top:0">Posnic could not start</h2>
              <p style="color:#555">${String(error.message || error)}</p>
              <p style="color:#555">Try restarting the app. If it keeps happening, the log file helps support fix it fast.</p>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
                <button onclick="window.electronAPI?.startup?.retry()" style="background:#667eea;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-weight:600;cursor:pointer">Restart App</button>
                <button onclick="window.electronAPI?.desktop?.open('hardware')" style="background:#eef;border:1px solid #ccd;border-radius:8px;padding:12px 20px;cursor:pointer">Hardware Manager</button>
                <button onclick="window.electronAPI?.desktop?.open('backup')" style="background:#eef;border:1px solid #ccd;border-radius:8px;padding:12px 20px;cursor:pointer">Backup Manager</button>
                <button onclick="window.electronAPI?.desktop?.open('log')" style="background:#eef;border:1px solid #ccd;border-radius:8px;padding:12px 20px;cursor:pointer">Open Log</button>
              </div>
            </div>
          </body>
        </html>
      `)}`);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('[Electron] Child process gone:', details);
});

app.on('before-quit', async event => {
  if (shutdownInProgress) return;

  event.preventDefault();
  shutdownInProgress = true;

  /*
   * Say something, because this takes a while.
   *
   * Stopping the API and closing mongod cleanly is the better part of a
   * minute. Restart was the worst of it: the window vanished, nothing happened
   * for thirty or forty seconds, and then the till came back - which reads as a
   * crash, and invites clicking the icon again in the middle of it.
   *
   * The main window is already going, so this is its own small window. It dies
   * with the process, so nothing has to remember to close it.
   */
  /* Asked before the shutdown runs, because prepareQuitInstall is what clears
     it - by the time the installer is actually handed control this would
     answer false and the screen would have said the wrong thing for the whole
     of the wait. */
  const installingOnQuit = !!(updateService && updateService.shouldInstallOnQuit());

  /*
   * Closing shows nothing. Restarting and updating show everything.
   *
   * They are different acts. Somebody closing the till has finished with it and
   * wants it gone - a window that hangs around afterwards saying "closing down
   * safely" is asking them to watch a progress bar for something they have
   * already stopped caring about. The work still has to finish, but it can
   * finish out of sight; the windows are gone, the taskbar entry is gone, and
   * the process exits when mongod has closed its files.
   *
   * Restarting is the opposite. The till is expected back, and between the
   * window going and the window returning there is half a minute of nothing.
   * That is when people conclude it has crashed and start clicking, so that is
   * where the screen and the step-by-step progress go.
   *
   * Updating always shows, whichever way it was triggered. Replacing the
   * application is the one thing here where turning the machine off at the
   * wrong moment does real damage, so it says so.
   *
   * Nothing is silent about the *work*: the shutdown is identical either way,
   * and the marker below is written either way. Only the window differs.
   */
  const showProgress = relaunchAfterQuit || installingOnQuit;

  try {
    if (showProgress) {
      showShutdown(require('electron'), {
        restarting: relaunchAfterQuit,
        updating: installingOnQuit
      });
    } else {
      /*
       * Take the windows away now, so closing feels like closing.
       *
       * Without this the main window lingers, unresponsive, for as long as the
       * database takes - which is the thing that gets a till force-quit
       * mid-checkpoint.
       */
      hideAllWindowsForQuit();
    }
  } catch (e) { /* never let this stop the shutdown */ }

  /*
   * Leave a note for the next launch, whether or not anything is on screen.
   *
   * This is what stops the icon looking broken. The lock is held until this
   * process actually exits, so a double-click during the wait would otherwise
   * open nothing and say nothing.
   */
  try {
    shutdownState.begin(app.getPath('userData'));
  } catch (e) { /* the launch simply behaves as it did before */ }

  const forceExitTimer = setTimeout(() => {
    console.error('[Shutdown] Total shutdown timeout reached - forcing exit', {
      timeoutMs: SHUTDOWN_TIMEOUTS.total
    });
    flushRepeatedWarningSummaries();
    /* The note has to go even on the way out badly. findInProgress would
       eventually discard it anyway once it saw the pid was gone, but a pid the
       operating system has since reused would read as alive and make the next
       launch wait forty-five seconds for a process that is not Posnic. */
    try { shutdownState.clear(app.getPath('userData')); } catch (e) { /* best effort */ }
    app.exit(0);
  }, SHUTDOWN_TIMEOUTS.total);

  /*
   * If an update is downloaded and waiting, this is the moment to apply it.
   *
   * The order matters and is the whole reason this is not left to
   * electron-updater's autoInstallOnAppQuit. The pre-update backup has to run
   * while the database is still up; the shutdown below stops it. Doing this
   * afterwards would produce a backup that fails, or - worse - one that looks
   * like it worked and holds nothing.
   *
   * A failed backup cancels the update rather than the shutdown. The shop keeps
   * the version it has and is asked again tomorrow, which is the safe
   * direction to fail in.
   */
  const installOnQuit = updateService && updateService.shouldInstallOnQuit();
  const readyToInstall = installOnQuit
    ? (async () => {
        const prepared = await updateService.prepareQuitInstall();
        if (!prepared.ok) {
          console.warn('[Shutdown] Update not applied this time:', prepared.error);
        }
        return prepared.ok;
      })()
    : Promise.resolve(false);

  readyToInstall
    .catch(() => false)
    .then((install) =>
      performGracefulShutdown(
        showProgress
          ? (done, total, says) => setShutdownProgress(done, total, says)
          : null,
      )
        .catch(error => {
          console.error('[Shutdown] Unexpected shutdown coordinator error', error);
        })
        .finally(() => {
          clearTimeout(forceExitTimer);
          flushRepeatedWarningSummaries();

          /* The work is done, so the note goes. A launch from here on is a
             normal cold start, not a wait. */
          try { shutdownState.clear(app.getPath('userData')); } catch (e) { /* best effort */ }

          /* Hand over to the installer as the last thing this process does.
             Silent and without relaunching - the shop closed the application,
             so it stays closed and opens next time on the new version. */
          if (install) {
            const handed = updateService.finishQuitInstall();
            if (handed.ok) return; // quitAndInstall ends the process itself
          }
          /*
           * Restarting takes the long way round on purpose.
           *
           * app.exit() does not emit 'quit', and Electron spawns the replacement process
           * from that event - so relaunching through app.exit() closes the till and
           * starts nothing. Quitting again instead re-enters this handler, which returns
           * early because shutdownInProgress is set, and the quit then proceeds normally
           * with the relaunch armed. Everything is already stopped by this point, so the
           * second pass has nothing left to do.
           */
          if (relaunchAfterQuit) {
              console.log('[Shutdown] Restarting');
              app.relaunch();
              app.quit();
              return;
          }
          app.exit(0);
        })
    );
  /*
   * Legacy shutdown sequence retained only as historical context.
   * The timeout-bounded coordinator above replaces it.
  
  // Stop backup scheduler
  if (backupManager) {
    backupManager.stopScheduler();
    console.log('✅ Backup scheduler stopped');
  }
  
  // Stop API server
  if (global.apiServer) {
    global.apiServer.close(() => {
      console.log('✅ API server stopped');
    });
  }
  
  // Close mongoose connection
  if (global.mongooseConnection) {
    await global.mongooseConnection.close();
    console.log('✅ MongoDB connection closed');
  }
  
  // Stop bundled MongoDB if running
  if (mongoDBManager) {
    await mongoDBManager.stop();
  }
  
  // Stop any other servers
  stopServers();
  */
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handler for opening hardware manager from renderer
ipcMain.on('open-hardware-manager', () => {
  openHardwareManager();
});
