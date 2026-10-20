'use strict';
const { WordingProfiles, resolveBundle } = require('./wording-profiles');
const catalog = require('../catalogs/document-wording.json');

/** Capture once at creation in the same document write, never in a print GET.
 * No totals, payment state or timestamps are changed by this helper. */
async function capture(collection, licenseId, branchId) {
  if (!licenseId || !branchId) return null;
  const service = new WordingProfiles(collection, licenseId);
  let state;
  try {
    state = await service.read();
    if (state.schemaVersion !== 1) throw new Error('Unsupported wording version');
  } catch (error) {
    // A label outage must never prevent taking a sale. Freeze the standard
    // wording actually used instead of silently changing it on a later reprint.
    console.warn('Document wording snapshot uses standard labels:', error.message);
    state = { schemaVersion: 1, revision: 0, assignments: {}, profiles: [] };
  }
  const locales = {};
  // Always freeze English document defaults. Also freeze explicitly assigned
  // locales; unassigned languages continue using shipped translations.
  for (const locale of new Set(['en', ...Object.keys(state.assignments?.[String(branchId)] || {})])) {
    if (!catalog.locales[locale]) continue;
    const bundle = resolveBundle(state, String(branchId), locale, service.labels);
    const values = { ...catalog.locales[locale] };
    for (const key of Object.keys(values))
      if (typeof bundle.values[key] === 'string') values[key] = bundle.values[key];
    locales[locale] = {
      profileId: bundle.profileId, profileRevision: bundle.profileRevision, values,
    };
  }
  return { schemaVersion: 1, licenseId: String(licenseId), branchId: String(branchId), locales };
}
function resolve(document, branchId, licenseId, locale) {
  const saved = document?.wording_snapshot;
  if (!saved) return undefined; // Legacy documents retain their existing behavior.
  if (saved.schemaVersion !== 1 || saved.branchId !== String(branchId) ||
      saved.licenseId !== String(licenseId)) return null;
  const values = saved.locales?.[locale]?.values;
  return values && typeof values === 'object' && !Array.isArray(values) &&
    Object.values(values).every(value => typeof value === 'string')
    ? { ...saved.locales[locale], locale, values } : null;
}
module.exports = { capture, resolve };
