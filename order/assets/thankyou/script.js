function getSessionReceipt() {
    try {
        const storedReceipt = sessionStorage.getItem("kioskReceipt");
        return storedReceipt ? JSON.parse(storedReceipt) : null;
    } catch (error) {
        console.error("Invalid receipt data in session storage:", error);
        sessionStorage.removeItem("kioskReceipt");
        return null;
    }
}

const receiptData = getSessionReceipt();
const orderType = localStorage.getItem("orderType");

// Get the current URL parameters
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get("token");
const receiptToken = receiptData?.tokenId ?? receiptData?.token_id ?? receiptData?.token;
const hasValidReceiptAccess = Boolean(
    receiptData &&
    urlToken &&
    receiptToken &&
    String(urlToken) === String(receiptToken)
);

if (!hasValidReceiptAccess) {
    sessionStorage.removeItem("kioskReceipt");
    localStorage.removeItem("kioskReceipt"); // Remove data left by older versions.
    window.location.replace("access-denied.html");
}

async function renderAndPrint() {
    if (!hasValidReceiptAccess || !receiptData?.items) {
        document.body.innerHTML = "<main class='access-denied'><h1>Nothing to show here</h1><p>This receipt is not from an order placed on this phone.</p><a href='products.html' class='btn-primary'>See the menu</a></main>";
        return;
    }

    const token = String(receiptToken || receiptData.tokenId || "000");

    // ✅ Prevent re-downloading for same token
    const printedFlagKey = `printed_${token}`;
    if (sessionStorage.getItem(printedFlagKey) === "true") {
        console.log("🛑 PDF already downloaded for token:", token);
        return;
    }

    const formatted = new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    /*
     * One short bell, once per order.
     *
     * This is the other way an order gets placed - tapped through the basket
     * rather than spoken - and it confirms itself the same way the assistant
     * does. Keyed to the token, so a refresh or a customer coming back later
     * to look at their number does not ring it again.
     */
    (function ting() {
        try {
            const rung = `rung_${token}`;
            if (sessionStorage.getItem(rung) === "true") return;
            sessionStorage.setItem(rung, "true");
            if (window.Ting && typeof window.Ting.play === "function") window.Ting.play();
        } catch (e) {
            /* The screen says the same thing; the sound is a courtesy. */
        }
    })();

    /*
     * What happens next, in the customer's terms: to the table, at the
     * counter, from the shop, or on its way; and what is still owed if the
     * order was not paid here.
     */
    (function sayWhatHappensNext() {
        const fulfilment = localStorage.getItem("order_fulfilment") || (orderType === "DINE IN" ? "dine_in" : "");
        const table = localStorage.getItem("order_table") || (receiptData.table_number || "");
        const lead = document.getElementById("done-lead");
        const pay = document.getElementById("done-pay");
        let text = t("The kitchen has it. Show this at the counter.");
        if (fulfilment === "dine_in") text = table ? t("The kitchen has it. We'll bring it to table {table}.", { table }) : t("The kitchen has it. We'll bring it to your table.");
        else if (fulfilment === "takeaway") text = t("The kitchen has it. Collect it at the counter when your token is called.");
        else if (fulfilment === "pickup") text = t("Your order is in. Collect it from the shop when it's ready.");
        else if (fulfilment === "delivery") text = t("Your order is in. It's on its way as soon as it's ready.");
        if (lead) lead.textContent = text;
        if (pay && localStorage.getItem("order_pay") === "offline" && receiptData.total != null) {
            const amount = "\u20b9" + Number(receiptData.total).toFixed(2).replace(/\.00$/, "");
            pay.textContent = fulfilment === "delivery"
                ? t("Pay {amount} on delivery.", { amount })
                : (fulfilment === "pickup" || fulfilment === "takeaway")
                    ? t("Pay {amount} when you collect it.", { amount })
                    : t("Pay {amount} at the counter.", { amount });
            pay.hidden = false;
        }
    })();

    $("#branch-name").text(receiptData.branch_name || "POS");
    $("#orderDate").text(formatted);
    $("#orderTime").text(formatted);
    $("#token-id").text(token);
    $("#tokenId").text(token);
    $("#paymentTypePrint").text(receiptData.payment_status || receiptData.paymentStatus || "Cash");

    const itemsContainer = document.getElementById("items");

    itemsContainer.innerHTML = `
        <div class="item header-row">        
            <div class="item-name">Item Name</div>
            <div class="item-qty">Qty</div>
            <div class="item-amt">Amount</div>
        </div>
    `;

    receiptData.items.forEach(item => {
        const row = document.createElement("div");
        row.className = "item";

        const qty = item.item_quantity || 1;
        const totalTax = item.item_tax || 0;

        let discount = 0;
        if (item.item_discount && item.item_discount > 0) {
            discount = item.item_discount;
        } else if (item.item_discount_percentage && item.item_discount_percentage > 0) {
            discount = item.item_discount_percentage;
        }

        const itemTax = totalTax / qty;
        const itemDisc = discount / qty;
        const totalLine = `₹${item.item_total.toFixed(2)}`;

        const subInfoParts = [];
        subInfoParts.push(`₹${item.item_base_price.toFixed(2)}`);
        if (itemTax > 0) subInfoParts.push(`₹${itemTax.toFixed(2)} tax`);
        if (itemDisc > 0) subInfoParts.push(`-₹${itemDisc.toFixed(2)} disc`);

        const itemName = document.createElement("div");
        itemName.className = "item-name";
        itemName.appendChild(document.createTextNode(String(item.item_name ?? "Unknown")));

        if (subInfoParts.length) {
            const subInfo = document.createElement("div");
            subInfo.className = "sub-info";
            subInfo.textContent = subInfoParts.join(" | ");
            itemName.appendChild(subInfo);
        }

        const itemQuantity = document.createElement("div");
        itemQuantity.className = "item-qty";
        itemQuantity.textContent = String(qty);

        const itemAmount = document.createElement("div");
        itemAmount.className = "item-amt";
        itemAmount.textContent = totalLine;

        row.append(itemName, itemQuantity, itemAmount);
        itemsContainer.appendChild(row);
    });

    $("#subtotal").text(`₹${receiptData.subtotal.toFixed(2)}`);
    $("#discount").text(`-₹${receiptData.discount.toFixed(2)}`);
    $("#tax").text(`₹${receiptData.tax.toFixed(2)}`);
    /* The fee for the way it travelled, when there was one. */
    if (Number(receiptData.delivery_fee) > 0) {
        const how = String(receiptData.fulfilment || localStorage.getItem("order_fulfilment") || "");
        $("#fee-label").text(how === "delivery" ? "Delivery" : how === "dine_in" ? "Service" : "Packing");
        $("#fee").text(`₹${Number(receiptData.delivery_fee).toFixed(2)}`);
        $("#fee-row").prop("hidden", false);
    }
    $("#total").text(`₹${receiptData.total.toFixed(2)}`);
    $("#orderTypePrint").text(orderType);

    /*
     * NOTHING IS DOWNLOADED HERE.
     *
     * This page used to push a PDF at the phone a second after it opened.
     * Owner: "after order no need to show bill or pdf not required. once
     * payment done from desktop then make bill available to download." A bill
     * is a record of money that has changed hands, and at this moment none
     * has: the order is a ticket in a kitchen. The shop marks it paid at the
     * till, and the bill is offered then.
     *
     * generatePdfFromHtmlFile stays, and is what that button will call.
     */
    void printedFlagKey;

    /*
     * And then the page watches the order.
     *
     * Where it has got to, and whether the shop has marked it paid - which is
     * what puts a bill behind it. Asked as the page opens and again while
     * somebody is looking at it, because the till is where those change and
     * nothing tells this page when they do. A shop that cannot be reached, or
     * an order it has never heard of, simply leaves the page as it is.
     */
    watchTheOrder(token);
}


