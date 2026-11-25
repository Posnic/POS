const assert = require('node:assert/strict');
const policy = require('../../../src/services/cloud-owner');
const { runWithTenant } = require('../../../src/db/tenant-context');
const bcrypt = require('bcryptjs');
test('linked owner protected regardless of plan; Community and staff remain local', () => {
  assert.equal(policy.linked({ usertype: 'super_admin' }, undefined, {}), false);
  assert.equal(
    policy.linked({ usertype: 'super_admin' }, undefined, { POSNIC_SYNC_PAIRED: '1' }),
    true
  );
  assert.equal(policy.linked({ usertype: 'staff' }, undefined, { POSNIC_SYNC_PAIRED: '1' }), false);
  assert.equal(policy.linked({ cloudOwnerId: 'owner' }, undefined, {}), true);
  assert.equal(policy.touchesProtected({ $rename: { name: 'password' } }), true);
});
test('owner login reads authority; stale password rejected and staff encoding preserved', async () => {
  const passwordHash = await bcrypt.hash('New-fixture-7', 4);
  const tenant = {
    db: {},
    ownerIdentity: { userId: 'owner', webUserId: 'website' },
    readOwnerCredential: async () => ({ _id: 'website', passwordHash, authVersion: 9 }),
  };
  await runWithTenant(tenant, async () => {
    const owner = {
      _id: 'owner',
      usertype: 'super_admin',
      password: await bcrypt.hash('Old-fixture-7', 4),
    };
    assert.equal(await policy.verify(owner, 'Old-fixture-7'), false);
    assert.equal(await policy.verify(owner, 'New-fixture-7'), true);
    assert.equal(owner.authVersion, 9);
    assert.throws(() => policy.requireLocal(owner), { code: 'CLOUD_OWNER_BROWSER_REQUIRED' });
    const staff = {
      _id: 'staff',
      usertype: 'staff',
      password: await bcrypt.hash(Buffer.from('Staff-fixture-7').toString('base64'), 4),
    };
    assert.equal(await policy.verify(staff, 'Staff-fixture-7'), true);
  });
  await runWithTenant({ ...tenant, readOwnerCredential: async () => null }, async () =>
    assert.rejects(() => policy.verify({ _id: 'owner' }, 'anything'), /unavailable/)
  );
});
