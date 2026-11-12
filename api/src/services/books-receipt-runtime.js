"use strict";
// A process-local capability installed by the desktop shell. No environment
// variable, request body/header or synced database row may supply authority.
const providers = new WeakMap();
function unavailable(code = 'books_authority_unavailable') {
  return Object.assign(new Error('The original payment installation must be ready before using Books receipts.'), { code, status: 503 });
}
function attach(app, provider) {
  if (!app || typeof app !== 'function' || typeof provider !== 'function') throw unavailable();
  if (providers.has(app) && providers.get(app) !== provider) throw unavailable();
  providers.set(app, provider);
}
async function authority(app) {
  const provider = providers.get(app);
  if (!provider) throw unavailable();
  let value;
  try { value = await provider(); } catch { throw unavailable(); }
  if (value?.requiresRestart === true) throw unavailable('books_authority_restart_required');
  if (value?.version !== 1 || value.requiresRestart !== false ||
      typeof value.authority !== 'string' || !/^books-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.authority)) throw unavailable();
  return value.authority;
}
module.exports = { attach, authority };
