/**
 * Posnic Update Service
 *
 * Uses electron-updater (same engine as Slack, VS Code) for reliable
 * Electron auto-updates via GitHub Releases.
 *
 * Key behaviours:
 *  - Production only  (app.isPackaged guard — dev mode is silently skipped)
 *  - autoDownload = false  (user controls when to download)
 *  - autoInstallOnAppQuit stays OFF: install-on-close is sequenced by
 *    main.js's before-quit handler (backup first, then quitAndInstall),
 *    honouring the shop's installOnQuit setting
 *  - Supports both automatic (startup + periodic) and manual checks
 *  - Broadcasts status / progress events to all open BrowserWindows
 */

const fs   = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

class UpdateService {
  constructor(options = {}) {
    this._configPath = path.join(app.getPath('userData'), 'update-config.json');
    this._beforeInstall = typeof options.beforeInstall === 'function'
      ? options.beforeInstall
      : null;

    // Internal state
    this._status     = 'idle'; // idle | checking | available | not-available | downloading | downloaded | error
    this._updateInfo = null;
    this._progress   = null;
    this._error      = null;
    this._errorTime  = null; // Timestamp when error occurred

    this._configure();

    /* Any token file left behind by an older build is removed rather than
       ignored. It is a credential in plain text in the user data folder, and
       nothing reads it now - leaving it there would be leaving a secret on
       disk for no reason at all. */
    this._removeLegacyCredentials();
  }

  _removeLegacyCredentials() {
    try {
      const legacy = path.join(app.getPath('userData'), 'update-credentials.json');
      if (fs.existsSync(legacy)) {
        fs.unlinkSync(legacy);
        console.log('[UpdateService] Removed the update token left by an older build');
      }
    } catch (e) {
      console.warn('[UpdateService] Could not remove the legacy token file:', e.message);
    }
  }

  // ── electron-updater setup ────────────────────────────────────────────────

  _configure() {
    let autoUpdater;
    try {
      autoUpdater = require('electron-updater').autoUpdater;
    } catch (e) {
      console.error('[UpdateService] electron-updater not installed:', e.message);
      return;
    }

    this._autoUpdater = autoUpdater;

    autoUpdater.autoDownload        = false;
    autoUpdater.autoInstallOnAppQuit = false;
    /* Stable only, until the stored channel says otherwise. Set here as well as
       in _applyChannel so that a config file that cannot be read leaves an
       installation on stable rather than on whatever electron-updater
       defaults to. */
    autoUpdater.allowPrerelease     = false;
    
    // Quiet logging: expected failures (no release yet, offline, private
    // repo) are one line, not a wall of headers. Full details only for
    // genuinely unexpected errors.
    autoUpdater.logger = null;
    autoUpdater.on('error', (err) => {
      const firstLine = String(err && err.message || err).split('\n')[0];
      console.log('[UpdateService] Update check failed:', firstLine);
    });
    
    /*
     * Slack-style silent updates.
     *
     * We deliberately do NOT show a taskbar progress bar or an "update ready"
     * popup. An app (patch/minor) update - which is where our features ship -
     * downloads quietly in the background (see update-available below) and is
     * applied on the next close by the quit handler, which backs the shop up
     * first. So the till just opens on the new version next launch: the shop
     * never sees a download bar or a prompt, exactly like Slack.
     *
     * The Updates screen still shows live progress for anyone who opens it (that
     * broadcast is a separate listener below), and core (Electron/Node) updates
     * still wait for a deliberate click because their restart is longer.
     */

    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
      console.log('[UpdateService] Dev mode — check/download enabled, install disabled');
    }

    autoUpdater.on('checking-for-update', () => {
      this._set('checking');
    });

