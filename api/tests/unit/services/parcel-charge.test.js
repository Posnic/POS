const { withParcelCharge } = require('../../../src/services/parcel-charge');
const food = [
  { item_name: 'A', parcel_charge: 5, quantity: 1 },
  { item_name: 'B', parcel_charge: 2, quantity: 1 },
];
const manual = { name: 'Delivery', amount: 20, source: 'manual' };
test.each(['Take away', 'takeaway', 'pickup', 'Parcel'])(
  '%s adds one named charge outside kitchen lines',
  (type) => {
    const next = withParcelCharge([manual], type, food);
    expect(next).toEqual([
      manual,
      expect.objectContaining({
        source: 'parcel',
        name: 'Parcel Charge',
        amount: 7,
        tax_amount: 0,
      }),
    ]);
    expect(withParcelCharge(next, type, food)).toEqual(next);
    expect(food.map((i) => i.item_name)).toEqual(['A', 'B']);
    expect(
      withParcelCharge(next, type, [
        { ...food[0], quantity: 2 },
        { ...food[1], cancelled: true },
      ])[1].amount
    ).toBe(10);
    expect(withParcelCharge(next, type, [{ quantity: 1 }])).toEqual([manual]);
    expect(withParcelCharge(next, 'Dine-in', food)).toEqual([manual]);
  }
);
