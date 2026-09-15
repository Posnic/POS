'use strict';
/*
 * The order a customer has already placed, from the phone that placed it.
 *
 * Owner: "i want full control for ai for create and edit order cancel order
 * or existing items." The assistant could build an order and send it; after
 * that the customer had to find a person. This is what lets them say "make it
 * two" or "cancel that" to the same assistant, and it is the same door the
 * page itself would use.
 *
 * WHO MAY. Nobody signs in here, so holding the order is the proof: its id,
 * which is a 24-character database id nobody guesses, AND its token, which is
 * on the customer's own screen. A wrong token answers exactly what an unknown
 * id answers, so the ids cannot be felt out one at a time.
 *
 * WHEN THEY MAY NOT, and every one of these is a sentence the assistant can
 * say rather than a failure it has to invent:
 *   already_billed   the shop has turned it into a bill
 *   already_paid     the money is in; changing it now is a refund, at a till
 *   already_cancelled
 *   refused_by_shop  the shop said no to it in the approval queue
 *   at_the_counter   it carries a delivery fee or a hotel's markup, so the
 *                    total is not the customer's alone to move
 *   too_late         placed long enough ago that the kitchen has moved on
 */
const salesRepository = require('../repositories/sale.repository');
const SettingsRepository = require('../repositories/settings.repository');

/*
 * How long an order stays the customer's, when the shop has not said.
 *
 * ONE MINUTE. Owner: "up to 1 min he can change. after also he can change but
 * instead of confirm change, request changes."
 *
 * It was thirty seconds, which is what the delivery apps settled on - and too
 * short to reach. The owner went looking on the history page and found nothing
 * but Cancel, because by the time anybody taps out of the confirmation, finds
 * the history and opens a row, thirty seconds is gone. A minute is long enough
 * to actually get there and still short enough that a kitchen is not amending
 * something already on the pass. Past it, nothing is taken away: changing
 * simply becomes a request the shop answers.
 */
const DEFAULT_CHANGE_SECONDS = 60;
/* A window nobody would call a window: a shop cannot leave an order open to
   editing for a day and be surprised by what comes back. */
const MAX_CHANGE_SECONDS = 900;

let settings = null;
const _settings = () => {
  if (!settings) settings = new SettingsRepository();
  return settings;
};

/**
 * How long this shop leaves an order open, in seconds.
 *
 * ZERO FOR A SHOP THAT IS NOT A RESTAURANT. Owner: "this is specifig
 * functionality about after order and modify. also restaurent specific. other
 * business usually wont have this feature." Changing an order after it has
 * gone is a kitchen idea: nothing has been cooked yet, so for a minute it is
 * still the customer's. A counter that has already picked and packed has no
 * such minute, and offering one there is a promise the shop cannot keep.
 * Cancelling is NOT gated by this - it becomes a request the shop decides on,
 * which is the flow every kind of shop already has.
 */
async function changeSeconds(context) {
  if (context && context.kind && String(context.kind) !== 'restaurant') return 0;
  try {
    const read = await _settings().resolveGroup('preferences', context);
    const values = (read && read.status && read.data && read.data.values) || {};
    const said = values.online_order_change_seconds;
    if (said === undefined || said === null || String(said).trim() === '') {
      return DEFAULT_CHANGE_SECONDS;
    }
    const seconds = Math.round(Number(said));
    if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_CHANGE_SECONDS;
    return Math.min(MAX_CHANGE_SECONDS, seconds);
  } catch (e) {
    /* A shop whose settings cannot be read still gets the sensible one. */
    return DEFAULT_CHANGE_SECONDS;
  }
}

