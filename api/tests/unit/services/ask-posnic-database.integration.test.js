'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Exercise the native Mongo driver outside Jest's VM (BSON uses Map identity).
test('Ask Posnic database boundaries, concurrent credits, actions and schedules', () => {
  try {
    execFileSync(
      process.execPath,
      ['--test', path.join(__dirname, '../../fixtures/ask-posnic-database.cjs')],
      { timeout: 60000, encoding: 'utf8', stdio: 'pipe' }
    );
  } catch (error) {
    throw new Error(`${error.stdout || ''}\n${error.stderr || error.message}`, { cause: error });
  }
}, 65000);
