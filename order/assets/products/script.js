/*
 * The page a customer orders from: what a tap does.
 *
 * indexedDB.js owns the data - the catalogue, the order, the sums - and draws
 * the cards. This file owns the gestures on top of them: the pill on a card,
 * the sheet a card opens, searching as a mode, and the microphone. Nothing
 * here touches storage directly; every change to the order goes through
 * updateQuantity, so the card, the sheet and the bar cannot disagree.
 *
 * GONE: the picture that flew from the card to the basket on every tap. It
 * was 2015's idea of delight, it broke the moment a dish had no photo (the
 * clone read the offset of an image that was not there), and it hid the one
 * thing that matters - the total changing. The bar nudges instead.
 */
(function () {
    "use strict";

    const el = (id) => document.getElementById(id);

    document.addEventListener("DOMContentLoaded", async () => {
        await loadProducts();
        await openDB();
        await paintShop();
    });

    /* ------------------------------------------------------------ the pill */

    async function change(id, delta) {
        if (!id) return;
        await updateQuantity(id, delta);
        if (delta > 0) bump();
    }

    $(document).on("click", ".btn-increase", function (e) {
        e.stopPropagation();
        change(String($(this).closest(".product-card").attr("data-id") || ""), 1);
    });

    $(document).on("click", ".btn-decrease", function (e) {
        e.stopPropagation();
        change(String($(this).closest(".product-card").attr("data-id") || ""), -1);
    });

    /* The bar nudges when something is added, so the eye is told where it
       went without a picture flying across the screen. */
    function bump() {
        const bar = el("bill-bar");
        if (!bar) return;
        bar.classList.remove("bump");
        void bar.offsetWidth;
        bar.classList.add("bump");
    }

    /* --------------------------------------------------------- the order bar */

    $(document).on("click", ".next-page", function () {
        if ($(this).hasClass("disabled")) return;
        window.location.href = "cart.html";
    });

    $(document).on("keydown", ".floating-cart", function (e) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            $(this).trigger("click");
        }
    });

    /* ------------------------------------------------------------- the sheet */

    /*
     * The dish, opened. Every photo, the whole description, what the shop has
     * said about it, and the pill - the same pill as the card, kept in step
     * with it through the event updateQuantity raises.
     */
    let openId = "";

    function findProduct(id) {
        return allProducts().find((p) => String(p.id) === String(id)) || null;
    }

    const DIET_WORD = {
        veg: "Vegetarian",
        non_veg: "Non-vegetarian",
        egg: "Contains egg",
        vegan: "Vegan",
    };

    function dietMark(diet) {
        if (!DIET_WORD[diet]) return "";
        return `<span class="product-diet diet-${escapeHtml(diet)}" role="img" aria-label="${DIET_WORD[diet]}"></span>`;
    }

    function showPhotos(item) {
        const gallery = el("dish-gallery");
        const strip = el("dish-strip");
        const dots = el("dish-dots");
        const icon = el("dish-icon");

        const photos = Array.isArray(item.photos) && item.photos.length
            ? item.photos
            : item.img ? [item.img] : [];

        if (!photos.length) {
            gallery.hidden = true;
            icon.textContent = item.icon || "";
            icon.hidden = !item.icon;
            return;
        }

        icon.hidden = true;
        gallery.hidden = false;
        strip.setAttribute("data-count", String(photos.length));
        strip.innerHTML = photos
            .map((src, i) => `<img src="${escapeHtml(getSafeImageUrl(src))}" alt="${escapeHtml(item.name || "")}${photos.length > 1 ? `, photo ${i + 1} of ${photos.length}` : ""}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async">`)
            .join("");
        dots.hidden = photos.length < 2;
        dots.innerHTML = photos.map((_, i) => `<span data-on="${i === 0 ? "true" : "false"}"></span>`).join("");
        strip.scrollLeft = 0;
    }

    /* Which photo is in front, from where the strip has been pushed to. */
    (function watchStrip() {
        const strip = el("dish-strip");
        const dots = el("dish-dots");
        if (!strip || !dots) return;
        strip.addEventListener("scroll", () => {
            if (!strip.children.length) return;
            const each = strip.scrollWidth / strip.children.length;
            const at = Math.round(strip.scrollLeft / each);
            [...dots.children].forEach((dot, i) => dot.setAttribute("data-on", i === at ? "true" : "false"));
        }, { passive: true });
    })();

    function showFacts(item) {
        const rows = [];
        if (DIET_WORD[item.diet]) rows.push(["Diet", DIET_WORD[item.diet]]);
        const served = Array.isArray(item.served_in) ? item.served_in.filter(Boolean) : [];
        if (served.length) rows.push(["Served at", served.join(", ")]);
        if (Number(item.prep_minutes) > 0) rows.push(["Takes about", t("{n} minutes", { n: Number(item.prep_minutes) })]);
        if (item.category_name) rows.push(["Category", item.category_name]);

        const list = el("dish-facts");
        list.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
        list.hidden = rows.length === 0;
    }

    async function paintSheetQty(quantity) {
        const add = el("dish-add");
        if (!add) return;
        const q = Number(quantity) || 0;
        add.setAttribute("data-qty", String(q));
        el("dish-qty").textContent = String(q);
    }

    /* The note typed for a dish that is not on the bill yet, carried onto
       the line when it is added. */
    let pendingNote = "";

    async function openDish(id) {
        const item = findProduct(id);
        const sheet = el("dish");
        if (!item || !sheet) return;
        openId = String(id);
        pendingNote = "";

        showPhotos(item);
        el("dish-diet").innerHTML = dietMark(item.diet);
        el("dish-title").textContent = item.name || "";

        const desc = el("dish-desc");
        desc.textContent = item.description || "";
        desc.hidden = !item.description;

        showFacts(item);
        el("dish-price").textContent = money(item.price);

        /* Off its hours: no pill, and a line saying when instead. */
        const available = item.available !== false;
        const served = Array.isArray(item.served_in) ? item.served_in.filter(Boolean) : [];
        el("dish-add").hidden = !available;
        const off = el("dish-off");
        off.hidden = available;
        off.textContent = served.length ? t("Served at {when} only", { when: served.join(t(" and ")) }) : t("Not available right now");

        const line = (await getCartData()).find((row) => String(row.id) === openId);
        paintSheetQty(line ? line.quantity : 0);

        const noteBox = el("dish-note-box");
        if (noteBox) {
            noteBox.hidden = !(shop.notes && available);
            const field = el("dish-note");
            if (field) field.value = line && line.note ? line.note : "";
        }

        if (typeof sheet.showModal === "function") sheet.showModal();
        else sheet.setAttribute("open", "open");
    }

    function closeDish() {
        const sheet = el("dish");
        if (!sheet) return;
        if (typeof sheet.close === "function") sheet.close();
        else sheet.removeAttribute("open");
    }

    /* The card itself opens the dish; the pill on it does not. */
    $(document).on("click", ".product-card", function (e) {
        if ($(e.target).closest(".cart-controls").length) return;
        openDish(String($(this).attr("data-id") || ""));
    });

    $(document).on("keydown", ".product-card", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        if ($(e.target).closest(".cart-controls").length) return;
        e.preventDefault();
        openDish(String($(this).attr("data-id") || ""));
    });

    $(document).on("click", "#dish-more", async () => {
        const id = openId;
        await change(id, 1);
        /* A note typed before the first Add now has a line to live on. */
        if (pendingNote && id) {
            await setCartItemNote(id, pendingNote);
            pendingNote = "";
        }
    });

    /* The note, kept as it is typed: on the line if there is one, held
       for the first Add if there is not. */
    document.addEventListener("input", async (e) => {
        if (!e.target || e.target.id !== "dish-note" || !openId) return;
        const text = String(e.target.value || "");
        const line = (await getCartData()).find((row) => String(row.id) === openId);
        if (line) await setCartItemNote(openId, text);
        else pendingNote = text;
    });
    $(document).on("click", "#dish-less", () => change(openId, -1));
    $(document).on("click", "#dish-close", closeDish);

    /* Tapping the dark around the sheet closes it: the shade IS the dialog,
       so a click that lands on the dialog itself and nothing inside it is a
       tap away. */
    (function wireSheet() {
        const sheet = el("dish");
        if (!sheet) return;
        sheet.addEventListener("click", (e) => {
            if (e.target === sheet) closeDish();
        });
        sheet.addEventListener("close", () => {
            openId = "";
        });
    })();

    /* updateQuantity says what changed; the sheet, if it is showing that
       dish, follows. */
    document.addEventListener("posnic:order-changed", (e) => {
        if (!e.detail || !openId) return;
        if (String(e.detail.id) === openId) paintSheetQty(e.detail.quantity);
    });

    /* ---------------------------------------------------- searching as a mode */

    /*
     * The shop name and the sections stand down while the keyboard has half
     * the screen; the arrow is the way back. Same shape as the menu, and the
     * same shape every food app has already taught people.
     */
    function setSearching(on) {
        document.body.classList.toggle("searching", !!on);
        const back = el("product-search-back");
        if (back) back.hidden = !on;
    }

    (function wireSearchMode() {
        const input = el("product-search");
        const back = el("product-search-back");
        if (input) input.addEventListener("focus", () => setSearching(true));
        if (back) {
            back.addEventListener("click", () => {
                if (input) {
                    input.value = "";
                    input.blur();
                }
                orderView.query = "";
                setSearching(false);
                refreshProductView();
            });
        }
    })();

    /* ------------------------------------------------------------- the mic */

    /*
     * Speak the dish instead of spelling it, with the browser's own
     * recogniser. Nothing leaves the phone. Hidden where the browser has
     * none, because a microphone that does nothing is worse than no
     * microphone; it also steps aside for the clear button once there is
     * something to clear.
     */
    function isIOS() {
        const ua = navigator.userAgent || "";
        return /iP(hone|od|ad)/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    }

    function isIOS() {
        const ua = navigator.userAgent || "";
        return /iP(hone|od|ad)/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    }

    (function wireMic() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
        const mic = el("product-search-mic");
        const input = el("product-search");
        if (!Recognition || !mic || !input) return;
        /* iOS: every browser is WebKit, its recogniser shows system UI the
           page cannot dismiss (a permission sheet sat over this box on an
           iPhone 14 Pro), and the keyboard already has a dictation key that
           types straight into this field. There, the keyboard's microphone
           is the microphone. */
        if (isIOS()) return;

        mic.hidden = false;
        mic.setAttribute("data-supported", "true");
        let listening = null;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden && listening) listening.stop();
        });

        mic.addEventListener("click", () => {
            if (listening) {
                listening.stop();
                return;
            }
            const rec = new Recognition();
            /* The language the MENU is written in, not the language of the
               page around it: a Tamil-reading customer still says "biryani",
               and the item is still called that. */
            rec.lang = document.documentElement.getAttribute("data-speech-lang") || "en-IN";
            rec.interimResults = true;
            rec.maxAlternatives = 1;
            let quiet = 0;
            rec.onstart = () => {
                listening = rec;
                mic.setAttribute("data-listening", "true");
                setSearching(true);
                /* A recogniser that never says "end" cannot hold the screen. */
                quiet = setTimeout(() => { try { rec.stop(); } catch (e) { /* already stopped */ } }, 12000);
            };
            rec.onresult = (e) => {
                let said = "";
                for (let i = e.resultIndex; i < e.results.length; i++) said += e.results[i][0].transcript;
                said = said.trim();
                if (!said) return;
                input.value = said;
                /* Through the normal path, so a spoken word is searched the
                   same way a typed one is. */
                $(input).trigger("input");
            };
            rec.onerror = () => {};
            rec.onend = () => {
                clearTimeout(quiet);
                listening = null;
                mic.removeAttribute("data-listening");
            };
            try {
                rec.start();
            } catch (err) {
                /* Already running, which the spec throws for. */
            }
        });
    })();
})();
