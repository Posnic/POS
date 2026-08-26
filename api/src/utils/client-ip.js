'use strict';

/*
 * The visitor's address, not the tunnel's.
 *
 * Behind Cloudflare, req.ip is a Cloudflare edge node - the owner's login
 * screen showed 104.22.x and 172.68.x for every sign-in, which are CF
 * ranges, not people. Cloudflare puts the real client in cf-connecting-ip;
 * nginx puts what it saw in x-real-ip; a bare proxy chain leads with it in
 * x-forwarded-for. Trust them in that order and fall back to the socket.
 */
function clientIp(req) {
  const h = (req && req.headers) || {};
  const first = (v) =>
    String(v || '')
      .split(',')[0]
      .trim();
  return (
    first(h['cf-connecting-ip']) ||
    first(h['x-real-ip']) ||
    first(h['x-forwarded-for']) ||
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown'
  );
}

module.exports = { clientIp };
