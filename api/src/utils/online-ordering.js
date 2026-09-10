'use strict';
/*
 * Whether this shop is taking orders on its online channel right now.
 *
 * ONE PLACE, BECAUSE THERE ARE FOUR ANSWERS AND THEY COMPOSE.
 *
 * A shop can be shut to a customer for four unrelated reasons: the channel is
 * a menu and never took orders; someone paused it ten minutes ago; it is
 * outside opening hours; or the module is off entirely. The customer's page
 * has to render a different sentence for each, and the order endpoint has to
 * refuse for each. Two implementations of that would drift, and the one that
 * drifts is the one that matters - the server's - because hiding the cart is a
 * courtesy and refusing the order is the control.
 *
 * `POST /sales/qrOrder` is anonymous by design (a customer's phone has no
 * credentials) and reachable from the internet. Anybody can skip our page and
 * post an order directly. So the page asks this module what to draw, and the
 * endpoint asks this module whether to accept, and neither gets a vote.
 *
 * WHY THE PURE FUNCTIONS TAKE A DAY AND A MINUTE COUNT.
 *
 * The schedule arithmetic is where this kind of feature goes wrong, so it is
 * separated from the clock: `isOpenAt` and `nextOpeningFrom` take a weekday
 * index and minutes past midnight and know nothing about timezones or Date.
 * They can be tested exhaustively without a database, a network or a fake
 * clock. Only `channelState` touches moment-timezone, and only to answer "what
 * day and minute is it where this branch is".
 *
 * NO SERVICE OR MODEL IMPORTS. Requiring this file must never open a database
 * connection, for the same reason the kiosk key guard has that rule.
 */

const moment = require('moment-timezone');

/* Index order matches Date#getDay and moment's .day(): Sunday is 0. */
const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

const MINUTES_PER_DAY = 24 * 60;

/* The states a customer can meet. Every one of them still shows the menu. */
const STATE = Object.freeze({
  DISABLED: 'disabled',
  MENU_ONLY: 'menu_only',
  PAUSED: 'paused',
  CLOSED_HOURS: 'closed_hours',
  OPEN: 'open',
});

const MODE = Object.freeze({ ORDER: 'order', MENU: 'menu' });

/*
 * `Asia/Calcutta` and `Asia/Kolkata` are the same zone; the first is a
 * deprecated alias that branch.model.js still writes as its default while
 * setting.model.js writes the second. Anything comparing the two strings for
 * equality is wrong, so normalise before use rather than at every call site.
 */
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

function normalizeTimeZone(tz) {
  const name = String(tz || '').trim();
  if (!name) return DEFAULT_TIME_ZONE;
  /* moment.tz.zone returns null for a name the tz database does not know. A
     shop with a typo in its timezone must not take the whole channel down. */
  return moment.tz.zone(name) ? name : DEFAULT_TIME_ZONE;
}

/**
 * The kiosk configuration for a branch.
 *
 * THIS IS THE BUG THIS MODULE WAS BORN FROM.
 *
 * `branch.kiosk` is declared `{ type: Array, default: [] }`, seeded as `[]`,
 * seeded again as a one-element array when a branch is created, and written by
 * the settings screen through `kiosk.$[elem].store_id` with arrayFilters. Every
 * write path in this application produces an array.
 *
 * qrOrderModel guarded ordering with `!branchDoc.kiosk.store_id`. On an array
 * that is `undefined`, so the guard fired for every branch and every QR order
 * was refused with "QR ordering is not enabled for this branch". It went
 * unnoticed because live kiosk traffic still reaches the legacy PHP API, and
 * the unit test mocked `kiosk: { store_id: ... }` - an object shape nothing in
 * the application writes.
 *
 * accessQr already read both shapes, which is presumably where the test's
 * object came from. Both shapes are accepted here so there is one answer.
 *
 * @param {object} branchDoc  a branch document
 * @param {string} [storeId]  prefer the entry with this store id
 * @returns {object|null}
 */
