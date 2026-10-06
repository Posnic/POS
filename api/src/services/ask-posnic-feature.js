'use strict';

const SettingsRepository = require('../repositories/settings.repository');

// Separate from ai_enabled: other modules may use AI without Ask Posnic.
async function enabled(context) {
  const result = await new SettingsRepository().resolveGroup('features', context);
  const value = result?.status && result.data?.values?.ask_posnic_enabled;
  return value === true || value === 'true';
}

async function requireEnabled(req, res, next) {
  try {
    const scope = require('./ask-posnic-platform.service').scope(req);
    if (!(await enabled({ branchId: scope.branch_id, licenseId: scope.license })))
      return res.status(403).json({
        type: 'error',
        code: 'ASK_POSNIC_DISABLED',
        message: 'Ask Posnic is off. An owner can enable it in Settings → Features → Ask Posnic.',
        data: null,
      });
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { enabled, requireEnabled };
