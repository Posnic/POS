require('dotenv').config({ quiet: true });
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { perShopKey } = require('./src/middleware/rate-limit-key');
const helmet = require('helmet');
const { filterXSS } = require('xss');
const hpp = require('hpp');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
/* A session store that follows the shop. It extends session.Store, lives in its
   own file, and is tested there - see src/session/tenant-session-store.js for
   why each of those three things matters. */
const { TenantAwareSessionStore } = require('./src/session/tenant-session-store');

function tenantAwareSessionStore() {
  return new TenantAwareSessionStore();
}
const { responseMiddleware } = require('./src/middleware/response');

const {
  errorHandler: globalErrorHandler,
  notFoundHandler,
  setupProcessHandlers,
} = require('./src/middleware/errorHandler');
const { AppError } = require('./src/utils/appError');
const config = require('./src/config/config');
const { isProduction } = require('./src/utils/auth-cookie');

// Import generated routes
const { attachDb } = require('./src/db/request-db');
const apiRouter = require('./src/routes');
const suppliersRoutes = require('./src/routes/suppliers.routes');

// Start express app
const app = express();

// nginx terminates TLS in live environments. Trust only the first proxy hop so
// Express can correctly recognize HTTPS and emit secure session cookies.
if (isProduction()) {
  app.set('trust proxy', 1);
}

/*
 * Compress every compressible response. The dependency sat in package.json
 * for months while the biggest payloads - a multi-megabyte dashboard bundle,
 * EJSON lists, CSV exports - crossed the shop's wire uncompressed. First in
 * the chain so everything downstream (static files included) benefits;
 * clients that already hold a gzip (or that nginx re-handles) negotiate via
 * Accept-Encoding as usual.
 */
app.use(require('compression')());

// 1) GLOBAL MIDDLEWARES
// Set security headers with CSP tuned for legacy frontend. We explicitly
// allow data: frames so that purchase/sales image previews (which render
// as data: iframes) behave like the original PHP implementation.
const cspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  // Google Tag Manager, Google Analytics and Sentry used to be allowed here.
  // They were allowed for a loader in twelve frontend pages that read
  // localStorage 'posnic_monitoring' and injected them if it was set. Nothing
  // in the product ever set it, so it never ran - but PRIVACY.md tells shops
  // there is no analytics library and no crash reporter, and a switch that
  // only needs one localStorage write is not that. The loader is gone and so
  // are the origins that existed to serve it.
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Allow existing inline scripts in legacy Frontend (login handlers, config)
    "'unsafe-eval'", // Required for ACL functionality in frontend
    /* cdnjs is no longer allowed. print.js used to be loaded from it into
       dashboard.html - which is the main application window, with a preload
       and the whole IPC surface behind it - with no integrity hash, so a bad
       response from a third party would have run as the application. It also
       meant barcode printing needed the internet, in a product whose first
       claim is that nothing does. It is vendored at
       frontend/public/script/vendor/print-js/ under its MIT licence. */
  ],
  'script-src-attr': ["'self'", "'unsafe-inline'"],
  'connect-src': ["'self'"],
  'img-src': [
    "'self'",
    'data:',
    // Product images are normalised to same-origin /uploads/ paths, so 'self'
    // covers the common case. https: is the safety net for any row still
    // holding a full cloud URL (a shop's own posnic.io/custom domain) that a
    // read path has not yet normalised: online it loads instead of being
    // blocked; offline the normalised relative path serves from disk. Images
    // only - this does not widen script-src or anything executable.
    'https:',
    'https://dev-upload-pro.s3.ap-south-1.amazonaws.com',
    'https://prod-upload-pro.s3.ap-south-1.amazonaws.com',
    'https://rzp.io',
    'https://api.razorpay.com',
    // Allow legacy dashboard (served from a different localhost port)
    // to load images hosted on the Node API (port 5000).
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    // Also allow images if the dashboard itself is served from 5555
    // and needs to embed assets from that origin explicitly.
    'http://localhost:5555',
    'http://127.0.0.1:5555',
  ],
  // Allow previews and embedded documents that use data: or same-origin
  // URLs inside <iframe> elements (purchase/sales attachment previews).
  'frame-src': [
    "'self'",
    'data:',
    'https://dev-upload-pro.s3.ap-south-1.amazonaws.com',
    'https://prod-upload-pro.s3.ap-south-1.amazonaws.com',
    // Allow embedding PDFs/images served by the Node API and local dashboard
    // in <iframe> elements used for receiving/sales attachment previews.
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://localhost:5555',
    'http://127.0.0.1:5555',
  ],
  // Older user agents may still consult child-src for nested browsing
  // contexts; mirror frame-src for safety.
  'child-src': [
    "'self'",
    'data:',
    'https://dev-upload-pro.s3.ap-south-1.amazonaws.com',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://localhost:5555',
    'http://127.0.0.1:5555',
  ],
};

/*
 * upgrade-insecure-requests comes in with helmet's default directives. On
 * the https production origin it is right; on a plain-http origin it
 * rewrites every asset fetch to https://<same-host> and the page loads
 * nothing. localhost is exempt (browsers treat it as trustworthy), which is
 * why this only ever bites when the local copy is opened from another
 * device - the owner's phone on the LAN (http://192.168.1.11:5055) got raw
 * HTML with every script and stylesheet red in the network tab.
 */
if (process.env.NODE_ENV !== 'production') {
  /* null, not delete: helmet merges these onto its defaults (useDefaults),
     so a missing key silently comes back - null is the documented way to
     switch a default directive off. */
  cspDirectives['upgrade-insecure-requests'] = null;
}

/*
 * Two policies, chosen per request: the locked-down one, and - only while
 * the shop's own Google Analytics feature is ON (a Settings toggle plus the
 * shop's own measurement id) - one that admits the Google domains. An
 * unconfigured shop never carries the wider policy, so the PRIVACY.md
 * promise is enforced by the header itself, not by convention.
 */
