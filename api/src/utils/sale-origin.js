'use strict';
const { getRequestContext } = require('./request-context');
function requestOrigin(req, user) {
  return {
    actor_id: String(user._id || user.id || ''),
    actor_name: String(user.name || user.username || '').slice(0, 100),
    ip: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
    user_agent: String(req.get?.('user-agent') || '').slice(0, 300),
    route: String(req.originalUrl || '')
      .split('?')[0]
      .slice(0, 120),
  };
}
function stamp(data) {
  const c = getRequestContext();
  if (!c?.saleOrigin) return data.origin;
  return {
    ...c.saleOrigin,
    at: new Date(),
    branch_id: String(c.currentBranch || ''),
    source: String(c.saleOrigin.route).includes('qrOrder') ? 'captain' : 'pos',
    device_id: String(data.device_id || data.deviceId || data.client?.device_id || '').slice(
      0,
      100
    ),
  };
}
module.exports = { requestOrigin, stamp };
