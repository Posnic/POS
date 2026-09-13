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

    /*
     * What the shop says about EVERY order this phone is holding, in one
     * request.
     *
     * It used to be one request per row against a limiter of ten a minute,
     * so a customer with a few orders behind them saw "Not checked" on most
     * of the page and could not open any of those rows. Answers come back
     * keyed by order id; an order the shop cannot place - reseeded sandbox,
     * restored database, a shop that closed - is simply absent, and the row
     * is forgotten rather than insisted upon.
     *
     * Returns null when the SHOP could not be reached at all, which is a
     * different thing from an order it has never heard of and is said once
     * for the page rather than on every row.
     */
    async function askAll(kept) {
        const shop = (kept[0] && kept[0].shop) || "";
        if (!shop) return null;
        try {
            const response = await fetch(
                apiBase() + "/online-ordering/" + encodeURIComponent(shop) + "/orders/lookup",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({
                        orders: kept.map((row) => ({ orderId: row.orderId, token: row.token }))
                    })
                }
            );
            if (!response.ok) return null;
            const body = await response.json();
            if (!body || body.type !== "success" || !body.data) return null;
            const byId = new Map();
            (body.data.orders || []).forEach((order) => byId.set(String(order.order_id), order));
            return byId;
        } catch (e) {
            /* Offline: what the browser kept is still worth showing. */
            return null;
        }
    }

    /*
     * The shop's menu, fetched once, for the row of things that go with an
     * order. The history page does not otherwise load a catalogue.
     */
    let menuCache = null;
    async function menu(shop) {
        if (menuCache) return menuCache;
        if (!shop) return [];
        try {
            const response = await fetch(apiBase() + "/online-ordering/" + encodeURIComponent(shop) + "/menu", {
                headers: { Accept: "application/json" }
            });
            if (!response.ok) return [];
            const body = await response.json();
            const groups = (body && body.data && (body.data.categories || body.data.menu)) || [];
            const flat = [];
            groups.forEach((group) => {
                (group.items || group.products || []).forEach((item) => {
                    flat.push({ ...item, category_name: item.category_name || group.name || group.category_name || "" });
                });
            });
            menuCache = flat;
            return flat;
        } catch (e) {
            return [];
        }
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

    /* Seconds left of the shop's window, or 0. */
    function secondsLeft(said) {
        if (!said || !said.can_change) return 0;
        const window = Number(said.change_seconds) || 0;
        const at = new Date(said.placed_at || 0).getTime();
        if (!window || !at) return 0;
        return Math.max(0, Math.ceil((at + window * 1000 - Date.now()) / 1000));
    }

    function money(amount) {
        const n = Number(amount) || 0;
        const text = n % 1 === 0 ? String(n) : n.toFixed(2);
        return (window.__posnicCurrency || "\u20b9") + text;
    }

    /*
     * What is on the order, and what may still be done about it.
     *
     * The plus and minus are the whole point of the window: a customer who
     * hears themselves say one and meant two should not have to find a
     * person. Once the window closes they disappear and the Cancel button
     * changes its words - it asks the shop instead of doing it.
     */
    /*
     * Whether a change may still be ASKED for, past the window.
     *
     * Not for one already cancelled, already paid, or with a request already
     * sitting in the shop's queue - asking twice for the same order is how a
     * till ends up with two answers to give.
     */
    function mayAskNow(said) {
        return Boolean(said && !said.cancelled && !said.paid && !said.change_requested);
    }

    function details(kept, said) {
        const box = document.createElement("div");
        box.className = "history-details";
        box.id = "details-" + kept.orderId;

        const lines = document.createElement("ul");
        lines.className = "history-lines";
        ((said && said.items) || kept.items || []).forEach((line) => {
            const row = document.createElement("li");
            const qty = document.createElement("span");
            qty.className = "history-line-qty";
            qty.textContent = String(Number(line.quantity) || 0) + "×";
            const name = document.createElement("span");
            name.className = "history-line-name";
            name.textContent = String(line.name || "");
            row.appendChild(qty);
            row.appendChild(name);
            if (line.note) {
                const note = document.createElement("small");
                note.className = "history-line-note";
                note.textContent = String(line.note);
                row.appendChild(note);
            }
            if (Number(line.total) > 0) {
                const cost = document.createElement("span");
                cost.className = "history-line-cost";
                cost.textContent = money(line.total);
                row.appendChild(cost);
            }
            /*
             * The plus and the minus STAY past the window; they stop doing
             * and start asking.
             *
             * Owner: "why order history dont have any option to other than
             * cancel? coz of time?" It was the time - and taking the controls
             * away left somebody whose wish is one more naan being offered
             * nothing but Cancel. Cancelling past the window was already
             * allowed to become a request the shop answers, so there is no
             * reason changing should not be.
             */
            if (said && (said.can_change || mayAskNow(said)) && line.item_id) {
                [["-1", "\u2212"], ["1", "+"]].forEach(([by, glyph]) => {
                    const step = document.createElement("button");
                    step.type = "button";
                    step.className = "history-step";
                    step.setAttribute("data-order", kept.orderId);
                    step.setAttribute("data-item", String(line.item_id));
                    step.setAttribute("data-quantity", String(Math.max(0, (Number(line.quantity) || 0) + Number(by))));
                    if (!said.can_change) {
                        /* Marked, so a tap is never a surprise: this one goes
                           to the shop to be answered rather than straight
                           through to the kitchen. */
                        step.setAttribute("data-asks", "yes");
                        step.setAttribute(
                            "aria-label",
                            say(by === "1" ? "Ask for one more {name}" : "Ask for one less {name}", { name: line.name })
                        );
                    }
                    step.textContent = glyph;
                    row.appendChild(step);
                });
            }
            lines.appendChild(row);
        });
        box.appendChild(lines);

        if (Number((said && said.total) || kept.total) > 0) {
            const total = document.createElement("p");
            total.className = "history-total";
            total.textContent = say("Total {amount}", { amount: money((said && said.total) || kept.total) });
            box.appendChild(total);
        }

        /* The window, counted down, and the way out of the order. */
        const foot = document.createElement("div");
        foot.className = "history-actions";
        const left = secondsLeft(said);
        if (said && said.can_change) {
            const clock = document.createElement("span");
            clock.className = "history-clock";
            clock.setAttribute("data-order", kept.orderId);
            clock.textContent = say("{n}s to change it", { n: left });
            foot.appendChild(clock);
        } else if (said && said.cancel_requested) {
            const asked = document.createElement("span");
            asked.className = "history-asked";
            asked.textContent = say("The shop has your cancellation request");
            foot.appendChild(asked);
        } else if (said && said.change_requested) {
            /* Asked and waiting. The buttons are gone above, so this is the
               only thing that explains why. */
            const asked = document.createElement("span");
            asked.className = "history-asked";
            asked.textContent = say("The shop has your change request");
            foot.appendChild(asked);
        } else if (said && !said.cancelled && !said.paid) {
            /* Past the window: say what the buttons will now do, before
               somebody presses one. */
            const asks = document.createElement("span");
            asks.className = "history-asks";
            asks.textContent = say("Changes now go to the shop to approve");
            foot.appendChild(asks);
        }
        if (said && !said.cancelled && !said.paid) {
            const off = document.createElement("button");
            off.type = "button";
            off.className = "history-cancel";
            off.setAttribute("data-order", kept.orderId);
            off.textContent = said.can_change ? say("Cancel the order") : say("Ask the shop to cancel");
            if (said.cancel_requested) off.disabled = true;
            foot.appendChild(off);
        }
        /*
         * Something that was never on the order.
         *
         * The plus and minus only move what is already there; the owner asked
         * for "add new item ... need to be there". Filled in after the menu
         * arrives, so the panel opens at once and does not wait on a fetch.
         */
        if (said && (said.can_change || mayAskNow(said))) {
            const more = document.createElement("div");
            more.className = "history-more";
            more.hidden = true;
            const title = document.createElement("h4");
            title.className = "history-more-title";
            title.textContent = say("Anything else?");
            const row = document.createElement("div");
            row.className = "history-more-row";
            row.setAttribute("data-order", kept.orderId);
            if (!said.can_change) row.setAttribute("data-asks", "yes");
            more.appendChild(title);
            more.appendChild(row);
            box.appendChild(more);
            paintMore(row, said, kept);
        }

        if (foot.children.length) box.appendChild(foot);
        return box;
    }

    /** The suggestions, once the menu has arrived. */
    async function paintMore(row, said, kept) {
        const catalogue = await menu(kept.shop);
        if (!row.isConnected) return;
        const chooser = typeof goesWithOrder === "function" ? goesWithOrder : null; // eslint-disable-line no-undef
        const suggestions = chooser ? chooser(said.items || [], catalogue) : [];
        row.textContent = "";
        suggestions.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-more-item";
            button.setAttribute("data-order", kept.orderId);
            button.setAttribute("data-add", String(item.id));
            button.setAttribute("aria-label", say("Add {name}", { name: item.name }));
            const plus = document.createElement("span");
            plus.className = "history-more-plus";
            plus.setAttribute("aria-hidden", "true");
            plus.textContent = "+";
            const name = document.createElement("span");
            name.textContent = String(item.name || "");
            button.appendChild(plus);
            button.appendChild(name);
            row.appendChild(button);
        });
        const more = row.parentNode;
        if (more) more.hidden = !suggestions.length;
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
        /*
         * The state, or nothing.
         *
         * Owner: "both order status saying as not checked. don show that not
         * checked and all." It said that whenever the shop had not answered
         * YET - which, once the page ran into the rate limiter, was most
         * rows. A row that has not been answered simply carries no label;
         * the one at the top of the page says when the shop is unreachable.
         */
        if (said && !said.unknown) {
            state.setAttribute("data-state", said.cancelled ? "cancelled" : said.paid ? "paid" : "kitchen");
            state.textContent = stateWords(said);
        } else {
            state.hidden = true;
        }
        foot.appendChild(token);
        foot.appendChild(state);

        const open = document.createElement("button");
        open.type = "button";
        open.className = "history-open";
        open.setAttribute("data-order", kept.orderId);
        open.setAttribute("aria-expanded", "false");
        open.setAttribute("aria-controls", "details-" + kept.orderId);
        open.appendChild(head);
        open.appendChild(what);
        open.appendChild(foot);

        item.appendChild(open);
        if (said && !said.unknown) {
            const panel = details(kept, said);
            panel.hidden = true;
            item.appendChild(panel);
        }

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
           once; the shop is then asked about all of them together. */
        const rows = kept.map((order) => {
            const drawn = row(order, null);
            list.appendChild(drawn);
            return { order, drawn };
        });

        const said = await askAll(kept);
        /* A newer paint has taken over; this one's rows are gone. */
        if (mine !== painting) return;

        /*
         * The shop could not be reached at all. Said ONCE, at the top, rather
         * than stamped on every row: a customer whose train went into a
         * tunnel has not got twelve unknown orders, they have no signal.
         */
        const offline = el("history-offline");
        if (offline) offline.hidden = said !== null;
        if (said === null) return;

        for (const { order, drawn } of rows) {
            const one = said.get(String(order.orderId));
            if (!one) {
                /* The shop has never heard of it: forget it rather than
                   insist. */
                if (typeof forgetOrder === "function") forgetOrder(order.orderId); // eslint-disable-line no-undef
                drawn.remove();
                continue;
            }
            if (drawn.parentNode === list) list.replaceChild(row(order, one), drawn);
        }

        if (!list.children.length && empty) empty.hidden = false;
    }

    /* One open row at a time, and the seconds ticking while it is open. */
    let ticking = 0;

    function tick() {
        const clocks = [...document.querySelectorAll(".history-clock")];
        if (!clocks.length) {
            clearInterval(ticking);
            ticking = 0;
            return;
        }
        clocks.forEach((clock) => {
            const left = Number(clock.getAttribute("data-left") || 0) - 1;
            clock.setAttribute("data-left", String(Math.max(0, left)));
            if (left <= 0) {
                /* The window has closed under them: say so and take the
                   buttons away rather than let a tap fail. */
                paint();
                return;
            }
            clock.textContent = say("{n}s to change it", { n: left });
        });
    }

    function startTicking() {
        const clocks = [...document.querySelectorAll(".history-clock")];
        clocks.forEach((clock) => {
            const said = (clock.textContent.match(/\d+/) || ["0"])[0];
            clock.setAttribute("data-left", said);
        });
        if (!ticking && clocks.length) ticking = setInterval(tick, 1000);
    }

    /** Tell the shop, then draw whatever it now says. */
    async function actOn(kept, what, body) {
        try {
            const response = await fetch(
                apiBase() +
                    "/online-ordering/" +
                    encodeURIComponent(kept.shop) +
                    "/orders/" +
                    encodeURIComponent(kept.orderId) +
                    "/" +
                    what,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(Object.assign({ token: kept.token }, body || {}))
                }
            );
            const answer = await response.json().catch(() => null);
            return answer && answer.type === "success" ? answer.data || {} : null;
        } catch (e) {
            return null;
        }
    }

    function keptFor(orderId) {
        const list = typeof rememberedOrders === "function" ? rememberedOrders() : []; // eslint-disable-line no-undef
        return list.find((row) => row && String(row.orderId) === String(orderId)) || null;
    }

    document.addEventListener("click", async (event) => {
        const target = event.target;
        if (!target || !target.closest) return;

        const open = target.closest(".history-open");
        if (open) {
            const panel = document.getElementById("details-" + open.getAttribute("data-order"));
            if (!panel) return;
            const showing = panel.hidden;
            /* One at a time: a list of open orders is a list nobody reads. */
            [...document.querySelectorAll(".history-details")].forEach((other) => { other.hidden = true; });
            [...document.querySelectorAll(".history-open")].forEach((other) => other.setAttribute("aria-expanded", "false"));
            panel.hidden = !showing;
            open.setAttribute("aria-expanded", showing ? "true" : "false");
            if (showing) startTicking();
            return;
        }

        /* Something that was never on the order. */
        const add = target.closest(".history-more-item");
        if (add) {
            const kept = keptFor(add.getAttribute("data-order"));
            if (!kept) return;
            add.disabled = true;
            const answer = await actOn(kept, "items", {
                items: [{ item_id: add.getAttribute("data-add"), quantity: 1 }]
            });
            /* The shop refused it - off the menu, out of hours, too late -
               and said why. Its words, on the button's own row. */
            if (!answer) {
                add.disabled = false;
                const row = add.parentNode;
                if (row) {
                    const said = document.createElement("p");
                    said.className = "history-refused";
                    said.textContent = say("That could not be added. The shop may have started on your order.");
                    row.parentNode.appendChild(said);
                }
                return;
            }
            await paint();
            return;
        }

        const step = target.closest(".history-step");
        if (step) {
            const kept = keptFor(step.getAttribute("data-order"));
            if (!kept) return;
            step.disabled = true;
            await actOn(kept, "items", {
                items: [{ item_id: step.getAttribute("data-item"), quantity: Number(step.getAttribute("data-quantity")) || 0 }]
            });
            await paint();
            return;
        }

        const off = target.closest(".history-cancel");
        if (off) {
            const kept = keptFor(off.getAttribute("data-order"));
            if (!kept) return;
            off.disabled = true;
            await actOn(kept, "cancel", {});
            await paint();
        }
    });

    document.addEventListener("DOMContentLoaded", async () => {
        if (typeof loadEnvConfig === "function") await loadEnvConfig(); // eslint-disable-line no-undef
        await paint();
    });

    window.OrderHistory = { paint, stateWords, when, lineWords, details, secondsLeft };
})();
