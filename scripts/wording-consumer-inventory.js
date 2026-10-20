'use strict';
// Static inventory: references prove registration, not that a renderer or
// physical printer was exercised. Exact source-text candidates require review.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = require('../api/src/catalogs/wording-core.json').labels;
const keys = new Set(Object.keys(catalog));
const output = { schemaVersion: 1, registeredLabels: keys.size, consumers: [], exclusions: [
  'Vendor libraries and generated bundles',
  'Business data: names, products, notes and addresses',
  'Machine CSV/API field names and canonical order types',
  'Static references are not proof of live device or physical print coverage'
] };
function walk(dir, app) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|vendor|dist|build|build-output|locales|languages|catalogs|test-results|tests|scripts|artifacts|output|android|ios|\.git|\.expo)$/.test(entry.name)) continue;
    if (/\.min\.js$|^jspdf(?:[.-]|$)/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file, app); continue; }
    if (!/\.(?:html|js|cjs|ts|tsx)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const references = [...new Set((text.match(/\blang_[a-zA-Z0-9_]+\b/g) || []).filter(k => keys.has(k)))].sort();
    const relative = path.relative(app.root, file).replace(/\\/g, '/');
    const kind = /kot|kitchen/i.test(relative) ? 'kot' : /receipt/i.test(relative) ? 'receipt' : /pdf/i.test(relative) ? 'pdf' : /export/i.test(relative) ? 'export' : /report/i.test(relative) ? 'report' : 'screen';
    if (references.length || /receipt|pdf|report|export|kot.print/i.test(relative))
      output.consumers.push({ app: app.name, file: relative, kind, registeredKeys: references, review: references.length ? 'registered references; render verification required' : 'no static registered key; inspect indirect resolution and hardcoded labels' });
  }
}
walk(path.join(root, 'frontend/static'), { name: 'POS', root });
walk(path.join(root, 'api/src'), { name: 'POS API', root });
walk(path.join(root, 'src'), { name: 'Desktop', root });
for (const [env, name] of [['WORDING_CAPTAIN_ROOT', 'Captain'], ['WORDING_MOBILE_ROOT', 'Mobile POS'], ['WORDING_BUSINESS_ROOT', 'Business']]) {
  if (process.env[env]) walk(process.env[env], { name, root: process.env[env] });
  else output.exclusions.push(name + ': checkout not supplied to inventory');
}
const target = path.join(root, 'docs/wording-consumers.json');
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(`${output.registeredLabels} registered labels; ${output.consumers.length} consumer files inventoried.`);
