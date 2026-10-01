'use strict';

const text = (field) => ({ $convert: { input: field, to: 'string', onError: '', onNull: '' } });
const number = (field) => ({ $convert: { input: field, to: 'double', onError: 0, onNull: 0 } });
const round = (value) => Math.round(Number(value || 0) * 100) / 100;

async function read(model, range) {
  if (!model?.branchId || !model?.licenseId)
    throw new Error('An authenticated shop and outlet are required.');
  const from = new Date(range?.start_date),
    to = new Date(range?.end_date);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to || +to - +from > 367 * 86400000)
    throw new Error('Choose a valid report period up to one year.');
  const ledger = await model.getCollection('coupon_redemptions');
  const [result = {}] = await ledger
    .aggregate(
      [
        {
          $match: model.getContextMatch({ date: { $gte: from, $lte: to }, voided: { $ne: true } }),
        },
        {
          $group: {
            _id: {
              code: { $toUpper: { $trim: { input: text('$code') } } },
              currency: { $toUpper: { $trim: { input: text('$currency') } } },
            },
            uses: { $sum: 1 },
            discount: { $sum: number('$discount') },
            bill_total: { $sum: number('$bill_total') },
          },
        },
        { $sort: { uses: -1, '_id.code': 1, '_id.currency': 1 } },
        {
          $facet: {
            rows: [{ $limit: 10 }],
            count: [{ $count: 'value' }],
            currencies: [
              {
                $group: {
                  _id: '$_id.currency',
                  uses: { $sum: '$uses' },
                  discount: { $sum: '$discount' },
                  bill_total: { $sum: '$bill_total' },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ],
      { maxTimeMS: 15000 }
    )
    .toArray();
  const amounts = (row) => ({
    uses: row.uses,
    discount: round(row.discount),
    bill_total: round(row.bill_total),
  });
  return {
    count: result.count?.[0]?.value || 0,
    rows: (result.rows || []).map((row) => ({
      code: row._id.code || 'Code not recorded',
      currency: row._id.currency || 'Currency not recorded',
      ...amounts(row),
    })),
    currencies: (result.currencies || []).map((row) => ({
      currency: row._id || 'Currency not recorded',
      ...amounts(row),
    })),
  };
}

function answer(data, period) {
  const uses = data.currencies.reduce((sum, row) => sum + row.uses, 0);
  return {
    answer: uses
      ? `Coupon promotion activity for ${String(period).replace(/_/g, ' ')}: ${uses} recorded uses. Showing ${data.rows.length} of ${data.count} code/currency groups, ranked by use count. Voided redemptions are excluded. Bill amounts are snapshots recorded when coupons were applied; they are not current net sales. This measures recorded coupon activity, not sales lift, campaign attribution or return on marketing spend. Manual discounts and loyalty rewards are outside this coupon report.`
      : `No non-voided coupon redemptions were recorded for ${String(period).replace(/_/g, ' ')}. This report covers coupons; it does not infer activity for other promotions.`,
    metrics: [
      { label: 'Recorded coupon uses', value: uses },
      ...data.currencies.map((row) => ({
        label: `All coupon discounts (${row.currency})`,
        value: row.discount.toFixed(2),
      })),
      ...data.rows.map((row) => ({
        label: `${row.code} (${row.currency})`,
        value: `${row.uses} uses · ${row.discount.toFixed(2)} discount · ${row.bill_total.toFixed(2)} recorded bills`,
      })),
    ],
    source: 'Non-voided coupon redemption ledger',
    link: '#/settings/marketingmodule',
  };
}

module.exports = { read, answer };
