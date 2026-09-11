'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanText } = require('../scripts/check-ai-attribution');

const joined = (...parts) => parts.join('');

test('allows human DCO sign-off', () => {
  assert.equal(scanText('Signed-off-by: Jane Developer <jane@example.com>', 'message').length, 0);
});

test('rejects an AI co-author trailer', () => {
  const line = joined('Co-authored', '-by: Cl', 'aude <assistant@example.com>');
  assert.equal(scanText(line, 'message').length, 1);
});

test('rejects an AI-generated footer', () => {
  const line = joined('Generated with Chat', 'GPT');
  assert.equal(scanText(line, 'message').length, 1);
});

test('rejects contributor metadata naming an AI tool', () => {
  const line = joined('Contributor: GitHub Co', 'pilot');
  assert.equal(scanText(line, 'metadata').length, 1);
});

test('allows ordinary product discussion about AI', () => {
  const line = 'Optional AI assistant settings are disabled by default.';
  assert.equal(scanText(line, 'docs').length, 0);
});
