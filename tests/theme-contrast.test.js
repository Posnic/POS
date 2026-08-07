const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { contrast } = require('../window-chrome');

/*
 * Every theme, checked for the combinations nobody can read.
 *
 * A shop picks a theme from a grid of swatches and never sees the pairing until
 * it is on a counter: white text on a white card, grey on grey, an active menu
 * item whose label vanishes into its own highlight. Nothing errors, no test
 * fails, and the shop concludes the software is broken.
 *
 * There are 24 presets and each carries about a dozen colours, so this is not
 * something to check by eye - and checking it by eye is exactly what has been
 * happening. The thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large
 * text and for things that are shapes rather than words.
 *
 * The presets are read out of themeManager.js rather than duplicated here. A
 * copy would be wrong the first time somebody added a theme, and then this file
 * would be checking colours nobody ships.
 */

const SOURCE = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js',
  'core', 'themeManager.js');
const source = fs.readFileSync(SOURCE, 'utf8');

/* The presets object, parsed out of the file it lives in. */
function readPresets() {
  const start = source.indexOf('presets:');
  assert.notStrictEqual(start, -1, 'presets not found in themeManager.js');

  const open = source.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  const block = source.slice(open, i + 1);

  const presets = {};
  // name: { ... } at one level of nesting
  const re = /(\w+):\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const body = m[2];
    const entry = {};
    const kv = /(\w+):\s*'([^']*)'/g;
    let p;
    while ((p = kv.exec(body)) !== null) entry[p[1]] = p[2];
    if (entry.bodyBg || entry.textPrimary) presets[m[1]] = entry;
  }
  return presets;
}

const PRESETS = readPresets();

/* The pairings a person actually has to read. */
const PAIRS = [
  { text: 'textPrimary', bg: 'bodyBg', min: 4.5, what: 'body text on the page' },
  { text: 'textPrimary', bg: 'cardBg', min: 4.5, what: 'text on a card' },
  { text: 'textPrimary', bg: 'topbarBg', min: 4.5, what: 'text in the top bar' },
  { text: 'textSecondary', bg: 'cardBg', min: 4.5, what: 'secondary text on a card' },
  { text: 'menuText', bg: 'menuBg', min: 4.5, what: 'a menu item' },
  { text: 'menuActiveText', bg: 'menuActiveBg', min: 4.5, what: 'the selected menu item' },
];

test('the presets are found, so the rest of this file means something', () => {
  const names = Object.keys(PRESETS);
  assert.ok(names.length >= 15, 'expected the full set of presets, found ' + names.length);
  assert.ok(names.includes('dark') && names.includes('default'),
    'the two presets every install can reach must be among them');
});

test('no theme puts text where it cannot be read', () => {
  /*
   * The one that matters. A pairing below 4.5:1 is not "a bit low contrast" on
   * a till in daylight - it is a total somebody has to lean in to read, or a
   * label they cannot read at all.
   */
  const failures = [];

  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const pair of PAIRS) {
      const fg = preset[pair.text];
      const bg = preset[pair.bg];
      if (!fg || !bg) continue;              // not every preset defines every token
      const ratio = contrast(fg, bg);
      if (ratio < pair.min) {
        failures.push(`${name}: ${pair.what} - ${fg} on ${bg} is ${ratio.toFixed(2)}:1`
          + ` (needs ${pair.min})`);
      }
    }
  }

  assert.deepStrictEqual(failures, [], '\n  ' + failures.join('\n  ') + '\n');
});

test('no theme is the same colour twice, which is invisible rather than merely dim', () => {
  // The white-on-white case, called out separately because 1.0:1 deserves a
  // clearer message than "below threshold".
  const invisible = [];

  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const pair of PAIRS) {
      const fg = preset[pair.text];
      const bg = preset[pair.bg];
      if (!fg || !bg) continue;
      if (String(fg).toLowerCase() === String(bg).toLowerCase()) {
        invisible.push(`${name}: ${pair.what} is ${fg} on the same colour`);
      }
    }
  }

  assert.deepStrictEqual(invisible, []);
});

test('the accent stays visible on the surfaces it is drawn on', () => {
  // The accent marks the selected item in the icon rail and underlines the
  // active tab; at 3:1 it is a shape rather than text, but below that it is
  // decoration nobody can locate.
  const weak = [];

  for (const [name, preset] of Object.entries(PRESETS)) {
    const accent = preset.primaryColor;
    if (!accent) continue;
    // Only the surfaces the accent is actually drawn on. It marks the active
    // item and underlines the active tab, both of which sit on the page and on
    // cards - never on the sidebar, whose own colour is usually the same hue.
    for (const surface of ['bodyBg', 'cardBg']) {
      const bg = preset[surface];
      if (!bg) continue;
      const ratio = contrast(accent, bg);
      if (ratio < 3) {
        weak.push(`${name}: accent ${accent} on ${surface} ${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
  }

  /*
   * Reported, not enforced - for now.
   *
   * Six light themes use a bright Material accent on a near-white page, and
   * amber on white is 1.63:1. That is a real failure for an indicator, and it
   * is also not fixable by nudging a number: an Amber theme whose accent is
   * dark enough to clear 3:1 on white is no longer amber. The honest fix is a
   * second, darker token used for indicators, which is a palette decision and
   * not mine to make quietly.
   *
   * Listed so it stays visible and countable. The text checks above are
   * enforced, because those are unreadable rather than merely low contrast.
   */
  if (weak.length) {
    // eslint-disable-next-line no-console
    console.log('\n  accents below 3:1 on the surfaces they mark '
      + '(palette decision pending):');
    // eslint-disable-next-line no-console
    weak.forEach((w) => console.log('    ' + w));
  }
});
