'use strict';

function withParcelCharge(charges, fulfilment, lines) {
  const result = (charges || []).filter((charge) => charge.source !== 'parcel');
  if (!/^(take[ _-]?away|parcel|pick[ _-]?up)$/i.test(String(fulfilment || '').trim()))
    return result;
  const minor = lines.reduce((sum, line) => {
    if (line.cancelled || line.return || /^cancel/i.test(line.status || line.item_status || ''))
      return sum;
    const quantity = Number(line.item_quantity ?? line.quantity);
    const rate = Number(line.parcel_charge);
    return quantity > 0 && rate > 0 ? sum + Math.round(rate * quantity * 100) : sum;
  }, 0);
  if (minor)
    result.push({
      name: 'Parcel Charge',
      source: 'parcel',
      amount: minor / 100,
      taxed: false,
      tax_amount: 0,
      tax_name: '',
    });
  return result;
}

module.exports = { withParcelCharge };
