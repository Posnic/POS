'use strict';
const BaseModel = require('../models/base.model');
const { WordingProfiles, resolveBundle } = require('./wording-profiles');
/** Documents resolve independently of a browser's selected UI language. */
async function loadDocumentWording({ branchId, licenseId, locale = 'en', document }) {
  if (!branchId || !licenseId) return null;
  const snapshot = require('./document-wording-snapshot').resolve(document, branchId, licenseId, locale);
  if (snapshot !== undefined) return snapshot;
  const model = new BaseModel('settings');
  try {
    const service = new WordingProfiles(await model.getCollection('settings'), licenseId);
    const bundle = resolveBundle(await service.read(), String(branchId), locale, service.labels);
    return { ...bundle, values: { ...bundle.values } };
  } catch (error) {
    console.warn('Document wording unavailable; using standard labels:', error.message);
    return null;
  }
}
function label(bundle, key, fallback) {
  return typeof bundle?.values?.[key] === 'string' ? bundle.values[key] : fallback;
}
module.exports = { loadDocumentWording, label };
