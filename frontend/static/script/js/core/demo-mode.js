/*
 * The public demo's face (DEMO_SHOP_PLAN §3-4).
 *
 * Reads the demo flag from /runtime-info and, ONLY when it is set:
 *   - a slim permanent bar: this is the public demo, it resets hourly,
 *     and where to get the real thing;
 *   - on the login page, one-tap "Enter as admin / manager / cashier"
 *     buttons - the logins are published, nobody should have to type.
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

                var bar = document.createElement('div');
                bar.id = 'posnic_demo_bar';
                bar.setAttribute('style',
                    'position:fixed;left:0;right:0;bottom:0;z-index:2147482000;' +
                    'background:#16203a;color:#fff;font:12.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;' +
                    'padding:7px 14px;text-align:center;');
                bar.innerHTML =
                    'Public demo — everything resets on the hour. ' +
                    '<a href="https://posnic.com/signup.html" style="color:#8ab4ff;font-weight:600;">Create your free shop</a>' +
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
            } catch (e) { /* the demo face must never break a real till */ }
        };
        x.send();
    } catch (e) { /* same rule */ }
})();
