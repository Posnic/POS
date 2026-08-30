'use strict';

/**
 * A shop in a country whose tax we do not know is created with NO tax.
 *
 * Owner's decision, after the audit found that 128 of the 246 countries in
 * countries.json carry exactly one tax row - {"tax_name":"0% Tax",
 * "tax_value":0} - and the installer inserted it. That is not a researched
 * "this country has no sales tax". It is missing data wearing the costume of
 * an answer, and it gave a shop in Angola a real tax record, a tax column on
 * its receipts, and the clear implication that Posnic knows the Angolan
 * regime. It does not.
 *
 * "Tax not configured for your country yet - switch it on in Settings when
 * you're ready" is honest. A fake 0% rate is not.
 *
 * These run against the REAL countries.json, because the thing being asserted
 * is that the data and the installer agree. A fixture would only prove that
 * two of my own inventions match.
 */

const InstallService = require('../../../src/services/install.service');

/* Enough of the repository to watch what the installer tries to write. */
function fakeRepo() {
  const taxes = [];
  return {
    taxes,
    insertTax: jest.fn(async (doc) => {
      taxes.push(doc);
      return 'tax-' + taxes.length;
    }),
  };
}

const args = (country) => [
  {
    register_country: country,
    register_companyname: 'Demo Shop',
    register_username: 'admin',
  },
  'branch-1',
  'user-1',
  'license-1',
  new Date('2026-08-30T00:00:00Z'),
];

describe('installing a shop where tax is not known', () => {
  let service;
  beforeEach(() => {
    service = new InstallService();
    service.repository = fakeRepo();
  });

  it('creates no tax records at all for an unverified country', async () => {
    const { taxId, taxData } = await service._createTaxes(...args('Angola'));
    expect(service.repository.insertTax).not.toHaveBeenCalled();
    expect(service.repository.taxes).toHaveLength(0);
    expect(taxId).toBeNull();
    expect(taxData).toBeNull();
  });

  it('never writes a rate of zero as though it were a rate', async () => {
    /* The specific shape being removed. If this ever passes again with a row
       present, the placeholder is back. */
    for (const country of ['Afghanistan', 'Algeria', 'Anguilla', 'Angola']) {
      service.repository = fakeRepo();
      await service._createTaxes(...args(country));
      expect(service.repository.taxes.map((t) => t.rate)).toEqual([]);
    }
  });

  it('still reports the country code, which the rest of the install needs', async () => {
    /* sortname feeds the tax profile, the address format and the currency.
       Returning nothing because there was no tax would break all three. */
    const { sortname } = await service._createTaxes(...args('Angola'));
    expect(sortname).toBe('AO');
  });

  it('says which decision it made, so a support question has an answer', async () => {
    const { taxSource } = await service._createTaxes(...args('Angola'));
    expect(taxSource).toBe('unverified');
  });
});

describe('installing a shop where tax IS known', () => {
  let service;
  beforeEach(() => {
    service = new InstallService();
    service.repository = fakeRepo();
  });

  it('India is created with exactly the rows it was created with before', async () => {
    /*
     * The acceptance criterion: India's install behaviour is unchanged. Its
     * seven rows include a 0% band, and that one is REAL - a zero-rated band
     * beside six live slabs, which a shop selling exempt goods has to be able
     * to pick.
     *
     * An earlier version of this change filtered zero rows wherever it found
     * them and quietly took India from seven tax records to six. Nothing would
     * have failed except somebody's return.
     */
    const fs = require('fs');
    const path = require('path');
    const countries = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../src/json/countries.json'), 'utf8'));
    const india = (countries.countries || countries).find((c) => c.value === 'India');

    const { taxId, taxData, taxSource } = await service._createTaxes(...args('India'));

    expect(service.repository.taxes).toHaveLength(india.tax.length);
    expect(service.repository.taxes.map((t) => t.name)).toEqual(india.tax.map((t) => t.tax_name));
    expect(service.repository.taxes.map((t) => t.rate))
      .toEqual(india.tax.map((t) => parseFloat(t.tax_value)));
    expect(taxId).toBeTruthy();
    expect(taxData).toBeTruthy();
    expect(taxSource).toBe('legacy');
  });

  it('a country with real rates keeps every one of them', async () => {
    await service._createTaxes(...args('United Kingdom'));
    expect(service.repository.taxes.length).toBeGreaterThan(0);
    expect(service.repository.taxes.some((t) => t.rate > 0)).toBe(true);
  });

  it('each record still carries the fields the rest of the app reads', async () => {
    await service._createTaxes(...args('India'));
    const first = service.repository.taxes[0];
    for (const k of ['branch_id', 'branch_name', 'name', 'rate', 'tax_fields', 'tax_group', 'license']) {
      expect(first).toHaveProperty(k);
    }
    expect(Array.isArray(first.tax_fields)).toBe(true);
    expect(first.tax_fields[0]).toHaveProperty('tax_name');
    expect(first.tax_fields[0]).toHaveProperty('tax_value');
  });
});

describe('the shop that gets no tax is left switched off, not half-configured', () => {
  it('the install defaults start with tax off and no default rate', () => {
    /*
     * A null taxId has to degrade all the way through. These two defaults are
     * what make that safe, and _updateBranchDefaults writes
     * `default_tax: taxId || ''` on top - so a shop with no tax ends with tax
     * switched off rather than switched on and pointing at nothing.
     */
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/services/install.service.js'), 'utf8');
    expect(src).toMatch(/tax_checkbox:\s*false/);
    expect(src).toMatch(/default_tax:\s*taxId \|\| ''/);
    /* And every item mapping guards on it, or a shop with no tax would build
       items pointing at a tax id that does not exist. */
    expect(src).toMatch(/tax_fields:\s*taxId\s*\n?\s*\?/);
    expect(src).toMatch(/tax_name:\s*taxData \? taxData\.name : ''/);
  });
});
