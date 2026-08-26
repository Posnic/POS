'use strict';

/**
 * The shop's money and calendar follow its country.
 *
 * Owner, after foreign signups all opened priced in ₹: "we need to auto
 * fill country from where they sign up and auto choose currency ...
 * including tax also configure as per their country choice."
 *
 * These tests run against the REAL reference files (countries.json,
 * currency.json, country_currency.json) - the point is that the data and
 * the resolver agree, not that mocks agree with mocks. The audit that
 * prompted the ISO-code path found 73 of 246 countries falling through
 * name-prefix matching to the INR fallback; the countries below are the
 * regression pins for that class of bug.
 */

const InstallService = require('../../../src/services/install.service');

describe('install localization', () => {
  let service;
  beforeEach(() => {
    service = new InstallService();
  });

  describe('_currencyForCountry (ISO-code path)', () => {
    it('resolves the United Arab Emirates to AED - the audit bug', () => {
      const m = service._currencyForCountry('United Arab Emirates');
      expect(m.currency_value[0].currency_text).toBe('AED');
      expect(m.currency).toBe('د.إ');
    });

    it('resolves the United States to USD', () => {
      const m = service._currencyForCountry('United States');
      expect(m.currency_value[0].currency_text).toBe('USD');
      expect(m.currency).toBe('$');
    });

    it('resolves Kenya to KES - a currency that was missing entirely', () => {
      const m = service._currencyForCountry('Kenya');
      expect(m.currency_value[0].currency_text).toBe('KES');
    });

    it('keeps India on INR', () => {
      const m = service._currencyForCountry('India');
      expect(m.currency_value[0].currency_text).toBe('INR');
      expect(m.currency).toBe('₹');
    });

    it('keeps the INR fallback for an unknown country', () => {
      const m = service._currencyForCountry('Atlantis');
      expect(m.currency_value[0].currency_text).toBe('INR');
    });

    it('lets an explicit register_currency win over the country', () => {
      const m = service._currencyForCountry('India', 'USD');
      expect(m.currency_value[0].currency_text).toBe('USD');
      expect(m.currency).toBe('$');
    });

    it('ignores an explicit code the currency list does not know', () => {
      const m = service._currencyForCountry('Germany', 'XXX');
      expect(m.currency_value[0].currency_text).toBe('EUR');
    });

    it('every country in the ISO table resolves to a symbol, none fall to INR', () => {
      const fs = require('fs');
      const path = require('path');
      const countries = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../../src/json/countries.json'), 'utf8')
      ).countries;
      const wrong = countries.filter((c) => {
        const m = service._currencyForCountry(c.value);
        return m.currency_value[0].currency_text === 'INR' && c.sortname !== 'IN';
      });
      expect(wrong.map((c) => c.value)).toEqual([]);
    });
  });

  describe('_dateFormatForCountry', () => {
    it('United States reads month-first', () => {
      expect(service._dateFormatForCountry('United States').client).toBe('mm/dd/yyyy');
    });

    it('India reads day-first', () => {
      expect(service._dateFormatForCountry('India').client).toBe('dd/mm/yyyy');
    });

    it('an unknown country stays day-first', () => {
      expect(service._dateFormatForCountry('Atlantis').client).toBe('dd/mm/yyyy');
    });

    it('an explicit register_dateformat wins over the country', () => {
      expect(service._dateFormatForCountry('India', 'mdy').client).toBe('mm/dd/yyyy');
      expect(service._dateFormatForCountry('United States', 'dmy').client).toBe('dd/mm/yyyy');
    });
  });
});