const { getAnalytics } = require('./src/services/analytics-config');
const gaCspDirectives = {
  ...cspDirectives,
  'script-src': [...cspDirectives['script-src'], 'https://www.googletagmanager.com'],
  'connect-src': [
    ...cspDirectives['connect-src'],
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://*.googletagmanager.com',
  ],
};
const helmetOptions = (directives) => ({
  contentSecurityPolicy: { directives },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
const helmetBase = helmet(helmetOptions(cspDirectives));
const helmetGa = helmet(helmetOptions(gaCspDirectives));
app.use((req, res, next) => {
  getAnalytics()
    .then((a) => (a.enabled ? helmetGa : helmetBase)(req, res, next))
    .catch(() => helmetBase(req, res, next));
});

/*
 * Cross-origin headers, before anything a browser reads cross-origin.
 *
 * This used to sit six hundred lines below, after the session and the static
 * mounts. Everything in the API router was covered; the three discovery
 * endpoints immediately below this line were not, because they are registered
 * early on purpose. A phone looking for the till on the shop Wi-Fi asks
 * /api/runtime-info whether an address is a Posnic server, and the answer was
 * thrown away by the browser for want of one header.
 *
 * Preflights now short-circuit here rather than after the session middleware,
 * which is both correct and cheaper: an OPTIONS request carries no cookie
 * worth resolving.
 */
const { corsHeaders, isAllowedOrigin } = require('./src/middleware/cors-origins');
const {
  protect: csrfProtect,
  RESPONSE_HEADER: CSRF_RESPONSE_HEADER,
} = require('./src/middleware/csrf');
app.use(corsHeaders);

/*
 * Health, for a supervisor rather than a person. Registered here, before the
 * rate limiter and before the API router, for three reasons.
 *
 * They must not be rate limited: something polling every few seconds is the
 * intended caller, and throttling it turns a healthy app into an unhealthy one
 * on the fourth check.
 *
 * They must not depend on the API router mounting successfully, because a
 * failure to build routes is exactly when a supervisor needs an answer.
 *
 * And the path has to be stable. Left in base.routes.js these were
 * /api/base/healthz, which is not a path anybody would guess or want to write
 * into a monitor.
 *
 * /health already existed and stays where it is - it is a human-readable
 * summary, and it needs the auth middleware to decide how much detail to give.
 * These two answer everyone, and only ever describe this process.
 */

/*
 * Liveness: this process exists and its event loop is turning.
 *
 * Deliberately does not touch the database. If MongoDB is down, restarting the
 * API will not bring it back, and a restart loop makes the outage worse. That
 * is what readyz is for.
 */
/*
 * Runtime identity: which edition, mode and version this process is
 * (PRODUCT_ARCHITECTURE §1; SEAMLESS_UPDATE_ROADMAP U1). Public and
 * tenant-free by design - the login page and the update machinery read it
 * before any authentication exists.
 */
/*
 * The page a till shows so a staff phone can be pointed at this shop.
 *
 * Mounted here, beside the other endpoints a device reaches before it has any
 * credential, and for the same reasons: it must not be rate limited, must not
 * depend on the API router mounting, and its path has to be one a person can
 * be told over the phone.
 *
 * Public, and safe to be. The code carries an ADDRESS, not a credential - the
 * same thing the browser's URL bar already shows anyone looking at the till.
 */
app.use(['/pair', '/api/pair'], require('./src/routes/pair.routes'));

app.get('/api/runtime-info', async (req, res) => {
  const { buildRuntimeInfo } = require('./src/utils/runtime-info');
  const info = buildRuntimeInfo();
  /* the login page injects the shop's own GA pre-auth from here - the id is
     not a secret (it sits in the page source of every GA-carrying site) */
  try {
    info.analytics = await getAnalytics();
  } catch (e) {
    info.analytics = { enabled: false, id: '' };
  }
  info.demo = require('./src/config/demo-mode').isDemoMode();
  return res.status(200).json(info);
});
app.get('/runtime-info', async (req, res) => {
  const { buildRuntimeInfo } = require('./src/utils/runtime-info');
  const info = buildRuntimeInfo();
  try {
    info.analytics = await getAnalytics();
  } catch (e) {
    info.analytics = { enabled: false, id: '' };
  }
  info.demo = require('./src/config/demo-mode').isDemoMode();
  return res.status(200).json(info);
});

app.get('/api/healthz', (req, res) => {
  const lag = require('./src/utils/event-loop-lag');

  /* The peak over the last minute, not the newest sample. A stall lasts
     seconds and a supervisor polls slowly, so by the time anyone asks, a fresh
     sample has usually replaced the spike that mattered. */
  const peakMs = lag.peakLagMs();
  const alive = peakMs < 5000;

  return res.status(alive ? 200 : 503).json({
    status: alive ? 'alive' : 'stalled',
    uptimeSeconds: Math.round(process.uptime()),
    eventLoopLagMs: Math.round(lag.currentLagMs()),
    eventLoopPeakLagMs: Math.round(peakMs),
  });
});

/*
 * Readiness: this process can actually serve a sale.
 *
 * A supervisor seeing this fail should hold traffic and wait rather than
 * restart - the usual cause is MongoDB restarting underneath, and the
 * connection recovers on its own.
 */
app.get('/api/readyz', async (req, res) => {
  const mongoose = require('mongoose');
  const started = Date.now();

  const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const state = mongoose.connection?.readyState;

  if (state !== 1) {
    return res.status(503).json({
      status: 'not-ready',
      database: STATES[state] ?? 'unknown',
      reason: 'no database connection',
    });
  }

  try {
    /* readyState is what the driver believes. A ping is what the server
       actually answers, and the difference is the interesting case. */
    await mongoose.connection.db.admin().ping();
  } catch (error) {
    return res.status(503).json({
      status: 'not-ready',
      database: 'connected',
      reason: 'database did not answer a ping',
      detail: error.message,
    });
  }

  return res.json({
    status: 'ready',
    database: 'connected',
    pingMs: Date.now() - started,
  });
});

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit requests from same API
// Increased limits for development - frontend makes many requests on page load
//
// Left in process memory on purpose, unlike the sign-in limiters in
// middleware/auth-rate-limit.js. This one sees every request, so a shared store
// would mean a database write per request to guard a threshold of 1000 - real
// load in exchange for very little. It guards abuse rather than credentials,
// and a per-process counter is the cheap way to do that.
//
// The key is what makes that safe once one process serves many shops.
//
// It used to default to req.ip alone. With a process per shop that was a
// thousand requests per address per shop, because the process only ever saw one
// shop. Sharing a process turned the same line into a thousand requests per
// address for *all* shops at once - one busy till could exhaust the allowance
// and the next shop's cashier got "Too many requests" for something they had no
// part in. Measured, not theorised: a load test against twenty shops produced
// 429s on shops it had not touched yet.
//
// So the shop is part of the key. Each one keeps the allowance it had before,
// and no shop can spend another's.
const limiter = rateLimit({
  // `max` was renamed `limit` in express-rate-limit 7; the old name still
  // works and warns.
  limit: 1000,
  windowMs: 15 * 60 * 1000, // Reduced window to 15 minutes (from 1 hour)
  message: 'Too many requests from this IP, please try again later!',
  // Per shop, per client - see src/middleware/rate-limit-key.js for why this
  // one includes the shop and the sign-in limiters deliberately do not.
  keyGenerator: perShopKey,
  // Skip rate limiting for GET requests to JSON endpoints
  skip: (req) => {
    // Allow GET requests to JSON data endpoints
    if (
      req.method === 'GET' &&
      (req.path.includes('/getJSON') ||
        req.path.includes('/getPaymentAll') ||
        req.path.includes('/getTaxAjaxList') ||
        req.path.includes('/getUnitAjaxList') ||
        req.path.includes('/getCategoryAjaxList') ||
        req.path.includes('/getVariantsAjaxList') ||
        req.path.includes('/getCustomerCategoryAjaxList') ||
        req.path.includes('/AjaxList'))
    ) {
      return true; // Skip rate limiting
    }
    // Allow OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      return true;
    }
    return false;
  },
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
// Allow larger payloads for CSV imports and base64 image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Recover from JSON parse errors caused by the legacy frontend.
// The legacy jQuery frontend sets contentType:'application/json' but sometimes
// sends URL-encoded data (e.g. `branch_id=`).  express.json() rejects this with
// a 400 "entity.parse.failed".  PHP's json_decode() simply returns null in such
// cases, so we replicate that tolerance here: catch the parse error, try to
// interpret the raw body as URL-encoded form data, and continue.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' && err.status === 400) {
    // Try to parse the raw body as URL-encoded form data
    if (typeof err.body === 'string' && err.body.length > 0) {
      try {
        const querystring = require('querystring');
        req.body = querystring.parse(err.body);
      } catch (_) {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    return next(); // Continue processing with the recovered body
  }
  next(err); // Pass other errors through
});

const { filterGuard } = require('./src/middleware/filter-guard');

// Sanitization function to prevent NoSQL injection
const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  return Object.entries(obj).reduce((acc, [key, value]) => {
    // Skip if the key starts with $ to prevent NoSQL injection
    if (key.startsWith('$')) {
      console.warn(`Potentially unsafe parameter '${key}' was removed`);
      return acc;
    }

    // Recursively sanitize nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      acc[key] = sanitize(value);
    } else if (Array.isArray(value)) {
      acc[key] = value.map((item) =>
        item !== null && typeof item === 'object' ? sanitize(item) : item
      );
    } else {
      acc[key] = value;
    }

    return acc;
  }, {});
};

