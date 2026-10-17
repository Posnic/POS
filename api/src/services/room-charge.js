'use strict';
const { ObjectId } = require('mongodb');
const { BadRequestError } = require('../utils/appError');
const Money = require('../utils/currency');
function recalculate(charge, basis, branch) {
  const policy = Money.policy(branch || {});
  const round = (n) => Money.fromMinor(Money.toMinor(n, policy), policy);
  const amount = round((Math.max(0, Number(basis) || 0) * charge.percent) / 100);
  return { ...charge, amount, tax_amount: round((amount * (charge.tax_rate || 0)) / 100) };
}
async function create(db, venue, accepted, basis, branch, quote) {
  const rule = venue?.room_charge;
  if (!rule?.enabled || !(rule.percent > 0) || accepted !== true) return null;
  let tax;
  if (rule.taxed) {
    if (!ObjectId.isValid(String(branch.default_tax || '')))
      throw new BadRequestError('Configure a default tax before taxing room charges.');
    tax = await db.collection('grouptax').findOne({
      _id: new ObjectId(String(branch.default_tax)),
      branch_id: branch._id,
      license: branch.license,
    });
    if (!tax || !Number.isFinite(Number(tax.rate)) || Number(tax.rate) < 0)
      throw new BadRequestError('The room charge tax is unavailable. Review the tax settings.');
  }
  if (
    !quote ||
    Number(quote.percent) !== rule.percent ||
    quote.taxed !== rule.taxed ||
    Number(quote.tax_rate || 0) !== Number(tax?.rate || 0)
  )
    throw new BadRequestError('Settings changed. Refresh and try again.');
  return recalculate(
    {
      source: 'room',
      name: rule.name,
      percent: rule.percent,
      taxed: rule.taxed,
      tax_name: tax?.name || '',
      tax_rate: Number(tax?.rate || 0),
      venue_code: venue.code,
      accepted: true,
    },
    basis,
    branch
  );
}
module.exports = { create, recalculate };
