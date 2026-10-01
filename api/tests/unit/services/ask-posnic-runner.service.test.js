'use strict';
jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
const runner = require('../../../src/services/ask-posnic-runner.service');
const assistant = require('../../../src/services/ask-posnic.service');

test('daily and weekly reports use complete days in the selected timezone', () => {
  const at = new Date('2026-10-01T03:00:00Z');
  const daily = runner.reportRange({ timezone: 'Asia/Kolkata', frequency: 'daily' }, at);
  const weekly = runner.reportRange({ timezone: 'Asia/Kolkata', frequency: 'weekly' }, at);
  expect(daily.starting_date.toISOString()).toBe('2026-09-29T18:30:00.000Z');
  expect(daily.ending_date.toISOString()).toBe('2026-09-30T18:29:59.999Z');
  expect(weekly.starting_date.toISOString()).toBe('2026-09-23T18:30:00.000Z');
});

test('profit comparison uses profit and explains a zero baseline', () => {
  const result = assistant.answerComparison({ profit: { net_profit: 30 }, totals: { sales_amount: 900 } }, { profit: { net_profit: 0 }, totals: { sales_amount: 300 } }, 'profit');
  expect(result.metrics).toEqual([{ label: 'Current profit', value: '30.00' }, { label: 'Previous profit', value: '0.00' }, { label: 'Change', value: 'N/A' }]);
  expect(result.answer).toContain('previous total was zero');
});

test('a loss becoming a smaller loss is an improvement', () => {
  expect(assistant.answerComparison({ profit: { net_profit: -25 } }, { profit: { net_profit: -50 } }, 'profit').answer).toContain('increased 50.0%');
});
