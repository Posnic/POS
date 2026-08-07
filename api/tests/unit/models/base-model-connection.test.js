/*
 * BaseModel must open one connection, however many callers arrive at once.
 *
 * It did not. initializeDB() called MongoClient.connect() unconditionally, so
 * every caller that arrived while the first was still connecting started
 * another. Ten repositories asking for a collection together - a page load, or
 * a concurrent route sweep - opened twenty clients. BaseModel.mongoClient held
 * whichever finished last, leaving nineteen running with nothing referencing
 * them: impossible to close, each with its own pool, each re-authenticating for
 * the life of the process.
 *
 * It showed up as a CI failure rather than as a leak. MongoDB driver 7 loads
 * Node's crypto module lazily inside SCRAM-SHA-1 authentication instead of at
 * the top of the file, so when an orphaned client re-authenticated after Jest
 * had torn its environment down, require('crypto') returned undefined and the
 * driver read getFips off nothing. Driver 6 had the identical leak and never
 * produced a symptom, which is why this survived so long.
 */

describe('BaseModel connection handling', () => {
  let connectSpy;
  let BaseModel;
  const makeClient = (uri, close = jest.fn()) => ({
    db: () => ({ collection: (n) => ({ name: n, uri }) }),
    close,
  });

  beforeEach(() => {
    /* resetModules first, then take mongodb from the fresh registry - and only
       then require base.model, so both hold the same module instance. Spying on
       a copy obtained before the reset leaves the real connect in place, which
       hangs against a database that is not there. */
    jest.resetModules();
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/basemodel_test';

    const mongodb = require('mongodb');

    /* Resolves on a microtask rather than synchronously. That is the whole
       race: ten callers all run before the first connect settles, and the old
       code started a fresh client for each of them. */
    connectSpy = jest.spyOn(mongodb.MongoClient, 'connect').mockImplementation(() =>
      Promise.resolve().then(() => ({
        db: () => ({ collection: (n) => ({ name: n }) }),
        close: jest.fn(),
      }))
    );

    BaseModel = require('../../../src/models/base.model');
    BaseModel.mongoClient = null;
    BaseModel.database = null;
    BaseModel._connecting = null;
    BaseModel._connectedUri = null;
    BaseModel._connectingUri = null;
    BaseModel._connectGeneration = 0;
  });

  afterEach(() => {
    connectSpy.mockRestore();
  });

  test('ten concurrent callers share one connection', async () => {
    const models = Array.from({ length: 10 }, () => new BaseModel('items'));
    await Promise.all(models.map((m) => m.getCollection()));

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  test('every caller gets a working database, not just the first', async () => {
    const models = Array.from({ length: 5 }, () => new BaseModel('items'));
    const collections = await Promise.all(models.map((m) => m.getCollection()));

    for (const collection of collections) {
      expect(collection).toEqual({ name: 'items' });
    }
  });

  test('the client it opened can be closed', async () => {
    await new BaseModel('items').getCollection();
    const client = BaseModel.mongoClient;
    expect(client).not.toBeNull();

    await BaseModel.closeConnection();

    expect(client.close).toHaveBeenCalled();
    expect(BaseModel.mongoClient).toBeNull();
    expect(BaseModel.database).toBeNull();
    /* The memoised attempt has to go too, or the next caller awaits a promise
       that resolves to a database on a closed client. */
    expect(BaseModel._connecting).toBeNull();
    expect(BaseModel._connectedUri).toBeNull();
    expect(BaseModel._connectingUri).toBeNull();
  });

  test('it can connect again after being closed', async () => {
    await new BaseModel('items').getCollection();
    await BaseModel.closeConnection();
    await new BaseModel('items').getCollection();

    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(BaseModel.mongoClient).not.toBeNull();
  });

  test('reconnects when MONGODB_URI changes after connecting', async () => {
    connectSpy.mockImplementation((uri) => Promise.resolve().then(() => makeClient(uri)));

    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/fallback';
    await expect(new BaseModel('items').getCollection()).resolves.toEqual({
      name: 'items',
      uri: 'mongodb://127.0.0.1:27017/fallback',
    });
    const fallbackClient = BaseModel.mongoClient;

    process.env.MONGODB_URI = 'mongodb://user:pass@127.0.0.1:27017/credentialed';
    await expect(new BaseModel('items').getCollection()).resolves.toEqual({
      name: 'items',
      uri: 'mongodb://user:pass@127.0.0.1:27017/credentialed',
    });

    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(fallbackClient.close).toHaveBeenCalled();
    expect(BaseModel._connectedUri).toBe('mongodb://user:pass@127.0.0.1:27017/credentialed');
  });

  test('a stale in-flight URI cannot overwrite the credentialed connection', async () => {
    const pending = new Map();
    connectSpy.mockImplementation(
      (uri) =>
        new Promise((resolve) => {
          pending.set(uri, resolve);
        })
    );

    const fallback = 'mongodb://127.0.0.1:27017/fallback';
    const credentialed = 'mongodb://user:pass@127.0.0.1:27017/credentialed';
    const fallbackClose = jest.fn();
    const credentialedClose = jest.fn();

    process.env.MONGODB_URI = fallback;
    const fallbackCollection = new BaseModel('items').getCollection();
    expect(connectSpy).toHaveBeenCalledWith(fallback);

    process.env.MONGODB_URI = credentialed;
    const credentialedCollection = new BaseModel('items').getCollection();
    expect(connectSpy).toHaveBeenCalledWith(credentialed);

    pending.get(credentialed)(makeClient(credentialed, credentialedClose));
    await expect(credentialedCollection).resolves.toEqual({ name: 'items', uri: credentialed });

    pending.get(fallback)(makeClient(fallback, fallbackClose));
    await expect(fallbackCollection).resolves.toEqual({ name: 'items', uri: credentialed });

    expect(fallbackClose).toHaveBeenCalled();
    expect(credentialedClose).not.toHaveBeenCalled();
    expect(BaseModel._connectedUri).toBe(credentialed);
    expect(BaseModel.mongoClient.close).toBe(credentialedClose);
  });

  test('a failed connection does not poison later attempts', async () => {
    connectSpy.mockRejectedValueOnce(new Error('server selection timed out'));

    await expect(new BaseModel('items').getCollection()).rejects.toThrow(
      'Database connection failed'
    );

    /* A memoised rejected promise would fail every future caller for the life
       of the process, which on a shop counter means the till never recovers
       from one slow start. */
    await expect(new BaseModel('items').getCollection()).resolves.toEqual({ name: 'items' });
  });

  test('the original error survives as the cause', async () => {
    connectSpy.mockRejectedValueOnce(new Error('bad credentials'));

    await expect(new BaseModel('items').getCollection()).rejects.toMatchObject({
      message: 'Database connection failed',
      cause: expect.objectContaining({ message: 'bad credentials' }),
    });
  });
});
