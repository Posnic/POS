'use strict';
/*
 * Mongoose models that resolve to the shop the request belongs to.
 *
 * `mongoose.model('Sale', schema)` binds a model to the default connection at
 * import. `Sale.find()` then queries whichever database the process connected
 * to at startup - correct for a till, and a cross-tenant leak in a process
 * serving several shops. Eighteen models are registered this way and are used
 * from forty-nine files at sixty-three call sites.
 *
 * Changing every call site was the alternative. It would have been a very large
 * diff through the data layer of a point-of-sale, and any site missed would be
 * invisible: the query succeeds and returns another shop's rows. Making the
 * model resolve itself keeps the diff to the eighteen definitions and leaves
 * `Sale.find()` reading exactly as it does now.
 *
 * The important property, and the one the tests are built around:
 *
 *   in standalone, defineModel returns a proxy that resolves to the very same
 *   model object mongoose.model() would have returned.
 *
 * Not an equivalent one - the same one. Every method, static, hook and cast
 * behaves identically because it *is* the same model. That is what makes this
 * safe to put in front of twenty-one shops that are running right now.
 *
 * In multi-tenant mode the model is registered on the shop's own connection the
 * first time it is asked for, and mongoose caches it there. Those connections
 * share one pool (see tenant-connections.js), so this costs a schema
 * compilation per shop and no sockets.
 */

const mongoose = require('mongoose');
const { currentConnection, isMultiTenant } = require('./tenant-context');

/** name -> schema, so a model can be compiled onto another connection later. */
const schemas = new Map();

/**
 * The model for `name` on the connection this request belongs to.
 *
 * @param {string} name
 * @returns {import('mongoose').Model}
 */
function modelFor(name) {
  /*
   * Standalone: ask mongoose for it, exactly as the code here used to.
   *
   * mongoose.model(name) and mongoose.models[name] return the same object, but
   * they are not the same seam. Model hooks looked models up with
   * mongoose.model('Item'), and the tests around those hooks work by replacing
   * that function. Reading the registry directly would have quietly stepped
   * around every one of those mocks - the hooks would still work and their
   * tests would stop seeing them, which is a worse outcome than either.
   */
  const base = mongoose.models[name] ? mongoose.model(name) : undefined;
  if (!isMultiTenant()) return base;

  const connection = currentConnection(mongoose.connection);
  if (!connection || connection === mongoose.connection) return base;

  if (connection.models[name]) return connection.models[name];
  const schema = schemas.get(name);
  if (!schema) {
    /* A model compiled somewhere other than defineModel. Refusing is right:
       returning `base` here would serve the default database, which is the
       leak. */
    throw new Error(
      `model "${name}" was not registered through defineModel, so it cannot be ` +
        'resolved for this shop'
    );
  }
  return connection.model(name, schema);
}

/*
 * Traps chosen so the proxy is indistinguishable from the model.
 *
 * `get` returns the property from the resolved model rather than the target,
 * without binding: mongoose statics and query builders rely on `this` being the
 * model they were called on, and pre-binding here broke chained queries in a way
 * that only showed up on the second call.
 */
function proxyFor(name, target) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const model = modelFor(name) || t;
      return Reflect.get(model, prop, model === t ? receiver : model);
    },
    set(t, prop, value) {
      const model = modelFor(name) || t;
      return Reflect.set(model, prop, value);
    },
    has(t, prop) {
      return Reflect.has(modelFor(name) || t, prop);
    },
    ownKeys(t) {
      return Reflect.ownKeys(modelFor(name) || t);
    },
    getOwnPropertyDescriptor(t, prop) {
      return Reflect.getOwnPropertyDescriptor(modelFor(name) || t, prop);
    },
    /* `new Sale({...})` must build a document bound to this shop's model. */
    construct(t, args) {
      const Model = modelFor(name) || t;
      return new Model(...args);
    },
    /* So `doc instanceof Sale` still answers correctly. */
    getPrototypeOf(t) {
      return Reflect.getPrototypeOf(modelFor(name) || t);
    },
    apply(t, thisArg, args) {
      const Model = modelFor(name) || t;
      return Reflect.apply(Model, thisArg, args);
    },
  });
}

/**
 * Define a model once, usable from any shop.
 *
 * Drop-in for `mongoose.model(name, schema)`.
 *
 * @param {string} name
 * @param {import('mongoose').Schema} schema
 * @returns {import('mongoose').Model} a proxy that resolves per request
 */
function defineModel(name, schema) {
  schemas.set(name, schema);
  /* Compiled on the default connection as before, so standalone keeps the
     identical object and mongoose.models[name] stays populated for the code
     that looks models up by name. */
  const base = mongoose.models[name] || mongoose.model(name, schema);
  return proxyFor(name, base);
}

/**
 * Look a model up by name - the drop-in for `mongoose.model(name)`.
 *
 * Separate from modelFor, which backs the proxy and therefore has to tolerate a
 * name that is not registered yet: it is called on every property access, so
 * throwing there would turn a missing model into a failure at an unrelated line.
 *
 * This one is a direct replacement for a call the code used to make, so it
 * behaves exactly like it, including calling mongoose.model() rather than
 * reading mongoose.models. That is not pedantry - model hooks look their
 * collaborators up this way and their tests work by replacing that function, so
 * reading the registry instead would step around the mocks silently.
 */
function getModel(name) {
  if (!isMultiTenant()) return mongoose.model(name);

  const connection = currentConnection(mongoose.connection);
  if (!connection || connection === mongoose.connection) return mongoose.model(name);
  if (connection.models[name]) return connection.models[name];

  /* A model looked up but never defined here still has a schema on the default
     connection - Purchase and StaffActivity are registered elsewhere. Borrow it
     rather than refuse, so a shop gets its own copy either way. */
  const schema = schemas.get(name) || (mongoose.models[name] && mongoose.models[name].schema);
  if (!schema) {
    throw new Error(`model "${name}" has no schema, so it cannot be resolved for this shop`);
  }
  return connection.model(name, schema);
}

/** Test seam. */
function registeredNames() {
  return [...schemas.keys()];
}

module.exports = { defineModel, modelFor, getModel, registeredNames };
