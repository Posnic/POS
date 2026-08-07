/*
 * What the key lookup asks the database for.
 *
 * The api-key tests build their user object by hand, so they cannot see this:
 * license and branch_access are select:false on the user schema, and the lookup
 * asked for neither. The key authenticated, the ACL passed, the branch and
 * dates were parsed correctly - and every endpoint returned an empty list with
 * HTTP 200, because a user with no licence scopes every query to nothing.
 *
 * Nothing throws on that path. attachTenantContext just gives up and leaves the
 * context licence null; salesReports calls `new ObjectId(undefined)`, which
 * mints a random id instead of failing. So the only place this can be caught is
 * here, at the query itself.
 */

jest.mock('../../../src/models/user.model', () => {
  const lean = jest.fn().mockResolvedValue({ _id: 'u1', username: 'shopapi' });
  const select = jest.fn(() => ({ lean }));
  const findOne = jest.fn(() => ({ select }));
  return { findOne, __probe: { findOne, select, lean } };
});

const User = require('../../../src/models/user.model');
const { findUserByApiKey } = require('../../../src/middleware/auth');

const KEY = '640da32b26c94eb914ee358ba37dd2973a3d750f';

describe('the user a key belongs to', () => {
  beforeEach(() => {
    User.__probe.findOne.mockClear();
    User.__probe.select.mockClear();
  });

  it('looks the user up by the key', async () => {
    await findUserByApiKey(KEY);
    expect(User.__probe.findOne).toHaveBeenCalledWith({ apikey: KEY });
  });

  it('asks for the licence, without which every query matches nothing', async () => {
    await findUserByApiKey(KEY);
    const selected = User.__probe.select.mock.calls[0][0];
    expect(selected).toContain('+license');
  });

  it('asks for branch_access, without which there is no tenant context', async () => {
    // attachTenantContext takes the branch from here when there is no session -
    // and an API key never has one.
    await findUserByApiKey(KEY);
    expect(User.__probe.select.mock.calls[0][0]).toContain('+branch_access');
  });

  it('still asks for the key itself, to confirm the match', async () => {
    await findUserByApiKey(KEY);
    expect(User.__probe.select.mock.calls[0][0]).toContain('+apikey');
  });

  it('asks for everything the session path asks for', async () => {
    // findUserByIdentifier selects '+license +branch_access' for the same
    // reason. A key user that sees less than a signed-in user does is the bug
    // this file exists for.
    await findUserByApiKey(KEY);
    const selected = User.__probe.select.mock.calls[0][0];
    for (const field of ['+license', '+branch_access']) {
      expect(selected).toContain(field);
    }
  });
});
