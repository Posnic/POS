const { contextBridge, ipcRenderer } = require('electron');

// Expose hardware and printer APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  /*
   * Which operating system this is.
   *
   * The pages had no way to ask, so they assumed. The hardware screen offered
   * "Windows default printer" on a Mac, and warned that a receipt could not be
   * sent to "the Windows default" - naming a thing that does not exist there,
   * which makes a shop wonder what else the software has misunderstood about
   * their machine.
   *
   * A plain string rather than a boolean, so a page can say the right word for
   * each of the three rather than "Windows or not".
   */
  platform: process.platform,          // 'win32' | 'darwin' | 'linux'

  startup: {
    retry:   () => ipcRenderer.invoke('startup:retry'),
    openLog: () => ipcRenderer.invoke('startup:open-log')
  },
  // The setup wizard needs this machine's own install key: the API refuses
  // /api/install/* without one, and it is generated per installation rather
  // than shipped in the source.
  install: {
    credentials: () => ipcRenderer.invoke('install:credentials')
  },
  cloud: {
    activate:   (details) => ipcRenderer.invoke('cloud:activate', details),
    status:     () => ipcRenderer.invoke('cloud:status'),
    signup:     () => ipcRenderer.invoke('cloud:signup'),
    /* Opening an account from inside the installer, so "I do not have one yet"
       stops being the end of the installation. */
    captcha:       () => ipcRenderer.invoke('cloud:captcha'),
    createAccount: (details) => ipcRenderer.invoke('cloud:create-account', details),
    /* Pairing with a code issued by somebody allowed to add a device. */
    pair: (details) => ipcRenderer.invoke('cloud:pair', details),
    disconnect: () => ipcRenderer.invoke('cloud:disconnect'),
    checkData:  () => ipcRenderer.invoke('cloud:check-data')
  },
  desktop: {
    open:         (target) => ipcRenderer.invoke('desktop:open', target),
    capabilities: () => ipcRenderer.invoke('desktop:capabilities')
  },
  /* The log viewer reads the file through the main process rather than a
     file:// URL, so the page keeps the same sandbox as every other window. */
  logs: {
    read:   () => ipcRenderer.invoke('logs:read'),
    reveal: () => ipcRenderer.invoke('logs:reveal')
  },
  /* Contact support from inside the till. context() gathers what the machine
     can say about itself so the shop does not have to; submit() posts it to
     the provider this till actually syncs with, not necessarily to us. */
  support: {
    context:   () => ipcRenderer.invoke('support:context'),
    submit:    (payload) => ipcRenderer.invoke('support:submit', payload),
    /* Community Edition reports go to the public issue tracker instead. */
    openIssue: (details) => ipcRenderer.invoke('support:open-issue', details)
  },
  tray: {
    setBranches: (data) => ipcRenderer.invoke('tray:set-branches', data),
    onSwitchBranch: (callback) => ipcRenderer.on('tray:switch-branch', (_e, id) => callback(id))
  },
  hardware: {
    scanSerialPorts: (enableSimulation) => ipcRenderer.invoke('hardware:scan-ports', enableSimulation),
    connectPort: (portPath, isMock) => ipcRenderer.invoke('hardware:connect-port', portPath, isMock),
    disconnectPort: () => ipcRenderer.invoke('hardware:disconnect-port'),
    getStatus: () => ipcRenderer.invoke('hardware:get-status'),
    broadcastWeight: () => ipcRenderer.invoke('hardware:broadcast-weight'),
    // Returns an unsubscribe function: a page that asks for one weight must be
    // able to stop listening, or every reading piles up another handler.
    onUsbData: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('usb-data', handler);
      return () => ipcRenderer.removeListener('usb-data', handler);
    },
    // Essae network scale (TCP/IP)
    essae: {
      connect: (options) => ipcRenderer.invoke('essae:connect', options),
      disconnect: () => ipcRenderer.invoke('essae:disconnect'),
      status: () => ipcRenderer.invoke('essae:status'),
      saveConfig: (options) => ipcRenderer.invoke('essae:save-config', options),
    },
    onPortError: (callback) => {
      const handler = (event, error) => callback(error);
      ipcRenderer.on('port-error', handler);
      return () => ipcRenderer.removeListener('port-error', handler);
    }
  },
  printer: {
    list:       () => ipcRenderer.invoke('printer:list'),
    getDefault: () => ipcRenderer.invoke('printer:get-default'),
    getPaperSizes: () => ipcRenderer.invoke('printer:get-paper-sizes'),
    setDefault: (name) => ipcRenderer.invoke('printer:set-default', name),
    print:      (htmlContent, options) => ipcRenderer.invoke('printer:print', htmlContent, options),
    // Receipts go as ESC/POS on the desktop: no page, no scaling, no driver
    // rendering. The browser keeps using print() above.
    printReceipt: (sale, options) => ipcRenderer.invoke('printer:print-receipt', sale, options),
    previewReceipt: (sale, options) => ipcRenderer.invoke('printer:preview-receipt', sale, options),
    // Reports declare their sections; the main process decides how they fit
    // the paper. A4 reports keep going through the page path above.
    printReport: (doc, options) => ipcRenderer.invoke('printer:print-report', doc, options)
  },
  /*
   * The PIN lock. Everything about the PIN - the encrypted session, the key
   * derivation, the attempt limit - stays in the main process; a page can ask
   * to unlock and is given a session or refused, never anything it could use
   * to guess faster.
   */
  lock: {
    users:      () => ipcRenderer.invoke('lock:users'),
    isEnrolled: (username) => ipcRenderer.invoke('lock:is-enrolled', username),
    enroll:     (details) => ipcRenderer.invoke('lock:enroll', details),
    unlock:     (details) => ipcRenderer.invoke('lock:unlock', details),
    forget:     (username) => ipcRenderer.invoke('lock:forget', username),
    forgetAll:  () => ipcRenderer.invoke('lock:forget-all'),

    /*
     * The main process asking the page to lock.
     *
     * Needed because closing the window hides it to the tray rather than
     * quitting: the page is never reloaded, so nothing that runs on load can
     * notice. Without this, pressing X looked like putting the till away and
     * anybody could bring it back from the tray untouched.
     */
    onLockRequest: (handler) => ipcRenderer.on('lock:now', () => handler())
  },
  /*
   * Telling the window what colour the app just became.
   *
   * The title bar is drawn by Windows before any of this runs, so it has to be
   * told rather than asked. Colours only - nothing here can move, resize or
   * close the window.
   */
  theme: {
    setChrome: (theme) => ipcRenderer.invoke('theme:chrome', theme),
    /* The palette the app is wearing, for the settings windows, which have
       their own stylesheets and cannot see the app's. */
    palette: () => ipcRenderer.invoke('theme:palette'),
  },
  /*
   * The title bar's own buttons.
   *
   * The page draws minimise, maximise and close itself so the strip is one
   * surface in one colour; these are the only three things it needs to be able
   * to do to the window, and nothing here can move or resize it arbitrarily.
   */
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close:    () => ipcRenderer.invoke('window:close'),
    // So the title bar can draw "restore" rather than "maximise" once the
    // window is maximised, the way every other application on the machine does.
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (handler) => {
      const h = (_e, maximized) => handler(maximized);
      ipcRenderer.on('window:maximize-changed', h);
      return () => ipcRenderer.removeListener('window:maximize-changed', h);
    }
  },
  preferences: {
    get: (key) => ipcRenderer.invoke('preferences:get', key),
    set: (key, value) => ipcRenderer.invoke('preferences:set', key, value)
  },
  connectors: {
    status:  () => ipcRenderer.invoke('connectors:status'),
    enable:  (name, token, settings) => ipcRenderer.invoke('connectors:enable', { name, token, settings }),
    disable: (name) => ipcRenderer.invoke('connectors:disable', { name })
  },
  cashDrawer: {
    loadConfig:     () => ipcRenderer.invoke('cashDrawer:load-config'),
    saveConfig:     (config) => ipcRenderer.invoke('cashDrawer:save-config', config),
    openViaPrinter: (printerName, pin) => ipcRenderer.invoke('cashDrawer:open-via-printer', printerName, pin)
  },
  kot: {
    printTicket: (sale) => ipcRenderer.invoke('kot:print-ticket', sale),
    getConfig:    () => ipcRenderer.invoke('kot:get-config'),
    startPolling: (config) => ipcRenderer.invoke('kot:start-polling', config),
    stopPolling:  () => ipcRenderer.invoke('kot:stop-polling'),
    getStatus:    () => ipcRenderer.invoke('kot:get-status'),
    getLogs:      (date) => ipcRenderer.invoke('kot:get-logs', date),
    deleteLog:    (date, logId) => ipcRenderer.invoke('kot:delete-log', date, logId),
    reprint:      (logEntry) => ipcRenderer.invoke('kot:reprint', logEntry)
  },
  /*
   * The bill printer, which has two doors and can fail at either.
   *
   * Read-only on purpose: Hardware Manager shows what is happening, it does
   * not drive it. The poller starts with the app and stopping it would leave a
   * shop wondering why bills stopped without anybody touching a setting.
   */
  bill: {
    getStatus:     () => ipcRenderer.invoke('bill:get-status'),
    /* Answering a bill the queue parked for a person: it printed, or print it
       again. See api/src/repositories/print-job.repository resolveAttention. */
    answerWaiting: (id, printed) => ipcRenderer.invoke('bill:answer-waiting', id, printed),
    /* What the kitchen queue has been watching, for the panel that decides
       whether it is safe to cut the kitchen over to it. */
    shadowSummary: (days) => ipcRenderer.invoke('kot:shadow-summary', days),
    /* This machine's own key, for pasting into the shop so it will accept
       bills from here. See api/src/models/print-till.model.js. */
    getPrintingKey: () => ipcRenderer.invoke('bill:get-printing-key'),
    /* A day of receipt prints, tried as well as done - the same shape the KOT
       log already has, so one screen reads both. */
    getReceiptLogs: (date) => ipcRenderer.invoke('receipt:get-logs', date),
    deleteReceiptLog: (date, id) => ipcRenderer.invoke('receipt:delete-log', date, id)
  },
  /*
   * The sound an online order makes.
   *
   * Every other way this till learns about a sale has a person standing in
   * front of it. An online order is the one that arrives when nobody is
   * looking, and a badge on a screen nobody is facing is not a notification -
   * it is a record of something that was missed.
   *
   * The main process cannot play audio; only a renderer can. So it sends the
   * tone here, already synthesised, and the page plays it. A shop with no
   * window open makes no sound, which is correct: there is nobody to hear it.
   *
   * One way only. Nothing the page does through this can reach the machine.
   */
  orderAlert: {
    on: (handler) => {
      const h = (_e, payload) => handler(payload);
      ipcRenderer.on('posnic:order-alert', h);
      return () => ipcRenderer.removeListener('posnic:order-alert', h);
    },
    /* Somebody dealt with the queue, so stop the alarm repeating. */
    resolve: (saleId) => ipcRenderer.invoke('order-alert:resolve', saleId),
    clear: () => ipcRenderer.invoke('order-alert:clear'),
  },

  /*
   * A TICKET ARRIVING IN THE KITCHEN.
   *
   * Same reason as the alert above: the main process has neither an audio
   * device nor a speech engine, so it hands over a tone and a sentence and the
   * page does both. One way only - nothing the page does through this reaches
   * the machine.
   */
  kitchenCall: {
    on: (handler) => {
      const h = (_e, payload) => handler(payload);
      ipcRenderer.on('posnic:kitchen-call', h);
      return () => ipcRenderer.removeListener('posnic:kitchen-call', h);
    },
    /*
     * Whether THIS machine is the one by the pass, and which half it wants.
     *
     *   electronAPI.kitchenCall.get()                    -> { ting, speak }
     *   electronAPI.kitchenCall.set({ ting: true })      -> chime only
     *   electronAPI.kitchenCall.set({ speak: true })     -> and read it out
     *   electronAPI.kitchenCall.setOn(true)              -> both, the short way
     *
     * A value left out is left as it was, so turning the reading off does not
     * silently take the chime with it.
     */
    get: () => ipcRenderer.invoke('kitchen-announce:get'),
    set: (next) => ipcRenderer.invoke('kitchen-announce:set', next),
    /* Kept: it is what the kitchen machine was told to type. */
    isOn: () => ipcRenderer.invoke('kitchen-announce:get'),
    setOn: (on) => ipcRenderer.invoke('kitchen-announce:set', on === true),
    /*
     * Make the noise now, so somebody standing by the speaker can say whether
     * it works, instead of sending a real order to find out.
     *
     *   -> { played, reason, ting, speak }
     *
     * reason is 'off' when both switches are down, 'no-window' when there is
     * no page to play it, and 'ok' when it was sent.
     */
    test: () => ipcRenderer.invoke('kitchen-announce:test'),
    /*
     * The bells a shop can choose between, and one of them as playable audio.
     *
     *   electronAPI.kitchenCall.bells()                  -> { arrival: [...], item: [...] }
     *   electronAPI.kitchenCall.preview('item', 'tick')  -> a data: URL
     *
     * The names are the stored setting, so a settings page never has to know
     * how any of them are made.
     */
    bells: () => ipcRenderer.invoke('kitchen-announce:bells'),
    preview: (kind, which) => ipcRenderer.invoke('kitchen-announce:preview', kind, which),
  },
  mobile: {
    getInfo:       () => ipcRenderer.invoke('mobile:get-info'),
    getDevices:    () => ipcRenderer.invoke('mobile:get-devices'),
    getLogs:       () => ipcRenderer.invoke('mobile:get-logs'),
    blockDevice:   (ip) => ipcRenderer.invoke('mobile:block-device', ip),
    removeDevice:  (ip) => ipcRenderer.invoke('mobile:remove-device', ip),
    getBlocked:    () => ipcRenderer.invoke('mobile:get-blocked'),
    unblockDevice: (ip) => ipcRenderer.invoke('mobile:unblock-device', ip),
    clear:          () => ipcRenderer.invoke('mobile:clear'),
    /* Whether Windows is letting handsets in at all. The startup check asks
       this once and can be dismissed; this is the place somebody looks when a
       phone has stopped finding the till. */
    checkFirewall: () => ipcRenderer.invoke('handsets:check'),
    allowThroughFirewall: () => ipcRenderer.invoke('handsets:allow')
  }
});

