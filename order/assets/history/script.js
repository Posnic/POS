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

    /*
     * The shop this page is attached to, remembered once.
     *
     * knownBranchId() lives in indexedDB.js and reads the store address the
     * same way every other page does. Read once on the first paint rather than
     * per row: it touches IndexedDB, and a list of ten orders would ask ten
     * times for an answer that cannot change while the page is open.
     */
    let hereShop = null;

    async function whereWeAre() {
        if (hereShop !== null) return hereShop;
        try {
            hereShop = typeof knownBranchId === "function" ? String((await knownBranchId()) || "") : "";
        } catch (e) {
            hereShop = "";
        }
        return hereShop;
    }

    /** Was this order placed at the shop whose menu this phone is holding? */
    function sameShop(kept) {
        const here = String(hereShop || "");
        const there = String((kept && kept.shop) || "");
        /* Unknown on either side means no button rather than a wrong one. */
        return !!here && !!there && here === there;
    }

    function apiBase() {
        return String((window.CONFIG && window.CONFIG.API_BASE_URL) || "").replace(/\/$/, "");
    }

    /*
     * The words for a state, in the customer's terms rather than the
     * database's: nobody asks whether their dinner is "KOT".
     *
     * DRAWN FROM THE TRAIL the server sends, so this page and the thank-you
     * page cannot describe the same order in two different ways. It used to
     * say "With the kitchen" for anything the shop had accepted - including
     * an order whose ticket had never printed, because the printer was off or
     * the till was not running. That is exactly the claim Stage 5 exists to
     * stop making: the kitchen has it when a till reports that a ticket came
     * out of a printer, and not a moment before.
     */
    const STEP_WORDS = {
        placed: "The shop has it",
        accepted: "The shop has it",
        in_the_kitchen: "With the kitchen",
        refused: "The shop could not take it",
        cancelled: "Cancelled"
    };

    function stateWords(row) {
        if (row.cancelled) return say("Cancelled");
        if (row.paid) return say("Paid");
        const progress = row.progress;
        if (progress && progress.step) {
            if (progress.waiting_for === "acceptance") return say("Waiting for the shop");
            const word = STEP_WORDS[progress.step];
            if (word) return say(word);
        }
        /* A server older than the trail, or a row this phone remembered
           before one existed. The old reading, which is never wrong about
           pending or refused - only about the kitchen. */
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

        /*
         * When the kitchen usually has it ready. Drawn above the dishes
         * because it is the one thing somebody opens this page to find out,
         * and left out entirely when the shop has stated no prep times - see
         * readyByWords in indexedDB.js.
         */
        const ready = document.createElement("p");
        ready.className = "history-ready";
        const readyWords = typeof readyByWords === "function" ? readyByWords(said) : "";
        ready.textContent = readyWords;
        ready.hidden = !readyWords;

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
        open.appendChild(ready);
        open.appendChild(what);
        open.appendChild(foot);

        item.appendChild(open);
        if (said && !said.unknown) {
            const panel = details(kept, said);
            panel.hidden = true;
            item.appendChild(panel);
        }

        /*
         * THE SAME AGAIN.
         *
         * Only where the shop answered, because the remembered line carries a
         * name and a quantity and no item id - the id comes from the shop's
         * own copy of the order. Without it there is nothing to look up in
         * today's menu, and matching a dish by its NAME is how a customer ends
         * up with the wrong one.
         *
         * And only for THIS shop. History can hold orders placed elsewhere,
         * and an id from another shop's menu means nothing here: it would
         * either miss, or - far worse - hit a different dish that happens to
         * share an id.
         */
        if (said && !said.unknown && Array.isArray(said.items) && said.items.length && sameShop(kept)) {
            const again = document.createElement("button");
            again.type = "button";
            again.className = "history-again";
            again.setAttribute("data-order", kept.orderId);
            again.textContent = say("Order this again");
            item.appendChild(again);
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

    /*
     * What the shop said about each order, kept so the button below can reach
     * it. The item ids only exist in the shop's copy, and `paint` builds its
     * answers in a local it throws away.
     */
    const answered = new Map();

    /*
     * PRESSING IT.
     *
     * The basket is filled by orderAgain() in indexedDB.js, which is the one
     * place that knows what a cart line looks like. This only decides what to
     * SAY about the result and where to go next.
     *
     * A partial result does not go quietly to the basket. Somebody who ordered
     * five dishes and gets three, with a cheerful hop to the cart, checks out
     * believing they ordered what they ordered last week. So the ones that
     * could not come back are named, and the page waits for them to read it.
     */
    document.addEventListener("click", async (event) => {
        const button = event.target.closest && event.target.closest(".history-again");
        if (!button) return;

        const orderId = String(button.getAttribute("data-order") || "");
        const said = answered.get(orderId);
        if (!said || !Array.isArray(said.items) || !said.items.length) return;

        /* Off the moment it is pressed. Filling a basket touches IndexedDB and
           a second tap would add everything twice. */
        if (button.disabled) return;
        button.disabled = true;
        const wording = button.textContent;
        button.textContent = say("Adding...");

        let result = null;
        try {
            result = typeof orderAgain === "function" ? await orderAgain(said.items) : null;
        } catch (e) {
            result = null;
        }

        button.disabled = false;
        button.textContent = wording;

        if (!result || !result.added.length) {
            /* Nothing came back. Saying so beats sending them to an empty
               basket to work it out. */
            window.alert(say("Nothing from that order is on the menu today."));
            return;
        }

        if (result.gone.length) {
            window.alert(
                say("Added {count} of {total}. Not on the menu today: {names}", {
                    count: result.added.length,
                    total: result.added.length + result.gone.length,
                    names: result.gone.join(", ")
                })
            );
        }

        window.location.href = "cart.html";
    });

    /* Which paint is the current one. A second paint starting while the
       first is still asking the shop used to clear the list under it, and
       the first then tried to replace a row that was no longer there. */
    let painting = 0;

    async function paint() {
        /* Before any row is built: sameShop() is synchronous because the rows
           are, and this is what fills it in. */
        await whereWeAre();
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
            answered.set(String(order.orderId), one);
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

    /**
     * Redraw ONE row from what the shop just said, rather than re-asking for
     * the whole page.
     *
     * Owner: "when click particulor order i see + and - button to modify but
     * not working page broken."
     *
     * It was not the buttons. Every tap did the change and then repainted -
     * and a repaint is a lookup for every order on the page. Two requests a
     * tap against a limiter of ten a minute shared with the page load, so
     * around the fifth tap the lookup was refused, the page fell back to
     * what this phone remembers, a remembered order has no details panel,
     * and the panel he had open vanished under his thumb.
     *
     * The change now answers with the whole order, so the row it belongs to
     * is redrawn from that answer and nothing is asked. The full repaint is
     * kept for the case where the answer is too thin to draw - an older
     * server - because a row that does not redraw at all is the bug this
     * replaces.
     */
    async function redraw(kept, said) {
        if (!said || said.can_change === undefined || !Array.isArray(said.items)) {
            await paint();
            return;
        }
        const panel = document.getElementById("details-" + kept.orderId);
        const item = panel && panel.parentNode;
        if (!item || !item.parentNode) {
            await paint();
            return;
        }
        /*
         * THE WHOLE ROW, not just the panel inside it.
         *
         * The first cut replaced only the details, and a cancellation then
         * left the row above it still saying "With the kitchen" - the state
         * badge, the token and the total all live in the button, outside the
         * panel. The order really had been cancelled; the screen just did not
         * say so, which is the worst of both.
         *
         * So the row is rebuilt from the same answer and dropped in place,
         * with its details left OPEN - which is the whole point: the old
         * full repaint rebuilt every row and every panel starts closed, so
         * the one the customer was looking at shut itself on every tap.
         * Owner: "if i click + or - then page restarted and not working."
         */
        const fresh = row(kept, said);
        const opened = fresh.querySelector(".history-details");
        if (opened) opened.hidden = false;
        const button = fresh.querySelector(".history-open");
        if (button) button.setAttribute("aria-expanded", "true");
        item.parentNode.replaceChild(fresh, item);
        startTicking();
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
            await redraw(kept, answer);
            return;
        }

        const step = target.closest(".history-step");
        if (step) {
            const kept = keptFor(step.getAttribute("data-order"));
            if (!kept) return;
            step.disabled = true;
            const moved = await actOn(kept, "items", {
                items: [{ item_id: step.getAttribute("data-item"), quantity: Number(step.getAttribute("data-quantity")) || 0 }]
            });
            await redraw(kept, moved);
            return;
        }

        const off = target.closest(".history-cancel");
        if (off) {
            const kept = keptFor(off.getAttribute("data-order"));
            if (!kept) return;
            off.disabled = true;
            const called = await actOn(kept, "cancel", {});
            await redraw(kept, called);
        }
    });

    document.addEventListener("DOMContentLoaded", async () => {
        if (typeof loadEnvConfig === "function") await loadEnvConfig(); // eslint-disable-line no-undef
        await paint();
    });

    window.OrderHistory = { paint, stateWords, when, lineWords, details, secondsLeft };
})();
