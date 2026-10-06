'use strict';

const conversation = require('../../../src/services/ask-posnic-conversation');
const assistant = require('../../../src/services/ask-posnic.service');

test.each([
  ['What about yesterday?', 'yesterday'],
  ['And last month', 'last_month'],
  ['This week', 'week'],
  ['How about last year?', 'last_year'],
])('a report follow-up %s preserves the subject and changes the period', (question, period) => {
  expect(conversation.needsContext(question)).toBe(true);
  expect(conversation.resolve(question, { intent: 'profit' })).toEqual({
    intent: 'profit',
    period,
  });
});

test.each([null, { intent: 'sale_checkout_action' }, { intent: 'help' }])(
  'does not infer a report or repeat a write from %p',
  (previous) => {
    const result = conversation.resolve('What about yesterday?', previous);
    expect(result.intent).toBeUndefined();
    expect(result.clarification).toContain('Which report');
  }
);

test.each(['low_stock', 'receivables'])(
  'never falsely applies historical dates to %s',
  (intent) => {
    expect(conversation.resolve('Yesterday', { intent }).clarification).toContain(
      'current position'
    );
  }
);

test('a request to improve a source answer asks for a specific missing detail', () => {
  const response = conversation.resolve('Explain better', { intent: 'help', answer: 'old answer' });
  expect(response.clarification).toContain('Which step is unclear');
  expect(response.clarification).not.toContain('old answer');
});

test('greetings and missing product guidance get different, usable next steps', () => {
  expect(conversation.fallback('hello').answer).toContain('Hello!');
  expect(conversation.fallback('inventory by supplier').suggestions).toContain('Show low stock');
  expect(conversation.fallback('terminal broken', 'unsupported').answer).toContain('screen');
});

test.each([
  ['How much did we sell yesterday?', 'sales'],
  ['How much profit this month?', 'profit'],
  ['How do I create a sale?', 'unknown'],
  ['Delete all sales', 'unknown'],
  ['Can you refund this sale?', 'unknown'],
  ['Create a sale with 2 Coke', 'sale_checkout_action'],
])('routes %s to %s', (question, intent) => {
  expect(assistant.intentFrom(question)).toBe(intent);
});
