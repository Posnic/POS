/*
 * Your orders, on this phone.
 *
 * Owner: "also order history page not exist ... keep the history in the
 * browser."
 *
 * Kept in the browser, because there is nobody to keep it for: a customer
 * ordering from a QR code never signs in, has no account and leaves no
 * address behind. What this device placed, this device remembers - the
 * order's id, its token, the shop it went to and what was on it - and the
 * shop is asked where each one has got to.
 *
 * The list is what the browser kept; the STATE beside each line is what the
 * shop says right now. A row whose shop has never heard of it is dropped:
 * the sandbox is reseeded, a shop closes, a database is restored, and a list
 * that insists on orders nobody has is worse than a short list.
 */
(function () {
    "use strict";

    const el = (id) => document.getElementById(id);

    function say(key, vars) {
        if (typeof window.t === "function") return window.t(key, vars);
        return String(key).replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] != null ? String(vars[name]) : m));
    }

    function apiBase() {
        return String((window.CONFIG && window.CONFIG.API_BASE_URL) || "").replace(/\/$/, "");
    }

    /* The words for a state, in the customer's terms rather than the
       database's: nobody asks whether their dinner is "KOT". */
    function stateWords(row) {
        if (row.cancelled) return say("Cancelled");
        if (row.paid) return say("Paid");
        if (row.state === "pending") return say("Waiting for the shop");
        if (row.state === "rejected") return say("The shop could not take it");
        return say("With the kitchen");
    }

    function when(at) {
        const date = at ? new Date(at) : null;
        if (!date || isNaN(date.getTime())) return "";
        const today = new Date();
        const sameDay =
            date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();
        const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return sameDay ? time : date.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
    }

    function lineWords(items) {
        return (items || [])
            .map((line) => String(Number(line.quantity) || 0) + "× " + String(line.name || ""))
            .join(", ");
    }

    /* What the shop says about one remembered order, or null when it has
       never heard of it. */
    async function ask(kept) {
        try {
            const response = await fetch(
                apiBase() +
                    "/online-ordering/" +
                    encodeURIComponent(kept.shop) +
                    "/orders/" +
                    encodeURIComponent(kept.orderId) +
                    "?token=" +
                    encodeURIComponent(kept.token),
                { method: "GET", headers: { Accept: "application/json" } }
            );
            if (response.status === 404) return null;
            if (!response.ok) return { unknown: true };
            const body = await response.json();
            if (!body || body.type !== "success" || !body.data) return { unknown: true };
            return body.data;
        } catch (e) {
            /* Offline: what the browser kept is still worth showing. */
            return { unknown: true };
        }
    }

    function row(kept, said) {
        const item = document.createElement("li");
        item.className = "history-row";

        const head = document.createElement("div");
        head.className = "history-head";
        const shop = document.createElement("span");
        shop.className = "history-shop";
        shop.textContent = String((said && said.shop) || kept.shopName || kept.shop || "");
        const at = document.createElement("span");
        at.className = "history-when";
        at.textContent = when((said && said.placed_at) || kept.at);
        head.appendChild(shop);
        head.appendChild(at);

        const what = document.createElement("p");
        what.className = "history-what";
        what.textContent = lineWords((said && said.items && said.items.length ? said.items : kept.items) || []);

        const foot = document.createElement("div");
        foot.className = "history-foot";
        const token = document.createElement("span");
        token.className = "history-token";
        token.textContent = say("Token {token}", { token: (said && said.token) || kept.token });
        const state = document.createElement("span");
        state.className = "history-state";
        if (said && !said.unknown) {
            state.setAttribute("data-state", said.cancelled ? "cancelled" : said.paid ? "paid" : "kitchen");
            state.textContent = stateWords(said);
        } else {
            state.setAttribute("data-state", "unknown");
            state.textContent = say("Not checked");
        }
        foot.appendChild(token);
        foot.appendChild(state);

        item.appendChild(head);
        item.appendChild(what);
        item.appendChild(foot);

        /* A bill exists once the shop has taken the money, and not before. */
        if (said && said.bill_ready) {
            const bill = document.createElement("a");
            bill.className = "history-bill";
            bill.href = "thankyou.html?token=" + encodeURIComponent(said.token) + "&order=" + encodeURIComponent(kept.orderId);
            bill.textContent = say("See the bill");
            item.appendChild(bill);
        }
        return item;
    }

    /* Which paint is the current one. A second paint starting while the
       first is still asking the shop used to clear the list under it, and
       the first then tried to replace a row that was no longer there. */
    let painting = 0;

    async function paint() {
        const list = el("history-list");
        const empty = el("history-empty");
        if (!list) return;
        const mine = ++painting;
        const kept = typeof rememberedOrders === "function" ? rememberedOrders() : []; // eslint-disable-line no-undef
        list.textContent = "";
        if (!kept.length) {
            if (empty) empty.hidden = false;
            return;
        }
        if (empty) empty.hidden = true;

        /* Drawn from what the browser kept first, so the list is there at
           once; each row then says what the shop says. */
        const rows = kept.map((order) => {
            const drawn = row(order, null);
            list.appendChild(drawn);
            return { order, drawn };
        });

        for (const { order, drawn } of rows) {
            const said = await ask(order);
            /* A newer paint has taken over; this one's rows are gone. */
            if (mine !== painting) return;
            if (said === null) {
                /* The shop has never heard of it: forget it rather than
                   insist. */
                if (typeof forgetOrder === "function") forgetOrder(order.orderId); // eslint-disable-line no-undef
                drawn.remove();
                continue;
            }
            if (drawn.parentNode === list) list.replaceChild(row(order, said), drawn);
        }

        if (!list.children.length && empty) empty.hidden = false;
    }

    document.addEventListener("DOMContentLoaded", async () => {
        if (typeof loadEnvConfig === "function") await loadEnvConfig(); // eslint-disable-line no-undef
        await paint();
    });

    window.OrderHistory = { paint, stateWords, when, lineWords };
})();
