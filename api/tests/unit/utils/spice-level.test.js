'use strict';

/*
 * How hot, and what may be said about it.
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy. we can add those into kitchen note."
 *
 * The rule this file guards is small and worth stating plainly: a level that
 * nobody chose must never become a level somebody did. Everything a customer
 * sends arrives as JSON over the open internet, so "2" from a phone, 2 from a
 * handset, 7 from a broken client and "medium" from somebody experimenting
 * all land in the same field, and exactly three of those may reach a cook.
 */

const spice = require('../../../src/utils/spice-level');

describe('a level somebody actually chose', () => {
  test('the three the customer can tap are the three that count', () => {
    expect(spice.levelOf(1)).toBe(1);
    expect(spice.levelOf(2)).toBe(2);
    expect(spice.levelOf(3)).toBe(3);
  });

  test('a number in a string is still that number, because JSON is JSON', () => {
    /* The ordering page sends a number; a handset that stringifies its form
       sends "2". Refusing the second would silently drop the request. */
    expect(spice.levelOf('2')).toBe(2);
  });

  test('anything else is nobody asked', () => {
    /*
     * Not an error, and not a guess. A value nobody recognises must not become
     * a promise about somebody's food, and it must not stop the order either:
     * the dish is still wanted, the request simply cannot be honoured.
     */
    [0, 4, -1, 99, '', null, undefined, NaN, 'medium', {}, [], true].forEach((bad) => {
      expect(spice.levelOf(bad)).toBe(0);
    });
  });
});

describe('which dishes offer the choice', () => {
  test('only a dish the shop ticked', () => {
    /*
     * Off by default and per dish, because a kitchen that batch-cooks its
     * gravy cannot make one portion mild - and a customer who asked for mild
     * and got hot is worse off than one who never asked.
     */
    expect(spice.offersChoice({ spice_choice: true })).toBe(true);
    expect(spice.offersChoice({ spice_choice: false })).toBe(false);
    expect(spice.offersChoice({})).toBe(false);
    expect(spice.offersChoice(null)).toBe(false);
  });

  test('a truthy value that is not true does not count', () => {
    /* Settings have arrived as the string "false" in this codebase before,
       and read as ON through a loose check. A boolean field is a boolean. */
    expect(spice.offersChoice({ spice_choice: 'false' })).toBe(false);
    expect(spice.offersChoice({ spice_choice: 1 })).toBe(false);
  });
});

describe('what the paper says', () => {
  test('the word and the count, in that order', () => {
    expect(spice.ticketLine(1)).toBe('SPICE: MILD (1 of 3)');
    expect(spice.ticketLine(2)).toBe('SPICE: MEDIUM (2 of 3)');
    expect(spice.ticketLine(3)).toBe('SPICE: SPICY (3 of 3)');
  });

  test('nobody asked, nothing printed', () => {
    /* A ticket line reading "SPICE: NOT SAID" is a line every cook learns to
       skip, on every ticket, forever. */
    expect(spice.ticketLine(0)).toBe('');
    expect(spice.ticketLine(undefined)).toBe('');
    expect(spice.ticketLine('hot')).toBe('');
  });

  test('every character survives a thermal printer', () => {
    /*
     * escpos-receipt.js puts every character through ascii() and latin1. A
     * chilli emoji on this line would reach the kitchen as a question mark or
     * as nothing, which is why the chillies are drawn on the customer's phone
     * and the paper gets a word and a number instead.
     */
    for (const level of spice.LEVELS) {
      const line = spice.ticketLine(level);

      expect(line).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  test('the count is there for a cook who does not read the word', () => {
    /* The whole reason this is a level and not a sentence: 2 of 3 means the
       same thing to a cook in any language. */
    expect(spice.ticketLine(2)).toContain('2 of 3');
  });
});
