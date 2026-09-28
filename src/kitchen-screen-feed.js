'use strict';

/*
 * WHAT PUTS TICKETS ON THE KITCHEN SCREEN.
 *
 * kitchen-screen.js can open a window on any display, size its type for the
 * room, and push a list of tickets into it. `setTickets` is the only way
 * anything ever reaches those windows, and it was exported and CALLED FROM
 * NOWHERE - so a screen hung on a kitchen wall showed an empty list for ever.
 *
 * The bug had the worst possible shape: setup mode fills the window with
 * sample tickets, so the preview a shopkeeper uses to position the screen
 * looked perfect, and the screen did nothing the moment service started.
 *
 * WHY THIS IS NOT FED FROM THE PRINT POLL, which is the obvious idea:
 *
 *   - that poll returns only what has not printed YET, so a ticket would
 *     vanish off the wall the instant it came out of the printer - which is
 *     exactly when the kitchen starts cooking it;
 *   - and it claims what it hands out, so a ticket taken by the other till
 *     would never appear at all.
 *
 * A screen shows what is open, whoever printed it. So it has its own read.
 *
 * IT ONLY RUNS WHILE A SCREEN IS OPEN. A shop with no kitchen screen pays
 * nothing for this, which is most shops, and a poll against a shop's own API
 * on its own machine is cheap enough not to need an event bus on top.
 */

const EVERY_MS = 5000;
/* A screen that cannot be fed says so by going stale, not by going blank: the
   last tickets stay up. A cook mid-service needs the paper in front of them to
   keep matching the wall more than they need the wall to be honest about a
   network blip. */
const KEEP_LAST_ON_FAILURE = true;

let timer = null;
let lastGood = null;
let generation = 0;

function screens() {
  return require('./kitchen-screen');
}

/** The shop's own API, on this machine. Same resolution the KOT poller uses. */
function apiUrl() {
  try {
    return require('./kot-manager').kotApiUrl();
  } catch (e) {
    const port = process.env.API_PORT || process.env.PORT || 5555;
    return `http://127.0.0.1:${port}/api`;
  }
}

/**
 * One read, and onto the wall.
 *
 * Exported so a test can run it without a timer, which is the only way the
 * interesting parts - what happens when the shop cannot be reached - can be
 * checked at all.
 */
async function tick({ branchId, fetchImpl, expectedGeneration = generation } = {}) {
  const branch = String(branchId || '').trim();
  if (!branch) return { ok: false, why: 'no branch' };

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, why: 'no fetch' };

  try {
    const response = await doFetch(`${apiUrl()}/sales/kitchenScreenTickets`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        kioskkey: process.env.KIOSK_API_KEY || '',
      },
      body: JSON.stringify({ branchId: branch }),
    });
    if (!response || !response.ok) return { ok: false, why: 'refused' };

    const answer = await response.json();
    if (!answer || answer.type === 'error' || answer.status === false || !Array.isArray(answer.data)) {
      return { ok: false, why: 'invalid response' };
    }
    if (expectedGeneration !== generation) return {ok:false,why:'feed changed'};
    const tickets = answer.data;
    lastGood = tickets;
    const rendered = await screens().setTickets(tickets);
    if (Array.isArray(rendered) && rendered.length) {
      try {
        await doFetch(`${apiUrl()}/sales/kitchenDisplayReport`, {method:'POST',signal:AbortSignal.timeout(3000),
          headers:{'Content-Type':'application/json',kioskkey:process.env.KIOSK_API_KEY || ''},
          body:JSON.stringify({branchId:branch,till:require('os').hostname(),screens:rendered,
            saleIds:[...new Set(tickets.map(ticket=>String(ticket.id || '').split(':')[0]))],at:new Date().toISOString()})});
      } catch {} // A status report must not clear the rendered tickets.
    }
    return { ok: true, count: tickets.length };
  } catch (e) {
    /*
     * A blip must not clear a kitchen's wall. The tickets already up are
     * still the truth as far as anybody in that room is concerned, and a
     * screen that empties itself every time the API hiccups is a screen
     * nobody trusts.
     */
    if (KEEP_LAST_ON_FAILURE && lastGood && expectedGeneration === generation) {
      try {
        await screens().setTickets(lastGood);
      } catch (err) {
        /* nothing to do */
      }
    }
    return { ok: false, why: (e && e.message) || 'unreachable' };
  }
}

/** Start feeding, if this shop has a screen to feed. Idempotent. */
function start({ branchId, everyMs = EVERY_MS } = {}) {
  stop();
  const branch = String(branchId || '').trim();
  if (!branch) return null;
  let busy = false;
  const expectedGeneration = generation;
  const refresh = async () => {
    if (busy || expectedGeneration !== generation) return;
    busy = true;
    try { await tick({branchId:branch, expectedGeneration}); } finally { busy = false; }
  };
  timer = setInterval(() => { refresh().catch(() => {}); }, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
  /* Straight away as well: a shop that has just opened a screen should not
     watch an empty wall for five seconds wondering whether it works. */
  refresh().catch(() => {});
  return timer;
}

function stop() {
  generation++;
  lastGood = null;
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, EVERY_MS };
