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
 *
 * RUN THIS AFTER COMMITTING, NOT BEFORE.
 *
 * The source is under api/, which the pre-commit hook prettier-formats. The
 * destination is under frontend/static/script/, which .prettierignore
 * deliberately excludes - prettier has never formatted that tree and would
 * rewrite it wholesale. So a copy taken before the hook runs is a copy of the
 * UNFORMATTED source, and the hook then reformats one side of a pair that is
 * supposed to be identical. That is not hypothetical: it happened on the
 * first commit of this file, and the drift test caught it.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const FROM = path.join(ROOT, 'api', 'src', 'utils', 'dish-facts.js');
const TO = path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'dish-facts.js');

const source = fs.readFileSync(FROM);
/*
 * Read it, rather than ask whether it is there and then read it.
 *
 * existsSync followed by readFileSync is two questions about one file with a
 * gap in between, and the answer to the first can be stale by the time the
 * second runs. CodeQL calls it js/file-system-race and it is right to: the
 * gap is small here and the script is a development tool, so nothing bad was
 * ever going to happen - but the version without the gap is also the shorter
 * one, and "not absent" is the only thing the check was ever asking.
 */
let already = null;
try {
  already = fs.readFileSync(TO);
} catch (e) {
  /* Anything other than "it is not there yet" is a real problem and is not
     this script's to swallow: an unreadable destination must not look like a
     missing one and quietly become a write. */
  if (e.code !== 'ENOENT') throw e;
}

if (already && already.equals(source)) {
  console.log('dish-facts.js: already identical');
  process.exit(0);
}

fs.writeFileSync(TO, source);
console.log(`dish-facts.js: copied ${source.length} bytes to ${path.relative(ROOT, TO)}`);