/* What the shop takes, as the storefront describes it. */
async function getLatestShopPayment(shopId) {
    try {
        const response = await fetch(
            `${CONFIG.API_BASE_URL}/online-ordering/${encodeURIComponent(shopId)}`,
            { method: "GET", headers: { Accept: "application/json" } }
        );
        if (!response.ok) return null;
        const body = await response.json();
        return (body && body.data && body.data.payment) || null;
    } catch (e) {
        return null;
    }
}

/*
 * The UPI links for one order.
 *
 * pa is who is paid, pn the name their app shows, am the amount, tn what it
 * is for. The generic upi: scheme opens the phone's chooser, which is every
 * UPI app it has; the named ones are for phones that do not offer one.
 *
 * Everything is encoded: a shop name with an ampersand in it would otherwise
 * end the amount early, and a customer would be shown the wrong number to
 * pay - which is the one bug this must not have.
 */
function upiLinks({ upiId, upiName, amount, token, orderId }) {
    const money = Number(amount || 0).toFixed(2);
    const fields =
        "pa=" + encodeURIComponent(upiId) +
        "&pn=" + encodeURIComponent(upiName || "") +
        "&am=" + encodeURIComponent(money) +
        "&cu=INR" +
        "&tn=" + encodeURIComponent(t("Order {token}", { token: token })) +
        (orderId ? "&tr=" + encodeURIComponent(String(orderId).slice(0, 35)) : "");
    return {
        any: "upi://pay?" + fields,
        gpay: "tez://upi/pay?" + fields,
        phonepe: "phonepe://pay?" + fields,
        paytm: "paytmmp://pay?" + fields,
        amount: money
    };
}

