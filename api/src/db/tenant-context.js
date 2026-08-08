'use strict';
/*
 * Which shop the code currently running belongs to.
 *
 * Most of this API reaches the database through BaseModel, and BaseModel keeps
 * its handle in a static: `BaseModel.database`, set once when the process
 * connects. One process, one shop - which is exactly right for a till, and
 * exactly wrong for a process serving several shops, because every request
 * would read whichever database happened to be assigned at startup.
 *
 * That failure is silent. Nothing throws, the query succeeds, and it returns
 * another shop's sales and customers. It is the worst outcome this system has,
 * so the design here is built around making it impossible rather than unlikely:
 *
 *   - the handle is carried in AsyncLocalStorage, so it follows the request
 *     through awaits without being passed down through twelve controllers and
 *     twelve repositories;
 *   - when multi-tenant mode is on and a piece of code runs with no shop in
 *     context, it THROWS. It does not fall back to a default. A fallback is
 *     the leak: it would quietly serve one shop's data to another and look
 *     like it worked;
 *   - standalone - a till, a self-hosted server - never turns the mode on, and
 *     nothing about its behaviour changes.
 *
 * The asymmetry is deliberate. In standalone the absence of a context is
 * normal; in multi-tenant it means a code path escaped the request scope, and
 * the only safe response is to stop.
 */

/*
 * Separate from utils/request-context.js on purpose, though both are
 * AsyncLocalStorage.
 *
 * That one is opened by the auth middleware and carries who is signed in. This
 * one has to be opened before auth runs, because which shop a request belongs
 * to decides which database auth reads its users from - so it cannot depend on
 * auth having happened. They also fail differently: an absent request context
 * means nobody is signed in, which is ordinary; an absent tenant context in
 * multi-tenant mode means a code path escaped its request, which is not.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/* Off unless a host explicitly turns it on. The open-source path, the desktop
   app and every existing deployment leave it off and are unaffected. */
let multiTenant = false;

/**
 * Declare that this process serves more than one shop.
 *
 * Once on, any database access outside a tenant scope throws instead of
 * silently using a process-wide handle.
 */
function enableMultiTenant(on = true) {
  multiTenant = !!on;
}

function isMultiTenant() {
  return multiTenant;
}

/**
 * Run `fn` with this shop as the current context.
 *
 * @param {{db: object, connection?: object, tenantDb?: string}} tenant
 * @param {Function} fn
 */
function runWithTenant(tenant, fn) {
  if (!tenant || !tenant.db) {
    throw new Error('a tenant context needs a database handle');
  }
  return storage.run(tenant, fn);
}

/** The current shop, or undefined outside any request. */
function currentTenant() {
  return storage.getStore();
}

/**
 * The database the caller should be reading.
 *
 * @param {object} [fallback] the process-wide handle, used only in standalone
 * @returns {object} a Db
 * @throws  {Error}  in multi-tenant mode with no shop in context
 */
function currentDb(fallback) {
  const tenant = storage.getStore();
  if (tenant && tenant.db) return tenant.db;

  if (multiTenant) {
    /* Deliberately fatal. Returning `fallback` here would hand this caller
       whichever shop the process last touched, which is the leak this module
       exists to prevent. A background job that needs the database must open
       its own scope and say which shop it means. */
    throw new Error(
      'no shop in context: this process serves several shops, so the database ' +
        'cannot be chosen for you. Wrap the work in runWithTenant().'
    );
  }
  return fallback;
}

module.exports = {
  enableMultiTenant,
  isMultiTenant,
  runWithTenant,
  currentTenant,
  currentDb,
};
