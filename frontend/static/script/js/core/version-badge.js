/*
 * WHICH VERSION IS THIS SHOP RUNNING?
 *
 * Owner, after a customer phoned in a printing fault: "i asked which version
 * using. now way to tell."
 *
 * There was no way to tell, and that is the whole bug. The number existed in
 * three places and none of them was on the screen the shopkeeper was looking
 * at: app.getVersion() in the main process, Help > About behind a menu bar
 * that is hidden until somebody presses Alt, and package.json. A shop on the
 * phone cannot be talked through any of that, so every support call started
 * with an unanswerable question.
 *
 * THREE NUMBERS, NOT ONE, because they can genuinely disagree and the
 * disagreement is the interesting part:
 *
 *   app      the installed desktop shell. What the installer put there.
 *   page     the frontend bundle actually being executed, by content hash.
 *            The asset channel can stage a newer frontend under an older
 *            shell, and an installer can ship an OLDER one - that has
 *            happened, and it looks exactly like a fix that did not work.
 *   server   the API answering this till.
 *
 * Reported one line each, and copied as one line, because the shop is going
 * to read it down a telephone or paste it into a message.
 *
 * NOTHING HERE IS FETCHED FOR ITS OWN SAKE. The page hash is read out of the
 * DOM, the app version comes from a bridge the desktop already answers, and
 * the server version rides the health call that only a signed-in caller is
 * given detail on. A browser at the sign-in screen gets the page hash alone,
 * which is still enough to tell two builds apart.
 */