function kioskEntry(branchDoc, storeId) {
  const kiosk = branchDoc && branchDoc.kiosk;
  if (!kiosk) return null;

  if (Array.isArray(kiosk)) {
    if (!kiosk.length) return null;
    if (storeId !== undefined && storeId !== null && String(storeId) !== '') {
      const match = kiosk.find((entry) => String(entry?.store_id || '') === String(storeId));
      if (match) return match;
    }
    /* The array only ever holds one entry, matched by branch_id. Falling back
       to the first is what every existing reader does. */
    return kiosk[0] || null;
  }

  return typeof kiosk === 'object' ? kiosk : null;
}

/** A branch that never configured a store id has not opted into this channel. */
function hasStoreId(entry) {
  return !!(entry && String(entry.store_id || '').trim());
}

/**
 * order or menu.
 *
 * An enum, deliberately not a boolean. `'false'` arriving as a string and
 * reading as ON through `!== false` has bitten this estate more than once; a
 * value that is only ever one of two known words has no truthy trap.
 */
function normalizeMode(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === MODE.MENU
    ? MODE.MENU
    : MODE.ORDER;
}

/** Minutes past midnight, or null for anything that is not a real clock time. */
function toMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n >= 0 && n < MINUTES_PER_DAY ? n : null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "18:30" for a stored minute count, for display and for round-tripping. */
function toClock(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return '';
  const h = Math.floor(n / 60) % 24;
  const m = Math.trunc(n) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The opening windows for one weekday, cleaned up.
 *
 * A LIST, not one open/close pair. Lunch 12:00-15:00 and dinner 19:00-23:00 is
 * the ordinary case in India, not an edge case, and a single pair per day
 * cannot be widened later without a migration.
 *
 * `close <= open` means the window runs past midnight into the next day
 * (18:00-02:00 for a bar). `close === open` is not a 24-hour day - it is a
 * zero-length window that somebody typed by accident - so it is dropped. A
 * shop that never closes leaves `hours` null instead.
 */
function normalizeWindows(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((w) => {
      const open = toMinutes(w && w.open);
      const close = toMinutes(w && w.close);
      if (open === null || close === null || open === close) return null;
      return { open, close };
    })
    .filter(Boolean)
    .sort((a, b) => a.open - b.open);
}

/**
 * A whole week of windows, or null.
 *
 * null means "no schedule, always open", which is what every shop has today
 * and must keep having after this ships. An empty array for a day means closed
 * that day, which is different from having no schedule at all.
 */
function normalizeHours(hours) {
  if (!hours || typeof hours !== 'object') return null;
  const out = {};
  let any = false;
  for (const key of DAY_KEYS) {
    const windows = normalizeWindows(hours[key]);
    out[key] = windows;
    if (windows.length) any = true;
  }
  /* A schedule where every day is empty would shut the shop forever, which is
     never what somebody meant to save. Treat it as no schedule. */
  return any ? out : null;
}

function windowsFor(hours, dayIndex) {
  if (!hours) return [];
  const key = DAY_KEYS[((dayIndex % 7) + 7) % 7];
  return hours[key] || [];
}

/**
 * Is the shop inside an opening window?
 *
 * Two passes, and the second is the one people forget: a window that started
 * yesterday evening and has not closed yet. At 00:30 on Saturday a bar whose
 * Friday window is 18:00-02:00 is open, and nothing in Saturday's own windows
 * says so.
 *
 * @param {object|null} hours     normalised week, or null for always open
 * @param {number} dayIndex       0 = Sunday
 * @param {number} minutes        minutes past midnight, local to the branch
 */
function isOpenAt(hours, dayIndex, minutes) {
  if (!hours) return true;

  for (const w of windowsFor(hours, dayIndex)) {
    if (w.close > w.open) {
      if (minutes >= w.open && minutes < w.close) return true;
    } else if (minutes >= w.open) {
      /* Crosses midnight: open from w.open until the end of the day. */
      return true;
    }
  }

  for (const w of windowsFor(hours, dayIndex - 1)) {
    if (w.close <= w.open && minutes < w.close) return true;
  }

  return false;
}

/**
 * When does it open next?
 *
 * Looks ahead a week and gives up, because a schedule that never opens should
 * produce "we cannot say" rather than an infinite loop. Returns an offset in
 * days and a minute count so the caller can build a real Date in the branch's
 * own zone, which is the only place that arithmetic is safe.
 *
 * @returns {{dayOffset: number, minutes: number}|null}
 */
function nextOpeningFrom(hours, dayIndex, minutes) {
  if (!hours) return null;

  for (let offset = 0; offset < 8; offset += 1) {
    for (const w of windowsFor(hours, dayIndex + offset)) {
      if (offset === 0 && w.open <= minutes) continue;
      return { dayOffset: offset, minutes: w.open };
    }
  }
  return null;
}

/** A pause is a moment in the future, or it is nothing. */
function pausedUntil(entry) {
  const raw = entry && entry.paused_until;
  if (!raw) return null;
  const at = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/*
 * "Opens today at 6:00 PM" retains a customer. "Not taking orders" loses one.
 * That is the whole reason the next-opening calculation exists, so the phrasing
 * is part of the feature rather than a detail left to the page.
 */
function describeWhen(target, now, timeZone) {
  if (!target) return '';
  const at = moment(target).tz(timeZone);
  const today = moment(now).tz(timeZone).startOf('day');
  const days = at.clone().startOf('day').diff(today, 'days');
  const time = at.format('h:mm A');
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `${at.format('dddd')} at ${time}`;
}

/**
 * What this channel is doing right now.
 *
 * @param {object|null} entry      a kiosk entry (see kioskEntry)
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]  the branch's zone
 * @param {boolean} [options.moduleEnabled]  the shop-level module switch
 * @returns {{state: string, mode: string, accepting: boolean, message: string,
 *            resumes_at: string|null, opens_at: string|null, hours: object|null}}
 */
function channelState(entry, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = normalizeTimeZone(options.timeZone);
  const mode = normalizeMode(entry && entry.mode);
  const hours = normalizeHours(entry && entry.hours);

  const base = { mode, hours, resumes_at: null, opens_at: null, time_zone: timeZone };

  if (options.moduleEnabled === false) {
    return {
      ...base,
      state: STATE.DISABLED,
      accepting: false,
      message: 'Online ordering is not available for this shop.',
    };
  }

  /* No store id means the branch never opted in. Its raw database id appears in
     every authenticated response and is no secret, so an un-opted-in branch
     must not take anonymous orders addressed by it. */
  if (!hasStoreId(entry)) {
    return {
      ...base,
      state: STATE.DISABLED,
      accepting: false,
      message: 'Online ordering is not enabled for this branch.',
    };
  }

  if (mode === MODE.MENU) {
    return {
      ...base,
      state: STATE.MENU_ONLY,
      accepting: false,
      message: 'This menu is for viewing only. Please order at the counter.',
    };
  }

  const pause = pausedUntil(entry);
  if (pause && pause.getTime() > now.getTime()) {
    return {
      ...base,
      state: STATE.PAUSED,
      accepting: false,
      resumes_at: pause.toISOString(),
      message: `Not taking orders right now. Back ${describeWhen(pause, now, timeZone)}.`,
    };
  }

  const local = moment(now).tz(timeZone);
  const dayIndex = local.day();
  const minutes = local.hours() * 60 + local.minutes();

  if (!isOpenAt(hours, dayIndex, minutes)) {
    const next = nextOpeningFrom(hours, dayIndex, minutes);
    const opensAt = next
      ? local
          .clone()
          .startOf('day')
          .add(next.dayOffset, 'days')
          .add(next.minutes, 'minutes')
          .toDate()
      : null;
    return {
      ...base,
      state: STATE.CLOSED_HOURS,
      accepting: false,
      opens_at: opensAt ? opensAt.toISOString() : null,
      message: opensAt
        ? `Closed right now. Opens ${describeWhen(opensAt, now, timeZone)}.`
        : 'Closed right now.',
    };
  }

  return { ...base, state: STATE.OPEN, accepting: true, message: '' };
}

module.exports = {
  DAY_KEYS,
  DEFAULT_TIME_ZONE,
  MODE,
  STATE,
  channelState,
  isOpenAt,
  kioskEntry,
  hasStoreId,
  nextOpeningFrom,
  normalizeHours,
  normalizeMode,
  normalizeTimeZone,
  normalizeWindows,
  pausedUntil,
  toClock,
  toMinutes,
};
