'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Use the real Mongo driver outside Jest's VM, like the other DB fixtures.
test('variant creation, legacy recovery, tenant isolation and audit persistence', () => {
  try {
    execFileSync(
      process.execPath,
      ['--test', path.join(__dirname, '../../fixtures/variant-roundtrip.cjs')],
      {
        timeout: 60000,
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );
  } catch (error) {
    throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error });
  }
}, 65000);
