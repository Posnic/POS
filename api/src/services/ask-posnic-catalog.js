'use strict';

function activeCatalog(inventory = false) {
  return {
    del_status: { $nin: [1, '1', true] },
    item_status: { $nin: ['instant', 'inactive', 'draft', 'deleted'] },
    ...(inventory ? { track_inventory: true } : {}),
  };
}

module.exports = { activeCatalog };
