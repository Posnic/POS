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
/* An updated agent that stays up this long has proven itself; the engine
   stops counting boot attempts against it. */
const AGENT_HEALTHY_AFTER_MS = 60_000;

class SyncAgentManager {
  constructor({ app, fetch: fetchImpl } = {}) {
    this.app = app;
    this.child = null;
    this.stopped = false;
    this._generation = 0;
    /* The table calls this till is ringing for, by call id, so a second pull
       of the same open call does not start a second alarm. */
    this._ringingCalls = new Set();
    this._fetch = fetchImpl || globalThis.fetch;
  }

  /*
   * The self-update engine (U3.5): the same AssetUpdater machinery that
   * guards frontend asset updates, pointed at the agent. The agent process
   * downloads releases (it holds the device token); THIS side verifies the
   * signed manifest, stages, activates, and - through the engine's boot
   * health gate - abandons an update that cannot stay running and returns
   * to the installer's copy. Without the committed public key the engine
   * refuses everything, which makes an open-source build inert, not trusting.
   */
  _updatesEngine() {
    if (this._engine !== undefined) return this._engine;
    try {
      const { AssetUpdater } = require('./asset-updater');
      const resourcesRoot = this.app.isPackaged ? process.resourcesPath : __dirname;
      const keyFile = path.join(resourcesRoot, 'asset-signing-key.pub');
      this._engine = new AssetUpdater({
        root: path.join(this.app.getPath('userData'), 'sync-agent-updates'),
        baseline: path.join(resourcesRoot, 'sync-agent'),
        publicKey: fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : null,
        log: (m) => console.log('[SyncAgent]', m),
      });
    } catch (err) {
      console.warn('[SyncAgent] update engine unavailable:', err.message);
      this._engine = null;
    }
    return this._engine;
  }

  /* Downloaded-and-verified agent first, then the installer's copy. */
  _findAgent() {
    const engine = this._updatesEngine();
    const candidates = [
      engine && engine.activeVersion() ? engine.activeDir() : null,
      this.app.isPackaged ? path.join(process.resourcesPath, 'sync-agent') : null,
      path.join(this.app.getPath('userData'), 'sync-agent'),
      // dev convenience: sibling Cloud checkout
      !this.app.isPackaged ? path.join(__dirname, '..', '..', 'Gateway', 'apps', 'sync-agent') : null,
    ].filter(Boolean);
    return candidates.find((dir) => fs.existsSync(path.join(dir, 'src', 'index.js'))) || null;
  }

