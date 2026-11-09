'use strict';
const { ObjectId } = require('mongodb');
const { BadRequestError } = require('../utils/appError');
// Older sales may carry an empty user_id while retaining the original creator ID.
const hasSeller = { $ne: [{ $ifNull: ['$user_id', ''] }, ''] };
const sellerIdentity = { $cond: [hasSeller, '$user_id', '$created_by_id'] };

module.exports = function historyOptions({ branchId, licenseId, field, query = '' }) {
  if (
    !['staff', 'device', 'seller', 'customer'].includes(field) ||
    typeof query !== 'string' ||
    query.length > 120
  )
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
  const value = first(
    field === 'staff'
      ? ['kitchen_actor.name', 'client.staff_name', 'created_by', 'user_name']
      : ['client.device_id', 'client.device_model']
  );
  const identity = field === 'seller' ? sellerIdentity : '$customer_id';
  const party = field === 'seller' || field === 'customer';
  const label =
    field === 'seller' ? { $cond: [hasSeller, '$user_name', '$created_by'] } : '$customer_name';
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
        value: party
          ? { $convert: { input: identity, to: 'string', onError: '', onNull: '' } }
          : value,
        label: party
          ? label
          : field === 'device'
            ? first(['client.device_model', 'client.device_id'])
            : value,
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

module.exports.sellerIdentity = sellerIdentity;
