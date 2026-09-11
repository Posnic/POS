const DB_NAME = "KioskDB";
const DB_VERSION = 3;
const STORE_NAME = "products";
const BRANCH_STORE = "branch";
const CART_STORE = "cart";
const PHONEPE_STORE = "phonepe";
const IMAGE_STORE = "images";
const PAYMENT_STORE = "payment";
const ORDER_ATTEMPT_KEY = "kiosk_order_attempt_id";

let db;
let cart = {}; // ✅ Cart stored in IndexedDB
let products = Object.create(null);
const checkoutSingleFlight = KioskCore.createSingleFlight();

function getOrCreateOrderAttemptId() {
    let attemptId = sessionStorage.getItem(ORDER_ATTEMPT_KEY);
    if (attemptId) return attemptId;

    attemptId = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(ORDER_ATTEMPT_KEY, attemptId);
    return attemptId;
}

function clearOrderAttemptId() {
    sessionStorage.removeItem(ORDER_ATTEMPT_KEY);
}

async function readJsonResponse(response, requestName = "API request") {
    const responseText = await response.text();
    let responseData = null;

    if (responseText) {
        try {
            responseData = JSON.parse(responseText);
        } catch (error) {
            const contentType = response.headers.get("content-type") || "unknown content type";
            const responsePreview = responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
            const previewSuffix = responsePreview ? `: ${responsePreview}` : "";
            throw new Error(`${requestName} returned invalid JSON (${response.status}, ${contentType})${previewSuffix}`);
        }
    }

    if (!response.ok) {
        const serverMessage = responseData?.message || responseData?.error || response.statusText || "Request failed";
        throw new Error(`${requestName} failed (${response.status}): ${String(serverMessage).slice(0, 200)}`);
    }

    return responseData ?? {};
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[character]);
}