(function () {
    'use strict';

    if (typeof PosnicPro === 'undefined') { return; }

    var UNKNOWN = '';

    /*
     * The bundle's own content hash, read from the script tag that loaded it.
     *
     * The build fingerprints the page bundle as <name>.<hash>.js, and that
     * hash moves when, and only when, the frontend code changes. It is the one
     * identity available to a browser that has not signed in, and it is the
     * one that answers "is this till running the fix I shipped?".
     *
     * A development tree serves the bundle unhashed, so an empty answer here
     * means "not a built copy" rather than a failure.
     */
    function pageBuild() {
        try {
            var tags = document.getElementsByTagName('script');
            for (var i = tags.length - 1; i >= 0; i--) {
                var src = tags[i].getAttribute('src') || '';
                var m = src.match(/\/?script\/[a-z0-9-]+\.([0-9a-f]{6,})\.js(\?|$)/i);
                if (m) { return m[1]; }
            }
        } catch (e) { /* the other two numbers are still worth showing */ }
        return UNKNOWN;
    }

    /* The installed desktop shell, or nothing at all in a browser. */
    function appVersion() {
        try {
            if (!window.electronAPI || !window.electronAPI.desktop ||
                typeof window.electronAPI.desktop.capabilities !== 'function') {
                return Promise.resolve(UNKNOWN);
            }
            return Promise.resolve(window.electronAPI.desktop.capabilities())
                .then(function (caps) { return (caps && caps.version) || UNKNOWN; })
                .catch(function () { return UNKNOWN; });
        } catch (e) {
            return Promise.resolve(UNKNOWN);
        }
    }

    /*
     * The API's own version, from the health endpoint.
     *
     * Only a signed-in caller is given any detail there, deliberately, so the
     * sign-in screen simply does not have this number. Asked through the same
     * door as every other request, so it carries the session and the branch
     * without this file knowing how either works.
     */
    function serverVersion() {
        return new Promise(function (resolve) {
            try {
                if (!PosnicPro.get) { resolve(UNKNOWN); return; }
                PosnicPro.get('base/health', function (response) {
                    var d = (response && response.data) || {};
                    resolve(d.version || UNKNOWN);
                }, function () { resolve(UNKNOWN); });
            } catch (e) { resolve(UNKNOWN); }
        });
    }

    var pending = null;

    PosnicPro.versionBadge = {

        /*
         * Resolved once per page load. The three answers do not change
         * while the page is open, and the badge is painted from more than
         * one place.
         *
         * `withServer` is false at the sign-in screen, which has no session
         * to ask with. Skipping the call there is not a fallback, it is the
         * point: a request that could only ever come back without the number
         * is one more thing to go wrong on the one page a shop reaches when
         * everything else has.
         */
        read: function (withServer) {
            if (pending) { return pending; }
            var server = withServer ? serverVersion() : Promise.resolve(UNKNOWN);
            pending = Promise.all([appVersion(), server])
                .then(function (parts) {
                    return { app: parts[0], page: pageBuild(), server: parts[1] };
                })
                .catch(function () {
                    return { app: UNKNOWN, page: pageBuild(), server: UNKNOWN };
                });
            return pending;
        },

        /* What the shop reads out, shortest useful form first. */
        headline: function (v) {
            if (v.app) { return 'Posnic ' + v.app; }
            if (v.server) { return 'Posnic ' + v.server; }
            return 'Posnic';
        },

        /* What lands in the clipboard: one line, every number, labelled. */
        line: function (v) {
            var bits = [];
            bits.push('Posnic ' + (v.app || v.server || '?'));
            bits.push(v.app ? 'desktop' : 'browser');
            if (v.page) { bits.push('page ' + v.page); }
            if (v.server) { bits.push('server ' + v.server); }
            return bits.join(' | ');
        },

        copy: function (text, done, fail) {
            function fallback() {
                var ta = document.createElement('textarea');
                var focused = document.activeElement;
                // Keep the fallback inside the modal's focus trap.
                var parent = document.getElementById('posnic_about_dialog') || document.body;
                var copied = false;
                try {
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    parent.appendChild(ta);
                    ta.select();
                    copied = document.execCommand('copy') === true;
                } catch (e) { /* report failure below */ }
                finally {
                    if (ta.parentNode) { ta.parentNode.removeChild(ta); }
                    if (focused && focused.focus) { focused.focus(); }
                }
                if (copied) { done(); } else if (fail) { fail(); }
            }
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, fallback);
                    return;
                }
            } catch (e) { /* try the legacy clipboard */ }
            fallback();
        },

        show: function () {
            window.jQuery('#posnic_about_dialog').modal('show');
        },

        paint: function () {
            var host = document.getElementById('posnic_version_line');
            var lite = document.getElementById('posnic_version_login');
            if (!host && !lite) { return; }

            PosnicPro.versionBadge.read(!!host).then(function (v) {
                if (!v.app && !v.server && !v.page) { return; }
                var headline = PosnicPro.versionBadge.headline(v);
                if (lite) {
                    lite.textContent = v.page ? (headline + ' · ' + v.page) : headline;
                    lite.setAttribute('title', PosnicPro.versionBadge.line(v));
                }
                if (host) {
                    host.textContent = headline;
                    host.hidden = false;
                }
            });

            var dialog = document.getElementById('posnic_about_dialog');
            if (!dialog || !window.jQuery) { return; }
            var copyButton = document.getElementById('posnic_about_copy');
            var status = document.getElementById('posnic_about_copy_status');
            function fill(id, value) { document.getElementById(id).textContent = value; }

            window.jQuery(dialog).off('show.bs.modal.posnicAbout').on('show.bs.modal.posnicAbout', function () {
                status.textContent = '';
                copyButton.disabled = true;
                PosnicPro.versionBadge.read(true).then(function (v) {
                    var unavailable = PosnicPro.i18n.t('lang_about_unavailable', 'Unavailable');
                    fill('posnic_about_version', PosnicPro.versionBadge.headline(v));
                    fill('posnic_about_mode', v.app ? PosnicPro.i18n.t('lang_desktop', 'Desktop') : PosnicPro.i18n.t('lang_browser', 'Browser'));
                    fill('posnic_about_app', v.app);
                    document.getElementById('posnic_about_app_label').hidden = !v.app;
                    document.getElementById('posnic_about_app').hidden = !v.app;
                    fill('posnic_about_server', v.server || unavailable);
                    fill('posnic_about_page', v.page || unavailable);
                    copyButton.disabled = !v.app && !v.server && !v.page;
                    copyButton.onclick = function () {
                        status.textContent = '';
                        PosnicPro.versionBadge.copy(PosnicPro.versionBadge.line(v), function () {
                            status.textContent = PosnicPro.i18n.t('lang_about_details_copied', 'Details copied to clipboard.');
                        }, function () {
                            status.textContent = PosnicPro.i18n.t('lang_about_copy_failed', 'Could not copy. Select the details above to copy them manually.');
                        });
                    };
                });
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', PosnicPro.versionBadge.paint);
    } else {
        PosnicPro.versionBadge.paint();
    }
}());
