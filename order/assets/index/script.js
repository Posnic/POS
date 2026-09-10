async function checkBranchFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const branchId = urlParams.get("branch");
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
        console.warn("❌ No branch ID in QR URL.");
    }
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

async function submitBranch() {
    let branchId = document.getElementById("branch-id").value.trim();
    if (!branchId) {
        alert("Please enter a Branch ID.");
        return;
    }

    const existingBranches = await getData("branch");
    if (existingBranches.some(b => b.id === branchId)) {
        window.location.href = "home.html";
        return;
    }

    showLoader();
    await fetchAndStoreBranch(branchId, true); // true = redirect to home
    hideLoader();
}

function toggleSubmitButton() {
    const branchId = document.getElementById("branch-id").value.trim();
    document.querySelector(".submit-btn").disabled = branchId === "";
}

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
