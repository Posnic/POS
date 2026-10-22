const acl = require('../../../src/utils/messaging-access');
const user = (messaging) => ({ access: { branch: { write: true }, messaging } });
describe('messaging permission boundaries', () => {
  test.each(acl.ACTIONS)('%s is denied unless explicitly granted', (action) => {
    expect(acl.allowed(undefined, action)).toBe(false);
    expect(acl.allowed(user({}), action)).toBe(false);
    expect(acl.allowed(user({ [action]: 'true' }), action)).toBe(false);
    expect(acl.allowed(user({ [action]: true }), action)).toBe(true);
    expect(acl.allowed({ usertype: 'super_admin' }, action)).toBe(true);
  });
  test('channel grants never imply another channel, bulk, settings or history', () => {
    expect(acl.matrix(user({ send_sms: true }))).toEqual({
      ...acl.sanitize(),
      send_sms: true,
      read: true,
    });
    expect(acl.allowed({ usertype: 'super_admin' }, 'arbitrary')).toBe(false);
  });
  test('normalization excludes forged derived and unknown grants', () => {
    expect(acl.sanitize({ read: true, send_email: 'true', unknown: true })).toEqual(acl.sanitize());
  });
  test('bulk requires both grants and does not call the handler on denial', () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const guard = acl.requireActions('send_bulk', 'send_sms');
    guard({ user: user({ send_sms: true }) }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    guard({ user: user({ send_sms: true, send_bulk: true }) }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
