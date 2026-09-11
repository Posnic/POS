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
 * `POST /online-ordering/:storeId/orders` is anonymous by design (a customer has no
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
 * How an order reaches the customer.
 *
 * THIS IS WHAT MAKES ONE CHANNEL SERVE EVERY KIND OF SHOP.
 *
 * The tempting split is "restaurant mode" and "retail mode", and it is the
 * wrong one: it forces every future question to be answered twice and leaves a
 * bakery that also delivers with nowhere to stand. The real difference between
 * a restaurant and a clothes shop is not the software, it is which of these
 * they offer. A restaurant turns on dine in and takeaway; a clothes shop turns
 * on pickup and delivery; a bakery does three of the four. The vertical stops
 * being a concept and becomes configuration.
 *
 * Each type is also just a list of extra fields at checkout - a table number
 * for dine in, an address for delivery - which is a form, not an architecture.
 *
 * DEFINED ONCE, in utils/sales-channels, because fulfilment is not a property
 * of this channel: a till sale is taken away, a Swiggy order is delivered. Two
 * copies of the list would be two things to keep in step, and the one that
 * drifted would silently mean a different thing on a report than on a page.
 */
const { FULFILMENT, FULFILMENT_VALUES } = require('./sales-channels');

/* What the page offers when a shop has not chosen. Dine in and takeaway,
   because that is the pair the customer page has always presented and the
   trade this channel was built for; anything else is one tick away. */
const DEFAULT_FULFILMENT = Object.freeze([FULFILMENT.DINE_IN, FULFILMENT.TAKEAWAY]);

/**
 * The fulfilment types a shop offers, in a fixed order and without duplicates.
 *
 * An unknown value is dropped rather than passed through: it would reach the
 * customer's page as a button that collects the wrong fields, or none.
 */
function normalizeFulfilment(list) {
  if (!Array.isArray(list)) return [...DEFAULT_FULFILMENT];
  const chosen = new Set(
    list
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase()
      )
      .filter((v) => FULFILMENT_VALUES.includes(v))
  );
  /* Ordered by FULFILMENT, not by what the caller sent, so the buttons do not
     move about between saves. */
  const out = FULFILMENT_VALUES.filter((v) => chosen.has(v));
  /* A shop that offers nothing could take no orders at all, which is what the
     menu mode is for and is never what an empty list meant. */
  return out.length ? out : [...DEFAULT_FULFILMENT];
}

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
 * A branch's online ordering configuration.
 *
 * ONE OBJECT, WHICH IS THE WHOLE POINT.
 *
 * This used to be `branch.kiosk`, an ARRAY that never held more than one entry
 * and was matched by branch_id - inside a document that is already one branch.
 * The shape cost a real defect: the order endpoint read `branch.kiosk.store_id`,
 * which is `undefined` on an array, so it refused every order ever placed
 * against the Node API. Two readers disagreed about whether the field was an
 * array or an object, and the unit test agreed with the one that was wrong.
 *
 * It is now a plain object at `branch.online_ordering`, so there is nothing to
 * disagree about. Nothing reads the old field: it was renamed outright rather
 * than dual-read, because no shop was using the channel.
 *
 * @param {object} branchDoc  a branch document
 * @returns {object|null}
 */
function storefront(branchDoc) {
  const config = branchDoc && branchDoc.online_ordering;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
}

/**
 * Has this branch opted into being reachable by strangers?
 *
 * The store id IS the opt-in. Both public doors are anonymous by design (a
 * customer's phone has no credentials), so a branch that never chose a store id
 * must not be orderable by its raw database id, which appears in every
 * authenticated response and is no secret.
 */
function hasStoreId(config) {
  return !!(config && String(config.store_id || '').trim());
}

/*
 * Store addresses a shop may not choose.
 *
 * A store address is 3 to 6 letters or numbers and sits directly under
 * `/online-ordering/`, which is also where this resource's own sub-paths live.
 * A shop that picked `menu` would answer its own menu route; one that picked
 * `order` would sit where the ordering page is served. The collision is
 * invisible until the one shop that chose that word cannot be reached, so the
 * words are refused at the point of choosing instead.
 *
 * Kept deliberately short. Reserving half the dictionary to guard against
 * routes that do not exist is its own kind of trap.
 */
const RESERVED_STORE_IDS = Object.freeze([
  'menu',
  'order',
  'orders',
  'device',
  'api',
  'admin',
  'public',
  'static',
  'null',
]);

