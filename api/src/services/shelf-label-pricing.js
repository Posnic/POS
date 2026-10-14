'use strict';
const pricing = require('./pricing-authority');
const Money = require('../utils/currency');

// This is a counter-price display, not a second pricing implementation.
function quote(product, branch) {
  try {
    const result = pricing.menuQuote(product, branch);
    if (result.quote_required) return { label_price: null, label_price_error: 'Set a fixed item price before printing a shelf label.' };
    return { label_price: result.final_price, label_currency_digits: Money.policy(branch).currencyDigits, label_price_error: null };
  } catch (error) {
    return { label_price: null, label_price_error: 'Item pricing needs review before printing.' };
  }
}
module.exports = { quote };
