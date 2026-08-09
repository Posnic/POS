'use strict';
/*
 * The session store must be a real session.Store, not something shaped like one.
 *
 * The first version was an object literal carrying get/set/destroy/touch, on the
 * reasoning that the store interface is small. express-session also calls
 * createSession(), regenerate(), load() and generate(), all inherited from
 * session.Store and none of them present on a literal.
 *
 * How it failed is the reason this test exists. createSession() is only reached
 * when a request arrives with a cookie for a session that already exists:
 *
 *   fresh request, no cookie          worked
 *   curl with a bad password          worked - returns before touching a session
 *   a person signing in successfully  500, every time
 *
 * Healthy to everything automated, broken for exactly the people using it. It
 * shipped, and reached customers as "Something went wrong!" on the login page of
 * every shop served by the shard.
 *
 * So this asserts the contract rather than the happy path: every method
 * express-session will call must exist and be callable, whether this file
 * defines it or inherits it.
 */

const session = require('express-session');

/* Constructing the store opens a connect-mongo client, which needs a URI but
   not a reachable server - nothing here connects. */
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';

describe('the tenant-aware session store', () => {
  let store;

  beforeAll(() => {
    /* The store's own module, not app.js. Requiring the app builds every route
       and opens a connection, which is precisely why this class went untested
       while it lived in there. */
    const { TenantAwareSessionStore } = require('../../src/session/tenant-session-store');
    store = new TenantAwareSessionStore({
      uri: 'mongodb://127.0.0.1:27017/test',
      /* Standalone: no shop in scope. The base store is lazy, so nothing here
         opens a connection. */
      isMultiTenant: () => false,
      currentTenant: () => undefined,
    });
  });

  test('it is an instance of session.Store', () => {
    /* The single assertion that would have prevented the outage. Everything
       else below follows from it, but this is the one that names the cause. */
    expect(store).toBeInstanceOf(session.Store);
  });

  /*
   * Every method express-session invokes on a store, including the inherited
   * ones. Listed explicitly rather than derived, so adding a method to the
   * class cannot quietly shrink what is checked.
   */
  const REQUIRED = [
    'get',
    'set',
    'destroy',
    'touch',
    'all',
    'clear',
    'length',
    /* Inherited from session.Store. createSession is the one that was missing;
       the others fail the same way and were equally absent.

       `generate` is deliberately not listed: express-session assigns it onto
       the store when the middleware is built, so a bare store correctly does
       not have it. Asserting it here would fail against a perfectly good
       store - which is the mistake the object literal made in reverse, by
       guessing at the interface instead of inheriting it. */
    'createSession',
    'regenerate',
    'load',
  ];

  test.each(REQUIRED)('%s is callable', (name) => {
    expect(typeof store[name]).toBe('function');
  });

  test('it is an EventEmitter, as express-session expects', () => {
    /* The literal stubbed on/emit/once/removeListener as no-ops, which silently
       discarded every store event. Inheritance makes them real. */
    for (const name of ['on', 'once', 'emit', 'removeListener']) {
      expect(typeof store[name]).toBe('function');
    }
  });

  test('createSession returns a session bound to the request', () => {
    /* The actual call that threw in production, exercised rather than assumed
       present. express-session calls this after loading a session from the
       store, which is why only signed-in users hit it. */
    const req = {};
    const sess = store.createSession(req, {
      cookie: { originalMaxAge: 1000, expires: new Date(Date.now() + 1000) },
    });
    expect(sess).toBeDefined();
    expect(req.session).toBeDefined();
  });
});
