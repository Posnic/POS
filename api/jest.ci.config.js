/*
 * The configuration CI runs with.
 *
 * Identical to a normal run except that the suites in jest.known-failures.js
 * are skipped. Everything else still has to pass, so a new break still fails
 * the build - the quarantine covers today's known failures and nothing more.
 */
const known = require('./jest.known-failures');

// Run through the npm test scripts (or Node with --experimental-vm-modules).
// The patched MongoDB driver dynamically imports its runtime adapters. Jest's
// VM needs that flag; otherwise the driver loses its handshake metadata and
// real-database tests fail before reaching the application under test.

module.exports = {
  testEnvironment: 'node',
  // Recycle workers between suites so VM-loaded driver modules cannot exhaust
  // a developer machine or runner during the full database regression run.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
  // Same clock on every machine - see tests/setup-timezone.js.
  setupFiles: ['<rootDir>/tests/setup-timezone.js'],
  // Anchored to the start so a path is matched exactly, not as a substring of
  // some other suite's name.
  testPathIgnorePatterns: ['/node_modules/'].concat(
    known.map((p) => '<rootDir>/' + p.replace(/^\.\//, ''))
  ),
};
