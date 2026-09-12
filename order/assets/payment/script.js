let enteredNumber = "";
let timeLeft = 30;
let timerInterval = null;
let razorpayPollingController = null;
let isQrClosed = false;
let paymentSubmissionPromise = null;
let isRazorpayPaymentActive = false;
const RAZORPAY_PAYMENT_TIMEOUT_MS = 5 * 60 * 1000;

/*
 * What this page has to ask for, and what the button will say.
 *
 * Decided once, when the shop's payment methods come back, and read by
 * everything below: whether a number is needed at all, which way the money
 * goes, and the total - so the button can say "Pay ₹340" rather than
 * "PROCEED TO PAYMENT", and can say "Place order" when nothing is being paid
 * here.
 */
const payState = {
    razorpay: false,
    cash: false,
    /* Paying at the counter, on delivery, or when collecting. Allowed
       whenever the shop has not switched it off - see payingOffline(). */
    offline: false,
    /* Which of the two the customer picked when both are on offer. */
    method: "",
    phoneRequired: true,
    /* The food, and the food plus the fee for the way chosen. */
    subtotal: 0,
    total: 0,
    allowed: true,
    items: 0,
    /* How the food may travel, and which way was chosen. */
    fulfilment: [],
    chosen: "",
    kind: "restaurant",
    tableFromCode: ""
};
const DEFAULT_MOBILE = "9494111161";

/* ------------------------------------------------------------ how it travels */

/*
 * The ways this order can reach the customer, in the shop's own words.
 *
 * Built from what the shop switched on, filtered by what kind of shop it
 * is: a restaurant's "takeaway" is collected at the counter; a shop's
 * "pickup" is collected from the shop; only a restaurant has a table. A
 * list the shop never set gets the sensible default for its kind rather
 * than an empty question.
 */
