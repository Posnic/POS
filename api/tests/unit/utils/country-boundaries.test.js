'use strict';
const country = require('../../../src/utils/branch-country');
const profiles = require('../../../src/services/tax-profiles');
const design = require('../../../src/helpers/receipt-design');
const { defaults } = require('../../../src/services/payment-methods');
const { taxRows, itemLines } = require('../../../src/helpers/bill-payload');
const { countries } = require('../../../src/json/countries.json');

test.each(['Hong Kong', 'HK', 'United Kingdom', 'GB'])(
  'current %s country takes precedence over old Indian metadata',
  (value) => {
    const branch = {
      country: value,
      sortname: 'IN',
      country_id: countries.find((c) => c.sortname === 'IN').id,
    };
    expect(country(branch)).toBe(['Hong Kong', 'HK'].includes(value) ? 'HK' : 'GB');
    expect(defaults(branch)).toEqual(['Cash', 'Card']);
    expect(profiles.profileForBranch(branch).code).toBe(
      ['Hong Kong', 'HK'].includes(value) ? '_default' : 'GB'
    );
  }
);
test('unknown explicit countries stay generic; absent country can use legacy metadata', () => {
  expect(country({ country: 'unknown', sortname: 'IN' })).toBe('');
  expect(profiles.profileForBranch({ country: 'unknown', sortname: 'IN' }).code).toBe('_default');
  expect(country({ sortname: 'GB' })).toBe('GB');
  expect(country({ country_id: countries.find((c) => c.sortname === 'GB').id })).toBe('GB');
  expect(
    profiles.profileForBranch({ country: 'United Kingdom', tax_profile_override: 'AU' }).code
  ).toBe('AU');
});
test('receipt labels match every configured country profile by code and name', () => {
  for (const [code, profile] of Object.entries(profiles.allProfiles())) {
    if (code === '_default') continue;
    const name = countries.find((c) => c.sortname === code).value;
    for (const value of [code, name]) {
      expect(design.taxLabel({ country: value })).toBe(profile.label);
      expect(design.taxRegistrationLabel({ country: value })).toBe(profile.registration.label);
    }
  }
});
test.each([
  ['United Kingdom', 'VAT'],
  ['Australia', 'GST'],
  ['United Arab Emirates', 'VAT'],
  ['Hong Kong', 'Tax'],
])('%s does not synthesize Indian GST splits from a stale flag', (value, label) => {
  expect(taxRows({ tax: 10, items: [] }, { country: value, indian_gst: 'gst_on' })).toEqual([
    { label, amount: 10 },
  ]);
});
test('saved tax components survive for historical reprints even after country changes', () => {
  expect(
    taxRows(
      { items: [{ item_quantity: 1, tax_components: [{ name: 'IGST', amount: 10 }] }] },
      { country: 'United Kingdom' }
    )
  ).toEqual([{ label: 'IGST', amount: 10 }]);
});
test('foreign receipt layouts cannot expose HSN through a copied enabled flag', () => {
  const sale = {
    items: [{ item_name: 'Tea', item_quantity: 1, item_base_price: 10, hsncode: '0902' }],
  };
  for (const value of ['United Kingdom', 'Hong Kong', 'Australia', 'United Arab Emirates']) {
    expect(design.fieldAvailable('hsn', { country: value })).toBe(false);
    expect(itemLines(sale, { country: value, bill_print_hsn: true })[0].hsn).toBe('');
  }
  expect(itemLines(sale, { country: 'India', bill_print_hsn: true })[0].hsn).toBe('0902');
});

test.each(['Hong Kong', 'United Kingdom', '', undefined])(
  'UPI receiving accounts stay unavailable for %s without deleting saved data',
  (value) => {
    const branch = {
      country: value,
      branch_upi_id: 'saved@bank',
      branch_upi_name: 'Saved',
      payment_settings: {
        upiAccounts: [{ id: 'one', name: 'Saved', vpa: 'saved@bank' }],
        defaultUpiAccountId: 'one',
      },
    };
    const payments = require('../../../src/services/branch-payments');
    expect(payments.read(branch)).toEqual({
      upiAvailable: false,
      upiAccounts: [],
      defaultUpiAccountId: '',
    });
    expect(require('../../../src/utils/branch-upi').payee(branch)).toBeNull();
    expect(require('../../../src/services/mobile-pos').settings(branch).upiAccounts).toEqual([]);
    expect(() => payments.validate({ upiAccounts: [], defaultUpiAccountId: '' }, branch)).toThrow(
      /Indian branches/
    );
    expect(branch.payment_settings.upiAccounts).toHaveLength(1);
  }
);
test('India keeps its explicit UPI receiving accounts', () => {
  const branch = {
    country: 'India',
    branch_upi_id: 'saved@bank',
    branch_upi_name: 'Saved',
    payment_settings: {
      upiAccounts: [{ id: 'one', name: 'Saved', vpa: 'saved@bank' }],
      defaultUpiAccountId: 'one',
    },
  };
  expect(require('../../../src/services/branch-payments').read(branch).upiAvailable).toBe(true);
  expect(require('../../../src/utils/branch-upi').payee(branch)).toEqual({
    id: 'saved@bank',
    name: 'Saved',
  });
});

test('stored UPI rows are dormant outside acceptance markets without mutating preferences', () => {
  const { enabled } = require('../../../src/services/payment-methods');
  const rows = [{ payment_field: 'Cash' }, { payment_field: 'Card' }, { payment_field: 'UPI' }];
  expect(enabled(rows, { country: 'Hong Kong' })).toEqual(['Cash', 'Card']);
  expect(enabled(rows, { country: 'India' })).toEqual(['Cash', 'Card', 'Upi']);
  expect(rows).toHaveLength(3);
});
test('desktop payment list applies country availability using the scoped branch', async () => {
  const Model = require('../../../src/models/setting.model');
  const rows = ['Cash', 'Card', 'UPI'].map((payment_value) => ({
    _id: { payment_id: payment_value, payment_value, enabled: true },
  }));
  let branchCountry = 'Hong Kong';
  const findOne = jest.fn(async () => ({ country: branchCountry }));
  const ctx = {
    branchId: 'branch',
    licenseId: 'license',
    paymentCollection: 'payment_method',
    normalizeId: (x) => x,
    getCollection: async (name) =>
      name === 'payment_method'
        ? { aggregate: () => ({ toArray: async () => rows }) }
        : { findOne },
  };
  expect(
    (await Model.prototype.getPaymentAllModel.call(ctx)).data.map((r) => r.payment_value)
  ).toEqual(['Cash', 'Card']);
  expect(findOne).toHaveBeenCalledWith({ _id: 'branch', license: 'license' });
  branchCountry = 'India';
  expect(
    (await Model.prototype.getPaymentAllModel.call(ctx)).data.map((r) => r.payment_value)
  ).toEqual(['Cash', 'Card', 'UPI']);
});