    autoUpdater.on('update-available', (info) => {
      /* A check that found something is still a check. Recording it only when
         nothing was found left the screen reading "Last checked: Never" while
         it was downloading the update that check had just discovered - so the
         one moment the shop is most likely to be looking at this window was
         the one moment it claimed never to have looked. */
      this._saveLastCheck();
      this._updateInfo = this._strip(info);
      this._updateInfo.kind = this._classify(info && info.version);
      this._set('available');

      /*
       * An application update fetches itself; a core one waits to be asked.
       *
       * A patch or minor release changes our own pages and API. It is small,
       * the next release supersedes it, and there is nothing in it a
       * shopkeeper can usefully decide about - so waiting for a click only
       * means tills run last month's build for months.
       *
       * A major release carries Electron, Node or a rebuilt native module.
       * That is a real download and a real restart, so it waits for a moment
       * the shop picks rather than landing in the middle of a queue.
       */
      if (this._updateInfo.kind === 'app') {
        console.log(`[UpdateService] ${info.version} is an application update; downloading quietly`);
        this.downloadUpdate().catch((e) =>
          console.warn('[UpdateService] background download failed:', e.message));
      } else {
        console.log(`[UpdateService] ${info.version} changes the core; leaving it for the shop to start`);
      }
    });

    autoUpdater.on('update-not-available', () => {
      this._saveLastCheck();
      this._set('not-available');
    });

    autoUpdater.on('download-progress', (p) => {
      this._progress = {
        percent:     Math.round(p.percent || 0),
        transferred: p.transferred || 0,
        total:       p.total || 0,
        speed:       p.bytesPerSecond || 0
      };
      this._status = 'downloading';
      this._broadcast('update:progress', this._progress);
      this._broadcast('update:status',   this._snapshot());
    });

    autoUpdater.on('update-downloaded', (info) => {
      this._updateInfo = this._strip(info);
      this._updateInfo.kind = this._classify(info && info.version);
      this._set('downloaded');

      /*
       * An application update goes in when the till is next closed.
       *
       * Not now: a shop closes the app at the end of the day, and that is the
       * moment to swap files - never mid-sale, and never by taking the window
       * away from someone serving a customer. electron-updater does exactly
       * this if asked, so the next launch is simply the new version.
       *
       * A core update is left alone. It waits on the Updates screen until the
       * shop starts it, because the restart is longer and they should pick
       * when.
       */
      /* Note: electron-updater's own autoInstallOnAppQuit stays OFF (set once
         in init). The install-on-close behaviour is sequenced by main.js's
         before-quit handler instead - prepareQuitInstall (backup, while the
         database is still up) then finishQuitInstall - and it also honours the
         shop's installOnQuit setting. Turning the built-in flag on here would
         bypass both. */
      if (this._updateInfo.kind === 'app') {
        console.log(`[UpdateService] ${info.version} downloaded; it will be applied when the app is next closed`);
      }
    });

    autoUpdater.on('error', (err) => {
      this._error = this._cleanError(err.message);
      this._errorTime = Date.now(); // Track when error occurred
      this._set('error');
    });

    /* Last, so that every listener above is attached before the stored channel
       can change what the updater will offer. */
    this._applyChannel();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /*
   * Is this release ours, or is it the platform underneath?
   *
   * Encoded in the version number rather than a separate flag, so there is
   * nothing to remember to set and nothing that can disagree with the build:
   *
   *   1.0.x  our pages, our API              -> 'app', installs itself
   *   1.x.0  our features                    -> 'app', installs itself
   *   x.0.0  Electron, Node, native modules  -> 'core', the shop chooses
   *
   * A major version is the one that changes what the application is running
   * on. Reserving it for that is a discipline the release process has to keep,
   * and it is written down in docs/DEVELOPMENT.md so it survives us.
   */
  _classify(version) {
    const parts = String(version || '').split('.').map((n) => parseInt(n, 10));
    if (parts.length < 3 || parts.some(isNaN)) return 'core';   // unreadable: ask
    const current = String(app.getVersion() || '').split('.').map((n) => parseInt(n, 10));
    if (current.length < 3 || current.some(isNaN)) return 'core';
    return parts[0] > current[0] ? 'core' : 'app';
  }

  _strip(info) {
    return {
      version:      String(info.version      || ''),
      releaseDate:  String(info.releaseDate  || ''),
      releaseName:  String(info.releaseName  || ''),
      releaseNotes: this._notes(info.releaseNotes)
    };
  }

