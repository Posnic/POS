'use strict';
/*
 * Give every request a handle to the database it is meant to read.
 *
 * Controllers reach the database two ways. Most import a mongoose model, which
 * is bound to whatever connection existed when the module was first required.
 * A few use `req.db` and talk to collections directly - and `req.db` was never
 * assigned anywhere. It is read at seven places in easy-tables.controller, the
 * router mounts those routes at /api/easy-table, and every one of them threw on
 * `undefined.collection(...)`, was swallowed by the surrounding try/catch, and
 * returned "Failed to fetch table data" with a 500. The endpoints have never
 * worked; the try/catch is why nobody saw a stack trace.
 *
 * Assigning it here rather than at each call site, because this is also the
 * seam a shop-per-request setup needs. One process serving several shops cannot
 * use a connection captured at import - it has to resolve per request - and
 * having exactly one place that answers "which database is this request for?"
 * is what makes that safe to reason about. Scattering the resolution is how a
 * request ends up reading someone else's data.
 *
 * Standalone - a till, a self-hosted server, one shop - resolves to the single
 * connection, which is what it has always effectively been.
 */

const mongoose = require('mongoose');

/**
 * The mongoose Connection this request should use.
 *
 * `req.tenantConnection` is set by the caller that knows about tenants; nothing
 * in the open source path sets it, and the default connection is correct there.
 */
function connectionFor(req) {
  return (req && req.tenantConnection) || mongoose.connection;
}

/**
 * Express middleware: attach the request's database handle.
 *
 * Deliberately does not throw when the connection is not ready. Requests can
 * arrive during startup or a reconnect, and a middleware that throws turns a
 * transient state into a 500 with no useful message. Handlers that need the
 * database already have to cope with it being unavailable.
 */
function attachDb(req, res, next) {
  const connection = connectionFor(req);
  req.dbConnection = connection;
  req.db = connection && connection.db ? connection.db : undefined;
  next();
}

module.exports = { attachDb, connectionFor };
