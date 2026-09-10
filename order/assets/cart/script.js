// ✅ Ensure cart is loaded only once on page load
$(document).ready(async function () {
    const branches = await getData(BRANCH_STORE);
    const branchId = branches[0]?.id;
    await fetchAndStoreBranch(branchId, false);
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
        'We will bring it to ' + place.name;

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