// Custom NoSQL injection protection middleware
app.use((req, res, next) => {
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitize({ ...req.query });
  }

  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitize({ ...req.body });
  }

  /* The gap the sanitiser above cannot see into: a filter arriving as a JSON
     STRING is one ordinary-looking value to that walk, so its operators
     survive to be parsed and spread into a live query. See
     src/middleware/filter-guard.js - it is its own file so the behaviour can
     be tested, which an inline closure in this file could not be. */
  return filterGuard(req, res, next);
});

// XSS protection middleware
app.use((req, res, next) => {
  // Sanitize query parameters
  if (req.query) {
    const sanitizedQuery = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        sanitizedQuery[key] = filterXSS(value);
      } else {
        sanitizedQuery[key] = value;
      }
    }
    // Replace the query object with our sanitized version
    Object.keys(req.query).forEach((key) => delete req.query[key]);
    Object.assign(req.query, sanitizedQuery);
  }

  // Sanitize request body
  if (req.body) {
    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      const sanitized = Array.isArray(obj) ? [] : {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          sanitized[key] = filterXSS(value);
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    req.body = sanitizeObject(req.body);
  }

  next();
});

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: [
      'duration',
      'ratingsQuantity',
      'ratingsAverage',
      'maxGroupSize',
      'difficulty',
      'price',
    ],
  })
);

// ---- white label -----------------------------------------------------------
// Branding is applied here rather than baked in at build time, so a customer
// changing their logo does not mean a 180 MB reinstall. The stock logo paths
// are intercepted and answered with the brand's PNG when one is set, which
// means no page markup has to change.
//
// Two sources: the desktop app writes the brand into its own data folder after
// the gateway hands it over, and a cloud shop reads it from its own database.
const BRAND_DIR = process.env.POSNIC_BRAND_DIR || null;
const BRAND_TTL_MS = 30_000;
let brandCache = { at: 0, brand: null };

async function loadBrand() {
  if (Date.now() - brandCache.at < BRAND_TTL_MS) return brandCache.brand;
  let brand = null;
  try {
    if (BRAND_DIR) {
      const file = path.join(BRAND_DIR, 'brand.json');
      if (fs.existsSync(file)) brand = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        brand = await mongoose.connection.db.collection('app_brand').findOne({ _id: 'brand' });
      }
    }
  } catch (err) {
    brand = null; // branding must never be the reason a till fails to load
  }
  brandCache = { at: Date.now(), brand: brand && brand.enabled ? brand : null };
  return brandCache.brand;
}

function brandLogoBytes(brand, which) {
  if (BRAND_DIR) {
    const file = path.join(
      BRAND_DIR,
      which === 'loginLogo' ? 'brand-login-logo.png' : 'brand-logo.png'
    );
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  const val = brand[which];
  if (!val) return null;
  return val.buffer ? Buffer.from(val.buffer) : Buffer.isBuffer(val) ? val : null;
}

// posnic-logo.svg is the small mark top left; posnic.svg is the big one on the
// sign-in and error pages. Both are served under a few prefixes depending on
// where the page was loaded from.
// Match the logo wherever it is asked for. The prefix depends on which page
// made the request and which static mount is in play -- /static/..,
// /public/static/.., and the double /static/static/.. of the bundled build all
// occur -- and an exact list of prefixes only has to miss one to put our logo
// on a customer's till.
const BRAND_LOGO_RE = /(?:^|\/)images\/logo\/(posnic-logo|posnic)\.svg$/;

// Both paths on purpose. The desktop app serves its pages from /public/, so
// the page's own relative request lands on /public/brand.json, which was a 404
// on every single page load: the app knew the brand, and the page could not
// ask for it, so a white-label till showed our name everywhere.
const serveBrandJson = async (_req, res) => {
  const brand = await loadBrand();
  res.set('cache-control', 'no-store');
  res.json(brand ? { enabled: true, name: brand.name || '' } : { enabled: false });
};
// Registered separately rather than as an array: path matching changed in
// Express 5, and this route being silently unmatched is the whole bug.
app.get('/brand.json', serveBrandJson);
app.get('/public/brand.json', serveBrandJson);

/*
 * Put the customer's name in the HTML, before any script runs.
 *
 * The page ships with our name in the title and the sidebar heading, and a
 * script replaces it once brand.json has been fetched. That works, and the
 * result is cached so it usually lands before anything is painted - but not on
 * a first visit, a new browser, a private window, or after somebody clears
 * their storage. In each of those the customer sees "Posnic" for a moment on
 * their own till: the wrong company name, on screen, every time it is opened
 * fresh.
 *
 * Rewriting it here means the first paint is already right and no script has to
 * run at all. The script stays, because it still handles the desktop title bar.
 *
 * Three specific places are rewritten rather than every occurrence of the word:
 * dashboard.html carries inline scripts full of PosnicPro identifiers, and a
 * blanket replace would rename those and break the page.
 */
const brandedHtmlCache = new Map();

const rewriteBrandedHtml = (html, name) =>
  html
    .replace(
      /(<title>)([\s\S]*?)(<\/title>)/i,
      (_, a, text, b) => a + text.replace(/PosnicPro|POSNIC|Posnic/g, name) + b
    )
    .replace(/(<h1 class="title_h2">)([\s\S]*?)(<\/h1>)/i, (_, a, _text, b) => a + name + b)
    .replace(/<meta[^>]+name="(?:author|description)"[^>]*>/gi, (tag) =>
      tag.replace(/PosnicPro|POSNIC|Posnic/g, name)
    );

app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!/\.html$/i.test(req.path)) return next();

  let brand;
  try {
    brand = await loadBrand();
  } catch (e) {
    brand = null;
  }
  if (!brand || !brand.name) return next();

  // The page can live under either mount depending on how it was reached.
  const rel = req.path.replace(/^\/(public\/)?/, '');
  const file = [
    path.join(__dirname, '..', 'frontend', 'public', rel),
    path.join(__dirname, 'public', rel),
  ].find((p) => fs.existsSync(p));
  if (!file) return next();

  /*
   * Keyed on the file's modification time as well as its name.
   *
   * Without that this cache never noticed a deploy: a corrected login.html was
   * copied onto the server and every visitor kept getting the previous one out
   * of memory until somebody happened to restart the process. The bug is
   * invisible from outside - the file on disk is right, and the page served is
   * not.
   */
  let stamp;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch (e) {
    return next();
  }

  const key = file + ' ' + brand.name + ' ' + stamp;
  let html = brandedHtmlCache.get(key);
  if (html === undefined) {
    try {
      html = rewriteBrandedHtml(fs.readFileSync(file, 'utf8'), brand.name);
    } catch (e) {
      return next(); // unreadable for any reason: serve it the ordinary way
    }
    // Only the current version is worth keeping; older ones are dead weight
    // that would otherwise accumulate with every deploy.
    for (const old of brandedHtmlCache.keys()) {
      if (old.startsWith(file + ' ')) brandedHtmlCache.delete(old);
    }
    brandedHtmlCache.set(key, html);
  }
  res.type('html').set('cache-control', 'no-store').send(html);
});