function fulfilmentChoices() {
    const kind = payState.kind;
    const raw = Array.isArray(payState.fulfilment) && payState.fulfilment.length
        ? payState.fulfilment
        : (kind === "retail" ? ["pickup"] : ["dine_in", "takeaway"]);
    const seen = new Set();
    const out = [];
    for (const value of raw) {
        const f = String(value || "").toLowerCase();
        let key = f;
        if (kind === "retail" && (f === "dine_in")) continue;
        if (kind === "retail" && f === "takeaway") key = "pickup";
        if (kind !== "retail" && f === "pickup") key = "takeaway";
        if (!["dine_in", "takeaway", "pickup", "delivery"].includes(key) || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

function fulfilmentLabel(key) {
    const table = payState.tableFromCode;
    if (key === "dine_in") return table ? t("Bring it to table {table}", { table }) : t("Bring it to my table");
    if (key === "takeaway") return t("I'll collect it at the counter");
    if (key === "pickup") return t("I'll collect it from the shop");
    if (key === "delivery") return t("Deliver it to me");
    return key;
}

/* The words the old page used, kept for the server and the receipt. */
function orderTypeFor(key) {
    return key === "dine_in" ? "DINE IN" : "PARCEL";
}

function paintFulfilment() {
    const box = document.getElementById("eating-how-choices");
    if (!box) return;
    const choices = fulfilmentChoices();
    box.innerHTML = choices.map((key) =>
        `<button type="button" class="eating-how-btn" data-order-type="${orderTypeFor(key)}" data-fulfilment="${key}" aria-pressed="false">${fulfilmentLabel(key)}</button>`
    ).join("");

    const title = document.getElementById("eating-how-title");
    if (title) title.textContent = payState.kind === "retail" ? "How would you like it?" : "How would you like it served?";

    /* One way is not a question; it is chosen, and shown so it is known. */
    if (choices.length === 1) chooseFulfilment(choices[0]);
    else if (payState.chosen && choices.includes(payState.chosen)) chooseFulfilment(payState.chosen);
    else if (payState.tableFromCode && choices.includes("dine_in")) chooseFulfilment("dine_in");
}

function chooseFulfilment(key) {
    payState.chosen = key;
    localStorage.setItem("order_fulfilment", key);
    localStorage.setItem("orderType", orderTypeFor(key));
    document.querySelectorAll("#eating-how-choices .eating-how-btn").forEach((button) => {
        button.setAttribute("aria-pressed", button.getAttribute("data-fulfilment") === key ? "true" : "false");
    });
    const box = document.getElementById("eating-how");
    if (box) box.removeAttribute("data-missing");
    const missing = document.getElementById("eating-how-missing");
    if (missing) missing.hidden = true;

    /* A table, when it is not already known from the code. */
    const tableField = document.getElementById("table-field");
    if (tableField) tableField.hidden = !(key === "dine_in" && !payState.tableFromCode);
    /* Somewhere to send it. */
    const delivery = document.getElementById("delivery-form");
    if (delivery) delivery.hidden = key !== "delivery";

    paintPayMethod();
    paintProceed();
    validateNumber();
}

/* ------------------------------------------------------------ how it is paid */

/* The offline label follows the way the food travels. */
function offlineLabel() {
    if (payState.chosen === "delivery") return "Pay on delivery";
    if (payState.chosen === "pickup" || payState.chosen === "takeaway") return "Pay when collecting";
    return "Pay at the counter";
}

function paintPayMethod() {
    const box = document.getElementById("pay-method");
    if (!box) return;
    const both = payState.razorpay && payState.offline;
    box.hidden = !both;
    if (!payState.method) payState.method = payState.razorpay ? "online" : "offline";
    const offlineButton = document.getElementById("pay-offline-btn");
    if (offlineButton) offlineButton.textContent = offlineLabel();
    document.querySelectorAll(".pay-method-btn").forEach((button) => {
        button.setAttribute("aria-pressed", button.getAttribute("data-pay") === payState.method ? "true" : "false");
    });
    localStorage.setItem("order_pay", payState.method);
}

function payingOnline() {
    return payState.razorpay && payState.method !== "offline";
}

/* Whether a number is wanted: the shop asked for one, a delivery needs one,
   or the gateway wants a contact. */
function phoneWanted() {
    return payState.phoneRequired || payState.chosen === "delivery";
}

/* What the chosen way costs on top of the food, if anything. */
function feeLabel(key) {
    if (key === "delivery") return "Delivery";
    if (key === "dine_in") return "Service";
    return "Packing";
}

function paintCharges() {
    const box = document.getElementById("pay-charges");
    if (!box) return { fee: 0, allowed: true, short: 0 };
    const charge = typeof chargeFor === "function" ? chargeFor(payState.chosen, payState.subtotal) : { fee: 0, allowed: true, short: 0, toFree: 0, waived: false, minimum: 0 };
    const hasFee = charge.fee > 0 || charge.waived;
    box.hidden = !(hasFee || !charge.allowed);
    const sub = document.getElementById("pay-subtotal");
    if (sub) sub.textContent = money(payState.subtotal);
    const feeRow = document.getElementById("pay-fee-row");
    if (feeRow) feeRow.hidden = !hasFee;
    const label = document.getElementById("pay-fee-label");
    if (label) label.textContent = feeLabel(payState.chosen);
    const fee = document.getElementById("pay-fee");
    if (fee) fee.textContent = charge.waived ? "Free" : money(charge.fee);
    const note = document.getElementById("pay-charge-note");
    if (note) {
        let text = "";
        if (!charge.allowed) {
            text = t(feeLabel(payState.chosen) === "Delivery" ? "Delivery orders start at {min}. Add {more} more." : "Orders start at {min}. Add {more} more.", { min: money(charge.minimum), more: money(charge.short) });
        } else if (charge.toFree > 0) {
            text = t("Add {amount} more and {what} is free.", { amount: money(charge.toFree), what: t(feeLabel(payState.chosen).toLowerCase()) });
        }
        note.textContent = text;
        note.hidden = !text;
    }
    return charge;
}

function paintProceed() {
    const charge = paintCharges();
    payState.total = Math.round((payState.subtotal + (charge.allowed ? charge.fee : 0)) * 100) / 100;
    payState.allowed = charge.allowed;
    const button = document.getElementById("proceed-btn");
    if (button) {
        button.textContent = !charge.allowed
            ? t("Add {amount} more", { amount: money(charge.short) })
            : payingOnline() ? t("Pay {amount}", { amount: money(payState.total) }) : t("Place order");
    }
    const total = document.getElementById("pay-total");
    if (total) total.textContent = money(payState.total);
    const items = document.getElementById("pay-items");
    if (items) {
        const one = payState.kind === "retail" ? "item" : "dish";
        items.textContent = t("{n} " + (payState.items === 1 ? one : one + (one === "dish" ? "es" : "s")), { n: payState.items });
    }
    const phone = document.getElementById("phone-section");
    if (phone) phone.hidden = !phoneWanted();
}

localStorage.removeItem("kiosk_mobile_number"); // Remove data left by older versions.
sessionStorage.removeItem("kiosk_mobile_number");

/* ---------------------------------------------------------- how you eat */

/*
 * The answer lives in localStorage.orderType, which checkout() reads, exactly
 * where home.html used to put it. Pre-answered from the code that was scanned:
 * a table or a room means dining in. Otherwise the customer picks, and paying
 * waits until they have - an order with no type is a ticket the kitchen has
 * to guess about.
 */
function paintOrderType() {
    /* Kept under its old name: the fulfilment buttons carry the old
       DINE IN / PARCEL words too, and this lights whichever was chosen. */
    paintFulfilment();
}

function presetOrderType() {
    try {
        const point = window.KioskServicePoint && KioskServicePoint.read ? KioskServicePoint.read() : null;
        if (point && point.table) payState.tableFromCode = String(point.table);
        /* A room at a partner venue is a delivery to that room, which the
           service point already describes; it reads as "to my table" here. */
        if (point && (point.table || point.venue) && !localStorage.getItem("orderType")) {
            localStorage.setItem("orderType", "DINE IN");
            localStorage.setItem("order_fulfilment", "dine_in");
        }
        const stored = localStorage.getItem("order_fulfilment");
        if (stored) payState.chosen = stored;
    } catch (e) {
        /* no service point on this page is not an error */
    }
}

/* What a chosen way still needs before the order can go. */
function ensureDetails() {
    if (payState.chosen === "dine_in" && !payState.tableFromCode) {
        const field = document.getElementById("table-number");
        const table = field ? String(field.value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) : "";
        if (!table) {
            if (field) field.focus();
            if (typeof showToast === "function") showToast(t("Which table are you at?"));
            return false;
        }
        localStorage.setItem("order_table", table);
    } else {
        localStorage.removeItem("order_table");
    }
    if (payState.chosen === "delivery") {
        const name = document.getElementById("customer-name");
        const address = document.getElementById("customer-address");
        const nameText = name ? String(name.value || "").trim() : "";
        const addressText = address ? String(address.value || "").trim() : "";
        if (!nameText) { if (name) name.focus(); return false; }
        if (!addressText) { if (address) address.focus(); return false; }
        localStorage.setItem("order_customer_name", nameText.slice(0, 80));
        localStorage.setItem("order_customer_address", addressText.slice(0, 300));
    } else {
        localStorage.removeItem("order_customer_name");
        localStorage.removeItem("order_customer_address");
    }
    return true;
}

function showToast(message) {
    const popup = document.getElementById("popup");
    if (!popup) return;
    popup.textContent = message;
    popup.classList.add("show");
    popup.style.display = "block";
    setTimeout(() => { popup.classList.remove("show"); popup.style.display = "none"; }, 2500);
}

function ensureOrderType() {
    if (localStorage.getItem("orderType")) return true;
    const box = document.getElementById("eating-how");
    if (box) {
        box.setAttribute("data-missing", "true");
        if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "center" });
    }
    /* Said beside the question, not in a banner that hides the page. */
    const missing = document.getElementById("eating-how-missing");
    if (missing) missing.hidden = false;
    return false;
}

document.addEventListener("click", (event) => {
    const pay = event.target && event.target.closest ? event.target.closest(".pay-method-btn") : null;
    if (pay) {
        payState.method = pay.getAttribute("data-pay") === "offline" ? "offline" : "online";
        paintPayMethod();
        paintProceed();
        validateNumber();
        return;
    }
    const button = event.target && event.target.closest ? event.target.closest("#eating-how-choices .eating-how-btn") : null;
    if (!button) return;
    localStorage.setItem("orderType", button.getAttribute("data-order-type"));
    chooseFulfilment(button.getAttribute("data-fulfilment") || "");
});

document.addEventListener("DOMContentLoaded", () => {
    presetOrderType();
    paintOrderType();
});

function stopRazorpayPolling() {
    razorpayPollingController?.stop();
    razorpayPollingController = null;
}

function isEnabled(value) {
    if (value === true || value === 1) return true;
    if (value && typeof value === "object") {
        return isEnabled(value.enabled ?? value.status ?? value.value ?? value.checked ?? value.is_enabled ?? value.isEnabled);
    }
    if (typeof value !== "string") return false;
    return ["true", "1", "on", "yes", "enabled", "active", "checked"].includes(value.trim().toLowerCase());
}

function normalizePaymentKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCashPaymentKey(value) {
    const key = normalizePaymentKey(value);
    return key === "cod" || key.includes("cash") || key.includes("cashondelivery") || key.includes("paymentcod");
}

function isRazorpayPaymentKey(value) {
    const key = normalizePaymentKey(value);
    return key.includes("razorpay") || key.includes("paymentrazorpay");
}

function methodValue(method, fallback = false) {
    if (!method || typeof method !== "object") return method ?? fallback;
    return method.enabled ?? method.status ?? method.value ?? method.checked ?? method.is_enabled ?? method.isEnabled ?? fallback;
}

function hasEnabledPaymentMethod(kioskPayment, matcher) {
    if (!kioskPayment) return false;

    if (Array.isArray(kioskPayment)) {
        return kioskPayment.some(method => {
            if (typeof method === "string") return matcher(method);
            const name = method?.name ?? method?.label ?? method?.method ?? method?.type ?? method?.payment_method ?? method?.payment_type ?? method?.key;
            return matcher(name) && isEnabled(methodValue(method, true));
        });
    }

    if (typeof kioskPayment === "object") {
        return Object.entries(kioskPayment).some(([key, value]) => {
            if (matcher(key)) return isEnabled(value);
            if (Array.isArray(value)) return hasEnabledPaymentMethod(value, matcher);
            if (value && typeof value === "object") {
                const name = value.name ?? value.label ?? value.method ?? value.type ?? value.payment_method ?? value.payment_type ?? key;
                return (matcher(name) && isEnabled(methodValue(value, true))) || hasEnabledPaymentMethod(value, matcher);
            }
            return false;
        });
    }

    return false;
}

function isCashEnabled(kioskPayment) {
    return hasEnabledPaymentMethod(kioskPayment, isCashPaymentKey);
}

function isRazorpayEnabled(kioskPayment) {
    return hasEnabledPaymentMethod(kioskPayment, isRazorpayPaymentKey);
}

async function getLatestKioskPayment(branchId) {
    let payment = null;
    try {
        payment = await getKioskPayment();
    } catch (error) {
        console.warn("Could not read payment settings from IndexedDB:", error);
    }

    if (!payment || Object.keys(payment).filter(key => key !== "id").length === 0) {
        const branches = await getData(BRANCH_STORE);
        const branch = branches.find(item => item.id === branchId) || branches[0];
        payment = branch?.kioskPayment || payment || {};
    }

    return payment || {};
}

function loadRazorpayCheckout() {
    return new Promise((resolve, reject) => {
        if (window.Razorpay) {
            resolve();
            return;
        }

        const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (existingScript) {
            existingScript.addEventListener("load", resolve, { once: true });
            existingScript.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Unable to load Razorpay checkout script."));
        document.head.appendChild(script);
    });
}

/*
 * The number as it is typed: "98765 43210", the way it is printed on a card.
 *
 * Shown, not masked. The masking - "98XX56XXX1" - was a kiosk's answer to a
 * queue reading over a shoulder, and it made the one thing a customer needs
 * to do with a number they have just typed, check it, impossible. A phone
 * number is not a PIN.
 */
function formatMobileNumber(number) {
    const digits = String(number || "");
    if (!digits) return "";
    return digits.length > 5 ? digits.slice(0, 5) + " " + digits.slice(5) : digits;
}

function paintNumber() {
    const box = document.getElementById("mobile-number");
    if (box) {
        box.textContent = enteredNumber ? formatMobileNumber(enteredNumber) : "Enter mobile number";
        box.setAttribute("data-empty", enteredNumber ? "false" : "true");
    }
    $("#mobile-fullnumber").val(enteredNumber);
}

function addNumber(num) {
    if (enteredNumber.length < 10) {
        enteredNumber += num;
        paintNumber();
    }
    validateNumber();
}

function deleteNumber() {
    enteredNumber = enteredNumber.slice(0, -1);
    paintNumber();
    validateNumber();
}

function clearNumber() {
    enteredNumber = "";
    paintNumber();
    sessionStorage.removeItem("kiosk_mobile_number");
    validateNumber();
}

function numberIsValid() {
    return /^[6-9]\d{9}$/.test(enteredNumber);
}

/* The button waits for a number only when one is wanted, and for the
   order to reach the minimum for the way it travels. */
function validateNumber() {
    const paymentBusy = Boolean(paymentSubmissionPromise) || isRazorpayPaymentActive;
    $("#proceed-btn").prop("disabled", paymentBusy || payState.allowed === false || (phoneWanted() && !numberIsValid()));
}

async function submitRazorPayMobile() {
    if (!ensureOrderType()) return;
    if (!ensureDetails()) return;
    if (paymentSubmissionPromise || isRazorpayPaymentActive) {
        console.warn("Payment submission already in progress.");
        return paymentSubmissionPromise;
    }

    paymentSubmissionPromise = performPaymentSubmission();
    validateNumber();
    try {
        return await paymentSubmissionPromise;
    } finally {
        paymentSubmissionPromise = null;
        validateNumber();
    }
}

async function performPaymentSubmission() {
    if (!ensureOrderType()) return;
    const loaderOverlay = document.getElementById('page-loader-overlay');
    if (loaderOverlay) loaderOverlay.style.display = 'flex';
    console.log("🔗 Submitting QR request with mobile number:", enteredNumber);
    try {
        const branchId = await knownBranchId();
        const productsRefreshed = await fetchAndStoreBranch(branchId, false);
        if (!productsRefreshed) throw new Error("Could not refresh branch data before payment.");
        if (phoneWanted() && !numberIsValid()) {
            alert(t("Please enter a valid 10-digit mobile number starting with 6-9."));
            return;
        }
        const number = phoneWanted() ? enteredNumber : DEFAULT_MOBILE;
        sessionStorage.setItem("kiosk_mobile_number", number);

        const kioskPayment = await getLatestKioskPayment(branchId);
        const totalAmount = await calculateCartTotal();

        console.log("Kiosk payment config", {
            kioskPayment,
            razorpayEnabled: isRazorpayEnabled(kioskPayment),
            cashEnabled: isCashEnabled(kioskPayment)
        });

        /*
         * Paid now through the gateway, or paid at the counter, on delivery
         * or when collecting. Offline is a way to finish an order, not a
         * failure of the shop to have set one up.
         */
        if (payingOnline()) {
            const paymentStarted = await createRazorPayMobile(payState.total || totalAmount, branchId, number);
            if (!paymentStarted) throw new Error("Razorpay payment could not be started.");
        } else {
            await checkout("", "Cash");
        }
        return;

    } catch (error) {
        console.error("❌ Error submitting QR request:", error);
        showAppErrorScreen(
            "Payment could not be started",
            error.message || "Payment request failed. Please try again.",
            async () => {
                hideAppErrorScreen();
                await submitRazorPayMobile();
            },
            { buttonLabel: "Retry payment" }
        );
    } finally {
        if (loaderOverlay) loaderOverlay.style.display = 'none';
        if (!isRazorpayPaymentActive) sessionStorage.removeItem("kiosk_mobile_number");
    }
}

async function createRazorPayMobile(amount, branchId, number) {
    await loadRazorpayCheckout();
    const orderAttemptId = getOrCreateOrderAttemptId();

    const response = await fetch(`${CONFIG.API_BASE_URL}/sales/createRazorPayMobile`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ amount: amount.toFixed(2), branchId, number, idempotencyKey: orderAttemptId })
    });

    const result = await readJsonResponse(response, "Razorpay order creation");

    if (!result.data || !result.data.id) {
        console.error("❌ Razorpay order creation failed:", result);
        return false;
    }

    isRazorpayPaymentActive = true;
    validateNumber();

    var options = {
        "key": result.data.key,
        "amount": result.data.amount,
        "currency": "INR",
        "order_id": result.data.id,
        "theme": {
            "color": "#111827"
        },
        "prefill": {
            "contact": number,  // Replace with actual contact if available 
        },
        "modal": {
            "ondismiss": function () {
                stopRazorpayPolling();
                isRazorpayPaymentActive = false;
                sessionStorage.removeItem("kiosk_mobile_number");
                validateNumber();
                console.warn("⚠️ Razorpay payment modal dismissed by user.");
                (async () => {
                    const payment = await getKioskPayment();
                    const showPhoneInput = isEnabled(payment?.number ?? payment?.payment_number);
                    if (!showPhoneInput) {
                        window.location.href = "cart.html";
                    }
                })();
            }
        }
    };

    const rzp1 = new Razorpay(options);
    rzp1.open();

    document.getElementById('page-loader-overlay').style.display = 'none';

    sessionStorage.setItem("qr_id", result.data.id);
    localStorage.removeItem("qr_id"); // Remove data left by older versions.
    fetchRazorPayQrStatusMobile(branchId);
    return true;
}


