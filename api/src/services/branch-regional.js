const { countries } = require('../json/countries.json');
const { currency } = require('../json/currency.json');
const currencyByCountry = require('../json/country_currency.json');
const taxProfiles = require('./tax-profiles');

// Whitelist regional fields; derived labels and symbols always come from reference data.
module.exports = function branchRegional(data) {
  const code = require('../utils/branch-country')({ country: data.country });
  const country = countries.find((item) => item.sortname === code);
  const selected = data.currency_text
    ? currency.find((item) => item.value === data.currency_text)
    : currency.find((item) => item.text === currencyByCountry[country?.sortname]);
  if (data.currency_text && !selected) throw new Error('Choose a valid currency');
  const unit = selected || (code === 'IN' ? currency.find((item) => item.text === 'INR') : null);
  if (!unit) throw new Error('Choose a valid currency');
  const timezone = data.time_zone || (country?.sortname === 'IN' ? 'Asia/Kolkata' : 'UTC');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch (cause) {
    throw new Error('Choose a valid time zone', { cause });
  }
  const formats = {
    'dd/mm/yyyy': 'd/m/Y',
    'yyyy/mm/dd': 'Y/m/d',
    'mm/dd/yyyy': 'm/d/Y',
    'D mm/dd': 'D m/d',
    'MM dd yyyy': 'M d y',
    'd MM yy': 'd M y',
    'D d MM yy': 'D d M y',
  };
  const date = data.client_dateformat || 'dd/mm/yyyy';
  if (!formats[date]) throw new Error('Choose a valid date format');
  const tax = typeof data.branch_gstin_number === 'string' ? data.branch_gstin_number.trim() : '';
  const { profile } = taxProfiles.profileForBranch({ sortname: country?.sortname });
  if (tax.length > 100 || (tax && !taxProfiles.registrationValid(profile, tax))) {
    throw new Error('Enter a valid ' + profile.registration.label);
  }
  return {
    currency: unit.symbol,
    currency_text: unit.value,
    currency_type: data.currency_type === unit.text ? unit.text : unit.symbol,
    currency_value: [{ currency_text: unit.text, currency_sign: unit.symbol }],
    time_zone: timezone,
    client_dateformat: date,
    server_dateformat: formats[date],
    dateformat_text: date,
    branch_gstin_number: tax,
    printing_address: (data.printing_address || data.address || '').trim().slice(0, 500),
    website: typeof data.website === 'string' ? data.website.trim().slice(0, 50) : '',
    pincode: typeof data.pincode === 'string' ? data.pincode.trim().slice(0, 15) : '',
  };
};
