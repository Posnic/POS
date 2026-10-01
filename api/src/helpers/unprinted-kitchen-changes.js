'use strict';

// Filter BEFORE the poller's batch limit. Transfer/service/held-only history
// does not create paper and must not hide later orders which do need a ticket.
module.exports = function unprintedKitchenChanges() {
  const changes = { $ifNull: ['$changes', []] };
  const last = {
    $convert: {
      input: { $ifNull: ['$last_printed_change_index', -1] },
      to: 'int',
      onError: -1,
      onNull: -1,
    },
  };
  return {
    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: {
                $slice: [
                  changes,
                  { $max: [0, { $add: [last, 1] }] },
                  { $max: [1, { $size: changes }] },
                ],
              },
              as: 'change',
              cond: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: { $ifNull: ['$$change.items', []] },
                        as: 'item',
                        cond: {
                          $and: [
                            { $not: [{ $ifNull: ['$$item.held', false] }] },
                            {
                              $in: [
                                {
                                  $toLower: {
                                    $convert: {
                                      input: '$$item.process',
                                      to: 'string',
                                      onError: '',
                                      onNull: '',
                                    },
                                  },
                                },
                                ['add', 'fire', 'amend', 'cancel'],
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                  0,
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };
};
