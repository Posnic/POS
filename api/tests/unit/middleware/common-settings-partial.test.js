'use strict';

/*
 * updateCommonSettings accepts PARTIAL payloads.
 *
 * The quotation-defaults card and the signature upload each send a handful
 * of their own keys and nothing else. While the validator demanded
 * default_customer and default_supplier unconditionally, uploading a
 * signature image failed with "Default customer is required" - a question
 * the form never asked and the user could not answer from where they stood.
 *
 * Unlike the sibling suite, this file does NOT mock express-validator: the
 * point is to run the real chains and see what a real request survives.
 */

const { validationResult } = require('express-validator');
const { validateCommonSettings } = require('../../../src/middleware/settings.validation');

const runValidators = async (body) => {
  const req = { body, query: {}, params: {}, cookies: {}, headers: {} };
  for (const chain of validateCommonSettings) {
    await chain.run(req);
  }
  return validationResult(req);
};

const paths = (result) => result.array().map((e) => e.path);

describe('updateCommonSettings validation accepts partial payloads', () => {
  test('a signature-only upload passes', async () => {
    const result = await runValidators({
      quote_default_signature: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(result.isEmpty()).toBe(true);
  });

  test('a quotation-defaults save passes', async () => {
    const result = await runValidators({
      quote_default_payment_method: 'Bank transfer',
      quote_default_bank_details: 'A/C 123',
      quote_default_terms: 'Payment within 15 days',
      quote_default_signature: '',
    });
    expect(result.isEmpty()).toBe(true);
  });

  test('a features/module toggle save passes', async () => {
    const result = await runValidators({ custom_charges_enable: 'true', quotes_enable: 'true' });
    expect(result.isEmpty()).toBe(true);
  });

  test('a full settings form still has both fields checked', async () => {
    const result = await runValidators({
      default_customer: '6a6a538091a0321d0198ff51',
      default_supplier: '6a867545f869a9e82c420d59',
    });
    expect(result.isEmpty()).toBe(true);
  });

  test('sending the keys EMPTY is still refused - absent means keep, blank means wrong', async () => {
    const result = await runValidators({ default_customer: '', default_supplier: '' });
    expect(result.isEmpty()).toBe(false);
    expect(paths(result)).toEqual(expect.arrayContaining(['default_customer', 'default_supplier']));
  });

  test('an over-long value is still refused when sent', async () => {
    const result = await runValidators({ default_customer: 'x'.repeat(500) });
    expect(result.isEmpty()).toBe(false);
    expect(paths(result)).toContain('default_customer');
  });
});
