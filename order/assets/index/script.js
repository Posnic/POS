/**
 * The store address this page is for.
 *
 * Three places, in the order they should win:
 *
 *   /order/AZ100        the address as a path segment - the canonical form,
 *                       shortest to print and smallest inside a QR code
 *   /order/?branch=AZ1  the older query form, still honoured so anything
 *                       already printed keeps resolving
 *   neither             the shop's default branch, resolved by the server -
 *                       a one-branch shop should not have to print a code to
 *                       say which of its one branch it means
 */
function storeAddressFromUrl() {
    /*
     * The FIRST segment after the mount, not the last.
     *
     *   /order/AZ100                 the shop
     *   /order/AZ100/table/5         its own table five
     *   /order/AZ100/venue/RC/123    Royal Club Hotel, room 123
     *
     * This read the LAST segment once, which is right for exactly the first of
     * those and asks the server for a shop called "123" on the third. Where
     * the customer is sitting is a separate reading, done by
     * assets/service-point.js; it is not part of the shop's address.
     */
    const parts = String(window.location.pathname || '')
        .split('/')
        .filter(Boolean);
    if (parts[0] === 'order' || parts[0] === 'menu') parts.shift();

    const first = parts[0] || '';
    if (/^[A-Za-z0-9]{3,6}$/.test(first) && !/\./.test(first)) return first;

    return new URLSearchParams(window.location.search).get("branch") || null;
}

async function checkBranchFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const branchId = storeAddressFromUrl();
    const note = urlParams.get("notes");
    localStorage.setItem('note', note);

    if (branchId) {
        console.log("🔗 Branch from QR URL:", branchId);
        const existingBranches = await getData("branch");

        if (!existingBranches.some(b => b.id === branchId)) {
            console.log("🧹 New branch detected. Clearing old data...");
            clearOrderAttemptId();
            sessionStorage.removeItem("kiosk_mobile_number");
            sessionStorage.removeItem("kioskReceipt");
            sessionStorage.removeItem("qr_id");
            localStorage.removeItem("kiosk_mobile_number");
            localStorage.removeItem("kioskReceipt");
            localStorage.removeItem("qr_id");
            const db = await getDB();
            const branchStores = [...KioskCore.BRANCH_STORES];
            const tx = db.transaction(branchStores, "readwrite");

            branchStores.forEach(storeName => tx.objectStore(storeName).clear());

            tx.oncomplete = async () => {
                console.log("✅ Old data cleared");
                showLoader();
                await fetchAndStoreBranch(branchId, true); // will redirect to home.html
                hideLoader();
            };

            tx.onerror = (e) => {
                console.error("❌ Failed to clear old data", e);
            };
        } else {
            console.log("✅ Branch already stored, redirecting...");
            showLoader();
            await fetchAndStoreBranch(branchId, false);
            hideLoader();
            window.location.href = "home.html";
        }
    } else {
        /*
         * No address in the URL, so ask the shop which branch it means.
         *
         * This used to log a warning to a console nobody is looking at and
         * leave a spinner turning forever, driven by a text input and a submit
         * button that had been removed from the page some releases earlier.
         */
        await useDefaultStore();
    }
}

/**
 * The shop's default branch, for `/order` with nothing after it.
 *
 * The server decides: it knows whether the shop set one, whether there is only
 * one to pick, or whether there are several and none was named. Only the last
 * case is a question a customer can do anything about, and it gets a sentence
 * rather than a spinner.
 */
async function useDefaultStore() {
    showLoader();
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/online-ordering`, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });
        const result = await response.json();

        const storeId = result?.data?.store?.id;
        if (response.ok && storeId) {
            await fetchAndStoreBranch(storeId, true);
            return;
        }

        showStoreAddressNeeded(result?.message);
    } catch (error) {
        console.error("Could not resolve the shop's default branch:", error);
        showStoreAddressNeeded();
    } finally {
        hideLoader();
    }
}

/** Say what is wrong, on the page, where the person can read it. */
function showStoreAddressNeeded(message) {
    const text = message || "This shop is not taking online orders yet.";
    let box = document.getElementById("store-address-needed");
    if (!box) {
        box = document.createElement("div");
        box.id = "store-address-needed";
        box.setAttribute("role", "alert");
        box.style.cssText =
            "max-width:32rem;margin:15vh auto;padding:24px;text-align:center;" +
            "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
            "font-size:17px;line-height:1.5;color:#1f2937;";
        document.body.appendChild(box);
    }
    box.textContent = text;
}

async function checkBranchStored() {
    showLoader();
    const branches = await getData("branch");

    if (branches.length > 0) {
        console.log("✅ Branch already stored. Redirecting...");
        window.location.href = "home.html";
    } else {
        console.log("🟡 No stored branch. Checking QR...");
        await checkBranchFromURL();
    }
    hideLoader();
}

/*
 * `submitBranch` and `toggleSubmitButton` used to live here: a customer typed
 * a branch code into a box and pressed a button.
 *
 * Both are gone, and neither had worked for some time - index.html has no
 * `#branch-id` input and no `.submit-btn`, so `getElementById(...).value`
 * threw on a null the moment either ran. They were dead code pointing at dead
 * markup, which is the kind of pair that reads as a working feature in a diff.
 *
 * Nobody should be typing a store address anyway. The URL carries it, and
 * where it does not, the shop's default answers.
 */

function showLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "flex";
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
}

// ✅ Auto-run on load
(async () => {
    await loadEnvConfig();
    // Prioritize URL first
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("branch")) {
        await checkBranchFromURL();
    } else {
        await checkBranchStored();
    }
})();