function getSafeImageUrl(value, fallback = "images/default-product.png") {
    const imageUrl = String(value ?? "").trim();
    if (!imageUrl) return fallback;

    try {
        const parsedUrl = new URL(imageUrl, window.location.href);
        if (["http:", "https:", "blob:"].includes(parsedUrl.protocol)) return imageUrl;
        if (parsedUrl.protocol === "data:" && /^data:image\//i.test(imageUrl)) return imageUrl;
    } catch (error) {
        console.warn("Invalid product image URL:", imageUrl, error);
    }

    return fallback;
}

let appErrorRetryAction = null;
let appErrorKind = null;
let orderProcessingActive = false;

function ensureAppStateStyles() {
    if (document.getElementById("app-state-styles")) return;
    const style = document.createElement("style");
    style.id = "app-state-styles";
    style.textContent = `
        .app-state-overlay { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(255,255,255,.96); font-family: Arial,sans-serif; text-align: center; }
        .app-state-card { width: min(460px, 100%); padding: 32px; border-radius: 20px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.18); }
        .app-state-icon { font-size: 52px; margin-bottom: 12px; }
        .app-state-title { margin: 0 0 12px; color: #2b160d; font-size: 28px; }
        .app-state-message { margin: 0; color: #555; font-size: 17px; line-height: 1.5; white-space: pre-line; }
        .app-state-button { margin-top: 24px; width: 100%; padding: 14px 18px; border: 0; border-radius: 10px; background: linear-gradient(90deg,#ff7e5f,#feb47b); color: #fff; font-size: 18px; font-weight: 700; cursor: pointer; }
        .app-state-button:disabled { opacity: .55; cursor: wait; }
        .app-state-spinner { width: 54px; height: 54px; margin: 0 auto 20px; border: 6px solid #f1e4de; border-top-color: #ff7e5f; border-radius: 50%; animation: app-state-spin 1s linear infinite; }
        @keyframes app-state-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
}

function ensureAppErrorOverlay() {
    let overlay = document.getElementById("app-error-overlay");
    if (overlay) return overlay;

    ensureAppStateStyles();
    overlay = document.createElement("div");
    overlay.id = "app-error-overlay";
    overlay.className = "app-state-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
        <div class="app-state-card" role="alert">
            <div class="app-state-icon" aria-hidden="true">⚠️</div>
            <h1 class="app-state-title"></h1>
            <p class="app-state-message"></p>
            <button type="button" class="app-state-button">Retry</button>
        </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector("button").addEventListener("click", async event => {
        const button = event.currentTarget;
        const message = overlay.querySelector(".app-state-message");
        if (!appErrorRetryAction) return;

        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = "Retrying...";
        try {
            await appErrorRetryAction();
        } catch (error) {
            message.textContent = error.message || "Retry failed. Check the connection and try again.";
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
    return overlay;
}

function showAppErrorScreen(title, message, retryAction, options = {}) {
    const overlay = ensureAppErrorOverlay();
    appErrorRetryAction = retryAction;
    appErrorKind = options.kind || "error";
    overlay.querySelector(".app-state-icon").textContent = options.icon || "⚠️";
    overlay.querySelector(".app-state-title").textContent = title;
    overlay.querySelector(".app-state-message").textContent = message;
    const button = overlay.querySelector("button");
    button.textContent = options.buttonLabel || "Retry";
    button.style.display = retryAction ? "block" : "none";
    overlay.style.display = "flex";
}

function hideAppErrorScreen() {
    const overlay = document.getElementById("app-error-overlay");
    if (overlay) overlay.style.display = "none";
    appErrorRetryAction = null;
    appErrorKind = null;
}

function showOrderProcessingScreen(message = "Your order is being submitted. Please do not close this page.") {
    orderProcessingActive = true;
    ensureAppStateStyles();
    let overlay = document.getElementById("order-processing-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "order-processing-overlay";
        overlay.className = "app-state-overlay";
        overlay.innerHTML = `
            <div class="app-state-card" role="status" aria-live="polite">
                <div class="app-state-spinner"></div>
                <h1 class="app-state-title">Order processing</h1>
                <p class="app-state-message"></p>
            </div>`;
        document.body.appendChild(overlay);
    }
    overlay.querySelector(".app-state-message").textContent = message;
    overlay.style.display = "flex";
}

function hideOrderProcessingScreen() {
    orderProcessingActive = false;
    const overlay = document.getElementById("order-processing-overlay");
    if (overlay) overlay.style.display = "none";
}

function showOfflineScreen() {
    showAppErrorScreen(
        "You are offline",
        "Check the internet connection, then tap Retry.",
        async () => {
            if (!navigator.onLine) throw new Error("Internet connection is still unavailable.");
            window.location.reload();
        },
        { kind: "offline", icon: "📡", buttonLabel: "Retry" }
    );
}

window.addEventListener("offline", showOfflineScreen);
window.addEventListener("beforeunload", event => {
    if (!orderProcessingActive) return;
    event.preventDefault();
    event.returnValue = "";
});
window.addEventListener("online", () => {
    if (appErrorKind !== "offline") return;
    const overlay = ensureAppErrorOverlay();
    overlay.querySelector(".app-state-message").textContent = "Connection restored. Tap Retry to continue.";
});
document.addEventListener("DOMContentLoaded", () => {
    if (!navigator.onLine) showOfflineScreen();
});

// ✅ Open IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            let db = event.target.result;

            if (!db.objectStoreNames.contains("products")) {
                let productStore = db.createObjectStore("products", { keyPath: "id" });
                productStore.createIndex("category_name", "category_name", { unique: false });
            }

            if (!db.objectStoreNames.contains("branch")) {
                db.createObjectStore("branch", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("cart")) {
                db.createObjectStore("cart", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "id" }); // ✅ this is your missing one
            }

            if (!db.objectStoreNames.contains("phonepe")) {
                db.createObjectStore("phonepe", { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains("payment")) {
                db.createObjectStore("payment", { keyPath: "id" });
            }

        };


        request.onsuccess = () => {
            db = request.result;
            console.log("✅ IndexedDB Opened Successfully");
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("❌ IndexedDB Error:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function saveKioskPaymentToIndexedDB(paymentData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readwrite");
        const store = tx.objectStore(PAYMENT_STORE);
        store.put({ id: "payment_type", ...paymentData });

        tx.oncomplete = () => {
            console.log("✅ Kiosk payment types saved to IndexedDB");
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save payment types:", err);
            reject(err);
        };
    });
}
async function getKioskPayment() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PAYMENT_STORE, "readonly");
        const store = tx.objectStore(PAYMENT_STORE);
        const req = store.get("payment_type");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

// ✅ Get IndexedDB instance
async function getDB() {
    if (!db) {
        db = await openDB();
    }
    return db;
}

// ✅ Fetch data from IndexedDB
async function getData(storeName) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

// ✅ Save Data to IndexedDB (Now Removes Outdated Products)
async function saveData(storeName, newData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => {
            console.log(`✅ Updated ${storeName} in IndexedDB`);
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(`${storeName} update transaction was aborted.`));

        store.clear();
        newData.forEach(item => store.put(item));
    });
}

async function syncChangedProducts(newProducts) {
    const db = await getDB();
    const comparableFields = [
        "id",
        "name",
        "available_quantity",
        "price",
        "discount_price",
        "tax_price",
        "img",
        "category_name"
    ];

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        let changes = {
            inserted: 0,
            updated: 0,
            deleted: 0,
            upsertedIds: [],
            structuralChange: false
        };

        transaction.oncomplete = () => resolve(changes);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Product sync transaction was aborted."));

        request.onsuccess = () => {
            const existingById = new Map(request.result.map(product => [String(product.id), product]));
            const incomingById = new Map(newProducts.map(product => [String(product.id), product]));

            existingById.forEach((existingProduct, id) => {
                if (!incomingById.has(id)) {
                    store.delete(existingProduct.id);
                    changes.deleted += 1;
                    changes.structuralChange = true;
                }
            });

            incomingById.forEach((incomingProduct, id) => {
                const existingProduct = existingById.get(id);
                if (!existingProduct) {
                    store.put(incomingProduct);
                    changes.inserted += 1;
                    changes.upsertedIds.push(id);
                    changes.structuralChange = true;
                    return;
                }

                const hasChanged = comparableFields.some(field => !Object.is(existingProduct[field], incomingProduct[field]));
                if (hasChanged) {
                    store.put(incomingProduct);
                    changes.updated += 1;
                    changes.upsertedIds.push(id);
                    if (existingProduct.category_name !== incomingProduct.category_name) {
                        changes.structuralChange = true;
                    }
                }
            });
        };
    });
}

async function saveKioskImagesToIndexedDB(images, updateUI = true) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readwrite");
        const store = tx.objectStore(IMAGE_STORE);
        store.put({ id: "kiosk", ...images });

        tx.oncomplete = () => {
            console.log("✅ Kiosk images saved to IndexedDB");
            if (updateUI) updateKioskImageUI(images);
            resolve();
        };
        tx.onerror = (err) => {
            console.error("❌ Failed to save kiosk images:", err);
            reject(err);
        };
    });
}

async function getKioskImages() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IMAGE_STORE, "readonly");
        const store = tx.objectStore(IMAGE_STORE);
        const req = store.get("kiosk");

        req.onsuccess = () => resolve(req.result);
        req.onerror = (err) => reject(err);
    });
}

function updateKioskImageUI(data = {}) {
    /* The page's own origin, with no fallback. A hardcoded host here would
       quietly serve one shop its images from another shop's server. */
    const apiBaseUrl = String(CONFIG.API_BASE_URL || "").replace(/\/$/, "");
    const getImagePath = (val, fallback) => {
        try {
            if (!val || typeof val !== "string" || val.trim() === "") return `images/${fallback}`;
            const imageValue = val.trim();
            if (imageValue === fallback || imageValue === `images/${fallback}`) {
                return `images/${fallback}`;
            }
            let candidateUrl;
            if (imageValue.startsWith("/uploads/")) {
                candidateUrl = `${apiBaseUrl}${imageValue}`;
            } else if (imageValue.startsWith("uploads/")) {
                candidateUrl = `${apiBaseUrl}/${imageValue}`;
            } else if (/^(https?:|data:|blob:)/i.test(imageValue)) {
                candidateUrl = imageValue;
            } else {
                candidateUrl = `${apiBaseUrl}/uploads/${imageValue}`;
            }

            const parsedUrl = new URL(candidateUrl, window.location.href);
            if (["http:", "https:", "blob:"].includes(parsedUrl.protocol)) return parsedUrl.href;
            if (parsedUrl.protocol === "data:" && /^data:image\//i.test(candidateUrl)) return candidateUrl;
            return `images/${fallback}`;
        } catch (err) {
            console.warn("⚠️ Error in getImagePath fallback:", err);
            return `images/${fallback}`;
        }
    };

    // ✅ Company Logo
    const setImageWithFallback = (selector, source, fallback) => {
        const fallbackPath = `images/${fallback}`;
        $(selector).each((_, element) => {
            $(element)
                .off("error.kioskFallback")
                .one("error.kioskFallback", () => {
                    if (element.getAttribute("src") !== fallbackPath) element.setAttribute("src", fallbackPath);
                })
                .attr("src", source);
        });
    };

    const setBackgroundWithFallback = (applyBackground, source, fallback) => {
        const fallbackPath = `images/${fallback}`;
        applyBackground(fallbackPath);
        if (source === fallbackPath) return;

        const image = new Image();
        image.onload = () => applyBackground(source);
        image.onerror = () => applyBackground(fallbackPath);
        image.src = source;
    };

    const logoPath = getImagePath(data.logo, "default-product.png");
    setImageWithFallback('img[alt="Company Logo"]', logoPath, "default-product.png");

    // ✅ Advertisement
    const adPath = getImagePath(data.advertisement, "home.png");
    setImageWithFallback('img[alt="Advertisement"]', adPath, "home.png");

    // ✅ Banner background (e.g. top section)
    const bannerPath = getImagePath(data.banner, "home.png");
    const $topBanner = $('.top-banner');
    if ($topBanner.length) {
        setBackgroundWithFallback(
            path => $topBanner.css("background-image", `url("${path}")`),
            bannerPath,
            "home.png"
        );
    }

    // ✅ Homepage background image
    if (document.body.classList.contains("home-page")) {
        const homeBanner = getImagePath(data.homebanner, "home.png");
        setBackgroundWithFallback(path => {
            document.body.style.background = `url("${path}") no-repeat center center fixed`;
            document.body.style.backgroundSize = "cover";
        }, homeBanner, "home.png");
    }

    console.log("✅ Kiosk UI Images Updated", {
        logoPath, adPath, bannerPath, homebanner: data.homebanner
    });
}




// ✅ Fetch and Store Branch Data
async function fetchAndStoreBranch(branchId, redirect = true, options = {}) {
    try {
        const silent = options?.silent === true;
        const db = await getDB();
        const existingBranches = await getData(BRANCH_STORE);

        if (existingBranches.some(b => b.id === branchId)) {
            console.log("🔹 Branch exists. Checking for product updates...");
            if (redirect) {
                window.location.href = "products.html"; // first time in: the menu, not a question
            }
        }

        /*
         * The shop's storefront: who it is, whether it is taking orders, and
         * the menu.
         *
         * A GET on the store's own address, so a customer's menu is a URL that
         * can be linked, cached and opened. It used to be a POST carrying the
         * store address in a JSON body, sent to a verb named after the code
         * that happened to scan it.
         */
        /*
         * Where the customer is sitting travels with the read.
         *
         * A hotel room is quoted the marked-up price it will actually be
         * charged, so the menu has to be fetched FOR that room. Showing house
         * prices and adding the markup at checkout is how a guest finds out
         * about it at the worst possible moment.
         */
        const servicePoint = window.KioskServicePoint
            ? window.KioskServicePoint.query()
            : '';

        const response = await fetch(
            `${CONFIG.API_BASE_URL}/online-ordering/${encodeURIComponent(branchId)}${servicePoint}`,
            { method: "GET", headers: { "Accept": "application/json" } }
        );

        const result = await readJsonResponse(response, "Product sync");
        console.log("🔄 API Response:", result);

        if (result.type === "success" && result.data) {
            let products = [];

            /*
             * The shop's verdict on whether it is taking orders, applied
             * before anything is drawn.
             *
             * If the block is missing the page carries on as though ordering
             * is on, and the order endpoint refuses if it is not. See
             * assets/channel-state.js for why it fails open here.
             */
            if (result.data.channel && window.KioskChannel) {
                window.KioskChannel.save(result.data.channel);
            }

            /* And the shop's description of where this customer is sitting -
               the venue's real name, what it calls a room, whether it needs a
               floor. The checkout screen shows it back and lets it be
               corrected. */
            if (window.KioskServicePoint) {
                window.KioskServicePoint.remember(result.data);
            }

            const categories = (result.data.menu && result.data.menu.categories) || [];
            const kioskImages = result.data.store;

            if (kioskImages) {
                const normalizeKioskImage = (url, fallback) => {
                    try {
                        if (url && typeof url === 'string' && url.trim() !== '') {
                            return url.trim();
                        }
                    } catch (e) {
                        console.warn("❌ Invalid URL for kiosk image:", url);
                    }
                    return fallback;
                };

                await saveKioskImagesToIndexedDB({
                    homebanner: normalizeKioskImage(kioskImages.homebanner, "home.png"),
                    logo: normalizeKioskImage(kioskImages.logo, "default-product.png"),
                    banner: normalizeKioskImage(kioskImages.banner, "home.png"),
                    advertisement: normalizeKioskImage(kioskImages.advertisement, "home.png")
                }, !silent);
            }

            categories.forEach(category => {
                category.items.forEach(item => {
                    let imageSrc = (!item.img || item.img.trim() === "" || item.img === "item.svg") ? "images/default-product.png" : item.img;
                    const itemId = typeof item.id === "string"
                        ? item.id
                        : (item.id?.$oid || item._id?.$oid || item._id || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
                    products.push({
                        id: String(itemId),
                        name: item.name || "Unknown",
                        available_quantity: item.available_quantity || 0,
                        price: parseFloat(item.final_price) || 0,
                        discount_price: parseFloat(item.discount_price) || 0,
                        tax_price: parseFloat(item.tax_price) || 0,
                        img: imageSrc,
                        /* Kept so the page can filter by diet, sort by what
                           sells, and search a description - none of which
                           reached this bundle before, which is why /order had
                           no search while /menu had one. */
                        diet: item.diet || "",
                        description: item.description || "",
                        prep_minutes: Number(item.prep_minutes) || 0,
                        ordered_count: Number(item.ordered_count) || 0,
                        category_name: category.category_name
                    });
                });
            });

            // ✅ Save branch & products in IndexedDB
            let productChanges = null;
            await saveData(BRANCH_STORE, [{ id: branchId, kioskPayment: result.data.payment }]);
            if (silent) {
                productChanges = await syncChangedProducts(products);
                const totalChanges = productChanges.inserted + productChanges.updated + productChanges.deleted;
                if (totalChanges > 0) {
                    console.log("Product changes synced:", {
                        inserted: productChanges.inserted,
                        updated: productChanges.updated,
                        deleted: productChanges.deleted
                    });
                }
            } else {
                await saveData(STORE_NAME, products);
            }

            console.log("✅ Product data updated successfully!");

            const kioskPayment = result.data.payment;
            if (kioskPayment) {
                await saveKioskPaymentToIndexedDB(kioskPayment);
            }

            // ✅ Validate cart
            window.POSNIC_SILENT_REFRESH = silent;
            await validateCartWithProducts(products, !silent);
            window.POSNIC_SILENT_REFRESH = false;
            if (silent && productChanges?.structuralChange) {
                await loadProducts();
            } else if (silent) {
                await patchVisibleProductsFromData(products, productChanges?.upsertedIds || []);
            }

            // ✅ Reload products on UI
            if (!silent) await loadProducts();

            if (redirect) {
                /*
                 * THE MENU FIRST.
                 *
                 * This went to home.html - Dine In or Take Away, before a
                 * single dish had been seen. Owner: "take away or here no
                 * need to ask first itself." The question moved to the
                 * payment page, where it is answered once and at the point it
                 * matters; home.html stays for a screen that wants an attract
                 * page, but nothing routes a scanned code through it.
                 */
                window.location.href = "products.html";
                hideLoader(); // ✅ Hide loader after redirect
            }
            if (!silent) hideAppErrorScreen();
            return true;
        } else {
            console.warn("❌ No data received from API.");
            if (!silent) {
                showAppErrorScreen(
                    "Unable to load the menu",
                    result.message || "The server returned an invalid response.",
                    async () => {
                        const success = await fetchAndStoreBranch(branchId, redirect, options);
                        if (!success) throw new Error("Menu retry failed.");
                    }
                );
            }
            return false;
        }
    } catch (error) {
        window.POSNIC_SILENT_REFRESH = false;
        console.error("❌ Error updating product data:", error);
        if (!options?.silent) {
            showAppErrorScreen(
                navigator.onLine ? "Unable to reach the server" : "You are offline",
                navigator.onLine ? error.message : "Check the internet connection, then tap Retry.",
                async () => {
                    if (!navigator.onLine) throw new Error("Internet connection is still unavailable.");
                    const success = await fetchAndStoreBranch(branchId, redirect, options);
                    if (!success) throw new Error("Menu retry failed.");
                },
                { kind: navigator.onLine ? "error" : "offline", icon: navigator.onLine ? "⚠️" : "📡" }
            );
        }
        return false;
    }
}


async function validateCartWithProducts(updatedProducts, renderUI = true) {
    const cartData = await getCartData();
    const productMap = new Map(updatedProducts.map(p => [p.id, p])); // 🔁 Map for quick access

    // 🔄 Update cart items with latest product info
    const syncedCart = cartData
        .map(item => {
            const updatedProduct = productMap.get(item.id);
            if (updatedProduct) {
                return {
                    ...item,
                    name: updatedProduct.name,
                    img: updatedProduct.img,
                    price: updatedProduct.price,
                    tax_price: updatedProduct.tax_price,
                };
            }
            return null; // Item no longer exists in product list
        })
        .filter(Boolean); // Remove nulls (outdated items)

    if (syncedCart.length !== cartData.length) {
        console.log("🗑️ Removed outdated cart items.");
    } else {
        console.log("🔄 Synced cart items with latest product data.");
    }

    await saveCartData(syncedCart);     // 💾 Save updated cart
    renderCart(syncedCart);             // 🔄 Re-render cart UI with synced data
}

// ✅ Optimized renderCart function
async function renderCart(cartData = null) {
    if (window.POSNIC_SILENT_REFRESH) return;

    try {
        if (!cartData) {
            cartData = await getCartData(); // ✅ Fetch only if not already available
        }

        let totalPrice = 0;
        let totalQty = 0;
        let html = "";

        if (cartData.length === 0) {
            $("#next-btn").prop("disabled", true);
            $("#cart-summary").html("<p class='text-center'>Cart is empty</p>");
            $("#cart-total,#cart-qty,#mobile-cart-count").text("0.00");
            $("#summary-display").text(`0 Items | ₹0.00`);
            setTimeout(() => {
                window.location.href = "products.html";
            }, 2000);
            return;
        }

        cartData.forEach(item => {
            const itemId = String(item.id ?? "");
            const quantity = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const lineTotal = quantity * price;
            totalPrice += lineTotal;
            totalQty += quantity;

            const itemName = String(item.name ?? "Unknown");
            const displayName = itemName.length > 25 ? itemName.substring(0, 25) + '...' : itemName;
            const safeItemId = escapeHtml(itemId);
            const safeItemName = escapeHtml(displayName);
            const safeImageUrl = escapeHtml(getSafeImageUrl(item.img));

            html += `
                <div class="cart-item" data-item-id="${safeItemId}">
                    <img src="${safeImageUrl}" alt="${safeItemName}" class="item-image">
                    
                    <div class="item-content">
                        <div class="item-details">
                            <div class="item-name">${safeItemName}</div>
                            <div class="item-prices">
                                <span class="unit-price">₹${price.toFixed(2)} per item</span>
                                <span class="total-price">₹${lineTotal.toFixed(2)}</span>
                            </div>
                        </div>
                        
                        <div class="quantity-control">
                            <button class="qty-btn cart-quantity-btn" data-item-id="${safeItemId}" data-change="-1">-</button>
                            <span class="qty-value">${quantity}</span>
                            <button class="qty-btn cart-quantity-btn" data-item-id="${safeItemId}" data-change="1">+</button>
                        </div>
                    </div>
                </div>`;
        });

        if (!document.getElementById("cart-summary")) {
            return;
        }

        $("#cart-summary").html(html);
        $("#summary-display").text(`${totalQty} Items | ₹${totalPrice.toFixed(2)}`);
        $('#cart-qty,#mobile-cart-count').html(totalQty);
        $("#cart-total").text(totalPrice.toFixed(2));
        const loader = document.getElementById('page-loader');
        if (loader) loader.style.display = 'none';

    } catch (error) {
        console.error("❌ Error rendering cart:", error);
    }
}

$(document).on("click", ".cart-quantity-btn", async function () {
    const itemId = String($(this).attr("data-item-id") ?? "");
    const change = Number($(this).attr("data-change"));
    if (!itemId || ![-1, 1].includes(change)) return;
    await updateCartQuantity(itemId, change);
});

// ✅ Optimized remove function: No redundant IndexedDB calls
async function removeCartItem(id) {
    clearOrderAttemptId();
    let cartData = await getCartData();
    cartData = cartData.filter(i => i.id !== id); // 🔥 Remove from IndexedDB cart

    await saveCartData(cartData);

    // 🔥 Immediately remove from UI
    $(".cart-item").filter((_, element) => String($(element).attr("data-item-id")) === String(id)).remove();

    // ✅ Pass updated cartData directly to renderCart
    renderCart(cartData);
}

// ✅ Optimized update function: Prevents multiple IndexedDB calls
async function updateCartQuantity(id, change) {
    clearOrderAttemptId();
    const storedProducts = await getData("products");
    const storedProduct = storedProducts.find(item => String(item.id) === String(id));
    const currentCart = await getCartData();
    const result = KioskCore.changeCartQuantity(currentCart, storedProduct, id, change);
    const cartData = result.cart;
    const totalQty = cartData.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

    $("#checkout-btn").prop("disabled", false); // ✅ Enable checkout button if cart is not empty

    if (totalQty <= 0) {
        $("#checkout-btn").prop("disabled", true); // ✅ Disable checkout button if cart is empty
    }

    if (result.quantity <= 0) {
        $(".cart-item").filter((_, element) => String($(element).attr("data-item-id")) === String(id)).remove(); // ✅ Remove from UI immediately
    }

    await saveCartData(cartData);
    renderCart(cartData); // ✅ Pass updated cart data directly
}

async function patchVisibleProductsFromData(updatedProducts = [], changedProductIds = []) {
    if (!document.getElementById("product-list")) {
        return;
    }

    products = Object.create(null);
    updatedProducts.forEach(product => {
        const categoryKey = (product.category_name || "").toLowerCase().replace(/\s/g, "_");
        if (!products[categoryKey]) products[categoryKey] = [];
        products[categoryKey].push(product);
    });

    const changedIds = new Set(changedProductIds.map(String));
    updatedProducts.forEach(product => {
        if (!changedIds.has(String(product.id))) return;
        const $card = $(".product-card").filter((_, card) => String($(card).attr("data-id")) === String(product.id));
        if (!$card.length) return;

        $card.find(".product-price").text(`₹${Number(product.price || 0).toFixed(2)}`);
        const productName = String(product.name || "Unknown");
        const displayName = productName.length > 25 ? productName.substring(0, 25) + "..." : productName;
        $card.find(".product-title").text(displayName);
        const $image = $card.find("img").first();
        const safeImageUrl = getSafeImageUrl(product.img);
        if ($image.length && $image.attr("src") !== safeImageUrl) {
            $image.attr("src", safeImageUrl);
        }
        $image.attr("alt", displayName);
    });

    await updateCart();
}

async function loadProducts() {
    if (!document.getElementById("category-list") || !document.getElementById("product-list")) {
        return;
    }

    console.log("🔄 Loading products from IndexedDB...");
    const storedProducts = await getData("products");

    if (storedProducts.length === 0) {
        /*
         * NOTHING STORED YET IS A REASON TO FETCH, NOT TO STOP.
         *
         * This logged an error and returned - and the spinner it returned
         * behind stayed up for ever, because the only thing that hides it is
         * the cart render at the end of this function. That is what every
         * first-time visitor to products.html saw: a wheel, and the console
         * line "No products found in IndexedDB!" that nobody reads.
         *
         * The branch is known (it was stored on arrival), so ask the server
         * for its menu once; the fetch calls back into here when the rows
         * are saved. If there is no branch either, say so on screen with a
         * way back to the start, and take the wheel down.
         */
        console.warn("No products stored yet; fetching the menu.");
        const loader = document.getElementById("page-loader");
        const branches = await getData("branch").catch(() => []);
        const branchId = branches && branches[0] && branches[0].id;
        if (branchId && !loadProducts._fetching) {
            loadProducts._fetching = true;
            try {
                await fetchAndStoreBranch(branchId, false);
            } finally {
                loadProducts._fetching = false;
            }
            return;
        }
        if (loader) loader.style.display = "none";
        if (typeof showAppErrorScreen === "function") {
            showAppErrorScreen(
                "Menu not loaded",
                "Scan the code on the table again, or ask at the counter.",
                () => { window.location.href = "index.html"; }
            );
        }
        return;
    }

    products = Object.create(null);
    const categories = new Map();

    storedProducts.forEach(product => {
        const categoryName = String(product.category_name || "Uncategorized");
        const categoryKey = categoryName.toLowerCase().replace(/\s/g, "_");
        if (!products[categoryKey]) products[categoryKey] = [];
        products[categoryKey].push(product);
        categories.set(categoryKey, categoryName);
    });

    const $categoryList = $("#category-list").empty();
    categories.forEach((categoryName, categoryKey) => {
        $("<div>")
            .addClass("category-item")
            .attr("data-category", categoryKey)
            .text(categoryName)
            .appendTo($categoryList);
    });

    // ✅ Retrieve last active category from localStorage
    let lastActiveCategory = localStorage.getItem("lastActiveCategory");

    // ✅ Ensure the last active category is marked as active
    if (lastActiveCategory && products[lastActiveCategory]) {
        const categoryElement = $(".category-item").filter((_, element) => (
            String($(element).attr("data-category")) === String(lastActiveCategory)
        ));
        if (categoryElement.length) {
            categoryElement.addClass("active");
            showCategory(lastActiveCategory, categoryElement[0]);
            return;
        }
    }

    // ✅ If no last active category, select the first one
    if (Object.keys(products).length > 0) {
        let firstCategory = Object.keys(products)[0];
        let firstElement = $(".category-item").first();
        firstElement.addClass("active");
        showCategory(firstCategory, firstElement[0]);
    }
}

$(document).on("click", ".category-item", function () {
    const category = String($(this).attr("data-category") ?? "");
    if (category) showCategory(category, this);
});

async function showCategory(category, element) {
    if (!document.getElementById("product-list")) {
        return;
    }

    $(".category-item").removeClass("active");
    $(element).addClass("active");

    // ✅ Update heading dynamically
    let categoryName = $(element).text();
    $("#category-heading").text(categoryName);

    // ✅ Store the last active category in localStorage
    localStorage.setItem("lastActiveCategory", category);

    await renderProductCards(products[category] || []);
}

/**
 * Draw a list of products into the grid.
 *
 * LIFTED OUT OF showCategory so search can reuse it. A search spans every
 * category, so the thing being drawn is no longer "the open category" - and
 * two copies of the card markup would mean the search results quietly losing
 * a button the category view still had.
 */
async function renderProductCards(list) {
    if (!document.getElementById("product-list")) return;

    const storedCart = await getCartData();
    const cartByProductId = new Map(storedCart.map(item => [String(item.id), item]));
    let html = "";

    for (const product of (list || [])) {
        const productId = String(product.id ?? "");
        const cartItem = cartByProductId.get(productId);
        const quantity = cartItem ? Number(cartItem.quantity) || 0 : 0;
        const activeClass = quantity > 0 ? "active" : "";

        const productName = String(product.name ?? "Unknown");
        const displayName = productName.length > 25 ? productName.substring(0, 25) + '...' : productName;
        const safeProductId = escapeHtml(productId);
        const safeProductName = escapeHtml(displayName);
        const safeImageUrl = escapeHtml(getSafeImageUrl(product.img));
        const price = Number(product.price) || 0;

        /* The veg mark, drawn as the square-and-circle people already look for
           before they read the name. Absent when the shop has not said, which
           is not the same as "not vegetarian". */
        const diet = String(product.diet || "");
        const dietMark = diet
            ? `<span class="product-diet diet-${escapeHtml(diet)}" role="img" aria-label="${escapeHtml(diet.replace("_", "-"))}"></span>`
            : "";

        html += `
        <div class="product-card ${activeClass}" data-id="${safeProductId}">
            <img src="${safeImageUrl}" alt="${safeProductName}">
            <p class="product-title">${dietMark}${safeProductName}</p>
            <div class="product-price">₹${price.toFixed(2)}</div>
            <div class="cart-controls">
                <button class="btn-decrease" data-id="${safeProductId}" ${quantity <= 0 ? 'disabled' : ''}>-</button>
                <span class="product-qty" data-id="${safeProductId}" style="font-size: 18px; font-weight: bold;">${quantity}</span>
                <button class="btn-increase" data-id="${safeProductId}">+</button>
            </div>
        </div>`;
    }

    $("#product-list").html(html);
    await updateCart(storedCart);
    const loader = document.getElementById('page-loader');
    if (loader) loader.style.display = 'none';
}

// ✅ Event Binding for `.product-card` Clicks
// $(document).on("click", ".product-card", async function () {
//     let productId = $(this).data("id");
//     await updateQuantity(productId, 1);
// });
// ✅ Update Quantity and Save to IndexedDB
async function updateQuantity(id, change) {
    clearOrderAttemptId();
    const storedProducts = await getData("products");
    const storedProduct = storedProducts.find(item => String(item.id) === String(id));
    const currentCart = await getCartData();
    const result = KioskCore.changeCartQuantity(currentCart, storedProduct, id, change);
    const item = result.item;
    const cartData = result.cart;
    if (!item) return;

    // if (storedProduct.available_quantity < item.quantity && change === 1) {
    //     showPopup();  
    //     return;
    // }

    await saveCartData(cartData);
    updateCart();

    // ✅ Update UI quantity text
    $(".product-qty").filter((_, element) => String($(element).attr("data-id")) === String(id)).text(item.quantity);

    // ✅ Disable or enable "-" button
    const $decreaseBtn = $(".btn-decrease").filter((_, element) => String($(element).attr("data-id")) === String(id));
    const $productCard = $(".product-card").filter((_, element) => String($(element).attr("data-id")) === String(id));
    if (item.quantity === 0) {
        $decreaseBtn.prop("disabled", true);
        $productCard.removeClass("active");
    } else {
        $decreaseBtn.prop("disabled", false);
        $productCard.addClass("active");
    }
}

async function updateCart(cartData = null) {
    let totalQty = 0;
    let totalPrice = 0;

    try {
        const storedCart = cartData ?? await getCartData();

        storedCart.forEach(item => {
            totalQty += item.quantity;
            totalPrice += item.quantity * item.price;

            // ✅ Update UI for each item
            $(".product-qty").filter((_, element) => (
                String($(element).attr("data-id")) === String(item.id)
            )).text(item.quantity);
        });

        if (totalQty === 0) {
            $(".next-page")
                .addClass("disabled")
                .off("click"); // disables click handler
        } else {
            $(".next-page").on("click", () => window.location.href = 'cart.html');
            $(".next-page").removeClass("disabled");
        }


        $("#cart-qty,#mobile-cart-count").text(totalQty);
        $("#cart-total").text(totalPrice.toFixed(2));
        $("#summary-display").text(`${totalQty} Items | ₹${totalPrice.toFixed(2)}`);
        $("#next-btn").prop("disabled", totalQty === 0);
    } catch (error) {
        console.error("❌ Error updating cart:", error);
    }
}

// ✅ Check if IndexedDB has a branch and redirect
async function checkBranchAndRedirect() {
    const branches = await getData(BRANCH_STORE);
    if (branches.length > 0) {
        console.log("✅ Branch already exists, skipping redirect.");
        return;
    } else {
        const db = await getDB();
        const tx = db.transaction([BRANCH_STORE, STORE_NAME, CART_STORE, PHONEPE_STORE, IMAGE_STORE, PAYMENT_STORE], "readwrite");

        tx.objectStore(BRANCH_STORE).clear();
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(CART_STORE).clear();
        tx.objectStore(PHONEPE_STORE).clear();
        tx.objectStore(IMAGE_STORE).clear();
        tx.objectStore(PAYMENT_STORE).clear();
        console.log("🚀 First-time branch entry required.");

    }
}

// ✅ Refresh IndexedDB every 1 minute without redirect
(async () => {
    await loadEnvConfig();

    // ✅ Now safe to call functions that depend on CONFIG
    await checkBranchAndRedirect();

    let isBackgroundRefreshRunning = false;
    setInterval(async () => {
        if (isBackgroundRefreshRunning) return;
        isBackgroundRefreshRunning = true;
        console.log("🔄 Checking for product updates...");
        try {
            const branches = await getData(BRANCH_STORE);
            if (branches.length > 0) {
                await fetchAndStoreBranch(branches[0].id, false, { silent: true });
            }
        } finally {
            isBackgroundRefreshRunning = false;
        }
    }, 10000);
})();

// ✅ Run branch check on page load
checkBranchAndRedirect();


async function getCartData() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readonly");
        const store = transaction.objectStore("cart");
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

async function getProductById(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("products", "readonly");
        const store = transaction.objectStore("products");
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (error) => reject(error);
    });
}

async function saveCartData(cart) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("cart", "readwrite");
        const store = transaction.objectStore("cart");

        store.clear();
        cart.forEach(item => store.put(item));

        transaction.oncomplete = () => {
            console.log("✅ Cart Updated in IndexedDB");
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Cart update transaction was aborted."));
    });
}

function onCancelClick() {
    const cancelModal = document.getElementById("cancelModal");
    if (cancelModal) cancelModal.style.display = "flex";
}

async function confirmCancelOrder() {
    // Clear the cart
    await saveCartData([]); // Clear IndexedDB cart
    clearOrderAttemptId();
    sessionStorage.removeItem("kiosk_mobile_number");
    sessionStorage.removeItem("kioskReceipt");
    sessionStorage.removeItem("qr_id");
    localStorage.removeItem("kiosk_mobile_number"); // Remove data left by older versions.
    localStorage.removeItem("kioskReceipt");
    localStorage.removeItem("qr_id");
    const cartSummary = document.getElementById("cart-summary");
    if (cartSummary) cartSummary.innerHTML = ""; // Clear cart UI
    const summaryDisplay = document.getElementById("summary-display");
    if (summaryDisplay) summaryDisplay.textContent = "0 Items | ₹0.00"; // Reset summary
    closeCancelModal(); // Close the modal

    // Optional redirect to products page
    window.location.href = "products.html";
}

function closeCancelModal() {
    const cancelModal = document.getElementById("cancelModal");
    if (cancelModal) cancelModal.style.display = "none";
}

// ✅ Load cart from IndexedDB on page load
async function loadCart() {
    const cartItems = await getCartData();
    let cart = cartItems.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});

    console.log("🛒 Loaded Cart from IndexedDB:", cart);
    return cart; // ✅ Return cart data
}

async function checkout(transactionId, paymentStatus = "Upi") {
    if (checkoutSingleFlight.isRunning()) {
        console.warn("Checkout already in progress; reusing the active request.");
    }

    return checkoutSingleFlight.run(async () => {
        hideAppErrorScreen();
        showOrderProcessingScreen("Payment is being confirmed and your order is being created. Please do not close or refresh this page.");
        try {
            const completed = await performCheckout(transactionId, paymentStatus);
            if (!completed) hideOrderProcessingScreen();
            return completed;
        } catch (error) {
            hideOrderProcessingScreen();
            throw error;
        }
    });
}

async function performCheckout(transactionId, paymentStatus = "Upi") {
    try {
        // 🔄 Get cart data from IndexedDB
        const cartItems = await getCartData();
        console.log('cartItems:', cartItems);

        if (!cartItems || cartItems.length === 0) {
            console.log("Cart is empty.");
            return false;
        }

        // 🧾 Prepare payload: [{ id, quantity }]
        const payload = cartItems.map(item => {
            return {
                item_id: item.id,
                item_quantity: item.quantity,
                gst: item.tax_price * item.quantity
            };
        });

        // 🏪 Get branch ID
        const branches = await getData(BRANCH_STORE);
        const branchId = branches.length > 0 ? branches[0].id : null;
        const orderType = localStorage.getItem("orderType");
        const note = localStorage.getItem('note');

        const productsRefreshed = await fetchAndStoreBranch(branchId, false);
        if (!productsRefreshed) return false;

        if (!branchId) {
            console.log("Branch not found.");
            return false;
        }
        const savedNumber = sessionStorage.getItem("kiosk_mobile_number");
        const generatedTokenId = generateUniqueToken();
        const orderAttemptId = getOrCreateOrderAttemptId();

        // 🚀 Send checkout request
        const response = await fetch(
            `${CONFIG.API_BASE_URL}/online-ordering/${encodeURIComponent(branchId)}/orders`,
            {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                items: payload,
                customerMobile: '+91' + savedNumber,
                transactionId: transactionId,
                idempotencyKey: orderAttemptId,
                tokenId: generatedTokenId,
                payment_status: paymentStatus,
                sale_method: 'Self-Order',
                order: orderType,
                note: note,
                /*
                 * Which venue and room the printed code named, and what the
                 * customer confirmed at checkout if they corrected it. Only
                 * the identity travels: the server looks up what that venue's
                 * markup and commission are, so nothing here can change what
                 * anybody is charged or owed.
                 */
                ...(window.KioskServicePoint
                    ? window.KioskServicePoint.orderFields()
                    : {}),
            })
        }
        );

        const result = await readJsonResponse(response, "Checkout");

        if (result.type === "success") {
            result.data = result.data || {};
            const tokenId = result.data.tokenId; // 🔐 3-digit non-repeating token
            const normalizedTokenId = String(tokenId ?? result.data.token_id ?? result.data.token ?? generatedTokenId);
            result.data.tokenId = normalizedTokenId;
            result.data.payment_status = result.data.payment_status || paymentStatus;
            sessionStorage.setItem("kioskReceipt", JSON.stringify(result.data));
            localStorage.removeItem("kioskReceipt"); // Remove data left by older versions.
            console.log(result.data);
            console.log("✅ Checkout successful! Token:", tokenId);
            // 🧹 Clear cart in IndexedDB
            await saveCartData([]);
            await renderCart([]);
            sessionStorage.removeItem("kiosk_mobile_number");
            sessionStorage.removeItem("qr_id");
            localStorage.removeItem("kiosk_mobile_number"); // Remove data left by older versions.
            localStorage.removeItem("qr_id");
            clearOrderAttemptId();
            hideOrderProcessingScreen();
            window.location.href = `thankyou.html?token=${encodeURIComponent(normalizedTokenId)}`;
            return true;
        } else {
            const errorMessage = String(result.message || "Checkout request was rejected.");
            console.error("Checkout failed:", errorMessage);
            showAppErrorScreen(
                "Order could not be completed",
                errorMessage,
                async () => {
                    hideAppErrorScreen();
                    const completed = await checkout(transactionId, paymentStatus);
                    if (!completed) throw new Error("Order retry failed.");
                },
                { buttonLabel: "Retry order" }
            );
            return false;
        }

    } catch (error) {
        console.error("Error during checkout:", error);
        showAppErrorScreen(
            "Order could not be completed",
            error.message || "Checkout failed. Please try again.",
            async () => {
                hideAppErrorScreen();
                const completed = await checkout(transactionId, paymentStatus);
                if (!completed) throw new Error("Order retry failed.");
            },
            { buttonLabel: "Retry order" }
        );
        return false;
    }
}

function getTodayKey() {
    const today = new Date();
    return `kiosk_tokens_${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
}

function getStoredTokens() {
    const key = getTodayKey();
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

function saveToken(token) {
    const key = getTodayKey();
    const tokens = getStoredTokens();
    tokens.push(token);
    localStorage.setItem(key, JSON.stringify(tokens));
}

function getAllPossibleTokens() {
    const tokens = [];
    for (let i = 65; i <= 90; i++) { // a to z
        const prefix = String.fromCharCode(i);
        for (let j = 1; j <= 999; j++) {
            tokens.push(`${prefix}${j.toString().padStart(3, '0')}`);
        }
    }
    return tokens;
}

function generateUniqueToken() {
    const usedTokens = getStoredTokens();
    const allTokens = getAllPossibleTokens();
    const remaining = allTokens.filter(t => !usedTokens.includes(t));

    if (remaining.length === 0) {
        console.warn("🔁 All tokens used. Resetting for the next cycle.");
        localStorage.removeItem(getTodayKey());
        return generateUniqueToken(); // Retry after reset
    }

    const token = remaining[Math.floor(Math.random() * remaining.length)];
    saveToken(token);
    return token;
}

async function storePhonePeData(id) {
    try {
        await saveData(PHONEPE_STORE, [{ id: id }]);
    } catch (error) {
        console.error("❌ Error updating PhonePe data:", error);
    }
}

async function getFirstPhonePeId() {
    const phonepeData = await getData(PHONEPE_STORE);
    if (phonepeData.length > 0) {
        return phonepeData[0].id;
    }
    return null;
}

function showPopup() {
    const popup = document.getElementById('popup');

    // Reset the state
    popup.classList.remove('show');
    popup.style.display = 'block';
    void popup.offsetWidth; // force reflow

    // Show with animation
    popup.classList.add('show');

    // Auto-hide after 3 seconds
    setTimeout(() => {
        hidePopup();
    }, 3000);
}

function hidePopup() {
    const popup = document.getElementById('popup');
    popup.classList.remove('show');
    setTimeout(() => {
        popup.style.display = 'none';
    }, 300); // match transition
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hidePopup();
    }
});



/* ==========================================================================
 * SEARCH, FILTERS AND SORT on the ordering page.
 *
 * This page had none of it. The digital menu at /menu could find a dish and
 * the page people actually order from could not - category scrolling and
 * nothing else - so a customer looking for one line in a catalogue of four
 * hundred scrolled until they gave up.
 *
 * SEARCH SPANS EVERY CATEGORY. Somebody typing "biryani" is asking the
 * restaurant a question, not the Mains tab. So a live search leaves the
 * category strip behind and shows one flat list of answers, best first, and
 * the strip comes back the moment the box is cleared.
 *
 * The matching arithmetic below is COPIED from menu/menu.js, which itself
 * carries a port of api/src/utils/menu-search.js. Neither bundle has a build
 * step; tests/menu-search-parity.test.js pins the copies to the same answers.
 * ======================================================================== */

function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Damerau-Levenshtein. The transposition is what makes "biriyani" one
   mistake rather than two. */
function editDistance(a, b, budget) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > budget) return budget + 1;

  var prev2 = null;
  var prev = [];
  for (var k = 0; k <= b.length; k++) prev.push(k);

  for (var i = 1; i <= a.length; i++) {
    var row = new Array(b.length + 1);
    row[0] = i;
    var best = row[0];

    for (var j = 1; j <= b.length; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      var value = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + cost);
      }
      row[j] = value;
      if (value < best) best = value;
    }

    if (best > budget) return budget + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/* Short words get no slack: with a budget of two, "dal" matches "dosa" and
   a three-letter search returns the menu. */
