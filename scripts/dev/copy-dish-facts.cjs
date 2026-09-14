#!/usr/bin/env node
'use strict';
/*
 * One set of nutrition thresholds, two runtimes.
 *
 * api/src/utils/dish-facts.js decides which health claims a dish has earned.
 * The server runs it on every menu read. The desktop item screen runs it on
 * every keystroke, so a cook typing a protein figure sees the badge appear -
 * which is the whole way the rule is taught, and cannot be a round trip.
 *
 * A second implementation in the frontend would be the ordinary way to do
 * that, and it is the wrong way: two sets of thresholds that agree on the day
 * they are written and disagree after the first edit. The disagreement shows
 * up as a badge a shop was shown on the item screen and a customer never sees
 * on the menu, which is unfalsifiable from either end.
 *
 * So the file is copied, byte for byte, the way the ordering pages carry
 * their translation dictionary. tests/dish-facts-copy-matches.test.js fails
 * if the two drift, and names this script.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const FROM = path.join(ROOT, 'api', 'src', 'utils', 'dish-facts.js');
const TO = path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'dish-facts.js');

const source = fs.readFileSync(FROM);
const already = fs.existsSync(TO) ? fs.readFileSync(TO) : null;

if (already && already.equals(source)) {
  console.log('dish-facts.js: already identical');
  process.exit(0);
}

fs.writeFileSync(TO, source);
console.log(`dish-facts.js: copied ${source.length} bytes to ${path.relative(ROOT, TO)}`);
