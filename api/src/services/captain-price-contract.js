'use strict';

const pricing = require('./pricing-authority');
// Staff may hold an offline/stale menu or an older tax-inclusive quote. Fixed
// prices are resolved from the server, rather than blocking the kitchen on a
// client assertion. Only explicit variable-price items need an entered price.
// staffOrder is supplied by authenticated admission, never by sale JSON.
function submittedPrice({ item, product, branch, staffOrder }) {
  const submitted = item.unit_price ?? item.item_price ?? item.price;
  return staffOrder === true && !pricing.isVariable(product, branch) ? undefined : submitted;
}

module.exports = { submittedPrice };
