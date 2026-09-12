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

/*
 * ItemService is a CLASS, not a ready-made instance.
 *
 * sale.service.js next door exports a plain object, so `salesService.foo()`
 * works straight off the require. This one does not, and requiring it the same
 * way makes every method `undefined`: the storefront, the menu and the default
 * branch lookup all became "itemService.defaultStoreId is not a function" the
 * moment a real request arrived. The unit tests never saw it because they mock
 * the service, so the shape only shows up in production.
 */
const ItemService = require('../services/item.service');
const salesChannels = require('../utils/sales-channels');
const itemService = new ItemService();
const salesService = require('../services/sale.service');
const SaleModel = require('../models/sale.model');
const orderingAssistant = require('../services/ordering-assistant.service');
const voiceSession = require('../services/voice-session.service');

/**
 * Where the customer is sitting, as their own URL described it.
 *
 * The page is served at /order/AZ100/table/5 and /order/AZ100/venue/RC/123 and
 * passes those parts back here as query parameters, because the API resource
 * is addressed by store id and a service point is a QUALIFIER on the read, not
 * a different resource: the same menu, priced for where you are sitting.
 *
 * Only the identity travels. The phone says which venue the printed code
 * named; it does not get to say what that venue's markup is, and the server
 * looks up the terms itself.
 */
