const regional = require('../../../src/services/branch-regional');
const { currency } = require('../../../src/json/currency.json');
describe('branch regional creation', () => {
  test('blank tax number is optional in every supported country', () => {
    for (const country of ['India', 'United Kingdom', 'Germany', 'United Arab Emirates'])
      expect(regional({ country, branch_gstin_number: ' ' }).branch_gstin_number).toBe('');
  });
  test('country picks currency without defaulting international branches to INR', () => {
    expect(regional({ country: 'United Kingdom' }).currency_value[0].currency_text).toBe('GBP');
    expect(regional({ country: 'Germany' }).currency_value[0].currency_text).toBe('EUR');
  });
  test('explicit settings survive creation with canonical currency metadata', () => {
    const usd = currency.find((x) => x.text === 'USD');
    const result = regional({
      country: 'United States',
      currency_text: usd.value,
      currency_type: 'USD',
      time_zone: 'America/New_York',
      client_dateformat: 'mm/dd/yyyy',
      printing_address: ' Receipt address ',
      pincode: 'SW1A 1AA',
    });
    expect(result).toMatchObject({
      currency_type: 'USD',
      time_zone: 'America/New_York',
      client_dateformat: 'mm/dd/yyyy',
      server_dateformat: 'm/d/Y',
      printing_address: 'Receipt address',
      pincode: 'SW1A 1AA',
    });
  });
  test('invalid configured values fail before creating a branch', () => {
    expect(() => regional({ country: 'India', branch_gstin_number: 'not-gstin' })).toThrow(/GST/);
    expect(() => regional({ country: 'India', currency_text: 'invented' })).toThrow(/currency/);
    expect(() => regional({ country: 'India', time_zone: 'not-a-zone' })).toThrow(/time zone/);
  });
});
