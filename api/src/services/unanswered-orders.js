'use strict';

/*
 * THE SHOP'S DECLARED DEFAULT, ACTUALLY FIRING.
 *
 * Owner: "let restaurent owner decide that. give option auto cancel or auto
 * accept. based ont time he defines it. by default dont accpept or reject."
 *
 * WHAT WAS THERE, AND WHY IT WAS WORSE THAN NOTHING
 *
 * waiting-order-policy.js was written, tested and merged. It decides perfectly.
 * Nothing ever asked it for a decision it could act on:
 *
 *   - `setPolicy()` on the desktop OrderAlert was called from nowhere, so the
 *     policy was always `{ onSilence: 'nothing', decideAfterMinutes: 0 }` and
 *     `decide` could only ever answer "nothing";
 *   - and when it did answer, the till emitted `posnic:order-decided` on the
 *     process bus, WHICH NOTHING LISTENED TO - and then deleted the order from
 *     its pending map, so the alarm went quiet with the order still sitting
 *     there unanswered.
 *
 * An alarm that stops is a promise that somebody dealt with it. That is the
 * one failure this whole area exists to prevent, and it was built in.
 *
 * WHY THE DECISION LIVES HERE AND NOT IN THE TILL
 *
 * The till is a sound module. Its own comment says so: "deciding an order is
 * somebody else's job and belongs where the order lives. A sound module that
 * could cancel a customer's order would be a surprising place to find that
 * power." It is also the wrong half: a shop served from the cloud has no
 * desktop till at all, and its orders would never be decided.
 *
 * So the two halves read the same pure policy for different fields. The till
 * reads `alert` and `reach` and makes a noise. This reads `decide` and moves
 * the order, through the same `decideOnOrder` a person at the queue uses - so
 * an automatic acceptance prints its kitchen ticket exactly the way a tapped
 * one does, rather than by a second path that could drift from it.
 *
 * NOTHING HAPPENS UNLESS A SHOP ASKED FOR IT. Absent settings mean a policy of
 * `nothing`, and that is the default this ships with. A product that cancels a
 * customer's order because a shop never opened a settings page has made a
 * decision that was not its to make.
 */

const BaseModel = require('../models/base.model');
const SettingsRepository = require('../repositories/settings.repository');
const policy = require('../utils/waiting-order-policy');
const orderApproval = require('../utils/order-approval');
const { notifyOrderResolved } = require('../helpers/order-attention');

/* A CLASS, not an instance - and constructing it at module load would build a
   repository before the database exists. Built on first use, and exported so a
   test can stand in for it. */
let settings = null;
const _settings = () => {
  if (!settings) settings = new SettingsRepository();
  return settings;
};

/*
 * How often to look. The shortest step in the policy is twenty seconds, but
 * that is the ALARM's pace, not this one: a shop's own window is measured in
 * minutes, so checking every half minute is already finer than any answer can
 * be. It is a database read per tick, so it is worth being dull about.
 */
const EVERY_MS = 30 * 1000;

/* A cap on how much one tick can do, so a shop that comes back from a long
   outage with two hundred held orders does not decide them all in one breath
   and print two hundred tickets at once. */
const MOST_PER_TICK = 20;

/* Nothing older than this is touched at all. An order from last Tuesday is not
   something to accept on a rule today - somebody will look at it, or it will
   be tidied up, and either way automatically starting to cook it is wrong. */
const TOO_OLD_HOURS = 12;

let timer = null;

/**
 * What this shop asked to happen when nobody answers.
 *
 * Read from the settings VALUES rather than from the branch document, because
 * that is where these live and where a shop's account-level default is
 * resolved against its branch's override. Anything unreadable is `nothing`,
 * which is the shape of a shop that never opened the page.
 */
function policyOf(values = {}) {
  const said = String(values.online_order_on_silence || '')
    .trim()
    .toLowerCase();
  const onSilence = policy.ON_SILENCE.includes(said) ? said : 'nothing';
  const minutes = Number(values.online_order_decide_after_minutes);
  const partner = Number(values.online_order_partner_window_minutes);
  return {
    onSilence,
    decideAfterMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    partnerWindowMinutes: Number.isFinite(partner) && partner > 0 ? partner : 0,
  };
}

/**
 * Does this shop want anything to happen by itself?
 *
 * BOTH or neither. A choice with no time set fires immediately, and a time
 * with no choice fires nothing - either half alone is a half-written rule, and
 * acting on one is acting on something nobody finished saying.
 */
function wants(said) {
  return said.onSilence !== 'nothing' && said.decideAfterMinutes > 0;
}

/** This branch's settings, or nothing at all if they cannot be read. */
async function settingsFor(branchDoc) {
  try {
    const read = await _settings().resolveGroup('preferences', {
      licenseId: branchDoc.license,
      branchId: branchDoc._id,
    });
    return (read && read.status && read.data && read.data.values) || {};
  } catch (e) {
    /* A shop whose settings cannot be read is a shop that asked for nothing,
       which is the only safe way to be wrong about this. */
    return {};
  }
}

/**
 * One pass: every held order on every branch that asked for a rule.
 *
 * Returns what it did rather than logging it, so the behaviour can be tested
 * without reading a console.
 */