function servicePointFrom(req) {
  const q = (req && req.query) || {};
  return {
    table: String(q.table || '').slice(0, 24),
    venue: String(q.venue || '').slice(0, 12),
    unit: String(q.unit || '').slice(0, 24),
  };
}

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
        /* The symbol beside every price and the ISO code, so the ordering
           page writes the shop's money rather than a hardcoded rupee. */
        currency: store.currency || '',
        currency_code: store.currency_code || '',
        /* A restaurant or a shop. Absent on an older server reads as a
           restaurant, which is what the page assumed before it could ask. */
        kind: store.kind === 'retail' ? 'retail' : 'restaurant',
      },
      /* What this shop offers beyond the list - a note for the kitchen. */
      features: data.features || { notes: false },
      channel: data.channel,
      /* Where this customer is sitting, and what a delivery costs them. Both
         echoed back so the page never has to work out a price the server will
         later disagree with. */
      service_point: data.service_point || { label: '', venue: null },
      charges: data.charges || {},
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
      const result = await itemService.storefront({
        storeId: req.params.storeId,
        ...servicePointFrom(req),
      });
      return this.respond(res, result, OnlineOrderingController.present);
    } catch (error) {
      console.error('Error in online ordering storefront:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  /**
   * The storefront a URL with no store address means.
   *
   * The two failures are told apart on purpose, because they need different
   * words in front of a customer and different actions from the shop: a shop
   * that has never set up online ordering is not the same as a chain that has
   * several branches and has not said which one this address belongs to.
   */
  async defaultStorefront(req, res) {
    try {
      const { storeId, reason } = await itemService.defaultStoreId();

      if (!storeId) {
        const message =
          reason === 'ambiguous'
            ? 'This shop has several branches. Please use the link or code for the one you want.'
            : 'This shop is not taking online orders yet.';
        return res.status(404).json({ type: 'error', message, data: { reason } });
      }

      const result = await itemService.storefront({ storeId, ...servicePointFrom(req) });
      return this.respond(res, result, OnlineOrderingController.present);
    } catch (error) {
      console.error('Error in online ordering defaultStorefront:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  async deviceStorefront(req, res) {
    try {
      const result = await itemService.storefront({
        storeId: req.params.storeId,
        /* The shop's own machine is its own channel, with its own exception
           list on the Kiosk Machine screen. Read as "online" it showed the
           phone's list and ignored the kiosk's. */
        channel: salesChannels.CHANNEL.KIOSK,
        ...servicePointFrom(req),
      });
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

  /**
   * The public menu for one branch.
   *
   * Answers whether or not the shop is taking orders, because a menu is worth
   * reading either way - and a customer standing outside a closed restaurant
   * looking at what it serves is the whole point of putting one online.
   */
  async menu(req, res) {
    try {
      const result = await itemService.publicMenu({
        storeId: req.params.storeId,
        ...servicePointFrom(req),
      });
      return this.respond(res, result);
    } catch (error) {
      console.error('Error in online ordering menu:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  /** The same, for a `/menu` URL that names no branch. */
  async defaultMenu(req, res) {
    try {
      const { storeId, reason } = await itemService.defaultStoreId();
      if (!storeId) {
        const message =
          reason === 'ambiguous'
            ? 'This shop has several branches. Please use the link or code for the one you want.'
            : 'This shop has not published a menu yet.';
        return res.status(404).json({ type: 'error', message, data: { reason } });
      }
      const result = await itemService.publicMenu({ storeId, ...servicePointFrom(req) });
      return this.respond(res, result);
    } catch (error) {
      console.error('Error in online ordering defaultMenu:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  /**
   * One turn with the shop's ordering assistant.
   *
   * Public and anonymous like the rest of the storefront, and paid for by
   * the shop, so three doors have to be open before a model is asked: the
   * address names a shop, the shop has usable AI, and the shop switched the
   * assistant on for its ordering page. The menu the model sees is the same
   * storefront the page drew, fetched here rather than trusted from the
   * body - a client that sends its own menu is a client naming its own
   * prices.
   */
  async assistant(req, res) {
    try {
      const storeId = req.params.storeId;
      const context = await itemService.storefrontContext({ storeId });
      if (!context) {
        return res
          .status(404)
          .json({ type: 'error', message: 'No shop found at this address', data: null });
      }
      const front = await itemService.storefront({ storeId, ...servicePointFrom(req) });
      if (!front || !front.status) return this.respond(res, front);

      const result = await orderingAssistant.reply(req.body || {}, front.data, context);
      if (result.status) return this.respond(res, result);
      if (result.message === 'no_assistant') {
        return res.status(403).json({
          type: 'error',
          message: 'This shop has not switched on the ordering assistant',
          data: null,
        });
      }
      if (result.message === 'Nothing was asked') {
        return res.status(400).json({ type: 'error', message: result.message, data: null });
      }
      /* The shop's cap, a provider having a bad day: the menu still works. */
      return res.status(503).json({ type: 'error', message: result.message, data: null });
    } catch (error) {
      console.error('Error in online ordering assistant:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  /**
   * Open a live voice line for one customer.
   *
   * The page sends its WebRTC offer; the shop's provider answers it, and
   * the audio then flows phone to provider without us. Same doors as the
   * typed assistant plus one more, because minutes of audio cost more than
   * typed questions.
   */
  async voice(req, res) {
    try {
      const storeId = req.params.storeId;
      const context = await itemService.storefrontContext({ storeId });
      if (!context) {
        return res
          .status(404)
          .json({ type: 'error', message: 'No shop found at this address', data: null });
      }
      const front = await itemService.storefront({ storeId, ...servicePointFrom(req) });
      if (!front || !front.status) return this.respond(res, front);

      const result = await voiceSession.session(req.body || {}, front.data, context);
      if (result.status) return this.respond(res, result);
      if (result.message === 'no_assistant' || result.message === 'no_live_voice') {
        return res.status(403).json({
          type: 'error',
          message:
            result.message === 'no_assistant'
              ? 'This shop has not switched on the ordering assistant'
              : 'This shop has not switched on live voice',
          data: null,
        });
      }
      if (result.message === 'Nothing to connect') {
        return res.status(400).json({ type: 'error', message: result.message, data: null });
      }
      return res.status(503).json({ type: 'error', message: result.message, data: null });
    } catch (error) {
      console.error('Error in online ordering voice:', error);
      return res.status(500).json({ type: 'error', message: error.message, data: null });
    }
  }

  /**
   * The line is still open: the page says so every half minute, and once
   * more as it closes. Each tick is metered against the shop's monthly
   * limit; past the limit the answer is a refusal and the page hangs up.
   */
  async voiceTick(req, res) {
    try {
      const context = await itemService.storefrontContext({ storeId: req.params.storeId });
      if (!context) {
        return res
          .status(404)
          .json({ type: 'error', message: 'No shop found at this address', data: null });
      }
      /* The hang-up report is a beacon with no body, so its `end` rides on
         the address; a report from an open line carries it in the body. */
      const body = req.body || {};
      const end = body.end != null ? body.end : req.query && req.query.end;
      const result = await voiceSession.tick(String(req.params.session || ''), { end }, context);
      if (result.status) return this.respond(res, result);
      if (result.message === 'cap') {
        return res.status(403).json({
          type: 'error',
          message: 'This shop has reached its monthly AI spending limit',
          data: result.data,
        });
      }
      if (result.message === 'no_session') {
        return res
          .status(404)
          .json({ type: 'error', message: 'No such voice session', data: null });
      }
      return res.status(503).json({ type: 'error', message: result.message, data: null });
    } catch (error) {
      console.error('Error in online ordering voice tick:', error);
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
