/*
 * One offer of the desktop app, mid-session, in a browser.
 *
 * Owner: "in order promote the desktop app inbetween web session show pop that
 * Desktop app is better way to control hardwares and faster and works when
 * internet down." Then, on the three designs: "all 3 good. radomly show that."
 *
 * So one of three posters is chosen at random per browser. That is not
 * decoration: it is the only way to find out which argument actually moves a
 * shopkeeper, and the choice is recorded so the answer is readable later.
 *
 * WHERE IT MUST NOT APPEAR, and why each of these is deliberate:
 *
 *   inside the desktop app   they already have it. The one audience guaranteed
 *                            to be insulted by the offer.
 *   on the public demo       the owner's standing rule for demo.posnic.io is no
 *                            blocking notifications. A visitor evaluating the
 *                            product must never meet a veil.
 *   on a self-hosted server  mode 'local' is a shop running its own server, and
 *                            the other browsers on that LAN are clients of it.
 *                            The desktop app is a whole standalone till with its
 *                            own database, not a client. Telling a LAN cashier
 *                            to install it is how two shops' data ends up in one
 *                            place, which is a bug we have had once already and
 *                            are not inviting back. Cloud only.
 *   while a sale is open     a popup over a customer being billed is worse than
 *                            no popup at all. Busy defers, it does not cancel.
 *
 * Shown once per browser, ever. Marked done the moment it renders rather than
 * when it is closed, so navigating away mid-poster does not earn a second one.
 */
