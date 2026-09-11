let enteredNumber = "";
let timeLeft = 30;
let timerInterval = null;
let razorpayPollingController = null;
let isQrClosed = false;
let paymentSubmissionPromise = null;
let isRazorpayPaymentActive = false;
const RAZORPAY_PAYMENT_TIMEOUT_MS = 5 * 60 * 1000;

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
    const chosen = localStorage.getItem("orderType") || "";
    document.querySelectorAll(".eating-how-btn").forEach((button) => {
        button.setAttribute("aria-pressed", button.getAttribute("data-order-type") === chosen ? "true" : "false");
    });
    const box = document.getElementById("eating-how");
    if (box && chosen) box.removeAttribute("data-missing");
}

function presetOrderType() {
    if (localStorage.getItem("orderType")) return;
    try {
        const point = window.KioskServicePoint && KioskServicePoint.read ? KioskServicePoint.read() : null;
        if (point && (point.table || point.venue)) localStorage.setItem("orderType", "DINE IN");
    } catch (e) {
        /* no service point on this page is not an error */
    }
}

function ensureOrderType() {
    if (localStorage.getItem("orderType")) return true;
    const box = document.getElementById("eating-how");
    if (box) {
        box.setAttribute("data-missing", "true");
        if (typeof box.scrollIntoView === "function") box.scrollIntoView({ block: "center" });
    }
    if (typeof showAlert === "function") showAlert("Choose dine in or take away first.");
    return false;
}

