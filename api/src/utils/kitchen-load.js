'use strict';
/*
 * How busy the kitchen is, and what that costs the next customer.
 *
 * Owner: "when kitchen have many order have so many order we might notify
 * online order customer deley might expecteed. example shop having total 10
 * tables. 10 order in the process. then kitchen is full. so you need to do
 * best guess. for this restuarant module enabled and number of table also
 * given. so than you can identify the capasity."
 *
 * A CUSTOMER WHO WAITS FORTY MINUTES WITHOUT BEING TOLD blames the
 * restaurant. One who was told chose to wait. That is the whole value here,
 * and it is worth more than the handful of orders the warning costs.
 *
 * BUT A WARNING WITH NO NUMBER IS NOISE. "Delay expected" is either ignored
 * or read as "do not order", because the reader has to imagine the number and
 * people imagine the worst. So this answers in MINUTES wherever the shop's own
 * data can support one, and only says the bare "busy" when it cannot - the
 * same rule the health badges follow: never claim more than the numbers earn.
 *
 * THE THREE NUMBERS, AND WHERE EACH COMES FROM.
 *
 *   open      tickets still in the kitchen: KOT, unpaid, no bill printed.
 *             Every channel counts - a kitchen is full whoever sent the
 *             order, and a dine-in table blocks the pass exactly as much as
 *             a phone does.
 *   capacity  how many tables the shop has typed in. Not a measure of the
 *             kitchen, which nobody has asked the shop for, but the only
 *             honest proxy it has already given us: a room laid for ten is
 *             staffed to cook for about ten at once.
 *   round     the shop's OWN median prep_minutes across the dishes that state
 *             one. Not a constant invented here. A tea stall and a grill
 *             house both get their own number, and a shop that has entered no
 *             prep times gets none at all.
 *
 * WHY ceil(open / capacity). A kitchen laid for ten tables can have about ten
 * tickets in flight; the eleventh waits for one of them to leave the pass. So
 * the queue is roughly that many rounds deep, and everything past the first
 * round is time the next customer will wait beyond the cooking itself.
 *
 * It is an estimate and the page says so. What it must never be is confident
 * and wrong, which is why it stays silent in every case where it would be
 * guessing: no restaurant module, no tables typed in, no orders open.
 *
 * NO DATABASE IMPORTS.
 */

/* Beyond this the number stops meaning anything, and "about an hour" is the
   honest end of the scale. A kitchen twelve rounds deep is not eleven times
   more precise than one four rounds deep; it is simply swamped. */
const MOST_MINUTES = 60;

/** Minutes, to the nearest five: a wait is not a train timetable. */
function toFive(minutes) {
  return Math.round(minutes / 5) * 5;
}

/**
 * The shop's own typical dish, in minutes.
 *
 * The MEDIAN and not the mean, because one 90-minute slow roast on a menu of
 * ten-minute dosas would drag the average somewhere no customer will ever
 * wait. Dishes that state nothing are left out rather than counted as zero:
 * missing is not the same as instant.
 *
 * @param {number[]} prepMinutes  every dish's stated prep time
 * @returns {number} 0 when the shop has stated none
 */
function typicalRound(prepMinutes) {
  const stated = (Array.isArray(prepMinutes) ? prepMinutes : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!stated.length) return 0;
  const middle = Math.floor(stated.length / 2);
  return stated.length % 2 ? stated[middle] : Math.round((stated[middle - 1] + stated[middle]) / 2);
}

/**
 * What to tell the next customer, or nothing at all.
 *
 * @param {object} facts
 *   tableService  the restaurant switch; false means say nothing
 *   open          tickets in the kitchen right now
 *   capacity      tables the shop has typed in
 *   round         the shop's median prep time, 0 when unknown
 * @returns {{busy: boolean, open: number, capacity: number, extra_minutes: number, over: boolean}}
 */
function kitchenLoad({ tableService, open, capacity, round } = {}) {
  const quiet = { busy: false, open: 0, capacity: 0, extra_minutes: 0, over: false };

  /* A shop with no table service has not told us its capacity and never
     will: takeaway counters and grocers are out of scope by design. */
  if (tableService !== true) return quiet;

  const tables = Math.max(0, Math.floor(Number(capacity) || 0));
  const tickets = Math.max(0, Math.floor(Number(open) || 0));
  /* No tables typed in is a restaurant part-way through its setup, not an
     empty restaurant. Guessing at its capacity would be inventing one. */
  if (!tables) return quiet;

  const rounds = Math.ceil(tickets / tables);
  if (rounds <= 1)
    return { busy: false, open: tickets, capacity: tables, extra_minutes: 0, over: false };

  const each = Number(round);
  const minutes = Number.isFinite(each) && each > 0 ? (rounds - 1) * each : 0;
  const over = minutes > MOST_MINUTES;
  return {
    busy: true,
    open: tickets,
    capacity: tables,
    /* 0 means "busy, and we cannot honestly say by how much" - the page then
       says so in words rather than inventing a figure. */
    extra_minutes: minutes ? Math.min(MOST_MINUTES, toFive(minutes)) : 0,
    over,
  };
}

module.exports = { kitchenLoad, typicalRound, MOST_MINUTES };
