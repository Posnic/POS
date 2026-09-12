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
const {
  assistantLimiter,
  voiceLimiter,
  voiceTickLimiter,
} = require('../middleware/assistant-rate-limit');

const bind = (handler) => handler.bind(controller);

/*
 * The shop's default storefront, for a URL that names no branch.
 *
 * Most shops have exactly one branch, and making all of them print a code to
 * say which of their single branch they mean is friction paid by the many for
 * the few. `/order` lands here; `/order/AZ100` names one explicitly.
 *
 * Declared BEFORE `/:storeId`, or Express reads the empty path as a store
 * address and every default lookup becomes a 404 for a shop called "".
 */
router.get('/', bind(controller.defaultStorefront));

/*
 * The storefront: who this shop is, whether it is taking orders, and what is
 * on the menu.
 *
 * A GET, because it is a read and it should be cacheable, linkable and
 * openable in a browser. The old shape was a POST carrying the store id in a
 * JSON body, which meant a customer's menu could not be a URL.
 */
/*
 * The public menu: what the kitchen cooks, for reading.
 *
 * A different document from the storefront above, which answers with what can
 * be ordered right now. A menu lists the dish that is off tonight too, because
 * a menu with holes in it reads as a kitchen that has run out of food.
 *
 * Both forms declared BEFORE `/:storeId`. `menu` is a legal-looking store
 * address, so without the ordering here a shop could never reach its own menu -
 * and `menu` is refused as a store address for the same reason.
 */
router.get('/menu', bind(controller.defaultMenu));
router.get('/:storeId/menu', bind(controller.menu));

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

/*
 * One turn with the shop's ordering assistant: the conversation so far and
 * the order so far in, a reply and the things to add out. Anonymous like
 * the rest, billed to the shop's own AI account, so it is rate-limited per
 * client here and switched on per shop inside.
 */
router.post('/:storeId/assistant', assistantLimiter, bind(controller.assistant));

/*
 * A live voice line with the same assistant: the page's WebRTC offer in,
 * the provider's answer out, the audio then phone to provider without us.
 * Anonymous like the rest, billed per minute to the shop's own account, so
 * it has its own switch inside and its own limit here.
 */
router.post('/:storeId/voice', voiceLimiter, bind(controller.voice));

/*
 * The meter on that line: the page reports every half minute that it is
 * still open, and once as it hangs up. The server clocks the seconds itself
 * and prices them against the monthly limit; past it, this answers 403 and
 * the page hangs up. See services/voice-meter.js.
 */
router.post('/:storeId/voice/:session/tick', voiceTickLimiter, bind(controller.voiceTick));

module.exports = router;
