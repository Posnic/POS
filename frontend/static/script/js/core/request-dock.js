/*
 * THE REQUESTS A CUSTOMER HAS MADE, WHERE STAFF ALREADY ARE.
 *
 * Owner: "i want handle change reqeust smarlty like facebook chat pop up.
 * user able see all request properly easily handle. if possile provide when
 * its orders like order 10mins before etc."
 *
 * And before that: "when i asked cancel, deskto didnt show anthing."
 *
 * WHY A DOCK AND NOT A PAGE. The queue already exists and is good - it shows
 * the dish-level difference a customer asked for, "2 to 3 Chicken Biryani",
 * which is a decision somebody can make at a glance. Its problem is that it
 * is a PAGE. A till is on the sale screen with a queue of people in front of
 * it, and a request that needs answering in the next two minutes cannot live
 * behind a navigation. So it comes to them: bottom right, above everything,
 * on every screen, the way a chat window does.
 *
 * HOW LONG AGO, because that is the whole decision. "Cancel this?" is a
 * different question at forty seconds and at eleven minutes - one the kitchen
 * has not started, the other it has plated - and a timestamp makes a person
 * do that arithmetic under pressure. The card says "ordered 11 minutes ago"
 * and updates itself while it sits open.
 *
 * IT DECIDES NOTHING OF ITS OWN. Accept and refuse go through the same
 * endpoint the queue page uses, so there is one implementation of what
 * accepting a cancellation means; this is a second door onto it, not a second
 * copy of it.
 */
