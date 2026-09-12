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
 * Thirty seconds is what the delivery apps settled on and what a customer
 * expects: long enough to catch "no, two" the moment they hear themselves,
 * short enough that a kitchen is not amending something already on the pass.
 */
const DEFAULT_CHANGE_SECONDS = 30;
/* A window nobody would call a window: a shop cannot leave an order open to
   editing for a day and be surprised by what comes back. */
const MAX_CHANGE_SECONDS = 900;

let settings = null;
const _settings = () => {
  if (!settings) settings = new SettingsRepository();
  return settings;
};

/** How long this shop leaves an order open, in seconds. */
async function changeSeconds(context) {
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
  const seconds = await changeSeconds(context);
  const reason = whyNot(order, Date.now(), seconds);
  return {
    status: true,
    message: 'OK',
    data: {
      ...salesRepository.customerOrderView(order),
      /* Whether they may still move it, why not, and how long the shop
         leaves it open - so one read answers every question the page has,
         including what to count down. */
      can_change: reason === '',
      why_not: reason || undefined,
      change_seconds: seconds,
      /* Already asked for; the shop has it in the queue it accepts from. */
      cancel_requested: order.cancel_requested === true,
    },
  };
}

/** Set the quantity of lines already on the order; 0 takes a line off it. */
async function change(body, context) {
  const { order, reason } = await heldOrder(body, context);
  if (!order) return { status: false, message: reason, data: null };
  const wanted = Array.isArray(body && body.items) ? body.items.slice(0, 40) : [];
  if (!wanted.length) return { status: false, message: 'nothing_asked', data: null };
  return salesRepository.changeCustomerOrderItems(order, wanted);
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
  if (order) return salesRepository.cancelCustomerOrder(order);

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
  change,
  cancel,
  heldOrder,
  whyNot,
  changeSeconds,
  DEFAULT_CHANGE_SECONDS,
  MAX_CHANGE_SECONDS,
};
