'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('scheduled report SMTP acceptance and rejection use a real loopback transport', () => {
  try { execFileSync(process.execPath, ['--test', path.join(__dirname, '../../fixtures/ask-posnic-smtp.cjs')], { timeout: 20000, encoding: 'utf8', stdio: 'pipe' }); }
  catch (error) { throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error }); }
}, 25000);
