'use strict';
const { fail } = require('../utils/branch-access');
const { accommodates } = require('../utils/table-details');
const { floorEligibility } = require('../helpers/floor-eligibility');

// Validate current floor data before an order edit. This is not a replacement
// for atomic seating claims shared by every order writer.
async function check(db, order, table, input) {
  if (!table || (input.id && String(table._id) !== String(input.id)))
    fail('This table changed. Refresh the table list.', 409);
  if (
    ['held', 'cleaning'].includes(table.service_state) ||
    (table.floor_close && !table.floor_close.completed)
  )
    fail('This table is not available.', 409);
  const other = await db
    .collection('sales')
    .find(
      {
        branch_id: order.branch_id,
        license: order.license,
        table_number: String(table.tableorder_value),
        _id: { $ne: order._id },
        ...floorEligibility(),
      },
      { projection: { person_count: 1 } }
    )
    .toArray();
  const guests =
    Number(input.guests || order.person_count || 1) +
    other.reduce((sum, row) => sum + Math.max(0, Number(row.person_count) || 0), 0);
  if (!accommodates(table, guests)) fail('Choose a table with enough seats.', 409);
}
module.exports = { check };
