'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A missing/failed brand read must never be interpreted as an unbranded shop.
// This is separate from the cosmetic brand fallback used elsewhere in the app.
function guideBrandState({ descriptor, readSucceeded, buildEnabled }) {
  const state = { resolved: false, enabled: false, buildEnabled: buildEnabled === true };
  if (typeof buildEnabled !== 'boolean' || readSucceeded !== true) return state;
  if (descriptor === null) return { ...state, resolved: true };
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    Array.isArray(descriptor) ||
    typeof descriptor.enabled !== 'boolean'
  )
    return state;
  return { ...state, resolved: true, enabled: descriptor.enabled };
}

function cosmeticBrand(descriptor) {
  // Retain the existing visual branding even when Help eligibility is unknown.
  return descriptor && descriptor.enabled ? descriptor : null;
}

function buildBrandFlag(env = process.env) {
  if (env.POSNIC_BUILD_BRANDED === '1') return true;
  if (String(env.WHITE_LABEL_NAME || '').trim()) return true;
  if (env.POSNIC_BUILD_BRANDED === '0') return false;
  // The cloud web image is a stock build. A desktop shell must report the
  // installer seed explicitly; otherwise its state is unknown.
  return env.POSNIC_DESKTOP === '1' ? null : false;
}

function readFileBrand(dir, { paired, buildEnabled }, filesystem = fs) {
  try {
    return {
      descriptor: JSON.parse(filesystem.readFileSync(path.join(dir, 'brand.json'), 'utf8')),
      readSucceeded: true,
    };
  } catch (err) {
    // Missing is meaningful only for an unpaired stock build. Corrupt or
    // unreadable files, and a paired shop awaiting its cloud brand, are unknown.
    if (err.code === 'ENOENT' && paired !== true && buildEnabled === false) {
      return { descriptor: null, readSucceeded: true };
    }
    return { descriptor: null, readSucceeded: false };
  }
}

module.exports = { guideBrandState, buildBrandFlag, readFileBrand, cosmeticBrand };
