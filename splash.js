'use strict';
/*
 * The window that appears the moment somebody double-clicks the icon.
 *
 * Between the double-click and the till appearing there are a few seconds of
 * resolving ports, starting the database and booting the API. Nothing is on
 * screen for that time, so the shop assumes the click missed and clicks again -
 * and a second launch is worse than a slow one, because the single-instance
 * lock means the second click looks like nothing happened twice.
 *
 * Every application people already trust does this: a mark, a word, a moving
 * bar, gone as soon as the real window is ready. It is not decoration. It is
 * the only feedback available before there is a window to give any.
 *
 * Kept out of main.js because main.js is long enough, and because a splash that
 * fails must never stop the till starting - everything here is wrapped, and
 * every failure path returns rather than throws.
 */

const fs = require('fs');
const path = require('path');

let splash = null;
/* Once the real window has replaced it, a late call must not put it back. */
let finished = false;

/**
 * Show it, if there is any reason to.
 *
 * @param {object} electron   the electron module, passed in so this file can be
 *                            required and read by tests outside Electron
 * @param {object} [options]
 * @param {boolean} [options.hidden]  the app was started minimised to the tray
 */
function showSplash(electron, options = {}) {
  if (finished || splash) return null;
  /* Started with --hidden, or running a scheduled task: there is no user
     watching, and a window that flashes up unasked is worse than none. */
  if (options.hidden) return null;

  try {
    const { BrowserWindow, screen } = electron;

    const win = new BrowserWindow({
      width: 380,
      height: 260,
      frame: false,
      transparent: false,
      /* Shown for the instant before the page paints, so it matches the
       bottom of the gradient rather than flashing a different colour. */
      backgroundColor: '#0C3A64',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      alwaysOnTop: true,
      show: false,
      /* Nothing in here needs privilege: it is a mark and a moving bar. It gets
         the strictest settings in the application, and no preload at all. */
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
      },
    });

    /* Centre on the display the pointer is on, not the primary one - a till
       with a customer display should not open its splash on the customer's
       screen. */
    try {
      const cursor = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      win.setPosition(
        Math.round(area.x + (area.width - 380) / 2),
        Math.round(area.y + (area.height - 260) / 2)
      );
    } catch (e) {
      win.center();
    }

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html()));
    win.once('ready-to-show', () => {
      if (!finished && !win.isDestroyed()) win.show();
    });

    splash = win;
    return win;
  } catch (e) {
    console.warn('[Splash] could not show:', e.message);
    return null;
  }
}

/**
 * Take it down.
 *
 * Idempotent, and safe to call before it ever appeared - the startup path has
 * several exits and none of them should have to know which one ran.
 */
function closeSplash() {
  finished = true;
  const win = splash;
  splash = null;
  if (!win) return;
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch (e) {
    /* already gone */
  }
}

/** Is one on screen? For the startup code, and for tests. */
function splashIsOpen() {
  return Boolean(splash && !splash.isDestroyed());
}

/* The mark, inlined - this page is a data: URL and has no origin to resolve a
   file path against. Read once; a missing file just means no mark. */
