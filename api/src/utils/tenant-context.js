class TenantContextError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'TenantContextError';
    this.statusCode = statusCode;
  }
}

const idString = (value) => {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  // BSON/Mongoose ObjectIds expose `id`/`_id` accessors that may return the
  // same object. Prefer their native conversion before inspecting wrappers.
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value.$oid !== undefined && value.$oid !== value) return String(value.$oid);
  if (value._id !== undefined && value._id !== value) return idString(value._id);
  return String(value);
};

const toObjectId = (value) => {
  const normalized = idString(value);
  const { ObjectId } = require('mongodb');
  return ObjectId.isValid(normalized) ? new ObjectId(normalized) : null;
};

const firstBranchFromUser = (user) => {
  const access = Array.isArray(user?.branch_access) ? user.branch_access : [];
  return (
    user?.branch_id ||
    user?.default_branch_id ||
    user?.branch?._id ||
    user?.branch ||
    access[0]?.branch_id ||
    null
  );
};

const replaceClientScope = (target, context) => {
  if (!target || typeof target !== 'object') return;
  const branchValue = context.branchId.toString();
  const licenseValue = context.licenseId.toString();
  const replacements = {
    branch_id: branchValue,
    branchId: branchValue,
    branch: branchValue,
    'branch[]': [branchValue],
    'branch_id[]': [branchValue],
    branch_ids: [branchValue],
    branchid: [branchValue],
    license: licenseValue,
    license_id: licenseValue,
    licenseId: licenseValue,
    branch_name: context.branchName,
  };
  for (const [key, value] of Object.entries(replacements)) {
    if (Object.prototype.hasOwnProperty.call(target, key)) target[key] = value;
  }
};

const setActiveTenantContext = (req, { branchId, branchName, licenseId }) => {
  const normalizedBranchId = toObjectId(branchId);
  const normalizedLicenseId = toObjectId(licenseId);
  if (!normalizedBranchId || !normalizedLicenseId) {
    throw new TenantContextError('Valid branch and license context is required', 400);
  }

  const context = {
    branchId: normalizedBranchId,
    branchName: String(branchName || '').trim(),
    licenseId: normalizedLicenseId,
    validated: true,
  };
  req.tenantContext = context;
  replaceClientScope(req.body, context);
  replaceClientScope(req.query, context);

  if (req.user) {
    req.user.branch_id = normalizedBranchId;
    req.user.branch_name = context.branchName;
    req.user.license = normalizedLicenseId;
  }
  if (req.session) {
    req.session.selectedBranchId = normalizedBranchId.toString();
    req.session.branch_id = normalizedBranchId.toString();
    req.session.branch_name = context.branchName;
    req.session.license = normalizedLicenseId.toString();
  }

  const { updateRequestContext } = require('./request-context');
  updateRequestContext({
    currentBranch: normalizedBranchId,
    currentBranchName: context.branchName,
    license: normalizedLicenseId,
  });
  return context;
};

async function attachTenantContext(req, user) {
  if (!user) return null;

  const licenseId = toObjectId(user.license || user.license_id);
  if (!licenseId) {
    req.tenantContext = null;
    return null;
  }

  // An explicit branch on the current request must win over a branch retained
  // in the session.  In production the session is persistent, so using it
  // first caused list endpoints such as GET /categories?branch_id=... to keep
  // querying the previously selected branch.  This was easy to miss locally
  // where requests commonly run without a persisted session/DB context.
  //
  // The requested branch is still validated below against both the user's
  // license and branch_access before it is accepted, so this does not allow a
  // client to escape its tenant scope.
  const selected =
    req.headers?.['x-branch-id'] ||
    req.query?.branch_id ||
    req.query?.['branch_id[]'] ||
    req.body?.branch_id ||
    req.body?.branchId ||
    req.session?.selectedBranchId ||
    req.session?.branch_id ||
    firstBranchFromUser(user);
  const branchId = toObjectId(selected);
  if (!branchId) {
    req.tenantContext = null;
    return null;
  }

  const mongoose = require('mongoose');
  const db = mongoose.connection?.db;
  if (!db) {
    // Unit/startup environments may authenticate before a DB handle exists.
    req.tenantContext = {
      branchId,
      branchName: req.session?.branch_name || user.branch_name || '',
      licenseId,
      validated: false,
    };
    return req.tenantContext;
  }

  const userId = toObjectId(user._id || user.id);
  const [branch, persistedUser] = await Promise.all([
    db
      .collection('branches')
      .findOne({ _id: branchId, license: licenseId }, { projection: { branch_name: 1 } }),
    userId
      ? db.collection('users').findOne(
          {
            _id: userId,
            license: licenseId,
            'branch_access.branch_id': branchId,
          },
          { projection: { _id: 1 } }
        )
      : null,
  ]);

  if (!branch || !persistedUser) {
    throw new TenantContextError(
      'The selected branch is not available for the current user and license'
    );
  }

  const branchName = String(branch.branch_name || '').trim();
  req.tenantContext = {
    branchId,
    branchName,
    licenseId,
    validated: true,
  };

  replaceClientScope(req.body, req.tenantContext);
  replaceClientScope(req.query, req.tenantContext);

  // Keep legacy controllers consistent while request-scoped code migrates to
  // req.tenantContext. These values come only from validated database records.
  user.branch_id = branchId;
  user.branch_name = branchName;
  user.license = licenseId;
  if (req.session) {
    req.session.selectedBranchId = branchId.toString();
    req.session.branch_id = branchId.toString();
    req.session.branch_name = branchName;
  }

  return req.tenantContext;
}

module.exports = {
  TenantContextError,
  attachTenantContext,
  idString,
  replaceClientScope,
  setActiveTenantContext,
  toObjectId,
};