app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const m = BRAND_LOGO_RE.exec(req.path);
  if (!m) return next();
  try {
    const brand = await loadBrand();
    if (!brand) return next();
    const bytes = brandLogoBytes(brand, m[1] === 'posnic-logo' ? 'logo' : 'loginLogo');
    if (!bytes) return next();
    res.set('content-type', 'image/png');
    res.set('cache-control', 'no-cache');
    return res.send(bytes);
  } catch (err) {
    return next(); // fall through to the stock logo
  }
});

/*
 * Updated assets, if this installation has any, ahead of the shipped ones.
 *
 * The desktop app can apply a signed set of frontend files without running an
 * installer - a crooked receipt or a mislabelled button fixed the same day
 * rather than whenever something big enough justifies a reinstall. It points
 * this at the directory it decided to serve; see asset-updater.js for how that
 * decision is made and undone.
 *
 * Mounted with fallthrough, so an update that carries three files leaves every
 * other file coming from the installer. Absent or unset, nothing here happens
 * at all, which is the case for the browser app and for any till that has
 * never taken an update.
 */
const UPDATED_ASSETS = process.env.POSNIC_ASSET_DIR;

/*
 * Cache policy for the built frontend.
 *
 * Bundle filenames carry a content hash (script/dashboard.<hash8>.js), so the
 * bytes behind such a URL can never change - a browser or CDN may keep them
 * for a year and serve them without ever asking again. The HTML pages keep
 * their plain names and must revalidate on every load: the page is what flips
 * to the new hashed URLs, so it is the one thing that may never be stale.
 */
const HASHED_ASSET = /\.[0-9a-f]{8}\.(js|css)$/;
const STATIC_MEDIA = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|otf|mp3|wav)(\?.*)?$/i;
function assetCacheHeaders(res, filePath) {
  if (HASHED_ASSET.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache');
  } else if (STATIC_MEDIA.test(filePath)) {
    /*
     * Fonts and images went out with NO Cache-Control (this function only
     * labelled the hashed bundles and html), so Cloudflare stamped its 4h
     * default - Lighthouse: "use efficient cache lifetimes, 2,718 KiB".
     * These names are not hashed, so not immutable - but a week is honest
     * for artwork and font files that change a few times a year, and the
     * service worker's versioned cache still refreshes them per release.
     */
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}

if (UPDATED_ASSETS && fs.existsSync(UPDATED_ASSETS)) {
  console.log('[assets] serving updated assets from ' + UPDATED_ASSETS);
  app.use(
    '/',
    express.static(UPDATED_ASSETS, { fallthrough: true, setHeaders: assetCacheHeaders })
  );
}

// Serve transformed frontend assets (used for login page, etc.)
app.use(
  '/',
  express.static(path.join(__dirname, '..', 'frontend', 'public'), {
    fallthrough: true,
    setHeaders: assetCacheHeaders,
  })
);

// Assets from the built frontend: /static/... and /fonts/...
//
// These pointed at public/static/static, a directory the build has not
// written in a long time. They only ever resolved because an older copy of
// that tree was still sitting on the server, so any clean deploy broke the
// font faces, which is exactly what happened. gulp copies assets to
// public/static, so point at that.
const BUILT_STATIC = path.join(__dirname, '..', 'frontend', 'public', 'static');

/*
 * App art (fonts, icons, images, reference JSON files) changes rarely and
 * only with releases: a week of HTTP cache (SW roadmap W2). The service
 * worker already shields repeat visits; this covers SW-less contexts. Art
 * that must change immediately should change NAME - same discipline as the
 * bundles, documented in SERVICE_WORKER_CACHING_STRATEGY.md.
 */
const STATIC_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

app.use('/static', express.static(BUILT_STATIC, { fallthrough: true, maxAge: STATIC_MAX_AGE }));

/*
 * Print documents, served from this origin so they need no exception.
 *
 * The receipt window used to load its HTML as a data: URL, whose origin is
 * opaque - and the invoice markup links print.css and the shop's logo from
 * this server. An opaque origin may not load either, so that window ran with
 * web security disabled, and every audit flagged it.
 *
 * Serving the document from here makes the page, the stylesheet and the logo
 * same-origin, so nothing is cross-origin and the exception is unnecessary.
 *
 * Loopback only, single use, and gone in a minute. The document is a
 * customer's invoice: it is held in memory rather than written to a temporary
 * file, because a file would outlive the print job.
 */
app.get('/print/:token', (req, res) => {
  const remote = req.socket.remoteAddress || '';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLoopback) return res.status(403).end();

  let store;
  try {
    /* packaged: resources/api beside resources/print-document-store.js */
    store = require('../print-document-store');
  } catch (e) {
    try {
      /* dev checkout: the desktop shell lives in src/ */
      store = require('../src/print-document-store');
    } catch (e2) {
      return res.status(503).end();
    }
  }

  const html = store.take(req.params.token);
  if (!html) return res.status(404).end();

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(html);
});