/** Is this a store address a shop is allowed to take? */
function storeIdIsAvailable(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return !!v && !RESERVED_STORE_IDS.includes(v);
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

/* ------------------------------------------------------------------ dayparts
 *
 * Breakfast, lunch, dinner: when a dish is actually served.
 *
 * WHY NAMED PERIODS AND NOT HOURS PER ITEM.
 *
 * The obvious shape is a week of opening hours on every item, and it is
 * unusable: two hundred dishes times seven days is an afternoon of data entry
 * a shop will never do, and the first time breakfast moves by half an hour
 * they would edit it two hundred times. A shop thinks in periods - "this is a
 * breakfast dish" - so that is what it says, once per dish, and the period
 * carries the hours.
 *
 * It is also how every system a restaurant already knows does it. Toast calls
 * them menu schedules, Square calls them availability periods, the aggregators
 * call them menu timings. Same idea, and the shop has met it before.
 *
 * The hours inside a period are the SAME shape and the same engine as the
 * shop's opening hours, midnight crossing included, because "served from 6pm
 * to 1am" is exactly as ordinary as a bar being open then.
 */

/**
 * A shop's serving periods, cleaned up.
 *
 * An id that survives editing is what items point at, so it is kept as given
 * rather than derived from the name - renaming Breakfast to "Morning" must not
 * silently unassign every breakfast dish.
 */
function normalizeDayparts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((d) => {
      const id = String((d && d.id) || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const name = String((d && d.name) || '').trim();
      if (!id || !name || seen.has(id)) return null;
      seen.add(id);
      return { id, name, hours: normalizeHours(d.hours) };
    })
    .filter(Boolean);
}

/**
 * Is this daypart being served at this moment?
 *
 * A period with no hours is always on. That is deliberate: a half-configured
 * period should not silently take dishes off the menu, and "we have not set
 * the times yet" is far more common than "this period is never served".
 */
function daypartIsOn(daypart, dayIndex, minutes) {
  if (!daypart) return false;
  return isOpenAt(daypart.hours, dayIndex, minutes);
}

/**
 * Which of a shop's periods are being served right now.
 *
 * @returns {Set<string>} of daypart ids
 */
function activeDayparts(dayparts, dayIndex, minutes) {
  const on = new Set();
  for (const d of normalizeDayparts(dayparts)) {
    if (daypartIsOn(d, dayIndex, minutes)) on.add(d.id);
  }
  return on;
}

/**
 * Can this item be ordered right now, and if not, when?
 *
 * An item in no period is always available - the overwhelming majority of a
 * menu - so the cost of this feature falls only on the dishes that need it.
 *
 * A dish outside its window is NOT hidden. A customer reading a menu at 4pm
 * wants to know that breakfast exists and runs 7 to 11, and hiding it makes
 * the restaurant look like it does not serve breakfast at all. So the answer
 * carries the period names, and the page says so.
 *
 * @returns {{available: boolean, periods: string[]}}
 */
function itemAvailability(item, dayparts, dayIndex, minutes) {
  const ids = Array.isArray(item && item.daypart_ids)
    ? item.daypart_ids.map((v) => String(v || '').trim()).filter(Boolean)
    : [];

  if (!ids.length) return { available: true, periods: [] };

  const all = normalizeDayparts(dayparts);
  const mine = all.filter((d) => ids.includes(d.id));

  /* Pointing at periods the shop has since deleted is the same as pointing at
     none: the alternative is a dish nothing can ever serve. */
  if (!mine.length) return { available: true, periods: [] };

  const available = mine.some((d) => daypartIsOn(d, dayIndex, minutes));
  return { available, periods: mine.map((d) => d.name) };
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
 * @param {object|null} config     a branch's online_ordering object
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.timeZone]  the branch's zone
 * @param {boolean} [options.moduleEnabled]  the shop-level module switch
 * @returns {{state: string, mode: string, accepting: boolean, message: string,
 *            resumes_at: string|null, opens_at: string|null, hours: object|null,
 *            fulfilment: string[], time_zone: string}}
 */
function channelState(config, options = {}) {
  const entry = config;
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = normalizeTimeZone(options.timeZone);
  const mode = normalizeMode(entry && entry.mode);
  const hours = normalizeHours(entry && entry.hours);
  const fulfilment = normalizeFulfilment(entry && entry.fulfilment);

  const base = {
    mode,
    hours,
    fulfilment,
    resumes_at: null,
    opens_at: null,
    time_zone: timeZone,
  };

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

/**
 * The settings half of this module, normalised for storage.
 *
 * The settings screen posts clock strings and loose arrays; this turns them
 * into what the database holds, in one place, so a value can never be stored
 * in a shape the reader above does not expect. Only keys the caller actually
 * sent are returned, so a screen saving one field cannot blank the others.
 */
function normalizeSettings(input = {}) {
  const out = {};
  if (input.mode !== undefined) out.mode = normalizeMode(input.mode);
  if (input.hours !== undefined) out.hours = normalizeHours(input.hours);
  if (input.fulfilment !== undefined) out.fulfilment = normalizeFulfilment(input.fulfilment);
  if (input.paused_until !== undefined) {
    const raw = input.paused_until;
    if (raw === null || raw === '' || raw === false) {
      out.paused_until = null;
    } else {
      const at = raw instanceof Date ? raw : new Date(raw);
      if (Number.isNaN(at.getTime())) throw new Error('Pause time is not a valid date');
      out.paused_until = at;
    }
  }
  return out;
}

/**
 * A brand new branch's channel, written out in full.
 *
 * Written out rather than defaulted at read time because sync replaces whole
 * documents: a field the winning copy does not carry is deleted rather than
 * merged, and absent reads the same as "order, never paused, no schedule"
 * through the API - so the setting would vanish and nothing would complain.
 */
function defaultConfig() {
  return {
    store_id: '',
    mode: MODE.ORDER,
    paused_until: null,
    hours: null,
    fulfilment: [...DEFAULT_FULFILMENT],
    logo: '',
    banner: '',
    homebanner: '',
    advertisement: '',
    payment_cod: '',
    payment_razorpay: '',
    payment_number: '',
    printer_name: '',
  };
}

module.exports = {
  DAY_KEYS,
  DEFAULT_FULFILMENT,
  DEFAULT_TIME_ZONE,
  FULFILMENT,
  FULFILMENT_VALUES,
  MODE,
  STATE,
  channelState,
  defaultConfig,
  isOpenAt,
  storefront,
  hasStoreId,
  activeDayparts,
  daypartIsOn,
  itemAvailability,
  normalizeDayparts,
  RESERVED_STORE_IDS,
  storeIdIsAvailable,
  nextOpeningFrom,
  normalizeFulfilment,
  normalizeHours,
  normalizeMode,
  normalizeSettings,
  normalizeTimeZone,
  normalizeWindows,
  pausedUntil,
  toClock,
  toMinutes,
};
