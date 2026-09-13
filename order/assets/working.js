/*
 * SOMETHING IS HAPPENING, AND THE PAGE SAYS SO.
 *
 * Owner: "whenver we communicate or receiving show some progress then we know
 * its network delay. otherwise it shows no sound nothing happening."
 *
 * That is the whole complaint about every slow moment in this bundle. A phone
 * on a restaurant's wifi waits two seconds for the shop and shows nothing at
 * all, so the customer cannot tell a slow network from a dead button - and
 * the thing they do about it is tap again, which on a plus is a second dish.
 *
 * INDIVIDUAL BUTTONS ALREADY SPIN (is-working). This is the other half: the
 * work that belongs to no button - the voice line opening, the menu coming
 * in, the order being read back - and the work whose button has scrolled off
 * the screen.
 *
 * EVERY REQUEST, WITHOUT HAVING TO REMEMBER. It wraps fetch rather than
 * asking each call site to report in, because a call site that forgets is
 * exactly the silent wait he is describing, and there is no way to notice
 * one is missing.
 *
 * AFTER A MOMENT, NOT AT ONCE. A request that answers in 80ms does not need a
 * progress bar; showing one makes the page flicker on every tap. The bar
 * appears only once something has actually taken long enough to look broken,
 * which means its presence carries information: the network is slow. That is
 * precisely what he asked for.
 *
 * IN THE DIALOG WHEN THERE IS ONE. A modal <dialog> renders in the browser's
 * top layer, above every z-index on the page, so a bar parked on <body> is
 * invisible during a voice call - which is the moment it matters most.
 */
(function () {
    "use strict";

    /* Long enough that a quick answer never flickers, short enough that a
       wait never feels unanswered. */
    var SHOW_AFTER = 320;

    var busy = 0;
    var timer = 0;
    var bar = null;
    var label = null;
    var saying = "";

    /*
     * The heartbeat is not something the customer is waiting for.
     *
     * The voice line tells the server it is still open every half minute so
     * the shop can meter it. Nobody is waiting on that, and a bar that
     * appears twice a minute during a call for no reason teaches people to
     * ignore the bar.
     */
    function quiet(url) {
        return /\/voice\/[^/]+\/tick$/.test(String(url || ""));
    }

    /** What to call this wait, in the customer's terms. */
    function words(url, method) {
        var at = String(url || "");
        if (/\/orders$/.test(at) && method === "POST") return "Sending your order";
        if (/\/orders\/[^/]+\/items$/.test(at)) return "Changing your order";
        if (/\/orders\/[^/]+\/cancel$/.test(at)) return "Cancelling your order";
        if (/\/orders\/lookup$/.test(at) || /\/orders\/[^/?]+(\?|$)/.test(at)) return "Checking your order";
        if (/\/voice$/.test(at)) return "Opening the line";
        if (/\/assistant/.test(at)) return "Thinking";
        if (/menu|storefront/.test(at) || /online-ordering\/[A-Za-z0-9]+$/.test(at)) return "Loading the menu";
        return "Talking to the shop";
    }

    function translate(text) {
        try {
            return typeof say === "function" ? say(text) : text; // eslint-disable-line no-undef
        } catch (e) {
            return text;
        }
    }

    function build() {
        if (bar) return bar;
        bar = document.createElement("div");
        bar.className = "working-bar";
        bar.id = "working-bar";
        bar.setAttribute("role", "status");
        bar.setAttribute("aria-live", "polite");
        var track = document.createElement("span");
        track.className = "working-bar-track";
        label = document.createElement("span");
        label.className = "working-bar-text";
        bar.appendChild(track);
        bar.appendChild(label);
        return bar;
    }

    /* Into the open dialog if there is one, because a modal dialog draws
       above everything on the page and a bar under it cannot be seen. */
    function host() {
        var open = document.querySelector("dialog[open]");
        return open || document.body;
    }

    function show() {
        if (!document.body) return;
        var it = build();
        var where = host();
        if (it.parentNode !== where) where.appendChild(it);
        if (label) label.textContent = translate(saying);
        it.hidden = false;
    }

    function hide() {
        if (bar) bar.hidden = true;
    }

    function began(what) {
        saying = what || "Talking to the shop";
        busy += 1;
        if (busy === 1) {
            clearTimeout(timer);
            timer = setTimeout(show, SHOW_AFTER);
        } else if (bar && !bar.hidden && label) {
            /* Already showing and something else started: say the newer one,
               which is the one the customer just asked for. */
            label.textContent = translate(saying);
        }
    }

    function ended() {
        busy = Math.max(0, busy - 1);
        if (busy === 0) {
            clearTimeout(timer);
            hide();
        }
    }

    var real = window.fetch;
    if (typeof real === "function") {
        window.fetch = function (input, init) {
            var url = input && input.url ? input.url : input;
            var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
            if (quiet(url)) return real.apply(this, arguments);
            began(words(url, method));
            var answer;
            try {
                answer = real.apply(this, arguments);
            } catch (e) {
                ended();
                throw e;
            }
            if (!answer || typeof answer.then !== "function") {
                ended();
                return answer;
            }
            return answer.then(
                function (ok) {
                    ended();
                    return ok;
                },
                function (no) {
                    ended();
                    throw no;
                }
            );
        };
    }

    /**
     * For work that is not a fetch - opening a microphone, a WebRTC
     * handshake - which is otherwise the longest silent wait on the page.
     *
     * @param {string} what one of the phrases above, or any short sentence
     * @returns {Function} call it when the work is over
     */
    function around(what) {
        began(what);
        var over = false;
        return function () {
            if (over) return;
            over = true;
            ended();
        };
    }

    window.Working = { around: around, began: began, ended: ended };
})();
