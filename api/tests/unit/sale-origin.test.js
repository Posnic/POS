const { runWithRequestContext } = require('../../src/utils/request-context');
const { requestOrigin, stamp } = require('../../src/utils/sale-origin');
test('actor and address come from the authenticated request, not client metadata', () => {
  const req = {
    ip: '192.0.2.4',
    originalUrl: '/api/sales/qrOrder?token=hidden',
    get: () => 'Captain WebView',
    body: { ip: 'spoof', staff_name: 'spoof' },
  };
  const origin = requestOrigin(req, { _id: 'staff', name: 'Alex' });
  expect(origin).toEqual({
    actor_id: 'staff',
    actor_name: 'Alex',
    ip: '192.0.2.4',
    user_agent: 'Captain WebView',
    route: '/api/sales/qrOrder',
  });
  runWithRequestContext({ saleOrigin: origin, currentBranch: 'branch' }, () => {
    expect(stamp({ origin: { actor_id: 'spoof' }, client: { device_id: 'phone' } })).toMatchObject({
      actor_id: 'staff',
      source: 'captain',
      branch_id: 'branch',
      device_id: 'phone',
    });
  });
});
test('background copies retain the original origin without inventing an actor', () => {
  const original = { actor_id: 'first', at: '2026-10-03T00:00:00Z' };
  expect(stamp({ origin: original })).toBe(original);
});
