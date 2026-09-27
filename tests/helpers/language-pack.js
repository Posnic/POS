'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Starter packs intentionally use English for untranslated labels. Established
// packs must still provide their own translations in feature coverage tests.
module.exports = function languagePack(root, file) {
  const { LANGUAGES } = require(path.join(root, 'frontend/gulpfile.js/config'));
  const language = LANGUAGES.find(entry => entry.code === path.basename(file, '.json'));
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'languages', name), 'utf8'));
  return { ...(language && language.stage === 'starter' ? read('_english.json') : {}), ...read(file) };
};
