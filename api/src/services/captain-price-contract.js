'use strict';

const pricing = require('./pricing-authority');
const Money = require('../utils/currency');

// Released Captain 1.3.31/32 new-order payloads use menu.final_price.
// Only this authenticated, versioned contract gets translated. Catalogue
// prices, tax configuration and all other callers remain authoritative.
function submittedPrice({ item, product, branch, venue, extras, client, staffOrder }) {
  const submitted = item.unit_price ?? item.item_price ?? item.price;
  const legacy =
    staffOrder === true &&
    client?.app === 'captain' &&
    /^1\.3\.(31|32)(?: \([a-f0-9]+\))?$/.test(String(client.app_version || '')) &&
    item.price_basis === undefined;
  if (!legacy || pricing.isVariable(product, branch)) return submitted;

  const quote = pricing.menuQuote(product, branch, venue);
  const monetary = Money.policy(branch);
  const round = (value) => Money.fromMinor(Money.toMinor(value, monetary), monetary);
  pricing.assertPrice(submitted, quote.final_price, round, product.name || 'Item');
  // Modifiers come from the server's validated modifier catalogue. The legacy
  // payload quoted the menu dish, without adding those deltas to final_price.
  return pricing.resolve({ product, branch, venue, extras }).selling_price;
}

module.exports = { submittedPrice };
