'use strict';
// Explicit replacement belongs to the reviewed price-update workflow. Older
// catalogue editors must not silently remove the warning attached to a price.
const message =
  'Selling price is being kept for a set period. Use Edit prices to review and confirm replacing it.';
function active(item, value, now = new Date()) {
  return (
    value !== undefined &&
    Number(value) !== Number(item?.selling_price) &&
    new Date(item?.selling_price_hold_until) > now
  );
}
function writable(value, now = new Date()) {
  return {
    $or: [
      { selling_price_hold_until: null },
      { selling_price_hold_until: { $lte: now } },
      { selling_price: value },
    ],
  };
}
module.exports = { active, writable, message };
