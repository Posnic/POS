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
const lastGood = new Map();
let generation = 0;
let servedListener = null;

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
async function tick({ branchId, fetchImpl, displayId, isCurrent = () => true } = {}) {
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
    const tickets = answer.data;
    if (!isCurrent()) return { ok: false, why: 'superseded' };
    lastGood.set(branch, tickets);
    const rendered = displayId ? await screens().setTickets(tickets, displayId) : await screens().setTickets(tickets);
    if (Array.isArray(rendered) && rendered.length && isCurrent()) {
      try {
        await doFetch(`${apiUrl()}/sales/kitchenDisplayReport`, {method:'POST',signal:AbortSignal.timeout(3000),
          headers:{'Content-Type':'application/json',kioskkey:process.env.KIOSK_API_KEY || ''},
          body:JSON.stringify({branchId:branch,till:require('os').hostname(),screens:rendered,
            saleIds:[...new Set(tickets.map(ticket=>String(ticket.id || '').split(':')[0]))]})});
      } catch {} // Status delivery must never clear an already rendered ticket.
    }
    return { ok: true, count: tickets.length };
  } catch (e) {
    /*
     * A blip must not clear a kitchen's wall. The tickets already up are
     * still the truth as far as anybody in that room is concerned, and a
     * screen that empties itself every time the API hiccups is a screen
     * nobody trusts.
     */
    if (KEEP_LAST_ON_FAILURE && lastGood.has(branch) && isCurrent()) {
      try {
        await screens().setTickets(lastGood.get(branch), displayId);
      } catch (err) {
        /* nothing to do */
      }
    }
    return { ok: false, why: (e && e.message) || 'unreachable' };
  }
}

/** Start feeding, if this shop has a screen to feed. Idempotent. */
async function pollScreens({ resolveBranch, fetchImpl, isCurrent = () => true } = {}) {
  const open = screens().displays().filter(d => d.open && d.configured);
  if (!open.length) return;
  const fallback = open.some(d => !d.config.branchId) && resolveBranch ? await resolveBranch() : '';
  if (!isCurrent()) return;
  await Promise.all(open.map(async d => {
    const branchId = String(d.config.branchId || fallback || '');
    const current = () => isCurrent() && screens().configFor(d.id).enabled &&
      String(screens().configFor(d.id).branchId || '') === String(d.config.branchId || '');
    if (!branchId) {
      screens().setTickets([], d.id);
      screens().setFeedStatus('Choose an orders branch in Hardware Manager > Kitchen Screen.', d.id);
      return;
    }
    // A branch change must not leave the previous branch's tickets on the wall.
    if (screenBranches.get(d.id) !== branchId) {
      screenBranches.set(d.id, branchId);
      screens().setTickets([], d.id);
      screens().setFeedStatus('Connecting to kitchen orders...', d.id);
    }
    const result = await tick({ branchId, displayId: d.id, fetchImpl, isCurrent: current });
    if (current()) screens().setFeedStatus(result.ok ? '' :
      'Orders connection unavailable. Retrying; any orders shown may be out of date.', d.id);
  }));
}
const screenBranches = new Map();

function start({ branchId, resolveBranch, everyMs = EVERY_MS, fetchImpl } = {}) {
  stop();
  const branch = String(branchId || '').trim();
  if (!branch && !resolveBranch) return null;
  const epoch = generation;
  let busy = false;
  let revision = 0;
  let pending = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    pending = false;
    const reading = revision;
    const isCurrent = () => epoch === generation && reading === revision;
    try {
      if (resolveBranch) await pollScreens({ resolveBranch, fetchImpl, isCurrent });
      else await tick({ branchId: branch, fetchImpl, isCurrent });
    } catch (e) {
      if (epoch !== generation) return;
      for (const d of screens().displays().filter(d => d.open && d.configured)) {
        screens().setFeedStatus('Orders connection unavailable. Retrying...', d.id);
      }
    } finally {
      busy = false;
      if (pending && epoch === generation) void run();
    }
  };
  servedListener = (event) => {
    if (!event?.branchId || (!resolveBranch && String(event.branchId) !== branch)) return;
    // Discard a response read before service was saved, then read fresh without overlap.
    revision += 1;
    pending = true;
    void run();
  };
  process.on('posnic:kitchen-served', servedListener);
  timer = setInterval(run, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
  run();
  return timer;
}

function stop() {
  generation += 1;
  if (servedListener) process.removeListener('posnic:kitchen-served', servedListener);
  servedListener = null;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, pollScreens, EVERY_MS };