function fetchRazorPayQrStatusMobile(branchId) {
    stopRazorpayPolling();
    razorpayPollingController = KioskCore.createPollingController({
        intervalMs: 5000,
        timeoutMs: RAZORPAY_PAYMENT_TIMEOUT_MS,
        poll: async () => {
            try {
                const qrCodeId = sessionStorage.getItem("qr_id");
                const response = await fetch(`${CONFIG.API_BASE_URL}/sales/fetchRazorPayQrStatusMobile`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ branchId, qr_code_id: qrCodeId })
                });
                const result = await readJsonResponse(response, "Razorpay payment status");
                const paymentStatus = result?.data?.status;
                if (!paymentStatus) {
                    throw new Error("Razorpay payment status returned an invalid response.");
                }

            if (paymentStatus === "paid") {
                stopRazorpayPolling();
                const checkoutCompleted = await checkout(result.data.transactionId);
                if (!checkoutCompleted) {
                    isRazorpayPaymentActive = false;
                    sessionStorage.removeItem("kiosk_mobile_number");
                    validateNumber();
                }
            } else if (paymentStatus === "failed") {
                stopRazorpayPolling();
                isRazorpayPaymentActive = false;
                sessionStorage.removeItem("kiosk_mobile_number");
                validateNumber();
                showAppErrorScreen(
                    "Payment failed",
                    "The payment was not completed. Return to the cart and try again.",
                    async () => {
                        window.location.href = "cart.html";
                    },
                    { icon: "❌", buttonLabel: "Back to cart" }
                );
            }

            } catch (err) {
                console.error("❌ Error checking Razorpay status:", err);
            }
        },

        onTimeout: () => {
            stopRazorpayPolling();
            isRazorpayPaymentActive = false;
            sessionStorage.removeItem("kiosk_mobile_number");
            validateNumber();
            showAppErrorScreen(
                "Payment confirmation timed out",
                "We could not confirm the payment within 5 minutes. Check with the counter before trying another payment.",
                async () => {
                    window.location.href = "cart.html";
                },
                { icon: "⏱️", buttonLabel: "Back to cart" }
            );
        }
    });
    razorpayPollingController.start();
}

