/*
 * The shop's own Google Analytics, injected only when the shop turned it on.
 *
 * Owner's design: "make it as feature. on / off with entering GA value."
 * The id comes from /runtime-info (per shop process, pre-auth by design, and
 * a measurement id is not a secret - it sits in the page source of every
 * GA-carrying site on the web). Nothing here runs for an unconfigured shop:
 * no request to Google ever leaves the page, and the server's CSP would
 * refuse it anyway - the header only admits the Google domains while the
 * feature is on. That pairing is what keeps PRIVACY.md's "no analytics
 * unless YOU switch it on" true by construction on both ends.
 */
(function () {
    'use strict';
    try {
        var x = new XMLHttpRequest();
        x.open('GET', 'runtime-info', true);
        x.onload = function () {
            try {
                var info = JSON.parse(x.responseText || '{}');
                var a = info.analytics || {};
                if (!a.enabled || !/^G-[A-Z0-9]{4,14}$/.test(String(a.id || ''))) { return; }
                window.dataLayer = window.dataLayer || [];
                window.gtag = function () { window.dataLayer.push(arguments); };
                window.gtag('js', new Date());
                window.gtag('config', a.id);
                var s = document.createElement('script');
                s.async = true;
                s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(a.id);
                document.head.appendChild(s);
            } catch (e) { /* analytics must never break a till */ }
        };
        x.send();
    } catch (e) { /* same rule */ }
})();
