'use strict';
/*
 * Which address a staff phone should be told to use.
 *
 * Its own dependency-free file so the decision can be tested without express,
 * without qrcode and without standing up the server - because the decision IS
 * the substance, and getting it wrong is invisible on the till: the page
 * renders a perfectly good QR code for an address the phone cannot reach, and
 * it surfaces minutes later on somebody else's handset as "cannot find the
 * shop".
 */

const os = require('os');

/**
 * Every address on this machine a phone on the same Wi-Fi could reach.
 *
 * A till opened locally sees `localhost:5555`, which is useless to a phone -
 * pointing a handset at localhost points it at itself. The LAN addresses are
 * the ones worth offering, so they are read from the interfaces rather than
 * from the request.
 *
 * @returns {string[]} IPv4 addresses, the Wi-Fi one first where it can be told
 */
function localAddresses() {
  const found = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      /* Node 18 reports family as a number; older ones as a string. */
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal) continue;
      /* Wi-Fi first: a till is usually wired AND wireless, and the phone is on
         the wireless one. */
      const wireless = /wi-?fi|wlan|wireless/i.test(name);
      found[wireless ? 'unshift' : 'push']({ name, address: entry.address });
    }
  }
  return found;
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * Is this shop being reached at a public address, or on its own network?
 *
 * A cloud shop has one address that always works and that is the one to put on
 * the code. A till has as many as it has network cards, and the request tells
 * us nothing useful - the browser showing this page is usually on the till
 * itself.
 */
const isPrivateHost = (hostname) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * What the phone should be told, and how it was worked out.
 *
 * Exported so the decision can be tested without a server: which address ends
 * up on the code is the whole substance of this page.
 *
 * @param {{host: string, port: (string|number)}} request
 * @param {string[]} addresses  local IPv4 addresses, as from localAddresses()
 * @returns {{targets: Array<{url: string, label: string}>, cloud: boolean}}
 */
function pairingTargets(request, addresses) {
  const hostname = String(request.host || '').split(':')[0];

  /*
   * Reached at a public address: that address is the answer, and it keeps
   * working from anywhere, not only the shop's Wi-Fi.
   *
   * ALWAYS https, and never req.protocol.
   *
   * nginx terminates TLS and forwards plain http, so Express sees `http`
   * unless `trust proxy` is on - and it is only on when NODE_ENV says
   * production. Every other instance printed a QR code saying
   * `http://shop.posnic.io/api`, a phone scanned it, the address 301'd to
   * https, and the handset reported that nothing answered. The shop was told
   * to check whether their till was running.
   *
   * Reading X-Forwarded-Proto instead would fix that instance and leave the
   * next one to be discovered the same way. A PUBLIC host reached over the
   * internet is https - that is not a fact about this deployment, it is what
   * makes the address safe to put on a wall for waiters to scan. So it is
   * decided here, by what kind of address it is, and no header or environment
   * can get it wrong.
   *
   * The private branch below stays http on purpose: a till on a shop's Wi-Fi
   * holds no certificate, which is the whole reason the app declares
   * NSAllowsLocalNetworking and cleartext for local addresses.
   */
  if (hostname && !isPrivateHost(hostname)) {
    return {
      cloud: true,
      targets: [{ url: `https://${request.host}/api`, label: request.host }],
    };
  }

  const port = request.port || 5555;
  return {
    cloud: false,
    targets: addresses.map((entry) => ({
      url: `http://${entry.address}:${port}/api`,
      label: `${entry.address} (${entry.name})`,
    })),
  };
}

module.exports = { localAddresses, isPrivateHost, pairingTargets, escapeHtml };
