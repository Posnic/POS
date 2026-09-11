'use strict';
/*
 * Which channels an item is sold on, and when.
 *
 * THE SHAPE, AND WHY IT IS THIS WAY ROUND.
 *
 * The obvious model gives every item a list of the channels it IS on. With six
 * channels and two hundred items that is twelve hundred flags a shop has to set
 * before it can sell anything, and the answer is "all of them" for almost every
 * line. Worse, adding a channel later leaves every existing item excluded from
 * it until somebody goes back through the lot.
 *
 * So this stores the EXCEPTIONS. An item is on every channel the shop runs
 * unless it says otherwise:
 *
 *   channel_off    ['swiggy', 'online']   channels this item is NOT sold on
 *   channel_hours  { online: { from, to } }  when it is, where that is limited
 *
 * A new item sells everywhere, a new channel sells everything, and a shop only
 * records the handful of lines that are different - the cigarettes it will not
 * put on Swiggy, the breakfast thali that should vanish from the app at eleven.
 *
 * WHY NOT REUSE dayparts FOR THE HOURS.
 *
 * Serving periods are the kitchen's clock: breakfast is breakfast on every
 * channel. These hours are a channel's clock, which is a different question -
 * "we stop taking Swiggy orders for this at 3 because the driver wait makes it
 * arrive cold". An item can have both, and both have to be true.
 *
 * NO DATABASE IMPORTS. Vocabulary and arithmetic, testable on its own.
 */

const { CHANNEL_VALUES, normalizeChannel, normalizePartner } = require('./sales-channels');

/**
 * A channel id, or a partner id.
 *
 * "Not on Swiggy" is the request a shop actually makes, and swiggy is not a
 * channel - it is a partner ON the marketplace channel. Excluding at channel
 * level only would mean a shop that wants its cigarettes off Swiggy takes them
 * off Zomato too, which is not what anybody asked for.
 *
 * A partner id nobody recognises simply never matches, so the item stays on
 * sale. That is the safe direction: a typo that quietly keeps selling is a
 * correction, a typo that quietly stops selling is a day of lost orders and no
 * error anywhere to explain them.
 */
function normalizeTarget(value) {
  return normalizeChannel(value) || normalizePartner(value);
}

/** Minutes past midnight for "HH:MM", or null when it is not a time. */
function minutesOf(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** The channels an item is kept off, as ids this system recognises. */
function normalizeOff(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const raw of list) {
    const target = normalizeTarget(raw);
    if (target) seen.add(target);
  }
  return [...seen];
}

/**
 * Per-channel windows, cleaned.
 *
 * A window missing either end is dropped rather than half-applied: "from 11:00
 * to nothing" could reasonably mean all afternoon or nothing at all, and
 * guessing between those is how an item disappears from an app on a Saturday
 * with nobody able to say why.
 */
function normalizeHours(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  for (const [key, value] of Object.entries(input)) {
    const channel = normalizeTarget(key);
    if (!channel || !value) continue;

    const from = minutesOf(value.from);
    const to = minutesOf(value.to);
    if (from === null || to === null) continue;

    out[channel] = { from: value.from.trim(), to: value.to.trim() };
  }
  return out;
}

/** Everything an item says about channels, normalised together. */
function normalizeItemChannels(item) {
  return {
    channel_off: normalizeOff(item && item.channel_off),
    channel_hours: normalizeHours(item && item.channel_hours),
  };
}

/**
 * Is this item sold on this channel, at this moment?
 *
 * @param {object} item        carrying channel_off and channel_hours
 * @param {string} channel     a CHANNEL value
 * @param {number} [nowMins]   minutes past midnight, in the BRANCH's timezone
 * @returns {{available: boolean, reason: string, window: object|null}}
 */
function availableOn(item, channel, nowMins) {
  const wanted = normalizeTarget(channel);
  if (!wanted) return { available: true, reason: '', window: null };

  const { channel_off: off, channel_hours: hours } = normalizeItemChannels(item);

  if (off.includes(wanted)) {
    return { available: false, reason: 'not_on_channel', window: null };
  }

  const window = hours[wanted] || null;
  if (!window) return { available: true, reason: '', window: null };

  /* No clock to check against means do not hide it. A caller that cannot say
     what time it is should not be silently removing things from a menu. */
  if (typeof nowMins !== 'number' || !Number.isFinite(nowMins)) {
    return { available: true, reason: '', window };
  }

  const from = minutesOf(window.from);
  const to = minutesOf(window.to);

  /*
   * A closing time at or before the opening time crosses midnight - 22:00 to
   * 02:00 is a late-night menu, not an empty one. Same rule the shop's own
   * opening hours use, so the two cannot read a window differently.
   */
  const inside = to > from ? nowMins >= from && nowMins < to : nowMins >= from || nowMins < to;

  return {
    available: inside,
    reason: inside ? '' : 'outside_channel_hours',
    window,
  };
}

/**
 * A Mongo filter for "items this channel sells".
 *
 * Absent means included, which is the whole point of storing exceptions: a
 * shop that has never opened this screen has every item on every channel, and
 * `$ne` answers that without a migration touching two hundred documents.
 */
function channelFilter(channel) {
  const wanted = normalizeTarget(channel);
  if (!wanted) return {};
  return { channel_off: { $ne: wanted } };
}

/**
 * Applying a bulk change to one item's exception list.
 *
 * Returned rather than written so the caller can decide whether anything
 * actually changed - a bulk "enable on Swiggy" over four hundred items should
 * write the handful that were off, not four hundred documents.
 *
 * @param {Array} current
 * @param {string} channel
 * @param {boolean} on   true to sell it here, false to stop
 * @returns {{value: Array, changed: boolean}}
 */
function setChannel(current, channel, on) {
  const wanted = normalizeTarget(channel);
  const off = normalizeOff(current);
  if (!wanted) return { value: off, changed: false };

  const has = off.includes(wanted);
  if (on && has) return { value: off.filter((c) => c !== wanted), changed: true };
  if (!on && !has) return { value: [...off, wanted], changed: true };
  return { value: off, changed: false };
}

module.exports = {
  CHANNEL_VALUES,
  normalizeTarget,
  availableOn,
  channelFilter,
  minutesOf,
  normalizeHours,
  normalizeItemChannels,
  normalizeOff,
  setChannel,
};
