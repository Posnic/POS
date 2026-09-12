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
  var state = { messages: [], busy: false, greeted: false, landed: false };

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
    if (typeof sheet.showModal === "function" && !sheet.open) sheet.showModal();
    var input = el("assistant-input");
    if (input) setTimeout(function () { input.focus(); }, 60);
    scrollLog();
  }

  function close() {
    var sheet = el("assistant");
    if (sheet && sheet.open) sheet.close();
  }

  function wire() {
    var spark = el("ask-ai");
    if (!spark) return;
    spark.addEventListener("click", open);
    var hintOpen = el("assistant-hint-open");
    if (hintOpen) hintOpen.addEventListener("click", open);
    var hintClose = el("assistant-hint-close");
    if (hintClose) hintClose.addEventListener("click", function () { hideHint(true); });
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

  window.OrderingAssistant = { send: send, open: open, close: close, paintSpark: paintSpark, apply: apply, bubble: bubble, actionLine: actionLine, typing: typing, state: state };
})();
