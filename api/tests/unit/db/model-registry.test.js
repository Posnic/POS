'use strict';
/*
 * Models that resolve to the shop the request belongs to.
 *
 * `mongoose.model('Sale', schema)` binds to the default connection at import,
 * so `Sale.find()` reads whichever database the process connected to at
 * startup. Eighteen models were registered that way, used from forty-nine
 * files. In a process serving several shops every one of those is a request
 * reading someone else's data, and it fails silently.
 *
 * Two things are asserted here, and the first matters most:
 *
 *   1. In standalone the proxy behaves as the underlying model in every way
 *      that is observable. Twenty-one shops are running on this code path right
 *      now, so "behaves the same" has to be demonstrated, not assumed.
 *   2. In multi-tenant mode the model follows the request, and code with no
 *      shop in scope gets an error instead of the default database.
 */

const mongoose = require('mongoose');
const { defineModel, modelFor, getModel } = require('../../../src/db/model-registry');
const { enableMultiTenant, runWithTenant } = require('../../../src/db/tenant-context');

const schema = new mongoose.Schema({ name: String, price: Number });
const Widget = defineModel('TestWidget', schema);

afterEach(() => enableMultiTenant(false));

describe('standalone - the proxy is indistinguishable from the model', () => {
  const base = () => mongoose.models.TestWidget;

  test('resolves to the very same object mongoose holds', () => {
    expect(modelFor('TestWidget')).toBe(base());
  });

  test('reports the same identity', () => {
    expect(Widget.modelName).toBe('TestWidget');
    expect(Widget.collection.name).toBe(base().collection.name);
    expect(Widget.schema).toBe(schema);
  });

  test('exposes the same query methods', () => {
    for (const m of ['find', 'findOne', 'findById', 'create', 'updateOne', 'aggregate']) {
      expect(typeof Widget[m]).toBe('function');
    }
  });

  test('constructs documents of the real model', () => {
    const doc = new Widget({ name: 'a', price: 1 });
    expect(doc).toBeInstanceOf(base());
    expect(doc.name).toBe('a');
  });

  test('builds a query without executing it, and the query is chainable', () => {
    /* Binding methods to the model broke chaining once - the first call worked
       and the second returned undefined - so this asserts the chain. */
    const q = Widget.find({ price: 1 }).limit(5).sort({ name: 1 });
    expect(q).toBeDefined();
    expect(typeof q.exec).toBe('function');
    expect(q.getFilter()).toEqual({ price: 1 });
  });

  test('statics and schema paths come through', () => {
    expect(Object.keys(Widget.schema.paths)).toEqual(expect.arrayContaining(['name', 'price']));
  });

  test('getModel returns the same model', () => {
    expect(getModel('TestWidget')).toBe(base());
  });
});

describe('multi-tenant - the model follows the request', () => {
  beforeEach(() => enableMultiTenant(true));

  test('a shop in scope gets a model on its own connection', async () => {
    /* A stand-in connection: the registry only needs models[] and model(). */
    const shopModels = {};
    const shopConnection = {
      models: shopModels,
      model(name, s) {
        shopModels[name] = { modelName: name, schema: s, __shop: 'A' };
        return shopModels[name];
      },
    };
    await runWithTenant({ db: {}, connection: shopConnection }, async () => {
      const m = modelFor('TestWidget');
      expect(m.__shop).toBe('A');
      expect(m).not.toBe(mongoose.models.TestWidget);
    });
  });

  test('the model is compiled once per shop, then reused', async () => {
    let compiles = 0;
    const models = {};
    const connection = {
      models,
      model(name, s) {
        compiles += 1;
        models[name] = { modelName: name, schema: s };
        return models[name];
      },
    };
    await runWithTenant({ db: {}, connection }, async () => {
      modelFor('TestWidget');
      modelFor('TestWidget');
      modelFor('TestWidget');
    });
    expect(compiles).toBe(1);
  });

  test('two shops never share a model object', async () => {
    const make = (tag) => {
      const models = {};
      return {
        models,
        model(name, s) {
          models[name] = { modelName: name, schema: s, __shop: tag };
          return models[name];
        },
      };
    };
    let a;
    let b;
    await runWithTenant({ db: {}, connection: make('A') }, async () => {
      a = modelFor('TestWidget');
    });
    await runWithTenant({ db: {}, connection: make('B') }, async () => {
      b = modelFor('TestWidget');
    });
    expect(a.__shop).toBe('A');
    expect(b.__shop).toBe('B');
    expect(a).not.toBe(b);
  });

  test('code with no shop in scope throws rather than getting the default', () => {
    /* The leak this exists to prevent: without this, Sale.find() outside a
       request would quietly read whichever database the process holds. */
    expect(() => modelFor('TestWidget')).toThrow(/no shop in context/);
  });

  test('a model never registered through defineModel is refused', async () => {
    const connection = { models: {}, model: () => ({}) };
    await runWithTenant({ db: {}, connection }, async () => {
      expect(() => modelFor('NeverRegistered')).toThrow(/not registered through defineModel/);
    });
  });
});
