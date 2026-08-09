'use strict';
/*
 * A session store that follows the shop.
 *
 * express-session is built once, at load, and given one store - which is right
 * for a process serving one shop and wrong for a shard, where every shop would
 * otherwise share one collection. This delegates each call to a store bound to
 * the shop in context, built once per shop and kept.
 *
 * Standalone is unchanged: no shop in context means the process's own
 * connection, which is what it was before.
 *
 * ---
 *
 * It extends session.Store, and that is the point of this being a class.
 *
 * The first version was an object literal carrying get/set/destroy/touch, on
 * the reasoning that the store interface is small. It is not: express-session
 * also calls createSession(), regenerate(), load() and generate(), all
 * inherited from session.Store and none of them present on a literal.
 *
 * The way that failed is worth recording, because nothing automated caught it.
 * createSession() is only reached when a request arrives carrying a cookie for
 * a session that already exists, so:
 *
 *   a fresh request with no cookie      worked
 *   a curl with a bad password          worked - returns before the session
 *   a person signing in successfully    500, every time
 *
 * Healthy to every check, broken for exactly the people using it. It reached
 * customers as "Something went wrong!" on the login page of every shop the
 * shard serves.
 *
 * Inheriting gives the rest of the interface for free and cannot fall behind
 * when express-session adds to it.
 *
 * It lives in its own file rather than inside app.js for the same reason: the
 * class could not be constructed without building the entire application and
 * opening a database connection, so its contract with express-session was
 * never asserted anywhere.
 */

const session = require('express-session');
const { MongoStore } = require('connect-mongo');

class TenantAwareSessionStore extends session.Store {
  /**
   * @param {object}   [deps]
   * @param {string}   [deps.uri]            fallback connection string
   * @param {Function} [deps.currentTenant]  the shop in scope, if any
   * @param {Function} [deps.isMultiTenant]  whether this process serves several
   */
  constructor(deps = {}) {
    super();
    const ctx = require('../db/tenant-context');
    const config = require('../config/config');

    this._currentTenant = deps.currentTenant || ctx.currentTenant;
    this._isMultiTenant = deps.isMultiTenant || ctx.isMultiTenant;
    this._uri = deps.uri || config.database.uri;
    this._baseStore = null;
    /* One store per shop, built once and kept: connect-mongo does work in its
       constructor that should not be repeated per request. */
    this._perShop = new Map();
  }

  /*
   * Built on first use, not in the constructor.
   *
   * connect-mongo opens a client as soon as it is constructed. In a shard this
   * store is only reached outside a tenant scope, which is rare, so eager
   * construction opened a connection that mostly went unused - and it made the
   * class impossible to instantiate without a reachable database, which is a
   * large part of why the bug above survived.
   */
  get _base() {
    if (!this._baseStore) this._baseStore = MongoStore.create({ mongoUrl: this._uri });
    return this._baseStore;
  }

  /** The store for the shop this request belongs to. */
  _storeFor() {
    if (!this._isMultiTenant()) return this._base;
    const t = this._currentTenant();
    /* No shop in scope: a timer, a shutdown hook, something outside a request.
       The base store is the honest answer - it is not any shop's, and nothing
       tenant-specific should be reaching a session there anyway. */
    if (!t || !t.tenantDb) return this._base;

    let s = this._perShop.get(t.tenantDb);
    if (!s) {
      /* Same cluster, the shop's own database, built from the client the shard
         already holds rather than a second client per shop. */
      s = MongoStore.create({
        client: t.db.client,
        dbName: t.tenantDb,
        collectionName: 'sessions',
      });
      this._perShop.set(t.tenantDb, s);
    }
    return s;
  }

  get(sid, cb) {
    this._storeFor().get(sid, cb);
  }

  set(sid, sess, cb) {
    this._storeFor().set(sid, sess, cb);
  }

  destroy(sid, cb) {
    this._storeFor().destroy(sid, cb);
  }

  touch(sid, sess, cb) {
    this._storeFor().touch(sid, sess, cb);
  }

  all(cb) {
    this._storeFor().all(cb);
  }

  clear(cb) {
    this._storeFor().clear(cb);
  }

  length(cb) {
    this._storeFor().length(cb);
  }
}

module.exports = { TenantAwareSessionStore };