  /*
   * What changed, in a form the Updates screen can show.
   *
   * electron-updater hands this over as a string for one release, and as an
   * array of { version, note } when the shop has skipped several - which is the
   * normal case for a till that was switched off for a fortnight. Only the
   * string was being kept, so exactly the shop with the most to read saw
   * nothing at all.
   *
   * The result is plain text. Release bodies are written by us but travel from
   * github.com, and the Updates window can reach the updater through its
   * preload - so this is never handed to innerHTML anywhere, and the markup a
   * markdown body carries is stripped rather than trusted.
   */
  _notes(raw) {
    const asText = (value) =>
      String(value || '')
        .replace(/<[^>]*>/g, '')   // any markup that came with it
        .replace(/\r\n/g, '\n')
        .trim();

    if (Array.isArray(raw)) {
      return raw
        .filter((entry) => entry && (entry.note || entry.version))
        .map((entry) => {
          const heading = entry.version ? `Version ${entry.version}` : '';
          const body = asText(entry.note);
          return heading ? `${heading}\n${body}` : body;
        })
        .join('\n\n')
        .slice(0, 20000);
    }
    return asText(raw).slice(0, 20000);
  }

  _cleanError(msg) {
    if (!msg) return 'Unknown error';
    // HTTP status errors from electron-updater (contain full headers/cookies)
    const statusMatch = msg.match(/HttpError[:\s]+(\d+)/i) || msg.match(/^(\d{3})\s/);
    if (statusMatch) {
      const code = statusMatch[1];
      const urlMatch = msg.match(/url:\s*(https?:\/\/[^\s\\"\\n]+)/i);
      const host = urlMatch ? new URL(urlMatch[1]).hostname : 'update server';
      if (code === '404') return `No releases found on update server (${host}). Please create a GitHub Release first.`;
      if (code === '401' || code === '403') return `Access denied (${code}). Check your GitHub token or repo visibility.`;
      return `Update server returned HTTP ${code}.`;
    }
    // Trim anything after "Headers:" or "\\n" to drop raw HTTP dump
    const truncated = msg.replace(/\s*Headers?\s*:\s*\{[\s\S]*/i, '').replace(/\\n[\s\S]*/g, '').trim();
    return truncated.length > 120 ? truncated.substring(0, 120) + '…' : truncated || msg.substring(0, 120);
  }

  _set(status) {
    this._status = status;
    this._broadcast('update:status', this._snapshot());
    
    // Notify main process to update menu badge
    // Call global function if it exists (set by main.js)
    if (global.updateMenuBadge) {
      global.updateMenuBadge(status);
    }
  }

  _snapshot() {
    return {
      status:       this._status,
      updateInfo:   this._updateInfo,
      progress:     this._progress,
      error:        this._error,
      currentVersion: app.getVersion(),
      isProduction: app.isPackaged,
      /* The Updates window already reads this from every status broadcast, but
         nothing ever put it in one - so the field was set once from the config
         when the window opened and then stood still. Check Now would find an
         update, report it, and leave "Last checked" reading whatever it said
         before, including "Never". */
      lastCheck:    this.loadConfig().lastCheck || null,
      channel:      this.loadConfig().channel === 'beta' ? 'beta' : 'stable'
    };
  }

  _broadcast(channel, data) {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        try { win.webContents.send(channel, data); } catch (_) {}
      }
    });
  }

  /*
   * There is deliberately no token handling here any more.
   *
   * This used to read a GitHub token from update-credentials.json, from
   * GH_TOKEN, or from a value pasted into the Updates window, and attach it as
   * an Authorization header so the updater could reach a private repository.
   * That belongs to a private beta, not to software a shop installs.
   *
   * Three reasons it is gone rather than merely unused:
   *
   *   - Releases are public. A token buys nothing and its only effect would be
   *     to send a credential to github.com on every update check.
   *   - It asked shopkeepers for a GitHub token, which is not a thing a shop
   *     has, and teaching people to paste credentials into a point of sale is
   *     a habit worth not starting.
   *   - update-credentials.json sat in the user data folder in plain text
   *     beside the database credentials, which are not.
   *
   * If a white-label or private-channel build is ever needed, it should be a
   * separate build flavour with its own feed configuration - not a code path
   * that ships to every shop and waits for a token that never arrives.
   */

  // ── Config ────────────────────────────────────────────────────────────────

  loadConfig() {
    try {
      if (fs.existsSync(this._configPath)) {
        return JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
      }
    } catch (_) {}
    return {
      autoCheck: true,
      checkFrequency: 'daily',
      lastCheck: null,
      installOnQuit: true,
      /* Stable unless somebody deliberately opts in. A shop that never opens
         this screen must never be given a test build. */
      channel: 'stable'
    };
  }

  saveConfig(patch) {
    try {
      const merged = { ...this.loadConfig(), ...patch };
      fs.writeFileSync(this._configPath, JSON.stringify(merged, null, 2));
      /* The channel is the updater's behaviour, not just a stored preference.
         Written without applying it, the screen would show "Test builds" while
         the updater carried on offering stable ones until the next restart. */
      this._applyChannel(merged);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /*
   * Which releases this installation is willing to be offered.
   *
   *   stable  - published releases only. What every shop gets.
   *   beta    - pre-releases as well: the builds cut from main.
   *
   * It is one line because that is genuinely all it is. `allowPrerelease` is
   * the whole mechanism: the beta workflow publishes its builds as GitHub
   * pre-releases, and an installation with this false cannot see them at all -
   * not "sees and declines", but never learns they exist. So the separation
   * between a tester and a shop is enforced by the updater rather than by
   * anyone remembering which build went where.
   *
   * There is one sharp edge, and it is stated on the screen rather than hidden
   * here: leaving the test channel does not move you back. electron-updater
   * only ever goes forwards, so a tester on 2.1.0-beta.4 who switches to stable
   * stays there until stable passes it. Going back sooner means reinstalling,
   * which is the same route as any other downgrade.
   */
  _applyChannel(config) {
    if (!this._autoUpdater) return;
    const beta = (config || this.loadConfig()).channel === 'beta';
    this._autoUpdater.allowPrerelease = beta;
    console.log(`[UpdateService] Update channel: ${beta ? 'beta (test builds)' : 'stable'}`);
  }

  _saveLastCheck() {
    this.saveConfig({ lastCheck: new Date().toISOString() });
  }

  // ── Installing when the shop closes the till ──────────────────────────────

  /*
   * The pattern every desktop application people already trust uses: download
   * quietly, then apply the update the next time the program is closed. Nobody
   * is asked to stop what they are doing, and nobody has to remember to click
   * anything.
   *
   * It suits a till better than it suits a browser. A shop closes at the end of
   * the day anyway, so the restart is free - and the one moment an update must
   * never interrupt, the middle of a sale, is the one moment this cannot fire.
   *
   * electron-updater has autoInstallOnAppQuit for exactly this, and it is
   * deliberately left off. Its quit handler bypasses quitAndInstall(), and
   * with it the forced backup that runs before an update is applied. Losing
   * that to gain the same behaviour would be a bad trade, so the application
   * does the sequencing itself: back up while the database is still running,
   * shut down, then install.
   */

  /** Is there an update sitting downloaded and waiting? */
  isDownloaded() {
    return this._status === 'downloaded' && Boolean(this._updateInfo);
  }

  /**
   * Should the update be applied as this process exits?
   *
   * Separate from isDownloaded() so the shop can keep automatic downloads and
   * still choose to apply updates by hand.
   */
  shouldInstallOnQuit() {
    if (!app.isPackaged || !this._autoUpdater) return false;
    if (!this.isDownloaded()) return false;
    return this.loadConfig().installOnQuit !== false;
  }

  /**
   * Take the pre-update backup, while the database is still up.
   *
   * Called before the shutdown sequence rather than after it, because by the
   * time the process is ready to exit mongod has already stopped and a backup
   * would fail - or worse, appear to succeed and be empty.
   */
  async prepareQuitInstall() {
    try {
      await this._runBeforeInstallBackup();
      return { ok: true };
    } catch (e) {
      /* A failed backup cancels the update. The shop keeps running the version
         it has, which is the safe direction: an update deferred costs a day, an
         update applied over an unbacked-up database can cost the year. */
      console.error('[UpdateService] Pre-update backup failed; not installing on quit:', e.message);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Hand over to the installer as the last thing this process does.
   *
   * Silent, and without relaunching: the shop closed the application, so it
   * stays closed. The next launch is the new version, which is what people
   * already expect from everything else on the machine.
   */
  finishQuitInstall() {
    try {
      console.log('[UpdateService] Installing the downloaded update on quit');
      this._autoUpdater.quitAndInstall(true, false);
      return { ok: true };
    } catch (e) {
      console.error('[UpdateService] Install on quit failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getStatus() {
    // If status is 'error' and it's been more than 5 minutes, reset to idle
    // This prevents stale error messages from showing when window reopens
    if (this._status === 'error' && this._errorTime) {
      const elapsed = Date.now() - this._errorTime;
      if (elapsed > 5 * 60 * 1000) { // 5 minutes
        console.log('[UpdateService] Clearing stale error status');
        this._status = 'idle';
        this._error = null;
        this._errorTime = null;
      }
    }
    
    return this._snapshot();
  }

  async checkForUpdates() {
    if (!this._autoUpdater) return { success: false, error: 'electron-updater not available' };
    try {
      await this._autoUpdater.checkForUpdates();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async downloadUpdate() {
    if (!this._autoUpdater) return { success: false, error: 'electron-updater not available' };
    try {
      await this._autoUpdater.downloadUpdate();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _runBeforeInstallBackup() {
    if (!this._beforeInstall) return null;

    console.log('[UpdateService] Running pre-install backup...');
    const startedAt = Date.now();
    const result = await this._beforeInstall();
    const durationMs = Date.now() - startedAt;

    if (result?.skipped) {
      console.log('[UpdateService] Pre-install backup skipped:', result.message || 'No data changes');
    } else {
      const sizeMB = ((result?.size || 0) / 1024 / 1024).toFixed(2);
      console.log('[UpdateService] Pre-install backup complete:', {
        path: result?.path,
        collections: result?.collections,
        totalDocuments: result?.totalDocuments,
        sizeMB,
        durationMs
      });
    }

    return result;
  }

  async quitAndInstall() {
    if (!app.isPackaged) { 
      console.log('[UpdateService] Dev mode — install skipped'); 
      return { success: true, skipped: true, message: 'Install skipped in dev mode' };
    }
    if (!this._autoUpdater) {
      console.error('[UpdateService] autoUpdater not available!');
      return { success: false, error: 'autoUpdater not available' };
    }
    
    console.log('[UpdateService] ========================================');
    console.log('[UpdateService] Starting update installation process...');
    console.log('[UpdateService] ========================================');
    
    try {
      await this._runBeforeInstallBackup();

      // Create update progress window
      const updateWindow = new BrowserWindow({
        width: 400,
        height: 200,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        center: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          /* This window shows a progress message and nothing else - it has no
             preload and needs no privilege at all, so it gets the strictest
             settings in the application. */
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      });
      
      // Show update message
      updateWindow.loadURL(`data:text/html;charset=utf-8,
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              background: transparent;
            }
            .container {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              border-radius: 12px;
              padding: 30px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              color: white;
            }
            .icon {
              font-size: 48px;
              margin-bottom: 15px;
              animation: pulse 1.5s ease-in-out infinite;
            }
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.1); }
            }
            h2 { 
              font-size: 20px; 
              margin-bottom: 10px;
              font-weight: 600;
            }
            p { 
              font-size: 14px; 
              opacity: 0.9;
              line-height: 1.5;
            }
            .spinner {
              margin: 15px auto 0;
              width: 40px;
              height: 40px;
              border: 4px solid rgba(255,255,255,0.3);
              border-top-color: white;
              border-radius: 50%;
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">🔄</div>
            <h2>Update Installing...</h2>
            <p>Please wait while we update Posnic<br>App will restart automatically</p>
            <div class="spinner"></div>
          </div>
        </body>
        </html>
      `);
      
      console.log('[UpdateService] Update progress window created');
      
      // Wait for window to fully render and show
      updateWindow.once('ready-to-show', () => {
        updateWindow.show();
        console.log('[UpdateService] Update window shown to user');
        
        // Now close main windows
        setTimeout(() => {
          // Prevent app from quitting when all windows are closed
          app.removeAllListeners('window-all-closed');
          console.log('[UpdateService] Removed window-all-closed listeners');
          
          // Get all windows except update window
          const windows = BrowserWindow.getAllWindows();
          console.log(`[UpdateService] Found ${windows.length} windows to close`);
          
          windows.forEach((w, index) => {
            if (!w.isDestroyed() && w !== updateWindow) {
              console.log(`[UpdateService] Destroying window ${index + 1}/${windows.length}`);
              w.removeAllListeners('close');
              w.destroy();
            }
          });
          
          console.log('[UpdateService] All main windows destroyed');
          
          // Keep update window visible for 3 seconds
          setTimeout(() => {
            console.log('[UpdateService] Closing update window and starting install...');
            
            // Close update window
            if (!updateWindow.isDestroyed()) {
              updateWindow.close();
            }
            
            // Small delay to ensure window is fully closed
            setTimeout(() => {
              console.log('[UpdateService] Calling quitAndInstall(isSilent=true, forceRunAfter=true)...');

              /*
               * Silent, because this is an update and not a first install.
               *
               * The NSIS installer is built with oneClick: false, which is
               * right the first time - a shop should choose where it goes. Run
               * without /S for an update it asks all of it again: installation
               * directory, Start Menu folder, shortcuts. So the till sat with
               * "Closing down safely" on screen while a wizard waited behind it
               * for an answer nobody knew was wanted, and the update read as a
               * hang. Answering it differently would also move an installation
               * that is already working.
               *
               * forceRunAfter is true here and false on the quit path, and the
               * difference is the whole reason they are two methods: this one
               * runs because somebody pressed install and is waiting at the
               * screen, so Posnic must come back. A silent install has no
               * Finish button to bring it back with.
               */
              this._autoUpdater.quitAndInstall(true, true);

              console.log('[UpdateService] quitAndInstall() called successfully');
            }, 200);
            
          }, 3000); // Show message for 3 seconds (increased from 1.5s)
          
        }, 500); // Wait before closing main windows
      });
      return { success: true };
    } catch (error) {
      console.error('[UpdateService] ERROR during quitAndInstall:', error);
      console.error('[UpdateService] Error stack:', error.stack);
      this._error = this._cleanError(error.message);
      this._errorTime = Date.now();
      this._set('error');
      return { success: false, error: error.message };
    }
  }

  // ── Auto-check scheduling (called once on startup) ────────────────────────

  startAutoCheck() {
    if (!app.isPackaged || !this._autoUpdater) {
      console.log('[UpdateService] Auto-check skipped - dev mode or no updater');
      return;
    }
    
    const config = this.loadConfig();
    if (!config.autoCheck) {
      console.log('[UpdateService] Auto-check disabled in settings');
      return;
    }

    console.log('[UpdateService] Auto-check enabled - will check in 30 seconds');
    
    // Initial check after 30 seconds (let app fully start first)
    setTimeout(() => {
      console.log('[UpdateService] Running scheduled auto-check...');
      this._autoUpdater.checkForUpdates().catch((err) => {
        console.log('[UpdateService] Auto-check failed:', err.message);
      });
    }, 30 * 1000);

    // Periodic background check
    const intervalMs = (config.checkFrequency === 'daily' ? 24 : 168) * 3600 * 1000;
    setInterval(() => {
      this._autoUpdater.checkForUpdates().catch(() => {});
    }, intervalMs);
  }
}

module.exports = UpdateService;
