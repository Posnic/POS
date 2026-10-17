const { stateKey, isInterState, customerState } = require('../../../src/helpers/gst-place');

test.each([
  ['Tamil Nadu', '33', false],
  ['33', ' tamil   nadu ', false],
  ['Tamil Nadu', 'Karnataka', true],
  ['33', '29', true],
  ['33', '', false],
  ['', '29', false],
])('GST state comparison %s / %s is interstate: %s', (supplier, customer, expected) => {
  expect(isInterState(supplier, customer)).toBe(expected);
});

test('walk-in and configured default customers use the branch state', () => {
  const branch = { state: 'Tamil Nadu', default_customer: 'walkin-id' };
  expect(customerState({}, branch)).toBe('Tamil Nadu');
  expect(customerState({ customer_id: 'walkin-id', customer_state: '29' }, branch)).toBe('29');
  expect(customerState({ customer_id: 'named-id' }, branch, { state: '29' })).toBe('29');
  expect(customerState({ customer_id: 'named-id' }, branch)).toBe('Tamil Nadu');
  expect(stateKey(' 33 ')).toBe('33');
});

test('name-only state and delivery override determine place of supply', () => {
  const gst = require('../../../src/helpers/gst-place');
  expect(gst.customerState({ customer_state: 'Karnataka' }, { state: 'Goa' })).toBe('Karnataka');
  expect(
    gst.placeOfSupply({ customer_state: 'Goa', place_of_supply: '29' }, { state: 'Goa' })
  ).toBe('29');
  expect(gst.placeOfSupply({}, { state: 'Goa' })).toBe('Goa');
  expect(() =>
    gst.validate({ customer_state: 'Goa', customer_gst_number: '29ABCDE1234F1Z5' })
  ).toThrow(/do not match/);
  expect(() =>
    gst.validate({
      customer_state: 'Karnataka',
      place_of_supply: 'Goa',
      customer_gst_number: '29ABCDE1234F1Z5',
    })
  ).not.toThrow();
});