function budgetFor(length) {
  if (length < 5) return 0;
  if (length < 8) return 1;
  return 2;
}

function scoreWord(query, target) {
  if (!query || !target) return 0;
  if (query === target) return 100;
  if (target.indexOf(query) === 0) return 80;
  if (target.indexOf(query) !== -1) return 55;

  var budget = budgetFor(query.length);
  if (!budget) return 0;
  var distance = editDistance(query, target, budget);
  if (distance > budget) return 0;
  return 40 - (distance - 1) * 12;
}

/* Every query word must find something: somebody who typed two words meant
   both of them. */
function scoreItem(query, fields) {
  var words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return { match: true, score: 0 };

  var haystacks = [
    { text: normalize(fields.name), weight: 1 },
    { text: normalize(fields.category), weight: 0.5 },
    { text: normalize(fields.description), weight: 0.35 },
  ].filter(function (h) {
    return h.text;
  });

  var total = 0;
  for (var w = 0; w < words.length; w++) {
    var word = words[w];
    var bestForWord = 0;

    for (var h = 0; h < haystacks.length; h++) {
      var hay = haystacks[h];
      if (hay.text.indexOf(word) !== -1) {
        bestForWord = Math.max(bestForWord, 70 * hay.weight);
      }
      var parts = hay.text.split(" ");
      for (var p = 0; p < parts.length; p++) {
        var s = scoreWord(word, parts[p]);
        if (s) bestForWord = Math.max(bestForWord, s * hay.weight);
      }
    }

    if (!bestForWord) return { match: false, score: 0 };
    total += bestForWord;
  }

  return { match: true, score: Math.round(total / words.length) };
}

