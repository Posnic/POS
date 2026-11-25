'use strict';

const fs = require('fs');
const path = require('path');

function stampRuntimeVersion(root, check = false) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid root product version');
  }
  const target = path.join(root, 'api/product-version.json');
  const content = JSON.stringify({ source: 'root-package', version }, null, 2) + '\n';
  let existing = '';
  try {
    existing = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing === content) return;
  if (check) throw new Error('api/product-version.json is stale; run node scripts/sync-version.js');
  fs.writeFileSync(target, content);
}

if (require.main === module) stampRuntimeVersion(path.resolve(__dirname, '..'), process.argv.includes('--check'));
module.exports = { stampRuntimeVersion };
