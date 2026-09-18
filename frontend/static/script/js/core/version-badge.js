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

        copy: function (text, done) {
            /* Same fallback ladder as the boot card: a till on an origin
               without the async clipboard still has to be able to copy. */
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, function () { });
                    return;
                }
            } catch (e) { /* fall through */ }
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
            } catch (e) { /* a shop can still read it off the screen */ }
        },

        /*
         * Fill whichever version lines this page has.
         *
         * Both are optional: the sign-in page carries one, the dashboard
         * carries the other, and a page with neither costs one query and
         * stops.
         */
        paint: function () {
            var host = document.getElementById('posnic_version_line');
            var lite = document.getElementById('posnic_version_login');
            if (!host && !lite) { return; }

            PosnicPro.versionBadge.read(!!host).then(function (v) {
                /*
                 * Nothing knowable means nothing shown.
                 *
                 * A row reading "Posnic ?" is worse than no row: it answers
                 * the support question with a shrug, and a shop would read
                 * it out as though it were the answer.
                 */
                if (!v.app && !v.server && !v.page) { return; }

                var headline = PosnicPro.versionBadge.headline(v);
                var full = PosnicPro.versionBadge.line(v);

                if (lite) {
                    /* textContent, not markup: these are numbers from the
                       machine, and the sign-in page has no session to lose
                       but every reason not to build HTML from strings. */
                    lite.textContent = v.page ? (headline + ' · ' + v.page) : headline;
                    lite.setAttribute('title', full);
                }

                if (host) {
                    var num = host.querySelector('.posnic-version-number');
                    var sub = host.querySelector('.posnic-version-build');
                    if (num) { num.textContent = headline; }
                    if (sub) {
                        var detail = [];
                        if (v.page) { detail.push(v.page); }
                        if (v.server && v.server !== v.app) { detail.push('server ' + v.server); }
                        sub.textContent = detail.join(' · ');
                    }
                    host.setAttribute('title', full);
                    host.style.display = '';

                    host.addEventListener('click', function (e) {
                        /* Inside a dropdown: a click here is about the number,
                           not about navigating or closing the menu. */
                        e.preventDefault();
                        e.stopPropagation();
                        PosnicPro.versionBadge.copy(full, function () {
                            var mark = host.querySelector('.posnic-version-copied');
                            if (!mark) { return; }
                            mark.style.opacity = '1';
                            setTimeout(function () { mark.style.opacity = '0'; }, 1600);
                        });
                    });
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', PosnicPro.versionBadge.paint);
    } else {
        PosnicPro.versionBadge.paint();
    }
}());