document.addEventListener("click", (event) => {
    const button = event.target && event.target.closest ? event.target.closest(".eating-how-btn") : null;
    if (!button) return;
    localStorage.setItem("orderType", button.getAttribute("data-order-type"));
    paintOrderType();
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

function maskMobileNumber(number) {
    const len = number.length;
    if (len === 0) return "Enter Mobile Number";
    if (len <= 2) return number;
    if (len <= 4) return number.substring(0, 2) + 'X'.repeat(len - 2);
    if (len <= 6) return number.substring(0, 2) + 'XX' + number.substring(4, len);
    if (len <= 9) return number.substring(0, 2) + 'XX' + number.substring(4, 6) + 'X'.repeat(len - 6);
    if (len === 10) return number.substring(0, 2) + 'XX' + number.substring(4, 6) + 'XXX' + number.substring(9);
    return number;
}

function addNumber(num) {
    if (enteredNumber.length < 10) {
        enteredNumber += num;
        $("#mobile-number").text(maskMobileNumber(enteredNumber));
        $("#mobile-fullnumber").val(enteredNumber);
    }
    validateNumber();
}

function deleteNumber() {
    enteredNumber = enteredNumber.slice(0, -1);
    $("#mobile-number").text(maskMobileNumber(enteredNumber));
    $("#mobile-fullnumber").val(enteredNumber);
    validateNumber();
}

function clearNumber() {
    enteredNumber = "";
    $("#mobile-number").text("Enter Mobile Number");
    $("#mobile-fullnumber").val("");
    $("#proceed-btn").prop("disabled", true);
    sessionStorage.removeItem("kiosk_mobile_number");
}

function validateNumber() {
    const paymentBusy = Boolean(paymentSubmissionPromise) || isRazorpayPaymentActive;
    $("#proceed-btn").prop("disabled", paymentBusy || !/^[6-9]\d{9}$/.test(enteredNumber));
}

async function submitRazorPayMobile() {
    if (!ensureOrderType()) return;
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
        const branches = await getData(BRANCH_STORE);
        const branchId = branches[0]?.id;
        const productsRefreshed = await fetchAndStoreBranch(branchId, false);
        if (!productsRefreshed) throw new Error("Could not refresh branch data before payment.");
        if (!/^[6-9]\d{9}$/.test(enteredNumber)) {
            alert("Please enter a valid 10-digit mobile number starting with 6-9.");
            return;
        }
        sessionStorage.setItem("kiosk_mobile_number", enteredNumber);

        const kioskPayment = await getLatestKioskPayment(branchId);
        const totalAmount = await calculateCartTotal();

        console.log("Kiosk payment config", {
            kioskPayment,
            razorpayEnabled: isRazorpayEnabled(kioskPayment),
            cashEnabled: isCashEnabled(kioskPayment)
        });

        if (isRazorpayEnabled(kioskPayment)) {
            const paymentStarted = await createRazorPayMobile(totalAmount, branchId, enteredNumber);
            if (!paymentStarted) throw new Error("Razorpay payment could not be started.");
        } else if (isCashEnabled(kioskPayment)) {
            await checkout("", "Cash");
        } else {
            alert("No supported payment method configured.");
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
            "color": "#3399cc"
        },
        "prefill": {
            "contact": enteredNumber,  // Replace with actual contact if available 
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
        alert(error.message || "Payment request failed. Please try again.");
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
    $("#mobile-number").text("Enter Mobile Number");
    $("#mobile-fullnumber").val("");
    validateNumber();
});

function showAlert(message) {
    const alertText = document.getElementById("alertText");
    const alertBox = document.getElementById("alertBox");
    const backToCart = document.getElementById("backtocart-nopayment");

    if (alertText) alertText.innerText = message;
    if (alertBox) alertBox.classList.remove("d-none");
    if (backToCart) backToCart.classList.remove("d-none");
    document.body.classList.add("alert-background"); // apply alert-specific body style
}


(async () => {
    await loadEnvConfig();
    const branches = await getData(BRANCH_STORE);
    const branchId = branches[0]?.id;
    const productsRefreshed = await fetchAndStoreBranch(branchId, false);
    if (!productsRefreshed) return;
    const kioskPayment = await getLatestKioskPayment(branchId);
    const { number: phoneRequired, payment_number: paymentNumberRequired } = kioskPayment || {};
    const showPhoneInput = isEnabled(phoneRequired ?? paymentNumberRequired);
    const backBtn = document.getElementById("backtocart-nopayment");
    const mobileWrapper = document.getElementById("mobile-wrapper");
    const razorpayEnabled = isRazorpayEnabled(kioskPayment);
    const cashEnabled = isCashEnabled(kioskPayment);
    console.log("Kiosk payment config", { kioskPayment, razorpayEnabled, cashEnabled, showPhoneInput });
    if (!razorpayEnabled && !cashEnabled) {
        mobileWrapper.style.display = "none";
        showAlert("No payment methods are available. Please contact the branch.");
        if (backBtn) backBtn.style.display = "inline-block";
        return;
    }
    const totalAmount = await calculateCartTotal();
    const defaultMobile = "9494111161";
    console.log(showPhoneInput);
    if (cashEnabled && !razorpayEnabled && !showPhoneInput) {
        document.getElementById('page-loader-overlay').style.display = 'flex';
        mobileWrapper.style.display = "none";
        sessionStorage.setItem("kiosk_mobile_number", defaultMobile);
        await checkout("", "Cash");
        return;
    }
    if (!showPhoneInput) {
        console.log("No phone input required, proceeding with default mobile number.");
        document.getElementById('page-loader-overlay').style.display = 'flex';
        mobileWrapper.style.display = "none";
        sessionStorage.setItem("kiosk_mobile_number", defaultMobile);
        const paymentStarted = await createRazorPayMobile(totalAmount, branchId, defaultMobile);
        if (!paymentStarted) throw new Error("Razorpay payment could not be started.");
        return;
    }
    mobileWrapper.style.display = "inline-block";
})().catch(error => {
    console.error("Payment page initialization failed:", error);
    showAppErrorScreen(
        "Payment page could not be loaded",
        error.message || "Please check the connection and try again.",
        async () => window.location.reload(),
        { buttonLabel: "Retry" }
    );
});
