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

test('reviewed public error translations do not hide credentials or other paths', () => {
  const { isReviewedTranslation } = require('../scripts/scan-git-history');
  for (const [code, key] of [['ja', 'An error occurred while verifying the token'], ['th', 'An error occurred while verifying the token'], ['zh-CN', 'You tried to sign in too many times with an incorrect account or password'], ['zh-TW', 'You tried to sign in too many times with an incorrect account or password']]) {
    const value = require(`../languages/server/${code}.json`)[key];
    const paths = [`languages/server/${code}.json`];
    assert.equal(isReviewedTranslation('secret-shaped assignment', value, paths), true);
    assert.equal(isReviewedTranslation('secret-shaped assignment', value + 'changed', paths), false);
    assert.equal(isReviewedTranslation('secret-shaped assignment', value, ['api/src/auth.js']), false);
    assert.equal(isReviewedTranslation('secret-shaped assignment', value, []), false);
    for (const rule of ['private key block', 'GitHub token', 'AWS access key id', 'connection string with credentials'])
      assert.equal(isReviewedTranslation(rule, value, paths), false);
  }
});
