'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const { BadRequestError } = require('../utils/appError');
const { round2 } = require('./sale-header');

// Normalize once: payment validation, tax totals and the saved document must
// all use the same charges. Existing, unchanged charges retain their tax snapshot.
async function normalizeSaleCharges(input, existing, context) {
  if (input === undefined) return existing || [];
  if (!Array.isArray(input) || input.length > 20)
    throw new BadRequestError('Provide at most 20 additional charges.');
  let defaultTax;
  const output = [];
  for (const charge of input) {
    const name = String(charge?.name || '').trim();
    const value = Number(charge?.amount);
    if (!name || name.length > 60 || !Number.isFinite(value) || value <= 0)
      throw new BadRequestError(
        'Each additional charge needs a name and a positive finite amount.'
      );
    const amount = round2(value);
    if (amount <= 0) throw new BadRequestError('Additional charges must be at least 0.01.');
    const taxed = charge.taxed === true || charge.taxed === 'true';
    let taxAmount = 0;
    let taxName = '';
    if (taxed) {
      const previous = (existing || []).find(
        (c) =>
          c.name === name &&
          c.amount === amount &&
          c.taxed === true &&
          c.tax_amount === Number(charge.tax_amount)
      );
      if (previous) {
        taxAmount = previous.tax_amount;
        taxName = previous.tax_name;
      } else {
        if (defaultTax === undefined) {
          const taxId = context.branchSettings?.default_tax;
          if (!taxId || !ObjectId.isValid(String(taxId)))
            throw new BadRequestError('Configure a default tax before taxing additional charges.');
          const db = await BaseModel.getDb();
          defaultTax = await db.collection('grouptax').findOne({
            _id: new ObjectId(String(taxId)),
            branch_id: new ObjectId(String(context.branchId)),
            license: new ObjectId(String(context.licenseId)),
          });
        }
        if (!defaultTax || !Number.isFinite(Number(defaultTax.rate)) || Number(defaultTax.rate) < 0)
          throw new BadRequestError('The default charge tax is unavailable. Refresh settings.');
        taxAmount = Math.round(amount * Number(defaultTax.rate)) / 100;
        taxName = String(defaultTax.name || '').slice(0, 40);
      }
      if (
        !Number.isFinite(Number(charge.tax_amount)) ||
        Math.abs(Number(charge.tax_amount) - taxAmount) > 0.005
      )
        throw new BadRequestError(
          'Additional charge tax differs from the configured tax. Refresh and review the bill.'
        );
    }
    output.push({
      name,
      amount,
      taxed,
      tax_name: taxName,
      tax_amount: taxAmount,
      source: charge.source === 'quote' ? 'quote' : 'manual',
    });
  }
  return output;
}

module.exports = { normalizeSaleCharges };
