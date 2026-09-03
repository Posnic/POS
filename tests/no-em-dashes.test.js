'use strict';

/*
 * No em dash in anything we write.
 *
 * The owner's rule, in his words: "never use -- this. very annoying it shows is
 * ai text. overall account tell not to use that."
 *
 * That is a judgement about how the product SOUNDS, and it is exactly the kind
 * of rule that decays quietly. Every future alert, badge and placeholder is
 * written by somebody who has not read this file, and one dash slipped into one
 * toast is invisible in review. So it is pinned here, the way the chart ban is.
 *
 * The replacement is the plain hyphen the codebase already uses everywhere
 * else, so nothing about the house voice changes.
 *
 * WHAT IS STILL ALLOWED, deliberately.
 *
 * A dash standing alone between quotes or tags is not prose, it is the
 * conventional glyph for "no value":
 *
 *     '<td>' + esc(r.user_name || '—') + '</td>'
 *
 * There are around thirty of those. They read as typography, not as writing.
 * Banning them too would mean thirty pointless edits and a rule nobody keeps.
 * What is banned is the dash used as PUNCTUATION, joining two halves of a
 * sentence, which is the thing that reads as machine-written.
 *
 * WHAT IS EXEMPT, and why it must stay exempt.
 *
 * Two data files are not our writing. hsn.json carries the Indian government's
 * published goods classification verbatim, and quotes.json carries famous
 * sayings with their standard attribution dash. Editing either would make us
 * misquote a source: in the HSN case, our tax codes would stop matching the
 * schedule they are supposed to match.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const EXEMPT = new Set([
  'api/src/json/hsn.json',
  'frontend/static/json/hsn.json',
  'api/src/json/quotes.json',
  'frontend/static/json/quotes.json',
]);

const DASH = /—|–|&mdash;|&ndash;/;
const PLACEHOLDER_SHAPE = String.raw`(?:['"\`]|>)\s*(?:—|–|&mdash;|&ndash;)\s*(?:['"\`]|<)`;
const ONE_PASS = new RegExp(`${PLACEHOLDER_SHAPE}|—|–|&mdash;|&ndash;`, 'g');

/** A match is the empty-value glyph if it swallowed its quotes or tags. */
const isPlaceholder = (m) => /['"`<>]/.test(m);

function sourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    /* frontend/public is build output, regenerated from these sources. */
    if (entry.name === 'node_modules' || entry.name === 'public') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(js|json|html)$/.test(entry.name)) {
      /* Vendored libraries and minified bundles are not ours to rewrite. */
      if (full.includes('.min.') || full.includes(`${path.sep}plugins${path.sep}`)) continue;
      out.push(full);
    }
  }
  return out;
}

function offences(dir) {
  const found = [];
  for (const file of sourceFiles(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXEMPT.has(rel)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!DASH.test(line)) return;
      const stripped = line.replace(ONE_PASS, (m) => (isPlaceholder(m) ? '' : m));
      if (!DASH.test(stripped)) return;
      found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  return found;
}

test('no em dash anywhere in the frontend', () => {
  const found = offences('frontend');
  assert.deepEqual(found, [],
    `em dash used as punctuation:\n  ${found.join('\n  ')}`);
});

test('no em dash in what the API says back', () => {
  /* Response messages are read by a person too, in a toast. */
  const found = offences(path.join('api', 'src'));
  assert.deepEqual(found, [],
    `em dash used as punctuation in an API message:\n  ${found.join('\n  ')}`);
});

test('the empty-cell glyph is still allowed, so the rule stays keepable', () => {
  /*
   * Guards the guard. If somebody later tightens this to ban every dash, the
   * thirty legitimate placeholder cells start failing, and the usual response
   * to that is to delete the test rather than make thirty pointless edits.
   */
  const cell = "html += '<td>' + esc(r.user_name || '—') + '</td>';";
  const stripped = cell.replace(ONE_PASS, (m) => (isPlaceholder(m) ? '' : m));
  assert.ok(!DASH.test(stripped), 'the placeholder glyph is being read as prose');
});

test('a dash between real words is caught, including the escaped spelling', () => {
  /* The detector itself, since every other test here passes when it is broken. */
  ['Open — your session', 'Open &mdash; your session', 'priced 3–6 only'].forEach((line) => {
    const stripped = line.replace(ONE_PASS, (m) => (isPlaceholder(m) ? '' : m));
    assert.ok(DASH.test(stripped), `not detected: ${line}`);
  });
});

test('the quoted sources stay exempt and stay present', () => {
  /*
   * An exemption for a file that has moved is a dead exemption, and the rule
   * would start rewriting a government schedule without anybody noticing.
   */
  for (const rel of EXEMPT) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)),
      `${rel} moved, so its exemption is now silently dead`);
  }
});