/** Why this order is not the customer's to change, or '' when it is. */
function whyNot(order, now = Date.now(), seconds = DEFAULT_CHANGE_SECONDS) {
  if (!order) return 'not_found';
  const process = String(order.sale_process || '');
  if (process === 'cancelled') return 'already_cancelled';
  if (String(order.payment_status || '') === 'Cancelled') return 'already_cancelled';
  if (process && process !== 'KOT') return 'already_billed';
  if (String(order.payment_status || '') === 'Paid') return 'already_paid';
  if (String(order.order_state || '') === 'rejected') return 'refused_by_shop';
  if (
    Number(order.delivery_fee || 0) > 0 ||
    Number(order.venue_commission || 0) > 0 ||
    (order.venue && String(order.venue).trim())
  ) {
    return 'at_the_counter';
  }
  /* A shop that has switched the window off keeps every order the moment
     it lands: asking is still allowed, doing is not. */
  if (!(seconds > 0)) return 'too_late';
  const placed = new Date(order.created_date || order.date || 0).getTime();
  if (!placed || now - placed > seconds * 1000) return 'too_late';
  return '';
}

/**
 * The order this caller is holding, or why they get nothing.
 *
 * @param {{orderId?: string, token?: string|number}} body
 * @param {{branchId: string}} context
 */
async function heldOrder(body, context) {
  const orderId = String((body && body.orderId) || '').trim();
  const token = String((body && body.token) || '').trim();
  if (!orderId || !token) return { order: null, reason: 'not_found' };

  const order = await salesRepository.findCustomerOrder({
    branchId: context && context.branchId,
    orderId,
  });
  /* A wrong token is an unknown order, deliberately: anything else tells a
     prober that the id was right. */
  if (!order || String(order.token_id || '') !== token) return { order: null, reason: 'not_found' };

  const reason = whyNot(order, Date.now(), await changeSeconds(context));
  return reason ? { order: null, reason, held: order } : { order, reason: '' };
}

/**
 * The order, read back.
 *
 * Reading is allowed where changing is not: an order that has been billed,
 * paid or cancelled is exactly the one a customer wants to look at, and a
 * paid one is the only one with a bill behind it. The door is the same -
 * the id and the token together, and the order must belong to this shop.
 */
async function read(body, context) {
  const orderId = String((body && body.orderId) || '').trim();
  const token = String((body && body.token) || '').trim();
  if (!orderId || !token) return { status: false, message: 'not_found', data: null };
  const order = await salesRepository.findCustomerOrder({
    branchId: context && context.branchId,
    orderId,
  });
  if (!order || String(order.token_id || '') !== token) {
    return { status: false, message: 'not_found', data: null };
  }
  return { status: true, message: 'OK', data: await viewOf(order, context) };
}

/**
 * How long this shop usually takes to answer, when that is what is being
 * waited on.
 *
 * NOT A COOKING TIME, and there is deliberately no way to ask this for one.
 * Nothing in the product marks an order ready, so minutes-until-food would be
 * invented - and an invented ETA is worse than none, because it is the number
 * the customer waits against and then comes to the counter about.
 *
 * What a held order's customer is actually anxious about is whether anybody
 * has seen it, and the shop's own recent queue answers exactly that. Read
 * only while the order is still waiting: a shop on automatic never holds one,
 * and should never pay for the query.
 */
async function typicallyAcceptedIn(view, context) {
  if (!view || !view.progress || view.progress.waiting_for !== 'acceptance') return {};
  const minutes = await minutesOrNull(context);
  return minutes ? { typically_accepted_in_minutes: minutes } : {};
}

async function minutesOrNull(context) {
  try {
    return await salesRepository.typicalAcceptMinutes(context && context.branchId);
  } catch (e) {
    /* Decoration on a status page. It is never worth failing the read. */
    return null;
  }
}

/*
 * THE WHOLE ANSWER, SO THE PHONE NEED NOT ASK TWICE.
 *
 * Owner: "when click particulor order i see + and - button to modify but not
 * working page broken."
 *
 * It was not the buttons. A change answered with the items and the total and
 * nothing else - no can_change, no seconds, no state - so both screens that
 * offer a plus had to read the order back afterwards to redraw. Two requests
 * per tap, against a limiter of ten a minute shared with the page load: on
 * the fifth tap the read was refused, the screen had no answer to draw from,
 * the details panel vanished under his thumb and the row collapsed. Exactly
 * "not working, page broken", and nothing to do with the buttons.
 *
 * So a change answers with what a read answers. One request per tap, and the
 * screen is drawn from the same shape either way, which is also the only way
 * the two cannot drift apart.
 */