/* What the customer has narrowed the catalogue to. */
var orderView = { query: "", vegOnly: false, sort: "menu" };

/** Every product across every category, flattened once. */
function allProducts() {
    var out = [];
    Object.keys(products || {}).forEach(function (key) {
        (products[key] || []).forEach(function (p) { out.push(p); });
    });
    return out;
}

/**
 * The list to draw right now.
 *
 * A live search ALWAYS orders by how well each product answered, whatever the
 * sort box says: somebody who just typed "dosa" is asking a question, and
 * answering it in price order buries the dosa. The box takes over again once
 * the search is cleared.
 */
function orderViewList(source) {
    var q = orderView.query.trim();
    var list = (source || []).slice();

    if (orderView.vegOnly) {
        /* Veg only means veg. An unmarked product is NOT assumed vegetarian:
           a shop that never filled the field has promised nothing, and
           guessing on its behalf is the one mistake this filter must never
           make. */
        list = list.filter(function (p) {
            return p.diet === "veg" || p.diet === "vegan";
        });
    }

    if (q) {
        list = list
            .map(function (p, i) {
                var hit = scoreItem(q, {
                    name: p.name,
                    description: p.description,
                    category: p.category_name
                });
                return { p: p, i: i, match: hit.match, score: hit.score };
            })
            .filter(function (row) { return row.match; })
            .sort(function (a, b) { return b.score - a.score || a.i - b.i; })
            .map(function (row) { return row.p; });
        return list;
    }

    if (orderView.sort === "popular") {
        list.sort(function (a, b) {
            return (Number(b.ordered_count) || 0) - (Number(a.ordered_count) || 0);
        });
    } else if (orderView.sort === "price_asc") {
        list.sort(function (a, b) { return (Number(a.price) || 0) - (Number(b.price) || 0); });
    } else if (orderView.sort === "price_desc") {
        list.sort(function (a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
    }

    return list;
}

/** Redraw whatever the current narrowing produces. */
async function refreshProductView() {
    if (!document.getElementById("product-list")) return;

    var searching = !!orderView.query.trim();
    var active = String(localStorage.getItem("lastActiveCategory") || "");

    /* Searching leaves the categories behind: the answer is a flat list across
       the whole menu, and a category strip beside it would be navigating
       something that is no longer there. */
    $(".fixed-categories").toggle(!searching);

    var source = searching ? allProducts() : (products[active] || []);
    var list = orderViewList(source);

    $("#category-heading").text(
        searching
            ? "Results"
            : ($(".category-item.active").first().text() || "Our Menu")
    );

    await renderProductCards(list);

    var counter = document.getElementById("order-result-count");
    if (!counter) {
        counter = document.createElement("p");
        counter.id = "order-result-count";
        counter.className = "order-result-count";
        counter.setAttribute("role", "status");
        var host = document.querySelector(".order-search");
        if (host) host.appendChild(counter);
    }

    var narrowed = searching || orderView.vegOnly;
    counter.hidden = !narrowed;
    if (narrowed) {
        counter.textContent = list.length === 0
            ? (searching
                ? 'Nothing matches "' + orderView.query + '". Try a different word.'
                : "Nothing on the menu is marked vegetarian.")
            : list.length + (list.length === 1 ? " item" : " items");
    }

    document.getElementById("product-search-clear").hidden = !searching;
}

$(document).on("input", "#product-search", function () {
    orderView.query = String($(this).val() || "");
    refreshProductView();
});

$(document).on("click", "#product-search-clear", function () {
    $("#product-search").val("");
    orderView.query = "";
    refreshProductView();
    $("#product-search").trigger("focus");
});

$(document).on("click", "#order-filter-veg", function () {
    orderView.vegOnly = !orderView.vegOnly;
    $(this).attr("aria-pressed", orderView.vegOnly ? "true" : "false");
    refreshProductView();
});

$(document).on("change", "#order-sort", function () {
    orderView.sort = String($(this).val() || "menu");
    refreshProductView();
});
