/*
 * Handing a print document to the local API so it can be served from a real
 * origin instead of a data: URL.
 *
 * The receipt printer loads its HTML as `data:text/html;...`, which has an
 * opaque origin. The invoice markup links print.css and the shop's logo from
 * the local API, and an opaque origin may not load either - so that window has
 * always run with webSecurity disabled. It works, and it has been flagged as a
 * finding every time anyone audits the repository, correctly.
 *
 * The fix is not to turn the flag on. It is to stop needing it: serve the
 * document from `http://127.0.0.1:<port>/print/<token>` so the page, the
 * stylesheet and the logo share one origin. Then web security can be on and
 * nothing is cross-origin at all.
 *
 * Documents live in memory only. Writing a customer's invoice to a temporary
 * file to print it would leave it on disk after the job, which is a worse
 * trade than the one being fixed.
 *
 * Each token is single-use and short-lived. A print document is fetched once,
 * immediately, by a window this process just opened - so anything else asking
 * for it is not the print window, and there is nothing left to give.
 */

const crypto = require('crypto');

/* Long enough that guessing is not a strategy, on a loopback-only endpoint
   that holds each document for seconds. */
const TOKEN_BYTES = 24;

/* If a window fails to open, or the print is cancelled before the page loads,
   nothing collects the document. It must not sit in memory until the till is
   next restarted. */
const TTL_MS = 60 * 1000;

const documents = new Map();

function sweep(now = Date.now()) {
  for (const [token, entry] of documents) {
    if (entry.expiresAt <= now) documents.delete(token);
  }
}

/**
 * Store a document and return the token that fetches it exactly once.
 *
 * @param {string} html a complete HTML document
 * @returns {string} the token to put in the URL
 */
function put(html) {
  if (typeof html !== 'string' || !html) {
    throw new TypeError('a print document must be a non-empty string');
  }
  sweep();

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  documents.set(token, { html, expiresAt: Date.now() + TTL_MS });
  return token;
}

/**
 * Fetch and forget.
 *
 * Single use: the second request for a token gets nothing, whoever makes it.
 *
 * @param {string} token
 * @returns {string|null} the document, or null if it is unknown, spent or expired
 */
function take(token) {
  sweep();
  if (typeof token !== 'string') return null;

  const entry = documents.get(token);
  if (!entry) return null;

  documents.delete(token);
  return entry.html;
}

/** How many documents are waiting. For diagnostics and tests. */
function size() {
  sweep();
  return documents.size;
}

/** Drop everything. Used on shutdown so nothing outlives the process. */
function clear() {
  documents.clear();
}

module.exports = { put, take, size, clear, TTL_MS };
