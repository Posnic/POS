const roles = ['user', 'admin', 'manager', 'superadmin'];

const roleRights = new Map();

// Define permissions for each role
roleRights.set(roles[0], [
  'getUser',
  'updateUser',
  'deleteUser',
  'getItems',
  'placeOrder',
  'viewOwnOrders',
]);

roleRights.set(roles[1], [
  ...roleRights.get(roles[0]),
  'manageUsers',
  'manageItems',
  'manageOrders',
  'viewReports',
]);

roleRights.set(roles[2], [...roleRights.get(roles[1]), 'manageInventory', 'manageStaff']);

roleRights.set(roles[3], ['all']);

module.exports = {
  roles,
  roleRights,
};
