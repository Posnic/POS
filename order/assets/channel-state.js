/*
 * What this page is allowed to do, and what it tells the customer it cannot.
 *
 * The shop's server decides. `/items/accessQr` answers with an
 * `online_ordering` block saying whether it is taking orders and, if not, why
 * and when it will again. This file stores that answer and applies it to
 * whatever page the customer is looking at.
 *
 * WHY THE PAGE DOES NOT WORK THIS OUT FOR ITSELF.
 *
 * The obvious implementation compares the current time against the shop's
 * opening hours in the browser. That is wrong twice over: a phone's clock can
 * be wrong or set deliberately, and it would put a second copy of the
 * schedule arithmetic somewhere it can drift from the one the order endpoint
 * uses. So the server sends a verdict, not a schedule, and this file renders
 * it.
 *
 * WHY IT FAILS OPEN.
 *
 * With no stored verdict - a first load, a cleared browser, an older server
 * that does not send the block - the page behaves as though ordering is on.
 * The cost of being wrong that way is one refused checkout with a clear
 * message, because `qrOrder` runs the same check again and is the actual
 * control. The cost of failing the other way is every shop silently becoming a
 * menu the moment anything hiccups, which loses orders nobody ever hears
 * about. Open here, closed on the server.
 *
 * HIDING IS DONE IN CSS, NOT BY WALKING THE DOM.
 *
 * Product cards are injected after this runs, and re-running on every render
 * is how a hidden control comes back. A class on <html> and a stylesheet rule
 * covers markup that does not exist yet.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'posnic_online_channel';
    var BROWSE_CLASS = 'posnic-browse-only';
    var BANNER_ID = 'posnic-channel-banner';

    /* Pages that exist only to place an order. With ordering off they have
       nothing to show, so they hand the customer back to the menu. */
    var ORDERING_PAGES = ['cart.html', 'payment.html', 'home.html'];

    function currentPage() {
        var path = String(window.location.pathname || '');
        var last = path.split('/').pop();
        return last || 'index.html';
    }

    /**
     * Served under /menu rather than /order.
     *
     * The shop's own process serves this bundle at both paths so that a shop
     * which takes orders can still print a browse-only code for a window
     * display or a leaflet. The path can only ever REMOVE the ability to
     * order, never grant it, so nothing here needs to be trusted: the server
     * refuses or accepts on the shop's settings whatever the URL says.
     */
    function pathIsMenuOnly() {
        return /^\/menu(\/|$)/.test(String(window.location.pathname || ''));
    }

    function read() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            /* Private mode, blocked storage, or something that is not JSON.
               No verdict is the same as no restriction. */
            return null;
        }
    }

    function save(state) {
        if (!state || typeof state !== 'object') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: String(state.state || ''),
                mode: String(state.mode || 'order'),
                accepting: state.accepting !== false,
                message: String(state.message || ''),
                opens_at: state.opens_at || null,
                resumes_at: state.resumes_at || null
            }));
        } catch (e) {
            /* Storage full or refused. The page still applies the verdict it
               was handed this time round; it just will not remember it. */
        }
        apply(state);
    }

    function clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            /* nothing to do */
        }
    }

    function accepting() {
        var s = read();
        return !s || s.accepting !== false;
    }

    function message() {
        var s = read();
        return (s && s.message) || '';
    }

    function renderBanner(text) {
        if (!text || !document.body) return;
        var existing = document.getElementById(BANNER_ID);
        if (existing) {
            existing.textContent = text;
            return;
        }
        var bar = document.createElement('div');
        bar.id = BANNER_ID;
        bar.setAttribute('role', 'status');
        bar.textContent = text;
        document.body.insertBefore(bar, document.body.firstChild);
    }

    function removeBanner() {
        var existing = document.getElementById(BANNER_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    /**
     * Apply a verdict to this page.
     *
     * @param {object} [state] the verdict; falls back to the stored one
     */
    function apply(state) {
        var s = state || read();
        var root = document.documentElement;
        var shopIsShut = !!s && s.accepting === false;
        var blocked = shopIsShut || pathIsMenuOnly();

        if (!blocked) {
            root.classList.remove(BROWSE_CLASS);
            removeBanner();
            return;
        }

        root.classList.add(BROWSE_CLASS);

        /*
         * A banner only when the SHOP has something to say.
         *
         * On a /menu code the customer asked for a menu and got one; telling
         * them it is a menu is noise on a window display. If the shop is also
         * shut, that is worth saying wherever they are standing.
         */
        var show = function () {
            if (shopIsShut) {
                renderBanner(s.message || 'This shop is not taking orders right now.');
            } else {
                removeBanner();
            }
        };
        if (document.body) show();
        else document.addEventListener('DOMContentLoaded', show);

        /* Order-only pages hand the customer back to the menu rather than
           showing a cart that cannot be checked out. `replace` so the back
           button does not walk straight into it again. */
        if (ORDERING_PAGES.indexOf(currentPage()) !== -1) {
            window.location.replace('products.html');
        }
    }

    window.KioskChannel = {
        STORAGE_KEY: STORAGE_KEY,
        read: read,
        save: save,
        clear: clear,
        accepting: accepting,
        message: message,
        apply: apply
    };

    /* A stored verdict is applied as early as possible, so a shop that was
       shut on the last visit does not flash a cart before the catalogue
       request comes back. */
    apply();
})();
