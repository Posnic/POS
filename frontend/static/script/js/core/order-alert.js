/*
 * The sound an online order makes, played where sound can actually be played.
 *
 * Every other way this till learns about a sale has a person standing in front
 * of it: somebody rings it up, somebody hands over a card. An online order is
 * the one that arrives when the shop is not looking - the owner's words were
 * "looking at another page, or watching a movie" - and a badge on a screen
 * nobody is facing is not a notification, it is a record of something that was
 * missed.
 *
 * The main process decides WHEN and synthesises the tone (see src/order-alert.js);
 * this plays it. Electron's main process has no audio device binding, so a
 * renderer is the only part of the app that can make a noise at all.
 *
 * TWO SOUNDS, DELIBERATELY DIFFERENT.
 *
 *   received   accepted already, ticket printing. One short chime.
 *   waiting    held for approval. An alarm, repeated, until the queue is empty.
 *
 * NOT A DIALOG. The owner's standing rule is that nothing blocks the screen: a
 * modal that steals focus mid-sale is worse than the missed order it was meant
 * to prevent. This makes a noise and shows a toast; acting on it is always the
 * person's choice.
 *
 * IN A BROWSER THIS DOES NOTHING. window.electronAPI only exists inside the
 * desktop app, and a shop running the web frontend has no main process to hear
 * from. The queue is still on the screen, which is the part that must never
 * depend on sound.
 */
(function () {
  'use strict';

  var api = window.electronAPI && window.electronAPI.orderAlert;
  if (!api || typeof api.on !== 'function') return;

  /*
   * ONE AUDIO ELEMENT, REUSED.
   *
   * A new Audio() per alert leaves the old ones alive until they are collected,
   * and a busy Saturday would stack a hundred of them. Reusing one also means a
   * second order arriving mid-chime restarts the sound rather than layering it,
   * which is what a person expects.
   */
  var player = null;

  /*
   * Whether this window is allowed to make a noise yet.
   *
   * Browsers - Electron included - refuse to play audio before the page has
   * been interacted with. The first order of the day would be silent on a till
   * that has been sitting on the dashboard since it was switched on. So the
   * first click, key or touch anywhere primes the element with a silent play,
   * after which every later alert is allowed.
   */
  var primed = false;

  function prime() {
    if (primed) return;
    primed = true;
    try {
      if (!player) player = new Audio();
      player.muted = true;
      var attempt = player.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(function () {
          /* Still blocked. The toast below is the part that matters. */
        });
      }
      player.pause();
      player.muted = false;
    } catch (e) {
      /* No audio device, or a policy that refuses even this. Never fatal. */
    }
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (event) {
    document.addEventListener(event, prime, { once: true, passive: true });
  });

  function play(sound) {
    if (!sound) return;
    try {
      if (!player) player = new Audio();
      player.src = sound;
      player.currentTime = 0;
      var attempt = player.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.catch(function () {
          /* Blocked, muted at the speaker, or no device. The order is still on
             the queue, and that is the part that must not be silenceable. */
        });
      }
    } catch (e) {
      /* nothing to do */
    }
  }

  /**
   * What the shop is told, in words, beside the noise.
   *
   * A toast rather than a modal, and it stays until it is dismissed when an
   * order is waiting: a message that fades after four seconds is one that gets
   * missed by exactly the person this feature exists for.
   */
  function announce(payload) {
    var waiting = payload.alert === 'waiting';
    /*
     * The count goes in front of a sentence rather than inside one. Some
     * languages put the number elsewhere, and a placeholder this file would
     * have to substitute is a second thing to keep in step with seventeen
     * translations for the sake of one line.
     */
    var text = waiting
      ? payload.pending > 1
        ? payload.pending + ' ' + PosnicPro.i18n.t('lang_online_orders_awaiting_approval', 'online orders are waiting to be accepted')
        : PosnicPro.i18n.t('lang_online_order_awaiting_approval', 'An online order is waiting to be accepted')
      : PosnicPro.i18n.t('lang_online_order_received', 'A new online order came in, and the kitchen ticket is printing');

    try {
      if ($.toast) {
        $.toast({
          heading: waiting ? PosnicPro.i18n.t('lang_order_waiting', 'Order waiting') : PosnicPro.i18n.t('lang_new_online_order', 'New online order'),
          text: text,
          icon: waiting ? 'warning' : 'info',
          position: 'bottom-right',
          hideAfter: waiting ? false : 6000,
          loader: false,
        });
        return;
      }
    } catch (e) {
      /* The toast plugin is not loaded on this page. */
    }

    /* Last resort, and still not blocking. */
    try {
      console.log('[order] ' + text);
    } catch (e) {
      /* nothing to do */
    }
  }

  api.on(function (payload) {
    payload = payload || {};
    play(payload.sound);
    announce(payload);
  });
})();
