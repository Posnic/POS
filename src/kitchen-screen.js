'use strict';

/*
 * THE SECOND SCREEN, ON THE END OF AN HDMI CABLE.
 *
 * Owner: "kitchen display i can send one hdmi cable and show the current
 * order... as of now one screen. but we have option multiple screen is good.
 * we should able get control of it ans show it."
 *
 * So: as many screens as the machine has, each one configured separately, and
 * the till drives all of them. A separate device per screen would add a
 * network, a pairing and a thing to update, and would still go dark when the
 * till went dark - it removes no failure and adds several.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR
 *
 * Finding the displays, remembering which ones a shop chose, and keeping a
 * window alive on each. It does NOT decide what a ticket looks like; that is
 * the page it loads. The split matters because the window has to survive
 * things the page cannot see - a cable pulled out mid-service, a television
 * switched off at the wall, a resolution change when somebody plugs in a
 * laptop.
 *
 * THE RULES IT MUST NOT BREAK, in order of how badly they would hurt
 *
 *   1. The till keeps selling. Nothing here may throw into the boot chain or
 *      block a sale. A kitchen screen is an accessory; the till is the shop.
 *   2. It never steals focus. A waiter typing an order into a window that just
 *      lost focus is how this feature gets switched off in week one.
 *   3. It never moves the till's own window. Unplugging the kitchen screen
 *      must not drag the sale screen onto a display that is no longer there.
 *   4. It comes back by itself. On restart, and when a display reappears. A
 *      screen that needs somebody to click "open kitchen display" after every
 *      power cut will be dark by Thursday.
 *
 * ABSENT MEANS OFF. A till that has never been configured opens nothing, so a
 * shop with a projector or a customer-facing screen does not suddenly start
 * showing kitchen tickets on it.
 */

const path = require('path');
const prefs = require('./device-preferences');
const { fit, advice } = require('./kitchen-screen-fit');

/* Required lazily so this module can be loaded and tested outside Electron. */
function electron() {
  try {
    return require('electron');
  } catch (e) {
    return null;
  }
}

/* One window per display id. */
const windows = new Map();
let _watching = false;

/* ------------------------------------------------------------------ config */

/*
 * What a shop can change, and what it gets if it says nothing.
 *
 * Owner: "make everthing configurable pleaes... even you can make settings
 * about font and other stuff. dont make everthing fixed."
 *
 * viewingDistanceM and diagonalInches are the two that actually matter,
 * because together they decide whether anything on the screen can be read.
 * Everything else is taste.
 */
const DEFAULTS = Object.freeze({
  enabled: false,
  viewingDistanceM: 2.5,
  diagonalInches: 43,
  /* The visual angle to aim for. A shop with older staff, or more steam, or a
     darker kitchen, raises this and accepts fewer tickets on screen. */
  targetArcmin: 20,
  /* Televisions crop the edges. This is the margin that keeps a card's border
     on the panel. */
  safeAreaPercent: 3,
  /* What a card carries. Each one costs a line. */
  showTable: true,
  showItems: true,
  showItemNotes: true,
  showAge: true,
  showOrderNumber: false,
  showSource: false,
  /* How many dishes before the card says "+3 more". */
  maxItemsPerCard: 3,
  /* Minutes. A ticket past `amberAfterMin` is warming up, past `redAfterMin`
     it is late and moves to the front. */
  amberAfterMin: 5,
  redAfterMin: 10,
  /* Switch to compact cards - table and item count only, same text size -
     rather than shrinking text, once this many tickets are live. */
  compactAfter: 8,
  /* Seconds each page is shown when there are more tickets than fit. */
  pageDwellSeconds: 8,
  /* A ticket older than this greys out rather than vanishing. Nothing should
     disappear from a kitchen screen without somebody doing something. */
  greyAfterMin: 45,
  theme: 'dark',
});

