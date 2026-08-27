'use strict';
/*
 * Connector runtime (INTEGRATIONS_ROADMAP I5): integrations that need
 * till-side presence run as SIGNED sidecar processes, never in-process.
 *
 * The rules, in order of importance:
 *
 *   1. A connector must never take the till down. Every spawn, exit and
 *      restart is contained here; a connector that keeps dying is parked
 *      ('crashloop') and the shop keeps selling.
 *   2. Nothing runs unless it came through the same Ed25519 trust chain the
 *      frontend assets and the sync agent already use. A connector manifest's
 *      kind is 'connector:<name>' - the NAME sits inside the signed payload,
 *      so a genuine bundle for one connector cannot be replayed as another.
 *   3. Connectors speak to the local API only, with a scoped token the shop
 *      minted (I2). They get no database URI and no credentials beyond that
 *      token. The API's ACL is the connector's whole world.
 *
 * Distribution mirrors the agent's self-update (U3.5): a downloader that
 * holds the device token leaves bundles in incoming/<name>/<version>/, and
 * THIS side - which is not the process being replaced - verifies, stages and
 * activates them between launches through AssetUpdater, inheriting its
 * boot-attempt accounting and auto-revert.
 *
 * Ships dark: with no connectors installed and no configs written, all of
 * this is inert. Enabling a connector is a deliberate later step (I6+).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AssetUpdater } = require('./asset-updater');

const RESTART_DELAY_MS = 15_000;
/* A connector that stays up this long has proven this version boots. */
const HEALTHY_AFTER_MS = 60_000;
/* More exits than this inside the window is a crash loop, not bad luck. */
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 5;

/* Connector names are directory names and env values; keep them boring. */
const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;

class ConnectorSupervisor {
  /**
   * @param {object}   opts
   * @param {string}   opts.root        directory this owns (userData/connector-runtime)
   * @param {string}   opts.publicKey   PEM Ed25519 key, or null to refuse everything
   * @param {function} opts.apiPort     () => number - the local API's port right now
   * @param {string}   [opts.appVersion]
   * @param {function} [opts.spawnImpl] injected for tests
   * @param {function} [opts.log]
   */
  constructor({ root, publicKey, apiPort, appVersion, spawnImpl, log } = {}) {
    this.root = root;
    this.publicKey = publicKey || null;
    this.apiPort = apiPort || (() => 5555);
    this.appVersion = appVersion || '0.0.0';
    this.spawnImpl = spawnImpl || spawn;
    this.log = log || (() => {});
    this.incomingDir = path.join(root, 'incoming');
    /* name -> { child, state, restarts:[], timers, engine } */
    this.connectors = new Map();
    this.stopped = false;
  }

  /* ---------------------------------------------------------------- *
   * What exists on this till
   * ---------------------------------------------------------------- */

  _engine(name) {
    const entry = this._entry(name);
    if (!entry.engine) {
      entry.engine = new AssetUpdater({
        root: path.join(this.root, 'engines', name),
        /* No installer baseline: a connector that reverts past its last
           good version reverts to NOT INSTALLED, which is the safe floor. */
        baseline: null,
        publicKey: this.publicKey,
        log: (m) => this.log(`[connector:${name}] ${m}`),
      });
    }
    return entry.engine;
  }

  _entry(name) {
    if (!this.connectors.has(name)) {
      this.connectors.set(name, {
        child: null,
        state: 'stopped',
        restarts: [],
        engine: null,
        startedAt: null,
      });
    }
    return this.connectors.get(name);
  }

  _configFile(name) {
    return path.join(this.root, name + '.config.json');
  }