async function sweepOnce({ now = Date.now(), Repository } = {}) {
  const out = { branches: 0, looked: 0, decided: [] };
  const repo = Repository || require('../repositories/sale.repository');

  let db;
  try {
    db = await BaseModel.getDb();
  } catch (e) {
    /* No database yet, or a shop still starting. Nothing to do and nothing
       worth saying: the next tick is thirty seconds away. */
    return out;
  }

  /* Declared without an empty list, because every path out of the catch
     below leaves this function - an initialiser here would only ever be
     read by a reader, never by the code. */
  let branches;
  try {
    branches = await db
      .collection('branches')
      .find(
        {},
        {
          /* The licence and the id are all this needs: the rule itself is a
             settings value, resolved per branch with its account default
             behind it. */
          projection: { _id: 1, license: 1 },
        }
      )
      .toArray();
  } catch (e) {
    console.warn('[unanswered-orders] could not read the branches:', e && e.message);
    return out;
  }

  const oldest = new Date(now - TOO_OLD_HOURS * 60 * 60 * 1000);

  for (const branchDoc of branches) {
    const shopPolicy = policyOf(await settingsFor(branchDoc));
    if (!wants(shopPolicy)) continue;
    out.branches += 1;

    let held;
    try {
      held = await db
        .collection('sales')
        .find(
          {
            branch_id: branchDoc._id,
            order_state: orderApproval.ORDER_STATE.PENDING,
            created_date: { $gte: oldest },
          },
          { projection: { _id: 1, created_date: 1, date: 1, sale_method: 1, channel: 1 } }
        )
        .sort({ created_date: 1 })
        .limit(MOST_PER_TICK)
        .toArray();
    } catch (e) {
      console.warn('[unanswered-orders] could not read held orders:', e && e.message);
      continue;
    }

    for (const order of held) {
      out.looked += 1;
      const placed = new Date(order.created_date || order.date || 0).getTime();
      if (!placed) continue;

      const verdict = policy.decide(
        {
          waitingMs: now - placed,
          /* The alarm's business, not this one's: a policy that only fires
             when nobody has looked would let one tap park an order for ever,
             which is the bug this replaces wearing a different hat. */
          lastAlertedMs: Infinity,
          source: sourceOf(order),
        },
        shopPolicy
      );
      if (verdict.decide === 'nothing') continue;

      const decision =
        verdict.decide === 'accept'
          ? orderApproval.ORDER_STATE.ACCEPTED
          : orderApproval.ORDER_STATE.REJECTED;

      try {
        /*
         * THE SAME DOOR A PERSON USES. decideOnOrder is what the approval
         * queue calls: it moves the state, stamps it, and prints the kitchen
         * ticket on the move to accepted and only then. A second path that
         * wrote the state itself would sooner or later stop printing, or
         * print twice.
         */
        const done = await repo.decideOnOrder({
          saleId: String(order._id),
          decision,
          reason: verdict.reason,
        });
        if (!done || !done.status) continue;

        /*
         * AND IT IS READ BACK, because "it said yes" is not "it happened".
         *
         * decideOnOrder narrows its write by whatever tenant the PROCESS was
         * last serving - a module-level license and branch that a request in
         * flight sets and this sweep does not own. If those happen to name
         * another branch, the update matches nothing, and the method answers
         * success anyway because it reports what it asked for rather than what
         * changed.
         *
         * Announcing that would stop the alarm for an order that never moved,
         * which is the exact bug this whole change exists to remove. So the
         * state is checked, and silence is only ever earned.
         */
        let moved = false;
        try {
          const fresh = await db
            .collection('sales')
            .findOne({ _id: order._id }, { projection: { order_state: 1 } });
          moved = !!fresh && String(fresh.order_state) === decision;
        } catch (e) {
          moved = false;
        }
        if (!moved) {
          console.warn(
            '[unanswered-orders] a decision reported success but the order did not move:',
            String(order._id)
          );
          continue;
        }

        out.decided.push({ saleId: String(order._id), decision, reason: verdict.reason });
        /* And the alarm stops, because now something HAS happened. */
        notifyOrderResolved({
          branchId: String(branchDoc._id),
          saleId: String(order._id),
          state: decision,
          by: 'rule',
        });
      } catch (e) {
        console.warn('[unanswered-orders] could not decide an order:', e && e.message);
      }
    }
  }

  return out;
}

/**
 * Where the order came from, for the aggregator rule.
 *
 * Swiggy and Zomato reject on their own timer and count it against the shop, so
 * a decision of ours landing after theirs is worse than none. The policy holds
 * that rule; this only has to name the source the way the policy expects.
 */
function sourceOf(order = {}) {
  const said = `${order.channel || ''} ${order.sale_method || ''}`.toLowerCase();
  if (said.includes('marketplace') || said.includes('swiggy') || said.includes('zomato')) {
    return 'marketplace';
  }
  return 'online';
}

/** Start looking. Idempotent, and never fatal. */
function start({ everyMs = EVERY_MS } = {}) {
  if (timer) return timer;
  try {
    timer = setInterval(() => {
      sweepOnce().catch((e) => {
        console.warn('[unanswered-orders] sweep failed:', e && e.message);
      });
    }, everyMs);
    /* The process must be able to exit without waiting for this. */
    if (typeof timer.unref === 'function') timer.unref();
  } catch (e) {
    console.warn('[unanswered-orders] could not start:', e && e.message);
    timer = null;
  }
  return timer;
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  /* The seam a test stands in for, as customer-order.service does. */
  _settings,
  start,
  stop,
  sweepOnce,
  policyOf,
  wants,
  sourceOf,
  EVERY_MS,
  MOST_PER_TICK,
  TOO_OLD_HOURS,
};
