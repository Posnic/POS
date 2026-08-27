/*
 * Every IPC message is checked against the frame that sent it.
 *
 * There were 78 ipcMain handlers across main.js, hardware-ipc.js,
 * pin-lock-ipc.js and update-integration.js, and not one of them looked at
 * event.senderFrame. Among them: backup:restore, backup:delete,
 * backup:browse-folder and desktop:open. Electron's own security checklist
 * puts "validate the sender of all IPC messages" in its list, and the reason
 * is this shape exactly - any frame that can reach ipcRenderer inherits the
 * whole privileged surface of the main process.
 *
 * That mattered here more than usual, because three other things composed with
 * it: the API's Content-Security-Policy allows 'unsafe-eval' for the legacy
 * frontend, print windows render renderer-supplied HTML, and those print
 * windows ran with webSecurity disabled. A script running in one of them could
 * reach every handler above.
 *
 * The rule is an allowlist of origins, not a denylist of attacks:
 *
 *   file://   - only the HTML files this application ships
 *   http://localhost:<apiPort> and 127.0.0.1 - the frontend the local API serves
 *   anything else, including data:, is refused
 *
 * data: is refused deliberately. It is how print windows are loaded, and their
 * content comes from the renderer, so a page that can ask for a print can
 * otherwise ask for a restore.
 */

const path = require('path');

/*
 * The pages this application ships and loads over file://. A window loading
 * anything else from disk is not one of ours.
 */
const PACKAGED_PAGES = new Set([
  'loading.html',
  'install-wizard.html',
  'cloud-setup.html',
  'backup-manager.html',
  'hardware-manager.html',
  'update-manager.html',
]);

/* Read the port when asked, never at module load: main.js sets it after
   resolveLocalPorts, and a value captured here would be the fallback. */
function apiPort() {
  return Number(process.env.PORT) || 5555;
}

function describe(frame) {
  if (!frame) return '(no frame)';
  try {
    return frame.url || '(no url)';
  } catch {
    /* A frame that has already gone away throws on property access. */
    return '(frame destroyed)';
  }
}

/**
 * Is this frame one of ours?
 *
 * Exported for tests, which is why it takes a plain { url } rather than an
 * Electron frame.
 */
function isTrustedFrame(frame) {
  if (!frame) return false;

  let raw;
  try {
    raw = frame.url;
  } catch {
    return false;
  }
  if (!raw || typeof raw !== 'string') return false;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol === 'file:') {
    /* Compare the file name only. The directory differs between a checkout and
       an installed app, and inside an asar it is a virtual path. */
    const name = path.basename(decodeURIComponent(url.pathname));
    return PACKAGED_PAGES.has(name);
  }

  if (url.protocol === 'http:') {
    /*
     * Any loopback port, not only the API's.
     *
     * Matching the exact port was tighter and too brittle to be worth it: a
     * customer display or catalog window served from a second local port, or a
     * port that changes between resolution and use, would lose IPC and fail in
     * a way nobody would connect back to this file. Nothing is given away by
     * the wider rule - code already running on this machine's loopback
     * interface can reach the API regardless - and the two cases this exists to
     * refuse, a remote origin and a data: print window, are still refused.
     */
    const host = url.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  /* data:, https:, about:, blob:, ws: and everything else. */
  return false;
}

/**
 * Wrap ipcMain so every handler registered through it checks its sender first.
 *
 * Returns an object with the same handle/on shape, so a registration site
 * changes only in which object it calls.
 */
function guard(ipcMain, { onRefused } = {}) {
  const refuse = (channel, event) => {
    const where = describe(event && event.senderFrame);
    const message = `[ipc] refused "${channel}" from ${where}`;
    if (typeof onRefused === 'function') onRefused(channel, where);
    else console.warn(message);
    return new Error(`Refused: ${channel} is not available to this window`);
  };

  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedFrame(event.senderFrame)) throw refuse(channel, event);
        return listener(event, ...args);
      });
    },

    on(channel, listener) {
      ipcMain.on(channel, (event, ...args) => {
        /* A send() has no reply channel, so a refusal can only be dropped and
           logged. Returning early is the refusal. */
        if (!isTrustedFrame(event.senderFrame)) {
          refuse(channel, event);
          return undefined;
        }
        return listener(event, ...args);
      });
    },

    /* A few channels answer before a window has a trusted URL - the loading
       screen asks for its own port while it is still about:blank. Registering
       through this says so out loud rather than by omission. */
    handleUnguarded(channel, listener, why) {
      if (!why) throw new Error(`handleUnguarded("${channel}") needs a reason`);
      ipcMain.handle(channel, listener);
    },

    removeHandler(channel) {
      ipcMain.removeHandler(channel);
    },
  };
}

module.exports = { guard, isTrustedFrame, PACKAGED_PAGES };