// The compiled stylesheets reference ../fonts, which resolves to /fonts.
app.use(
  '/fonts',
  express.static(path.join(BUILT_STATIC, 'fonts'), { fallthrough: true, maxAge: STATIC_MAX_AGE })
);

// Serving backend-specific static files (exports, uploads, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Serve public folder with CORS headers for images like default.png
app.use(
  '/public',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'public'))
);

// Also serve at root for backward compatibility
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files (receiving images, etc.) with CORS headers
app.use(
  '/uploads',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);

/*
 * Anything express.static could not find on this machine.
 *
 * Images are stored as a key rather than a URL, and the same relative path is
 * rendered by the till and by the web app - each resolves it against its own
 * origin. This handles the case where the bytes are not on THIS machine yet:
 * it pulls them from S3 once and keeps a copy, so a new or reinstalled till
 * heals itself the first time somebody looks at each image.
 *
 * Mounted after the static handler on purpose. Files that are already on disk
 * never reach it, which keeps the common case - a shop serving its own images
 * with the line down - exactly as fast as it was.
 */
app.use('/uploads', require('./src/routes/uploads.route'));

// Cookie parser middleware - MUST be before session middleware so that
// req.cookies is populated when session and auth middleware run.
// lgtm[js/missing-token-validation] csrfProtect below validates the reflected,
// credential-bound X-XSRF-TOKEN for every cookie-authenticated unsafe request.
app.use(cookieParser());

// Session configuration
app.use(
  session({
    // Never a literal - see config/signing-secret for why.
    /* Per shop where there is one. A single secret across a shard would let a
       cookie minted for one customer be accepted for another. */
    secret: [
      process.env.SESSION_SECRET ||
        require('./src/config/signing-secret').ephemeralSecret('SESSION_SECRET'),
    ],
    resave: false,
    saveUninitialized: false,
    proxy: isProduction(),
    /*
     * Sessions land in the shop's own database, not the process's.
     *
     * config.database.uri is the connection this process was started with. For
     * a shop serving itself that is the shop; in a shard it is the control
     * cluster, so every shop's sessions would share one collection - and the
     * signing secret above is process-wide too, so a cookie minted for one shop
     * would validate on another.
     *
     * The store is therefore resolved per request from the shop in context. The
     * secret is handled the same way a few lines up.
     */
    store: tenantAwareSessionStore(),
    /*
     * Sliding expiry, not a fixed one. Without rolling, the 24h below counts
     * from SIGN-IN, so a cashier who opened the till in the morning was thrown
     * out mid-sale exactly 24 hours later, however busy the counter - the
     * session died at its busiest. Rolling resets the window on every request
     * (connect-mongo's touch keeps the store's TTL in step), so an active till
     * never expires and an abandoned browser still does, 24h after it was
     * last used.
     */
    rolling: true,
    cookie: {
      secure: isProduction(),
      sameSite: isProduction() ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day of INACTIVITY, not of shift
    },
  })
);

/* Cookie-backed writes need a token that another site cannot read. The
   frontend learns it from the CORS-exposed response header and reflects it on
   subsequent unsafe requests; bearer-token and API-key callers are unaffected.
 */
app.use(csrfProtect);

// Regular CORS for all other requests.
// Built per request so the same-origin check can see the Host we were reached
// on; the static option form only receives the Origin header.
const buildCorsOptions = (req) => ({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    if (isAllowedOrigin(origin, req)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-XSRF-TOKEN',
    'X-Device-Id',
    'X-Branch-Id',
    'kioskkey',
  ],
  exposedHeaders: ['set-cookie', CSRF_RESPONSE_HEADER],
});
app.use(cors((req, callback) => callback(null, buildCorsOptions(req))));

// Response middleware (PHP-compatible format)
app.use(responseMiddleware);

// Welcome route (PHP-compatible format)
app.get('/', (req, res) => {
  res.status(200).json({
    type: 'success',
    message: 'Welcome to the Posnic API v2',
    data: {
      version: '2.0.0',
      documentation: '/api-docs',
      endpoints: '/api',
    },
  });
});

/*
 * Browsable API reference at /api-docs, development only.
 *
 * swagger-ui-express is a devDependency and is deliberately not shipped: the
 * installer is downloaded by shops on slow connections and every megabyte is
 * accounted for. The require is guarded so a production install, where the
 * package is absent, carries on without it rather than failing to boot.
 *
 * Regenerate the spec with `npm run docs:api`.
 */
if (process.env.NODE_ENV !== 'production') {
  try {
    const swaggerUi = require('swagger-ui-express');
    const specPath = path.join(__dirname, '..', 'docs', 'openapi.json');
    if (fs.existsSync(specPath)) {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
      app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(spec, {
          customSiteTitle: 'Posnic API',
          swaggerOptions: { persistAuthorization: true },
        })
      );
      console.log('[docs] API reference at /api-docs');
    }
  } catch (_) {
    // Not installed, which is the normal case outside development.
  }
}

/* Every request gets req.db before any route sees it. Mounted here rather than
   inside the routers so there is one answer to "which database is this request
   for", which is what makes serving more than one shop from a process safe. */
app.use(attachDb);

/*
 * Realtime (S2): every successful write publishes a coarse change signal to
 * the shop's other tills, and /events is the SSE stream they hold open.
 * Sits right after attachDb so the tenant key exists, and before the
 * routers so no write seam can be missed. The stream carries invalidation
 * signals only - never data - so it cannot leak what a till could not have
 * fetched itself; see src/realtime/ for both halves.
 */
const { changeEvents } = require('./src/realtime/change-events');
const { subscribe: sseSubscribe } = require('./src/realtime/event-bus');
const { protect: sseProtect } = require('./src/middleware/auth');
app.use(changeEvents);

/*
 * /api/v1 - the versioned facade (INTEGRATIONS_ROADMAP I4). Read-only in
 * v1.0; scoped tokens are the intended caller. Registered with both path
 * forms like every infra endpoint.
 */
require('./src/v1').registerV1({ app, protect: sseProtect });

const sseEvents = (req, res) => {
  if (!req.db) return res.status(503).json({ type: 'error', message: 'No shop in context' });
  /* text/event-stream is not a compressible type, so the compression
     middleware passes it through unbuffered; no-transform tells any proxy
     the same. X-Accel-Buffering switches off nginx response buffering,
     without which events would arrive in batches whenever a buffer filled. */
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sub = sseSubscribe(req.db.databaseName, res);
  if (!sub.ok) {
    /* Over the per-shop cap: tell the browser to retry much later rather
       than hammering; the poll fallbacks keep the till usable meanwhile. */
    res.write('retry: 60000\n\n');
    res.end();
    return;
  }
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  req.on('close', () => sub.unsubscribe());
};
app.get('/api/events', sseProtect, sseEvents);
app.get('/events', sseProtect, sseEvents);

