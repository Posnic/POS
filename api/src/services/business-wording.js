'use strict';

const { WordingProfiles, resolveBundle, supportedLocales } = require('./wording-profiles');

/** context comes from the authenticated Business session, never the query.
 * Published labels are read through the existing tenant settings sync lane. */
async function readBusinessWording(db, context, query) {
  const fail = (code, status) => {
    throw Object.assign(new Error(code), { code, status });
  };
  if (
    !query ||
    Object.keys(query).some((key) => !['branchId', 'locale'].includes(key)) ||
    typeof query.branchId !== 'string' ||
    !/^[a-f0-9]{24}$/i.test(query.branchId) ||
    typeof query.locale !== 'string' ||
    !supportedLocales().includes(query.locale)
  ) fail('invalid_request', 400);
  if (!context?.branches?.some((branch) => branch.id === query.branchId))
    fail('access_denied', 403);
  const service = new WordingProfiles(db.collection('settings'), context.businessId);
  return resolveBundle(await service.read(), query.branchId, query.locale, service.labels);
}

module.exports = { readBusinessWording };
