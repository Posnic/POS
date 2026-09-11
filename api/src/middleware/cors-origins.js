'use strict';
/*
 * Who may call this API from a browser, and the headers that say so.
 *
 * Lifted out of app.js for one reason: the rules had to run EARLIER than they
 * did. The public discovery endpoints - /api/runtime-info, /api/healthz,
 * /api/readyz - are registered near the top of app.js on purpose (before the
 * rate limiter, before the API router), and the CORS middleware sat six
 * hundred lines below them. Every one of those three answered a cross-origin
 * caller with no Access-Control-Allow-Origin header at all, so a browser threw
 * the response away.
 *
 * That is not a theoretical gap. The table-ordering app on a waiter's phone
 * finds the till by asking every address on the Wi-Fi whether it is a Posnic
 * server, and runtime-info is the only endpoint that can answer that question
 * honestly. Without the header the answer never reached the page, so discovery
 * fell back to "something replied on port 5555", which any printer or router
 * admin page satisfies.
 *
 * Kept free of app/service imports so the rules can be unit-tested without
 * standing up the application.
 */

// Origins granted access regardless of where the request arrives.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:5555',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5555',
  'http://qro.dev.posnic.io',
  'https://qro.dev.posnic.io',
  'http://qro.dev.posnic.io:5000',
  'https://qro.dev.posnic.io:5000',
  // Legacy Pro frontend. Keep both schemes while the development site is
  // still served over HTTP.
  'http://pro.dev.posnic.io',
  'https://pro.dev.posnic.io',
];

/*
 * The origins a packaged mobile app reports.
 *
 * A WebView does not run on a hostname anybody configured, and which string it
 * sends is decided by the packager, not by us. Capacitor on Android with
 * androidScheme "http" sends http://localhost; on iOS it sends
 * capacitor://localhost; an older Ionic shell sends ionic://localhost; and
 * file:// pages send the literal "null".
 *
 * "null" is deliberately NOT here. It is what a sandboxed iframe and an opaque
 * origin also send, so allowing it would open the API to any page that framed
 * itself - a real cross-site risk in exchange for supporting a packaging mode
 * this app does not use.
 */
const APP_SHELL_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];

const REQUEST_HEADERS =
  'Content-Type, Authorization, X-Requested-With, X-XSRF-TOKEN, X-Device-Id, X-Branch-Id, kioskkey';

const REQUEST_METHODS = 'GET,PUT,POST,DELETE,PATCH,OPTIONS';

/**
 * CORS_ORIGIN extends the application defaults instead of replacing them.
 * Replacing the list caused deployed frontends to lose access whenever an
 * environment-specific origin was configured.
 *
 * Read at call time rather than at require time: the desktop shell sets its
 * environment while starting, and a const evaluated on require would capture
 * whatever happened to be set when the first file pulled this in.
 */
function allowedOrigins(env = process.env) {
  const configured = String(env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...APP_SHELL_ORIGINS, ...configured])];
}

/*
 * A page served from the shop's own network.
 *
 * The till's browser, a kitchen display and a phone on the same Wi-Fi all have
 * private addresses that nobody can enumerate in advance, so they are matched
 * by shape instead of by list.
 */
const isPrivateNetworkOrigin = (origin = '') => {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname))
    );
  } catch (_) {
    return false;
  }
};

/*
 * A request from the page this very app served is same-origin: the browser
 * sends Origin on POST even then, and an exact-match allowlist cannot contain
 * a customer's own domain, so sign-in on a white-label domain failed with
 * "Not allowed by CORS" no matter what password was typed. Comparing the
 * Origin host against the Host we were reached on grants nothing extra -- a
 * cross-site page cannot forge Origin -- and needs no config per new domain.
 */
const isSameOriginRequest = (origin, req) => {
  if (!origin) return false;
  try {
    // req.headers.host is what the browser asked for; behind Cloudflare and
    // nginx that is still the customer's domain, which is what we want.
    return new URL(origin).host === String(req.headers.host || '').toLowerCase();
  } catch (_) {
    return false;
  }
};

const isAllowedOrigin = (origin, req) =>
  allowedOrigins().includes(origin) ||
  isPrivateNetworkOrigin(origin) ||
  isSameOriginRequest(origin, req);

/**
 * Set the response headers and answer preflights.
 *
 * Mount this before anything that produces a response a browser has to read
 * cross-origin - which now includes the discovery endpoints at the top of
 * app.js, not only the API router far below.
 */
function corsHeaders(req, res, next) {
  const origin = req.headers.origin;

  /*
   * The origin is checked the same way everywhere, production or not.
   *
   * This used to reflect whatever Origin arrived when NODE_ENV was not
   * 'production' - and three lines below, every response sets
   * Access-Control-Allow-Credentials: true. Those two together mean any web
   * page anywhere could make a credentialed request to the till and READ the
   * answer: the browser's cross-origin protection is precisely the thing
   * being handed away.
   *
   * That was not confined to a developer's laptop. The desktop app runs this
   * API on the till, and NODE_ENV is not 'production' there, so every shop was
   * shipping the permissive branch.
   *
   * Removing it costs local work nothing: isAllowedOrigin already accepts
   * localhost, 127.0.0.1 and the whole private-network range through
   * isPrivateNetworkOrigin, plus same-origin requests. Development was never
   * relying on the wildcard, only on being the same machine.
   */
  if (origin && isAllowedOrigin(origin, req)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Allow requests with no origin (curl, mobile apps, etc.)
    res.header('Access-Control-Allow-Origin', allowedOrigins()[0]);
  }

  res.header('Access-Control-Allow-Methods', REQUEST_METHODS);
  res.header('Access-Control-Allow-Headers', REQUEST_HEADERS);
  res.header('Access-Control-Allow-Credentials', 'true');

  // A response whose body changes with the caller must say so, or a shared
  // cache can hand one origin's Access-Control-Allow-Origin to another.
  res.header('Vary', 'Origin');

  // Handle OPTIONS method for preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return next();
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  APP_SHELL_ORIGINS,
  REQUEST_HEADERS,
  REQUEST_METHODS,
  allowedOrigins,
  isPrivateNetworkOrigin,
  isSameOriginRequest,
  isAllowedOrigin,
  corsHeaders,
};
