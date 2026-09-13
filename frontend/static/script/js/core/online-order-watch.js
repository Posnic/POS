/*
 * The online order queue, watched from wherever the person happens to be.
 *
 * Owner: "dektop notification nothing received for cancel request."
 *
 * He is right, and there were two holes.
 *
 * ONE. NOTHING POLLED. The queue is drawn by PosnicPro.onlineorders.load(),
 * which runs when somebody OPENS the Online orders page. A cancellation a
 * customer asked for while the till was on the sale screen sat there until
 * somebody thought to go and look. The one event in this product that arrives
 * with nobody standing in front of the till was the one nothing watched.
 *
 * TWO. THE SOUND IS DESKTOP-ONLY, BY CONSTRUCTION. src/order-alert.js listens
 * on the process event bus, which works because the API runs inside the same
 * Electron process. A shop on the web frontend has no such process: the API is
 * on a server on the other side of the internet, and process.emit there
 * reaches nothing here. So on the web there was no notification of any kind,
 * for a new order or a cancellation.
 *
 * This is the part that works everywhere: ask the server what is waiting,
 * carry the count on the sidebar so it is visible from every screen, and say
 * something the first time a particular order starts waiting. On the desktop
 * the sound still comes from the main process and this adds the badge; in a
 * browser this is the whole notification.
 *
 * QUIET BY DEFAULT. The owner's standing rule is that nothing blocks the
 * screen - no modal, no confirm. A number on the menu and one toast per new
 * arrival, and acting on it is always the person's choice.
 */
(function () {
  'use strict';

  /* Long enough not to be a load on a shop's own server, short enough that a
     customer who has just asked to cancel is not waiting on a person's
     curiosity. The queue is a handful of rows; this is a cheap read. */
  var EVERY_MS = 20000;

  /* What was waiting last time, so a toast is one per arrival rather than one
     per poll. Keyed by sale id and by WHY it is waiting: an order that was
     waiting for approval and then has a cancellation asked about it is a new
     thing to say, not the same thing again. */
  var announced = Object.create(null);
  var timer = 0;
  var asking = false;

  function t(key, fallback) {
    try {
      if (window.PosnicPro && PosnicPro.i18n && typeof PosnicPro.i18n.t === 'function') {
        return PosnicPro.i18n.t(key, fallback);
      }
    } catch (e) {
      /* before the dictionary is up, the English is the honest answer */
    }
    return fallback;
  }

  /*
   * The count, on the menu entry.
   *
   * On the sidebar rather than only on the page, because the whole problem is
   * that nobody is on the page. It is created once and then only its number
   * changes, so a repaint of the sidebar does not stack badges.
   */
  function badge(count) {
    var link = document.getElementById('view_onlineorders_page');
    if (!link) return;
    var mark = link.querySelector('.online-orders-badge');
    if (!count) {
      if (mark) mark.remove();
      return;
    }
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'online-orders-badge';
      link.appendChild(mark);
    }
    mark.textContent = String(count);
    mark.setAttribute('aria-label', t('lang_orders_waiting', 'orders waiting'));
  }

  /** One sentence about one order, said once. */
  function announce(order) {
    var id = String(order.sale_id || order._id || '');
    if (!id) return;
    var why = order.cancel_requested === true ? 'cancel' : 'new';
    if (announced[id] === why) return;
    announced[id] = why;

    var token = String(order.token_id || order.token || '');
    var line =
      why === 'cancel'
        ? t('lang_cancel_requested', 'Customer asked to cancel')
        : t('lang_new_online_order', 'New online order');
    if (token) line += ' - ' + t('lang_token', 'Token') + ' ' + token;

    try {
      if (window.PosnicPro && typeof PosnicPro.alert === 'function') {
        /* The heading is jq-toast's ICON, not a label: PosnicPro.alert reads
           'Alert' and 'Information' and lowercases anything else into a class
           name. It stays English on purpose. The sentence beside it is what
           the person reads, and that IS translated. */
        PosnicPro.alert(why === 'cancel' ? 'Alert' : 'Information', line);
      }
    } catch (e) {
      /* A toast that fails is a quiet shop, not a lost order: the badge
         above is the part that must never depend on this. */
    }
  }

  function look() {
    if (asking) return;
    if (document.hidden) return;
    if (!window.PosnicPro || typeof PosnicPro.get !== 'function') return;
    asking = true;
    try {
      PosnicPro.get(
        { url: 'sales/pendingOnlineOrders', data: {} },
        function (response) {
          asking = false;
          var list = (response && response.data) || [];
          badge(list.length);

          var alive = Object.create(null);
          list.forEach(function (order) {
            var id = String(order.sale_id || order._id || '');
            if (id) alive[id] = true;
            announce(order);
          });
          /* Forget what is no longer waiting, so the same order arriving
             again later is announced again rather than silently. */
          Object.keys(announced).forEach(function (id) {
            if (!alive[id]) delete announced[id];
          });
        },
        function () {
          asking = false;
          /* A shop that cannot be reached is not a shop with an empty queue:
             the badge keeps whatever it last knew rather than claiming all
             clear. */
        }
      );
    } catch (e) {
      asking = false;
    }
  }

  function start() {
    if (timer) return;
    look();
    timer = setInterval(look, EVERY_MS);
  }

  /* Nothing to watch until somebody is signed in and the menu exists. The
     login page does not load this file, and the sidebar arrives with the
     shell, so the first look is deferred to it. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* A till that has been left on a dark screen should not keep asking; it
     catches up the moment somebody comes back to it. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) look();
  });

  window.PosnicOnlineOrderWatch = { look: look, badge: badge, _announced: announced };
})();
