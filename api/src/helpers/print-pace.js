'use strict';

/*
 * HOW OFTEN A TILL SHOULD ASK THE CLOUD WHETHER ANYTHING NEEDS PRINTING.
 *
 * Owner: "print always look for cloud api instead of local. should not give so
 * much load to cloud also. need balanced and well defined solution. polling
 * should happen only when app connected and logged in corrently acitve.
 * otherwise there is no app and no one going to give anything then its waste of
 * time polling stuff."
 *
 * Exactly right, and the fix has two halves.
 *
 * The first half is on the till: a shop whose handsets are on the shop's own
 * Wi-Fi never asks the cloud AT ALL. That path is in-process - the handset
 * talks to the till's own API, which is running inside the till - so the paper
 * starts in the same tick and no packet leaves the building. The cloud door is
 * a switch, off unless a shop actually has handsets coming in over the
 * internet.
 *
 * The second half is this file: when that door IS open, the SERVER decides the
 * pace, not the till. The server is the only side that knows whether anybody is
 * working the floor right now. So the answer to every claim carries a
 * `nextMs`, and a till that has been told to come back in a minute comes back
 * in a minute.
 *
 * That also means the pace can be changed for every till in the estate by
 * changing this file, without shipping a new desktop build to anybody - which
 * matters, because the right number here is a thing you learn from real shops.
 *
 * WHY THE PRESENCE MAP IS IN MEMORY. A handset asks for the floor list every
 * few seconds while a waiter has the app open. Writing that to the database
 * would be a write every few seconds per handset, to record something that is
 * worthless ten minutes later. In memory it is free. The cost is that it is
 * per process: if a tenant is ever served by more than one API process, a till
 * may land on a process that has not seen the handset and be told the idle
 * pace instead of the busy one. The bill still prints - within IDLE_MS rather
 * than instantly - which is a bounded, honest degradation rather than a
 * failure, and it is why IDLE_MS is one minute and not ten.
 */

const { EventEmitter } = require('events');

/** How recently a handset must have been heard from to count as "on the floor". */
const ACTIVE_FOR_MS = 10 * 60 * 1000;

/** Somebody is working: come back quickly, and expect to be held open. */
const BUSY_MS = 5000;

/**
 * Nobody is working.
 *
 * One request a minute per till. That is what it costs to NOTICE a waiter
 * opening the app, and something has to: a till asleep for ten minutes is a
 * guest waiting ten minutes for the first bill of the evening. A minute is
 * cheap enough to be beneath noticing and short enough that only the first
 * bill of a shift can ever wait for it.
 */
const IDLE_MS = 60 * 1000;

/**
 * How long the server may hold a claim open when the floor IS active.
 *
 * A held request is worth far more than it costs: it turns a cloud bill from
 * "up to five seconds" into "the moment it is asked for", and it does it with
 * FEWER requests than polling - one every twenty seconds instead of one every
 * five. Twenty is chosen to sit well inside nginx's sixty second read timeout
 * and Cloudflare's hundred, so nothing in the middle gives up first.
 */
const HOLD_MS = 20 * 1000;

/* branch id -> when a handset was last heard from. */
const floor = new Map();

/*
 * Announcements that a job was queued, so a held request can return at once
 * instead of waiting out its hold. Unlimited listeners: one per held till, and
 * a busy shop with four tills would otherwise trip Node's leak warning.
 */
const bell = new EventEmitter();
bell.setMaxListeners(0);

/** A handset was here. Called from the routes a handset actually uses. */
function seenOnTheFloor(branchId) {
  const id = String(branchId || '').trim();
  if (!id) return;
  floor.set(id, Date.now());
  /* A shop with hundreds of branches would otherwise grow this for ever. Old
     entries are dead by definition: nothing reads one past ACTIVE_FOR_MS. */
  if (floor.size > 500) {
    const dead = Date.now() - ACTIVE_FOR_MS;
    for (const [key, at] of floor) if (at < dead) floor.delete(key);
  }
}

/** Is anybody working this floor right now? */
function floorIsActive(branchId) {
  const at = floor.get(String(branchId || '').trim());
  return !!at && Date.now() - at < ACTIVE_FOR_MS;
}

/** Say that something was put on the queue, waking any till holding for it. */
function announceJob(branchId) {
  bell.emit('job', String(branchId || '').trim());
}

/**
 * Hold until something is queued for this branch, or until the hold runs out.
 *
 * Resolves true if a job arrived, false if the time simply passed. The caller
 * claims again on true; on false it answers with an empty list, which the till
 * expects and costs nothing.
 */
function waitForJob(branchId, ms = HOLD_MS) {
  const want = String(branchId || '').trim();
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bell.removeListener('job', onJob);
      resolve(answer);
    };
    const onJob = (id) => {
      if (id === want) finish(true);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, ms));
    /* An open handle here would keep a test runner - or a shutting-down
       server - alive for the length of the hold. */
    if (timer.unref) timer.unref();
    bell.on('job', onJob);
  });
}

/**
 * What to tell a till that has just been served.
 *
 * @param {string} branchId
 * @param {number} handedOver how many jobs the till was just given
 */
function pacingFor(branchId, handedOver = 0) {
  if (handedOver > 0) {
    /* There may be more behind it - a table with three rounds is three jobs -
       and a printer that has just woken up should empty the queue rather than
       print one slip every ten seconds. */
    return { nextMs: 0, reason: 'more may be waiting' };
  }
  if (floorIsActive(branchId)) {
    return { nextMs: BUSY_MS, reason: 'somebody is on the floor' };
  }
  return { nextMs: IDLE_MS, reason: 'nobody is on the floor' };
}

/** Whether this claim is worth holding open rather than answering empty. */
function worthHolding(branchId) {
  return floorIsActive(branchId);
}

module.exports = {
  seenOnTheFloor,
  floorIsActive,
  announceJob,
  waitForJob,
  pacingFor,
  worthHolding,
  ACTIVE_FOR_MS,
  BUSY_MS,
  IDLE_MS,
  HOLD_MS,
};