/* The money a customer still owes, offered to their own app. */
function offerUpi(said, shopPayment, token, orderId) {
    const box = document.getElementById("pay-upi");
    if (!box) return;
    const upiId = String((shopPayment && shopPayment.upi_id) || "");
    /* Nothing owed, nothing to pay, or nowhere to send it. */
    if (!upiId || !said || said.paid || said.cancelled || !(Number(said.total) > 0)) return;
    const links = upiLinks({
        upiId,
        upiName: String((shopPayment && shopPayment.upi_name) || said.shop || ""),
        amount: said.total,
        token,
        orderId
    });
    const amount = document.getElementById("pay-upi-amount");
    if (amount) {
        amount.textContent = t("Pay {amount} to {who}", {
            amount: "\u20b9" + links.amount.replace(/\.00$/, ""),
            who: String((shopPayment && shopPayment.upi_name) || said.shop || "")
        });
    }
    const where = { "pay-upi-any": links.any, "pay-upi-gpay": links.gpay, "pay-upi-phonepe": links.phonepe, "pay-upi-paytm": links.paytm };
    Object.keys(where).forEach((id) => {
        const link = document.getElementById(id);
        if (link) link.href = where[id];
    });
    box.hidden = false;
}

/*
 * WATCHING ONE ORDER, from the phone that placed it.
 *
 * Stage 5 of the print roadmap - "the customer knows". The page used to ask
 * the shop one question, once, as it opened: is this paid yet. Everything
 * that happens to an order in the twenty minutes after that - a person
 * accepting it, a ticket coming out of a kitchen printer, the shop refusing
 * it at 2am - happened behind the customer's back, and the only way to find
 * out was to walk to the counter and ask.
 *
 * WHAT IS DRAWN, and what is deliberately not. The server answers with a
 * TRAIL: what has already happened, each with the moment it happened. There
 * is no ladder of greyed-out future steps, because the steps after "in the
 * kitchen" are not ours to promise - nothing marks an order ready, and a
 * shop whose kitchen printer is off never reports a ticket at all. A ladder
 * would draw three rungs and stop on the first, which reads as "stuck" to a
 * customer whose food is being cooked. See api/src/utils/order-progress.js.
 *
 * HOW OFTEN IT ASKS. Insistently for the first two minutes, then slower, and
 * NOTHING AT ALL while the phone is in a pocket: a screen nobody is looking
 * at has nothing to redraw, and a full restaurant of phones polling from a
 * table would be the entire cost of this feature. It asks once more the
 * moment the customer looks again, which is exactly when the answer matters.
 *
 * It stops for good when nothing further can happen - refused, cancelled, or
 * the money is in - and after half an hour regardless.
 */
const ASK_FAST_MS = 15000;
const ASK_SLOWER_MS = 30000;
const ASK_SLOW_MS = 60000;
const ASKS_BEFORE_SLOWER = 8;
const ASKS_BEFORE_SLOW = 16;
const MOST_ASKS = 40;

