'use strict';

/*
 * The address to put in an email, when the shop is the one sending it.
 *
 * WHAT WAS WRONG.
 *
 * Forgot-password built its link like this:
 *
 *   const serverName = process.env.SERVER_NAME || 'localhost';
 *   ... else if (cleanServerName.includes('localhost'))
 *         basePath = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/...`
 *
 * SERVER_NAME is set on no process in the estate. Neither is FRONTEND_URL. So
 * every cloud shop's reset email carried a link to
 * http://localhost:3000/forgotpassword.html - the recipient's own computer, on
 * a port with nothing listening. Self-service password recovery has therefore
 * never worked for a hosted shop, which is why a locked-out owner needed five
 * days and a database session to get back into his own till.
 *
 * WHY THIS IS NOT JUST `req.headers.host`.
 *
 * Password-reset poisoning is the oldest trick against exactly this code. Send
 * `Host: evil.example` to the reset endpoint, and the victim gets a real email,
 * from us, containing a link that hands their token to somebody else. The host
 * header is written by whoever is calling; it is not evidence of anything.
 *
 * This application cannot simply trust it either: unlike some multi-tenant
 * designs, the host does NOT select the database here - the process already
 * knows its shop - so a forged host would be accepted by everything downstream
 * without anybody noticing.
 *
 * So the order is: what an operator configured, then a host that matches a
 * domain we actually run, and nothing else. A shop with no answer sends no
 * link, because a dead link and a poisoned link are both worse than an error
 * we can see.
 */

/* The domains this company serves shops on. A host must end in one of these,
   or be exactly one of them, before it may appear in an email we send. */
const OWNED_SUFFIXES = ['.posnic.io', '.posnic.com', '.posnic.in'];

/* Custom domains a shop has been given (pos.sbala.in and the like). Comma
   separated, because they are rare and an operator sets them by hand. */
function allowedCustomDomains() {
  return String(process.env.PUBLIC_EXTRA_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** A hostname, and nothing that could be a path, a port trick or a credential. */
function looksLikeHostname(host) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(host);
}

function isOwnHost(host) {
  const bare = String(host || '')
    .toLowerCase()
    .split(':')[0];
  if (!bare) return false;
  if (OWNED_SUFFIXES.some((s) => bare.endsWith(s))) return true;
  if (allowedCustomDomains().includes(bare)) return true;
  /* Local development, where there is no domain to own. */
  return bare === 'localhost' || bare === '127.0.0.1';
}

/**
 * Where this shop lives, as far as anybody outside it is concerned.
 *
 * @param {object} [req]  the request, when there is one
 * @returns {string|null} an origin with no trailing slash, or null if we cannot
 *                        honestly say - in which case send no link at all.
 */
function publicBaseUrl(req) {
  /*
   * 1. What an operator said. A self-hosted shop behind its own name, or a
   *    provisioner that knows the address it just created, sets this and the
   *    guessing below never runs.
   */
  const configured = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/.test(configured)) return configured;

  /*
   * 2. The host this request actually arrived on - but only if it is a domain
   *    we run. This is what makes one build serve every shop correctly without
   *    a per-tenant environment variable, and the check is what stops it being
   *    a way to send our customers somebody else's link.
   */
  const headers = (req && req.headers) || {};
  const forwarded = String(headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const host = (forwarded || String(headers.host || '')).toLowerCase();
  if (host && looksLikeHostname(host) && isOwnHost(host)) {
    const proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
      ? String(headers['x-forwarded-proto'] || 'http')
          .split(',')[0]
          .trim()
      : 'https';
    return `${proto === 'http' ? 'http' : 'https'}://${host}`;
  }

  /*
   * 3. SERVER_NAME, kept because it is what the old code read and an operator
   *    may already have set it. `api.` is stripped: the API and the pages a
   *    person opens have historically been the same name with that prefix.
   */
  const serverName = String(process.env.SERVER_NAME || '')
    .trim()
    .replace(/^api\./, '');
  if (serverName && looksLikeHostname(serverName) && isOwnHost(serverName)) {
    return `https://${serverName}`;
  }

  /* Nothing trustworthy. The caller must not send a link. */
  return null;
}

/**
 * The full URL of a page this shop serves.
 *
 * The frontend is served at /public by the API's own origin - that is how the
 * desktop app loads it too - so a page link is the origin plus /public.
 */
function publicPageUrl(req, page, query = {}) {
  const base = publicBaseUrl(req);
  if (!base) return null;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}/public/${String(page).replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

module.exports = { publicBaseUrl, publicPageUrl, isOwnHost, looksLikeHostname };