/** Everything this machine was told about one display, defaults filled in. */
function configFor(displayId) {
  const stored = prefs.all().kitchenScreens || {};
  const one = stored[String(displayId)] || {};
  return { ...DEFAULTS, ...one };
}

/** Which displays this machine has been told to drive. */
function configuredIds() {
  const stored = prefs.all().kitchenScreens || {};
  return Object.keys(stored).filter((id) => stored[id] && stored[id].enabled);
}

/* ---------------------------------------------------------------- displays */

/**
 * Every display the machine can see, with enough detail to choose between them
 * and to say what would fit.
 *
 * `label` is what Electron reports, which on Windows is often empty, so a
 * readable fallback is built from the resolution and the position. "1920x1080
 * to the right" is something a person standing in a kitchen can identify; an
 * opaque id is not.
 */
function displays() {
  const e = electron();
  if (!e || !e.screen) return [];
  let all = [];
  let primaryId = null;
  try {
    all = e.screen.getAllDisplays() || [];
    primaryId = (e.screen.getPrimaryDisplay() || {}).id;
  } catch (err) {
    console.warn('[kitchen-screen] displays could not be read:', err.message);
    return [];
  }

  return all.map((d) => {
    const cfg = configFor(d.id);
    const size = d.size || {};
    const widthPx = Math.round((size.width || 0) * (d.scaleFactor || 1));
    const heightPx = Math.round((size.height || 0) * (d.scaleFactor || 1));
    const primary = d.id === primaryId;
    const where = describePosition(d, all);
    return {
      id: String(d.id),
      label: String(d.label || '').trim() || `${widthPx}x${heightPx}${where ? ' ' + where : ''}`,
      widthPx,
      heightPx,
      scaleFactor: d.scaleFactor || 1,
      primary,
      /* The till's own window lives on the primary display, so offering it as
         a kitchen screen is offering to cover the sale screen. */
      recommended: !primary,
      configured: Boolean(cfg.enabled),
      open: windows.has(String(d.id)),
      fit: fit({
        diagonalInches: cfg.diagonalInches,
        widthPx,
        heightPx,
        distanceM: cfg.viewingDistanceM,
        targetArcmin: cfg.targetArcmin,
        safeArea: (cfg.safeAreaPercent || 0) / 100,
      }),
      advice: advice({
        diagonalInches: cfg.diagonalInches,
        widthPx,
        heightPx,
        distanceM: cfg.viewingDistanceM,
        targetArcmin: cfg.targetArcmin,
        safeArea: (cfg.safeAreaPercent || 0) / 100,
      }),
      config: cfg,
    };
  });
}

/** "to the right", "above", so a person can tell two identical panels apart. */
function describePosition(display, all) {
  if (!Array.isArray(all) || all.length < 2) return '';
  const b = display.bounds || {};
  const others = all.filter((d) => d.id !== display.id);
  const leftOfAll = others.every((d) => b.x < (d.bounds || {}).x);
  const rightOfAll = others.every((d) => b.x > (d.bounds || {}).x);
  const aboveAll = others.every((d) => b.y < (d.bounds || {}).y);
  const belowAll = others.every((d) => b.y > (d.bounds || {}).y);
  if (rightOfAll) return 'to the right';
  if (leftOfAll) return 'to the left';
  if (aboveAll) return 'above';
  if (belowAll) return 'below';
  return '';
}

/* ----------------------------------------------------------------- windows */

/**
 * Open the kitchen screen on one display, or move it if it is already open.
 *
 * Nothing here throws. Every failure is logged and swallowed: this is called
 * from startup and from a display-changed event, and a kitchen screen that
 * cannot open must never be the reason a till does not start.
 */
