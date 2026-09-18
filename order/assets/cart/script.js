// ✅ Ensure cart is loaded only once on page load
$(document).ready(async function () {
    /* Refresh the shop when its address is known; a browser with a stale
       row still gets its order drawn from what it has. */
    const branchId = await knownBranchId();
    if (branchId) await fetchAndStoreBranch(branchId, false);
    let cartData = await getCartData();
    renderCart(cartData);
    showDestination();
    paintPromo();
});

/*
 * Where the food is going, confirmed by the person who knows.
 *
 * Only for an order from a hotel room or another partner venue. The shop's own
 * tables need no address, and an empty destination box on every dine-in order
 * is a field people learn to skip - which is how the ones that matter get
 * skipped too.
 *
 * The URL is the DEFAULT, never the answer. A guest photographs the code in
 * room 123 and sends it to a friend in 456; a code gets stuck on the wrong
 * door during a refit. Recording only what the link claimed sends the food to
 * the wrong room, with nothing anywhere showing that the link and the guest
 * disagreed.
 */
/* ----------------------------------------------------------- a discount code
 *
 * The page asks the shop whether a code is real and what it offers. It never
 * works out what the code is WORTH: that is decided once, by the shop, when
 * the order is placed - and an order carrying a code the shop will not honour
 * is refused rather than quietly charged at full price.
 *
 * So the worst this field can do is show somebody the terms of an offer they
 * then get. It cannot show them a total they do not get.
 */

/** The code this basket is carrying, kept where checkout can find it. */
const PROMO_KEY = "posnic.promo-code";

function promoCode() {
    try {
        return String(localStorage.getItem(PROMO_KEY) || "").trim();
    } catch (e) {
        /* A browser that keeps nothing simply orders without a code. */
        return "";
    }
}

function keepPromo(code) {
    try {
        if (code) localStorage.setItem(PROMO_KEY, String(code));
        else localStorage.removeItem(PROMO_KEY);
    } catch (e) {
        /* Nothing to do, and nothing worth stopping an order for. */
    }
}

/** What an offer says, in the customer's language. */
function offerWords(offer, money) {
    const value = Number(offer.value) || 0;
    const off = String(offer.type || "") === "percent"
        ? t("{n}% off", { n: value })
        : t("{amount} off", { amount: money(value) });

    if (Number(offer.min_bill) > 0) {
        return t("{off} on orders over {min}", { off: off, min: money(Number(offer.min_bill)) });
    }
    return off;
}

async function applyPromo() {
    const field = document.getElementById("promo-code");
    const said = document.getElementById("promo-said");
    const button = document.getElementById("promo-apply");
    if (!field || !said) return;

    const code = String(field.value || "").trim().toUpperCase();
    field.value = code;

    if (!code) {
        keepPromo("");
        said.hidden = true;
        return;
    }

    if (button) button.disabled = true;
    said.hidden = false;
    said.className = "promo-said";
    said.textContent = t("Checking...");

    let offer = null;
    try {
        const base = String((window.CONFIG && window.CONFIG.API_BASE_URL) || "").replace(/\/$/, "");
        const shop = await knownBranchId();
        const answer = await fetch(base + "/online-ordering/" + encodeURIComponent(shop) + "/coupon", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ code: code })
        });
        const body = await answer.json();
        offer = body && body.type === "success" ? body.data : null;
    } catch (e) {
        /* Unreachable is not the same as refused, and the customer should be
           told which one happened rather than that their code is bad. */
        if (button) button.disabled = false;
        said.className = "promo-said is-bad";
        said.textContent = t("Could not reach the shop just now.");
        return;
    }

    if (button) button.disabled = false;

    if (!offer) {
        keepPromo("");
        said.className = "promo-said is-bad";
        said.textContent = t("That code cannot be used here.");
        return;
    }

    keepPromo(offer.code || code);
    said.className = "promo-said is-good";
    said.textContent = offerWords(offer, typeof money === "function" ? money : String);
}

$(document).on("click", "#promo-open", function () {
    const box = document.getElementById("promo-box");
    const open = document.getElementById("promo-open");
    if (!box) return;
    box.hidden = false;
    if (open) open.hidden = true;
    const field = document.getElementById("promo-code");
    if (field) field.focus();
});

$(document).on("click", "#promo-apply", applyPromo);

$(document).on("keydown", "#promo-code", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyPromo();
});

/*
 * A code typed on a previous visit is shown again, because a basket that
 * quietly forgets one is a customer who pays full price without noticing.
 */
function paintPromo() {
    const section = document.getElementById("promo");
    if (!section) return;
    section.hidden = false;

    const kept = promoCode();
    if (!kept) return;

    const box = document.getElementById("promo-box");
    const open = document.getElementById("promo-open");
    const field = document.getElementById("promo-code");
    if (box) box.hidden = false;
    if (open) open.hidden = true;
    if (field) field.value = kept;
}

