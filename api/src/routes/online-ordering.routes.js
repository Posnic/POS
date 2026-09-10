'use strict';
/*
 * A shop's online ordering channel, as the outside world sees it.
 *
 * ONE RESOURCE, ADDRESSED BY THE SHOP'S PUBLIC STORE ADDRESS.
 *
 * This replaces three endpoints that each did part of the job under a name
 * describing how the customer happened to arrive:
 *
 *   POST /items/accessQr        the menu, for a phone that scanned a code
 *   POST /items/accesskiosk     the same menu, for the shop's own terminal
 *   POST /sales/qrOrder         an order, from either
 *
 * The transport is not the resource. A customer reaches the same storefront by
 * scanning a code on a table, following a link in a message, tapping a button
 * on a search listing, or standing at a terminal in the shop, and none of those
 * should be a separate endpoint under a different noun. So there is one
 * storefront, named for what it is, and the door it was opened by stops
 * mattering.
 *
 * All of it is anonymous, because a customer's phone has no credentials. The
 * STORE ADDRESS is the opt-in: a branch that never chose one cannot be reached
 * here, and a branch's raw database id - which appears in every authenticated
 * response and is no secret - buys nothing. The shop's own equipment presents
 * the installation's kiosk key and gets the extra fields it needs to take
 * payment and print, which a customer's phone never sees.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/online-ordering.controller');
const { ensureKioskKey } = require('../middleware/kiosk-key');

const bind = (handler) => handler.bind(controller);

/*
 * The storefront: who this shop is, whether it is taking orders, and what is
 * on the menu.
 *
 * A GET, because it is a read and it should be cacheable, linkable and
 * openable in a browser. The old shape was a POST carrying the store id in a
 * JSON body, which meant a customer's menu could not be a URL.
 */
router.get('/:storeId', bind(controller.storefront));

/*
 * The same storefront, for the shop's own equipment.
 *
 * Separate path rather than a flag on the one above, so the privileged reply
 * can never be produced by accident: reaching it at all requires the kiosk key
 * that only this installation's own devices hold.
 */
router.get('/:storeId/device', ensureKioskKey, bind(controller.deviceStorefront));

/* Placing an order. The channel state is checked again here, server-side, no
   matter what the page believed when it drew its cart. */
router.post('/:storeId/orders', bind(controller.createOrder));

module.exports = router;
