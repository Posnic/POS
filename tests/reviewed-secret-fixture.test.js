'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isReviewedFixture } = require('../scripts/scan-git-history');
const fixture = ['api/scripts/ask-posnic-ui-check.js'];
test('reviewed mocked UI token is classified only at its exact path and literal', () => {
  assert.equal(isReviewedFixture('secret-shaped assignment', 'synthetic-only', fixture), true);
  assert.equal(isReviewedFixture('secret-shaped assignment', 'different-credential', fixture), false);
  assert.equal(isReviewedFixture('secret-shaped assignment', 'synthetic-only', ['api/src/auth.js']), false);
  assert.equal(isReviewedFixture('secret-shaped assignment', 'synthetic-only', []), false);
});
test('reviewed fixture cannot downgrade high-signal credential rules', () => {
  for (const rule of ['private key block', 'GitHub token', 'AWS access key id', 'connection string with credentials'])
    assert.equal(isReviewedFixture(rule, 'synthetic-only', fixture), false);
});