async function viewOf(order, context) {
  const seconds = await changeSeconds(context);
  const reason = whyNot(order, Date.now(), seconds);
  const view = salesRepository.customerOrderView(order);
  return {
    ...view,
    /* How long this shop usually takes to answer, and ONLY while this order
       is waiting to be answered. See typicallyAcceptedIn. */
    ...(await typicallyAcceptedIn(view, context)),
    /* Whether they may still move it, why not, and how long the shop
         leaves it open - so one read answers every question the page has,
         including what to count down. */
    can_change: reason === '',
    why_not: reason || undefined,
    change_seconds: seconds,
    /* Already asked for; the shop has it in the queue it accepts from. */
    cancel_requested: order.cancel_requested === true,
    /* And a change they have already asked for, so the page says "asked
         for" rather than offering to ask again. */
    change_requested:
      order.change_requested && Array.isArray(order.change_requested.items)
        ? order.change_requested.items
        : null,
  };
}

/**
 * A change or a cancellation, answered with the order it left behind.
 *
 * The repository answers with what it wrote, which is the honest thing for
 * it to say. This adds what the SCREEN needs to redraw without asking again:
 * the state, the window, and the seconds left. Re-read rather than patched
 * together from the old document, because a change can turn an order into a
 * cancellation and the screen must be told which it is looking at.
 *
 * A refusal passes through untouched: there is nothing to draw.
 */
async function withTheWholeOrder(done, order, context) {
  if (!done || !done.status) return done;
  const fresh = await salesRepository.findCustomerOrder({
    branchId: context && context.branchId,
    orderId: String(order._id),
  });
  if (!fresh) return done;
  /*
   * THE WRITE WINS, and the view only fills the gaps.
   *
   * Spread the other way round and the re-read overwrites what the write
   * just reported: a cancellation came back saying cancelled:false, because
   * the read had not caught up with it. The repository has just told us what
   * it did and is the authority on that; this read is here for the fields it
   * does not carry - can_change, the seconds left, the state - and for
   * nothing else.
   */
  return { ...done, data: { ...(await viewOf(fresh, context)), ...(done.data || {}) } };
}

/**
 * Several orders, in one question.
 *
 * The history page holds a list of what this phone has ordered and used to
 * ask about each one separately. Against a limiter of ten requests a minute
 * that is a page which breaks itself: every row after the tenth answers
 * "Not checked", and a row with no answer draws no details, so tapping it
 * does nothing. One question, one answer, one rate-limit slot.
 *
 * Each entry is proved the same way a single read is - the id AND the token
 * together - so this is not a way to read somebody else's orders in bulk. An
 * entry that does not prove itself is simply absent from the answer, exactly
 * as a single read would 404, and the page forgets it.
 */
const MOST_ORDERS_AT_ONCE = 20;

async function readMany(body, context) {
  const asked = Array.isArray(body && body.orders) ? body.orders.slice(0, MOST_ORDERS_AT_ONCE) : [];
  if (!asked.length) return { status: true, message: 'OK', data: { orders: [] } };

  /* The window is the shop's, not the order's, so it is read once. */
  const seconds = await changeSeconds(context);
  const now = Date.now();
  /* And so is the answering speed. One read for the whole page, rather than
     one per row - the reason this endpoint exists at all. */
  let acceptMinutes;
  const found = [];
  for (const one of asked) {
    const orderId = String((one && one.orderId) || '').trim();
    const token = String((one && one.token) || '').trim();
    if (!orderId || !token) continue;
    const order = await salesRepository.findCustomerOrder({
      branchId: context && context.branchId,
      orderId,
    });
    if (!order || String(order.token_id || '') !== token) continue;
    const reason = whyNot(order, now, seconds);
    const view = salesRepository.customerOrderView(order);
    if (
      view.progress &&
      view.progress.waiting_for === 'acceptance' &&
      acceptMinutes === undefined
    ) {
      acceptMinutes = await minutesOrNull(context);
    }
    found.push({
      ...view,
      ...(view.progress && view.progress.waiting_for === 'acceptance' && acceptMinutes
        ? { typically_accepted_in_minutes: acceptMinutes }
        : {}),
      can_change: reason === '',
      why_not: reason || undefined,
      change_seconds: seconds,
      cancel_requested: order.cancel_requested === true,
      change_requested:
        order.change_requested && Array.isArray(order.change_requested.items)
          ? order.change_requested.items
          : null,
    });
  }
  return { status: true, message: 'OK', data: { orders: found } };
}

