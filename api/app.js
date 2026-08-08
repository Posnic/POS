require('dotenv').config({ quiet: true });
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { filterXSS } = require('xss');
const hpp = require('hpp');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
/*
 * connect-mongo 6 stopped putting the store on module.exports itself.
 * `require("connect-mongo")` used to be the class with a static create(); now
 * it is a namespace and the class is the named MongoStore export. The old form
 * left MongoStore.create undefined, so the session store threw at startup and
 * nobody could log in - and every mocked unit test still passed, because the
 * store is only constructed against a real database.
 */
const { MongoStore } = require('connect-mongo');
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
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
  })
);

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
// load in exchange for very little. It also guards abuse rather than
// credentials: if several workers each allow 1000, the effective ceiling rises
// with worker count, which is an acceptable outcome here and is not for a
// limiter counting password attempts.
const limiter = rateLimit({
  // `max` was renamed `limit` in express-rate-limit 7; the old name still
  // works and warns.
  limit: 1000,
  windowMs: 15 * 60 * 1000, // Reduced window to 15 minutes (from 1 hour)
  message: 'Too many requests from this IP, please try again later!',
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

  next();
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
if (UPDATED_ASSETS && fs.existsSync(UPDATED_ASSETS)) {
  console.log('[assets] serving updated assets from ' + UPDATED_ASSETS);
  app.use('/', express.static(UPDATED_ASSETS, { fallthrough: true }));
}

// Serve transformed frontend assets (used for login page, etc.)
app.use(
  '/',
  express.static(path.join(__dirname, '..', 'frontend', 'public'), {
    fallthrough: true,
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

app.use('/static', express.static(BUILT_STATIC, { fallthrough: true }));

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
    const isLoopback =
      remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLoopback) return res.status(403).end();

    let store;
    try {
      store = require('../print-document-store');
    } catch (e) {
      return res.status(503).end();
    }

    const html = store.take(req.params.token);
    if (!html) return res.status(404).end();

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(html);
  });

// The compiled stylesheets reference ../fonts, which resolves to /fonts.
app.use('/fonts', express.static(path.join(BUILT_STATIC, 'fonts'), { fallthrough: true }));

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

// Cookie parser middleware - MUST be before session middleware so that
// req.cookies is populated when session and auth middleware run.
app.use(cookieParser());

// Session configuration
app.use(
  session({
    // Never a literal - see config/signing-secret for why.
    secret:
      process.env.SESSION_SECRET ||
      require('./src/config/signing-secret').ephemeralSecret('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    proxy: isProduction(),
    store: MongoStore.create({
      mongoUrl: config.database.uri,
    }),
    cookie: {
      secure: isProduction(),
      sameSite: isProduction() ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);

// CORS configuration - Handle OPTIONS preflight requests first
const defaultAllowedOrigins = [
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

// CORS_ORIGIN extends the application defaults instead of replacing them.
// Replacing the list caused deployed frontends to lose access whenever an
// environment-specific origin was configured.
const configuredAllowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins])];

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

// A request from the page this very app served is same-origin: the browser
// sends Origin on POST even then, and an exact-match allowlist cannot contain
// a customer's own domain, so sign-in on a white-label domain failed with
// "Not allowed by CORS" no matter what password was typed. Comparing the
// Origin host against the Host we were reached on grants nothing extra -- a
// cross-site page cannot forge Origin -- and needs no config per new domain.
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
  allowedOrigins.includes(origin) ||
  isPrivateNetworkOrigin(origin) ||
  isSameOriginRequest(origin, req);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // In development, allow all origins
  if (process.env.NODE_ENV !== 'production') {
    res.header('Access-Control-Allow-Origin', origin || '*');
  } else {
    // In production, only allow specific origins
    if (origin && isAllowedOrigin(origin, req)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
      // Allow requests with no origin (curl, mobile apps, etc.)
      res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
  }

  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, X-XSRF-TOKEN, X-Device-Id, X-Branch-Id, kioskkey'
  );
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle OPTIONS method for preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

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
  exposedHeaders: ['set-cookie'],
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
app.use('/static', express.static(path.join(frontendPath, 'static')));
app.use('/images', express.static(path.join(frontendPath, 'static', 'images')));
app.use('/fonts', express.static(path.join(frontendPath, 'static', 'fonts')));
app.use('/style', express.static(path.join(frontendPath, 'public', 'style')));
app.use('/script', express.static(path.join(frontendPath, 'public', 'script')));
// Serve static files from /public/static for pages loaded from /public/
app.use('/public/static', express.static(path.join(frontendPath, 'static')));
app.use('/public/images', express.static(path.join(frontendPath, 'static', 'images')));
app.use('/public/fonts', express.static(path.join(frontendPath, 'static', 'fonts')));
app.use('/public', express.static(path.join(frontendPath, 'public')));
app.use(express.static(path.join(frontendPath, 'public')));

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