  /*
   * Verify + activate anything the agent downloaded, and clear staged agents
   * an installer has overtaken. Runs once per app start, BEFORE the agent is
   * chosen - the swap happens between launches, never mid-trade.
   */
  async _applyDownloadedUpdates() {
    const engine = this._updatesEngine();
    if (!engine) return;
    try {
      const { reconcileWithInstaller, extractZip, loadTree } = require('./asset-channel');
      // An open-source installer has no baseline agent to replace a download.
      if (fs.existsSync(path.join(engine.baseline, 'src', 'index.js'))) {
        reconcileWithInstaller(engine, this.app.getVersion(), (m) => console.log(m));
      }

      const sevenZip = path.join(
        this.app.isPackaged ? process.resourcesPath : __dirname,
        'tools',
        process.platform === 'win32' ? '7za.exe' : '7za'
      );
      if (!fs.existsSync(sevenZip)) return; // dev tree: nothing to unpack with

      const { applyIncoming } = require('./agent-update-apply');
      await applyIncoming({
        engine,
        incomingDir: path.join(this.app.getPath('userData'), 'sync-agent-updates', 'incoming'),
        extract: (zip, dest) => extractZip(sevenZip, zip, dest),
        loadTree: (dir) => loadTree(dir, dir),
        log: (m) => console.log('[SyncAgent]', m),
      });
    } catch (err) {
      console.warn('[SyncAgent] update apply failed:', err.message);
    }
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

  async start() {
    if (this.child) return true;
    if (this._starting) return this._starting;
    const generation = this._generation;
    const pending = this._start(generation);
    this._starting = pending;
    try {
      return await pending;
    } finally {
      if (this._starting === pending) this._starting = null;
    }
  }

  async _start(generation) {
    // Once per app run: adopt what the agent downloaded last time. Restarts
    // after a crash skip this - the point of the health gate below is that a
    // crashing UPDATED agent burns its boot attempts and the engine reverts.
    if (!this._updatesApplied) {
      this._updatesApplied = true;
      await this._applyDownloadedUpdates();
    }

    const cfg = this._loadConfig();
    if (!cfg) {
      console.log('[SyncAgent] no activation config - cloud sync disabled');
      return false;
    }
    let agentDir = this._findAgent();
    if (!agentDir) {
      const { installAgent } = require('./agent-bootstrap');
      console.log('[SyncAgent] installing verified cloud sync component');
      await installAgent({
        config: cfg,
        engine: this._updatesEngine(),
        fetch: this._fetch,
      });
      agentDir = this._findAgent();
    }
    if (!agentDir || this.stopped || generation !== this._generation) return false;

    /*
     * Health accounting for a DOWNLOADED agent only: each spawn from the
     * engine's directory is a boot attempt, and staying up marks it healthy.
     * Two failed attempts and the engine reverts to the installer's copy on
     * the next respawn - the same contract frontend assets live under.
     */
    const engine = this._updatesEngine();
    const runningFromEngine = !!(engine && engine.activeVersion()
      && agentDir === engine.activeDir());
    if (runningFromEngine) {
      try {
        const boot = engine.beginBoot();
        if (boot && boot.reverted) {
          console.warn('[SyncAgent] updated agent kept dying - reverted to the installed copy');
          return this._findAgent() ? this._start(generation) : false;
        }
      } catch (e) { /* health accounting must never stop the agent */ }
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
        this.app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
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
      /*
       * Self-update (U3.5). Where the agent should leave downloaded releases
       * for this manager to verify and apply on the next app start, and
       * which agent version is running right now - the engine's active
       * version when an update is live, otherwise the app version the
       * installer bundled it with.
       */
      UPDATE_DIR: path.join(this.app.getPath('userData'), 'sync-agent-updates', 'incoming'),
      POSNIC_AGENT_VERSION:
        (engine && engine.activeVersion()) || this.app.getVersion(),
      /*
       * Connector bundles (I6) ride the agent's download rhythm: the agent
       * holds the device token, so IT fetches; the connector runtime reads
       * this directory at app start and does all the verifying.
       */
      CONNECTOR_UPDATE_DIR: path.join(this.app.getPath('userData'), 'connector-runtime', 'incoming'),
    };

    console.log('[SyncAgent] starting from', agentDir);
    this.child = spawn(process.execPath, [path.join(agentDir, 'src', 'index.js')], {
      env,
      cwd: agentDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stdout.on('data', (d) => {
      /*
       * A chunk is not a line. Node hands over whatever arrived, which on a
       * busy cycle is several lines at once, and every reader below was
       * written as though it were one. Testing the whole blob still finds a
       * substring, so the online/offline notice happened to survive it; a
       * regex does not, and would have read only the first of three
       * collections a pull filled.
       */
      for (const line of String(d).split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        console.log('[SyncAgent]', text);
        this._trackSyncState(text);
      }
    });
    this.child.stderr.on('data', (d) => console.warn('[SyncAgent]', String(d).trim()));

    // An updated agent that stays up counts as a good boot; one that dies
    // first keeps its attempt burned, so a crash loop self-resolves.
    if (runningFromEngine) {
      this._healthTimer = setTimeout(() => {
        try { engine.markHealthy(); } catch (e) { /* not fatal */ }
      }, AGENT_HEALTHY_AFTER_MS);
    }

    this.child.on('exit', (code) => {
      this.child = null;
      clearTimeout(this._healthTimer);
      if (this.stopped) return;
      console.warn(`[SyncAgent] exited (code ${code}) - restarting in ${RESTART_DELAY_MS / 1000}s`);
      this._restartTimer = setTimeout(
        () => Promise.resolve(this.start()).catch((e) =>
          console.warn('[SyncAgent] restart failed:', e.message)),
        RESTART_DELAY_MS
      );
    });
    return new Promise((resolve, reject) => {
      this.child.once('spawn', () => resolve(true));
      this.child.once('error', (error) => {
        this.child = null;
        clearTimeout(this._healthTimer);
        reject(error);
      });
    });
  }

  _notify(title, body) {
    try {
      const { Notification } = require('electron');
      new Notification({ title, body }).show();
    } catch (e) { /* non-fatal */ }
  }

  // Surface connectivity transitions as native notifications so the shop
  // knows sync state without opening anything.
  /*
   * AN ORDER THAT ARRIVED FROM THE CLOUD REACHES THE KITCHEN AT ONCE.
   *
   * A captain handset off the shop Wi-Fi, or a customer's phone, writes its
   * order into the tenant's CLOUD database. Nothing on this machine can find
   * it until the sync agent pulls it down, so "check the local database
   * instead of asking" returns nothing, faster.
   *
   * What happened once the agent had pulled it was the real cost. The row
   * landed and the agent said nothing about it, so the kitchen printer found
   * the ticket on its own thirty second fallback poll, and no chime sounded at
   * all, because the chime listens for an event that only a sale rung up on
   * THIS machine emits. Measured worst case, about forty-five seconds of
   * silence for an order somebody is standing and waiting on.
   *
   * The channel was already here. This class spawns the agent and reads its
   * stdout; it simply had nothing to hear. The agent now names each collection
   * a pull actually filled, and an order collection becomes the same two
   * events a counter sale raises. Both reach the printer and the speaker the
   * way they always have, so nothing downstream has to know an order can now
   * come from somewhere else.
   *
   * THE FORMAT IS A CONTRACT with Posnic/Gateway, shipped separately and
   * updated separately. Pinned by a test on both sides. An agent too old to
   * say this line is not broken by it: the fallback poll underneath is exactly
   * what it always was.
   */
  _announcePulled(line) {
    const m = /\[agent\] pulled (\d+) into ([a-z_]+)/.exec(line);
    if (!m) return false;

    const rows = Number(m[1]) || 0;
    const collection = m[2];
    /* Only what a kitchen or a counter is waiting on. Pulling customers or
       items must not set off a chime in an empty shop. */
    if (rows <= 0) return false;
    if (collection === 'waitercalls') return this._announceCalls(rows);
    if (collection !== 'sales') return false;

    try {
      /*
       * Required by name, not through the API's helpers: those ship outside
       * the ASAR archive while this file lives inside it, so the two halves
       * cannot rely on sharing a module instance. `process` is the bus both
       * already have, which is the same reason kot-notify uses it.
       */
      process.emit('posnic:kot-created', {
        branchId: '',
        saleId: '',
        /* Not 'created': this sale was made somewhere else and has only just
           got here, and a log line saying so is the difference between
           diagnosing a slow shop in a minute and in a morning. */
        reason: 'synced',
        at: Date.now(),
      });
      process.emit('posnic:order-attention', {
        branchId: '',
        saleId: '',
        /* The short chime. An order that arrived is information; only one
           held for approval is an alarm, and the agent cannot tell which this
           is. The quieter sound is the safe answer. */
        alert: 'received',
        state: '',
        total: 0,
        at: new Date().toISOString(),
      });
      console.log(`[SyncAgent] ${rows} order(s) arrived from the cloud - printing now`);
      return true;
    } catch (e) {
      /* A ticket that misses this still prints on the poll underneath. */
      console.warn('[SyncAgent] could not announce a synced order:', e.message);
      return false;
    }
  }

  /*
   * A TABLE'S CALL THAT ARRIVED BY SYNC RINGS UNTIL SOMEBODY ANSWERS.
   *
   * "Call waiter" on the ordering page writes into the cloud database; the
   * lane that brings it down was built the same night the row learned to
   * carry its date (Gateway "A call reaches the till", #853). A counter-made
   * call rings until answered, because the API's insert path raises
   * 'waiting' with the call's id and the dock's "seen" resolves that id. A
   * synced row never takes that path, and the agent's line says how many
   * rows landed, not which.
   *
   * So the till asks. After a pull into waitercalls it reads the open calls
   * from its own API - a kiosk-keyed route, because this process has no
   * session - and raises the same 'waiting' per call_id the counter would
   * have. "Seen" at the dock resolves it exactly as before. A call answered
   * somewhere else (the cloud dashboard, another till) leaves the list on
   * the next pull and is resolved here, so nothing rings for a table that
   * has already been served.
   *
   * If the read fails, the arrival bell sounds once - the treatment a
   * synced-in order gets - and the dock still shows the call on its poll. A
   * shop must hear something; it must never hear an alarm it cannot stop.
   */
  _announceCalls(rows) {
    return this._ringCalls().catch((e) => {
      console.warn('[SyncAgent] could not ring for a synced table call:', e.message);
      return false;
    });
  }

  async _ringCalls() {
    let calls = null;
    try {
      const port = Number(process.env.PORT) || 5555;
      const res = await this._fetch(`http://127.0.0.1:${port}/api/sales/waiterCalls/open`, {
        headers: { Accept: 'application/json', kioskkey: process.env.KIOSK_API_KEY || '' },
      });
      const body = res && res.ok ? await res.json() : null;
      calls = body && Array.isArray(body.data) ? body.data : null;
    } catch (e) {
      calls = null;
    }

    if (!calls) {
      process.emit('posnic:order-attention', {
        branchId: '',
        saleId: '',
        alert: 'received',
        state: 'waiter',
        total: 0,
        at: new Date().toISOString(),
      });
      console.log('[SyncAgent] a table call arrived from the cloud - see the request dock');
      return true;
    }

    const open = new Set();
    for (const call of calls) {
      const id = call && call.call_id ? String(call.call_id) : '';
      if (!id) continue;
      open.add(id);
      if (this._ringingCalls.has(id)) continue;
      this._ringingCalls.add(id);
      process.emit('posnic:order-attention', {
        branchId: call.branch_id ? String(call.branch_id) : '',
        saleId: id,
        alert: 'waiting',
        state: 'waiter',
        total: 0,
        source: 'synced',
        at: new Date().toISOString(),
      });
    }
    for (const id of [...this._ringingCalls]) {
      if (open.has(id)) continue;
      this._ringingCalls.delete(id);
      process.emit('posnic:order-resolved', { saleId: id, state: 'seen' });
    }
    console.log(`[SyncAgent] ${open.size} table call(s) waiting - ringing until seen`);
    return true;
  }

  _trackSyncState(line) {
    this._announcePulled(line);

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
    this._generation++;
    this._starting = null;
    clearTimeout(this._restartTimer);
    clearTimeout(this._healthTimer);
    if (this.child) {
      this.child.kill();
      this.child = null;
      console.log('[SyncAgent] stopped');
    }
  }
}

module.exports = SyncAgentManager;
