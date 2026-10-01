'use strict';
const budget = require('../../../src/services/ai-budget');
test('verified Mumbai embedding input rates retain sub-cent charges with no output-token fee', () => {
  const old = process.env.AWS_REGION;
  process.env.AWS_REGION = 'ap-south-1';
  try {
    const model = 'amazon.titan-embed-text-v2:0';
    expect(budget.priceFor(model)).toEqual({ in: 0.024, out: 0 });
    expect(budget.costMicrominor({ model, tokensIn: 1000, tokensOut: 0, rate: 1 })).toBe(2400);
    process.env.AWS_REGION = 'eu-west-1';
    expect(budget.priceFor(model)).toEqual({ in: 5, out: 25 });
  } finally {
    if (old == null) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = old;
  }
});
