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

/*
 * TEMPORARY diagnostic window (owner: "add some temporary system and find
 * out... i want know very exact reason"): the last few reported lines,
 * readable over HTTP, because the shop under investigation runs where no
 * audited log-read path exists. Deliberately tiny and already-truncated -
 * the ring holds exactly the console lines above, nothing more - and the
 * boot-flight death records are the reason it exists. Remove with the
 * flight recorder once the mobile crash is closed (OWNER_QUEUE row 193).
 */
const RING_MAX = 30;
const ring = [];
function remember(line) {
  ring.push(new Date().toISOString() + ' ' + line);
  if (ring.length > RING_MAX) ring.shift();
}

router.get('/recent', (req, res) => {
  res.type('text/plain').send(ring.length ? ring.join('\n') : '(nothing reported since restart)');
});

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
      remember(line);
      const stack = String(b.stack || '').slice(0, 1000);
      if (stack) console.error('[client-error] stack:', stack.split('\n').slice(0, 4).join(' | '));
      /* The watchdog's whole journal, one line per entry - the card's View
         details, readable remotely. The first beacon field is only the FIRST
         capture, and the first capture is routinely noise. */
      if (Array.isArray(b.journal)) {
        for (const entry of b.journal.slice(0, 3)) {
          console.error('[client-error] journal:', String(entry).slice(0, 220));
        }
      }
    }
  } catch (e) {
    /* the reporter must never be the thing that fails */
  }
  return res.status(204).end();
});

module.exports = router;
