'use strict';
/*
 * THE MENU CAN BE READ.
 *
 * The first accessibility pass over the customer pages, and it is a ratchet
 * rather than a one-off: contrast is the thing that regresses silently,
 * because a colour is always chosen by eye, and the eye choosing it is looking
 * at a good screen in a well-lit room.
 *
 * WHAT WAS ACTUALLY WRONG. One value, `#0f8a3d`, used for "ok" and for the veg
 * marker on both pages. It is 4.45:1 on white against the 4.5:1 that AA asks
 * of body text - close enough that nobody would notice by looking, and either
 * side of a line that is not a judgement call. It is #0e8038 now, which is
 * 5.04:1 and the same green to look at.
 *
 * WHAT WAS ALREADY RIGHT, checked rather than assumed: every other text colour
 * on both pages clears AA in both themes, the language attribute is set from
 * the chosen language at load and the toggle reloads, focus styles exist,
 * reduced motion is honoured, images carry alt text and buttons carry labels.
 *
 * WHAT IS STILL MISSING, and is not a colour: /order has no dark mode at all
 * while /menu does. A menu read across a dinner table in the evening is the
 * common case, and the ordering page is the one people spend longer on. That
 * needs somebody watching it render, not a ratio.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** WCAG relative luminance. */
function luminance(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const channels = [0, 2, 4]
    .map((i) => parseInt(h.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const one = luminance(a);
  const two = luminance(b);
  const hi = Math.max(one, two);
  const lo = Math.min(one, two);
  return (hi + 0.05) / (lo + 0.05);
}

/** The custom properties declared in one block of CSS. */
function tokens(block) {
  const found = {};
  block.replace(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g, (whole, name, value) => {
    found['--' + name] = value;
    return whole;
  });
  return found;
}

/* The colours that carry words. A border or a fill has a lower bar; these do
   not, because somebody has to read them. */
const TEXT_COLOURS = [
  '--ink',
  '--ink-soft',
  '--ok',
  '--warn',
  '--danger',
  '--veg',
  '--non-veg',
  '--egg',
];

test('every text colour on the ordering page clears AA', () => {
  const css = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'order.css'), 'utf8');
  const at = css.indexOf(':root');
  const palette = tokens(css.slice(at, css.indexOf('}', at)));
  const bg = palette['--bg'] || '#ffffff';

  for (const name of TEXT_COLOURS) {
    if (!palette[name]) continue;
    const ratio = contrast(palette[name], bg);
    assert.ok(
      ratio >= 4.5,
      name +
        ' is ' +
        palette[name] +
        ' on ' +
        bg +
        ', ' +
        ratio.toFixed(2) +
        ':1, under the 4.5:1 AA asks for text'
    );
  }
});

test('and every one on the menu page, in both themes', () => {
  /* The menu page carries its own palette inline and its own dark mode - a
     menu is read across a dinner table in the evening. */
  const html = fs.readFileSync(path.join(ROOT, 'menu', 'index.html'), 'utf8');

  const lightAt = html.indexOf(':root');
  const light = tokens(html.slice(lightAt, html.indexOf('}', lightAt)));

  const darkMedia = html.indexOf('prefers-color-scheme: dark');
  assert.ok(darkMedia > -1, 'the menu page lost its dark mode');
  const darkAt = html.indexOf(':root', darkMedia);
  const dark = tokens(html.slice(darkAt, html.indexOf('}', darkAt)));

  for (const [theme, palette] of [
    ['light', light],
    ['dark', dark],
  ]) {
    const bg = palette['--bg'] || '#ffffff';
    for (const name of TEXT_COLOURS) {
      if (!palette[name]) continue;
      const ratio = contrast(palette[name], bg);
      assert.ok(
        ratio >= 4.5,
        theme + ' ' + name + ' is ' + palette[name] + ' on ' + bg + ', ' + ratio.toFixed(2) + ':1, under AA'
      );
    }
  }
});

test('the two pages agree on the colours they share', () => {
  /* Two pages of one product disagreeing about what "veg" looks like is two
     products, and a customer opens both. */
  const css = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'order.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'menu', 'index.html'), 'utf8');
  const orderAt = css.indexOf(':root');
  const menuAt = html.indexOf(':root');
  const order = tokens(css.slice(orderAt, css.indexOf('}', orderAt)));
  const menu = tokens(html.slice(menuAt, html.indexOf('}', menuAt)));

  for (const name of ['--ink', '--ink-soft', '--veg', '--non-veg', '--egg']) {
    if (!order[name] || !menu[name]) continue;
    assert.strictEqual(menu[name], order[name], name + ' differs between the two customer pages');
  }
});

test('the ratio maths is the WCAG one, checked against known values', () => {
  /* A contrast test with a wrong formula passes everything. */
  assert.strictEqual(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.strictEqual(Math.round(contrast('#ffffff', '#ffffff')), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.02);
});

test('a customer who asked for less motion still gets less, on both pages', () => {
  const css = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'order.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'menu', 'index.html'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the page says which language it is in, and the toggle reloads so it stays true', () => {
  /*
   * A screen reader picks its voice from this. The pages ship `lang="en"` in
   * the markup and i18n.js overwrites it at load from the chosen language;
   * the toggle reloads rather than swapping text in place, so the attribute
   * can never disagree with the words on screen.
   */
  const i18n = fs.readFileSync(path.join(ROOT, 'order', 'assets', 'i18n.js'), 'utf8');
  assert.match(i18n, /document\.documentElement\.setAttribute\("lang", lang\)/);
  assert.match(i18n, /reload\(\)/);
});
