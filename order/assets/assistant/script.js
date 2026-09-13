/*
 * Ask about the menu.
 *
 * A spark in the header, where a shop has switched its assistant on. Tap it
 * and you can ask the way you would ask a waiter - "what's good for two",
 * "something veg and spicy", "add two of that, less spicy" - and the shop's
 * own model answers from this menu and puts things in the order.
 *
 * WHAT HAPPENS ON THE PAGE, AND WHAT DOES NOT. The model proposes; this
 * script applies. Every addition goes through updateQuantity(), the same
 * function the "Add" button calls, so the badge pops, the bill bar updates
 * and the category chip gets its count - and every change is written into
 * the conversation as a line the customer can read ("Added 2 × Chicken
 * Biryani"). Nothing is placed, paid or promised from here; the customer
 * still walks to the order page and the payment page like anyone else.
 *
 * The spark is hidden until the shop's storefront says the assistant is
 * available, and hides again if the server says no. A shop that configured
 * nothing never shows it, and pays nobody.
 */
(function () {
  "use strict";

  var MAX_TURNS_SENT = 12;
  var state = { messages: [], busy: false, greeted: false, landed: false, placed: "" };

  function el(id) {
    return document.getElementById(id);
  }
  function say(key, vars) {
    if (typeof window.t === "function") return window.t(key, vars);
    /* Without the language runtime the English still gets its numbers. */
    return String(key).replace(/\{(\w+)\}/g, function (m, name) {
      return vars && vars[name] != null ? String(vars[name]) : m;
    });
  }
  function apiBase() {
    return String((window.CONFIG && window.CONFIG.API_BASE_URL) || "").replace(/\/$/, "");
  }

  /* ----------------------------------------------------------- the spark */

  /*
   * The shop, from wherever this page keeps it. indexedDB.js declares it
   * with `const`, which is a global binding and NOT a window property, so
   * `window.shop` is undefined on the real page; the bare identifier finds
   * it, and the event rememberShop() fires carries it too.
   */
  var lastShop = null;
  function shopNow(detail) {
    if (detail && typeof detail === "object") lastShop = detail;
    if (lastShop) return lastShop;
    try {
      if (typeof shop === "object" && shop) return shop; // eslint-disable-line no-undef
    } catch (e) {
      /* not declared on this page */
    }
    return window.shop || null;
  }

  function paintSpark(event) {
    var spark = el("ask-ai");
    if (!spark) return;
    var current = shopNow(event && event.detail);
    var on = !!(current && current.assistant);
    spark.hidden = !on;
    document.body.classList.toggle("has-assistant", on);
    if (on) offerHint(current);
    else hideHint(false);
    if (on) landInConversation(current);
  }

  /* ------------------------------------------------ a code for the talk */

  var AI_FIRST_KEY = "posnic_ai_first";

  /* What the link asked for: "talk", "ask", or nothing. From the query on
     this page, or from what the arrival page kept across its redirect. */
  function aiFirstWish() {
    var wish = "";
    try {
      wish = String(new URLSearchParams(window.location.search).get("ai") || "").toLowerCase();
    } catch (e) {
      wish = "";
    }
    if (wish === "1") wish = "ask";
    if (wish !== "talk" && wish !== "ask") {
      try {
        wish = String(sessionStorage.getItem(AI_FIRST_KEY) || "");
      } catch (e) {
        wish = "";
      }
    }
    return wish === "talk" || wish === "ask" ? wish : "";
  }

  /* Once, the moment the shop is known: open the sheet; where the shop lets
     people talk and the code asked for it, stand ready with "Tap to talk". */
  function landInConversation(current) {
    if (state.landed) return;
    var wish = aiFirstWish();
    if (!wish) return;
    state.landed = true;
    try {
      sessionStorage.removeItem(AI_FIRST_KEY);
    } catch (e) {
      /* nothing kept */
    }
    hideHint(true);
    open();
    if (wish === "talk" && current && current.voice && window.OrderingVoice && window.OrderingVoice.standReady) {
      window.OrderingVoice.standReady();
    }
  }

  /* ------------------------------------------------------- the callout */

  var HINT_KEY = "posnic_assistant_seen";
  var hintTimer = 0;

  function hintSeen() {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markHintSeen() {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch (e) {
      /* a browser that keeps nothing sees it again next time; fine */
    }
  }

  /* Once per phone, for a few seconds: "Ask me what's good, or just talk." */
  function offerHint(current) {
    var hint = el("assistant-hint");
    if (!hint) return;
    if (hintSeen() || state.greeted) {
      /* Seen already, here or in another tab: nothing to offer, and one
         that is somehow up comes down. */
      hideHint(false);
      return;
    }
    var text = el("assistant-hint-text");
    if (text) text.textContent = current && current.voice ? say("Ask me what's good, or just talk") : say("Ask me what's good");
    if (!hint.hidden) return;
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hideHint(false);
    }, 9000);
  }

  function hideHint(forGood) {
    var hint = el("assistant-hint");
    if (hint) hint.hidden = true;
    clearTimeout(hintTimer);
    if (forGood) markHintSeen();
  }

  /* --------------------------------------------------------- the log */

  function scrollLog() {
    var log = el("assistant-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  function bubble(role, text) {
    var log = el("assistant-log");
    if (!log) return null;
    var row = document.createElement("div");
    row.className = "assistant-msg " + (role === "me" ? "me" : "ai");
    var body = document.createElement("div");
    body.className = "assistant-bubble";
    /* Text, never markup: the reply is model output over shop data. */
    String(text || "")
      .split(/\n+/)
      .forEach(function (line, i) {
        if (i) body.appendChild(document.createElement("br"));
        body.appendChild(document.createTextNode(line));
      });
    row.appendChild(body);
    log.appendChild(row);
    scrollLog();
    return row;
  }

  function actionLine(text) {
    var log = el("assistant-log");
    if (!log) return;
    var row = document.createElement("div");
    row.className = "assistant-action";
    row.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';
    row.appendChild(document.createTextNode(text));
    log.appendChild(row);
    scrollLog();
  }

  function typing(on) {
    var log = el("assistant-log");
    if (!log) return;
    var current = log.querySelector(".assistant-typing");
    if (!on) {
      if (current) current.remove();
      return;
    }
    if (current) return;
    var row = document.createElement("div");
    row.className = "assistant-msg ai assistant-typing";
    row.setAttribute("aria-label", say("Thinking"));
    row.innerHTML = '<div class="assistant-bubble"><span></span><span></span><span></span></div>';
    log.appendChild(row);
    scrollLog();
  }

  function greet() {
    if (state.greeted) return;
    state.greeted = true;
    hideHint(true);
    /* The shop's own opening line when it wrote one, else the plain one;
       and where the shop lets people talk, the microphone gets a mention. */
    var current = shopNow();
    var own = current && current.assistantGreeting ? String(current.assistantGreeting).trim() : "";
    var line = own || say("Hi! Tell me what you feel like, or ask what's good here. I'll suggest from the menu and can add it to your order.");
    if (current && current.voice) line += " " + say("Or tap the microphone and just talk.");
    bubble("ai", line);
  }

  /* ------------------------------------------------- applying an answer */

  async function quantityOf(id) {
    try {
      var cart = await getCartData();
      var line = (cart || []).find(function (l) {
        return String(l.id) === String(id);
      });
      return line ? Number(line.quantity) || 0 : 0;
    } catch (e) {
      return 0;
    }
  }

  async function apply(actions) {
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || !a.item_id || typeof updateQuantity !== "function") continue;
      var have = await quantityOf(a.item_id);
      var delta = 0;
      if (a.verb === "add") delta = Number(a.quantity) || 1;
      else if (a.verb === "remove") delta = -have;
      else if (a.verb === "set") delta = (Number(a.quantity) || 0) - have;
      if (delta !== 0) await updateQuantity(a.item_id, delta);
      var now = await quantityOf(a.item_id);
      if (a.note && now > 0 && typeof setCartItemNote === "function") {
        try {
          await setCartItemNote(a.item_id, a.note);
        } catch (e) {
          /* A note that could not be kept is still in the conversation. */
        }
      }
      if (a.verb === "remove") actionLine(say("Removed {name}", { name: a.name }));
      else if (a.verb === "set") actionLine(say("Now {n} × {name}", { n: now, name: a.name }));
      else actionLine(say("Added {n} × {name}", { n: delta, name: a.name }));
      if (a.note && now > 0) actionLine(say("Request noted: {note}", { note: a.note }));
    }
    paintReview();
  }

  /* ------------------------------------------------ the way out */

  function leave(url) {
    window.location.href = url;
  }

  /* The button under the conversation: what the order holds, and the way
     to review and place it. Hidden while there is nothing to review. */
  async function paintReview() {
    var button = el("assistant-review");
    if (!button || typeof getCartData !== "function") return; // eslint-disable-line no-undef
    var lines = [];
    try {
      lines = (await getCartData()) || []; // eslint-disable-line no-undef
    } catch (e) {
      lines = [];
    }
    var count = 0;
    var total = 0;
    lines.forEach(function (l) {
      var q = Number(l.quantity) || 0;
      count += q;
      total += (Number(l.price) || 0) * q;
    });
    button.hidden = !count;
    paintOrderList(lines);
    var sum = el("assistant-review-sum");
    if (!sum) return;
    if (!count) {
      sum.textContent = "";
      return;
    }
    var w = typeof words === "function" ? words() : { one: "item", many: "items" }; // eslint-disable-line no-undef
    var amount = typeof money === "function" ? money(total) : String(total); // eslint-disable-line no-undef
    sum.textContent = say("{n} " + (count === 1 ? w.one : w.many), { n: count }) + " · " + amount;
  }

  /*
   * What is on the order, while the customer is talking. It stands in for the
   * transcript, which is hidden on a call: they are listening, not reading,
   * and the prices are on the page behind this sheet anyway.
   */
  function paintOrderList(lines) {
    var box = el("assistant-order-list");
    if (!box) return;
    box.textContent = "";
    if (!lines || !lines.length) {
      var empty = document.createElement("li");
      empty.className = "assistant-order-empty";
      empty.textContent = say("Nothing yet");
      box.appendChild(empty);
      return;
    }
    lines.forEach(function (line) {
      var row = document.createElement("li");
      var qty = document.createElement("span");
      qty.className = "assistant-order-qty";
      qty.textContent = String(Number(line.quantity) || 0) + "×";
      var name = document.createElement("span");
      name.className = "assistant-order-name";
      name.textContent = String(line.name || "");
      row.appendChild(qty);
      row.appendChild(name);
      if (line.note) {
        var note = document.createElement("small");
        note.className = "assistant-order-note";
        note.textContent = String(line.note);
        row.appendChild(note);
      }
      /* Changed by hand, for whatever the talking got wrong. Owner: "in
         screen show line item and can able to modify details by hand also." */
      var less = document.createElement("button");
      less.type = "button";
      less.className = "assistant-order-step";
      less.setAttribute("data-step", "-1");
      less.setAttribute("data-id", String(line.item_id || line.id || ""));
      less.setAttribute("aria-label", say("One less {name}", { name: line.name }));
      less.textContent = "−";
      var more = document.createElement("button");
      more.type = "button";
      more.className = "assistant-order-step";
      more.setAttribute("data-step", "1");
      more.setAttribute("data-id", String(line.item_id || line.id || ""));
      more.setAttribute("aria-label", say("One more {name}", { name: line.name }));
      more.textContent = "+";
      row.appendChild(less);
      row.appendChild(more);
      box.appendChild(row);
    });
  }

  /* Talking or typing: on a call the order shows and the transcript does not. */
  function showOrderInstead(on) {
    var box = el("assistant-order");
    if (box) box.hidden = !on;
    if (on) paintReview();
  }

  /*
   * The order has gone, and this is where the customer finds that out.
   *
   * In the sheet they were talking into, not on a screen the page jumped to:
   * the jump was indistinguishable from a crash, and it ended the
   * conversation in the middle of it. Two beats - it went, somebody is
   * cooking it - and then the customer decides when to leave.
   */
  var placedTimer = 0;
  var placedStop = null;
  /* Which order this screen is showing, and the shop's window on it. */
  var placedOrder = { id: "", seconds: 0, at: 0, tick: 0, expired: false };

  /* What each beat of the drawn scene is called, in the customer's words. */
  var PLACED_WORDS = {
    sending: "Sending your order to the kitchen",
    landed: "The kitchen has it",
    cooking: "The chef is preparing your order",
  };

  /* ---------------------------------------- the order's own screen */

  /*
   * What the shop says is on the order NOW.
   *
   * Asked rather than assumed: the basket was emptied the moment the order
   * went, and after a change it is the shop's answer that is true.
   */
  async function readPlaced() {
    if (!placedOrder.id || !state.placed) return null;
    var shop = "";
    try {
      shop = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      shop = "";
    }
    if (!shop) return null;
    try {
      var response = await fetch(
        apiBase() +
          "/online-ordering/" +
          encodeURIComponent(shop) +
          "/orders/" +
          encodeURIComponent(placedOrder.id) +
          "?token=" +
          encodeURIComponent(state.placed),
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (!response.ok) return null;
      var body = await response.json();
      return body && body.type === "success" && body.data ? body.data : null;
    } catch (e) {
      /* Offline. The token above is still the customer's proof. */
      return null;
    }
  }

  /** Tell the shop, and hand back what it said. */
  async function changePlaced(what, body) {
    var shop = "";
    try {
      shop = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      shop = "";
    }
    if (!shop) return { failed: "no_shop" };
    try {
      var response = await fetch(
        apiBase() +
          "/online-ordering/" +
          encodeURIComponent(shop) +
          "/orders/" +
          encodeURIComponent(placedOrder.id) +
          "/" +
          what,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(Object.assign({ token: state.placed }, body || {}))
        }
      );
      var answer = await response.json().catch(function () {
        return null;
      });
      if (!response.ok || !answer || answer.type !== "success") {
        return { failed: String((answer && answer.message) || "not_changed") };
      }
      return answer.data || {};
    } catch (e) {
      return { failed: "not_changed" };
    }
  }

  /*
   * A few things that go with what they ordered.
   *
   * Drawn from categories they have NOT ordered from, so somebody who asked
   * for biryani is offered a drink rather than more biryani, and never
   * anything already on the order. Cheapest first, because something to add
   * on is a small yes and not a second meal. Three: a fourth is a catalogue.
   */
  function goesWith(on) {
    try {
      var all = (typeof allProducts === "function" ? allProducts() : []) || []; // eslint-disable-line no-undef
      /* The rule itself lives in indexedDB.js, because the order history
         offers the same row and two copies of it would drift. */
      return typeof goesWithOrder === "function" ? goesWithOrder(on, all) : []; // eslint-disable-line no-undef
    } catch (e) {
      return [];
    }
  }

  function paintPlacedOrder(said) {
    var box = el("placed-order");
    if (!box) return;
    if (!said || said.cancelled) {
      box.hidden = true;
      clearTimeout(placedOrder.tick);
      return;
    }
    box.hidden = false;
    /* The clock counts only while there is something to count down to: an
       order the shop has closed must not say "30s to change it". */
    placedOrder.seconds = said.can_change ? Number(said.change_seconds) || 0 : 0;
    placedOrder.at = new Date(said.placed_at || 0).getTime();

    var lines = el("placed-lines");
    if (lines) {
      lines.textContent = "";
      (said.items || []).forEach(function (line) {
        var row = document.createElement("li");
        var qty = document.createElement("span");
        qty.className = "placed-line-qty";
        qty.textContent = String(Number(line.quantity) || 0) + "\u00d7";
        var name = document.createElement("span");
        name.className = "placed-line-name";
        name.textContent = String(line.name || "");
        row.appendChild(qty);
        row.appendChild(name);
        /* Steppers only while it is still theirs to move; once the shop has
           closed the window the row is a record, not a control. */
        if (said.can_change) {
          [
            [-1, "\u2212", "One less {name}"],
            [1, "+", "One more {name}"]
          ].forEach(function (step) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "placed-step";
            button.setAttribute("data-item", String(line.item_id || ""));
            button.setAttribute(
              "data-quantity",
              String(Math.max(0, (Number(line.quantity) || 0) + step[0]))
            );
            button.setAttribute("aria-label", say(step[2], { name: line.name }));
            button.textContent = step[1];
            row.appendChild(button);
          });
        }
        lines.appendChild(row);
      });
    }

    /* Something alongside, while there is still time to add it. */
    var more = el("placed-more");
    var row = el("placed-more-row");
    var suggestions = said.can_change ? goesWith(said.items || []) : [];
    if (more && row) {
      row.textContent = "";
      suggestions.forEach(function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "placed-more-item";
        button.setAttribute("data-add", String(item.id));
        button.setAttribute("aria-label", say("Add {name}", { name: item.name }));
        var plus = document.createElement("span");
        plus.className = "placed-more-plus";
        plus.setAttribute("aria-hidden", "true");
        plus.textContent = "+";
        var name = document.createElement("span");
        name.textContent = String(item.name || "");
        button.appendChild(plus);
        button.appendChild(name);
        row.appendChild(button);
      });
      more.hidden = !suggestions.length;
    }

    /* Off is always offered while there is an order to call off - inside the
       window it simply goes, outside it the shop is asked. The words say
       which, so nobody taps one expecting the other. */
    var off = el("placed-cancel");
    if (off) {
      off.hidden = !!said.paid;
      off.disabled = said.cancel_requested === true;
      off.textContent = said.cancel_requested
        ? say("Cancellation asked for")
        : say(said.can_change ? "Cancel the order" : "Ask the shop to cancel");
    }

    paintPlacedClock();
  }

  function paintPlacedClock() {
    var clock = el("placed-clock");
    if (!clock) return;
    clearTimeout(placedOrder.tick);
    if (!placedOrder.seconds || !placedOrder.at) {
      clock.textContent = "";
      return;
    }
    var left = Math.ceil((placedOrder.at + placedOrder.seconds * 1000 - Date.now()) / 1000);
    if (left <= 0) {
      /* The window has closed under them. Ask the shop what that means now,
         ONCE, rather than leave buttons up that would only fail. Once,
         because the answer is what sets this clock: a shop that still says
         the order can be changed would otherwise be asked forever. */
      clock.textContent = "";
      if (!placedOrder.expired) {
        placedOrder.expired = true;
        showPlacedOrder();
      }
      return;
    }
    clock.textContent = say("{n}s to change it", { n: left });
    placedOrder.tick = setTimeout(paintPlacedClock, 1000);
  }

  /** Ask the shop, then draw. */
  async function showPlacedOrder() {
    paintPlacedOrder(await readPlaced());
  }

  function placedPanel(token, options) {
    var panel = el("assistant-placed");
    if (!panel) {
      actionLine(say("Sent to the kitchen. Token {token}.", { token: token }));
      return;
    }
    var number = el("placed-token");
    if (number) number.textContent = String(token || "--");
    var said = el("placed-said");
    if (said) said.textContent = say(PLACED_WORDS.sending);
    panel.hidden = false;
    state.placed = String(token || "");
    placedOrder.id = String((options && options.orderId) || "");
    placedOrder.expired = false;
    clearTimeout(placedOrder.tick);
    var orderBox = el("placed-order");
    if (orderBox) orderBox.hidden = true;

    /* One scene at a time: a second order during the same visit must not
       leave the first one's loop running behind it. */
    if (placedStop) placedStop();
    placedStop = null;
    var art = el("placed-art");
    if (window.KitchenScene && art) {
      placedStop = window.KitchenScene.play(art, {
        still: options && options.still,
        onBeat: function (beat) {
          if (art.setAttribute) art.setAttribute("data-stage", beat);
          if (said && PLACED_WORDS[beat]) said.textContent = say(PLACED_WORDS[beat]);
          /* The kitchen has it and somebody is cooking it: from here the
             sheet belongs to the order, not to the animation. */
          if (beat === "cooking") showPlacedOrder();
        },
      });
    } else if (said) {
      /* No scene to draw: the words still arrive, on their own clock. */
      clearTimeout(placedTimer);
      var after = options && typeof options.after === "number" ? options.after : 1800;
      placedTimer = setTimeout(function () {
        said.textContent = say(PLACED_WORDS.cooking);
        showPlacedOrder();
      }, after);
    }
  }

  function placedLine(token) {
    placedPanel(token);
  }

  /* Out of the conversation, to the token screen, when the customer says so. */
  function placedDone() {
    var token = state.placed;
    hidePlaced();
    /* Through the published seam, the way the Review button and the voice
       line leave, so one place decides what leaving means. */
    window.OrderingAssistant.leave(
      token ? "thankyou.html?token=" + encodeURIComponent(token) : "products.html"
    );
  }

  /*
   * The reasons the server names, said the way a person would.
   *
   * customer-order.service.js answers with a short word for each - too_late,
   * already_billed - so that the assistant can say which it is instead of
   * inventing a sentence. Anything else it sends is already a sentence.
   */
  var REFUSALS = {
    too_late: "The kitchen has started on it, so it cannot be changed now",
    already_billed: "The shop has made the bill, so the counter has to change it",
    already_paid: "It is paid for, so the counter has to change it",
    already_cancelled: "That order is already cancelled",
    refused_by_shop: "The shop could not take that order",
    at_the_counter: "This one has to be changed at the counter",
    not_found: "That order cannot be found",
    nothing_changed: "Nothing to change there",
    nothing_asked: "Nothing to change there",
    no_shop: "The shop cannot be reached right now",
    not_changed: "That did not go through. Please try again"
  };
  function refusal(why) {
    return REFUSALS[String(why || "")] || String(why || "");
  }

  function hidePlaced() {
    clearTimeout(placedTimer);
    if (placedStop) placedStop();
    placedStop = null;
    var panel = el("assistant-placed");
    if (panel) panel.hidden = true;
  }

  /* --------------------------------------------------------- a turn */

  async function send(text) {
    var asked = String(text || "").trim().slice(0, 400);
    if (!asked || state.busy) return;
    var input = el("assistant-input");
    var button = el("assistant-send");
    var chips = el("assistant-chips");
    if (chips) chips.hidden = true;
    state.busy = true;
    if (button) button.disabled = true;
    if (input) input.value = "";

    state.messages.push({ role: "user", text: asked });
    bubble("me", asked);
    typing(true);

    var branch = "";
    try {
      branch = typeof knownBranchId === "function" ? await knownBranchId() : "";
    } catch (e) {
      branch = "";
    }
    var cart = [];
    try {
      cart = (await getCartData()) || [];
    } catch (e) {
      cart = [];
    }

    try {
      var response = await fetch(apiBase() + "/online-ordering/" + encodeURIComponent(branch) + "/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          messages: state.messages.slice(-MAX_TURNS_SENT),
          cart: cart.map(function (l) {
            return { id: l.id, quantity: l.quantity, note: l.note || "" };
          }),
          lang: (window.i18n && window.i18n.lang) || "en",
        }),
      });
      var body = null;
      try {
        body = await response.json();
      } catch (e) {
        body = null;
      }
      typing(false);

      if (response.status === 403) {
        /* The shop switched it off since the page loaded. */
        var current = shopNow();
        if (current) current.assistant = false;
        paintSpark();
        bubble("ai", say("The assistant is not available at this shop right now."));
        return;
      }
      if (response.status === 429) {
        bubble("ai", say("One moment. That is a lot of questions at once; please try again shortly."));
        state.messages.pop();
        return;
      }
      if (!response.ok || !body || body.type !== "success" || !body.data) {
        bubble("ai", say("I could not answer just now. The menu still works the usual way."));
        state.messages.pop();
        return;
      }

      var reply = String(body.data.reply || "").trim();
      var actions = Array.isArray(body.data.actions) ? body.data.actions : [];
      if (reply) {
        state.messages.push({ role: "assistant", text: reply });
        bubble("ai", reply);
      }
      if (actions.length) await apply(actions);
      return { reply: reply, actions: actions };
    } catch (error) {
      typing(false);
      bubble("ai", say("I could not answer just now. The menu still works the usual way."));
      state.messages.pop();
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
      if (input) input.focus();
    }
  }

  /* --------------------------------------------------------- wiring */

  function open() {
    var sheet = el("assistant");
    if (!sheet) return;
    greet();
    paintReview();
    if (typeof sheet.showModal === "function" && !sheet.open) sheet.showModal();
    var input = el("assistant-input");
    if (input) setTimeout(function () { input.focus(); }, 60);
    scrollLog();
  }

  function close() {
    var sheet = el("assistant");
    if (sheet && sheet.open) sheet.close();
  }

  var wired = false;
  function wire() {
    /* Once. A document that is already complete when this runs, and then
       hears a DOMContentLoaded anyway, must not get every handler twice. */
    if (wired) return;
    wired = true;
    var spark = el("ask-ai");
    if (!spark) return;
    spark.addEventListener("click", open);
    var hintOpen = el("assistant-hint-open");
    if (hintOpen) hintOpen.addEventListener("click", open);
    var hintClose = el("assistant-hint-close");
    if (hintClose) hintClose.addEventListener("click", function () { hideHint(true); });
    var review = el("assistant-review");
    if (review) review.addEventListener("click", function () { window.OrderingAssistant.leave("cart.html"); });
    var done = el("placed-done");
    if (done) done.addEventListener("click", placedDone);

    /*
     * A quantity, something alongside, or calling it off. Each one waits for
     * the shop and then redraws from what the shop now says, so the screen is
     * never ahead of the kitchen. A refusal is shown in the shop's own words
     * - "the kitchen has started on it" - in the conversation the customer is
     * still in, rather than as a button that quietly did nothing.
     */
    var orderBox = el("placed-order");
    if (orderBox) {
      orderBox.addEventListener("click", async function (event) {
        var target = event.target;
        if (!target || !target.closest) return;

        var step = target.closest(".placed-step");
        if (step) {
          step.disabled = true;
          var moved = await changePlaced("items", {
            items: [
              {
                item_id: step.getAttribute("data-item"),
                quantity: Number(step.getAttribute("data-quantity")) || 0
              }
            ]
          });
          if (moved && moved.failed) actionLine(say(refusal(moved.failed)));
          await showPlacedOrder();
          return;
        }

        var add = target.closest(".placed-more-item");
        if (add) {
          add.disabled = true;
          var added = await changePlaced("items", {
            items: [{ item_id: add.getAttribute("data-add"), quantity: 1 }]
          });
          if (added && added.failed) {
            actionLine(say(refusal(added.failed)));
            add.disabled = false;
            return;
          }
          await showPlacedOrder();
          return;
        }

        var off = target.closest(".placed-cancel");
        if (off) {
          off.disabled = true;
          var called = await changePlaced("cancel", {});
          if (called && called.failed) actionLine(say(refusal(called.failed)));
          else if (called && called.requested) actionLine(say("The shop has been asked to cancel it"));
          else actionLine(say("Order cancelled"));
          await showPlacedOrder();
        }
      });
    }
    var orderList = el("assistant-order-list");
    if (orderList) {
      orderList.addEventListener("click", async function (event) {
        var step = event.target && event.target.closest ? event.target.closest(".assistant-order-step") : null;
        if (!step) return;
        var id = step.getAttribute("data-id");
        var by = Number(step.getAttribute("data-step")) || 0;
        if (!id || !by || typeof updateQuantity !== "function") return; // eslint-disable-line no-undef
        await updateQuantity(id, by); // eslint-disable-line no-undef
        paintReview();
      });
    }
    var closeButton = el("assistant-close");
    if (closeButton) closeButton.addEventListener("click", close);
    var form = el("assistant-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = el("assistant-input");
        send(input ? input.value : "");
      });
    }
    var chips = el("assistant-chips");
    if (chips) {
      chips.addEventListener("click", function (event) {
        var chip = event.target.closest ? event.target.closest("[data-ask]") : null;
        if (chip) send(chip.getAttribute("data-ask"));
      });
    }
    /* Tapping the dark outside the sheet closes it, like the dish sheet. */
    var sheet = el("assistant");
    if (sheet) {
      sheet.addEventListener("click", function (event) {
        if (event.target === sheet) close();
      });
    }
    paintSpark();
  }

  document.addEventListener("posnic:shop", paintSpark);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.OrderingAssistant = { send: send, open: open, close: close, paintSpark: paintSpark, apply: apply, bubble: bubble, actionLine: actionLine, typing: typing, paintReview: paintReview, paintOrderList: paintOrderList, placedPanel: placedPanel, placedDone: placedDone, hidePlaced: hidePlaced, showPlacedOrder: showPlacedOrder, goesWith: goesWith, refusal: refusal, showOrderInstead: showOrderInstead, placedLine: placedLine, leave: leave, state: state };
})();
