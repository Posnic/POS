'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('operator recovery, process ownership and scheduled-delivery fencing', () => {
  try { execFileSync(process.execPath, ['--test', path.join(__dirname, '../../fixtures/ask-posnic-recovery.cjs')], { timeout: 60000, encoding: 'utf8', stdio: 'pipe' }); }
  catch (error) { throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`); }
}, 65000);
