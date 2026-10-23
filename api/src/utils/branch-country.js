'use strict';
const { countries } = require('../json/countries.json');
const aliases = {
  'hong kong': 'HK',
  uk: 'GB',
  gbr: 'GB',
  ind: 'IN',
  usa: 'US',
  aus: 'AU',
  zaf: 'ZA',
};
module.exports = function branchCountryCode(branch = {}) {
  const input = String(branch.country || '')
    .trim()
    .toLowerCase();
  if (input) {
    const code = aliases[input] || input.toUpperCase();
    return (
      countries.find((c) => c.sortname === code || c.value.toLowerCase() === input)?.sortname || ''
    );
  }
  const iso = String(branch.sortname || '')
    .trim()
    .toUpperCase();
  return (
    countries.find((c) => c.sortname === iso)?.sortname ||
    countries.find((c) => String(c.id) === String(branch.country_id))?.sortname ||
    ''
  );
};
