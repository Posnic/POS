/*
 * Every module page must be listed in pages_html_map.json.
 *
 * The build inlines ONLY the module HTML files the map names - a page file
 * that exists but is unmapped builds cleanly, deploys cleanly, and serves a
 * BLANK content area at its route. That is not hypothetical: roster.html
 * shipped exactly that way and #/roster was empty in production until the
 * gap was found by accident. This makes the omission a red build instead.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend');

test('every modules/*.html file is referenced by pages_html_map.json', () => {
  const map = fs.readFileSync(path.join(ROOT, 'pages_html_map.json'), 'utf8');
  const missing = fs
    .readdirSync(path.join(ROOT, 'modules'))
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !map.includes('modules/' + f));
  assert.deepStrictEqual(
    missing,
    [],
    'unmapped module pages (their routes would serve blank): ' + missing.join(', ')
  );
});

test('the map names only files that exist - a rename cannot leave a dangling entry', () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages_html_map.json'), 'utf8'));
  const referenced = new Set();
  (function walk(node) {
    if (typeof node === 'string') {
      if (node.startsWith('modules/')) referenced.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  })(map);
  const dangling = [...referenced].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepStrictEqual(dangling, [], 'map entries with no file behind them: ' + dangling.join(', '));
});
