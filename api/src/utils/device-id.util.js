const crypto = require('crypto');

const getRequestDeviceId = (req) => {
  const explicitId = req.headers?.['x-device-id'] || req.body?.device_id;
  const source =
    explicitId ||
    `${req.ip || req.socket?.remoteAddress || 'unknown'}|${req.get?.('user-agent') || req.headers?.['user-agent'] || 'unknown'}`;
  return crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 32);
};

module.exports = { getRequestDeviceId };
