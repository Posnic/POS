'use strict';

/*
 * The saved voice key, on the Captain App's voice tab.
 *
 * Owner, after saving one: "i saved here nothing happened. need close form
 * have edit or delete symbol. but nothing happened."
 *
 * The save had worked. What had not happened was anything a person could
 * see: the only sign of a key on file was a changed placeholder inside a box
 * that stays open, so a saved key and no key looked identical. The AI card
 * settled this once already; this tab now does the same thing.
 *
 * Everything here is about the two failure shapes that look like success:
 * a control that says nothing, and a button wired to a function nobody
 * wrote.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HTML = read('frontend', 'modules', 'settings_write.html');
const JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const CSS = read('frontend', 'static', 'style', 'css', 'custom.css');

test('a saved voice key is said with a card, not with a placeholder', () => {
  assert.match(HTML, /id="voice_key_saved"/, 'there is no saved-key card on the voice tab');
  assert.match(HTML, /id="voice_key_edit"/, 'a saved key cannot be replaced');
  assert.match(HTML, /id="voice_key_remove"/, 'a saved key cannot be removed');
  assert.match(HTML, /id="voice_key_provider"/, 'the card does not say what the key is for');

  /* The card is folded away until the page knows there is a key. */
  const card = HTML.slice(HTML.indexOf('id="voice_key_saved"'));
  assert.match(card.slice(0, 200), /display:\s*none/, 'the card is visible before anything is known');
});

test('every button on that card is wired to something that exists', () => {
  /*
   * A click handler pointing at a function nobody wrote is a button that
   * does nothing - which is exactly the complaint. PosnicPro.confirm was
   * invented once here and had to be caught; the console asks with swal.
   */
  for (const id of ['voice_key_edit', 'voice_key_remove']) {
    assert.match(
      JS,
      new RegExp("on\\('click', '#" + id + "'"),
      `#${id} is in the markup but nothing listens to it`
    );
  }
  assert.match(JS, /edit: function \(\)/, 'the card has an Edit button and no edit()');
  assert.match(JS, /removeKey: function \(\)/, 'the card has a Remove button and no removeKey()');
  assert.ok(
    !/PosnicPro\.confirm\(/.test(JS),
    'something asks with PosnicPro.confirm, which does not exist'
  );
  /* It asks the way the rest of the console asks. */
  const removal = JS.slice(JS.indexOf('removeKey: function ()'));
  assert.match(removal.slice(0, 900), /swal\(\{/, 'removal does not ask before it removes');
});

test('removal says so out loud, because an empty box means leave it alone', () => {
  /* The value is never sent back to a browser, so an empty field cannot mean
     "delete": it means "unchanged". Removal has to carry the sentinel. */
  const removal = JS.slice(JS.indexOf('removeKey: function ()'));
  assert.match(
    removal.slice(0, 1400),
    /voice_api_key: PosnicPro\.settings\.voice\.CLEAR_SECRET/,
    'removal sends something other than the clear sentinel'
  );
  const sentinel = (JS.match(/CLEAR_SECRET: '([^']+)'/) || [])[1];
  const api = read('api', 'src', 'services', 'settings-groups.js');
  assert.ok(sentinel, 'the voice card has no clear sentinel');
  assert.ok(
    api.includes(`const CLEAR_SECRET = '${sentinel}'`),
    'the sentinel the page sends is not the one the API listens for'
  );
});

test('the card and the box are never both up, and neither is up without a key to hold', () => {
  const sync = JS.slice(JS.indexOf('syncKeyRow: function ()'));
  const body = sync.slice(0, sync.indexOf('\n    },'));
  assert.match(body, /#voice_key_saved'\)\.toggle\(needsKey && onFile\)/);
  assert.match(body, /#voice_key_row'\)\.toggle\(needsKey && !onFile\)/);
  /* A provider that needs no key shows neither. */
  assert.match(body, /var paid = \['openai', 'google', 'deepgram', 'assembly'\]/);
});

test('the card is painted, and painted the same way as the one it copies', () => {
  assert.match(CSS, /#captainvoice-line \.ai-key-status/, 'the voice card has no style of its own');
  for (const part of ['.ai-key-badge', '.ai-key-hint', '.ai-key-actions']) {
    assert.ok(
      CSS.includes('#captainvoice-line ' + part),
      `the voice card is missing ${part}, so it will not look like the AI one`
    );
  }
});
