const { create, recalculate } = require('../../../src/services/room-charge');
const { normalizeVenue } = require('../../../src/utils/partner-venues');
test('existing venues do not opt in on upgrade', () => {
  const v = normalizeVenue({ code: 'hotel', name: 'Hotel' });
  expect(v.staff_orders_enabled).toBe(false);
  expect(v.room_charge.enabled).toBe(false);
});
test('charge uses saved rate, clamps negative basis and retains tax snapshot', () => {
  const c = { source: 'room', percent: 5, tax_rate: 18, taxed: true };
  expect(recalculate(c, 123.45, {})).toMatchObject({ amount: 6.17, tax_amount: 1.11 });
  expect(recalculate(c, -100, {})).toMatchObject({ amount: 0, tax_amount: 0 });
});
test('disabled or unaccepted charge never reads tax or charges the guest', async () => {
  const db = {
    collection: () => {
      throw new Error('should not read');
    },
  };
  expect(
    await create(db, { room_charge: { enabled: true, percent: 5 } }, false, 100, {})
  ).toBeNull();
  expect(
    await create(db, { room_charge: { enabled: false, percent: 5 } }, true, 100, {})
  ).toBeNull();
});

test('a changed configured rate requires review rather than charging more silently', async () => {
  await expect(
    create(
      {},
      {
        code: 'hotel',
        room_charge: { enabled: true, percent: 7, taxed: false, name: 'Room service' },
      },
      true,
      100,
      {},
      { percent: 5, taxed: false, tax_rate: 0 }
    )
  ).rejects.toThrow('Settings changed');
});

test('taxed room charge reads only the branch tax and uses the reviewed quote', async () => {
  const id = '123456789012345678901234';
  let filter;
  const db = {
    collection: (name) => {
      expect(name).toBe('grouptax');
      return {
        findOne: async (q) => {
          filter = q;
          return { name: 'GST', rate: 18 };
        },
      };
    },
  };
  const charge = await create(
    db,
    {
      code: 'hotel',
      room_charge: { enabled: true, percent: 5, taxed: true, name: 'Room service' },
    },
    true,
    100,
    { _id: 'branch', license: 'shop', default_tax: id },
    { percent: 5, taxed: true, tax_rate: 18 }
  );
  expect(filter).toMatchObject({ branch_id: 'branch', license: 'shop' });
  expect(charge).toMatchObject({ amount: 5, tax_amount: 0.9, tax_name: 'GST', percent: 5 });
});
