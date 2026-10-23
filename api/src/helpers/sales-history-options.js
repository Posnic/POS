'use strict';
const { ObjectId } = require('mongodb');
const { BadRequestError } = require('../utils/appError');
const { CHANNEL_VALUES, LEGACY_SALE_METHOD } = require('../utils/sales-channels');
module.exports = function historyOptions({ branchId, licenseId, field, query = '' }) {
  if (!['staff', 'device', 'source'].includes(field) || typeof query !== 'string' || query.length > 120)
    throw new BadRequestError('Invalid sales history filter.');
  if (!ObjectId.isValid(String(branchId)) || !ObjectId.isValid(String(licenseId)))
    throw new BadRequestError('Invalid branch context.');
  const first = (fields) => ({
    $reduce: {
      input: fields.map((f) => ({ $ifNull: ['$' + f, ''] })),
      initialValue: '',
      in: { $cond: [{ $eq: ['$$value', ''] }, '$$this', '$$value'] },
    },
  });
  const value = field === 'source' ? {
    $cond: [
      { $in: ['$channel', CHANNEL_VALUES] }, '$channel',
      { $switch: {
        branches: Object.entries(LEGACY_SALE_METHOD).map(([legacy, channel]) => ({
          case: { $eq: ['$sale_method', legacy] }, then: channel,
        })), default: 'pos',
      } },
    ],
  } : first(
    field === 'staff'
      ? ['kitchen_actor.name', 'client.staff_name', 'created_by', 'user_name']
      : ['client.device_id', 'client.device_model']
  );
  const literal = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    {
      $match: {
        license: new ObjectId(String(licenseId)),
        branch_id: new ObjectId(String(branchId)),
      },
    },
    {
      $project: {
        value,
        label: field === 'device' ? first(['client.device_model', 'client.device_id']) : value,
      },
    },
    {
      $match: {
        value: { $type: 'string', $ne: '' },
        ...(literal
          ? {
              $or: [
                { value: { $regex: literal, $options: 'i' } },
                { label: { $regex: literal, $options: 'i' } },
              ],
            }
          : {}),
      },
    },
    { $group: { _id: '$value', label: { $first: '$label' } } },
    { $sort: { label: 1, _id: 1 } },
    { $limit: 10 },
    { $project: { _id: 0, value: '$_id', label: 1 } },
  ];
};
