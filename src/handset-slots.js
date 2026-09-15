'use strict';

/*
 * WHICH HANDSETS THIS TILL WILL ANSWER, AND WHY ONE STOPPED.
 *
 * A till keeps a list of the devices talking to it, capped so a shop is not
 * silently serving a stranger's phone. The list is keyed by IP address, and
 * that is where the trouble starts.
 *
 * WHAT A SHOP ACTUALLY REPORTED
 *
 * Owner: "captain app keep disconnected... mobile till not responding after
 * seconds its connecting."
 *
 * Measured on his shop: ten wireless clients on one 2.4GHz router, phone
 * addresses moving whenever a lease renewed or a handset woke from sleep. Each
 * new address registered as a NEW device. Nothing ever expired - entries were
 * deleted only by hand, and they were written to disk, so a restart did not
 * clear them either. Six addresses in, every further request was refused 403.
 *
 * And the refusal landed on the health check. The captain app calls
 * /runtime-info every twenty seconds while it is connected and every four
 * while it is not, and it reads any non-ok response as "this server is
 * unreachable". So the till said 403, the app dropped it, rescanned the
 * network, found the same till, asked again, and was refused again - for ever.
 * That loop is the disconnection, and no router fixes it.
 *
 * SO, TWO RULES
 *
 *   A health check is not a device. It is how something asks whether this till
 *   is alive, it is public by design, and it must be answered even when every
 *   slot is taken - otherwise the cap stops meaning "six handsets" and starts
 *   meaning "nobody at all".
 *
 *   A slot nobody has used for a fortnight is not a handset. It is last
 *   month's DHCP lease, and holding it costs a real phone its place.
 *
 * Pure on purpose. The deciding is the part worth testing, and it cannot be
 * tested inside an HTTP server's emit override.
 */

/** Two weeks. Long enough to survive a holiday, short enough to self-heal. */
const IDLE_MS = 14 * 24 * 60 * 60 * 1000;

/** What a shop gets if it never says otherwise. */
const DEFAULT_MAX_DEVICES = 6;

/*
 * The endpoints that answer whether this till is alive.
 *
 * /runtime-info is documented in app.js as "public and tenant-free by design -
 * the login page and the update machinery read it before any authentication
 * exists", and healthz/readyz are the supervisor probes. None of them is a
 * handset doing business.
 */
const HEALTH = /\/(runtime-info|healthz|readyz)(?:\?|$)/;

/** Is this request only asking whether the till is up? */
function isHealthCheck(url) {
  return HEALTH.test(String(url || ''));
}

/**
 * Drop entries nobody has used for a fortnight. Mutates, and returns how many
 * went, so a caller can say so.
 */
function releaseIdle(devices, now = Date.now(), idleMs = IDLE_MS) {
  if (!devices || typeof devices !== 'object') return 0;
  let freed = 0;
  for (const [key, row] of Object.entries(devices)) {
    const seen = Date.parse(row && row.lastSeen);
    /* An entry with no readable lastSeen is left alone: it is more likely a
       shape this code has not met than a stale row, and evicting a live
       handset is the worse mistake. */
    if (Number.isFinite(seen) && now - seen > idleMs) {
      delete devices[key];
      freed += 1;
    }
  }
  return freed;
}

/**
 * May this request be served, and if not, what should the phone be told?
 *
 * @returns {{allow: boolean, register: boolean, code: string, message: string}}
 */
function admit({
  devices = {},
  blocked = null,
  ip = '',
  method = 'GET',
  url = '',
  maxDevices = DEFAULT_MAX_DEVICES,
  now = Date.now(),
} = {}) {
  const preflight = String(method).toUpperCase() === 'OPTIONS';
  const health = isHealthCheck(url);

  /* A browser's preflight is not a device and never was. */
  if (preflight) return { allow: true, register: false, code: '', message: '' };

  if (blocked && typeof blocked.has === 'function' && blocked.has(ip)) {
    return {
      allow: false,
      register: false,
      code: 'DEVICE_BLOCKED',
      message:
        'Your device has been blocked by the administrator. Please contact your admin to restore access.',
    };
  }

  /*
   * ANSWERED EVEN WHEN EVERY SLOT IS TAKEN.
   *
   * Refusing this is what turned a full list into a total outage: the app
   * cannot tell "refused" from "not there", so it spent its time rescanning a
   * network it was already connected to.
   */
  if (health) return { allow: true, register: false, code: '', message: '' };

  if (devices[ip]) return { allow: true, register: true, code: '', message: '' };

  releaseIdle(devices, now);

  const cap = Math.max(1, Number(maxDevices) || DEFAULT_MAX_DEVICES);
  if (Object.keys(devices).length >= cap) {
    return {
      allow: false,
      register: false,
      code: 'DEVICE_LIMIT_REACHED',
      /*
       * Says what to do. The old text was "Please contact your administrator",
       * which for a shop where the owner IS the administrator is an instruction
       * to contact himself about a screen he has never been told exists.
       */
      message:
        `This till is already answering ${cap} devices. Open Hardware Manager on the ` +
        'till, go to Mobile Devices, and clear the list - phones re-register by ' +
        'themselves. If this keeps happening, give each handset a fixed address on ' +
        'the router so it stops arriving as a new device.',
    };
  }

  return { allow: true, register: true, code: '', message: '' };
}

module.exports = {
  IDLE_MS,
  DEFAULT_MAX_DEVICES,
  isHealthCheck,
  releaseIdle,
  admit,
};
