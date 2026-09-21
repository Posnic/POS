'use strict';

const mockMiddleware = () => jest.fn((req, res, next) => next());

jest.mock('../../../src/middleware/auth', () => ({ protect: mockMiddleware() }));
jest.mock('../../../src/middleware/auth-rate-limit', () => ({ handsetLimiter: mockMiddleware() }));
jest.mock('../../../src/db/tenant-context', () => ({ currentConnection: jest.fn() }));
jest.mock('../../../src/utils/handsets', () => ({ list: jest.fn(), setRevoked: jest.fn() }));

const { protect } = require('../../../src/middleware/auth');
const { handsetLimiter } = require('../../../src/middleware/auth-rate-limit');
const { currentConnection } = require('../../../src/db/tenant-context');
const handsets = require('../../../src/utils/handsets');
const router = require('../../../src/routes/handsets.routes');

describe('handsets.routes', () => {
  test('limits handset-management requests after authentication', () => {
    const middleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);

    expect(middleware).toEqual(expect.arrayContaining([protect, handsetLimiter]));
    expect(middleware.indexOf(protect)).toBeLessThan(middleware.indexOf(handsetLimiter));
  });

  describe.each([
    ['get', '/'],
    ['post', '/:deviceId/revoke'],
    ['post', '/:deviceId/allow'],
  ])('%s %s permissions', (method, path) => {
    const handle = router.stack.find((layer) => layer.route?.path === path).route.stack[0].handle;
    const tenantDb = { databaseName: 'current-shop' };
    const rows = [{ device_id: 'phone-123', model: 'Shop phone' }];
    let res;

    beforeEach(() => {
      jest.clearAllMocks();
      currentConnection.mockReturnValue({ db: tenantDb });
      handsets.list.mockResolvedValue(rows);
      handsets.setRevoked.mockResolvedValue(true);
      res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    });

    test.each([
      { usertype: 'super_admin' },
      { role: 'super_admin' },
      { usertype: 'SUPER_ADMIN' },
      { usertype: 'admin' },
      { usertype: 'owner' },
      { usertype: 'manager' },
      { usertype: 'superadmin' },
    ])('allows an authorized shop account %j', async (user) => {
      await handle(
        { user: { ...user, username: 'owner' }, params: { deviceId: 'phone-123' } },
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      if (method === 'get') {
        expect(handsets.list).toHaveBeenCalledWith(tenantDb);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ status: true, data: rows })
        );
        expect(handsets.setRevoked).not.toHaveBeenCalled();
      } else {
        expect(handsets.setRevoked).toHaveBeenCalledWith(
          tenantDb,
          'phone-123',
          path.endsWith('/revoke'),
          path.endsWith('/revoke') ? 'owner' : ''
        );
        expect(handsets.list).toHaveBeenCalledWith(tenantDb);
      }
    });

    test('does not expose or change a device assigned to another branch', async () => {
      handsets.list.mockResolvedValue([{ device_id: 'phone-123', branch_id: 'other-branch' }]);
      await handle(
        {
          user: { usertype: 'manager', branch_access: [{ branch_id: 'my-branch' }] },
          params: { deviceId: 'phone-123' },
        },
        res
      );
      if (method === 'get')
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
      else expect(res.status).toHaveBeenCalledWith(404);
      expect(handsets.setRevoked).not.toHaveBeenCalled();
    });

    test.each([
      { usertype: 'cashier' },
      { usertype: 'staff' },
      { usertype: 'api' },
      { usertype: 'cashier', role: 'super_admin' },
      {},
      undefined,
    ])('rejects an unauthorized account before accessing handsets %j', async (user) => {
      await handle({ user, params: { deviceId: 'phone-123' } }, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
      expect(currentConnection).not.toHaveBeenCalled();
      expect(handsets.list).not.toHaveBeenCalled();
      expect(handsets.setRevoked).not.toHaveBeenCalled();
    });
  });
});