function showDestination() {
    if (!window.KioskServicePoint) return;

    const place = window.KioskServicePoint.describe();
    const box = document.getElementById('destination');
    if (!place || !box) return;

    document.getElementById('destination-title').textContent =
        t('We will bring it to {place}', { place: place.name });

    const unitLabel = document.getElementById('destination-unit-label');
    const unit = document.getElementById('destination-unit');
    unitLabel.textContent = place.unit_label;
    unit.value = place.unit;
    unit.setAttribute('aria-label', place.unit_label);

    const floorField = document.getElementById('destination-floor-field');
    const floor = document.getElementById('destination-floor');
    floorField.hidden = !place.ask_floor;
    floor.value = place.floor;

    if (place.note) {
        const note = document.getElementById('destination-note');
        note.textContent = place.note;
        note.hidden = false;
    }

    box.hidden = false;

    /*
     * Saved as it is typed rather than behind a Confirm button.
     *
     * Checkout is a separate page, and a correction that only counts when
     * somebody presses a button is a correction half of them will lose. There
     * is nothing to submit here: the value is stored the moment it changes,
     * and the order carries whatever is stored.
     */
    const save = function () {
        window.KioskServicePoint.confirm({
            unit: unit.value,
            floor: floor.value,
        });
    };
    unit.addEventListener('input', save);
    floor.addEventListener('input', save);
}


/* ------------------------------------------------------------- the notes
 *
 * A note on one line, and a note for the whole order. Both are kept the
 * moment they change: the order page is a separate page from the one that
 * sends, and a note behind a Confirm button is a note half of people lose.
 */
(function wireNotes() {
    let noteFor = "";
    const el = (id) => document.getElementById(id);

    /*
     * The same picker the dish sheet draws, from the same module.
     *
     * Nothing is written as it is tapped here, unlike on the dish sheet: this
     * sheet has a Save button and a Cancel beside it, and a control that had
     * already committed would make Cancel a lie.
     */
    /*
     * Built once, on the first sheet that needs it, and never again.
     *
     * Lazily because cart.html loads its scripts in the HEAD: at the moment
     * this file is parsed the dialog does not exist yet, and mounting into a
     * null would have failed silently and left a dead picker that took taps
     * and saved nothing. Once, because the sheet is one element reused for
     * every dish - remounting per dish leaks a listener a dish.
     */
    let spicePicker = null;
    function picker() {
        const box = el("note-spice-box");
        if (!spicePicker && box && window.PosnicSpice) {
            spicePicker = window.PosnicSpice.mount(box, null);
        }
        return spicePicker;
    }

    document.addEventListener("click", async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest(".line-note-btn") : null;
        if (!btn) return;
        noteFor = String(btn.getAttribute("data-item-id") || "");
        const sheet = el("note-sheet");
        if (!sheet) return;
        const line = (await getCartData()).find((row) => String(row.id) === noteFor);
        if (el("note-for")) el("note-for").textContent = line ? String(line.name || "") : "";
        if (el("note-text")) el("note-text").value = line && line.note ? line.note : "";
        const spiceBox = el("note-spice-box");
        if (spiceBox) {
            spiceBox.hidden = !(line && line.spice_choice === true);
            const p = picker();
            if (p) p.set(line ? line.spice : 0);
            /* Same reason as the dish sheet: "less spicy" as the first
               example under a spice picker teaches people to type what they
               could tap. */
            const field = el("note-text");
            if (field) {
                field.placeholder = spiceBox.hidden
                    ? t("Less spicy, no onion, extra gravy...")
                    : t("No onion, extra gravy, cut in half...");
            }
        }
        if (typeof sheet.showModal === "function") sheet.showModal();
        else sheet.setAttribute("open", "open");
        if (el("note-text")) el("note-text").focus();
    });

    const close = () => {
        const sheet = el("note-sheet");
        if (!sheet) return;
        if (typeof sheet.close === "function") sheet.close();
        else sheet.removeAttribute("open");
    };

    document.addEventListener("click", async (e) => {
        if (!e.target) return;
        if (e.target.id === "note-save") {
            /* Spice first, note second: both redraw the basket and the note
               is the one whose redraw should be the last word. */
            const p = picker();
            if (p) await setCartItemSpice(noteFor, p.value());
            await setCartItemNote(noteFor, el("note-text") ? el("note-text").value : "");
            close();
        } else if (e.target.id === "note-cancel" || e.target.id === "note-sheet") {
            close();
        }
    });

    document.addEventListener("input", (e) => {
        if (!e.target || e.target.id !== "order-note") return;
        const text = String(e.target.value || "").trim().slice(0, 300);
        if (text) localStorage.setItem("note", text);
        else localStorage.removeItem("note");
    });
})();