/*
 * Web Push (SW roadmap W4) - the pipe only; what may notify is a gated
 * product decision, so the sole sender is the caller-addressed test.
 * Mounted here beside /events for the same reason it is: infra endpoints
 * live with their middleware, out of the generated API docs.
 */
/*
 * Every infra endpoint below is registered under BOTH the bare path and the
 * /api-prefixed one, exactly like /events above: deployments differ in
 * whether the proxy strips the /api prefix, and on the ones that keep it a
 * bare-only registration is a live 404 (which is how webhooks, push and
 * api-tokens shipped unreachable the first time).
 */
const pushInfra = require('./src/realtime/push');
app.get(['/push/key', '/api/push/key'], sseProtect, async (req, res) => {
  try {
    const key = req.db ? await pushInfra.getPublicKey(req.db) : null;
    if (!key) return res.status(503).json({ type: 'error', message: 'Push unavailable' });
    res.json({ type: 'success', data: { key } });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Push unavailable' });
  }
});
app.post(['/push/subscribe', '/api/push/subscribe'], sseProtect, async (req, res) => {
  try {
    const result =
      req.db && req.user
        ? await pushInfra.subscribe(req.db, req.user._id, req.body && req.body.subscription)
        : { ok: false };
    if (!result.ok) return res.status(400).json({ type: 'error', message: 'Invalid subscription' });
    res.json({ type: 'success', data: null, message: 'Subscribed' });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Subscription failed' });
  }
});
/*
 * Webhook management (integration platform step 1). Branch-write holders
 * only: registering an endpoint means every future change signal of the
 * chosen entities leaves the building. The secret is returned exactly once,
 * at creation.
 */
