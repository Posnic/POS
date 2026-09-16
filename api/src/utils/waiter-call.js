'use strict';
/*
 * "COME TO TABLE SEVEN."
 *
 * Owner: "i want option for customers call. example he is in table 7 and
 * wants to call waiter or captain. he should simple button to make it... this
 * biggest option i love. coz everytime its annoying people see waiters to turn
 * back."
 *
 * He is describing the single most common failure of table service, and it is
 * not a staffing problem. A table needs something, nobody is looking, and the
 * customer spends the next two minutes trying to catch an eye - waving,
 * half-standing, giving up. The restaurant does not know it is happening,
 * because the only evidence is a person feeling ignored and saying nothing.
 *
 * ONE TAP, AND IT CARRIES THE TABLE.
 *
 * A call that does not say WHERE is worse than no call: somebody, somewhere,
 * wants something. So a call needs a table number, and where the printed code
 * did not name one there is no button at all - the same rule the rest of this
 * product follows about saying only what the data supports.
 *
 * NO REASONS, DELIBERATELY.
 *
 * The obvious next feature is a menu - water, the bill, a spoon - and it is
 * the wrong one. It turns one tap into a form, and the waiter is walking over
 * anyway: they will find out when they arrive faster than the customer can
 * choose from a list. Asking for the bill already has its own path, which is
 * the one case where knowing in advance saves a trip.
 *
 * ONE OPEN CALL PER TABLE.
 *
 * A customer who taps three times has not asked three times; they have asked
 * once and doubted the button. Three cards in the queue would be three jobs
 * nobody needs to do, and would teach staff to skim a queue that must be read.
 *
 * NO DATABASE IMPORTS.
 */

/*
 * How long a call stands before it stops counting as open.
 *
 * Twenty minutes is long enough that a busy floor does not lose one, and
 * short enough that a call nobody answered stops haunting the queue the next
 * morning. A stale call is not evidence of anything a shop can still act on.
 */
const OPEN_FOR_MINUTES = 20;

/**
 * May this customer call anybody?
 *
 * Both halves are required and neither is negotiable. A shop that does not run
 * table service has no waiters walking a floor, and a customer whose code
 * named no table would be calling somebody to nowhere.
 */
function canCall({ tableService, table } = {}) {
  return tableService === true && String(table == null ? '' : table).trim() !== '';
}

/** The table a call is for, trimmed and bounded, or '' when there is none. */
function tableOf(table) {
  return String(table == null ? '' : table)
    .trim()
    .slice(0, 40);
}

/**
 * Is this call still worth showing somebody?
 *
 * A call somebody has already acknowledged is done, and one older than the
 * window is no longer actionable - the customer has either been served or
 * given up, and either way a card about it is noise.
 */
function stillOpen(call, now = Date.now()) {
  if (!call || call.seen_at) return false;
  const at = new Date(call.called_at || 0).getTime();
  if (!at) return false;
  return now - at <= OPEN_FOR_MINUTES * 60000;
}

/**
 * The same call again, or a new one?
 *
 * Returns true when this table already has a call standing, in which case
 * nothing new is written: the customer is told it is already on its way,
 * which is the truth and is what they wanted to know.
 */
function alreadyCalling(calls, table, now = Date.now()) {
  const wanted = tableOf(table);
  if (!wanted) return false;
  return (Array.isArray(calls) ? calls : []).some(
    (call) => tableOf(call.table_number) === wanted && stillOpen(call, now)
  );
}

module.exports = { canCall, tableOf, stillOpen, alreadyCalling, OPEN_FOR_MINUTES };
