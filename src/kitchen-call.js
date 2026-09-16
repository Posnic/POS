"use strict";

/*
 * THE KITCHEN HEARS A TICKET ARRIVE.
 *
 * Owner: "whenever new KOT received one tink sound with full sound i want.
 * need to place in kitchen. if possible read the items. Example Table 5 new
 * order. Ting! one chicken briyani, one chicken tikka masala."
 *
 * A printer in a kitchen is silent and a ticket is small. A cook with their
 * hands in a pan does not see one arrive, and the first anybody knows is a
 * waiter asking where the food is. A speaker says it across the room without
 * anybody looking at anything.
 *
 * THE TING COMES FIRST, THEN THE WORDS. A speaker that starts talking into a
 * working kitchen loses its first two words, and the first two words are the
 * table number - the one part nobody can guess from the rest.
 *
 * WHAT IS SAID, AND WHAT IS NOT. Names and counts. Not notes, not the dish's
 * description, not the price. A ticket read aloud for ninety seconds is one a
 * kitchen stops listening to, and what makes announcements fail is never that
 * they said too little.
 *
 * ENGLISH, by the owner's choice: "All english as of now." The one place that
 * decides is `say()` below.
 *
 * PER MACHINE, NOT PER SHOP. Only the machine in the kitchen has the speaker.
 * A counter till that started talking would be a till somebody mutes, and then
 * the kitchen's own speaker is muted too.
 */

/*
 * Counts as words, up to the point where words stop helping.
 *
 * "One chicken biryani" is how somebody would say it; "1 chicken biryani" is
 * how a speech engine says "one chicken biryani" anyway, but pronounces badly
 * in the middle of a sentence on some voices. Past twelve, digits are clearer
 * than "seventeen" spoken quickly.
 */
const WORDS = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

const countWord = (n) => {
  const count = Number(n) || 0;
  if (count < 1) return "";
  return count < WORDS.length ? WORDS[count] : String(count);
};

/*
 * HOW MANY LINES GET READ.
 *
 * A table of six sending six courses arrives within seconds - kot-manager
 * already debounces printing for exactly that reason. Read in full, that is a
 * minute of talking, and a kitchen that has stopped listening does not hear
 * the next one either. Six lines, then how many are left, and the ticket
 * itself is still on the spike for the detail.
 */
const READ_AT_MOST = 6;

/*
 * The name as the shop typed it, tidied of whitespace and nothing else.
 *
 * An earlier version stripped anything in brackets, meaning to drop decoration
 * like "(Half)". It turned "Gobi (65)" into "Gobi" - a different dish. What is
 * in brackets is usually the part that tells a cook which one: half, full,
 * boneless. The shop's name is the shop's.
 */
function spokenName(item) {
  return String((item && (item.item_name || item.name || item.product_name)) || "")
    .replace(/\s+/g, " ")
    .trim();
}

const quantityOf = (item) =>
  Number((item && (item.item_quantity || item.quantity)) || 0) || 0;

/**
 * What the speaker should say about one ticket, ONE LINE AT A TIME.
 *
 * Separate lines rather than one sentence, because the renderer speaks each as
 * its own utterance and a speech engine leaves a real gap between them. A full
 * stop inside one sentence is a shorter pause than a kitchen needs: the point
 * of the gap is that somebody can hold one dish in their head before the next
 * arrives.
 *
 * Returns an empty list when there is nothing worth saying, so a caller can
 * stay quiet rather than announce a ticket with no dishes on it.
 *
 * @param {object} ticket
 * @param {string|number} ticket.table where it is for
 * @param {Array} ticket.items what is on it
 * @param {boolean} [ticket.changed] an amendment rather than a new order
 */
function lines({ table, items, changed } = {}) {
  const said = (Array.isArray(items) ? items : [])
    .map((item) => ({ name: spokenName(item), count: quantityOf(item) }))
    .filter((line) => line.name && line.count > 0);

  if (!said.length) return [];

  const where = String(table == null ? "" : table).trim();
  /*
   * "Table 5" when there is one, "Takeaway" when the shop calls it that, and
   * neither invented when the ticket does not say. A speaker announcing
   * "Table undefined" is worse than one that just reads the food.
   */
  const opening = where
    ? `${/^\d+$/.test(where) ? `Table ${where}` : where}, ${changed ? "order changed" : "new order"}.`
    : `${changed ? "Order changed" : "New order"}.`;

  /*
   * HOW MANY PLATES ARE COMING, said before the list.
   *
   * Owner: "KOT total items also print and voice read please. so that chef's
   * can hear well."
   *
   * Before rather than after, because a number heard first is a number you can
   * count against. A chef who knows three plates are coming notices when they
   * have heard two, which is the whole use of it - after the list it is a fact
   * nobody can act on.
   *
   * PLATES, not lines. One biryani and two naan is three things to cook and
   * two lines on a ticket, and a kitchen works in plates.
   */
  const plates = said.reduce((sum, line) => sum + line.count, 0);
  const counted = countWord(plates);
  const howMany =
    plates === 1
      ? "One item."
      : `${counted.charAt(0).toUpperCase()}${counted.slice(1)} items.`;

  const read = said.slice(0, READ_AT_MOST);
  /* Capitalised, because each of these is a sentence once the full stops go
     in, and a log or a test reading "one Chicken Biryani" mid-line looks like
     a bug even where a speech engine does not care. */
  const spoken = read.map((line) => {
    const count = countWord(line.count);
    return `${count.charAt(0).toUpperCase()}${count.slice(1)} ${line.name}`;
  });

  const rest = said.length - read.length;
  if (rest > 0) spoken.push(`And ${countWord(rest)} more`);

  return [opening, howMany].concat(spoken.map((line) => `${line}.`));
}

/*
 * The same announcement as one string.
 *
 * Kept because a sentence is easier to read in a log and in a test than an
 * array, and because a caller that cannot queue utterances can still say it.
 */
function say(ticket) {
  return lines(ticket).join(" ");
}

module.exports = { say, lines, countWord, spokenName, READ_AT_MOST };
