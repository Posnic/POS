'use strict';

const { currentTenant } = require('../db/tenant-context');
const MANAGE_URL = 'https://www.posnic.com/account.html#password';
const MESSAGE = 'Manage your cloud owner password securely in your browser at ' + MANAGE_URL + '. This also changes your linked cloud shop password. Desktop recovery cannot change this account.';
const protectedFields = new Set(['password', 'passwordChangedAt', 'authVersion', 'userkey',
  'expire_date', 'passwordResetToken', 'passwordResetExpires', 'email', 'username',
  'usertype', 'license', 'cloudOwnerId', 'activate', 'isActive']);

function linked(user, tenant = currentTenant(), env = process.env) {
  if (!user) return false;
  if (tenant?.ownerIdentity?.userId && String(user._id) === String(tenant.ownerIdentity.userId)) return true;
  if (user.cloudOwnerId) return true;
  // Legacy cloud owners are protected before explicit identity migration too.
  return user.usertype === 'super_admin' && (!!tenant || env.POSNIC_SYNC_PAIRED === '1' || env.POSNIC_CLOUD === '1');
}
function refusal() { const e = new Error(MESSAGE); e.code = 'CLOUD_OWNER_BROWSER_REQUIRED'; e.statusCode = 403; return e; }
function requireLocal(user) { if (linked(user)) throw refusal(); }

async function authority(user) {
  const tenant = currentTenant();
  if (!user || !tenant?.ownerIdentity || String(user._id) !== String(tenant.ownerIdentity.userId)) return null;
  if (tenant.ownerIdentity.state === 'pending' || typeof tenant.readOwnerCredential !== 'function') throw new Error('Cloud owner authentication unavailable');
  const account = await tenant.readOwnerCredential();
  if (account?.disabled || !account?.passwordHash || String(account._id) !== String(tenant.ownerIdentity.webUserId)) throw new Error('Cloud owner authentication unavailable');
  return account;
}
function applyIdentity(user, account) {
  if (account) {
    user.authVersion = Number(account.authVersion) || 0;
    user.passwordChangedAt = account.passwordChangedAt;
    user.cloudOwnerId = String(account._id);
    // Authentication metadata is read-only; a later profile save must not
    // attempt to write the authority's fields back through a local model.
    if (typeof user.unmarkModified === 'function') {
      for (const field of ['authVersion', 'passwordChangedAt', 'cloudOwnerId']) user.unmarkModified(field);
    }
  }
  return user;
}
async function hydrate(user) { return applyIdentity(user, await authority(user)); }
async function verify(user, password) {
  if (typeof password !== 'string') return false;
  const account = await authority(user);
  applyIdentity(user, account);
  if (account) return require('bcryptjs').compare(password, account.passwordHash);
  return require('../utils/password-match').passwordMatches(password, user?.password);
}
function touchesProtected(update) {
  if (Array.isArray(update)) return true;
  return Object.entries(update || {}).some(([key, value]) => key.startsWith('$')
    ? Object.keys(value || {}).some(field => protectedFields.has(field.split('.')[0])) || (key === '$rename' && Object.values(value || {}).some(field => typeof field === 'string' && protectedFields.has(field.split('.')[0])))
    : protectedFields.has(key.split('.')[0]));
}
module.exports = { linked, requireLocal, hydrate, verify, touchesProtected, refusal, MANAGE_URL, MESSAGE };