(function () {
  'use strict';

  /* The queue is read by online-order-watch.js every twenty seconds; this
     draws whatever that last saw, so the two never disagree and the shop is
     not asked twice. */
  var EVERY_MS = 20000;
  var timer = 0;
  var open = false;
  var dock = null;
  var known = [];
  var busy = {};

  /* The same door online-order-watch.js uses, for the same reason: before the
     dictionary is up, the English is the honest answer. */
  function t(key, fallback) {
    try {
      if (window.PosnicPro && PosnicPro.i18n && typeof PosnicPro.i18n.t === 'function') {
        return PosnicPro.i18n.t(key, fallback);
      }
    } catch (e) {
      /* fall through to English */
    }
    return fallback;
  }

  function safe(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * How long ago, in the words somebody says out loud.
   *
   * Owner: "if possile provide when its orders like order 10mins before etc."
   * Minutes for the first hour, because that is the window in which any of
   * these decisions are actually different from one another.
   */
  function howLongAgo(when) {
    var at = new Date(when || 0).getTime();
    if (!at) return '';
    var mins = Math.floor((Date.now() - at) / 60000);
    if (mins < 1) return t('lang_just_now', 'just now');
    if (mins === 1) return t('lang_a_minute_ago', '1 minute ago');
    if (mins < 60) return String(mins) + ' ' + t('lang_minutes_ago', 'minutes ago');
    var hours = Math.floor(mins / 60);
    if (hours === 1) return t('lang_an_hour_ago', '1 hour ago');
    return String(hours) + ' ' + t('lang_hours_ago', 'hours ago');
  }

  /**
   * What kind of thing this is, which decides the words, the colour and
   * whether there is anything to decide at all.
   *
   * `gone` is the one that was missing and is the reason this exists: a
   * customer who cancelled INSIDE the window did not ask for anything - the
   * order simply went - and until now the only thing told about it was the
   * printer. Nothing here waits on a yes or a no; the shop just has to learn
   * that a ticket it may be cooking has been pulled.
   */
  function kindOf(order) {
    if (order.cancel_seen === false && order.customer_cancelled_at) return 'gone';
    if (order.cancel_requested === true) return 'cancel';
    if (order.change_requested && (order.change_requested.items || []).length) return 'change';
    return 'new';
  }

/*
 * WHAT "YES" AND "NO" MEAN TO THE SERVER, WHICH DEPENDS ON THE KIND.
 *
 * The dock sent "accept" and "reject" for everything, and for a NEW order the
 * approval state machine wants the state itself - "accepted" - so it got a
 * word that is not a state, could not name one, and answered "unknown state".
 * Owner: "i see some error. why? when click accept it happend."
 *
 * The three kinds genuinely mean three different things, and the queue page
 * (modules/js/online_orders.js) has always known it:
 *
 *   a new order          accepted / rejected   the state it moves to
 *   a cancel request     cancel / keep         the customer's wish, or not
 *   a change request     accept / keep         make it so, or leave it
 *
 * Mirrored here rather than shared because they are in different bundles;
 * the comment on each side names the other so neither drifts silently.
 */
  var VERBS = {
    new: { accept: 'accepted', reject: 'rejected' },
    cancel: { accept: 'cancel', reject: 'keep' },
    change: { accept: 'accept', reject: 'keep' },
    /* Already off. Either button only marks it seen; decideOnOrder answers
       that before the state machine is ever reached. */
    gone: { accept: 'seen', reject: 'seen' },
  };

  var WORDS = {
    gone: ['lang_customer_cancelled', 'Customer cancelled this'],
    cancel: ['lang_cancel_requested', 'Asked to cancel'],
    change: ['lang_change_requested', 'Asked to change'],
    new: ['lang_new_online_order', 'New order'],
  };

  /* What a customer asked to have changed, written as dish names and
     quantities - the same sentence the queue page uses, because whoever reads
     it is standing at a till in a hurry. */
  function whatChanged(order) {
    var wants = (order.change_requested && order.change_requested.items) || [];
    if (!wants.length) return '';
    return (
      '<ul class="request-dock-diff">' +
      wants
        .map(function (one) {
          var name = safe(one.name || '');
          var was = Number(one.was || 0);
          var now = Number(one.quantity || 0);
          if (!was) return '<li>+ ' + now + ' &times; ' + name + '</li>';
          if (!now) return '<li>' + t('lang_remove', 'Remove') + ' ' + name + '</li>';
          return '<li>' + name + ': ' + was + ' &rarr; ' + now + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function card(order) {
    var id = String(order.sale_id || order._id || '');
    var kind = kindOf(order);
    var words = WORDS[kind];
    var bill = safe(order.sales_id || '');
    var token = safe(order.token_id || order.token || '');
    var where = order.table_number
      ? t('lang_table', 'Table') + ' ' + safe(order.table_number)
      : safe(order.fulfilment || '');
    var working = busy[id] ? ' is-working' : '';

    return (
      '<li class="request-dock-card" data-kind="' + kind + '" data-order="' + safe(id) + '">' +
      '<div class="request-dock-what">' +
      '<span class="request-dock-kind">' + t(words[0], words[1]) + '</span>' +
      '<span class="request-dock-when">' + safe(howLongAgo(order.created_date)) + '</span>' +
      '</div>' +
      '<div class="request-dock-who">' +
      (bill ? '<b>' + bill + '</b>' : '') +
      (token ? '<span>' + t('lang_token', 'Token') + ' ' + token + '</span>' : '') +
      (where ? '<span>' + where + '</span>' : '') +
      '</div>' +
      whatChanged(order) +
      /* Already off: one button, and it says what it does. Two buttons on
         something nobody can decide is two ways to be confused. */
      (kind === 'gone'
        ? '<div class="request-dock-do">' +
          '<button type="button" class="request-dock-yes' + working + '" data-do="accept">' +
          t('lang_got_it', 'Got it') + '</button>' +
          '</div>'
        : '<div class="request-dock-do">' +
          '<button type="button" class="request-dock-no' + working + '" data-do="reject">' +
          t('lang_refuse', 'Refuse') + '</button>' +
          '<button type="button" class="request-dock-yes' + working + '" data-do="accept">' +
          t('lang_accept', 'Accept') + '</button>' +
          '</div>') +
      '</li>'
    );
  }

  function build() {
    if (dock) return dock;
    dock = document.createElement('div');
    dock.className = 'request-dock';
    dock.id = 'request-dock';
    dock.hidden = true;
    dock.innerHTML =
      '<button type="button" class="request-dock-tab" id="request-dock-tab" aria-expanded="false">' +
      '<span class="request-dock-tab-word">' + t('lang_requests', 'Requests') + '</span>' +
      '<span class="request-dock-count" id="request-dock-count">0</span>' +
      '</button>' +
      '<div class="request-dock-panel" id="request-dock-panel" hidden>' +
      '<ul class="request-dock-list" id="request-dock-list"></ul>' +
      '<a class="request-dock-all" href="#/onlineorders">' +
      t('lang_see_all_orders', 'Open the order queue') + '</a>' +
      '</div>';
    document.body.appendChild(dock);

    dock.querySelector('#request-dock-tab').addEventListener('click', function () {
      open = !open;
      paint();
    });
    dock.addEventListener('click', onDo);
    return dock;
  }

  async function onDo(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-do]') : null;
    if (!button) return;
    var row = button.closest('[data-order]');
    if (!row) return;
    var id = row.getAttribute('data-order');
    var kind = row.getAttribute('data-kind') || 'new';
    var verb = (VERBS[kind] || VERBS.new)[button.getAttribute('data-do')] || 'accepted';
    if (busy[id]) return;
    busy[id] = true;
    paint();

    /*
     * THE SAME DOOR THE QUEUE PAGE USES. Accepting a cancellation means one
     * thing in this shop and it is defined once, on the server; this is a
     * second way to reach it, never a second copy of it.
     */
    try {
      await new Promise(function (done) {
        PosnicPro.post(
          {
            url: 'sales/' + encodeURIComponent(id) + '/approval',
            data: JSON.stringify({ decision: verb, reason: '' }),
          },
          /*
           * A SHOP THAT SAID NO IS QUOTED, NOT SWALLOWED.
           *
           * The first cut ignored both answers and simply re-read the queue,
           * so a refusal looked exactly like a success that had not arrived
           * yet - which is how "unknown state" went unexplained until it was
           * seen in a toast on a real till.
           */
          function (answer) {
            if (answer && answer.type !== 'success' && window.PosnicPro && PosnicPro.alert) {
              PosnicPro.alert('Alert', String(answer.message || 'That did not go through'));
            }
            done();
          },
          function (answer) {
            if (window.PosnicPro && PosnicPro.alert) {
              PosnicPro.alert('Alert', String((answer && answer.message) || 'The shop could not be reached'));
            }
            done();
          }
        );
      });
    } catch (e) {
      /* A refusal that did not reach the shop leaves the card where it is,
         which is the safe side: nothing is marked handled that was not. */
    }
    delete busy[id];
    /* Redrawn from the shop rather than from here, so the dock never claims
       an outcome the server did not give it. */
    look();
    try {
      if (window.PosnicOnlineOrderWatch && PosnicOnlineOrderWatch.look) PosnicOnlineOrderWatch.look();
      if (window.PosnicPro && PosnicPro.onlineorders && PosnicPro.onlineorders.load) PosnicPro.onlineorders.load();
    } catch (e) {
      /* the queue page refreshes itself on its own clock */
    }
  }

  function paint() {
    var it = build();
    /* Nothing waiting: the dock goes away entirely rather than sitting there
       saying zero. A permanent chrome element that is usually empty is a
       thing people learn to stop seeing. */
    it.hidden = known.length === 0;
    if (!known.length) {
      open = false;
      return;
    }
    var count = it.querySelector('#request-dock-count');
    if (count) count.textContent = String(known.length);
    var tab = it.querySelector('#request-dock-tab');
    if (tab) tab.setAttribute('aria-expanded', open ? 'true' : 'false');
    var panel = it.querySelector('#request-dock-panel');
    if (panel) panel.hidden = !open;
    it.setAttribute('data-open', open ? 'yes' : '');
    /* The loudest thing waiting decides the tab's colour: a cancellation
       somebody has to answer should not look like three new orders. */
    var worst = known.some(function (o) {
      var k = kindOf(o);
      return k === 'cancel' || k === 'gone';
    })
      ? 'cancel'
      : known.some(function (o) { return kindOf(o) === 'change'; })
        ? 'change'
        : 'new';
    it.setAttribute('data-worst', worst);
    var list = it.querySelector('#request-dock-list');
    if (list && open) list.innerHTML = known.map(card).join('');
  }

  var asking = false;

  function look() {
    if (asking) return;
    if (!window.PosnicPro || typeof PosnicPro.get !== 'function') return;
    asking = true;
    try {
      PosnicPro.get(
        { url: 'sales/pendingOnlineOrders', data: {} },
        function (response) {
          asking = false;
          /* The endpoint answers with the array itself, the way the queue
             page reads it; anything else is a shop with nothing waiting. */
          var rows = (response && response.data) || [];
          known = Array.isArray(rows) ? rows : [];
          paint();
        },
        function () {
          asking = false;
          /* A shop that cannot be reached is not a shop with nothing waiting;
             the dock keeps what it last knew. */
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
    /* The words age while the panel sits open, so they are redrawn on their
       own slower clock - "3 minutes ago" must not stay "3 minutes ago". */
    setInterval(function () {
      if (open) paint();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) look();
  });

  /*
   * A NOTIFICATION HAS TO LEAD SOMEWHERE.
   *
   * Owner: "i saw some success message kind of notification about customer.
   * whats the use of that? how to respond where to check the request is
   * important."
   *
   * He is right, and it was a fair question: the toast said a thing had
   * happened and then vanished, leaving nowhere to go and nothing to do. A
   * message that cannot be acted on trains people to dismiss messages. So the
   * watcher now opens this, and the toast becomes the way IN to the panel
   * that answers it rather than an announcement on its own.
   */
  function show() {
    open = true;
    look();
    paint();
  }

  window.PosnicRequestDock = {
    show: show,
    look: look,
    paint: paint,
    howLongAgo: howLongAgo,
    kindOf: kindOf,
    card: card,
    saw: function (rows) { known = rows || []; paint(); },
    isOpen: function () { return open; },
    toggle: function (on) { open = !!on; paint(); },
  };
})();
