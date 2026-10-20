'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'languages');
const output = path.join(root, 'api/src/catalogs/wording-core.json');
const core = JSON.parse(fs.readFileSync(path.join(directory, '_english.json'), 'utf8'));
const locales = ['en', ...fs.readdirSync(directory).filter(x => /^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?\.json$/.test(x)).map(x => x.slice(0, -5))];
const compiled = JSON.stringify({ schemaVersion: 1, locales: [...new Set(locales)].sort(), labels: core }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== compiled) throw new Error('Run node scripts/build-wording-catalog.js before releasing changed language catalogs.');
} else { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, compiled); }
