/*
 * The public demo's face (DEMO_SHOP_PLAN §3-4).
 *
 * Reads the demo flag from /runtime-info and, ONLY when it is set:
 *   - a slim permanent bar: this is the public demo, it resets hourly,
 *     and where to get the real thing;
 *   - on the login page, one-tap "Enter as admin / manager / cashier"
 *     buttons - the logins are published, nobody should have to type.
 *   - one signup nudge, three minutes into real use, once per browser
 *     EVER (localStorage) - the owner's brief was "market little bit...
 *     not too much annoy", and a second showing is where annoy starts.
 *
 * Everywhere else this file is a fetch and a no-op. The buttons only FILL
 * the form; the server's own login path does the rest, so nothing here is
 * an authentication mechanism - it is typing, automated.
 */
(function () {
    'use strict';
    try {
        var x = new XMLHttpRequest();
        x.open('GET', 'runtime-info', true);
        x.onload = function () {
            try {
                var info = JSON.parse(x.responseText || '{}');
                if (!info.demo) { return; }

                /*
                 * Where a signup from here came from.
                 *
                 * Without it, somebody who spent ten minutes in the demo and
                 * then signed up was indistinguishable from someone who typed
                 * the address - both arrive as "direct", and the one channel
                 * we fully control is the one we cannot measure.
                 *
                 * Falls back to the bare URL if the helper is not on the page,
                 * because a missing measurement must never cost a signup.
                 */
                var signupHref = function (surface) {
                    try {
                        if (window.PosnicSignupLink) {
                            return window.PosnicSignupLink.signupUrl(info, surface);
                        }
                    } catch (e) { /* fall through */ }
                    return 'https://posnic.com/signup.html';
                };

                var bar = document.createElement('div');
                bar.id = 'posnic_demo_bar';
                bar.setAttribute('style',
                    'position:fixed;left:0;right:0;bottom:0;z-index:2147482000;' +
                    'background:#16203a;color:#fff;font:12.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;' +
                    'padding:7px 14px;text-align:center;');
                bar.innerHTML =
                    'Public demo — everything resets on the hour. ' +
                    '<a href="' + signupHref('demo_bar') + '" style="color:#8ab4ff;font-weight:600;">Create your free shop</a>' +
                    '<span style="opacity:.65;"> · no credit card — and the offline desktop till is free forever</span>';
                document.body.appendChild(bar);
                document.body.style.paddingBottom = '34px';

                var user = document.getElementById('username');
                var pass = document.getElementById('password');
                if (user && pass) {
                    var wrap = document.createElement('div');
                    wrap.setAttribute('style', 'margin:12px 0 0;display:flex;gap:8px;flex-wrap:wrap;');
                    [['admin', 'Enter as admin'], ['manager', 'Enter as manager'], ['cashier', 'Enter as cashier']]
                        .forEach(function (role) {
                            var b = document.createElement('button');
                            b.type = 'button';
                            b.textContent = role[1];
                            b.setAttribute('style',
                                'flex:1 1 0;padding:9px 6px;border:1px solid #cfd6dd;border-radius:6px;' +
                                'background:#f6f8fb;cursor:pointer;font-size:13px;');
                            b.onclick = function () {
                                user.value = role[0];
                                pass.value = role[0];
                                var go = document.getElementById('login_button');
                                if (go) { go.click(); }
                            };
                            wrap.appendChild(b);
                        });
                    var anchor = document.getElementById('login_button');
                    if (anchor && anchor.parentElement) {
                        anchor.parentElement.appendChild(wrap);
                    }
                }

                /* The nudge. Only past the login door (a visitor reading the
                   login page has not used anything yet), only after three
                   minutes of actual use measured across pages, and only once
                   per browser, ever. localStorage failures mean no nudge -
                   never a broken page. */
                if (!user && !pass) {
                    try {
                        if (!localStorage.getItem('posnic_demo_nudge_done')) {
                            var first = parseInt(localStorage.getItem('posnic_demo_first_seen'), 10);
                            if (!first || first > Date.now()) {
                                first = Date.now();
                                localStorage.setItem('posnic_demo_first_seen', String(first));
                            }
                            var waited = Date.now() - first;
                            /* however long they have explored, let the page
                               they just opened breathe before interrupting */
                            var delay = Math.max(180000 - waited, 30000);
                            setTimeout(function () {
                                try {
                                    if (localStorage.getItem('posnic_demo_nudge_done')) { return; }
                                    localStorage.setItem('posnic_demo_nudge_done', '1');
                                    var veil = document.createElement('div');
                                    veil.id = 'posnic_demo_nudge';
                                    veil.setAttribute('style',
                                        'position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,25,.55);' +
                                        'display:flex;align-items:center;justify-content:center;padding:20px;');
                                    var card = document.createElement('div');
                                    card.setAttribute('style',
                                        'background:#fff;color:#16203a;max-width:420px;width:100%;border-radius:10px;' +
                                        'padding:26px 24px 20px;font:14px/1.55 system-ui,Segoe UI,Arial,sans-serif;' +
                                        'box-shadow:0 18px 50px rgba(0,0,0,.35);text-align:center;');
                                    card.innerHTML =
                                        '<div style="font-size:19px;font-weight:700;margin-bottom:8px;">Making this shop yours?</div>' +
                                        '<div style="margin-bottom:18px;">Create your own free shop in a minute. No credit card, no commitment — ' +
                                        'if you never renew, you simply continue on the free Community Edition.</div>' +
                                        '<a href="' + signupHref('demo_nudge') + '" target="_blank" rel="noopener" style="display:block;' +
                                        'background:#16203a;color:#fff;text-decoration:none;font-weight:600;padding:11px;border-radius:7px;margin-bottom:10px;">' +
                                        'Create my free shop</a>' +
                                        '<button type="button" id="posnic_demo_nudge_close" style="background:none;border:none;color:#5a6478;' +
                                        'cursor:pointer;font-size:13px;padding:6px;">Keep exploring</button>';
                                    veil.appendChild(card);
                                    var close = function () {
                                        if (veil.parentElement) { veil.parentElement.removeChild(veil); }
                                        document.removeEventListener('keydown', onKey);
                                    };
                                    var onKey = function (ev) { if (ev.key === 'Escape') { close(); } };
                                    veil.onclick = function (ev) { if (ev.target === veil) { close(); } };
                                    document.addEventListener('keydown', onKey);
                                    document.body.appendChild(veil);
                                    card.querySelector('#posnic_demo_nudge_close').onclick = close;
                                } catch (e) { /* no nudge over a broken page, ever */ }
                            }, delay);
                        }
                    } catch (e) { /* localStorage unavailable - skip the nudge */ }
                }
            } catch (e) { /* the demo face must never break a real till */ }
        };
        x.send();
    } catch (e) { /* same rule */ }
})();