async function createPhonepeMobile(amount, branchId, number) {
    try {
        const orderAttemptId = getOrCreateOrderAttemptId();
        const response = await fetch(`${CONFIG.API_BASE_URL}/sales/phonepeQr`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                amount: amount.toFixed(2),
                brancheId: branchId,
                mobileNumber: number,
                idempotencyKey: orderAttemptId,
            }),
        });

        const result = await readJsonResponse(response, "PhonePe payment creation");

        if (!result?.data) {
            throw new Error("Invalid response: Missing 'data' field");
        }

        await storePhonePeData(result.data['merchantTransactionId']);

        window.location.href = result.data['url'];

    } catch (error) {
        console.error("Error submitting QR request:", error);
        alert(error.message || t("Payment request failed. Please try again."));
    }
}

async function calculateCartTotal() {
    let total = 0;
    const cart = await getCartData();
    cart.forEach(item => total += item.quantity * item.price);
    return total;
}

document.addEventListener("DOMContentLoaded", () => {
    enteredNumber = "";
    paintNumber();
    validateNumber();
});

/* Something the shop has to fix, in place of the form. */
function showAlert(message) {
    const alertText = document.getElementById("alertText");
    const alertBox = document.getElementById("alertBox");
    const wrapper = document.getElementById("mobile-wrapper");

    if (alertText) alertText.textContent = message;
    if (alertBox) alertBox.hidden = false;
    if (wrapper) wrapper.style.display = "none";
}