function open(displayId) {
  const e = electron();
  if (!e || !e.BrowserWindow) return false;
  const id = String(displayId);

  try {
    const target = (e.screen.getAllDisplays() || []).find((d) => String(d.id) === id);
    if (!target) return false;

    const existing = windows.get(id);
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(target.bounds);
      return true;
    }

    const win = new e.BrowserWindow({
      ...target.bounds,
      frame: false,
      /* Not kiosk: kiosk on Windows can take focus and can sit above dialogs
         the till needs. Frameless and positioned is enough for a screen nobody
         touches. */
      fullscreen: false,
      autoHideMenuBar: true,
      /* THE FOCUS RULES. showInactive() below does the real work; these stop
         the window taking focus later, when a display event re-shows it. */
      focusable: false,
      skipTaskbar: true,
      backgroundColor: '#101114',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'kitchen-screen.html'), {
      query: { display: id },
    });

    /* Shown WITHOUT focus. A waiter mid-order must not lose the keyboard. */
    win.once('ready-to-show', () => {
      try {
        win.showInactive();
      } catch (err) {
        /* ignored: a display removed between creation and show */
      }
    });

    win.on('closed', () => windows.delete(id));
    windows.set(id, win);
    return true;
  } catch (err) {
    console.warn('[kitchen-screen] could not open on display ' + id + ':', err.message);
    return false;
  }
}

/** Close the kitchen screen on one display. Safe to call when it is not open. */
function close(displayId) {
  const id = String(displayId);
  const win = windows.get(id);
  windows.delete(id);
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch (err) {
    /* ignored */
  }
}

/** Close every kitchen screen. Used on shutdown and when the shop turns it off. */
function closeAll() {
  for (const id of [...windows.keys()]) close(id);
}

/**
 * Open every display this machine was told to drive, and keep them open.
 *
 * Called once at startup. Safe to call again - opening a display that is
 * already open only repositions it.
 */
function start() {
  try {
    for (const id of configuredIds()) open(id);
    watch();
    return true;
  } catch (err) {
    console.warn('[kitchen-screen] did not start:', err.message);
    return false;
  }
}

/*
 * Follow the cable.
 *
 * A television switched off at the wall, a cable pulled out while somebody
 * mops, a resolution change when a laptop is plugged in - all arrive as these
 * three events. Handling only `display-removed` leaves a window stranded at
 * coordinates that no longer exist, which on Windows means an invisible window
 * holding a page that is still rendering tickets.
 */
function watch() {
  const e = electron();
  if (!e || !e.screen || _watching) return;
  _watching = true;

  const reconcile = () => {
    try {
      const present = new Set((e.screen.getAllDisplays() || []).map((d) => String(d.id)));
      /* Gone: drop the window rather than leave it at coordinates that do not
         exist. */
      for (const id of [...windows.keys()]) if (!present.has(id)) close(id);
      /* Back, or newly plugged in and already configured: open it. Nobody
         should have to click anything after a power cut. */
      for (const id of configuredIds()) if (present.has(id) && !windows.has(id)) open(id);
      /* Still here but moved or resized. */
      for (const [id, win] of windows) {
        const d = (e.screen.getAllDisplays() || []).find((x) => String(x.id) === id);
        if (d && win && !win.isDestroyed()) win.setBounds(d.bounds);
      }
    } catch (err) {
      console.warn('[kitchen-screen] display change not handled:', err.message);
    }
  };

  e.screen.on('display-added', reconcile);
  e.screen.on('display-removed', reconcile);
  e.screen.on('display-metrics-changed', reconcile);
}

/**
 * Store what a shop chose for one display, and act on it immediately.
 *
 * Writing the setting and opening the window are one action on purpose: a
 * shop that ticks "use this screen" expects the screen to come on, not to be
 * told to restart the till.
 */
function configure(displayId, changes = {}) {
  const id = String(displayId);
  const stored = prefs.all().kitchenScreens || {};
  const next = { ...DEFAULTS, ...(stored[id] || {}), ...changes };
  const all = { ...prefs.all(), kitchenScreens: { ...stored, [id]: next } };

  try {
    const fs = require('fs');
    const file = prefs.prefsPath();
    if (file) fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8');
  } catch (err) {
    console.warn('[kitchen-screen] setting could not be saved:', err.message);
    return { ok: false, error: err.message };
  }

  if (next.enabled) open(id);
  else close(id);

  /* The page re-reads its own settings rather than being sent them, so a font
     change applies without reopening the window. */
  const win = windows.get(id);
  try {
    if (win && !win.isDestroyed()) win.webContents.send('kitchen-screen:config', next);
  } catch (err) {
    /* ignored */
  }

  return { ok: true, config: next };
}

