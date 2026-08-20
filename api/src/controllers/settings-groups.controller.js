'use strict';

/*
 * One endpoint per settings group (SETTINGS_AND_BRANCH_SCOPE_DESIGN, D2/S3).
 *
 * The whole point: an endpoint that only knows its own group cannot be asked
 * for a field that belongs to another one. The three bugs of 2026-08-20 were
 * all the same shape - a single endpoint serving both the full settings form
 * and small partial saves, demanding fields the caller never had:
 *
 *   - a non-empty notification_value on every call (5c84111)
 *   - one $set built from the whole form, wiping unsent keys (5c84111)
 *   - default_customer / default_supplier required to upload a signature
 *     image (69bc0cd)
 *
 * None of those can be expressed here.
 *
 * SECRETS ARE WRITE-ONLY. GET /settings/secrets answers which credentials are
 * configured, never their values. Today an SMTP password sits in the same
 * document as roundOff and is handed to any client that reads settings; this
 * is where that stops.
 */

const SettingsRepository = require('../repositories/settings.repository');
const { GROUPS } = require('../services/settings-groups');

const repository = new SettingsRepository();

const GROUP_NAMES = Object.keys(GROUPS);

function contextOf(req) {
  const user = req.user || {};
  return {
    branchId:
      req.tenantContext?.branchId ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      user.branch_id ||
      (Array.isArray(user.branch_access) && user.branch_access[0]?.branch_id) ||
      null,
    licenseId: req.tenantContext?.licenseId || user.license || user.license_id || null,
  };
}

/* Reading settings needs the settings permission; writing needs it too, and
   secrets additionally require an owner-class account - a cashier has no
   business setting the shop's outgoing mail password. */
const canRead = (req) => req.user?.access?.setting?.read !== false;
const canWrite = (req) => req.user?.access?.setting?.write !== false;
const OWNER_TYPES = ['owner', 'admin', 'super_admin', 'manager', 'store_manager'];
const isOwnerClass = (req) =>
  OWNER_TYPES.includes(String(req.user?.usertype || req.user?.role || '').toLowerCase());

/* Which branches this user may act on. A copy touches TWO of them, and the
   destination is the dangerous one - it is the branch being overwritten. An
   account with no branch_access list is an unrestricted one (owner/admin), so
   an empty list means "all", not "none". */
const branchesAllowed = (req) => {
  const list = req.user?.branch_access;
  if (!Array.isArray(list) || !list.length) return null; // null = unrestricted
  return new Set(list.map((b) => String(b?.branch_id || b)));
};
const mayTouchBranch = (req, branchId) => {
  const allowed = branchesAllowed(req);
  return allowed === null || allowed.has(String(branchId));
};

const fail = (res, message, code = 400, data = null) =>
  res.status(code).json({ type: 'error', message, data });
const ok = (res, data, message) => res.json({ type: 'success', message, data });

/* Which secrets exist, never what they are. */
const describeSecrets = (values) => {
  const out = {};
  for (const key of GROUPS.secrets) {
    const v = values[key];
    // a boolean flag is enough to render "configured / not configured"
    out[key] = v !== undefined && v !== null && String(v) !== '';
  }
  return out;
};

module.exports = {
  async read(req, res) {
    try {
      if (!canRead(req)) return fail(res, 'Unauthorized access', 403);
      const group = String(req.params.group || '');
      if (!GROUP_NAMES.includes(group)) return fail(res, 'Unknown settings group', 404);
      if (group === 'secrets' && !isOwnerClass(req)) {
        return fail(res, 'Unauthorized access', 403);
      }

      /* ?level=account reads what the ACCOUNT itself decides, unresolved.
         Editing a shop-wide rule must not start from one branch's override -
         saving that back would push that branch's choice onto every other
         shop without anyone asking for it. */
      const wantsAccount = String(req.query?.level || '') === 'account';
      const r = wantsAccount
        ? await repository.accountGroup(group, contextOf(req))
        : await repository.resolveGroup(group, contextOf(req));
      if (!r.status) return fail(res, r.message);

      if (group === 'secrets') {
        // values, and now `inherited` too, never leave for this group
        return ok(res, { group, configured: describeSecrets(r.data.values) }, 'success');
      }
      return ok(res, r.data, 'success');
    } catch (error) {
      console.error('Error in settings-groups read:', error);
      return fail(res, error.message, 500);
    }
  },

  /*
   * S6 (D4). Copy settings from one branch to another.
   *
   * Owner-class only, and both branches must be ones this account may act on -
   * the destination especially, since that is the branch being overwritten.
   * Secrets are refused by name rather than quietly dropped: a caller that
   * asked to copy credentials should be told it did not happen.
   */
  async copy(req, res) {
    try {
      if (!canWrite(req)) return fail(res, 'Unauthorized access', 403);
      if (!isOwnerClass(req)) return fail(res, 'Unauthorized access', 403);

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const from = body.from || contextOf(req).branchId;
      const to = body.to;
      if (!to) return fail(res, 'Pick a branch to copy to');
      for (const [label, id] of [
        ['source', from],
        ['destination', to],
      ]) {
        if (!mayTouchBranch(req, id)) {
          return fail(res, `You do not have access to the ${label} branch`, 403);
        }
      }

      const groups = Array.isArray(body.groups) ? body.groups : [];
      const r = await repository.copyGroups(groups, from, to, {
        licenseId: contextOf(req).licenseId,
      });
      if (!r.status) return fail(res, r.message, 400, r.data);
      return ok(res, r.data, 'Settings copied');
    } catch (error) {
      console.error('Error in settings-groups copy:', error);
      return fail(res, error.message, 500);
    }
  },

  async write(req, res) {
    try {
      if (!canWrite(req)) return fail(res, 'Unauthorized access', 403);
      const group = String(req.params.group || '');
      if (!GROUP_NAMES.includes(group)) return fail(res, 'Unknown settings group', 404);
      if (group === 'secrets' && !isOwnerClass(req)) {
        return fail(res, 'Unauthorized access', 403);
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      /* `level` is how a value is set for every branch at once. It is not a
         settings key, so it is pulled out before the payload is validated -
         otherwise it would be refused as belonging to no group. */
      const { level, ...values } = body;
      if (level && level !== 'account' && level !== 'branch') {
        return fail(res, "level must be 'account' or 'branch'");
      }

      const r = await repository.saveGroup(group, values, contextOf(req), { level });
      if (!r.status) return fail(res, r.message, 400, r.data);
      return ok(res, r.data, 'Settings saved');
    } catch (error) {
      console.error('Error in settings-groups write:', error);
      return fail(res, error.message, 500);
    }
  },
};
