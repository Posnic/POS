'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// These suites exercise native Node workers and Buffers. Keep them outside
// Jest's VM realm, while making failures part of the existing Jest CI gate.
test.each(['extension-archive', 'extension-loader', 'extension-library-storage', 'dojo-client'])(
  '%s passes in the native Node test runner',
  (name) => {
    const result = spawnSync(
      process.execPath,
      ['--test', path.join(__dirname, `${name}.node.cjs`)],
      {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error(`${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    }
  },
  65000
);