/* -------------------------------------------------------- talking to a screen */

/*
 * A sample service, for placing a screen.
 *
 * Owner: "choose your best place and add changes." The only place the question
 * "can the cook read this?" can be answered is standing where the cook stands,
 * looking at the real panel - not at a number on the till. So the preview puts
 * real-looking tickets on the real screen at the real size, including the two
 * that matter most: a long dish name and an item note.
 */
function sampleTickets(now = Date.now()) {
  const ago = (min) => new Date(now - min * 60000).toISOString();
  return [
    {
      table: '12',
      orderNumber: 'KOT-4471',
      placedAt: ago(1),
      items: [
        { qty: 2, name: 'Paneer Butter Masala', note: 'less spicy' },
        { qty: 4, name: 'Butter Naan' },
      ],
    },
    {
      table: '7',
      orderNumber: 'KOT-4472',
      placedAt: ago(6),
      items: [
        { qty: 1, name: 'Chettinad Chicken' },
        { qty: 1, name: 'Malabar Paratha' },
        { qty: 2, name: 'Curd Rice' },
        { qty: 1, name: 'Gulab Jamun' },
      ],
    },
    {
      table: '3',
      orderNumber: 'KOT-4473',
      placedAt: ago(12),
      items: [{ qty: 1, name: 'Vegetable Biryani', note: 'no onion, allergy' }],
    },
  ];
}

/** What is currently on each screen, so a reconnect can be given it again. */
const feeds = new Map();

/**
 * Send a screen its configuration and its tickets.
 *
 * The fit is computed here and sent with the config, because only the main
 * process knows the panel's physical size. A page sizing itself from pixels
 * alone is the exact mistake that produces a screen nobody can read.
 */
function push(displayId, { setupMode = false } = {}) {
  const id = String(displayId);
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return false;

  const e = electron();
  const d = e && e.screen
    ? (e.screen.getAllDisplays() || []).find((x) => String(x.id) === id)
    : null;
  const cfg = configFor(id);
  const size = (d && d.size) || {};
  const scale = (d && d.scaleFactor) || 1;

  const computed = fit({
    diagonalInches: cfg.diagonalInches,
    widthPx: Math.round((size.width || 1920) * scale),
    heightPx: Math.round((size.height || 1080) * scale),
    distanceM: cfg.viewingDistanceM,
    targetArcmin: cfg.targetArcmin,
    safeArea: (cfg.safeAreaPercent || 0) / 100,
  });

  try {
    win.webContents.send('kitchen-screen:config', { ...cfg, setupMode, _fit: computed });
    win.webContents.send('kitchen-screen:tickets', feeds.get(id) || (setupMode ? sampleTickets() : []));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * The tickets every kitchen screen should be showing.
 *
 * Set from outside - nothing in this file decides what is cooking. Kept per
 * display so a pass screen and a hot-kitchen screen can later be given
 * different lists without changing anything here.
 */
function setTickets(list, displayId = null) {
  const value = Array.isArray(list) ? list : [];
  if (displayId) {
    feeds.set(String(displayId), value);
    push(displayId);
    return;
  }
  for (const id of windows.keys()) {
    feeds.set(id, value);
    push(id);
  }
}

module.exports = {
  DEFAULTS,
  displays,
  push,
  setTickets,
  sampleTickets,
  configFor,
  configuredIds,
  configure,
  open,
  close,
  closeAll,
  start,
  describePosition,
  /* For tests, which need to look at what is open without an Electron app. */
  _windows: windows,
};