// Expose navigation API for install wizard + backup APIs
contextBridge.exposeInMainWorld('electron', {
  loadPage: (page) => ipcRenderer.send('load-page', page),
  getApiPort: () => ipcRenderer.invoke('get-api-port'),
  
  // Backup-related APIs
  getDefaultBackupPath: () => ipcRenderer.invoke('backup:get-default-path'),
  browseBackupFolder: () => ipcRenderer.invoke('backup:browse-folder'),
  saveBackupConfig: (config) => ipcRenderer.invoke('backup:save-config', config),
  getBackupConfig: () => ipcRenderer.invoke('backup:get-config'),
  runBackupNow: (force) => ipcRenderer.invoke('backup:run-now', force),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (folderPath, options) => ipcRenderer.invoke('backup:restore', folderPath, options),
  deleteBackup: (folderPath) => ipcRenderer.invoke('backup:delete', folderPath),
  getBackupHistory: () => ipcRenderer.invoke('backup:get-history'),
  // The operating-system scheduler commands, with this machine's real paths in
  // them. Backups only run while Posnic is open; this is how a shop that closes
  // the till every evening still gets an overnight one.
  getScheduleInstructions: (options) => ipcRenderer.invoke('backup:schedule-instructions', options),
  
  // Subscribe to scheduled backup events
  onBackupResult: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on('backup:result', handler);
    return () => ipcRenderer.removeListener('backup:result', handler);
  },
  
  // Update-related APIs (electron-updater based)
  update: {
    getStatus:  () => ipcRenderer.invoke('update:get-status'),
    check:      () => ipcRenderer.invoke('update:check'),
    download:   () => ipcRenderer.invoke('update:download'),
    install:    () => ipcRenderer.invoke('update:install'),
    getConfig:  () => ipcRenderer.invoke('update:config-get'),
    saveConfig: (patch) => ipcRenderer.invoke('update:config-save', patch),
    // No token bridge. Releases are public, and a point of sale should never
    // be asking a shopkeeper for a GitHub credential. See update-service.js.
    // Going back to the previous version: a pointer move and a restart, so it
    // works on a machine that cannot reach the network.
    revertStatus: () => ipcRenderer.invoke('update:revert-status'),
    revert:       () => ipcRenderer.invoke('update:revert'),

    onStatus: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update:status', h);
      return () => ipcRenderer.removeListener('update:status', h);
    },
    onProgress: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('update:progress', h);
      return () => ipcRenderer.removeListener('update:progress', h);
    }
  }
});

/*
 * THE KITCHEN SCREEN, both sides of it.
 *
 * Two audiences, one bridge. Hardware Manager asks what displays exist and
 * writes what the shop chose; the screen on the wall listens for its own
 * configuration and its tickets. Neither is given anything it does not need -
 * the screen cannot write settings, and the manager cannot push tickets.
 */
contextBridge.exposeInMainWorld('posnicKitchenScreen', {
  /* Hardware Manager: choosing and placing a screen. */
  list:      ()                 => ipcRenderer.invoke('kitchen-screen:list'),
  configure: (displayId, patch) => ipcRenderer.invoke('kitchen-screen:configure', displayId, patch),
  preview:   (displayId, on)    => ipcRenderer.invoke('kitchen-screen:preview', displayId, on),

  /* The screen on the wall. It only ever receives. */
  ready:     (displayId)        => ipcRenderer.invoke('kitchen-screen:ready', displayId),
  onConfig:  (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('kitchen-screen:config', h);
    return () => ipcRenderer.removeListener('kitchen-screen:config', h);
  },
  onTickets: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('kitchen-screen:tickets', h);
    return () => ipcRenderer.removeListener('kitchen-screen:tickets', h);
  }
});
