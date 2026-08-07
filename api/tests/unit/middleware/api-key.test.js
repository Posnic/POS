const {
  apiKeyAuth,
  enforceApiKeyAcl,
  actionFor,
  moduleFor,
  permits,
  keyFromRequest,
} = require('../../../src/middleware/api-key');

/*
 * A key is a user, limited by the same access grid the Users screen shows.
 *
 * The grid is enforced unevenly elsewhere - checkPermission is called in 13 of
 * the 26 controllers - so for a credential handed to somebody else's developer
 * these tests are the only thing standing between "read-only" and "everything"
 * on the routes that do not check for themselves. They are written accordingly:
 * the cases that matter are the refusals.
 */

const KEY = '35c4a96c97701b4a290a088d0b4d811e7bb54612';

function apiUser(access = {}) {
  return { _id: 'u1', username: 'shopapi', usertype: 'api', apikey: KEY, access };
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('reading the key off a request', () => {
  it('accepts the spellings an integrator will actually reach for', () => {
    expect(keyFromRequest({ headers: { 'x-api-key': KEY } })).toBe(KEY);
    expect(keyFromRequest({ headers: { apikey: KEY } })).toBe(KEY);
    expect(keyFromRequest({ headers: { 'x-apikey': KEY } })).toBe(KEY);
    expect(keyFromRequest({ headers: { 'X-API-KEY': KEY } })).toBe(null); // node lowercases
  });

  it('ignores Authorization, which belongs to the session token', () => {
    // Overloading it would make a failure ambiguous: is the token bad, or the key?
    expect(keyFromRequest({ headers: { authorization: `Bearer ${KEY}` } })).toBe(null);
  });

  it('treats blank and whitespace as absent', () => {
    expect(keyFromRequest({ headers: { 'x-api-key': '   ' } })).toBe(null);
    expect(keyFromRequest({ headers: {} })).toBe(null);
  });
});

describe('mapping a request to the grid', () => {
  it('reads the method as the grid does', () => {
    expect(actionFor('GET')).toBe('read');
    expect(actionFor('HEAD')).toBe('read');
    expect(actionFor('POST')).toBe('write');
    expect(actionFor('PUT')).toBe('write');
    expect(actionFor('PATCH')).toBe('write');
    expect(actionFor('DELETE')).toBe('delete');
  });

  it('maps route prefixes to module names', () => {
    expect(moduleFor('/items/123')).toBe('item');
    expect(moduleFor('/sales')).toBe('sales');
    expect(moduleFor('/receivings/abc/print')).toBe('receiving');
    expect(moduleFor('/customercategory')).toBe('customer');
    expect(moduleFor('/variants')).toBe('item');
  });

  it('refuses a module it does not know', () => {
    // A module added later must be unreachable by an existing key until
    // somebody decides what that key may do with it. Failing open would
    // silently widen every key already in circulation.
    expect(moduleFor('/somethingnew')).toBe(null);
    expect(moduleFor('/')).toBe(null);
    expect(moduleFor('')).toBe(null);
  });
});

describe('what the grid permits', () => {
  it('allows exactly what is ticked', () => {
    const access = { item: { read: true, write: false, delete: false } };
    expect(permits(access, 'item', 'read')).toBe(true);
    expect(permits(access, 'item', 'write')).toBe(false);
    expect(permits(access, 'item', 'delete')).toBe(false);
  });

  it('treats anything not explicitly true as no', () => {
    // A missing module, a missing flag, or a truthy-but-not-true value.
    expect(permits({}, 'item', 'read')).toBe(false);
    expect(permits({ item: {} }, 'item', 'read')).toBe(false);
    expect(permits({ item: { read: 'yes' } }, 'item', 'read')).toBe(false);
    expect(permits({ item: { read: 1 } }, 'item', 'read')).toBe(false);
    expect(permits(null, 'item', 'read')).toBe(false);
  });
});

describe('authenticating with a key', () => {
  const handed = [];
  const continueWithTenant = (req, res, next, user) => {
    handed.push(user);
    return next();
  };

  beforeEach(() => {
    handed.length = 0;
  });

  it('hands a valid key to the same path a session takes', async () => {
    const user = apiUser({ item: { read: true } });
    const mw = apiKeyAuth({ findUserByApiKey: async () => user, continueWithTenant });
    const req = { headers: { 'x-api-key': KEY }, method: 'GET', path: '/items' };
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(handed).toEqual([user]);
    expect(req.isApiKey).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('passes straight through when no key was sent', async () => {
    // An ordinary browser request must reach the session path untouched.
    const mw = apiKeyAuth({ findUserByApiKey: async () => apiUser(), continueWithTenant });
    const req = { headers: {}, method: 'GET', path: '/items' };
    const next = jest.fn();

    await mw(req, mockRes(), next);

    expect(handed).toEqual([]);
    expect(req.isApiKey).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('refuses an unknown key', async () => {
    const mw = apiKeyAuth({ findUserByApiKey: async () => null, continueWithTenant });
    const res = mockRes();

    await mw({ headers: { 'x-api-key': 'wrong' }, method: 'GET', path: '/items' }, res, jest.fn());

    expect(res.statusCode).toBe(401);
    expect(handed).toEqual([]);
  });

  it("refuses a staff account's key", async () => {
    // Otherwise a key becomes a way around the login that account should use.
    const staff = { ...apiUser({ item: { read: true } }), usertype: 'admin' };
    const mw = apiKeyAuth({ findUserByApiKey: async () => staff, continueWithTenant });
    const res = mockRes();

    await mw({ headers: { 'x-api-key': KEY }, method: 'GET', path: '/items' }, res, jest.fn());

    expect(res.statusCode).toBe(401);
    expect(handed).toEqual([]);
  });

  it('refuses a deactivated key', async () => {
    const off = { ...apiUser(), status: 'Inactive' };
    const mw = apiKeyAuth({ findUserByApiKey: async () => off, continueWithTenant });
    const res = mockRes();

    await mw({ headers: { 'x-api-key': KEY }, method: 'GET', path: '/items' }, res, jest.fn());

    expect(res.statusCode).toBe(401);
  });

  it('does not let a database failure look like a valid key', async () => {
    const mw = apiKeyAuth({
      findUserByApiKey: async () => {
        throw new Error('mongo down');
      },
      continueWithTenant,
    });
    const res = mockRes();

    await mw({ headers: { 'x-api-key': KEY }, method: 'GET', path: '/items' }, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(handed).toEqual([]);
  });
});

describe('enforcing the grid', () => {
  it('lets through what the key is allowed to do', () => {
    const req = {
      isApiKey: true,
      method: 'GET',
      path: '/items',
      user: apiUser({ item: { read: true } }),
    };
    const next = jest.fn();

    enforceApiKeyAcl(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('refuses a write when only read is granted', () => {
    // This is the case the whole feature exists for.
    const req = {
      isApiKey: true,
      method: 'POST',
      path: '/items',
      user: apiUser({ item: { read: true, write: false } }),
    };
    const res = mockRes();

    enforceApiKeyAcl(req, res, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/write access to item/);
    expect(res.body.data).toEqual({ module: 'item', action: 'write' });
  });

  it('refuses a delete when only read and write are granted', () => {
    const req = {
      isApiKey: true,
      method: 'DELETE',
      path: '/sales/abc',
      user: apiUser({ sales: { read: true, write: true, delete: false } }),
    };
    const res = mockRes();

    enforceApiKeyAcl(req, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });

  it('refuses an endpoint no module claims', () => {
    const req = {
      isApiKey: true,
      method: 'GET',
      path: '/install/seed',
      user: apiUser({ item: { read: true } }),
    };
    const res = mockRes();

    enforceApiKeyAcl(req, res, jest.fn());
    expect(res.statusCode).toBe(403);
  });

  it('says which module and action were refused', () => {
    // An integrator reading a bare "forbidden" cannot tell whether the key is
    // wrong, the permission is missing, or the endpoint does not exist.
    const req = { isApiKey: true, method: 'GET', path: '/customers', user: apiUser({}) };
    const res = mockRes();

    enforceApiKeyAcl(req, res, jest.fn());
    expect(res.body.message).toMatch(/read access to customer/);
  });

  it('does not touch a session request', () => {
    // Staff working through the screens are unaffected by this change.
    const req = { method: 'DELETE', path: '/items/1', user: { access: {} } };
    const next = jest.fn();

    enforceApiKeyAcl(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('the grid is checked during authentication, not after it', () => {
  /*
   * It used to be a separate middleware mounted ahead of the route files - but
   * each route file runs protect itself, so enforcement ran before
   * authentication, saw no key on the request, and waved everything through. A
   * key with read denied on sales was returning sales from a live shop.
   */
  it('refuses a denied module in the same step that authenticates', async () => {
    const handed = [];
    const user = apiUser({ sales: { read: false }, report: { read: true } });
    const mw = apiKeyAuth({
      findUserByApiKey: async () => user,
      continueWithTenant: (req, res, next, u) => {
        handed.push(u);
        return next();
      },
    });
    const res = mockRes();
    const next = jest.fn();

    await mw({ headers: { 'x-api-key': KEY }, method: 'GET', path: '/sales' }, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(handed).toEqual([]); // never reached the tenant context, let alone a handler
  });

  it('still lets a permitted module through', async () => {
    const handed = [];
    const user = apiUser({ sales: { read: true } });
    const mw = apiKeyAuth({
      findUserByApiKey: async () => user,
      continueWithTenant: (req, res, next, u) => {
        handed.push(u);
        return next();
      },
    });
    const next = jest.fn();

    await mw({ headers: { 'x-api-key': KEY }, method: 'GET', path: '/sales' }, mockRes(), next);

    expect(handed).toEqual([user]);
    expect(next).toHaveBeenCalled();
  });
});

describe('seeing the whole path, not just the part after the mount', () => {
  const { requestPath } = require('../../../src/middleware/api-key');

  /*
   * This runs inside protect, which each route file mounts itself, so req.path
   * has already had the mount point stripped: a request to /sales arrives as
   * "/". Reading that found no module, and every key request was refused with
   * "not available to API keys" - the right answer for the wrong reason, which
   * is the kind of bug that looks like it works.
   */
  it('rebuilds the path from the mount point', () => {
    expect(requestPath({ baseUrl: '/sales', path: '/' })).toBe('/sales/');
    expect(requestPath({ baseUrl: '/items', path: '/123' })).toBe('/items/123');
  });

  it('falls back to originalUrl when there is no mount', () => {
    expect(requestPath({ path: '/', originalUrl: '/sales?limit=1' })).toBe('/sales?limit=1');
  });

  it('finds the module through a mounted router', () => {
    expect(moduleFor(requestPath({ baseUrl: '/sales', path: '/' }))).toBe('sales');
    expect(moduleFor(requestPath({ baseUrl: '/items', path: '/abc' }))).toBe('item');
    expect(moduleFor(requestPath({ path: '/', originalUrl: '/sales?limit=1' }))).toBe('sales');
  });

  it('ignores the query string', () => {
    expect(moduleFor('/sales?limit=1&filters=%7B%7D')).toBe('sales');
  });
});