const webhookInfra = require('./src/realtime/webhooks');
const requireBranchWrite = (req, res, next) => {
  const u = req.user;
  if (u && u.access && u.access.branch && u.access.branch.write === true) return next();
  return res.status(403).json({ type: 'error', message: 'Unauthorized' });
};
app.get(['/webhooks', '/api/webhooks'], sseProtect, requireBranchWrite, async (req, res) => {
  try {
    const rows = await webhookInfra.listSubscriptions(req.db);
    res.json({
      type: 'success',
      data: rows.map((r) => ({
        id: r._id,
        url: r.url,
        events: r.events,
        description: r.description,
        active: r.active,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Could not list webhooks' });
  }
});
app.post(['/webhooks', '/api/webhooks'], sseProtect, requireBranchWrite, async (req, res) => {
  try {
    const result = await webhookInfra.addSubscription(req.db, req.body || {});
    if (!result.ok) return res.status(400).json({ type: 'error', message: result.reason });
    res.json({
      type: 'success',
      data: { id: result.id, secret: result.secret },
      message: 'Webhook registered. Store the secret now - it is not shown again.',
    });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Could not register webhook' });
  }
});
app.delete(
  ['/webhooks/:id', '/api/webhooks/:id'],
  sseProtect,
  requireBranchWrite,
  async (req, res) => {
    try {
      const result = await webhookInfra.removeSubscription(req.db, req.params.id);
      res.json({
        type: result.ok ? 'success' : 'error',
        data: null,
        message: result.ok ? 'Webhook removed' : 'Not found',
      });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Could not remove webhook' });
    }
  }
);
/*
 * Report email (owner ask): the client renders the exact PDF the user
 * saw on screen and posts it here; the server only addresses and sends
 * it through the same transport chain as the purchase-order mailer.
 * Branch-write holders: mailing a report sends shop data outward.
 */
app.post(
  ['/reports/email', '/api/reports/email'],
  sseProtect,
  requireBranchWrite,
  express.json({ limit: '12mb' }),
  async (req, res) => {
    try {
      const to = String(req.body?.to || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ type: 'error', message: 'Enter a valid email address' });
      }
      const b64 = String(req.body?.pdf_base64 || '');
      if (!b64 || b64.length > 12 * 1024 * 1024) {
        return res.status(400).json({ type: 'error', message: 'Report PDF missing or too large' });
      }
      const filename =
        String(req.body?.filename || 'report')
          .replace(/[^a-z0-9-_]/gi, '')
          .slice(0, 60) || 'report';
      const title = String(req.body?.title || 'Report').slice(0, 120);
      // Owner rule: the shop's own SMTP first, the platform chain otherwise.
      const { resolveShopTransport } = require('./src/utils/email');
      let branchDoc = null;
      try {
        const bid = req.user && req.user.branch_id;
        if (bid && req.db) {
          branchDoc = await req.db
            .collection('branches')
            .findOne({ _id: new (require('mongodb').ObjectId)(String(bid)) });
        }
      } catch (e) {
        /* platform chain covers it */
      }
      const resolved = resolveShopTransport(branchDoc);
      const transporter = resolved.transporter;
      const shopName = (req.user && req.user.branch_name) || 'Posnic POS';
      const info = await transporter.sendMail({
        from: `${shopName} <${resolved.from}>`,
        to,
        subject: `${title} - ${shopName}`,
        text: `Please find attached: ${title}.`,
        attachments: [{ filename: `${filename}.pdf`, content: Buffer.from(b64, 'base64') }],
      });
      /* The dev fallback transport prints to console instead of delivering -
         say so rather than claiming a send that never left the box. */
      if (!resolved.shopOwned && transporter.options && transporter.options.jsonTransport) {
        return res.status(503).json({
          type: 'error',
          message: 'Email is not configured on this server - the PDF was generated but not sent',
        });
      }
      return res.json({
        type: 'success',
        data: { to, messageId: info.messageId || '' },
        message: 'Report emailed',
      });
    } catch (e) {
      console.error('Error in reports/email:', e);
      return res.status(500).json({ type: 'error', message: 'Could not email the report' });
    }
  }
);
/*
 * Scoped API tokens (integration platform step 2) - minted with an explicit
 * ACL subset, hashed at rest, plaintext shown exactly once. Branch-write
 * holders only: a token is a standing credential for the whole shop.
 */
const apiTokens = require('./src/utils/api-tokens');
app.get(['/api-tokens', '/api/api-tokens'], sseProtect, requireBranchWrite, async (req, res) => {
  try {
    const rows = await apiTokens.listTokens(req.db);
    res.json({
      type: 'success',
      data: rows.map((r) => ({
        id: r._id,
        name: r.name,
        hint: r.token_hint,
        access: r.access,
        active: r.active,
        createdAt: r.createdAt,
        last_used_at: r.last_used_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Could not list tokens' });
  }
});
app.post(['/api-tokens', '/api/api-tokens'], sseProtect, requireBranchWrite, async (req, res) => {
  try {
    const result = await apiTokens.createToken(req.db, {
      name: req.body && req.body.name,
      scopes: req.body && req.body.scopes,
      creator: req.user,
    });
    if (!result.ok) return res.status(400).json({ type: 'error', message: result.reason });
    res.json({
      type: 'success',
      data: { id: result.id, token: result.token, hint: result.hint },
      message: 'Token created. Store it now - it is not shown again.',
    });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Could not create token' });
  }
});
app.delete(
  ['/api-tokens/:id', '/api/api-tokens/:id'],
  sseProtect,
  requireBranchWrite,
  async (req, res) => {
    try {
      const result = await apiTokens.revokeToken(req.db, req.params.id);
      res.json({
        type: result.ok ? 'success' : 'error',
        data: null,
        message: result.ok ? 'Token revoked' : 'Not found',
      });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Could not revoke token' });
    }
  }
);

app.get(
  ['/webhooks/deliveries', '/api/webhooks/deliveries'],
  sseProtect,
  requireBranchWrite,
  async (req, res) => {
    try {
      res.json({ type: 'success', data: await webhookInfra.recentDeliveries(req.db) });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Could not list deliveries' });
    }
  }
);

/*
 * WhatsApp connector lane (I6): the signed connector (I5) drains the
 * outbox and mirrors its link state through these. The caller is a scoped
 * token minted for the connector; customer:write is the scope that says
 * "may message this shop's customers", and that is exactly what these do.
 */
const waOutbox = require('./src/services/whatsapp-outbox');
const requireCustomerWrite = (req, res, next) => {
  const a = req.user && req.user.access;
  if (a && a.customer && a.customer.write === true) return next();
  return res.status(403).json({ type: 'error', message: 'This token cannot message customers' });
};

app.post(
  ['/connector/whatsapp/claim', '/api/connector/whatsapp/claim'],
  sseProtect,
  requireCustomerWrite,
  async (req, res) => {
    try {
      if (!req.db) return res.status(503).json({ type: 'error', message: 'No shop in context' });
      const rows = await waOutbox.claim(req.db, req.user.license, {
        limit: (req.body || {}).limit,
      });
      res.json({ type: 'success', data: rows });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Claim failed' });
    }
  }
);

app.post(
  ['/connector/whatsapp/result', '/api/connector/whatsapp/result'],
  sseProtect,
  requireCustomerWrite,
  async (req, res) => {
    try {
      if (!req.db) return res.status(503).json({ type: 'error', message: 'No shop in context' });
      const { id, ok, error } = req.body || {};
      const r = await waOutbox.report(req.db, req.user.license, id, { ok: ok === true, error });
      res.json({ type: 'success', data: r });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Report failed' });
    }
  }
);

app.get(
  ['/connector/whatsapp/state', '/api/connector/whatsapp/state'],
  sseProtect,
  requireCustomerWrite,
  async (req, res) => {
    try {
      if (!req.db) return res.status(503).json({ type: 'error', message: 'No shop in context' });
      // The connector's view: every branch's link state, including the
      // 'init_requested' rows that tell it a screen is waiting for a QR.
      const rows = await req.db.collection('whatsapp_connector_state').find({}).toArray();
      res.json({
        type: 'success',
        data: rows.map((r) => ({
          branch_id: r.branch_id ? String(r.branch_id) : null,
          device_id: r.device_id || '',
          status: r.status || 'unknown',
          updated_date: r.updated_date,
        })),
      });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'Could not read state' });
    }
  }
);

app.post(
  ['/connector/whatsapp/state', '/api/connector/whatsapp/state'],
  sseProtect,
  requireCustomerWrite,
  async (req, res) => {
    try {
      if (!req.db) return res.status(503).json({ type: 'error', message: 'No shop in context' });
      const { branch_id, device_id, status, qr } = req.body || {};
      await waOutbox.recordState(req.db, req.user.license, { branch_id, device_id, status, qr });
      res.json({ type: 'success' });
    } catch (e) {
      res.status(500).json({ type: 'error', message: 'State update failed' });
    }
  }
);

app.post(['/push/test', '/api/push/test'], sseProtect, async (req, res) => {
  try {
    const result =
      req.db && req.user
        ? await pushInfra.sendToUser(req.db, req.user._id, {
            title: 'Posnic',
            body: 'Notifications are working on this device.',
            url: '/dashboard.html#/dashboard',
          })
        : { sent: 0 };
    res.json({
      type: 'success',
      data: result,
      message: result.sent ? 'Sent' : 'No subscriptions on this device yet',
    });
  } catch (e) {
    res.status(500).json({ type: 'error', message: 'Send failed' });
  }
});

// Mount API routes under /api
app.use('/api', apiRouter);

// Root API endpoint - provides basic API info and prevents 404 on /api
app.get('/api', (req, res) => {
  res.status(200).json({
    type: 'success',
    message: 'Posnic API v2 root',
    data: {
      version: '2.0.0',
      endpoints: '/api/*',
    },
  });
});

// Expose suppliers endpoints without the /api prefix for legacy clients
app.use('/suppliers', suppliersRoutes);

// Serve frontend static files
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use('/static', express.static(path.join(frontendPath, 'static'), { maxAge: STATIC_MAX_AGE }));
app.use(
  '/images',
  express.static(path.join(frontendPath, 'static', 'images'), { maxAge: STATIC_MAX_AGE })
);
app.use(
  '/fonts',
  express.static(path.join(frontendPath, 'static', 'fonts'), { maxAge: STATIC_MAX_AGE })
);
app.use(
  '/style',
  express.static(path.join(frontendPath, 'public', 'style'), { setHeaders: assetCacheHeaders })
);
app.use(
  '/script',
  express.static(path.join(frontendPath, 'public', 'script'), { setHeaders: assetCacheHeaders })
);
// Serve static files from /public/static for pages loaded from /public/
app.use('/public/static', express.static(path.join(frontendPath, 'static')));
app.use('/public/images', express.static(path.join(frontendPath, 'static', 'images')));
app.use('/public/fonts', express.static(path.join(frontendPath, 'static', 'fonts')));
app.use(
  '/public',
  express.static(path.join(frontendPath, 'public'), { setHeaders: assetCacheHeaders })
);
app.use(express.static(path.join(frontendPath, 'public'), { setHeaders: assetCacheHeaders }));

/*
 * The shop's own online ordering page.
 *
 * Served from the shop's origin so it is the same origin as the API it calls:
 * no CORS list to keep per shop, and - the part that actually bit customers -
 * no shared browser storage. The kiosk used to live on one host for the whole
 * estate, where IndexedDB is per-origin and therefore shared, which is why it
 * had to wipe its catalogue whenever it noticed a different branch. A customer
 * who ordered at two Posnic shops collided with themselves.
 *
 * TWO PAGES, NOT ONE BUNDLE WEARING TWO NAMES.
 *
 * `/menu` used to be `/order` with the cart hidden. That is a worse menu than
 * the paper it replaces: it carries 1,500 lines of IndexedDB, a cart and two
 * payment integrations to render a list of dishes, and it reads as a shop
 * that has taken its ordering away rather than as a menu.
 *
 * So they are separate bundles with separate jobs. `/order` transacts.
 * `/menu` is read-only: what the kitchen cooks, searchable, by category, with
 * the veg mark, and nothing on it that starts an order. A shop with ordering
 * switched on can still print a `/menu` code for its window; a shop in menu
 * mode has only ever needed this one.
 *
 * Mounted BEFORE the root API router, which answers `/items/...` and friends,
 * because that router is mounted at '/' and would otherwise see these paths
 * first. express.static redirects `/order` to `/order/` on its own, which is
 * what makes each bundle's relative asset paths resolve.
 */
const ORDER_BUNDLE = path.join(__dirname, '..', 'order');
const MENU_BUNDLE = path.join(__dirname, '..', 'menu');

/*
 * A missing bundle is SAID OUT LOUD.
 *
 * The existsSync guards below are deliberate - a desktop build that packaged
 * one and not the other should still boot - but silence was the bug. Neither
 * deploy workflow rsynced these directories, so the mounts were skipped and
 * every /menu and every /order URL answered 404 on every environment from the
 * day the feature shipped. A 404 reads as a routing problem, which is why it
 * survived review, a release, and months of use before somebody curled it.
 *
 * tests/bundle-deployment.test.js now pins the deploys to what is served here,
 * in both directions. This line is the second belt: if it ever happens again
 * the reason is in the log rather than in a support ticket.
 */
for (const [name, dir] of [
  ['menu', MENU_BUNDLE],
  ['order', ORDER_BUNDLE],
]) {
  if (!fs.existsSync(dir)) {
    console.warn(
      `[bundle] ${name}/ is not on disk at ${dir} - /${name} will answer 404 for every customer. The deploy did not ship it.`
    );
  }
}
if (fs.existsSync(MENU_BUNDLE)) {
  app.use('/menu', express.static(MENU_BUNDLE, { setHeaders: assetCacheHeaders }));
}
if (fs.existsSync(ORDER_BUNDLE)) {
  const orderStatic = express.static(ORDER_BUNDLE, { setHeaders: assetCacheHeaders });
  app.use('/order', orderStatic);

  /*
   * `/order/AZ100` - the store address as a path segment rather than a query
   * string.
   *
   * express.static answers 404 for it, because there is no file of that name,
   * so the page has to be served for anything under these paths that is not a
   * real asset. The page then reads the address out of its own URL.
   *
   * Only a single segment, and only one that looks like a store address, so
   * this cannot become a catch-all that swallows a genuinely missing asset and
   * answers HTML where a script was expected - which fails in the browser as
   * a syntax error and sends whoever debugs it looking in the wrong place.
   *
   * A relative asset path still resolves: from `/order/AZ100` the browser
   * treats the last segment as a file, so `assets/x` is `/order/assets/x`.
   */
  /*
   * Every shape a printed code can carry.
   *
   *   /AZ100                  the shop
   *   /AZ100/table/5          its own table five
   *   /AZ100/venue/RC/123     Royal Club Hotel, room 123
   *
   * Still bounded, and still not a catch-all: a missing script under these
   * paths stays a 404 rather than being answered with HTML, which in a browser
   * surfaces as a syntax error pointing at entirely the wrong file.
   *
   * The page reads the parts out of its own URL. It can only do that because
   * index.html carries a <base href="/order/">: without it, a relative asset
   * on a three-segment URL would resolve to /order/AZ100/venue/assets/... and
   * the page would load nothing at all.
   */
  const STORE_ADDRESS =
    /^\/[A-Za-z0-9]{3,6}(\/table\/[A-Za-z0-9_-]{1,24}|\/venue\/[A-Za-z0-9]{1,12}(\/[A-Za-z0-9_-]{1,24})?)?$/;
  /*
   * `/AZ100/cart.html` - an inner page with the shop in front of it.
   *
   * The pages put the shop back into the address bar once they know it
   * (order/assets/shop-address.js), so a refresh or a copied link still says
   * which shop it was. Named pages only, and the names are this bundle's own
   * files, so a missing script under a shop is still a 404 and not a page.
   *
   * Both answers are HTML and say so to caches: the address bar changes, the
   * page must not be the one from four hours ago.
   */
  const STORE_PAGE =
    /^\/[A-Za-z0-9]{3,6}\/((?:home|products|cart|payment|thankyou|phonepe_status|receipt|access-denied)\.html)$/;
  const PAGE_HEADERS = { headers: { 'Cache-Control': 'no-cache' } };
  const serveOrderPage = (req, res, next) => {
    const page = STORE_PAGE.exec(req.path);
    if (page) return res.sendFile(path.join(ORDER_BUNDLE, page[1]), PAGE_HEADERS);
    if (!STORE_ADDRESS.test(req.path)) return next();
    return res.sendFile(path.join(ORDER_BUNDLE, 'index.html'), PAGE_HEADERS);
  };
  // Store pages are public, but still perform disk reads. Apply the same
  // per-shop limiter as the API so an anonymous client cannot exhaust I/O.
  app.use('/order', limiter, serveOrderPage);
}

/* `/menu/AZ100`, for the same reason and with the same guard: a path segment
   express.static has no file for, and only one shaped like a store address. */
if (fs.existsSync(MENU_BUNDLE)) {
  /* The same shapes, so a menu can be printed for a hotel room and show that
     room the prices it will actually be charged. */
  const MENU_ADDRESS =
    /^\/[A-Za-z0-9]{3,6}(\/table\/[A-Za-z0-9_-]{1,24}|\/venue\/[A-Za-z0-9]{1,12}(\/[A-Za-z0-9_-]{1,24})?)?$/;
  app.use('/menu', (req, res, next) => {
    if (!MENU_ADDRESS.test(req.path)) return next();
    return res.sendFile(path.join(MENU_BUNDLE, 'index.html'));
  });
}

// Also mount API routes at root for backward compatibility
app.use('/', apiRouter);

// Handle 404 - Keep this as a last route
app.use((req, res, next) => {
  // Don't handle OPTIONS requests here - they should be handled by the CORS middleware
  if (req.method === 'OPTIONS') return next();

  // For all other requests, handle 404 with a more descriptive message
  const error = new AppError(
    `The requested resource '${req.originalUrl}' was not found on this server.`,
    404
  );
  error.isOperational = true;
  next(error);
});

// 404 handler
app.use(notFoundHandler);

// Global error handling middleware - must be after all other middleware/routes
app.use(globalErrorHandler);

// Export app only (server.js handles starting the server)
module.exports = app;
/* Named alongside the app so the store's contract with express-session can be
   asserted directly. It shipped broken once because nothing could reach it to
   check, and the failure only appeared for signed-in users. */
module.exports.TenantAwareSessionStore = TenantAwareSessionStore;