/* The words for each step, in the customer's terms. The server sends keys
   and times only, so that these can go through the dictionary like every
   other sentence on the page - see assets/i18n.js. */
const STEP_WORDS = {
    placed: "Placed",
    accepted: "The shop has it",
    in_the_kitchen: "In the kitchen",
    refused: "The shop could not take it",
    cancelled: "Cancelled"
};
const STEP_ENDED = ["refused", "cancelled"];

/* Read at most once each: the shop's payment details do not change while a
   customer waits, and a button wired twice downloads twice. */
let shopPaymentRead = null;
let billWired = false;

function askPace(asks) {
    if (asks < ASKS_BEFORE_SLOWER) return ASK_FAST_MS;
    if (asks < ASKS_BEFORE_SLOW) return ASK_SLOWER_MS;
    return ASK_SLOW_MS;
}

/*
 * Do this later, and only while somebody is looking.
 *
 * A phone locked in a pocket redraws nothing, so asking would spend the
 * shop's request budget on an answer no one reads. The wait resumes the
 * instant the screen comes back.
 */
function laterWhenLooking(fn, ms) {
    setTimeout(function () {
        if (!document.hidden) return fn();
        const onBack = function () {
            if (document.hidden) return;
            document.removeEventListener("visibilitychange", onBack);
            fn();
        };
        document.addEventListener("visibilitychange", onBack);
    }, ms);
}