/**
 * Set the quantity of lines already on the order - or, once the window has
 * closed, ASK the shop to.
 *
 * Owner, looking at the history page: "why order history dont have any option
 * to other than cancel? coz of time?" It was. Past the window the plus and
 * minus went away and only Cancel remained, which is a strange thing to offer
 * somebody whose actual wish is one more naan - and an arbitrary asymmetry,
 * because cancelling past the window was already allowed to become a REQUEST
 * the shop decides on. A customer who may ask for the whole order to be
 * called off may ask for two of something to be three.
 *
 * So the same shape as cancel(): inside the window it is their own order and
 * it simply changes; outside it the kitchen may have started, so the wish is
 * recorded and a person answers it in the queue the shop already works.
 */
async function change(body, context) {
  const { order, reason, held } = await heldOrder(body, context);
  const wanted = Array.isArray(body && body.items) ? body.items.slice(0, 40) : [];
  if (!wanted.length) return { status: false, message: 'nothing_asked', data: null };
  if (order) {
    const done = await salesRepository.changeCustomerOrderItems(order, wanted);
    return withTheWholeOrder(done, order, context);
  }

  /* Nothing to ask about: not theirs, already off, or already money. A
     billed or paid order is a matter for the counter, and a shop that
     refused the order is not going to amend it. */
  if (!held || reason === 'not_found' || reason === 'already_cancelled') {
    return { status: false, message: reason, data: null };
  }
  if (reason === 'already_billed' || reason === 'already_paid' || reason === 'refused_by_shop') {
    return { status: false, message: reason, data: null };
  }
  /* A hotel room or a delivery carries somebody else's money in the total,
     so it is not the customer's alone to move even by asking. */
  if (reason === 'at_the_counter') return { status: false, message: reason, data: null };

  const asked = await salesRepository.requestCustomerChange(held, wanted, held.items);
  if (!asked.status) return asked;
  return {
    status: true,
    message: 'Change requested',
    data: { ...asked.data, requested: true, why_not: reason },
  };
}

/**
 * Call the whole order off - or, once the kitchen has had it a while, ASK.
 *
 * Owner: "second cancel the order. may be approval from desktop. user can
 * submit the request however." Inside the window it is the customer's own
 * order and it simply goes. Outside it, the kitchen may have started, so
 * the customer's wish is recorded and the shop decides in the queue it
 * already uses to accept orders. Either way the customer is never told to
 * go and find somebody.
 */
async function cancel(body, context) {
  const { order, reason, held } = await heldOrder(body, context);
  if (order) {
    const done = await salesRepository.cancelCustomerOrder(order);
    return withTheWholeOrder(done, order, context);
  }

  /* Nothing to ask about: it is already off, already billed, or not theirs. */
  if (!held || reason === 'not_found' || reason === 'already_cancelled') {
    return { status: false, message: reason, data: null };
  }
  if (reason === 'already_billed' || reason === 'already_paid') {
    return { status: false, message: reason, data: null };
  }
  const asked = await salesRepository.requestCustomerCancel(held);
  if (!asked.status) return asked;
  return {
    status: true,
    message: 'Cancellation requested',
    data: { ...asked.data, requested: true, why_not: reason },
  };
}

module.exports = {
  /* The seam a test stands in for, as ordering-assistant.service does. */
  _settings,
  read,
  readMany,
  MOST_ORDERS_AT_ONCE,
  change,
  cancel,
  heldOrder,
  whyNot,
  changeSeconds,
  DEFAULT_CHANGE_SECONDS,
  MAX_CHANGE_SECONDS,
};
