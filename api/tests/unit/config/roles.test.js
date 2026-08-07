'use strict';

const { roles, roleRights } = require('../../../src/config/roles');

describe('config/roles', () => {
  test('exports the expected role list', () => {
    expect(roles).toEqual(['user', 'admin', 'manager', 'superadmin']);
  });

  test('maps rights cumulatively', () => {
    expect(roleRights.get('user')).toContain('getUser');
    expect(roleRights.get('admin')).toContain('manageUsers');
    expect(roleRights.get('manager')).toContain('manageInventory');
    expect(roleRights.get('superadmin')).toEqual(['all']);
  });
});