  /*
   * A connector runs only when the shop said so: the enable flow writes
   * <root>/<name>.config.json with the scoped token it minted. No file,
   * no start - and a file without a token is a misconfiguration, not a
   * licence to run without one.
   */
  _loadConfig(name) {
    try {
      const file = this._configFile(name);
      if (!fs.existsSync(file)) return null;
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg.enabled !== true || !cfg.token) return null;
      return cfg;
    } catch (err) {
      this.log(`[connector:${name}] invalid config: ${err.message}`);
      return null;
    }
  }

  installedNames() {
    const names = new Set();
    try {
      const enginesDir = path.join(this.root, 'engines');
      if (fs.existsSync(enginesDir)) {
        for (const e of fs.readdirSync(enginesDir, { withFileTypes: true })) {
          if (e.isDirectory() && NAME_RE.test(e.name)) names.add(e.name);
        }
      }
    } catch (err) { /* an unreadable dir is an empty estate */ }
    return [...names].filter((n) => this._engine(n).activeVersion());
  }

  /* ---------------------------------------------------------------- *
   * Adopting downloads
   * ---------------------------------------------------------------- */

  /*
   * Verify + activate whatever a downloader left in incoming/<name>/<version>.
   * Same contract as the agent's applyIncoming, plus the identity rule: the
   * manifest's kind must be 'connector:<name>' for the directory it sits in,
   * and that kind is inside the signed payload. Every attempt consumes its
   * directory - a refused bundle is not retried forever.
   */
  async applyIncoming({ extract, loadTree }) {
    const applied = [];
    if (!this.publicKey) return { applied, reason: 'no-key' };
    if (!fs.existsSync(this.incomingDir)) return { applied };

    const names = fs
      .readdirSync(this.incomingDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const name of names) {
      if (!NAME_RE.test(name)) {
        this.log(`[connectors] refusing incoming name '${name}'`);
        fs.rmSync(path.join(this.incomingDir, name), { recursive: true, force: true });
        continue;
      }
      const nameDir = path.join(this.incomingDir, name);
      const versions = fs
        .readdirSync(nameDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.endsWith('.partial'))
        .map((e) => e.name)
        .sort();

      for (const version of versions) {
        const dir = path.join(nameDir, version);
        try {
          const manifestFile = path.join(dir, 'manifest.json');
          const zipFile = path.join(dir, 'bundle.zip');
          if (!fs.existsSync(manifestFile) || !fs.existsSync(zipFile)) {
            this.log(`[connector:${name}] ${version}: incomplete download, discarding`);
            continue;
          }
          const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
          if (manifest.kind !== 'connector:' + name || String(manifest.version) !== String(version)) {
            this.log(`[connector:${name}] ${version}: manifest does not describe this release, discarding`);
            continue;
          }
          const engine = this._engine(name);
          const verdict = engine.verifyManifest(manifest);
          if (!verdict.ok) {
            this.log(`[connector:${name}] refusing ${version}: ${verdict.reason}`);
            continue;
          }
          const treeDir = path.join(dir, 'tree');
          fs.mkdirSync(treeDir, { recursive: true });
          await extract(zipFile, treeDir);
          const staged = engine.stage(manifest, loadTree(treeDir));
          if (!staged.ok) {
            this.log(`[connector:${name}] stage refused ${version}: ${staged.reason}`);
            continue;
          }
          const active = engine.activate(version);
          if (!active.ok) {
            this.log(`[connector:${name}] activate refused ${version}: ${active.reason}`);
            continue;
          }
          applied.push(name + '@' + version);
          this.log(`[connector:${name}] ${version} verified and active`);
        } catch (err) {
          this.log(`[connector:${name}] ${version} failed: ${err.message}`);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    return { applied };
  }

  /* ---------------------------------------------------------------- *
   * Running
   * ---------------------------------------------------------------- */

  start(name) {
    if (this.stopped) return false;
    if (!NAME_RE.test(String(name))) return false;
    const entry = this._entry(name);
    if (entry.child) return true;

    const engine = this._engine(name);
    if (!engine.activeVersion()) {
      entry.state = 'not-installed';
      return false;
    }
    const cfg = this._loadConfig(name);
    if (!cfg) {
      entry.state = 'disabled';
      return false;
    }

    /* Crash-loop breaker: parked connectors stay parked until someone
       starts them deliberately (which clears the history below). */
    const now = Date.now();
    entry.restarts = entry.restarts.filter((t) => now - t < CRASH_WINDOW_MS);
    if (entry.restarts.length >= CRASH_LIMIT) {
      if (entry.state !== 'crashloop') {
        entry.state = 'crashloop';
        this.log(`[connector:${name}] kept dying - parked until restarted manually`);
      }
      return false;
    }

    /* Boot accounting - but only until this version first proves itself.
       A NEW version that cannot stay up twice reverts (and with no baseline
       behind it, reverting past the last good version means "not
       installed", the safe floor). A version that has already run healthy
       is a different story: its crashes are operational, and uninstalling
       a proven connector because the network blinked twice would be worse
       than the fault. Those are the breaker's to park, above. */
    try {
      const bootState = engine._readBootState();
      const proven = bootState
        && bootState.version === engine.activeVersion()
        && bootState.healthyAt;
      if (!proven) {
        const boot = engine.beginBoot();
        if (boot && boot.reverted) {
          this.log(`[connector:${name}] update kept dying - reverted`);
          if (!engine.activeVersion()) {
            entry.state = 'not-installed';
            return false;
          }
        }
      }
    } catch (e) { /* health accounting must never stop the connector */ }

    const dir = engine.activeDir();
    const mainFile = path.join(dir, 'src', 'index.js');
    if (!fs.existsSync(mainFile)) {
      entry.state = 'broken';
      this.log(`[connector:${name}] active version has no src/index.js`);
      return false;
    }

    /* Session state (WhatsApp auth, caches) must OUTLIVE version swaps -
       a connector update that lost its login would page the shop for a QR
       scan on every release. Versions are disposable; data is not. */
    const dataDir = path.join(this.root, 'data', name);
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) { /* spawn will surface it */ }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CONNECTOR_NAME: name,
      /* The whole world a connector gets: the local API and one token. */
      LOCAL_API_URL: 'http://127.0.0.1:' + this.apiPort(),
      CONNECTOR_TOKEN: cfg.token,
      CONNECTOR_SETTINGS: JSON.stringify(cfg.settings || {}),
      CONNECTOR_DATA_DIR: dataDir,
      POSNIC_APP_VERSION: this.appVersion,
      POSNIC_CONNECTOR_VERSION: engine.activeVersion(),
    };

    this.log(`[connector:${name}] starting ${engine.activeVersion()} from ${dir}`);
    let child;
    try {
      child = this.spawnImpl(process.execPath, [mainFile], {
        env,
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      /* Rule 1: a connector that cannot even spawn is parked, not fatal. */
      entry.state = 'broken';
      this.log(`[connector:${name}] spawn failed: ${err.message}`);
      return false;
    }
    entry.child = child;
    entry.state = 'running';
    entry.startedAt = new Date().toISOString();

    if (child.stdout && child.stdout.on) {
      child.stdout.on('data', (d) => this.log(`[connector:${name}] ${String(d).trim()}`));
    }
    if (child.stderr && child.stderr.on) {
      child.stderr.on('data', (d) => this.log(`[connector:${name}] ${String(d).trim()}`));
    }

    entry.healthTimer = setTimeout(() => {
      try { engine.markHealthy(); } catch (e) { /* not fatal */ }
    }, HEALTHY_AFTER_MS);

    child.on('exit', (code) => {
      entry.child = null;
      entry.startedAt = null;
      clearTimeout(entry.healthTimer);
      if (this.stopped || entry.state === 'stopped') return;
      entry.restarts.push(Date.now());
      entry.state = 'restarting';
      this.log(`[connector:${name}] exited (code ${code}) - restarting in ${RESTART_DELAY_MS / 1000}s`);
      entry.restartTimer = setTimeout(() => {
        try {
          this.start(name);
        } catch (e) {
          this.log(`[connector:${name}] restart failed: ${e.message}`);
        }
      }, RESTART_DELAY_MS);
    });
    return true;
  }

  /* Everything installed AND enabled, after adopting downloads. */
  async startAll({ extract, loadTree } = {}) {
    if (extract && loadTree) {
      try {
        await this.applyIncoming({ extract, loadTree });
      } catch (err) {
        this.log('[connectors] update apply failed: ' + err.message);
      }
    }
    const started = [];
    for (const name of this.installedNames()) {
      try {
        if (this.start(name)) started.push(name);
      } catch (err) {
        this.log(`[connector:${name}] start failed: ${err.message}`);
      }
    }
    return started;
  }

  stop(name) {
    const entry = this.connectors.get(name);
    if (!entry) return;
    entry.state = 'stopped';
    clearTimeout(entry.restartTimer);
    clearTimeout(entry.healthTimer);
    if (entry.child) {
      try { entry.child.kill(); } catch (e) { /* already gone */ }
      entry.child = null;
      entry.startedAt = null;
      this.log(`[connector:${name}] stopped`);
    }
  }

  /* A deliberate start clears the crash history - that is what makes
     'parked until restarted manually' true. */
  restart(name) {
    const entry = this._entry(name);
    this.stop(name);
    entry.restarts = [];
    entry.state = 'stopped';
    return this.start(name);
  }

  stopAll() {
    this.stopped = true;
    for (const name of this.connectors.keys()) this.stop(name);
  }

  /* One call for the Integrations screen and support. */
  status() {
    const names = new Set([...this.installedNames(), ...this.connectors.keys()]);
    return [...names].map((name) => {
      const entry = this._entry(name);
      const engine = this._engine(name);
      return {
        name,
        installed: Boolean(engine.activeVersion()),
        version: engine.activeVersion(),
        enabled: Boolean(this._loadConfig(name)),
        state: entry.state,
        startedAt: entry.startedAt,
        recentExits: entry.restarts.length,
      };
    });
  }
}

module.exports = {
  ConnectorSupervisor,
  RESTART_DELAY_MS,
  HEALTHY_AFTER_MS,
  CRASH_WINDOW_MS,
  CRASH_LIMIT,
};
