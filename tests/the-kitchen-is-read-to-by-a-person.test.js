'use strict';

/*
 * WHO READS THE TICKET OUT.
 *
 * Owner: "make female voice. more casual than machine voice. indian accent?"
 *
 * The Web Speech API does not say which voice is which. A SpeechSynthesisVoice
 * has a name and a language and nothing else, so the only way to ask for a
 * particular one is by name - which is why the selection is a list of names
 * rather than a one-line language match.
 *
 * The plain language match picked Ravi, the male half of the Windows en-IN
 * pair, purely because Windows enumerates him first. Both voices satisfied
 * "en-IN", so nothing was wrong and the wrong voice came out anyway.
 *
 * The real player is run here against a fake speech engine, so what is tested
 * is the file that ships rather than a description of it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLAYER = path.join(
  __dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'kitchen-call.js');

const voice = (name, lang) => ({ name: name, lang: lang });

/* Windows, in the order it actually enumerates them on the shop's machine. */
const A_WINDOWS_MACHINE = [
  voice('Microsoft David - English (United States)', 'en-US'),
  voice('Microsoft Ravi - English (India)', 'en-IN'),
  voice('Microsoft Heera - English (India)', 'en-IN'),
  voice('Microsoft Zira - English (United States)', 'en-US'),
];

/** Run the shipped player against a fake engine and report what it said. */
function readTo(voices, lines) {
  const src = fs.readFileSync(PLAYER, 'utf8');

  const spoken = [];
  let handler = null;

  const win = {
    posnic: { kitchenCall: { on: (h) => { handler = h; } } },
    speechSynthesis: {
      speaking: false,
      pending: false,
      cancel() {},
      getVoices: () => voices,
      speak: (u) => spoken.push(u),
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    setTimeout: () => {},
  };

  new Function('window', src)(win);

  assert.ok(handler, 'the player never registered for tickets');
  /* No sound in the payload: the chime belongs to a sound card, and what is
     under test here is who says the words. */
  handler({ sound: '', lines: lines || ['Table 5, new order.'] });

  return spoken;
}

test('A WOMAN READS IT, not whoever Windows happens to list first', () => {
  const spoken = readTo(A_WINDOWS_MACHINE);

  assert.ok(spoken.length, 'nothing was said at all');
  assert.match(spoken[0].voice.name, /Heera/, 'Ravi is still reading the orders');
});

test('THE ACCENT COMES FIRST, then the voice', () => {
  /*
   * An Indian woman before a British one. The dish names are the whole point:
   * "kuzhambu" read in an English accent is a word a kitchen has to decode
   * rather than hear.
   */
  const spoken = readTo([
    voice('Microsoft Libby - English (United Kingdom)', 'en-GB'),
    voice('Microsoft Ravi - English (India)', 'en-IN'),
  ]);

  assert.match(spoken[0].voice.lang, /en-IN/i, 'a British voice was preferred to an Indian one');
});

test('a machine with no woman in that language still gets the accent', () => {
  /* A name not on the list is not a failure. Whatever en-IN exists beats
     English from another country. */
  const spoken = readTo([
    voice('Microsoft Zira - English (United States)', 'en-US'),
    voice('Microsoft Ravi - English (India)', 'en-IN'),
  ]);

  assert.match(spoken[0].voice.name, /Ravi/);
});

test('and a machine with no Indian voice is still read to', () => {
  const spoken = readTo([voice('Microsoft David - English (United States)', 'en-US')]);

  assert.ok(spoken.length, 'a kitchen was told nothing because the accent was wrong');
  assert.match(spoken[0].voice.name, /David/);
});

test('IT IS SAID, NOT ANNOUNCED', () => {
  /*
   * Owner: "more casual than machine voice."
   *
   * A flat voice at a measured pace is what a machine sounds like. Kept close
   * to normal on purpose: past about 1.15 a synthesised voice stops sounding
   * relaxed and starts sounding like a cartoon.
   */
  const spoken = readTo(A_WINDOWS_MACHINE);

  assert.ok(spoken[0].pitch > 1, 'still reading on a flat pitch');
  assert.ok(spoken[0].pitch <= 1.15, 'a cartoon is worse than flat');
  assert.ok(spoken[0].rate >= 0.9 && spoken[0].rate <= 1.05, 'rushed or dragging');
  assert.strictEqual(spoken[0].volume, 1);
});

test('one utterance per line, which is where the pauses come from', () => {
  const spoken = readTo(A_WINDOWS_MACHINE, [
    'Table 5, new order.', 'Three items.', 'One Chicken Biryani.',
  ]);

  assert.deepStrictEqual(
    spoken.map((u) => u.text),
    ['Table 5, new order.', 'Three items.', 'One Chicken Biryani.']);
});
