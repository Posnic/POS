'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { fonts } = require('./fonts/manifest.json');

// The ranges are each unmodified font's Unicode cmap. Select from the actual
// receipt, not the UI language: a shop can sell items in several scripts.
function covers(font, point) {
  let left = 0, right = font.ranges.length - 1;
  while (left <= right) {
    const middle = (left + right) >> 1;
    const [first, last] = font.ranges[middle];
    if (point < first) right = middle - 1;
    else if (point > last) left = middle + 1;
    else return true;
  }
  return false;
}

function fontsFor(text) {
  const selected = new Set([fonts[0]]);
  for (const character of new Set(String(text))) {
    const point = character.codePointAt(0);
    if (point < 128) continue;
    const font = fonts.find(candidate => covers(candidate, point));
    if (font) selected.add(font);
  }
  return [...selected];
}

function family(font) { return 'Posnic' + font.family; }

function cssFor(selected) {
  return selected.map(font => {
    const url = pathToFileURL(path.join(__dirname, 'fonts', font.file)).href;
    return `@font-face{font-family:${family(font)};src:url("${url}") format('truetype');font-weight:100 900;}`;
  }).join('\n');
}

module.exports = { fonts, covers, fontsFor, family, cssFor };
