'use strict';

/*
 * THE TRADING DAY STARTS AT SEVEN IN THE MORNING, NOT AT MIDNIGHT.
 *
 * Owner: "daily price starts in the morning only. means 7am. not midnight coz
 * up to 1am restaurant might open."
 *
 * A restaurant sets its fish prices when it opens and serves until one. On a
 * calendar day those prices expire in the middle of service: at midnight every
 * one of them reads as yesterday's, the handset starts asking waiters for
 * numbers they were given at eleven that morning, and the till refuses the
 * dishes until somebody re-enters them - at one in the morning, during the
 * last push of the night.
 *
 * WHY THIS FILE EXISTS. The rule was written inside _pricedToday, and its own
 * comment said "the four screens that ask the same question each carry the
 * same constant and the same note". A fifth caller was about to copy it again
 * for dishes marked off for the night. A rule copied five times is a rule that
 * will be five different rules the first time somebody changes one of them.
 *
 * Seven is the owner's number for his own kitchens. If a shop ever opens
 * earlier, this is now the ONE line to make a setting.
 */

const datePreference = require('./date-preference');

const DAY_STARTS_AT_HOUR = 7;

/**
 * Which trading day a moment belongs to, as YYYY-MM-DD in the shop's own zone.
 *
 * The clock is shifted back seven hours before the date is read, so anything
 * served before seven in the morning still counts as the night before.
 */
function tradingDay(when, branch) {
  const zone = datePreference.branchTimezone(branch);
  const shifted = new Date(when.getTime() - DAY_STARTS_AT_HOUR * 60 * 60 * 1000);

  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(shifted);
  } catch (e) {
    /* An unknown zone must not stop a sale. UTC is wrong by hours, never by a
       sale: the worst it does is ask for a price already entered. */
    return shifted.toISOString().slice(0, 10);
  }
}

/**
 * Was this set during the trading day the shop is in right now?
 *
 * Nothing, or an unreadable date, is NOT today. A missing timestamp means
 * nobody has done the thing, and guessing yes would be the expensive way to
 * be wrong in both of the places that ask: it would charge yesterday's price
 * for a fish, and it would keep a dish off the menu that the kitchen has.
 */
function isToday(when, branch) {
  if (!when) return false;

  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return false;

  return tradingDay(at, branch) === tradingDay(new Date(), branch);
}

module.exports = { DAY_STARTS_AT_HOUR, tradingDay, isToday };
