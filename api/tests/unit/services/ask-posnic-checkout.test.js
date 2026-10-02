'use strict';

const { linesFromQuestion } = require('../../../src/services/ask-posnic-sale-request');
const { intentFrom } = require('../../../src/services/ask-posnic.service');
const { catalog } = require('../../../src/services/ask-posnic-feature-catalog');

describe('natural language sale requests', () => {
  test.each([
    ['Create one sale with 1 coke and 3 biryani', '1 x coke\n3 x biryani'],
    ['please make a sale with 0.5 x Rice, 2 x Tea and print receipt', '0.5 x Rice\n2 x Tea'],
    ['sell 1 Salt and Pepper and 2 Coke', '1 x Salt and Pepper\n2 x Coke'],
  ])('%s extracts quantities without inventing products', (question, expected) => {
    expect(intentFrom(question)).toBe('sale_checkout_action');
    expect(linesFromQuestion(question)).toBe(expected);
  });
  test.each([
    'create a sale',
    'create a sale with Coke',
    'sell 0 Coke',
    'sell -2 Coke',
    'sell 2 Coke and print; delete customers',
  ])('asks for structured input for %s', (question) => {
    const lines = linesFromQuestion(question);
    // Unrecognized trailing instructions remain an exact catalog lookup,
    // never executable instructions or a separate action.
    if (question.includes('delete')) expect(lines).toContain('delete customers');
    else expect(lines).toBeNull();
  });
  test('a quotation and a how-to question do not start checkout', () => {
    expect(intentFrom('Create a sales draft')).toBe('sale_draft_action');
    expect(intentFrom('How do I create a sale?')).toBe('unknown');
    expect(intentFrom('Create a sale report')).not.toBe('sale_checkout_action');
  });
  test('feature inventory does not advertise disabled actions as available', () => {
    const rows = catalog(
      { allowed_actions: ['sale_checkout'] },
      {},
      () => false,
      () => true
    );
    expect(rows.find((row) => row.name === 'Sales & receipts').enabled).toBe(false);
    expect(rows.find((row) => row.name === 'Employees').mode).toBe('module');
    expect(rows.length).toBeGreaterThan(40);
  });
});
