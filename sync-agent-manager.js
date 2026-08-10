/**
 * SyncAgentManager — starts the optional Posnic Cloud sync agent if present.
 *
 * The agent is NOT part of this repository. It is installed for cloud
 * subscribers (delivered on activation) into one of:
 *   - <resources>/sync-agent          (bundled by a subscriber build)
 *   - <userData>/sync-agent           (installed after activation)
 *
 * Activation config lives at <userData>/posnic-cloud.json:
 *   { "gatewayUrl": "...", "deviceToken": "...", "deviceId": "...",
 *     "localUri": "mongodb://127.0.0.1:27018", "localDb": "PosnicPro" }
 *
 * If either the agent or the config is missing, nothing happens — the app is
 * fully functional without cloud sync.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const RESTART_DELAY_MS = 15_000;

class SyncAgentManager {
  constructor({ app }) {
    this.app = app;
    this.child = null;
    this.stopped = false;
  }

  _findAgent() {
    const candidates = [
      this.app.isPackaged ? path.join(process.resourcesPath, 'sync-agent') : null,
      path.join(this.app.getPath('userData'), 'sync-agent'),
      // dev convenience: sibling Cloud checkout
      !this.app.isPackaged ? path.join(__dirname, '..', 'Gateway', 'apps', 'sync-agent') : null,
    ].filter(Boolean);
    return candidates.find((dir) => fs.existsSync(path.join(dir, 'src', 'index.js'))) || null;
  }

  _loadConfig() {
    const file = path.join(this.app.getPath('userData'), 'posnic-cloud.json');
    if (!fs.existsSync(file)) return null;
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!cfg.gatewayUrl || !cfg.deviceToken || !cfg.deviceId) return null;
      return cfg;
    } catch (err) {
      console.warn('[SyncAgent] invalid posnic-cloud.json:', err.message);
      return null;
    }
  }

  start() {
    const agentDir = this._findAgent();
    if (!agentDir) {
      console.log('[SyncAgent] no agent installed - cloud sync disabled');
      return false;
    }
    const cfg = this._loadConfig();
    if (!cfg) {
      console.log('[SyncAgent] no activation config - cloud sync disabled');
      return false;
    }

    // Always prefer the CURRENT MongoDB credentials at spawn time - local
    // setup can enable DB auth after the cloud config was first written.
    let localUri = cfg.localUri || `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}`;
    try {
      const credFile = path.join(this.app.getPath('userData'), '.mongodb-credentials.json');
      if (fs.existsSync(credFile)) {
        const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        if (creds.uri) localUri = creds.uri;
      }
    } catch (e) { /* stored value is the fallback */ }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LOCAL_URI: localUri,
      LOCAL_DB: cfg.localDb || 'PosnicPro',
      GATEWAY_URL: cfg.gatewayUrl,
      DEVICE_TOKEN: cfg.deviceToken,
      DEVICE_ID: cfg.deviceId,
      STATUS_PORT: String(cfg.statusPort || 5055),
      /*
       * Where this till keeps its uploaded images, so the agent's file lane
       * can reconcile them with the cloud. Same resolution server.js uses for
       * the API itself; without it the agent skips file sync entirely rather
       * than guessing at a directory.
       */
      UPLOADS_DIR: path.join(
        this.app.isPackaged ? process.resourcesPath : __dirname,
        'api',
        'uploads'
      ),
      // lets the agent answer support "upload logs" requests
      POSNIC_LOG_FILE: path.join(this.app.getPath('userData'), 'app.log'),
      /*
       * Which build this till is running.
       *
       * The agent is a separate process and has no idea what version the app
       * around it is - its own package.json says 0.1.0 and always has. So the
       * app tells it, and the agent puts it on every sync.
       *
       * The gateway has always stored this (auth.js reads x-app-version into
       * lastSeenVersion) and the console has always had a column for it. Both
       * showed nothing for every till in the estate, because nobody ever sent
       * it - which is why "what version is that shop on?" has been unanswerable
       * while the answer was one header away.
       */
      POSNIC_APP_VERSION: this.app.getVersion(),
    };

    console.log('[SyncAgent] starting from', agentDir);
    this.child = spawn(process.execPath, [path.join(agentDir, 'src', 'index.js')], {
      env,
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stdout.on('data', (d) => {
      const line = String(d).trim();
      console.log('[SyncAgent]', line);
      this._trackSyncState(line);
    });
    this.child.stderr.on('data', (d) => console.warn('[SyncAgent]', String(d).trim()));

    this.child.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      console.warn(`[SyncAgent] exited (code ${code}) - restarting in ${RESTART_DELAY_MS / 1000}s`);
      this._restartTimer = setTimeout(() => this.start(), RESTART_DELAY_MS);
    });
    return true;
  }

  _notify(title, body) {
    try {
      const { Notification } = require('electron');
      new Notification({ title, body }).show();
    } catch (e) { /* non-fatal */ }
  }

  // Surface connectivity transitions as native notifications so the shop
  // knows sync state without opening anything.
  _trackSyncState(line) {
    if (line.includes('cycle failed') && this._syncState !== 'offline') {
      this._syncState = 'offline';
      this._notify(
        'Posnic Cloud sync is offline',
        'Billing continues normally. Sales will sync automatically when internet returns.'
      );
    } else if (/pushed [1-9]\d*, pulled \d+/.test(line) && this._syncState === 'offline') {
      this._syncState = 'online';
      this._notify('Posnic Cloud sync restored', 'Pending sales are uploading now.');
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this._restartTimer);
    if (this.child) {
      this.child.kill();
      this.child = null;
      console.log('[SyncAgent] stopped');
    }
  }
}

module.exports = SyncAgentManager;
