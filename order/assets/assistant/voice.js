/*
 * Talk to order.
 *
 * A microphone beside the assistant's title. Tap it and you talk to the
 * shop's assistant the way you would talk to a waiter, and it talks back.
 *
 * TWO WAYS, ONE CONVERSATION. Where the shop's provider can hold a live
 * line (OpenAI today), the phone opens a WebRTC call straight to it: the
 * customer can interrupt, the reply starts before the sentence is over,
 * and the model calls the page's tools to add or remove things. Where it
 * cannot, the page listens with the phone's own recogniser, asks the
 * typed assistant, and reads the answer aloud with the phone's own voice:
 * a beat slower, no interruptions, no extra cost.
 *
 * WHAT THE MODEL CAN AND CANNOT DO. On the live line it asks for
 * add_to_order, remove_from_order, set_quantity or show_order; the page
 * checks the item is on this menu, applies the change through the same
 * code a tap on "Add" uses (badge, bill bar, chip counts), writes a line
 * into the conversation, and tells the model what happened. The model
 * never touches the order itself. The audio goes phone to provider; our
 * server only opens the line and never hears a word.
 */
(function () {
  "use strict";

  var el = function (id) {
    return document.getElementById(id);
  };
  function say(key, vars) {
    if (typeof window.t === "function") return window.t(key, vars);
    return String(key).replace(/\{(\w+)\}/g, function (m, name) {
      return vars && vars[name] != null ? String(vars[name]) : m;
    });
  }
  function apiBase() {
    return String((window.CONFIG && window.CONFIG.API_BASE_URL) || "").replace(/\/$/, "");
  }
  function shopNow() {
    try {
      if (typeof shop === "object" && shop) return shop; // eslint-disable-line no-undef
    } catch (e) {
      /* not declared on this page */
    }
    return window.shop || null;
  }
  function assistant() {
    return window.OrderingAssistant || null;
  }
  function lang() {
    return (window.i18n && window.i18n.lang) || "en";
  }

  var live = { active: false, mode: "", pc: null, dc: null, stream: null, pendingStream: null, rec: null, speaking: false, beta: false, heardLanguage: "", session: "", branch: "", meter: null, misses: 0, greeted: false, placed: "", leaving: false, leaveTimer: 0, placedId: "" };

  /* ------------------------------------------------------------ the button */

  function voiceMode() {
    var s = shopNow();
    var mode = s && s.voice ? String(s.voice) : "";
    if (mode === "live") {
      var can = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
      return can ? "live" : hasRecognizer() ? "turns" : "";
    }
    if (mode === "turns") return hasRecognizer() ? "turns" : "";
    return "";
  }
  function hasRecognizer() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function paintTalk() {
    var button = el("assistant-talk");
    if (!button) return;
    button.hidden = !voiceMode();
  }

  /* ------------------------------------------------------------- the state */

  function status(state, text) {
    var a = assistant();
    if (a && a.showOrderInstead) a.showOrderInstead(!!state);
    var panel = el("voice");
    var orb = el("voice-orb");
    var line = el("voice-status");
    var sheet = el("assistant");
    if (panel) panel.hidden = !state;
    if (orb) orb.setAttribute("data-state", state || "");
    if (line) line.textContent = text || "";
    if (sheet) sheet.setAttribute("data-voice", state ? "on" : "off");
    var button = el("assistant-talk");
    if (button) button.setAttribute("aria-pressed", state ? "true" : "false");
  }

  function note(text) {
    var a = assistant();
    if (a && a.bubble) a.bubble("ai", text);
  }

  /* --------------------------------------------------------- the tools */

  /*
   * A dish by id, from the page's own catalogue. allProducts() is the
   * page-wide list (indexedDB.js, global); findProduct() lives inside the
   * products script's closure and is NOT visible here, which is how every
   * add once came back "not on this menu" on the real page.
   */
  function catalogue() {
    try {
      if (typeof allProducts === "function") return allProducts() || []; // eslint-disable-line no-undef
    } catch (e) {
      /* no catalogue on this page */
    }
    return [];
  }

  function byId(id) {
    var wanted = String(id);
    var all = catalogue();
    for (var i = 0; i < all.length; i++) {
      if (all[i] && String(all[i].id) === wanted) return all[i];
    }
    try {
      if (typeof findProduct === "function") return findProduct(wanted) || null; // eslint-disable-line no-undef
    } catch (e) {
      /* not on this page either */
    }
    return null;
  }

  /* Letters and digits only, lower case, one space between words. */
  function plain(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, " ")
      .trim();
  }

  /* Edits between two short words, transpositions counted once: "briyani"
     is one step from "biryani", "tikka" one from "tika". */
  function edits(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    var rows = [];
    for (var i = 0; i <= la; i++) {
      rows[i] = [i];
    }
    for (var j = 1; j <= lb; j++) rows[0][j] = j;
    for (i = 1; i <= la; i++) {
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          best = Math.min(best, rows[i - 2][j - 2] + 1);
        }
        rows[i][j] = best;
      }
    }
    return rows[la][lb];
  }

  function wordMatches(word, other) {
    if (word === other) return true;
    var slack = word.length >= 6 ? 2 : word.length >= 4 ? 1 : 0;
    return slack > 0 && edits(word, other) <= slack;
  }

  /* How well the customer's words fit an item's name: the share of their
     words found in it, less a little for every word of the name they did
     not say, so "chicken" alone prefers the shortest chicken dish. */
  function fit(asked, name) {
    var said = plain(asked).split(" ").filter(Boolean);
    var has = plain(name).split(" ").filter(Boolean);
    if (!said.length || !has.length) return 0;
    var hit = 0;
    var used = {};
    for (var i = 0; i < said.length; i++) {
      for (var j = 0; j < has.length; j++) {
        if (!used[j] && wordMatches(said[i], has[j])) {
          used[j] = true;
          hit++;
          break;
        }
      }
    }
    if (!hit) return 0;
    var unsaid = has.length - hit;
    return hit / said.length - unsaid * 0.1;
  }

  /* The items closest to what was asked, best first, above `floor`. */
  function nearest(asked, limit, floor) {
    var all = catalogue();
    var scored = [];
    var least = typeof floor === "number" ? floor : 0.3;
    for (var i = 0; i < all.length; i++) {
      var item = all[i];
      if (!item || !item.name) continue;
      var score = fit(asked, item.name);
      if (score >= least) scored.push({ item: item, score: score });
    }
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return scored.slice(0, limit || 3);
  }

  /*
   * A dish by id, else by the words the customer used. The model is asked
   * for exact ids and usually sends them; when it sends a name, a guess, or
   * an id from an older menu, the customer's own words settle it - and if
   * they do not settle it, the nearest names go back so the model can ask.
   */
  function findItem(id, asked) {
    var exact = byId(id);
    if (exact) return exact;
    var words = String(asked || "").trim() || String(id || "").replace(/[_-]+/g, " ");
    /* Picked only when most of the words fit and nothing else comes close;
       "chicken tikka" must never quietly become Chicken Biryani. */
    var close = nearest(words, 3, 0.6);
    if (!close.length) return null;
    if (close.length === 1 || close[0].score - close[1].score >= 0.25) return close[0].item;
    return null;
  }

  function brief(item) {
    var out = { item_id: String(item.id), name: item.name, price: Number(item.price) || 0 };
    if (item.available === false) out.available = false;
    return out;
  }

  async function cartSummary() {
    try {
      var cart = await getCartData(); // eslint-disable-line no-undef
      var lines = (cart || []).map(function (l) {
        return { item_id: l.id, name: l.name, quantity: l.quantity, note: l.note || "" };
      });
      var total = (cart || []).reduce(function (s, l) {
        return s + Number(l.price || 0) * Number(l.quantity || 0);
      }, 0);
      return { lines: lines, total: Math.round(total * 100) / 100 };
    } catch (e) {
      return { lines: [], total: 0 };
    }
  }

  /*
   * The model asked for something; the page decides and answers. Every
   * answer carries the order as it stands, so the model reads back what IS
   * there and not what it meant to do; a refusal says why and what is close.
   */
  async function runTool(name, args) {
    var a = assistant();
    if (name === "show_order") return { ok: true, order: await cartSummary() };
    if (name === "send_to_kitchen") return sendToKitchen(args);
    if (name === "change_placed_order") return changePlacedOrder(args);
    if (name === "cancel_placed_order") return cancelPlacedOrder(args);
    var id = String((args && args.item_id) || "");
    var asked = String((args && args.asked) || "").replace(/\s+/g, " ").trim().slice(0, 80);
    var item = findItem(id, asked);
    if (!item) {
      return {
        ok: false,
        reason: "not_on_menu",
        asked: asked || id,
        nearest: nearest(asked || id.replace(/[_-]+/g, " "), 3).map(function (n) { return brief(n.item); }),
        order: await cartSummary()
      };
    }
    if (name !== "remove_from_order" && item.available === false) {
      return { ok: false, reason: "not_available_today", item: item.name, asked: asked || id, order: await cartSummary() };
    }
    var quantity = Math.min(20, Math.max(1, Math.round(Number(args && args.quantity) || 1)));
    var action = { item_id: String(item.id), name: item.name, quantity: quantity };
    if (name === "add_to_order") action.verb = "add";
    else if (name === "remove_from_order") { action.verb = "remove"; action.quantity = 0; }
    else if (name === "set_quantity") action.verb = "set";
    else return { ok: false, reason: "unknown_tool" };
    var noteText = String((args && args.note) || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (noteText && action.verb !== "remove") action.note = noteText;
    if (a && a.apply) await a.apply([action]);
    var done = { ok: true, did: action.verb === "add" ? "added" : action.verb === "remove" ? "removed" : "set", item: item.name, item_id: String(item.id), quantity: action.quantity };
    if (noteText && action.verb !== "remove") done.note = noteText;
    done.order = await cartSummary();
    return done;
  }

  /*
   * All of a response's tool calls, run in order once the response is DONE,
   * answered together, and ONE response.create after. Answering each call as
   * its arguments arrived sent a response.create per call; the second one
   * met a response already running and was refused, and the model read back
   * one item of two ("i said chicken briyani and chicken tikka ... it said
   * only chicken tikka").
   */
  async function runToolCalls(response) {
    var items = (response && response.output) || [];
    var calls = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].type === "function_call" && items[i].call_id) calls.push(items[i]);
    }
    if (!calls.length) return false;
    for (i = 0; i < calls.length; i++) {
      var args = {};
      try {
        args = JSON.parse(calls[i].arguments || "{}");
      } catch (e) {
        args = {};
      }
      var output = await runTool(calls[i].name, args);
      sendEvent({ type: "conversation.item.create", item: { type: "function_call_output", call_id: calls[i].call_id, output: JSON.stringify(output) } });
    }
    sendEvent({ type: "response.create" });
    return true;
  }

  /* ------------------------------------------------------------ the ears */

  /*
   * Which script a transcript came back in. This page speaks English and
   * Tamil; a transcript in Malayalam, Kannada, Telugu, Hindi or Urdu is
   * Tamil speech the transcriber guessed wrong ("i keep talking in tamil
   * only but i see text in different different languages"), and the cue to
   * stop it guessing.
   */
  function scriptOf(text) {
    var s = String(text || "");
    var tamil = (s.match(/[\u0B80-\u0BFF]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    var other = (s.match(/[\u0600-\u06FF\u0900-\u0B7F\u0C00-\u0DFF]/g) || []).length;
    if (tamil && tamil >= other) return "tamil";
    if (other > latin) return "other";
    return "latin";
  }

  /*
   * The assistant speaks first. A line that opens in silence leaves the
   * customer wondering whether anything is listening; a waiter says
   * "welcome" before anyone orders. One system note tells the model the
   * line is open and one response.create asks it to speak. Once per line.
   */
  function greetFirst() {
    if (live.greeted) return;
    live.greeted = true;
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: "The line has just opened. Say your OPENING LINE now, in one sentence, in the page's language, then wait for the customer." }],
      },
    });
    sendEvent({ type: "response.create" });
  }

  /* Tell the line to hear Tamil from now on. Once. */
  function lockTamil() {
    if (live.heardLanguage) return;
    live.heardLanguage = "ta";
    if (live.beta) {
      sendEvent({ type: "session.update", session: { input_audio_transcription: { model: "whisper-1", language: "ta" } } });
    } else {
      sendEvent({ type: "session.update", session: { type: "realtime", audio: { input: { transcription: { model: "gpt-4o-mini-transcribe", language: "ta" } } } } });
    }
  }

  /* Errors the line cannot come back from; anything else is logged and the
     conversation goes on. Stopping on every error event ended a call over a
     refused duplicate response.create. */
  function fatalError(error) {
    var code = String((error && (error.code || error.type)) || "").toLowerCase();
    return /session|expired|invalid_api_key|insufficient_quota|rate_limit|unauthori[sz]ed|forbidden/.test(code);
  }

  /* ------------------------------------------------- send to kitchen */

  var WAY_WORD = { dine_in: "DINE IN", takeaway: "PARCEL", pickup: "PARCEL", delivery: "PARCEL" };

  function servicePoint() {
    try {
      return window.KioskServicePoint && window.KioskServicePoint.read ? window.KioskServicePoint.read() : null;
    } catch (e) {
      return null;
    }
  }

  function switchedOn(value) {
    if (value === true || value === 1) return true;
    if (value && typeof value === "object") {
      return switchedOn(value.enabled != null ? value.enabled : value.status != null ? value.status : value.value);
    }
    return typeof value === "string" && ["true", "1", "on", "yes", "enabled", "active", "checked"].indexOf(value.trim().toLowerCase()) !== -1;
  }

  /* Whether paying at the counter, on delivery or when collecting is
     allowed: the server says (payment.offline); an older answer is read the
     way the payment page reads it, cash switched on or no gateway at all. */
  function offlineAllowed(payment) {
    if (payment && typeof payment.offline === "boolean") return payment.offline;
    var razorpay = false;
    var cash = false;
    Object.keys(payment || {}).forEach(function (key) {
      var plain = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (/razorpay/.test(plain) && switchedOn(payment[key])) razorpay = true;
      if ((/cash/.test(plain) || plain === "cod") && switchedOn(payment[key])) cash = true;
    });
    return cash || !razorpay;
  }

  /* The shop asks every order for a phone number; the assistant never does. */
  function phoneWanted(payment) {
    return !!payment && (switchedOn(payment.number) || switchedOn(payment.payment_number));
  }

  function waysOffered() {
    var s = shopNow();
    var list = s && Array.isArray(s.fulfilment) ? s.fulfilment : [];
    return list.map(String).filter(function (w) {
      return !!WAY_WORD[w];
    });
  }

  /* How the food travels: the code that was scanned decides first (a table
     or a room is dining in), then what the customer told the assistant,
     then what was chosen earlier, then the one way the shop offers. */
  function resolveWay(asked) {
    var point = servicePoint();
    if (point && (point.table || point.venue)) return "dine_in";
    var offered = waysOffered();
    var want = String(asked || "").trim();
    if (!want) {
      try {
        want = String(localStorage.getItem("order_fulfilment") || "");
      } catch (e) {
        want = "";
      }
    }
    if (want && WAY_WORD[want] && (!offered.length || offered.indexOf(want) !== -1)) return want;
    if (offered.length === 1) return offered[0];
    return "";
  }

  /*
   * The order goes to the kitchen through the same checkout a tap on "Place
   * order" uses, under the same rules: the way it travels is known, paying
   * at the counter is allowed, nothing the page must ask for (a phone
   * number, an address, an online payment) is wanted, and the order is big
   * enough for that way. Anything the page must ask for is handed to the
   * Review order button under the conversation, and the model is told
   * exactly why so it can say so. The customer's clear yes is the model's
   * to obtain; confirmed:false places nothing.
   */
  async function sendToKitchen(args) {
    var order = await cartSummary();
    if (!order.lines.length) return { ok: false, reason: "empty_order", order: order };
    if (!(args && args.confirmed === true)) return { ok: false, reason: "not_confirmed", order: order };
    var way = resolveWay(args && args.fulfilment);
    if (!way) return { ok: false, reason: "need_fulfilment", options: waysOffered(), order: order };
    if (way === "delivery") return { ok: false, reason: "needs_details", next: "review", order: order };
    var s = shopNow();
    var payment = (s && s.payment) || {};
    if (!offlineAllowed(payment)) return { ok: false, reason: "pay_online", next: "review", order: order };
    if (phoneWanted(payment)) return { ok: false, reason: "needs_phone", next: "review", order: order };
    var point = servicePoint();
    try {
      if (way === "dine_in" && !(point && (point.table || point.venue))) {
        var table = String((args && args.table) || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
        if (!table) return { ok: false, reason: "need_table", order: order };
        localStorage.setItem("order_table", table);
      } else {
        localStorage.removeItem("order_table");
      }
      if (typeof chargeFor === "function") { // eslint-disable-line no-undef
        var charge = chargeFor(way, order.total); // eslint-disable-line no-undef
        if (charge && charge.allowed === false) {
          return { ok: false, reason: "below_minimum", minimum: charge.minimum, short: charge.short, order: order };
        }
      }
      localStorage.setItem("order_fulfilment", way);
      localStorage.setItem("orderType", WAY_WORD[way]);
    } catch (e) {
      /* a browser that keeps nothing still places the order below */
    }
    if (typeof checkout !== "function") return { ok: false, reason: "not_placed", next: "review", order: order }; // eslint-disable-line no-undef
    var placed = null;
    try {
      placed = await checkout("", "Cash", { stay: true }); // eslint-disable-line no-undef
    } catch (e) {
      placed = null;
    }
    if (!placed || !placed.token) return { ok: false, reason: "not_placed", next: "review", order: order };
    live.placed = String(placed.token);
    live.placedId = String(placed.saleId || "");
    var a = assistant();
    if (a && a.placedLine) a.placedLine(live.placed);
    return {
      ok: true,
      token: live.placed,
      total: order.total,
      way: way,
      pay: way === "dine_in" ? "at the counter" : "when collecting",
      order: order
    };
  }

  /*
   * The order has gone, and the customer has changed their mind.
   *
   * The server decides whether it is still theirs to move - billed, paid,
   * refused, or simply too late - and names the reason so the assistant can
   * say which it is rather than inventing one. A dish they think of AFTER
   * sending is not a change; it is a second ticket, which the model sends
   * with add_to_order and send_to_kitchen again.
   */
  async function placedOrderCall(what, body) {
    if (!live.placedId || !live.placed) return { ok: false, reason: "nothing_placed" };
    var branch = "";
    try {
      branch = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      branch = "";
    }
    if (!branch) return { ok: false, reason: "no_shop" };
    try {
      var response = await fetch(
        apiBase() + "/online-ordering/" + encodeURIComponent(branch) + "/orders/" + encodeURIComponent(live.placedId) + "/" + what,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(Object.assign({ token: live.placed }, body || {}))
        }
      );
      var answer = null;
      try {
        answer = await response.json();
      } catch (e) {
        answer = null;
      }
      if (!response.ok || !answer || answer.type !== "success") {
        return { ok: false, reason: String((answer && answer.message) || "not_changed") };
      }
      return { ok: true, data: (answer && answer.data) || {} };
    } catch (e) {
      return { ok: false, reason: "not_changed" };
    }
  }

  /* The cart on this phone, brought back in step with what the shop now holds,
     so the sheet shows the order as it really is. */
  async function matchCartTo(lines) {
    var a = assistant();
    if (!a || !a.apply) return;
    var actions = [];
    (lines || []).forEach(function (line) {
      actions.push({ verb: "set", item_id: String(line.item_id || ""), name: String(line.name || ""), quantity: Number(line.quantity) || 0 });
    });
    var have = await cartSummary();
    have.lines.forEach(function (line) {
      var still = (lines || []).some(function (l) {
        return String(l.item_id) === String(line.item_id);
      });
      if (!still) actions.push({ verb: "remove", item_id: String(line.item_id), name: String(line.name || ""), quantity: 0 });
    });
    if (actions.length) await a.apply(actions);
  }

  async function changePlacedOrder(args) {
    var wanted = (args && args.items) || [];
    if (!wanted.length) return { ok: false, reason: "nothing_asked" };
    var asked = [];
    for (var i = 0; i < wanted.length; i++) {
      var id = String((wanted[i] && wanted[i].item_id) || "");
      var found = id ? byId(id) : null;
      if (!found) {
        var near = nearest(String((wanted[i] && wanted[i].asked) || id.replace(/[_-]+/g, " ")), 3);
        if (!near.length) return { ok: false, reason: "not_on_this_order", asked: id };
        found = near[0].item;
      }
      asked.push({ item_id: String(found.id), quantity: Math.max(0, Math.min(20, Math.round(Number(wanted[i].quantity) || 0))) });
    }
    var done = await placedOrderCall("items", { items: asked });
    if (!done.ok) return { ok: false, reason: done.reason, token: live.placed };
    await matchCartTo(done.data.items || []);
    var a = assistant();
    if (a && a.actionLine) a.actionLine(say("Order changed"));
    return { ok: true, token: live.placed, order: { lines: done.data.items || [], total: done.data.total } };
  }

  async function cancelPlacedOrder(args) {
    if (!(args && args.confirmed === true)) return { ok: false, reason: "not_confirmed" };
    var done = await placedOrderCall("cancel", {});
    if (!done.ok) return { ok: false, reason: done.reason, token: live.placed };
    await matchCartTo([]);
    live.placed = "";
    live.placedId = "";
    var a = assistant();
    if (a && a.actionLine) a.actionLine(say("Order cancelled"));
    return { ok: true, cancelled: true };
  }

  function leave(url) {
    window.location.href = url;
  }

  /* ----------------------------------------------------------- live line */

  function sendEvent(payload) {
    if (live.dc && live.dc.readyState === "open") live.dc.send(JSON.stringify(payload));
  }

  async function onEvent(message) {
    var ev;
    try {
      ev = JSON.parse(message.data);
    } catch (e) {
      return;
    }
    var a = assistant();
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        status("listening", say("Listening..."));
        break;
      case "conversation.item.input_audio_transcription.completed": {
        var heard = String(ev.transcript || "").trim();
        if (!heard) break;
        var script = scriptOf(heard);
        if (script === "tamil") lockTamil();
        if (script === "other") {
          /* Tamil written down in the wrong alphabet: not worth showing.
             The model heard the audio, not this; the next line comes back
             in Tamil. */
          lockTamil();
          break;
        }
        /* Not drawn: on a call the order stands in for the transcript. */
        break;
      }
      case "response.created":
        status("speaking", say("Speaking..."));
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        /* Not drawn either; the customer is listening, not reading. */
        break;
      case "response.function_call_arguments.done":
        /* Answered together at response.done; see runToolCalls. */
        break;
      case "response.done": {
        var response = ev.response || {};
        var finished = !response.status || response.status === "completed";
        if (finished && live.active) await runToolCalls(response);
        if (live.active) status("listening", say("Listening..."));
        break;
      }

      case "error":
        if (!fatalError(ev.error)) {
          if (window.console && console.warn) console.warn("[voice] line said:", ev.error && (ev.error.message || ev.error.code));
          break;
        }
        note(say("Could not connect the voice line. You can still type."));
        stop();
        break;
      default:
        break;
    }
  }

  /*
   * Ask for the microphone NOW, inside the tap. Safari on an iPhone grants
   * a microphone request only while the tap is fresh; a database read
   * first, and the answer is "not allowed" with no dialog shown.
   */
  function grabMicrophone() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return null;
    try {
      var p = navigator.mediaDevices.getUserMedia({ audio: true });
      /* A rejection nobody has awaited yet is still a rejection; keep it
         from surfacing as an unhandled error while start() gets there. */
      if (p && p.catch) p.catch(function () {});
      return p;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function microphoneWords(error) {
    var name = error && error.name;
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
      return say("No microphone was found on this device. You can still type.");
    }
    return say("The microphone was not allowed. You can still type.");
  }

  async function startLive() {
    status("connecting", say("Connecting..."));
    live.placed = "";
    live.leaving = false;
    try {
      var asked = live.pendingStream || grabMicrophone();
      live.pendingStream = null;
      if (!asked) throw new Error("no microphone API");
      live.stream = await asked;
    } catch (e) {
      live.pendingStream = null;
      note(microphoneWords(e));
      status("", "");
      return false;
    }
    var branch = "";
    try {
      branch = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      branch = "";
    }
    var pc = new RTCPeerConnection();
    live.pc = pc;
    live.stream.getTracks().forEach(function (track) {
      pc.addTrack(track, live.stream);
    });
    pc.ontrack = function (event) {
      var out = el("voice-out");
      if (out && event.streams && event.streams[0]) {
        out.srcObject = event.streams[0];
        out.play && out.play().catch(function () {});
      }
    };
    var dc = pc.createDataChannel("oai-events");
    live.dc = dc;
    dc.onmessage = onEvent;
    dc.onopen = function () {
      status("listening", say("Listening..."));
      greetFirst();
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") stop();
    };
    try {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      var response = await fetch(apiBase() + "/online-ordering/" + encodeURIComponent(branch) + "/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sdp: offer.sdp, lang: lang() }),
      });
      var body = null;
      try {
        body = await response.json();
      } catch (e) {
        body = null;
      }
      if (!response.ok || !body || body.type !== "success" || !body.data || !body.data.sdp) {
        /* No live line from this shop right now: say why in one line, then
           talk turn by turn rather than leave the customer with silence. The
           owner tested with his key and got only transcripts, and nothing
           told him the live switch was off. */
        stopLine();
        var why = body && body.message ? String(body.message) : "";
        note(response.status === 403
          ? say("Live voice is switched off for this shop, so I'll answer turn by turn.")
          : say("The live voice line did not open ({why}), so I'll answer turn by turn.", { why: why || response.status }));
        return startTurns();
      }
      await pc.setRemoteDescription({ type: "answer", sdp: body.data.sdp });
      live.beta = /preview/.test(String(body.data.model || ""));
      live.heardLanguage = lang() === "ta" ? "ta" : "";
      startMeter(branch, body.data);
      return true;
    } catch (e) {
      stopLine();
      note(say("Could not connect the voice line. You can still type."));
      status("", "");
      return false;
    }
  }

  /* --------------------------------------------------------- the meter */

  /*
   * The audio never passes our server, so the server cannot see how long a
   * call lasts. The page tells it every half minute that the line is still
   * open, and once more as it closes; the server clocks the seconds itself
   * and prices them against the shop's monthly limit. Past the limit it
   * says stop, and the line is hung up with a word to the customer. A tick
   * that fails is a network hiccup, not a free call: three in a row and the
   * line is closed rather than left running unmetered.
   */
  function startMeter(branch, data) {
    live.session = String((data && data.session) || "");
    live.branch = branch;
    live.misses = 0;
    if (!live.session) return;
    var every = Math.max(10, Number(data.tick_seconds) || 30) * 1000;
    live.meter = setInterval(function () {
      tick(false);
    }, every);
  }

  function stopMeter(end) {
    if (live.meter) clearInterval(live.meter);
    live.meter = null;
    if (end && live.session) tick(true);
  }

  function tickUrl() {
    return apiBase() + "/online-ordering/" + encodeURIComponent(live.branch) + "/voice/" + encodeURIComponent(live.session) + "/tick";
  }

  async function tick(end) {
    if (!live.session) return null;
    var url = tickUrl();
    if (end) {
      /* Hanging up: one last report, sent in a way that outlives the page.
         The beacon carries no body, so the answer is on the address. */
      live.session = "";
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url + "?end=1");
        } else {
          await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ end: true }), keepalive: true });
        }
      } catch (e) {
        /* the page is going; the server sweeps what it never hears from */
      }
      return null;
    }
    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ end: false }),
      });
      if (response.ok) {
        live.misses = 0;
        return true;
      }
      if (response.status === 403) {
        live.session = "";
        note(say("This shop's assistant has reached its limit for the month. You can still order the usual way."));
        stop();
        return false;
      }
      if (response.status === 404) {
        live.session = "";
        stop();
        return false;
      }
      live.misses += 1;
    } catch (e) {
      live.misses += 1;
    }
    if (live.misses >= 3) stop();
    return false;
  }

  function stopLine() {
    stopMeter(true);
    try {
      if (live.dc) live.dc.close();
    } catch (e) {
      /* already closed */
    }
    try {
      if (live.pc) live.pc.close();
    } catch (e) {
      /* already closed */
    }
    if (live.stream) {
      live.stream.getTracks().forEach(function (track) {
        track.stop();
      });
    }
    live.dc = null;
    live.pc = null;
    live.stream = null;
    live.greeted = false;
    var out = el("voice-out");
    if (out) out.srcObject = null;
  }

  /* --------------------------------------------------- turn by turn */

  function speak(text) {
    return new Promise(function (resolve) {
      var synth = window.speechSynthesis;
      if (!synth || !window.SpeechSynthesisUtterance || !text) return resolve();
      var utter = new SpeechSynthesisUtterance(text);
      var tamil = /[஀-௿]/.test(text);
      utter.lang = tamil ? "ta-IN" : "en-IN";
      var voices = synth.getVoices ? synth.getVoices() : [];
      var match = voices.find(function (v) {
        return String(v.lang || "").toLowerCase().indexOf(tamil ? "ta" : "en-in") === 0;
      }) || voices.find(function (v) {
        return String(v.lang || "").toLowerCase().indexOf(tamil ? "ta" : "en") === 0;
      });
      if (match) utter.voice = match;
      utter.onend = function () {
        resolve();
      };
      utter.onerror = function () {
        resolve();
      };
      live.speaking = true;
      status("speaking", say("Speaking..."));
      synth.cancel();
      synth.speak(utter);
    }).then(function () {
      live.speaking = false;
    });
  }

  function listenOnce() {
    return new Promise(function (resolve) {
      var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) return resolve("");
      var rec = new Recognition();
      live.rec = rec;
      rec.lang = lang() === "ta" ? "ta-IN" : "en-IN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      var heard = "";
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) heard += e.results[i][0].transcript;
      };
      rec.onerror = function (e) {
        /* A refused microphone is the one error worth a sentence; the rest
           (nothing said, a dropped network) just end the turn. */
        var why = e && e.error;
        if (why === "not-allowed" || why === "service-not-allowed" || why === "audio-capture") live.denied = true;
      };
      rec.onend = function () {
        live.rec = null;
        resolve(heard.trim());
      };
      status("listening", say("Listening..."));
      try {
        rec.start();
      } catch (e) {
        resolve("");
      }
    });
  }

  async function startTurns() {
    var a = assistant();
    if (!a || !a.send) return false;
    live.mode = "turns";
    live.active = true;
    while (live.active) {
      var heard = await listenOnce();
      if (!live.active) break;
      if (live.denied) {
        note(say("The microphone was not allowed. You can still type."));
        break;
      }
      if (!heard) {
        /* Silence twice in a row is a customer who has stopped; once is a breath. */
        if (live.silent) break;
        live.silent = true;
        continue;
      }
      live.silent = false;
      status("thinking", say("Thinking..."));
      var out = await a.send(heard);
      if (!live.active) break;
      if (out && out.reply) await speak(out.reply);
    }
    stop();
    return true;
  }

  /* ------------------------------------------------------------ control */

  async function start() {
    var mode = voiceMode();
    if (!mode) return;
    var a = assistant();
    if (a && a.open) a.open();
    live.active = true;
    live.mode = mode;
    live.silent = false;
    live.denied = false;
    if (mode === "live") {
      var ok = await startLive();
      if (!ok) live.active = false;
    } else {
      note(say("Go ahead, I'm listening. Say what you feel like, and I'll answer out loud and add to your order."));
      await startTurns();
    }
  }

  function stop() {
    var go = el("voice-start");
    if (go) go.hidden = true;
    var stopButton = el("voice-stop");
    if (stopButton) stopButton.hidden = false;
    if (!live.active && !live.pc) {
      status("", "");
      return;
    }
    live.active = false;
    stopLine();
    try {
      if (live.rec) live.rec.abort ? live.rec.abort() : live.rec.stop();
    } catch (e) {
      /* already stopped */
    }
    live.rec = null;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    status("", "");
    /*
     * Nothing navigates here. An order placed during this call is already
     * confirmed in the sheet, with its token and a Done button; a page that
     * walked off the moment the line closed was the "cut suddenly" the owner
     * saw, and it is indistinguishable from a crash.
     */
  }

  /*
   * An iPhone lets a page speak only once speech has been started inside a
   * tap. A silent utterance in the tap handler unlocks it for the answers
   * that come later, after the network. Harmless everywhere else.
   */
  function unlockSpeech() {
    try {
      var synth = window.speechSynthesis;
      if (!synth || !window.SpeechSynthesisUtterance) return;
      var u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
      if (synth.getVoices && !synth.getVoices().length && synth.addEventListener) {
        synth.addEventListener("voiceschanged", function () {}, { once: true });
      }
    } catch (e) {
      /* no speech on this browser */
    }
  }

  /* The speaker element, touched inside the tap so iOS lets the line's audio
     play later. play() may return nothing where media is not implemented. */
  function warmSpeaker() {
    var out = el("voice-out");
    if (!out || typeof out.play !== "function") return;
    try {
      var p = out.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {
      /* nothing to play yet */
    }
  }

  /*
   * A code printed for the talk lands here: the panel is up, the orb is
   * still, and one big button says "Tap to talk". One tap, because no
   * browser opens a microphone without a finger on the screen.
   */
  function standReady() {
    if (!voiceMode()) return;
    status("ready", say("Tap to talk"));
    var go = el("voice-start");
    if (go) go.hidden = false;
    var stopButton = el("voice-stop");
    if (stopButton) stopButton.hidden = true;
  }

  function wire() {
    var button = el("assistant-talk");
    if (!button) return;
    var go = el("voice-start");
    if (go) {
      go.addEventListener("click", function () {
        go.hidden = true;
        var stopButton = el("voice-stop");
        if (stopButton) stopButton.hidden = false;
        if (voiceMode() === "live") live.pendingStream = grabMicrophone();
        unlockSpeech();
        warmSpeaker();
        start();
      });
    }
    button.addEventListener("click", function () {
      if (live.active) {
        stop();
        return;
      }
      if (voiceMode() === "live") live.pendingStream = grabMicrophone();
      unlockSpeech();
      warmSpeaker();
      start();
    });
    var stopButton = el("voice-stop");
    if (stopButton) stopButton.addEventListener("click", stop);
    var sheet = el("assistant");
    if (sheet) sheet.addEventListener("close", stop);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
    });
    window.addEventListener("pagehide", function () {
      stopMeter(true);
    });
    paintTalk();
  }

  document.addEventListener("posnic:shop", paintTalk);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.OrderingVoice = { changePlacedOrder: changePlacedOrder, cancelPlacedOrder: cancelPlacedOrder, leave: leave, sendToKitchen: sendToKitchen, start: start, stop: stop, standReady: standReady, runTool: runTool, onEvent: onEvent, voiceMode: voiceMode, paintTalk: paintTalk, tick: tick, live: live };
})();