function markDataUri() {
  try {
    const file = path.join(__dirname, 'builds', 'icon-256.png');
    if (!fs.existsSync(file)) return null;
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch (e) {
    return null;
  }
}

function html() {
  const mark = markDataUri();

  /*
   * An indeterminate bar, not a percentage.
   *
   * Startup has no honest progress to report - the database may take one second
   * or forty depending on whether it is a first run. A bar that crawls to 90%
   * and stops is a worse lie than one that never claimed to be measuring.
   */
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 14px;
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #fff;
    /* The logo's own blue. Sampled from builds/icon-256.png rather than
       picked by eye: #1B81DF, hue 209 at 78% saturation. The darker stops
       are the same hue and saturation at lower lightness, so the panel is
       one colour in shadow rather than three blues that nearly agree. */
    background: linear-gradient(160deg, #1B81DF 0%, #125796 55%, #0C3A64 100%);
    user-select: none; cursor: default;
    overflow: hidden;
  }
  .mark {
    width: 76px; height: 76px;
    background: #fff; border-radius: 18px; padding: 12px;
    box-shadow: 0 8px 22px rgba(0,0,0,.22);
  }
  .mark img { width: 100%; height: 100%; display: block; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: .01em; }
  p  { font-size: 12px; opacity: .72; margin-top: -8px; }
  .bar {
    width: 190px; height: 3px; border-radius: 3px;
    background: rgba(255,255,255,.22); overflow: hidden; margin-top: 4px;
  }
  /* Travels across and repeats. It says "working", which is all that is known. */
  .bar i {
    display: block; width: 40%; height: 100%; border-radius: 3px;
    background: #fff; opacity: .9;
    animation: slide 1.15s ease-in-out infinite;
  }
  @keyframes slide {
    0%   { transform: translateX(-105%); }
    100% { transform: translateX(355%); }
  }
  /*
   * Shutting down is the one thing here that does have honest progress to
   * report. It is a fixed list of steps - stop the scheduler, stop the sync
   * agent, close the API, disconnect, close the database - and the code walks
   * it in order, so "4 of 5" is a fact rather than an estimate.
   *
   * That is why this is a separate mode instead of the bar above. The startup
   * bar has nothing real to measure and says so by moving; this one fills as
   * work actually completes, and never fills before the work is done.
   */
  .bar.steps i {
    animation: none;
    width: 0;
    transition: width .45s cubic-bezier(.4,0,.2,1);
  }
  .step {
    font-size: 11px; opacity: .55; letter-spacing: .04em;
    text-transform: uppercase; margin-top: 2px; min-height: 13px;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar i { animation: none; width: 100%; opacity: .55; }
    .bar.steps i { transition: none; }
  }
</style></head>
<body>
  ${mark ? `<div class="mark"><img alt="" src="${mark}"></div>` : ''}
  <h1>Posnic</h1>
  <p>Starting your till&hellip;</p>
  <div class="bar"><i></i></div>
  <div class="step"></div>
</body></html>`;
}

/**
 * The same window again, for the other end of the day.
 *
 * Shutting down is not instant: the API has to stop and mongod has to close its
 * files cleanly, which together take the better part of a minute. Restart was
 * the worst of it - the window vanished, nothing happened for thirty or forty
 * seconds, and then the till reappeared. Anyone would assume it had crashed and
 * start clicking.
 *
 * Deliberately not a progress bar over a known duration. Stopping a database
 * takes as long as it takes, and a bar that finishes before the work does is
 * worse than one that never claimed to know.
 *
 * @param {object} electron
 * @param {object} [options]
 * @param {boolean} [options.restarting]  true for restart, false for quit
 */
function showShutdown(electron, options = {}) {
  /* Whatever state the startup splash was in, this is a new window and a new
     reason for one. */
  finished = false;
  splash = null;

  const win = showSplash(electron, {});
  if (!win) return null;

  /* An update installing on quit is the slowest of these by a long way - the
     database is closed, a backup is taken, and then an installer replaces the
     application. Told only that Posnic is "closing down safely", the wait reads
     as a hang, and the reasonable thing to do about a hang is kill it - during
     the one minute where killing it is genuinely a bad idea. */
  const message = options.updating
    ? 'Installing the update - do not turn the computer off...'
    : options.restarting
      ? 'Restarting - saving your work first...'
      : 'Closing down safely...';

  setSplashText(message);
  return win;
}

/*
 * Put a line of text on whichever splash is currently up.
 *
 * Everything is guarded and nothing throws: this is called from the middle of a
 * shutdown, and a window that has already gone must not take the shutdown with
 * it.
 */
function setSplashText(message, step) {
  const win = splash;
  if (!win) return;

  const paint = () => {
    if (win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(
        `(() => {
           const p = document.querySelector('p');
           if (p) p.textContent = ${JSON.stringify(String(message || ''))};
           const s = document.querySelector('.step');
           if (s) s.textContent = ${JSON.stringify(String(step || ''))};
         })();`,
      )
      .catch(() => {});
  };

  try {
    /* The page may not have parsed yet when this is called. */
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', paint);
    else paint();
  } catch (e) {
    /* window torn down mid-call */
  }
}

/**
 * Report a step of the shutdown as it completes.
 *
 * @param {number} done   steps finished
 * @param {number} total  steps in the whole shutdown
 * @param {string} label  what is happening now, in a shopkeeper's words
 *
 * The bar is switched to its determinate mode the first time this is called.
 * It fills as steps finish, which means it can sit at four fifths for as long
 * as closing the database takes - and that is the honest shape of this
 * particular wait, rather than a bar that reaches the end and then asks you to
 * keep waiting anyway.
 */
function setShutdownProgress(done, total, label) {
  const win = splash;
  if (!win) return;

  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;

  const paint = () => {
    if (win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(
        `(() => {
           const bar = document.querySelector('.bar');
           if (bar) bar.classList.add('steps');
           const fill = document.querySelector('.bar i');
           if (fill) fill.style.width = ${JSON.stringify(pct + '%')};
           const p = document.querySelector('p');
           if (p) p.textContent = ${JSON.stringify(String(label || ''))};
           const s = document.querySelector('.step');
           if (s) s.textContent = ${JSON.stringify(`Step ${Math.min(done + 1, total)} of ${total}`)};
         })();`,
      )
      .catch(() => {});
  };

  try {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', paint);
    else paint();
  } catch (e) {
    /* window torn down mid-call */
  }
}

/**
 * The window shown to somebody who reopened Posnic while it was still closing.
 *
 * They double-clicked the icon and, before this existed, nothing happened at
 * all - the new process could not take the single-instance lock and exited
 * silently. This says what is going on and then gets out of the way, because
 * the launch continues by itself as soon as the old process lets go.
 */
function showWaitingForPrevious(electron) {
  const win = showSplash(electron, {});
  if (!win) return null;
  setSplashText(
    'Finishing closing down - your till will open in a moment...',
    'Waiting for the previous session',
  );
  return win;
}

module.exports = {
  showSplash,
  closeSplash,
  splashIsOpen,
  showShutdown,
  setSplashText,
  setShutdownProgress,
  showWaitingForPrevious,
};
