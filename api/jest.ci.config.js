/*
 * The configuration CI runs with.
 *
 * Identical to a normal run except that the suites in jest.known-failures.js
 * are skipped. Everything else still has to pass, so a new break still fails
 * the build - the quarantine covers today's known failures and nothing more.
 */
const known = require('./jest.known-failures');

module.exports = {
  testEnvironment: 'node',
  // Same clock on every machine - see tests/setup-timezone.js.
  setupFiles: ['<rootDir>/tests/setup-timezone.js'],
  // Anchored to the start so a path is matched exactly, not as a substring of
  // some other suite's name.
  testPathIgnorePatterns: ['/node_modules/'].concat(
    known.map((p) => '<rootDir>/' + p.replace(/^\.\//, '')),
  ),
};
