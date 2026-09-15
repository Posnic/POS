'use strict';
/*
 * How hot, when the kitchen can decide.
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy. we can add those into kitchen note."
 *
 * Spice is the thing an Indian restaurant is asked to change more often than
 * anything else on its menu, and until now the only way to ask was typing it
 * into the free-text note - in whatever words, in whatever language, for a
 * kitchen that then has to read prose off a ticket at speed.
 *
 * THREE LEVELS, AND NOT CHOOSING IS ONE TOO.
 *
 * Mild, medium, spicy. "However the kitchen makes it" is simply not picking,
 * which is why there is no fourth button for it: a default that has to be
 * selected is a question, and this has to stay one tap. Somebody who wants no
 * chilli at all still has the note, which has not gone anywhere.
 *
 * WHY IT IS A FIELD AND NOT A SENTENCE IN THE NOTE.
 *
 * The obvious build is to append "less spicy" to the kitchen note, and it is
 * wrong twice over. A customer reading a Tamil menu writes Tamil, and the
 * ticket then carries prose the kitchen may misread; a LEVEL prints the same
 * on every ticket whatever language the order was placed in. And a number can
 * be counted afterwards - a shop can learn that four orders in ten ask for
 * mild, and cook accordingly - which no amount of free text will ever tell it.
 *
 * NOT EVERY DISH. See item.spice_choice: the shop says which dishes take one.
 * That is not about chillies looking silly on a gulab jamun. A kitchen that
 * batch-cooks its gravy CANNOT make one portion mild, and a customer who asked
 * for mild and got hot is worse off than one who never asked - so the offer
 * exists only where the kitchen can honour it, and only the kitchen knows
 * where that is.
 *
 * THE TICKET SAYS IT IN ASCII. The chillies are drawn on the customer's screen
 * and nowhere else: escpos-receipt.js puts every character through ascii() and
 * latin1, so an emoji on a kitchen ticket prints as a question mark or as
 * nothing. The paper gets the word and the count instead, and the count is
 * there for a cook who does not read the word.
 *
 * NO DATABASE IMPORTS.
 */

/* Stored as the number of chillies, because that is what the customer taps
   and what the ticket counts. 0 means nobody chose. */
const SPICE = Object.freeze({
  NOT_SAID: 0,
  MILD: 1,
  MEDIUM: 2,
  SPICY: 3,
});

const LEVELS = Object.freeze([SPICE.MILD, SPICE.MEDIUM, SPICE.SPICY]);

/* The words the paper prints. English, because the ticket is the kitchen's
   and the kitchen is the shop's; the customer's own screen says it in the
   customer's language, from the ordering dictionary. */
const WORDS = Object.freeze({
  [SPICE.MILD]: 'MILD',
  [SPICE.MEDIUM]: 'MEDIUM',
  [SPICE.SPICY]: 'SPICY',
});

/**
 * A level somebody actually chose, or nothing.
 *
 * Anything that is not one of the three reads as NOT SAID, deliberately: a
 * value nobody recognises must never become a promise about somebody's food.
 */
function levelOf(value) {
  /*
   * A NUMBER OR THE TEXT OF ONE, AND NOTHING ELSE.
   *
   * Number(true) is 1, so a client sending spice_level: true would have had
   * MILD printed on a real ticket for a request nobody made. Caught by the
   * test rather than by anybody reading this, which is the point of the test.
   * A string is still allowed: a handset that stringifies its form sends "2",
   * and refusing that would silently drop the request.
   */
  if (typeof value !== 'number' && typeof value !== 'string') return SPICE.NOT_SAID;
  const n = Number(value);
  return LEVELS.includes(n) ? n : SPICE.NOT_SAID;
}

/** Does this dish offer the choice at all? */
function offersChoice(item) {
  return Boolean(item && item.spice_choice === true);
}

/**
 * What the kitchen ticket says, or '' when nobody asked.
 *
 * The count is not decoration. A cook who does not read English still reads
 * 2 of 3, and a ticket that printed only a word would be useless to them.
 */
function ticketLine(value) {
  const level = levelOf(value);
  if (!level) return '';
  return 'SPICE: ' + WORDS[level] + ' (' + level + ' of ' + LEVELS.length + ')';
}

module.exports = { SPICE, LEVELS, WORDS, levelOf, offersChoice, ticketLine };
