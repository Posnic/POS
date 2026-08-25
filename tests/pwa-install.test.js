'use strict';

/*
 * Installability contract (Mobile P4). "Most of our users visit from
 * mobile" - the app must pass the browser's install checks, and those
 * checks are concrete: a manifest with real PNG icons at 192 and 512
 * (an SVG-only icon list fails Chrome on Android), a maskable variant so
 * launchers that crop to a circle do not clip the mark, and a PNG
 * apple-touch-icon (iOS ignores SVG there and composites transparency
 * over black). The icons are generated from the favicon's 256px frame -
 * if the logo changes, regenerate all four together.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the manifest offers real PNG icons at the sizes Chrome checks', () => {
  const m = JSON.parse(read('static/manifest.webmanifest'));
  assert.strictEqual(m.display, 'standalone');
  const bySize = (s, purpose) => m.icons.find(
    (i) => i.sizes === s && i.type === 'image/png' && (i.purpose || 'any') === purpose);
  assert.ok(bySize('192x192', 'any'), 'no 192px any-purpose PNG');
  assert.ok(bySize('512x512', 'any'), 'no 512px any-purpose PNG');
  assert.ok(bySize('512x512', 'maskable'), 'no maskable icon - circular launchers clip the mark');
  for (const i of m.icons) {
    if (i.type !== 'image/png') continue;
    const p = path.join(ROOT, 'static', i.src);
    assert.ok(fs.existsSync(p), i.src + ' is referenced but not on disk');
    assert.ok(fs.statSync(p).size > 1000, i.src + ' is suspiciously tiny');
  }
});

test('both entry pages carry the install plumbing', () => {
  for (const page of ['dashboard.html', 'login.html']) {
    const s = read(page);
    assert.match(s, /rel="manifest" href="static\/manifest\.webmanifest"/, page);
    assert.match(s, /name="theme-color"/, page);
    assert.match(s, /rel="apple-touch-icon" href="static\/images\/icons-pwa\/apple-touch-icon\.png"/,
      page + ' - iOS needs the PNG tile, not an SVG');
  }
});
