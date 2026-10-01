'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('own-key local search and atomic embedding budget', () => {
  try { execFileSync(process.execPath, ['--test', path.join(__dirname, '../../fixtures/ask-posnic-own-key.cjs')], { timeout: 60000, encoding: 'utf8', stdio: 'pipe' }); }
  catch (error) { throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error }); }
}, 65000);
