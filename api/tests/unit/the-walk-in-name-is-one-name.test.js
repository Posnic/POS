'use strict';

/*
 * THE WRITER AND THE READER KNEW DIFFERENT STRINGS.
 *
 * Owner, reading an Azure bill: "if walk in customer no need to show.
 * (remove it)".
 *
 * It was supposed to have been removed already. bill-payload.js had a guard
 * for it, written from memory:
 *
 *     if (name && !/^walk[\s-]?in$/i.test(name)) out.push(name);
 *
 * That matches "walkin", "walk in" and "walk-in". The name every install path
 * in this system actually writes is "Walk-in Customer", which it does not
 * match. So the guard was real, the intent was right, and it had never once
 * matched the thing it existed to catch. Every cash bill printed the name of a
 * customer who does not exist.
 *
 * WHAT WOULD HAVE CAUGHT IT, and is what this file does: do not test the
 * reader against a string somebody typed into a test. Take the name the WRITER
 * uses, and ask the READER about that. A test that invents its own input can
 * only ever confirm the author's belief about what the input looks like, and
 * the belief was the bug.
 *
 * Same family as the packaged module nothing could require, and the food tag
 * assertion that matched its own comment. Twelve and counting.
 */

const fs = require('fs');
const path = require('path');

const { WALK_IN_NAME, isWalkIn } = require('../../src/utils/walk-in');

const API = path.join(__dirname, '..', '..');

describe('the name a walk-in is recorded under', () => {
  test('IS A NAME THE BILL KNOWS TO LEAVE OFF', () => {
    /* The one assertion that had to exist. */
    expect(isWalkIn(WALK_IN_NAME)).toBe(true);
  });

  test('and so is every spelling of it anywhere in the source', () => {
    /*
     * Five files write this name - branch.model, install.model, setting.model,
     * install.service, demo-seed - and one more prints it as a fallback. If
     * any of them drifts to "Walk In Customer" or "Walkin Customer", the bill
     * starts printing it again and nothing else would say so.
     */
    const roots = ['src'];
    const found = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (entry.name.endsWith('.js')) {
          const source = fs.readFileSync(full, 'utf8');
          for (const m of source.matchAll(/['"`](walk[\s._-]?in[^'"`]{0,20})['"`]/gi)) {
            found.add(m[1]);
          }
        }
      }
    };
    for (const root of roots) walk(path.join(API, root));

    /* Anything that reads as a customer NAME must be recognised. Keys and
       fragments are not names and are skipped by the shape of the match. */
    const names = [...found].filter(
      (v) => /customer|guest|client/i.test(v) || /^walk[\s._-]?in$/i.test(v)
    );
    expect(names.length).toBeGreaterThan(0);

    const unrecognised = names.filter((n) => !isWalkIn(n));
    expect(unrecognised).toEqual([]);
  });

  test('the bill helper asks the shared question rather than its own', () => {
    const source = fs.readFileSync(path.join(API, 'src', 'helpers', 'bill-payload.js'), 'utf8');
    expect(source).toMatch(/isWalkIn\(/);
    expect(source).not.toMatch(/\/\^walk\[/);
  });

  test('and the repository writes the shared constant rather than a literal', () => {
    const source = fs.readFileSync(
      path.join(API, 'src', 'repositories', 'sale.repository.js'),
      'utf8'
    );
    expect(source).toMatch(/const name = WALK_IN_NAME;/);
  });
});

describe('what counts as a walk-in', () => {
  test.each([
    'Walk-in Customer',
    'Walk-In Customer',
    'walk in customer',
    'WALKIN CUSTOMER',
    'Walk_in Customer',
    'walk-in',
    'walk in',
    'walkin',
    'Walk In Guest',
    '  Walk-in Customer  ',
  ])('"%s" is the placeholder', (name) => {
    expect(isWalkIn(name)).toBe(true);
  });

  test.each(['Walkinshaw', 'Ravi', 'Walkden Traders', 'Mr Walk', '', '   '])(
    '"%s" is a person and keeps their name on the bill',
    (name) => {
      /* A false positive erases a real customer from their own bill, which is
       why this is anchored at the front and stops at a word boundary. */
      expect(isWalkIn(name)).toBe(false);
    }
  );

  test('and nothing that is not a string throws', () => {
    for (const value of [null, undefined, 0, 42, {}, [], true]) {
      expect(isWalkIn(value)).toBe(false);
    }
  });
});
