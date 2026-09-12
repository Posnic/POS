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

/* Long enough for a change of mind over a menu, short enough that a kitchen
   is not amending something it plated half an hour ago. */
const CHANGE_WINDOW_MINUTES = 45;

/** Why this order is not the customer's to change, or '' when it is. */
function whyNot(order, now = Date.now()) {
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
  const placed = new Date(order.created_date || order.date || 0).getTime();
  if (!placed || now - placed > CHANGE_WINDOW_MINUTES * 60 * 1000) return 'too_late';
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

  const reason = whyNot(order);
  return reason ? { order: null, reason } : { order, reason: '' };
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
  return {
    status: true,
    message: 'OK',
    data: {
      ...salesRepository.customerOrderView(order),
      /* Whether they may still move it, and why not, so one read answers
         every question the page has. */
      can_change: whyNot(order) === '',
      why_not: whyNot(order) || undefined,
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

/** Call the whole order off. */
async function cancel(body, context) {
  const { order, reason } = await heldOrder(body, context);
  if (!order) return { status: false, message: reason, data: null };
  return salesRepository.cancelCustomerOrder(order);
}

module.exports = { read, change, cancel, heldOrder, whyNot, CHANGE_WINDOW_MINUTES };
