'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'frontend/static/script/js/core/receipt-design-labels.js',
  'frontend/static/script/js/core/receipt-designer.js',
  'frontend/static/script/js/core/kot-print.js',
  'api/src/utils/pdfGenerator.js',
  'api/src/controllers/common-pdf.controller.js',
];
const keys = [...new Set(files.flatMap(file =>
  fs.readFileSync(path.join(root, file), 'utf8').match(/lang_[a-zA-Z0-9_]+/g) || []
))].sort();
const core = require('../api/src/catalogs/wording-core.json');
const locales = {};
for (const locale of core.locales) {
  const file = path.join(root, 'languages', locale === 'en' ? '_english.json' : locale + '.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  locales[locale] = Object.fromEntries(keys.filter(key => core.labels[key]).map(key =>
    [key, typeof pack[key] === 'string' ? pack[key] : core.labels[key]]));
}
const output = path.join(root, 'api/src/catalogs/document-wording.json');
const compiled = JSON.stringify({ schemaVersion: 1, locales }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== compiled)
    throw new Error('Run node scripts/build-document-wording-catalog.js');
} else fs.writeFileSync(output, compiled);
