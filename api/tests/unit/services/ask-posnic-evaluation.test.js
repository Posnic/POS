'use strict';

const evaluation = require('../../fixtures/ask-posnic-evaluation.json');
const assistant = require('../../../src/services/ask-posnic.service');

describe('Ask Posnic release evaluation', () => {
  test('contains the required 100 supported and adversarial questions', () => {
    expect(evaluation).toHaveLength(100);
    expect(
      evaluation.filter((item) => item.expected_intent === 'unknown').length
    ).toBeGreaterThanOrEqual(10);
  });

  test('routes at least 90 percent to the authoritative tool or safe refusal path', () => {
    const correct = evaluation.filter(
      (item) => assistant.intentFrom(item.question) === item.expected_intent
    );
    expect(correct.length / evaluation.length).toBeGreaterThanOrEqual(0.9);
  });
});
