'use strict';
/*
 * The online ordering channel's HTTP surface.
 *
 * Thin on purpose. The menu query lives in the item repository beside every
 * other item query, order creation lives in the sale repository beside every
 * other way a sale is made, and whether the shop is open lives in
 * utils/online-ordering beside the code the settings screen writes. This file
 * turns three of those into one reply and decides nothing itself.
 *
 * SHAPE OF THE REPLY.
 *
 * The old endpoints answered with a flat bag - products, kiosk_images,
 * kiosk_payment, kiosk_print, tableorders - named after the screen that first
 * consumed them. This one answers with the shop, the channel and the menu,
 * named after what they are, so a second client does not have to learn the
 * first client's history.
 */

const itemService = require('../services/item.service');
const salesService = require('../services/sale.service');
const SaleModel = require('../models/sale.model');

class OnlineOrderingController {
  /* The reply's own shape, built once so the public and device versions can
     never disagree about anything but the device block. */
  static present(data) {
    const store = data.store || {};
    return {
      store: {
        id: store.store_id || '',
        name: store.name || '',
        logo: store.logo || '',
        banner: store.banner || '',
        homebanner: store.homebanner || '',
        advertisement: store.advertisement || '',
      },
      channel: data.channel,
      /* Which ways the customer may pay. On/off flags, no credentials, so
         the page can draw its checkout without a privileged call. */
      payment: data.payment || {},
      menu: { categories: data.products || [] },
      tables: data.tableorders || [],
    };
  }

  respond(res, result, present) {
    if (result && result.status === true) {
      return res.json({
        type: 'success',
        message: result.message || 'OK',
        data: present ? present(result.data) : result.data,
      });
    }

    /*
     * 404 for a store address nobody owns, 409 for a shop that exists and is
     * shut. A closed shop is not a missing one, and a customer's page needs to
     * tell those apart to know whether to show the menu or an error.
     */
    const state = (result && result.data && result.data.state) || null;
    const status = state && state !== 'disabled' ? 409 : 404;
    return res.status(status).json({
      type: 'error',
      message: (result && result.message) || 'Not found',
      data: (result && result.data) || null,
    });
  }

  async storefront(req, res) {
    try {
      const result = await itemService.storefront({ storeId: req.params.storeId });
      return this.respond(res, result, OnlineOrderingController.present);
    } catch (error) {
      console.error('Error in online ordering storefront:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  async deviceStorefront(req, res) {
    try {
      const result = await itemService.storefront({ storeId: req.params.storeId });
      return this.respond(res, result, (data) => ({
        ...OnlineOrderingController.present(data),
        /* Only for the shop's own equipment: which printer the ticket goes
           to. Meaningless on a customer's phone, so it is not sent there. */
        device: {
          print: data.print || {},
        },
      }));
    } catch (error) {
      console.error('Error in online ordering device storefront:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  async createOrder(req, res) {
    try {
      /*
       * The store address comes from the path, never the body. Taking it from
       * both would let a caller name one shop in the URL and another in the
       * payload, and leave two readers to disagree about which one they meant.
       */
      const result = await salesService.createOnlineOrder(
        { ...req.body, branch: req.params.storeId },
        { SaleModel }
      );
      return this.respond(res, result);
    } catch (error) {
      console.error('Error in online ordering createOrder:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }
}

module.exports = new OnlineOrderingController();
