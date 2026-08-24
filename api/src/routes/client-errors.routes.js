'use strict';

/*
 * Where a till's dying words land.
 *
 * Owner, after clearing his own browser data to recover a white page:
 * "i dont [want] users to face these kind of errors."
 *
 * The white-page bug this follows lived for months because it was CLIENT
 * side: the server answered 200 to everything, every log stayed clean, and
 * the only witness was a browser console nobody was looking at. Diagnosing
 * it took minting a shadow session and booting it in headless Chrome. This
 * endpoint is the cheap version of that pipeline, always on: the boot
 * watchdog posts the first uncaught error here, and it lands in the shop's
 * own pm2 log - `grep client-error` - beside the request lines it belongs
 * with.
 *
 * DELIBERATELY UNAUTHENTICATED. The errors worth hearing about most are the
 * ones that happen BEFORE auth works - a boot that dies has no token to
 * present. Unauthenticated write surface is held small three ways:
 *
 *   - it stores nothing: one console line, no database, nothing to fill
 *   - per-IP budget: after a handful an hour, requests are counted and
 *     dropped without logging, so a hostile loop cannot flood the log
 *   - every field is truncated before it is printed
 *
 * It always answers 204, error or not: a crash reporter that can itself
 * produce visible failures adds noise to the exact moment that has too
 * much of it.
 */
const express = require('express');

const router = express.Router();

const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_WINDOW = 6;
const seen = new Map();

/* The map cannot grow unbounded on a public endpoint: sweep entries whose
   window has lapsed whenever it gets large. */
function sweep(now) {
  if (seen.size < 1000) return;
  for (const [ip, rec] of seen) {
    if (now - rec.start > WINDOW_MS) seen.delete(ip);
  }
}

router.post('/', (req, res) => {
  try {
    const now = Date.now();
    sweep(now);
    const ip = String(req.ip || 'unknown');
    const rec = seen.get(ip) || { start: now, count: 0 };
    if (now - rec.start > WINDOW_MS) {
      rec.start = now;
      rec.count = 0;
    }
    rec.count += 1;
    seen.set(ip, rec);

    if (rec.count <= PER_IP_PER_WINDOW) {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const line = [
        '[client-error]',
        String(req.headers.host || '').slice(0, 80),
        String(b.message || '(no message)').slice(0, 300),
        '@',
        String(b.at || '').slice(0, 200),
      ].join(' ');
      console.error(line);
      const stack = String(b.stack || '').slice(0, 1000);
      if (stack) console.error('[client-error] stack:', stack.split('\n').slice(0, 4).join(' | '));
    }
  } catch (e) {
    /* the reporter must never be the thing that fails */
  }
  return res.status(204).end();
});

module.exports = router;