(async () => {
    await loadEnvConfig();
    const branchId = await knownBranchId();
    const productsRefreshed = await fetchAndStoreBranch(branchId, false);
    if (!productsRefreshed) return;
    const kioskPayment = await getLatestKioskPayment(branchId);
    const { number: phoneRequired, payment_number: paymentNumberRequired } = kioskPayment || {};
    const showPhoneInput = isEnabled(phoneRequired ?? paymentNumberRequired);
    const backBtn = document.getElementById("backtocart-nopayment");
    const mobileWrapper = document.getElementById("mobile-wrapper");
    const razorpayEnabled = isRazorpayEnabled(kioskPayment);
    const cashEnabled = isCashEnabled(kioskPayment);
    /*
     * PAYING OFFLINE IS A WAY TO FINISH.
     *
     * The page refused every shop that had not set up a gateway - "has not
     * set up a way to pay online yet, please order at the counter" - which
     * turned the ordering page into a menu for most shops. The server now
     * says whether paying at the counter, on delivery or when collecting is
     * allowed (`payment.offline`: on unless the shop switched it off while
     * taking online payments), and an older server that does not say is
     * read the way the owner reads it: if nothing else is set up, offline
     * is how it works.
     */
    const offlineAllowed = kioskPayment && typeof kioskPayment.offline === "boolean"
        ? kioskPayment.offline
        : (cashEnabled || !razorpayEnabled);
    console.log("Kiosk payment config", { kioskPayment, razorpayEnabled, cashEnabled, offlineAllowed, showPhoneInput });
    if (!razorpayEnabled && !offlineAllowed) {
        mobileWrapper.style.display = "none";
        showAlert(t("This shop is not taking payment through this page right now. Please order at the counter."));
        if (backBtn) backBtn.style.display = "inline-block";
        return;
    }
    const totalAmount = await calculateCartTotal();
    const cartLines = await getCartData();
    await rememberShop();
    payState.razorpay = razorpayEnabled;
    payState.cash = cashEnabled;
    payState.offline = offlineAllowed;
    payState.phoneRequired = showPhoneInput;
    payState.subtotal = totalAmount;
    payState.total = totalAmount;
    payState.items = cartLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    payState.kind = shop.kind;
    payState.fulfilment = shop.fulfilment;

    /*
     * THE QUESTION CANNOT BE SKIPPED.
     *
     * With no number wanted, this page used to go straight to the payment -
     * which was fine while the door had already asked dine-in-or-take-away.
     * The door no longer asks, so a shop that wants no number would have sent
     * every order to the kitchen with no answer. If the code that was scanned
     * did not settle it, the page stays up long enough to ask.
     */
    presetOrderType();
    const choices = fulfilmentChoices();
    /*
     * Nothing to ask means nothing to show: one way for the food to travel,
     * already settled by the code that was scanned, no number wanted, and
     * one way to pay. Otherwise the page stays up and asks.
     */
    const firstCharge = typeof chargeFor === "function" ? chargeFor(choices[0], totalAmount) : { fee: 0, allowed: true };
    const settled = choices.length === 1 && (choices[0] !== "dine_in" || payState.tableFromCode) && choices[0] !== "delivery"
        /* A fee or a minimum is something to be told about before paying. */
        && firstCharge.allowed && !(firstCharge.fee > 0);
    const needsType = !settled && !(payState.chosen && choices.includes(payState.chosen));
    const oneWayToPay = !(razorpayEnabled && offlineAllowed);

    if (!showPhoneInput && !needsType && oneWayToPay && settled) {
        chooseFulfilment(choices[0]);
        document.getElementById('page-loader-overlay').style.display = 'flex';
        mobileWrapper.style.display = "none";
        sessionStorage.setItem("kiosk_mobile_number", DEFAULT_MOBILE);
        if (!razorpayEnabled) {
            await checkout("", "Cash");
            return;
        }
        const paymentStarted = await createRazorPayMobile(payState.total || totalAmount, branchId, DEFAULT_MOBILE);
        if (!paymentStarted) throw new Error("Razorpay payment could not be started.");
        return;
    }

    paintOrderType();
    paintPayMethod();
    paintProceed();
    validateNumber();
    mobileWrapper.style.display = "block";
})().catch(error => {
    console.error("Payment page initialization failed:", error);
    showAppErrorScreen(
        "Payment page could not be loaded",
        error.message || "Please check the connection and try again.",
        async () => window.location.reload(),
        { buttonLabel: "Retry" }
    );
});
