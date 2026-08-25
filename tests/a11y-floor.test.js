'use strict';

/*
 * The accessibility floor (Lighthouse a11y 48 - the "red ones").
 *
 * Two rule families made up most of that score, and both are the kind of
 * debt that regrows silently: an icon-only button reads as "button" to a
 * screen reader, and an unlabelled input reads as nothing at all. The
 * sweep named 140 icon controls and labelled 186 fields; this test is the
 * floor under that work - a new nameless control fails CI with its file
 * and markup in the message, not a lower Lighthouse score six weeks on.
 *
 * The scan covers the same surfaces Lighthouse sees: static page HTML and
 * the JS row/line templates that render the rest of the DOM.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend');

const htmlFiles = () => []
  .concat(fs.readdirSync(path.join(ROOT, 'modules')).map((f) => path.join('modules', f)))
  .concat(fs.readdirSync(path.join(ROOT, 'layouts')).map((f) => path.join('layouts', f)))
  .concat(['dashboard.html'])
  .filter((f) => f.endsWith('.html'));

const jsFiles = () => fs.readdirSync(path.join(ROOT, 'static', 'script', 'js', 'modules', 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join('static', 'script', 'js', 'modules', 'js', f));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every icon-only button and link has an accessible name', () => {
  const offenders = [];
  for (const f of htmlFiles().concat(jsFiles())) {
    const s = read(f);
    const re = /<(button|a)\b[^>]*>\s*<i class="[^"]+"[^>]*>\s*<\/i>\s*<\/\1>/g;
    for (const m of s.match(re) || []) {
      if (!m.includes('aria-label') && !m.includes('title=')) {
        offenders.push(f + ': ' + m.slice(0, 120));
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    'these controls read as "button" to a screen reader - give each an aria-label:\n  '
    + offenders.join('\n  '));
});

test('every visible input and select has a label mechanism', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    const s = read(f);
    const forIds = new Set([...s.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
    for (const m of s.matchAll(/<(input|select)\b[^>]*>/g)) {
      const t = m[0];
      if (/type=['"]hidden['"]/.test(t)) continue;
      if (/aria-label|aria-labelledby|placeholder|title=/.test(t)) continue;
      const idm = t.match(/\bid="([^"]+)"/);
      if (idm && forIds.has(idm[1])) continue;
      // an input wrapped in a <label> is labelled by its wrapper
      const open = s.lastIndexOf('<label', m.index);
      if (open !== -1 && s.lastIndexOf('</label>', m.index) < open) continue;
      offenders.push(f + ': ' + t.slice(0, 120));
    }
  }
  assert.deepStrictEqual(offenders, [],
    'these fields have no name a screen reader can speak:\n  ' + offenders.join('\n  '));
});

test('no image ships without an alt attribute', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    for (const m of read(f).match(/<img\b[^>]*>/g) || []) {
      if (!m.includes('alt=')) offenders.push(f + ': ' + m.slice(0, 120));
    }
  }
  assert.deepStrictEqual(offenders, [],
    'alt is required - empty alt="" for decorative images:\n  ' + offenders.join('\n  '));
});
