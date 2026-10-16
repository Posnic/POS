'use strict';

// Available by default; an explicit administrator opt-out survives upgrades.
module.exports = (branch) =>
  branch?.inventory_policy?.enabled == null || branch.inventory_policy.enabled === true;
