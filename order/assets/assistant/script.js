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
    paintMore(lines);
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
   * A few things that go with what is in the basket.
   *
   * Wrapped, never a sideways scroller - owner: "cross selling i saw
   * horrizontal scroll. not soo good." Drawn by the same chooser the
   * confirmation screen and the order history use, so all three offer the
   * same thing for the same reasons.
   */
  /*
   * Tell the open voice line what the customer just changed with their thumb.
   *
   * Named by DISH, not by id: the assistant talks about food, and a
   * twenty-four character id in the conversation is a thing it might read out
   * loud. Quiet - it does not ask for a reply, because the customer is
   * looking at the screen and does not need it narrated back.
   */
  async function tellVoice(id) {
    try {
      var voice = window.OrderingVoice;
      if (!voice || typeof voice.noticed !== "function") return;
      var now = await quantityOf(id);
      var all = typeof allProducts === "function" ? allProducts() || [] : []; // eslint-disable-line no-undef
      var item = all.filter(function (p) {
        return String(p.id) === String(id);
      })[0];
      voice.noticed(now > 0 ? "set" : "remove", (item && item.name) || "", now);
    } catch (e) {
      /* A line that is not open has nothing to be told. */
    }
  }

  function paintMore(lines) {
    var more = el("assistant-more");
    var row = el("assistant-more-row");
    if (!more || !row) return;
    var on = (lines || []).map(function (l) {
      return { item_id: l.id, quantity: l.quantity };
    });
    var suggestions = on.length ? goesWith(on) : [];
    row.textContent = "";
    suggestions.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-more-item";
      button.setAttribute("data-add", String(item.id));
      button.setAttribute("aria-label", say("Add {name}", { name: item.name }));
      var plus = document.createElement("span");
      plus.className = "assistant-more-plus";
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

  /*
   * What is on the order, while the customer is talking. It stands in for the
   * transcript, which is hidden on a call: they are listening, not reading,
   * and the prices are on the page behind this sheet anyway.
   */
  /*
   * What the list last showed, so it is not rebuilt to look the same.
   *
   * Tearing five rows out of the DOM and putting five identical rows back is
   * a flash on a phone, and it happened on every tick of the call. A cheap
   * signature of what is about to be drawn is enough to tell the two apart.
   */
  var listDrawn = "";

  function paintOrderList(lines) {
    var box = el("assistant-order-list");
    if (!box) return;
    var signature = JSON.stringify(
      (lines || []).map(function (l) {
        return [String(l.id || l.item_id || ""), Number(l.quantity) || 0, String(l.note || "")];
      })
    );
    if (signature === listDrawn && box.children.length) return;
    listDrawn = signature;
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
  /*
   * The order stands in for the transcript while a call is up.
   *
   * REDRAWN ON THE WAY IN, NOT ON EVERY TICK. This used to repaint whenever
   * it was called, and it is called from status() - which fires on listening,
   * on speaking, on thinking, several times a sentence. Every one of those
   * tore the whole list out of the DOM and built it again, which on a phone
   * is a visible flash. Owner: "i see its flickering not showing thing."
   *
   * Now it draws when it is SHOWN, and after that only when the order really
   * changes - paintOrderList leaves the DOM alone when the lines have not
   * moved.
   */
  /*
   * How the food travels, asked on this screen.
   *
   * Only where the shop offers more than one way and nothing has already
   * settled it - a table code, a takeaway code, or what the customer told the
   * assistant. One tap sends the order; there is no second confirmation,
   * because the tap on "Confirm & send" was already the yes.
   */
  var WAY_WORDS = {
    dine_in: "Eating here",
    takeaway: "Taking it away",
    pickup: "Collecting it",
    delivery: "Delivered",
  };

  function askTheWay(ways) {
    var box = el("assistant-ways");
    var row = el("assistant-ways-row");
    if (!box || !row) {
      window.OrderingAssistant.leave("cart.html");
      return;
    }
    var offered = (ways || []).filter(function (w) {
      return WAY_WORDS[w];
    });
    if (!offered.length) {
      window.OrderingAssistant.leave("cart.html");
      return;
    }
    row.textContent = "";
    offered.forEach(function (way) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-way";
      button.setAttribute("data-way", way);
      button.textContent = say(WAY_WORDS[way]);
      row.appendChild(button);
    });
    box.hidden = false;
  }

  /* What this page just did, into the panel the shop asked for. Never an
     error of its own: a log that breaks the thing it is logging is worse
     than no log. assets/assistant/debug.js. */
  /*
   * A control that is waiting on the shop SAYS so.
   *
   * Owner: "if something is loading show loader." A button that has been
   * tapped and is waiting on a server looks exactly like a button that did
   * nothing, which is what makes somebody tap it again - and a second tap on
   * a plus is a second dish.
   */
  function working(button, on) {
    if (!button) return;
    button.disabled = !!on;
    if (button.classList) button.classList.toggle("is-working", !!on);
  }

  function report(what, detail) {
    try {
      if (window.VoiceDebug) window.VoiceDebug.did(what, detail);
    } catch (e) {
      /* nothing to report to */
    }
  }

  var showingOrder = null;
  function showOrderInstead(on) {
    var want = !!on;
    var box = el("assistant-order");
    if (box) box.hidden = !want;
    if (want && showingOrder !== true) paintReview();
    showingOrder = want;
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

  /*
   * WHAT THEY HAVE CHANGED BUT NOT YET SENT.
   *
   * Owner: "flow is not correct. customer cant change in one touch. after
   * changes. he need to review and click confirmation."
   *
   * Every plus and minus used to go straight to the shop. That is one tap
   * between a thumb on a moving bus and a kitchen cooking something nobody
   * ordered, and it gave the customer nothing to look at before committing -
   * they were editing the kitchen live. Now a tap moves a number ON THIS
   * SCREEN, the screen says what it will send, and one button sends the lot.
   *
   * ABSOLUTE QUANTITIES, keyed by item, which is what the change endpoint
   * takes: a line staged to 0 is a line taken off, and an id that is not on
   * the order yet is a line added. So a whole edit - two more of this, none
   * of that, one of something new - is ONE request when they confirm.
   */
  var staged = { forOrder: "", lines: {} };

  function stageFor(orderId) {
    if (staged.forOrder !== String(orderId || "")) {
      staged.forOrder = String(orderId || "");
      staged.lines = {};
    }
  }

  function stagedCount() {
    return Object.keys(staged.lines).length;
  }

  function dropStaged() {
    staged.lines = {};
  }

  /** What the customer would be sending: only what actually differs. */
  function stagedChanges(said) {
    var was = {};
    (said && said.items ? said.items : []).forEach(function (line) {
      was[String(line.item_id || "")] = Number(line.quantity) || 0;
    });
    var out = [];
    Object.keys(staged.lines).forEach(function (id) {
      var want = Number(staged.lines[id].quantity) || 0;
      if (want !== (was[id] || 0)) out.push({ item_id: id, quantity: want });
    });
    return out;
  }

  /** Move a line by one, on this screen only. */
  function stageStep(said, id, name, by) {
    stageFor(placedOrder.id);
    var was = 0;
    (said && said.items ? said.items : []).forEach(function (line) {
      if (String(line.item_id || "") === String(id)) was = Number(line.quantity) || 0;
    });
    var now = staged.lines[id] ? Number(staged.lines[id].quantity) || 0 : was;
    var want = Math.max(0, Math.min(20, now + by));
    staged.lines[id] = { quantity: want, name: String(name || (staged.lines[id] || {}).name || "") };
    /* Back where it started is not a change at all, so it stops being one. */
    if (want === was) delete staged.lines[id];
  }

  /*
   * Past the minute, but still something a person could say yes to.
   *
   * The shop's own reasons, from customer-order.service: too_late is the
   * kitchen having had it a while, which is precisely the case a request is
   * for. Everything else - billed, paid, cancelled, refused, a total with a
   * hotel's cut in it - is the counter's, and asking would only be refused.
   */
  function canStillAsk(said) {
    if (!said || said.cancelled || said.paid) return false;
    return String(said.why_not || "") === "too_late";
  }

  /* What the shop last said this order is. Staging is relative to it, and
     the screen is repainted from it on every tap without asking again. */
  var lastSaid = null;

  function paintPlacedOrder(said) {
    lastSaid = said;
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

    /* Which the buttons are now: their own order, or a wish a person answers.
       Said once, above the lines, because a plus that quietly becomes a
       request is a plus that gets tapped twice. */
    var mode = el("placed-mode");
    if (mode) {
      var asking = !said.can_change && canStillAsk(said);
      mode.hidden = !asking;
      if (asking) mode.textContent = say("The kitchen has it. A change now goes to the shop to confirm.");
    }

    stageFor(placedOrder.id);
    var lines = el("placed-lines");
    if (lines) {
      lines.textContent = "";
      /* The order as the shop has it, plus anything staged that is not on
         it yet, so a line being added is visible before it is sent. */
      var drawing = (said.items || []).map(function (line) {
        return {
          item_id: String(line.item_id || ""),
          name: String(line.name || ""),
          quantity: Number(line.quantity) || 0
        };
      });
      var already = {};
      drawing.forEach(function (line) { already[line.item_id] = true; });
      Object.keys(staged.lines).forEach(function (id) {
        if (!already[id]) drawing.push({ item_id: id, name: staged.lines[id].name, quantity: 0 });
      });

      drawing.forEach(function (line) {
        var want = staged.lines[line.item_id]
          ? Number(staged.lines[line.item_id].quantity) || 0
          : line.quantity;
        var row = document.createElement("li");
        /* Marked, so the customer can see what they have moved before
           they send it - including a line taken down to nothing, which
           stays on screen so it can be put back. */
        if (staged.lines[line.item_id]) {
          row.setAttribute("data-staged", want === 0 ? "gone" : "moved");
        }
        var qty = document.createElement("span");
        qty.className = "placed-line-qty";
        qty.textContent = String(want) + "\u00d7";
        var name = document.createElement("span");
        name.className = "placed-line-name";
        name.textContent = String(line.name || "");
        row.appendChild(qty);
        row.appendChild(name);
        /*
         * STEPPERS STAY PAST THE WINDOW, and become a request.
         *
         * Owner: "after that show animation and order details page. if user
         * want can edit it", and earlier "60 seconds. after than only can
         * request. request will go to cpatain app or desktop app."
         *
         * They used to disappear the moment the minute ran out, which left a
         * screen offering nothing but Cancel - a strange thing to show
         * somebody whose actual wish is one more naan, and the exact
         * complaint that started this. The server has taken changes as
         * requests past the window since then; nothing on the phone could
         * reach it. So the controls stay, and the words above them say which
         * they are now.
         *
         * Off entirely only when the order is genuinely beyond asking: paid,
         * billed, cancelled, or somebody else's money in the total. The shop
         * names that in why_not, and the answer to those is the counter.
         */
        if (said.can_change || canStillAsk(said)) {
          [
            [-1, "\u2212", "One less {name}"],
            [1, "+", "One more {name}"]
          ].forEach(function (step) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "placed-step";
            button.setAttribute("data-item", String(line.item_id || ""));
            /* WHICH WAY, not what to send. The quantity is worked out when
               the customer confirms, from what they have staged - a button
               carrying a fixed number could only ever be pressed once. */
            button.setAttribute("data-by", String(step[0]));
            button.setAttribute("data-name", String(line.name || ""));
            button.setAttribute("aria-label", say(step[2], { name: line.name }));
            button.textContent = step[1];
            row.appendChild(button);
          });
        }
        lines.appendChild(row);
      });
    }

    /*
     * NOTHING IS SENT UNTIL THIS IS PRESSED.
     *
     * Owner: "customer cant change in one touch. after changes. he need to
     * review and click confirmation."
     *
     * Every plus went straight to the shop, which put one tap between a
     * thumb and a kitchen cooking something nobody ordered, and gave the
     * customer nothing to look at before committing. The bar appears only
     * once something has actually moved, says how much is waiting, and
     * sends the whole edit in ONE request.
     */
    var bar = el("placed-confirm-bar");
    if (bar) {
      var pending = stagedChanges(said).length;
      bar.hidden = pending === 0;
      var go = el("placed-confirm");
      if (go) {
        go.textContent = said.can_change
          ? say("Confirm the change")
          : say("Ask the shop for this change");
      }
      var count = el("placed-confirm-count");
      if (count) {
        count.textContent =
          pending === 1 ? say("1 line changed") : say("{n} lines changed", { n: pending });
      }
    }

    /* Something alongside, while there is still time to add it. */
    var more = el("placed-more");
    var row = el("placed-more-row");
    var suggestions = said.can_change || canStillAsk(said) ? goesWith(said.items || []) : [];
    if (more && row) {
      row.textContent = "";
      suggestions.forEach(function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "placed-more-item";
        button.setAttribute("data-add", String(item.id));
        button.setAttribute("data-name", String(item.name || ""));
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

  /**
   * Draw what the shop just said, and only ask again if it said too little.
   *
   * A change answers with the whole order now (customer-order.service,
   * viewOf), so the ordinary path costs one request per tap instead of two.
   * The fallback is kept because an older server, or a refusal, answers with
   * nothing worth drawing - and a screen that does not redraw at all is the
   * bug this replaced.
   */
  async function redraw(said) {
    if (said && !said.failed && Array.isArray(said.items) && said.can_change !== undefined) {
      paintPlacedOrder(said);
      return;
    }
    await showPlacedOrder();
  }

  /** Ask the shop, then draw. */
  async function showPlacedOrder() {
    var said = await readPlaced();
    report(
      "order screen",
      said
        ? (said.items || []).length + " lines, can_change " + said.can_change
        : "the shop said nothing - id " + (placedOrder.id || "(none)") + ", token " + (state.placed || "(none)")
    );
    paintPlacedOrder(said);
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
    report("order placed", "token " + String(token || "") + ", id " + (placedOrder.id || "(none)"));
    if (art) {
      var box = art.getBoundingClientRect ? art.getBoundingClientRect() : { width: 0, height: 0 };
      /* The size the canvas actually has on screen. A scene drawn into a box
         with no height is a scene nobody sees, and it looks from the outside
         exactly like an animation that never ran. */
      report("canvas", Math.round(box.width) + " x " + Math.round(box.height));
    }
    if (window.KitchenScene && art) {
      placedStop = window.KitchenScene.play(art, {
        still: options && options.still,
        onBeat: function (beat) {
          if (art.setAttribute) art.setAttribute("data-stage", beat);
          if (said && PLACED_WORDS[beat]) said.textContent = say(PLACED_WORDS[beat]);
          /* The bell in the drawing is struck on this beat, so the sound
             belongs to it: one event, not a picture and a noise. */
          if (beat === "landed") ting();
          /* The kitchen has it and somebody is cooking it: from here the
             sheet belongs to the order, not to the animation. */
          if (beat === "cooking") showPlacedOrder();
        },
      });
    } else if (said) {
      /* No scene to draw: the words still arrive, on their own clock, and so
         does the bell. Nothing a customer is told depends on a canvas. */
      clearTimeout(placedTimer);
      ting();
      var after = options && typeof options.after === "number" ? options.after : 1800;
      placedTimer = setTimeout(function () {
        said.textContent = say(PLACED_WORDS.cooking);
        showPlacedOrder();
      }, after);
    }
  }

  /* One short bell, when the kitchen takes the order. assets/ting.js; absent
     on a page that does not load it, which is not worth an error. */
  function ting() {
    try {
      if (window.Ting && typeof window.Ting.play === "function") window.Ting.play();
    } catch (e) {
      /* A confirmation nobody can hear is still a confirmation on screen. */
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

  /*
   * TALK, OR TYPE - ASKED BEFORE EITHER HAPPENS.
   *
   * Owner: "have ai talk button seperate, type button seperate. or in own
   * button show choice talk or message. coz when user try to talk half
   * screen showing keypad. not good."
   *
   * This used to open onto a text box and put the cursor in it, which raises
   * the keyboard over half the screen before the customer has said what they
   * want to do - and if what they wanted was to talk, the keyboard was in the
   * way of the only thing they came for. The microphone sat beside the box as
   * a small button, which reads as the afterthought rather than the feature.
   *
   * So the choice comes first, and the keyboard appears only for somebody who
   * asked to type. A shop without voice has no choice to make and goes
   * straight to the box, as before.
   */
  function canTalk() {
    try {
      var mode = window.OrderingVoice && window.OrderingVoice.voiceMode
        ? window.OrderingVoice.voiceMode()
        : "";
      return !!mode;
    } catch (e) {
      return false;
    }
  }

  function chooseHow(on) {
    var box = el("assistant-choose");
    var form = el("assistant-form");
    var chips = el("assistant-chips");
    if (box) box.hidden = !on;
    if (form) form.hidden = !!on;
    if (chips) chips.hidden = !!on;
  }

  /** They said type: the box, the cursor, and the keyboard they asked for. */
  function typeInstead() {
    chooseHow(false);
    var input = el("assistant-input");
    if (input) setTimeout(function () { input.focus(); }, 60);
  }

  function open() {
    var sheet = el("assistant");
    if (!sheet) return;
    greet();
    paintReview();
    if (typeof sheet.showModal === "function" && !sheet.open) sheet.showModal();
    if (canTalk()) {
      /* NOTHING IS FOCUSED. A focused text box is a keyboard, and a customer
         who came to talk has not asked for one. */
      chooseHow(true);
    } else {
      typeInstead();
    }
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
    /*
     * ONE BUTTON, AND IT SENDS.
     *
     * It used to walk the customer to the basket page to place it from there.
     * Owner: "have 'confirm & send order'. if user click say thank you and
     * send it to kitchen ... i believe one enought. since we give 1 minute to
     * modify item."
     *
     * Through OrderingVoice where a line is open, because that is what knows
     * how to read the token back and open the order screen; through the
     * basket page only where there is no voice to do it.
     */
    var review = el("assistant-review");
    if (review) {
      review.addEventListener("click", async function () {
        if (review.disabled) return;
        working(review, true);
        try {
          var voice = window.OrderingVoice;
          if (!voice || typeof voice.sendNow !== "function") {
            window.OrderingAssistant.leave("cart.html");
            return;
          }
          var done = await voice.sendNow();
          if (done && done.ok) return;
          /*
           * It could not go, and WHY decides what happens next.
           *
           * The small question - how the food travels - is asked right here,
           * because it is one tap and walking somebody to another page for it
           * is what made this feel broken. Everything else is a form with a
           * keyboard and validation behind it, and rebuilding those in a
           * sheet is how two versions of the same form drift apart; for those
           * the page changes, but not before the customer is told why.
           */
          if (done && done.reason === "need_fulfilment") {
            askTheWay(done.options || []);
            return;
          }
          if (done && done.reason === "below_minimum") {
            actionLine(say("This shop's smallest order that way is {amount}.", {
              amount: typeof money === "function" ? money(done.minimum) : done.minimum // eslint-disable-line no-undef
            }));
            return;
          }
          if (done && done.reason === "empty_order") {
            actionLine(say("Nothing to send yet."));
            return;
          }
          actionLine(say("A few details are needed to finish this order."));
          window.OrderingAssistant.leave("cart.html");
        } finally {
          working(review, false);
        }
      });
    }

    /* One tap on how it travels, and it goes. */
    var waysRow = el("assistant-ways-row");
    if (waysRow) {
      waysRow.addEventListener("click", async function (event) {
        var pick = event.target && event.target.closest ? event.target.closest(".assistant-way") : null;
        if (!pick) return;
        [].forEach.call(waysRow.querySelectorAll("button"), function (b) {
          working(b, b === pick);
          b.disabled = true;
        });
        var voice = window.OrderingVoice;
        var done = voice && voice.sendNow ? await voice.sendNow(pick.getAttribute("data-way")) : null;
        var box = el("assistant-ways");
        if (done && done.ok) {
          if (box) box.hidden = true;
          return;
        }
        /* Still refused, and now for a reason this screen cannot ask about. */
        if (box) box.hidden = true;
        actionLine(say("A few details are needed to finish this order."));
        window.OrderingAssistant.leave("cart.html");
      });
    }

    /* Back to the menu, with the sheet left open behind it: the customer is
       adding to the order they are in the middle of, not starting again. */
    var add = el("assistant-add");
    if (add) add.addEventListener("click", function () { close(); });

    /* Something alongside, added by hand. */
    var moreRow = el("assistant-more-row");
    if (moreRow) {
      moreRow.addEventListener("click", async function (event) {
        var chip = event.target && event.target.closest ? event.target.closest(".assistant-more-item") : null;
        if (!chip) return;
        working(chip, true);
        await apply([{ verb: "add", item_id: chip.getAttribute("data-add"), quantity: 1 }]);
        working(chip, false);
      });
    }
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

        /*
         * A TAP MOVES A NUMBER ON THIS SCREEN. Nothing leaves the phone
         * until Confirm is pressed - see stageStep and the bar below.
         */
        var step = target.closest(".placed-step");
        if (step) {
          stageStep(
            lastSaid,
            step.getAttribute("data-item"),
            step.getAttribute("data-name"),
            Number(step.getAttribute("data-by")) || 0
          );
          paintPlacedOrder(lastSaid);
          return;
        }

        /* Everything staged, in one request. */
        var confirm = target.closest("#placed-confirm");
        if (confirm) {
          var wanted = stagedChanges(lastSaid);
          if (!wanted.length) return;
          working(confirm, true);
          var moved = await changePlaced("items", { items: wanted });
          working(confirm, false);
          if (moved && moved.failed) {
            actionLine(say(refusal(moved.failed)));
            /* Kept, not thrown away: the customer can try again or undo it
               themselves rather than rebuild an edit the shop refused. */
            await redraw(lastSaid);
            return;
          }
          dropStaged();
          if (moved && moved.requested) actionLine(say("The shop has been asked to change it"));
          else actionLine(say("Your order has been changed"));
          await redraw(moved);
          return;
        }

        /* Put it back the way the shop has it. */
        var undo = target.closest("#placed-discard");
        if (undo) {
          dropStaged();
          paintPlacedOrder(lastSaid);
          return;
        }

        var add = target.closest(".placed-more-item");
        if (add) {
          /* Staged like any other change, so one Confirm covers "two more of
             this and a lime soda" rather than sending them one at a time. */
          stageStep(lastSaid, add.getAttribute("data-add"), add.getAttribute("data-name"), 1);
          paintPlacedOrder(lastSaid);
          return;
        }

        var off = target.closest(".placed-cancel");
        if (off) {
          working(off, true);
          var called = await changePlaced("cancel", {});
          working(off, false);
          if (called && called.failed) actionLine(say(refusal(called.failed)));
          else if (called && called.requested) actionLine(say("The shop has been asked to cancel it"));
          else actionLine(say("Order cancelled"));
          await redraw(called);
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
        /* And the assistant is told. It is listening at the bottom of this
           same screen, and one that cannot see a thumb reads back a quantity
           the customer has just corrected. Owner: "AI should know about the
           changes what user doing. its kind of helper too." */
        await tellVoice(id);
      });
    }
    /* The choice, once. Talk hands straight to the line without ever
       focusing the box; Type asks for the keyboard on purpose. */
    var pickTalk = el("assistant-choose-talk");
    if (pickTalk) {
      pickTalk.addEventListener("click", function () {
        chooseHow(false);
        var talk = el("assistant-talk");
        if (talk) talk.click();
      });
    }
    var pickType = el("assistant-choose-type");
    if (pickType) pickType.addEventListener("click", typeInstead);

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

  window.OrderingAssistant = { chooseHow: chooseHow, typeInstead: typeInstead, send: send, open: open, close: close, paintSpark: paintSpark, apply: apply, bubble: bubble, actionLine: actionLine, typing: typing, paintReview: paintReview, paintOrderList: paintOrderList, placedPanel: placedPanel, placedDone: placedDone, hidePlaced: hidePlaced, showPlacedOrder: showPlacedOrder, goesWith: goesWith, refusal: refusal, showOrderInstead: showOrderInstead, placedLine: placedLine, leave: leave, state: state };
})();
