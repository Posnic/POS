'use strict';
const { channelFilter, CHANNEL_VALUES } = require('../utils/sales-channels');
const { BadRequestError } = require('../utils/appError');

// Only named, literal filters are accepted; existing license/branch/session constraints stay intact.
module.exports = function historyProvenance(query = {}) {
  const clauses = [];
  const literal = (key) => {
    if (query[key] == null || query[key] === '') return '';
    if (typeof query[key] !== 'string' || query[key].length > 120)
      throw new BadRequestError('Invalid sales history filter.');
    return query[key].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };
  const staff = literal('ordered_by');
  if (staff) {
    // A Captain's original actor takes precedence over the user who later settled the sale.
    clauses.push({
      $or: [
        { 'kitchen_actor.name': { $regex: staff, $options: 'i' } },
        {
          'kitchen_actor.name': { $in: [null, ''] },
          $or: [
            { 'client.staff_name': { $regex: staff, $options: 'i' } },
            {
              'client.staff_name': { $in: [null, ''] },
              $or: [
                { created_by: { $regex: staff, $options: 'i' } },
                { created_by: { $in: [null, ''] }, user_name: { $regex: staff, $options: 'i' } },
              ],
            },
          ],
        },
      ],
    });
  }
  const device = literal('order_device');
  if (device)
    clauses.push({
      $or: ['client.device_model', 'client.device_id'].map((field) => ({
        [field]: { $regex: device, $options: 'i' },
      })),
    });
  if (query.order_source) {
    if (!CHANNEL_VALUES.includes(query.order_source))
      throw new BadRequestError('Invalid order source.');
    clauses.push(channelFilter(query.order_source));
  }
  return clauses;
};
