/*
 * How hot would you like it?
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy."
 *
 * ONE CONTROL, TWO PLACES. The dish sheet is where somebody chooses, and the
 * basket is where they change their mind; both draw this. Written as a module
 * rather than twice, because the day the two copies disagree is the day a
 * customer picks mild in one place and the kitchen reads medium from the
 * other.
 *
 * NOT CHOOSING IS AN ANSWER, and it is the one most people give. There is no
 * fourth button for "however you make it" - a default that has to be selected
 * turns a tap into a question. Once a level IS set, a plain link takes it
 * back off, because the only way to undo a radio is to offer the undo.
 *
 * THE CHILLIES ARE FOR THE PHONE ONLY. The kitchen ticket says the word and
 * the count in ASCII - see api/src/utils/spice-level.js - because the thermal
 * path puts every character through latin1 and would print an emoji as a
 * question mark.
 */
(function (root) {
    "use strict";

    var LEVELS = [1, 2, 3];
    /* English, and translated through the ordering dictionary like every
       other word on these pages. */
    var WORDS = { 1: "Mild", 2: "Medium", 3: "Spicy" };
    var CHILLI = "\uD83C\uDF36\uFE0F";

    /** A level somebody chose, or 0. Anything unrecognised is 0, never a guess. */
    function levelOf(value) {
        /* A number or the text of one, never a boolean: Number(true) is 1 and
           a stray true would read as one chilli. */
        if (typeof value !== "number" && typeof value !== "string") return 0;
        var n = Number(value);
        return LEVELS.indexOf(n) !== -1 ? n : 0;
    }

    function say(text) {
        return typeof root.t === "function" ? root.t(text) : text;
    }

    function esc(text) {
        return typeof root.escapeHtml === "function"
            ? root.escapeHtml(String(text))
            : String(text).replace(/[&<>"']/g, function (c) {
                  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
              });
    }

    /** One chilli per level, drawn. */
    function chillies(level) {
        var out = "";
        for (var i = 0; i < levelOf(level); i += 1) out += CHILLI;
        return out;
    }

    /** The word for a level, in the customer's language. '' when none. */
    function wordFor(level) {
        var n = levelOf(level);
        return n ? say(WORDS[n]) : "";
    }

    /**
     * A read-only badge for a line that already carries a level.
     *
     * Returns '' when nobody chose, so a caller can drop it into a template
     * without asking first.
     */
    function chip(level) {
        var n = levelOf(level);
        if (!n) return "";
        return (
            '<div class="item-spice"><span aria-hidden="true">' +
            chillies(n) +
            "</span> " +
            esc(wordFor(n)) +
            "</div>"
        );
    }

    /**
     * Draw the picker into a box and keep its state.
     *
     * @param {Element} box      the container, emptied and filled
     * @param {function} onPick  called with the new level whenever it changes
     * @returns {{set: function, value: function}}
     */
    function mount(box, onPick) {
        if (!box) return { set: function () {}, value: function () { return 0; } };
        var chosen = 0;

        var html =
            '<span class="field-label" id="' + box.id + '-label">' +
            esc(say("How hot would you like it?")) +
            "</span>" +
            '<div class="spice-picker" role="radiogroup" aria-labelledby="' + box.id + '-label">';
        LEVELS.forEach(function (n) {
            html +=
                '<button type="button" class="spice-step" role="radio" aria-checked="false"' +
                ' data-spice="' + n + '">' +
                '<span class="spice-chillies" aria-hidden="true">' + chillies(n) + "</span>" +
                '<span class="spice-word">' + esc(say(WORDS[n])) + "</span>" +
                "</button>";
        });
        html +=
            "</div>" +
            '<button type="button" class="spice-clear" hidden>' +
            esc(say("However the kitchen makes it")) +
            "</button>";
        box.innerHTML = html;

        var steps = box.querySelectorAll(".spice-step");
        var clear = box.querySelector(".spice-clear");

        function paint() {
            Array.prototype.forEach.call(steps, function (step) {
                var on = Number(step.getAttribute("data-spice")) === chosen;
                step.classList.toggle("on", on);
                step.setAttribute("aria-checked", on ? "true" : "false");
            });
            if (clear) clear.hidden = chosen === 0;
        }

        function pick(next) {
            chosen = levelOf(next);
            paint();
            if (typeof onPick === "function") onPick(chosen);
        }

        Array.prototype.forEach.call(steps, function (step) {
            step.addEventListener("click", function () {
                pick(step.getAttribute("data-spice"));
            });
        });
        if (clear) clear.addEventListener("click", function () { pick(0); });

        paint();
        return {
            /* Silent: putting a stored level back on screen is not a choice
               anybody just made, and telling the caller about it would save
               the value it was handed straight back. */
            set: function (level) { chosen = levelOf(level); paint(); },
            value: function () { return chosen; },
        };
    }

    root.PosnicSpice = {
        LEVELS: LEVELS,
        WORDS: WORDS,
        levelOf: levelOf,
        chillies: chillies,
        wordFor: wordFor,
        chip: chip,
        mount: mount,
    };
})(typeof window !== "undefined" ? window : globalThis);
