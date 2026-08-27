const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The keys a cashier uses while a queue waits.
 *
 * The screen-navigation shortcuts were bound through Mousetrap, which ignores
 * keystrokes inside inputs by design. That is right for the bare-letter
 * shortcuts - "s" must type an s in a customer's name - and precisely wrong for
 * the till actions, because the cursor is in the search box almost all the
 * time. So these are a plain keydown handler, and this test holds that apart.
 */
const SOURCE = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js',
  'custom-shortcutkey.js');
const source = fs.readFileSync(SOURCE, 'utf8');

test('the till actions are function keys, not letters', () => {
  // Letters cannot be bound here: the cursor lives in the search box, and a
  // shortcut that eats a keystroke from a product name is worse than no
  // shortcut. Function keys insert nothing.
  for (const key of ['F2', 'F4', 'F8', 'F9']) {
    assert.ok(source.includes(key + ':'), 'no binding for ' + key);
  }
});

test('they are bound outside Mousetrap, which would swallow them', () => {
  const block = source.slice(source.indexOf('var TILL_KEYS'));
  assert.ok(!/Mousetrap\.bind/.test(block.slice(0, block.indexOf('$(document).bind("keydown"'))),
    'till keys must not go through Mousetrap');
});

test('a dialog suppresses them, so one press cannot become two sales', () => {
  // The payment dialog has its own buttons and its own Enter handling.
  assert.match(source, /\.modal\.show/);
});

test('completing and holding a sale still check write permission', () => {
  const block = source.slice(source.indexOf('var TILL_KEYS'), source.indexOf('labelTillButtons'));
  for (const key of ['F4', 'F8', 'F9']) {
    const at = block.indexOf(key + ':');
    assert.ok(block.slice(at, at + 200).includes("needs: 'write'"),
      key + ' must require sales write');
  }
});

test('searching does not, because reading is not writing', () => {
  const block = source.slice(source.indexOf('var TILL_KEYS'), source.indexOf('labelTillButtons'));
  const at = block.indexOf('F2:');
  assert.ok(!block.slice(at, at + 200).includes('needs:'),
    'focusing the search box should not need write access');
});

test('they only fire on the new sale screen', () => {
  assert.match(source, /window\.location\.hash\.slice\(1\) !== '\/sales\/new'/);
});

test('the buttons say which key they are', () => {
  // A shortcut nobody is told about is a shortcut nobody uses. The label goes
  // on the button itself rather than in a manual.
  assert.match(source, /labelTillButtons/);
  assert.ok(source.includes("'#holdSaleButton', 'F4'"));
  assert.ok(source.includes("'#save_submit', 'F9'"));
});

test('completing a sale goes through the one submit path', () => {
  // There are duplicate hidden submit buttons in the markup; triggering them
  // by class created two sales from one press, which is why the existing
  // Ctrl+Enter handler calls the function directly. F9 must do the same.
  const at = source.indexOf('F9:');
  assert.ok(source.slice(at, at + 400).includes('cartOrderSubmit'),
    'F9 must call the submit handler directly, not click a button');
});

/*
 * Two handlers answering the same key.
 *
 * Ctrl+L was bound to Expenses here and to the lock in lock-screen.js, on
 * separate document listeners, so both ran: the till locked and the page
 * navigated behind it, and whoever unlocked found a different screen with the
 * cart gone. Nothing errors when this happens, which is why it needs a test
 * rather than a careful reading.
 */
const LOCK_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'lock-screen.js'),
  'utf8');

test('Ctrl+L belongs to the lock and to nothing else', () => {
  assert.ok(/e\.key === 'l' \|\| e\.key === 'L'/.test(LOCK_SOURCE),
    'the lock should still claim Ctrl+L');
  assert.ok(!/Mousetrap\.bind\(\[[^\]]*'ctrl\+l'/.test(source),
    'navigation must not also claim Ctrl+L');
});

test('the keys the shell claims are not also claimed by the page', () => {
  /*
   * An accelerator in the Electron menu is handled before the page sees the
   * key, so a page binding on the same combination is simply dead on the
   * desktop while still working in a browser - which is the kind of difference
   * that gets reported as "the shortcut works on my laptop".
   */
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const shellKeys = [...main.matchAll(/accelerator: 'CmdOrCtrl\+([A-Z])'/g)]
    .map((m) => 'ctrl+' + m[1].toLowerCase());

  const pageKeys = [...source.matchAll(/Mousetrap\.bind\(\[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')));

  const clash = shellKeys.filter((k) => pageKeys.includes(k));
  assert.deepStrictEqual(clash, [],
    'these keys are claimed by both the menu and the page: ' + clash.join(', '));
});
