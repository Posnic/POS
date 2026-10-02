const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { restaurantHistoryFilter } = require('../../../src/helpers/restaurant-history-filter');
let server, sales;
const periods = [
  { id: 'lunch', name: 'Lunch', hours: { mon: [{ open: '12:00', close: '15:30' }] } },
  { id: 'late', name: 'Dinner', hours: { mon: [{ open: '22:00', close: '02:00' }] } },
];
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('history'));
  sales = mongoose.connection.db.collection('sales');
  await sales.insertMany([
    { _id: 'before', table_number: '4', date: new Date('2026-10-05T06:29:00Z') },
    { _id: 'lunch', table_number: '4', date: new Date('2026-10-05T06:30:00Z') },
    { _id: 'other', table_number: 6, date: new Date('2026-10-05T07:30:00Z') },
    { _id: 'end', table_number: '4', date: new Date('2026-10-05T10:00:00Z') },
    { _id: 'overnight', table_number: '4', date: new Date('2026-10-05T19:00:00Z') },
    { _id: 'late-end', date: new Date('2026-10-05T20:30:00Z') },
    { _id: 'bad', date: 'not a date' },
    { _id: 'counter', date: new Date('2026-10-05T07:00:00Z') },
  ]);
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
}, 60000);
const find = async (q) =>
  (await sales.find({ $and: restaurantHistoryFilter(q, periods, 'Asia/Kolkata') }).toArray()).map(
    (r) => r._id
  );
test('local lunch is half-open', async () =>
  expect(await find({ serving_period: 'lunch' })).toEqual(['lunch', 'other', 'counter']));
test('table and period intersect', async () =>
  expect(await find({ table_number: '4', serving_period: 'lunch' })).toEqual(['lunch']));
test('numeric legacy tables work', async () =>
  expect(await find({ table_number: '6' })).toEqual(['other']));
test('overnight crosses the weekday correctly', async () =>
  expect(await find({ serving_period: 'late' })).toEqual(['overnight']));
test('tables only excludes counter', async () =>
  expect(await find({ tables_only: 'true' })).not.toContain('counter'));
test('invalid filters are refused', () => {
  expect(() => restaurantHistoryFilter({ serving_period: 'missing' }, periods, 'UTC')).toThrow();
  expect(() => restaurantHistoryFilter({ table_number: { $ne: '' } }, [], 'UTC')).toThrow();
});
