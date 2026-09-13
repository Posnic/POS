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

  /* ------------------------------------------------------------- the noise
   *
   * Owner: "one order sound in desktop also. play. new order came."
   *
   * ONLY WHERE NOTHING ELSE IS MAKING IT. Inside the desktop app the main
   * process already synthesises these two tones and hands them to a window to
   * play (src/order-alert.js, core/order-alert.js) - that path is better,
   * because it keeps sounding until somebody deals with the queue. A shop on
   * the web frontend has no main process at all and so had no sound of any
   * kind. This is that shop's sound, and it steps aside where the other one
   * exists rather than ringing twice.
   */
  function hasDesktopAlert() {
    try {
      return !!(window.electronAPI && window.electronAPI.orderAlert);
    } catch (e) {
      return false;
    }
  }

  var box = null;
  function context() {
    if (box) return box;
    try {
      var Maker = window.AudioContext || window.webkitAudioContext;
      box = Maker ? new Maker() : null;
    } catch (e) {
      box = null;
    }
    return box;
  }

  /*
   * THE SAME TWO TONES THE DESKTOP MAKES, so a shop that runs both hears one
   * product rather than two. src/order-alert.js builds them as WAV; these are
   * the same notes and lengths through the browser's own oscillator.
   *
   *   received  a rising two-note chime, brief and forgettable - it happens
   *             forty times an hour.
   *   waiting   three insistent notes, louder and longer, because this one
   *             has to carry across a room.
   */
  var TONES = {
    received: [
      [784, 0.11, 0.35],
      [1047, 0.16, 0.35],
    ],
    waiting: [
      [988, 0.15, 0.5],
      [740, 0.15, 0.5],
      [988, 0.26, 0.5],
    ],
  };

  function sound(which) {
    if (hasDesktopAlert()) return false;
    var ctx = context();
    if (!ctx) return false;
    try {
      /* Browsers refuse audio until the page has been interacted with. A till
         somebody is working at has been; one sitting untouched since it was
         switched on has not, and the badge is what carries it there. */
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var at = ctx.currentTime;
      (TONES[which] || TONES.received).forEach(function (note) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.frequency.value = note[0];
        osc.type = 'sine';
        /* Short ramps at both ends: a square-edged start and stop is heard as
           a click, which is what makes a synthesised tone sound cheap. */
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(note[2], at + 0.012);
        gain.gain.setValueAtTime(note[2], at + note[1] - 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note[1]);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + note[1] + 0.01);
        at += note[1];
      });
      return true;
    } catch (e) {
      /* No audio device, or a policy that refuses even this. The badge and
         the toast are the parts that must never depend on sound. */
      return false;
    }
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

    /*
     * THE BILL NUMBER LEADS, then the token.
     *
     * Owner's call, and the right one: the queue card leads with the bill
     * number and that is what staff scan for, so a toast that led with the
     * token made somebody translate between two numbers under pressure. The
     * token stays beside it, because it is what the customer is holding and
     * what gets called out across the counter.
     */
    var bill = String(order.sales_id || '');
    var token = String(order.token_id || order.token || '');
    var line =
      why === 'cancel'
        ? t('lang_cancel_requested', 'Customer asked to cancel')
        : t('lang_new_online_order', 'New online order');
    if (bill) line += ' - ' + bill;
    if (token) line += (bill ? ' · ' : ' - ') + t('lang_token', 'Token') + ' ' + token;

    /* A new order chimes; one the customer wants called off is the louder,
       longer pattern, because it is the one somebody has to act on. */
    sound(why === 'cancel' ? 'waiting' : 'received');

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

  window.PosnicOnlineOrderWatch = {
    look: look,
    badge: badge,
    sound: sound,
    hasDesktopAlert: hasDesktopAlert,
    _announced: announced,
  };
})();
