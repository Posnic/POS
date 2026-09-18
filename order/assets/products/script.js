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

    /* Said on the menu as well as at the basket: somebody who learns about a
       thirty-minute wait only after building a whole order is right to be
       annoyed about the order in which they were told. */
    document.addEventListener("posnic:shop", function () {
        if (typeof paintKitchenNotice === "function") paintKitchenNotice();
        /* And whether this table may call somebody over. */
        if (typeof paintCallButton === "function") paintCallButton();
    });

    document.addEventListener("DOMContentLoaded", async () => {
        await loadProducts();
        await openDB();
        await paintShop();
        /* Shown only once this phone has ordered something: an empty history
           is a button that teaches nothing. */
        const history = el("top-history");
        if (history && typeof rememberedOrders === "function" && rememberedOrders().length) {
            history.hidden = false;
        }
    });

    $(document).on("click", "#top-history", function () {
        window.location.href = "history.html";
    });

    /* ------------------------------------------------------------ the pill */

    /*
     * WHAT THE SHOP OFFERS ON TOP OF THIS DISH.
     *
     * The till has charged for extra cheese since the handset learned about
     * it, and the storefront sends the option sets to every client. This page
     * drew none of them, so a customer ordering from the table could not ask
     * for something the waiter standing next to them could ring up.
     *
     * The deltas are drawn because a price that appears at checkout without
     * having been shown is the thing people write bad reviews about. They are
     * NOT sent back: see addWithOptions in indexedDB.js.
     */
    function drawOptions(item, available) {
        const box = el("dish-options-box");
        if (!box) return;
        const groups = Array.isArray(item.modifier_groups) ? item.modifier_groups : [];
        box.innerHTML = "";
        box.hidden = !(groups.length && available);
        if (box.hidden) return;

        groups.forEach((group, index) => {
            const name = String(group.name || "");
            const most = Number(group.max) || 0;
            /* One choice or several. A group the shop capped at one is a
               choice between things; anything else is a list of extras. */
            const single = most === 1;

            const block = document.createElement("div");
            block.className = "option-group";
            block.setAttribute("data-group", name);

            const head = document.createElement("p");
            head.className = "option-head";
            head.textContent = name;
            /* Say when one is required, because a customer who cannot see the
               rule meets it as a refusal at checkout. */
            if (Number(group.min) > 0) {
                const must = document.createElement("span");
                must.className = "option-must";
                must.textContent = t("Required");
                head.appendChild(must);
            }
            block.appendChild(head);

            (group.options || []).forEach((option, spot) => {
                const row = document.createElement("label");
                row.className = "option-row";

                const input = document.createElement("input");
                input.type = single ? "radio" : "checkbox";
                input.className = "option-pick";
                input.name = "dish-option-" + index;
                input.value = String(option.name || "");
                input.setAttribute("data-group", name);
                input.setAttribute("data-delta", String(Number(option.price_delta) || 0));
                if (single && Number(group.min) > 0 && spot === 0) input.checked = true;

                const words = document.createElement("span");
                words.className = "option-name";
                words.textContent = String(option.name || "");

                const cost = document.createElement("span");
                cost.className = "option-cost";
                const delta = Number(option.price_delta) || 0;
                /* Nothing shown for an option that costs nothing: "+0" reads
                   as a charge somebody has to work out is not one. */
                cost.textContent = delta ? "+" + money(delta) : "";

                row.appendChild(input);
                row.appendChild(words);
                row.appendChild(cost);
                block.appendChild(row);
            });

            box.appendChild(block);
        });
    }

    /** What is ticked right now, in the shape the basket keeps. */
    function chosenNow() {
        const box = el("dish-options-box");
        if (!box || box.hidden) return [];
        return Array.from(box.querySelectorAll(".option-pick"))
            .filter((input) => input.checked)
            .map((input) => ({
                group: String(input.getAttribute("data-group") || ""),
                name: String(input.value || ""),
                price_delta: Number(input.getAttribute("data-delta")) || 0
            }));
    }

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

    /*
     * THE NUTRITION PANEL, and the badges a card had no room for.
     *
     * The card shows at most two badges, because somebody choosing lunch
     * reads a name and a price. This sheet is the other case: it is open
     * because a person tapped a dish and asked about it, so everything the
     * kitchen entered belongs here.
     *
     * Per serving, in the order a nutrition label uses. Only what the shop
     * actually entered - an absent figure is absent, never a zero, because
     * "0 g sugar" on a dish nobody analysed is a claim the shop never made.
     */
    const NUTRIENT_ROWS = [
        ["kcal", "Calories", ""],
        ["protein_g", "Protein", "g"],
        ["carbs_g", "Carbohydrate", "g"],
        ["fat_g", "Fat", "g"],
        ["sat_fat_g", "Saturated fat", "g"],
        ["fibre_g", "Fibre", "g"],
        ["sugar_g", "Sugar", "g"],
        ["sodium_mg", "Sodium", "mg"],
    ];

    /* Everything the kitchen may tick about its own recipe. */
    const TAG_WORD = {
        plant_based: "Plant based",
        eggetarian: "Eggetarian",
        jain: "Jain",
        satvik: "Satvik",
        gluten_free: "Gluten free",
        dairy_free: "Dairy free",
        lactose_free: "Lactose free",
        nut_free: "Nut free",
        organic: "Organic",
        no_added_sugar: "No added sugar",
    };

    /*
     * Every claim, not the two the card had room for.
     *
     * These arrive already decided from the server, where dish-facts.js works
     * them out from the numbers above. This file holds words, never a rule -
     * so nothing here can put "Heart healthy" on a dish that did not earn it.
     */
    const CLAIM_WORD = {
        high_protein: "High protein",
        protein_source: "Source of protein",
        low_fat: "Low fat",
        high_fibre: "High fibre",
        keto_friendly: "Keto friendly",
        low_carb: "Low carb",
        diabetic_friendly: "Diabetic friendly",
        heart_healthy: "Heart healthy",
        under_300: "Under 300 kcal",
        under_500: "Under 500 kcal",
        no_added_sugar: "No added sugar",
    };

    const MARK_WORD = {
        signature: "Signature",
        chefs_pick: "Chef's pick",
        house_special: "House special",
        new: "New",
    };

    function wordsFor(keys, table) {
        return (Array.isArray(keys) ? keys : [])
            .map((k) => table[k])
            .filter(Boolean)
            .map((w) => t(w));
    }

    function showFacts(item) {
        const rows = [];

        const marks = wordsFor(item.marks, MARK_WORD);
        if (marks.length) rows.push(["The shop says", marks.join(", ")]);

        if (DIET_WORD[item.diet]) rows.push(["Diet", DIET_WORD[item.diet]]);

        /* What the numbers earned. Read before the numbers themselves,
           because it is the part most people came for. */
        const claims = wordsFor(item.claims, CLAIM_WORD);
        if (claims.length) rows.push(["Good for", claims.join(", ")]);

        const tags = wordsFor(item.tags, TAG_WORD);
        if (tags.length) rows.push(["Made without", tags.join(", ")]);

        const served = Array.isArray(item.served_in) ? item.served_in.filter(Boolean) : [];
        if (served.length) rows.push(["Served at", served.join(", ")]);
        if (Number(item.prep_minutes) > 0) rows.push(["Takes about", t("{n} minutes", { n: Number(item.prep_minutes) })]);

        /* The numbers last: whoever wants them will read this far, and
           whoever does not should not have to scroll past them. */
        const n = (item.nutrition && typeof item.nutrition === "object") ? item.nutrition : {};
        let numbers = 0;
        NUTRIENT_ROWS.forEach(([key, label, unit]) => {
            const value = Number(n[key]);
            if (!isFinite(value)) return;
            numbers += 1;
            rows.push([label, unit ? `${value} ${unit}` : String(value)]);
        });
        /*
         * WHO SAID SO, said once and under the numbers rather than on each.
         *
         * The shop asked for every value to be shown before anybody had
         * checked them, which is a reasonable trade - an approximate calorie
         * count is more use to somebody counting than a blank. It stops being
         * reasonable the moment a guess is read as a measurement, so the page
         * says which it is. One line, because six rows each carrying "est."
         * is noise that stops being read.
         */
        if (numbers && item.nutrition_estimated === true) {
            rows.push(["How we know", t("Estimated, not measured")]);
        }

        if (item.category_name) rows.push(["Category", item.category_name]);

        const list = el("dish-facts");
        list.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(t(k))}</dt><dd>${escapeHtml(v)}</dd>`).join("");
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

    /*
     * The same, for how hot. Somebody taps two chillies before they tap Add,
     * and the level has no line to live on yet; holding it here means the
     * order the two taps happen in does not matter.
     */
    let pendingSpice = 0;

    /*
     * Built once, on the first sheet that needs it, and never again.
     *
     * Lazily because cart.html loads its scripts in the HEAD: at the moment
     * this file is parsed the dialog does not exist yet, and mounting into a
     * null would have failed silently and left a dead picker that took taps
     * and saved nothing. Once, because the sheet is one element reused for
     * every dish - remounting per dish leaks a listener a dish.
     */
    let spicePicker = null;
    function picker() {
        const box = el("dish-spice-box");
        if (!spicePicker && box && window.PosnicSpice) {
            spicePicker = window.PosnicSpice.mount(box, async (level) => {
                if (!openId) return;
                const line = (await getCartData()).find((row) => String(row.id) === openId);
                if (line) await setCartItemSpice(openId, level);
                else pendingSpice = level;
            });
        }
        return spicePicker;
    }

    async function openDish(id) {
        const item = findProduct(id);
        const sheet = el("dish");
        if (!item || !sheet) return;
        openId = String(id);
        pendingNote = "";
        pendingSpice = 0;

        showPhotos(item);
        el("dish-diet").innerHTML = dietMark(item.diet);
        el("dish-title").textContent = item.name || "";

        const desc = el("dish-desc");
        desc.textContent = item.description || "";
        desc.hidden = !item.description;

        showFacts(item);
        /*
         * TODAY'S PRICE IS NOT SET YET.
         *
         * Whole fish, crab, lobster: the rate comes from the morning's market
         * and the shop enters it when it opens. Owner: "dont let customer add
         * or menu see the price. ask for pricing."
         *
         * The sheet says so and withholds the button, using the same pair the
         * out-of-hours case already uses - so there is one way this screen
         * says "not now" rather than two.
         *
         * THE SAME RULE THE CARD USED, not a second copy of it: a card that
         * refuses and a sheet one tap later that accepts is worse than either,
         * because the guest has already been told no once. See
         * waitingForTodaysPrice in indexedDB.js.
         */
        const marketPriced = waitingForTodaysPrice(item);
        el("dish-price").textContent = marketPriced ? t("Market price") : money(item.price);

        /* Off its hours: no pill, and a line saying when instead. */
        const available = item.available !== false;
        const served = Array.isArray(item.served_in) ? item.served_in.filter(Boolean) : [];
        el("dish-add").hidden = !available || marketPriced;
        const off = el("dish-off");
        off.hidden = available && !marketPriced;
        off.textContent = marketPriced
            ? t("Ask staff for today's price")
            : served.length
                ? t("Served at {when} only", { when: served.join(t(" and ")) })
                : t("Not available right now");

        const line = (await getCartData()).find((row) => String(row.id) === openId);
        paintSheetQty(line ? line.quantity : 0);

        /*
         * The chillies, for a dish the kitchen said it can cook to order and
         * only while the dish can be ordered at all. Off its hours there is
         * nothing to choose about.
         */
        drawOptions(item, available && !marketPriced);

        const spiceBox = el("dish-spice-box");
        if (spiceBox) {
            spiceBox.hidden = !(item.spice_choice === true && available && !marketPriced);
            const p = picker();
            if (p) p.set(line ? line.spice : 0);
        }

        const noteBox = el("dish-note-box");
        if (noteBox) {
            noteBox.hidden = !(shop.notes && available);
            const field = el("dish-note");
            if (field) {
                field.value = line && line.note ? line.note : "";
                /*
                 * The example changes when there are chillies above it.
                 * "Less spicy" as the first suggestion under a spice picker
                 * teaches people to TYPE what they could tap - which puts the
                 * request back into prose the kitchen has to read, in
                 * whatever language it was typed in, and is the whole thing
                 * the picker exists to stop.
                 */
                field.placeholder = spiceBox && !spiceBox.hidden
                    ? t("No onion, extra gravy, cut in half...")
                    : t("Less spicy, no onion, extra gravy...");
            }
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

        /*
         * A dish with extras goes in through its own door, because the basket
         * line for it is keyed by the CHOICE and not by the dish: two dosas,
         * one with cheese, are two lines. See optionKey in indexedDB.js.
         *
         * The note and the spice level below are set against the line, so the
         * key they are given has to be the same one.
         */
        const chosen = chosenNow();
        if (chosen.length && typeof addWithOptions === "function") {
            const line = await addWithOptions(id, chosen, 1);
            bump();
            const key = line ? String(line.id) : "";
            if (pendingNote && key) {
                await setCartItemNote(key, pendingNote);
                pendingNote = "";
            }
            if (pendingSpice && key) {
                await setCartItemSpice(key, pendingSpice);
                pendingSpice = 0;
            }
            return;
        }

        await change(id, 1);
        /* A note typed before the first Add now has a line to live on. */
        if (pendingNote && id) {
            await setCartItemNote(id, pendingNote);
            pendingNote = "";
        }
        /* And so does a spice level tapped before it. */
        if (pendingSpice && id) {
            await setCartItemSpice(id, pendingSpice);
            pendingSpice = 0;
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