function clockOf(at) {
    const date = at ? new Date(at) : null;
    if (!date || isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* What has happened to this order, as a trail. Nothing about what has not. */
function drawProgress(said) {
    const box = document.getElementById("progress");
    const list = document.getElementById("progress-trail");
    const next = document.getElementById("progress-next");
    const progress = said && said.progress;
    if (!box || !list || !progress || !Array.isArray(progress.trail) || !progress.trail.length) return;

    list.textContent = "";
    progress.trail.forEach(function (entry) {
        const word = STEP_WORDS[entry && entry.step];
        /* A step from a newer server than this page: left out rather than
           printed raw. Silence reads as nothing new; `in_the_oven` reads as
           a bug. */
        if (!word) return;
        const row = document.createElement("li");
        const what = document.createElement("span");
        what.className = "progress-what";
        what.textContent = t(word);
        row.appendChild(what);
        const at = clockOf(entry.at);
        if (at) {
            const when = document.createElement("span");
            when.className = "progress-at";
            when.textContent = at;
            row.appendChild(when);
        }
        list.appendChild(row);
    });
    if (!list.childElementCount) return;

    const ended = STEP_ENDED.indexOf(progress.step) !== -1;
    box.classList.toggle("progress-ended", ended);
    box.hidden = false;

    /*
     * The only thing named before it happens, and only because the shop has
     * to answer: an order held for approval moves to accepted or refused,
     * and nothing else. The minutes are the shop's own recent history, worded
     * as a description of the past rather than a promise about this order.
     */
    if (next) {
        if (progress.waiting_for === "acceptance") {
            const minutes = Number(said.typically_accepted_in_minutes) || 0;
            next.textContent = minutes
                ? t("Waiting for the shop to accept it. Most orders here are accepted in about {minutes} minutes.", { minutes: minutes })
                : t("Waiting for the shop to accept it.");
            next.hidden = false;
        } else {
            next.hidden = true;
        }
    }

    /* One line saying it twice is one line too many. */
    const placedLine = document.querySelector(".order-time");
    if (placedLine) placedLine.hidden = true;

    /*
     * A refusal must not sit under a green tick and the words "Order placed".
     * Nothing else is rewritten: what the page said about the table or the
     * counter is still true.
     */
    if (ended) {
        const mark = document.querySelector(".done-mark");
        if (mark) mark.hidden = true;
        const title = document.getElementById("done-title");
        if (title) title.textContent = t(STEP_WORDS[progress.step]);
        const lead = document.getElementById("done-lead");
        if (lead) {
            lead.textContent = progress.step === "refused"
                ? t("Nothing has been charged. Ask at the counter if you would like to know why.")
                : t("Nothing has been charged.");
        }
        const pay = document.getElementById("pay-upi");
        if (pay) pay.hidden = true;
        const owed = document.getElementById("done-pay");
        if (owed) owed.hidden = true;
    }
}

/* Unpaid: offer to pay it. Paid: offer the bill. Never both. */
async function offerMoneyOrBill(said, token, orderId, shopId) {
    const button = document.getElementById("done-bill");
    if (!button || !said) return;
    if (said.progress && STEP_ENDED.indexOf(said.progress.step) !== -1) return;

    if (!said.bill_ready) {
        if (shopPaymentRead === null) {
            try {
                shopPaymentRead = (await getLatestShopPayment(shopId)) || {};
            } catch (e) {
                shopPaymentRead = {};
            }
        }
        offerUpi(said, shopPaymentRead, token, orderId);
        return;
    }
    if (billWired) return;
    billWired = true;
    button.hidden = false;
    button.addEventListener("click", async () => {
        button.disabled = true;
        try {
            await generatePdfFromHtmlFile();
        } catch (error) {
            console.error("Receipt PDF generation failed:", error);
            alert(error.message || t("Receipt PDF could not be generated."));
        } finally {
            button.disabled = false;
        }
    });
}

/*
 * WHICH ORDER, AND AT WHICH SHOP - and why this is not the obvious two lines.
 *
 * It used to read `rememberedOrders()` and `knownBranchId()`, which live in
 * indexedDB.js. THIS PAGE HAS NEVER LOADED indexedDB.js. Both calls were
 * written behind `typeof ... === "function"` guards, so neither threw: the
 * shop id came out empty, the function returned before its first request, and
 * everything behind it - the bill when the shop marks the order paid, the
 * offer to pay by UPI - has silently done nothing on this page since the day
 * it was written. A guard that turns a missing dependency into a quiet
 * nothing is how a shipped feature runs for months without ever running once.
 *
 * Loading indexedDB.js here is not the fix: it starts a timer that re-fetches
 * the shop's whole menu every ten seconds, which is a lot to ask of a phone
 * that is only showing a token.
 *
 * So this page answers from what it already holds:
 *   the order   ?order= on the way in from the history page, or the sale id
 *               on the receipt this phone was handed at checkout
 *   the shop    posnic_store, which indexedDB.js writes on every menu load,
 *               so it is there for anybody who reached this page by ordering
 *
 * STORE_ADDRESS_KEY in indexedDB.js is the same key; tests/online-ordering-ux
 * pins the two spellings together, because a rename on one side would put
 * this page back exactly where it was.
 */
const STORE_ADDRESS_KEY = "posnic_store";

function whichOrder() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order") || String((receiptData && receiptData.sale_id) || "");
    let shopId = "";
    try {
        shopId = localStorage.getItem(STORE_ADDRESS_KEY) || "";
    } catch (e) {
        /* A browser that keeps nothing. The page still shows the token, which
           is the thing the customer carries to the counter. */
    }
    return { orderId: String(orderId || "").trim(), shopId: String(shopId || "").trim() };
}

async function watchTheOrder(token) {
    const { orderId, shopId } = whichOrder();
    if (!orderId || !shopId) return;

    let asks = 0;
    const askOnce = async function () {
        let said = null;
        try {
            const response = await fetch(
                `${CONFIG.API_BASE_URL}/online-ordering/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            if (response.ok) {
                const body = await response.json();
                if (body && body.type === "success" && body.data) said = body.data;
            }
        } catch (error) {
            /* Offline, or a shop that cannot be reached. The page keeps what
               it is already showing and tries again, which is the whole
               reason this is a loop rather than one question. */
        }

        if (said) {
            drawProgress(said);
            await offerMoneyOrBill(said, token, orderId, shopId);
            /* Nothing further can happen to it, so nothing further is asked. */
            if (said.paid || (said.progress && said.progress.settled)) return;
        }

        asks += 1;
        if (asks >= MOST_ASKS) return;
        laterWhenLooking(askOnce, askPace(asks));
    };

    askOnce();
}

async function generatePdfFromHtmlFile() {

    // 1. Fetch the HTML file content
    const response = await fetch('receipt.html');
    if (!response.ok) {
        throw new Error(`Receipt template failed to load (${response.status} ${response.statusText}).`);
    }
    const htmlContent = await response.text();

    const parser = new DOMParser();
    const externalDoc = parser.parseFromString(htmlContent, 'text/html');
    const $externalDoc = $(externalDoc);

    // Use jQuery to find and update the elements
    $externalDoc.find('#branchName').text(receiptData.branch_name);
    $externalDoc.find('#orderToken').text(receiptData.tokenId);
    $externalDoc.find('#orderDate').text(new Date().toLocaleString());
    $externalDoc.find('#orderTypePrint').text(orderType);
    $externalDoc.find('#subtotal').text("₹" + receiptData.subtotal.toFixed(2));
    $externalDoc.find('#discount').text("-₹" + receiptData.discount.toFixed(2));
    $externalDoc.find('#tax').text("₹" + receiptData.tax.toFixed(2));
    $externalDoc.find('#total').text("₹" + receiptData.total.toFixed(2));

    const $itemsBody = $externalDoc.find('#items-body');

    // Add item rows
    receiptData.items.forEach(item => {
        const totalTax = item.item_tax || 0;
        let discount = 0;
        if (item.item_discount && item.item_discount > 0) {
            discount = item.item_discount;
        } else if (item.item_discount_percentage && item.item_discount_percentage > 0) {
            discount = item.item_discount_percentage;
        }
        const total = item.item_total * item.item_quantity;
        const quantity = item.item_quantity || 0;
        const itemTax = totalTax / quantity;
        const itemDisc = discount / quantity;
        const $tr = $("<tr>");
        $("<td>").text(String(item.item_name ?? "Unknown")).appendTo($tr);
        $("<td>").addClass("right").text(`₹${item.item_base_price.toFixed(2)}`).appendTo($tr);
        $("<td>").addClass("right").text(`₹${itemTax.toFixed(2)}`).appendTo($tr);
        $("<td>").addClass("right").text(`-₹${itemDisc.toFixed(2)}`).appendTo($tr);
        $("<td>").addClass("right").text(String(quantity)).appendTo($tr);
        $("<td>").addClass("right").text(`₹${item.item_total.toFixed(2)}`).appendTo($tr);
        $itemsBody.append($tr);
    });

    // Total items and total quantity
    if (receiptData.items) {
        $externalDoc.find('#totalItems').text(receiptData.items.length);
        const totalQty = receiptData.items.reduce((sum, item) => sum + item.item_quantity, 0);
        $externalDoc.find('#totalQty').text(totalQty);
    }

    const updatedHtml = externalDoc.documentElement.outerHTML;

    // 2. Create a temporary element to hold the content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = updatedHtml;
    // tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);

    // 3. PDF options
    const opt = {
        margin: 10,
        filename: 'receipt.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    // 4. Generate and download PDF
    if (typeof html2pdf !== "function") {
        throw new Error(t("The receipt could not be saved on this device. Ask at the counter for a printed copy."));
    }
    await html2pdf().set(opt).from(tempDiv).save();

    // ✅ Step 1: Set the printed flag
    sessionStorage.setItem("kioskReceiptPrinted", "true");

    // 5. Clean up
    document.body.removeChild(tempDiv);
}

if (hasValidReceiptAccess) {
    document.addEventListener("DOMContentLoaded", renderAndPrint);
}
function clearReceiptAndGo(url) {
    if (receiptToken) sessionStorage.removeItem(`printed_${String(receiptToken)}`);
    sessionStorage.removeItem("kioskReceiptPrinted");
    sessionStorage.removeItem("kioskReceipt");
    sessionStorage.removeItem("kiosk_mobile_number");
    sessionStorage.removeItem("qr_id");
    ["order_fulfilment", "order_table", "order_pay", "order_customer_name", "order_customer_address", "note"].forEach((key) =>
        localStorage.removeItem(key)
    );
    localStorage.removeItem("kioskReceipt"); // Remove data left by older versions.
    localStorage.removeItem("kiosk_mobile_number");
    localStorage.removeItem("qr_id");
    window.location.href = url;
}
