/*
 * Where a signup came from, inside our own estate.
 *
 * Owner: "letsay create new account comes from demo.posnic.com send utm source
 * as demo or something else. within our eco system i want to know where its
 * comes from. if user comes desktop app then name that too."
 *
 * Every link out to signup used to be the bare URL, so a person who spent ten
 * minutes in the public demo and then signed up was indistinguishable from
 * someone who typed the address - both landed as "direct". The one channel we
 * fully control was the one we could not measure.
 *
 * WHAT NAMES THE SOURCE
 *
 * runtime-info, which the application already publishes and which already
 * knows the answer:
 *
 *   demo: true      the public demo          -> posnic_demo
 *   mode: desktop   the Electron till        -> posnic_desktop
 *   mode: cloud     a real shop, signed in   -> posnic_app
 *   mode: local     community self-hosted    -> posnic_selfhosted
 *
 * Derived rather than hardcoded per page, because a build flag or a user-agent
 * sniff is a second answer to a question the runtime already answers - and the
 * two drift the first time somebody packages the app differently.
 *
 * The demo also carries WHICH COUNTRY's demo it was, taken from the cookie the
 * demo routing sets. "They came from the UAE demo" is a different fact from
 * "they came from the demo", and it is the one that says whether the localized
 * shops are earning their keep.
 */
(function () {
    'use strict';

    var SIGNUP_URL = 'https://posnic.com/signup.html';

    /* A cookie read that cannot throw: this runs on every page, and a signup
       link that breaks the page is worse than one with no attribution. */
    function cookie(name) {
        try {
            var m = String(document.cookie || '').match(
                new RegExp('(?:^|;\\s*)' + name.replace(/[^\w]/g, '') + '=([^;]*)')
            );
            return m ? decodeURIComponent(m[1]) : '';
        } catch (e) {
            return '';
        }
    }

    /**
     * The signup URL, carrying where it was clicked from.
     *
     * @param {object} info     the runtime-info payload
     * @param {string} surface  where on the page - 'bar', 'nudge', 'menu'
     * @returns {string}
     */
    function signupUrl(info, surface) {
        info = info || {};
        var source;
        if (info.demo) source = 'posnic_demo';
        else if (info.mode === 'desktop') source = 'posnic_desktop';
        else if (info.mode === 'cloud') source = 'posnic_app';
        else source = 'posnic_selfhosted';

        var params = [];
        var add = function (k, v) {
            v = String(v == null ? '' : v).trim();
            if (!v) return;
            /* Short and plain: these end up in a URL a person may read, and
               anything longer is not a source, it is a story. */
            params.push(k + '=' + encodeURIComponent(v.slice(0, 60)));
        };

        add('utm_source', source);
        add('utm_medium', surface || 'link');

        /* The version, so "which build sends us signups" is answerable. Not
           invented when runtime-info does not know it - a wrong version is
           worse than an absent one. */
        add('utm_campaign', info.appVersion || info.version || '');

        if (info.demo) {
            /* Which country's demo. The cookie is set by the demo routing; on
               the shared default there is none, and the absence is honest. */
            var cc = cookie('posnic_demo_cc');
            if (cc) add('utm_content', 'demo_' + cc);
        }

        return SIGNUP_URL + (params.length ? '?' + params.join('&') : '');
    }

    /* Anything marked up as a signup link gets the attribution, so a new one
       added on a page nobody remembers still carries it. */
    function applyTo(root, info) {
        var links = (root || document).querySelectorAll('a[data-posnic-signup]');
        for (var i = 0; i < links.length; i++) {
            links[i].href = signupUrl(info, links[i].getAttribute('data-posnic-signup') || 'link');
        }
    }

    var api = { signupUrl: signupUrl, applyTo: applyTo, SIGNUP_URL: SIGNUP_URL };

    if (typeof window !== 'undefined') {
        window.PosnicSignupLink = api;
        /* Applied once the runtime is known. Failing to reach runtime-info
           leaves the links exactly as authored - unattributed, but working. */
        try {
            var x = new XMLHttpRequest();
            x.open('GET', 'runtime-info', true);
            x.onload = function () {
                try {
                    var info = JSON.parse(x.responseText || '{}');
                    window.PosnicSignupLink.info = info;
                    applyTo(document, info);
                } catch (e) { /* links stay as authored */ }
            };
            x.send();
        } catch (e) { /* links stay as authored */ }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