(function () {
    'use strict';

    var DOWNLOAD_URL = 'https://web.posnic.com/download.html';

    var DONE = 'posnic_desktop_nudge_done';
    var SHOWN = 'posnic_desktop_nudge_variant';
    var FIRST_SEEN = 'posnic_desktop_first_seen';
    /* Set when the card under the login form was dismissed. Somebody who has
       already said no to this once should not be asked again in a veil. */
    var LOGIN_CARD_DISMISSED = 'posnic_web_ok';

    var USE_BEFORE_ASKING = 240000;  /* four minutes of real use, across pages */
    var SETTLE = 45000;              /* let the page just opened breathe first */
    var RETRY = 30000;               /* they were mid-sale; come back quietly */

    /*
     * localStorage does not merely return null when it is unavailable, it
     * THROWS: a private window, or a browser set to block site data, raises on
     * get and on set alike. Unguarded, either one takes down its caller.
     */
    function get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function set(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* asked again another day */ }
    }

    /**
     * Is the person in the middle of something a veil would ruin?
     * Anything true here defers the poster rather than dropping it.
     */
    function busy() {
        /* A sale or a return being built. The empty cart carries a placeholder
           row, which is the one row that does not count. */
        var rows = document.querySelectorAll(
            '#sales_new_items_table tbody tr, #sales_return_items_table tbody tr');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id !== 'sales_new_tablerow_content_area') { return true; }
        }
        if (document.getElementById('posnic-lock')) { return true; }
        if (document.querySelector('.modal.show, .modal.in, .swal2-container')) { return true; }
        var el = document.activeElement;
        if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { return true; }
        return false;
    }

    /* ------------------------------------------------------------------ *
     * The three posters. Fixed colours rather than theme tokens: this is
     * artwork, and it should read the same on every shop's theme.
     * ------------------------------------------------------------------ */

    function actions(tone) {
        var primary = tone === 'light'
            ? 'background:#4C63D2;color:#fff;'
            : 'background:#fff;color:#1B2352;';
        var quiet = tone === 'light' ? 'color:#8B93A8;' : 'color:#AEB6DC;';
        return '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px;">'
            + '<a href="' + DOWNLOAD_URL + '" target="_blank" rel="noopener" id="posnic_dn_get" '
            + 'style="' + primary + 'text-decoration:none;font-weight:700;font-size:13.5px;'
            + 'padding:10px 18px;border-radius:8px;">Download free</a>'
            + '<button type="button" id="posnic_dn_later" style="background:none;border:none;cursor:pointer;'
            + 'font:inherit;font-size:13px;' + quiet + 'padding:6px 2px;">Keep working</button></div>';
    }

    var POSTERS = {
        /* Leads with the one thing a browser genuinely cannot do. */
        counter: function () {
            return '<div style="position:relative;overflow:hidden;'
                + 'background:linear-gradient(150deg,#202A63 0%,#161C3A 62%,#10142B 100%);color:#fff;">'
                + '<svg viewBox="0 0 300 300" aria-hidden="true" style="position:absolute;right:-16px;bottom:0;'
                + 'height:100%;width:46%;">'
                + '<rect x="86" y="52" width="150" height="98" rx="7" fill="#2B3574"/>'
                + '<rect x="94" y="60" width="134" height="82" rx="4" fill="#EEF1FF"/>'
                + '<rect x="94" y="60" width="30" height="82" fill="#4C63D2"/>'
                + '<rect x="132" y="70" width="60" height="7" rx="3.5" fill="#4C63D2"/>'
                + '<rect x="132" y="86" width="86" height="5" rx="2.5" fill="#C9D2F5"/>'
                + '<rect x="132" y="98" width="70" height="5" rx="2.5" fill="#C9D2F5"/>'
                + '<rect x="132" y="118" width="44" height="14" rx="4" fill="#34D399"/>'
                + '<rect x="150" y="150" width="22" height="16" fill="#232C63"/>'
                + '<rect x="126" y="166" width="70" height="7" rx="3.5" fill="#2B3574"/>'
                + '<rect x="196" y="186" width="76" height="52" rx="7" fill="#3B4796"/>'
                + '<rect x="206" y="176" width="56" height="22" rx="3" fill="#EEF1FF"/>'
                + '<rect x="212" y="182" width="44" height="3" rx="1.5" fill="#B9C2EA"/>'
                + '<rect x="212" y="189" width="32" height="3" rx="1.5" fill="#B9C2EA"/>'
                + '<rect x="206" y="212" width="56" height="6" rx="3" fill="#243070"/>'
                + '<rect x="40" y="200" width="104" height="46" rx="6" fill="#3B4796"/>'
                + '<rect x="40" y="200" width="104" height="9" rx="4" fill="#4C63D2"/>'
                + '<circle cx="92" cy="228" r="7" fill="#243070"/>'
                + '<rect x="42" y="150" width="46" height="30" rx="6" fill="#FFB454"/>'
                + '<rect x="50" y="158" width="30" height="4" rx="2" fill="#8A5A10"/>'
                + '<rect x="50" y="166" width="22" height="4" rx="2" fill="#8A5A10"/></svg>'
                + '<div style="position:relative;z-index:2;padding:32px 28px;width:62%;min-width:250px;">'
                + '<div style="font-size:27px;font-weight:800;line-height:1.1;letter-spacing:-.02em;">'
                + 'Your till, with the <span style="color:#FFB454;">hardware</span> attached.</div>'
                + '<div style="font-size:14px;line-height:1.5;color:#B9C0E4;margin-top:12px;">'
                + 'Receipt printer, barcode scanner, cash drawer and weighing scale. '
                + 'A browser cannot reach any of them.</div>'
                + actions('dark') + '</div></div>';
        },

        /* One claim, loudly. The strongest line we have for Indian retail. */
        offline: function () {
            return '<div style="position:relative;overflow:hidden;background:#161C3A;color:#fff;'
                + 'text-align:center;padding:38px 30px 32px;">'
                + '<div style="position:absolute;inset:0;background:radial-gradient(46% 60% at 50% 6%,'
                + 'rgba(255,180,84,.20),transparent 70%);"></div>'
                + '<div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;">'
                + '<svg width="66" height="52" viewBox="0 0 66 52" aria-hidden="true">'
                + '<path d="M6 17c15-12 39-12 54 0" stroke="#3A4382" stroke-width="5" fill="none" stroke-linecap="round"/>'
                + '<path d="M16 27c9-7 25-7 34 0" stroke="#3A4382" stroke-width="5" fill="none" stroke-linecap="round"/>'
                + '<circle cx="33" cy="40" r="5" fill="#3A4382"/>'
                + '<path d="M8 6l50 40" stroke="#FFB454" stroke-width="5" stroke-linecap="round"/></svg>'
                + '<div style="font-size:34px;font-weight:800;line-height:1.05;letter-spacing:-.025em;margin-top:16px;">'
                + 'Still selling<br>at <span style="color:#FFB454;">4pm</span>.</div>'
                + '<div style="font-size:14px;line-height:1.5;color:#AEB6DC;margin-top:12px;max-width:38ch;">'
                + 'The internet went at two. The desktop app keeps taking money, '
                + 'and syncs everything back when the line returns.</div>'
                + actions('dark') + '</div></div>';
        },

        /* The one that survives being skimmed by somebody mid-shift. */
        reasons: function () {
            var cell = function (icon, title, detail) {
                return '<div style="background:#F3F5FC;border-radius:10px;padding:15px 13px;">'
                    + icon
                    + '<div style="font-weight:700;font-size:14px;margin-top:9px;">' + title + '</div>'
                    + '<div style="font-size:12px;line-height:1.45;color:#6B7390;margin-top:4px;">'
                    + detail + '</div></div>';
            };
            return '<div style="background:#fff;color:#141A2E;padding:28px 26px 26px;">'
                + '<div style="font-size:22px;font-weight:800;letter-spacing:-.018em;line-height:1.2;">'
                + 'Posnic runs better on the shop computer</div>'
                + '<div style="font-size:13.5px;color:#6B7390;margin-top:5px;">'
                + 'Free, no trial clock. Same shop, same data, same login.</div>'
                + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px;">'
                + cell('<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">'
                    + '<rect x="4" y="9" width="16" height="9" rx="2" fill="#4C63D2"/>'
                    + '<rect x="7" y="3.5" width="10" height="5" rx="1" fill="#A9B6EE"/>'
                    + '<rect x="7" y="15" width="10" height="6" rx="1" fill="#2A3690"/></svg>',
                    'Hardware', 'Printer, scanner, drawer, weighing scale.')
                + cell('<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">'
                    + '<path d="M3 8.5c5-4.5 13-4.5 18 0" stroke="#4C63D2" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
                    + '<circle cx="12" cy="17" r="2.4" fill="#4C63D2"/>'
                    + '<path d="M4 3l16 17" stroke="#FFB454" stroke-width="2.4" stroke-linecap="round"/></svg>',
                    'No internet', 'Keeps selling, syncs when it returns.')
                + cell('<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">'
                    + '<path d="M13 2L5 13h5l-1 9 9-12h-5l1-8z" fill="#4C63D2"/></svg>',
                    'Faster', 'The data is on the machine, not a round trip away.')
                + '</div>' + actions('light') + '</div>';
        }
    };

    var NAMES = ['counter', 'offline', 'reasons'];

    /**
     * Build and show one poster, then never again on this browser.
     * @param {string} variant  a key of POSTERS
     */
    function show(variant) {
        var veil = document.createElement('div');
        veil.id = 'posnic_desktop_nudge';
        veil.setAttribute('role', 'dialog');
        veil.setAttribute('aria-modal', 'true');
        veil.setAttribute('aria-label', 'The Posnic desktop app');
        veil.setAttribute('style',
            'position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,25,.55);'
            + 'display:flex;align-items:center;justify-content:center;padding:20px;');

        var card = document.createElement('div');
        card.setAttribute('style',
            'position:relative;max-width:560px;width:100%;border-radius:14px;overflow:hidden;'
            + 'font:14px/1.55 system-ui,Segoe UI,Arial,sans-serif;'
            + 'box-shadow:0 22px 60px rgba(0,0,0,.4);');
        card.innerHTML = POSTERS[variant]()
            + '<button type="button" id="posnic_dn_x" aria-label="Close" data-t-aria-label="lang_close_title" style="position:absolute;'
            + 'top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:22px;line-height:1;'
            + 'color:' + (variant === 'reasons' ? '#B4BACB' : 'rgba(255,255,255,.6)') + ';padding:4px 6px;">'
            + '×</button>';
        veil.appendChild(card);

        var previous = document.activeElement;
        var close = function () {
            /* Close FIRST. Storage is the nice-to-have; going away is what the
               click asked for, and setItem throws where site data is blocked. */
            if (veil.parentElement) { veil.parentElement.removeChild(veil); }
            document.removeEventListener('keydown', onKey);
            try { if (previous && previous.focus) { previous.focus(); } } catch (e) { /* gone */ }
            set(DONE, '1');
        };
        var onKey = function (ev) { if (ev.key === 'Escape') { close(); } };
        veil.onclick = function (ev) { if (ev.target === veil) { close(); } };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(veil);
        card.querySelector('#posnic_dn_x').onclick = close;
        card.querySelector('#posnic_dn_later').onclick = close;
        /* The download opens in its own tab; the veil has done its job either
           way, so it goes rather than waiting behind the new tab. */
        card.querySelector('#posnic_dn_get').onclick = function () { close(); };

        var x = card.querySelector('#posnic_dn_x');
        try { if (x) { x.focus(); } } catch (e) { /* focus is a courtesy */ }

        /* Done at render, not at close: navigating away mid-poster must not
           earn a second showing. And record WHICH one, because "all three are
           good" is only answerable afterwards if we know what each shop saw. */
        set(DONE, '1');
        set(SHOWN, variant);
        try {
            if (window.gtag) {
                window.gtag('event', 'desktop_nudge_shown', { variant: variant });
            }
        } catch (e) { /* measurement never breaks a till */ }
    }

    /** Wait for a quiet moment, then show. Busy defers; it never cancels. */
    function whenFree(variant) {
        if (get(DONE)) { return; }
        if (busy()) { setTimeout(function () { whenFree(variant); }, RETRY); return; }
        show(variant);
    }

    try {
        /* Already on the desktop app. */
        if (navigator.userAgent.indexOf('Electron') !== -1) { return; }
        if (get(DONE) || get(LOGIN_CARD_DISMISSED)) { return; }

        var req = new XMLHttpRequest();
        req.open('GET', 'runtime-info', true);
        req.onload = function () {
            try {
                var info = JSON.parse(req.responseText || '{}');
                if (info.demo) { return; }
                if (info.mode !== 'cloud') { return; }

                var first = parseInt(get(FIRST_SEEN), 10);
                if (!first || first > Date.now()) {
                    first = Date.now();
                    set(FIRST_SEEN, String(first));
                }
                var waited = Date.now() - first;
                var delay = Math.max(USE_BEFORE_ASKING - waited, SETTLE);

                var variant = NAMES[Math.floor(Math.random() * NAMES.length)];
                setTimeout(function () { whenFree(variant); }, delay);
            } catch (e) { /* no poster over a broken page, ever */ }
        };
        req.send();
    } catch (e) { /* the offer must never cost anybody a sale */ }
})();
