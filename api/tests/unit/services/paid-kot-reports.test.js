'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Run the real Mongo driver outside Jest's VM so its BSON metadata uses native
// Map instances. Keep the database regressions in the existing API CI suite.
test('paid kitchen bills reconcile across reports against a real database', () => {
  const output = execFileSync(
    process.execPath,
    ['--test', path.join(__dirname, 'paid-kot-reports.integration.cjs')],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 }
  );
  expect(output).toMatch(/pass 7/);
}, 100000);
