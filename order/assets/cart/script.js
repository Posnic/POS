// ✅ Ensure cart is loaded only once on page load
$(document).ready(async function () {
    /* Refresh the shop when its address is known; a browser with a stale
       row still gets its order drawn from what it has. */
    const branchId = await knownBranchId();
    if (branchId) await fetchAndStoreBranch(branchId, false);
    let cartData = await getCartData();
    renderCart(cartData);
    showDestination();
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
