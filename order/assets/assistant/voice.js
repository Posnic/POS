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
   * HOW BIG THE ORDER IS, NOT WHAT IS ON IT.
   *
   * Owner: "in between i see conversation large list of items. its you
   * sending? i mean software? why cant send first and tell all instructions
   * and boundaries."
   *
   * The instructions and the whole menu ARE sent once, when the line opens,
   * and never again - he is right that this is the way to do it. What was
   * repeating is the ORDER: every tool answer carried every line of it, so
   * adding four dishes sent the growing list back four times, and every
   * refusal sent it again. The model does not need it. It is on the screen
   * the customer is looking at, and the page is the thing that knows what is
   * on it.
   *
   * So an answer says how many lines and what it comes to. show_order still
   * returns the list in full - that is what it is for, and the model calls it
   * on the rare turn it genuinely needs one.
   */
  function orderSize(order) {
    return {
      lines: (order && order.lines ? order.lines : []).length,
      total: (order && order.total) || 0
    };
  }

  /*
   * The model asked for something; the page decides and answers. A refusal
   * says why and what is close.
   */
  async function runTool(name, args) {
    var a = assistant();
    if (name === "show_order") return { ok: true, order: await cartSummary() };
    /* THE ONE ABOVE is the exception: it exists to hand over the list. */
    if (name === "show_order_history") return orderHistory();
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
        order: orderSize(await cartSummary())
      };
    }
    if (name !== "remove_from_order" && item.available === false) {
      return { ok: false, reason: "not_available_today", item: item.name, asked: asked || id, order: orderSize(await cartSummary()) };
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
    /* How big it is, not what is on it - see orderSize. */
    done.order = orderSize(await cartSummary());
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
  async function runToolCalls(response, interrupted) {
    var items = (response && response.output) || [];
    var calls = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].type === "function_call" && items[i].call_id) calls.push(items[i]);
    }
    if (!calls.length) return false;

    /*
     * A RESPONSE THE CUSTOMER TALKED OVER IS ANSWERED, NOT RUN.
     *
     * Two things are true at once. A tool call from a cancelled response must
     * NOT be carried out - the customer interrupted for a reason, and adding
     * the dish they talked over is how the wrong food is cooked. But a
     * call_id the model is waiting on and never hears back about wedges the
     * conversation: every turn afterwards is an acknowledgement and nothing
     * else, which is what the owner heard - "keep saying ok ok but not able
     * to continue".
     *
     * So the call is answered and refused. Nothing is added, and the model is
     * free to carry on. No response.create either: the customer is mid
     * sentence, and asking the model to speak now talks over them again.
     */
    if (interrupted) {
      for (i = 0; i < calls.length; i++) {
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: calls[i].call_id,
            output: JSON.stringify({ ok: false, reason: "interrupted" })
          }
        });
      }
      return false;
    }

    for (i = 0; i < calls.length; i++) {
      var args = {};
      try {
        args = JSON.parse(calls[i].arguments || "{}");
      } catch (e) {
        args = {};
      }
      /*
       * EVERY call gets an output, even one this page does not understand.
       *
       * A call_id left unanswered is a conversation that cannot move: the
       * model is waiting on a result that will never arrive, so every turn
       * after it is an acknowledgement and nothing else. The owner heard
       * exactly that - "keep saying ok ok but not able to continue".
       */
      var output = null;
      try {
        output = await runTool(calls[i].name, args);
      } catch (e) {
        output = { ok: false, reason: "not_done" };
      }
      if (!output) output = { ok: false, reason: "not_done" };
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
  /*
   * SPEAK FIRST, AND SAY THE SHOP'S NAME.
   *
   * Owner: "welcome greeting not said."
   *
   * This used to put a system MESSAGE into the conversation and then ask for
   * any response at all, which is two things that can go wrong to do one job:
   * a system item is not a shape every build of the line accepts, and a bare
   * response.create leaves the model to decide what the moment calls for -
   * which, at the very start of a call with nothing said yet, is often
   * nothing.
   *
   * A response carries its own instructions. Asking for ONE response and
   * telling it what that response is for is the documented way to steer a
   * single turn, and it does not depend on an item being accepted first.
   */
  function greetFirst() {
    if (live.greeted) return;
    live.greeted = true;
    sendEvent({
      type: "response.create",
      response: {
        instructions:
          "The line has just opened and the customer has said nothing yet. Say your OPENING LINE now, word for word, in one sentence, in the page's language - then stop and listen. Do not add anything to it and do not read the menu."
      }
    });
  }

  /* ------------------------------------------------- seeing what it heard
   *
   * Owner: "also enable what is converted text i want to see. soemthing
   * wrong. i see its flickering not showing thing."
   *
   * A call normally shows no text at all - his own rule, and the right one
   * for a customer, who is listening rather than reading. But when something
   * IS wrong, the words the line thought it heard are the evidence, and
   * guessing at them from outside is how an afternoon gets lost.
   *
   * SHOWN, NOW, BY DEFAULT. It was behind ?transcript=1 and the owner has
   * asked to see it five times running - most recently "i want know what
   * trascribed in the chat. not abel see" - which settles it: a flag he has
   * to remember to type is a feature he does not have. His earlier "no need
   * to show conversation as text" was about a line that worked; this one
   * does not yet, and the words are the only evidence of why.
   *
   * ?transcript=0 turns it off for anybody who wants the clean screen back,
   * and that choice is remembered for the visit - the flag would otherwise
   * be lost the moment the page walks from the arrival URL to products.html.
   */
  var TRANSCRIPT_KEY = "posnic_show_transcript";

  function showingTranscript() {
    try {
      var asked = new URLSearchParams(window.location.search).get("transcript");
      if (asked === "1") sessionStorage.setItem(TRANSCRIPT_KEY, "1");
      if (asked === "0") sessionStorage.setItem(TRANSCRIPT_KEY, "0");
      return sessionStorage.getItem(TRANSCRIPT_KEY) !== "0";
    } catch (e) {
      /* A browser that keeps nothing still shows them; this is the safe
         side now, because the alternative is the owner testing blind. */
      return true;
    }
  }

  /*
   * One line of what was heard or said, marked with the alphabet it came back
   * in - because "the transcript is in Kannada again" is the single most
   * useful thing this can tell anybody about a Tamil call.
   */
  function transcribed(who, text, script) {
    if (!text) return;
    var a = assistant();
    if (!a || !a.bubble) return;
    var row = a.bubble(who === "me" ? "me" : "ai", text);
    if (row && row.setAttribute) {
      row.setAttribute("data-transcript", "yes");
      if (script) row.setAttribute("data-script", script);
    }
  }

  /*
   * Tamil was heard. NOTED, AND NOTHING IS SENT.
   *
   * Owner: "i talk in tamil it reply in tamil but its not continuing. broken
   * voice hearing."
   *
   * This used to reconfigure the live session the moment a Tamil transcript
   * arrived - a session.update carrying only audio.input.transcription. The
   * update REPLACES the block it names, and audio.input is also where turn
   * detection lives. Handing over an audio.input that has a transcription and
   * no turn_detection is asking the line to stop noticing that the customer
   * is speaking, which is exactly what he described: it answers the first
   * Tamil sentence and then never hears another one.
   *
   * The transcription language was only ever an accuracy nicety, and the
   * transcripts are not even shown - the owner's own rule, "no need to show
   * conversation as text in the chat". The model's REPLY language comes from
   * the brief, which tells it to speak the customer's language, and that
   * works: he says it does reply in Tamil. So the language is remembered for
   * this page's own use and the line is left exactly as it was opened.
   *
   * A Tamil PAGE still gets Tamil ears from the first word, because that is
   * set when the session is minted - see voice-session.service.js - which is
   * the safe moment to say it.
   */
  function lockTamil() {
    if (live.heardLanguage) return;
    live.heardLanguage = "ta";
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
  /*
   * The Confirm & send button, pressed.
   *
   * The same door the spoken "send it" uses, so there is exactly one way an
   * order leaves this page: same checks, same refusals, same confirmation
   * screen and bell afterwards. A tap IS the customer's yes, so it carries
   * confirmed:true - there is nothing else a press of that button could mean.
   *
   * When it goes, the assistant is told, because it is mid-conversation and
   * must not carry on asking whether to send something that has gone.
   */
  async function sendNow(way) {
    var done = await sendToKitchen(way ? { confirmed: true, fulfilment: way } : { confirmed: true });
    if (done.ok) {
      tellTheAssistant(
        'The customer pressed "Confirm and send" and the order has gone to the kitchen. Say in ONE sentence that it has gone and will be served soon. Do not read the order back.'
      );
    }
    return done;
  }

  /*
   * WHAT THE CUSTOMER JUST DID BY HAND, said into the conversation.
   *
   * Owner: "also AI should know about the changes what user doing. its kind
   * of helper too."
   *
   * The top half of the screen is worked with fingers while the assistant
   * listens at the bottom, and an assistant that cannot see that is worse
   * than useless - it offers a dish that is already on the order, or reads
   * back a quantity the customer has just corrected. This puts the change
   * into the conversation as something the customer said, which is what it
   * is, and does NOT ask for a reply: the customer is looking at the screen
   * and does not need it narrated back at them.
   */
  function tellTheAssistant(what, speak) {
    if (!live.active || !live.dc || live.dc.readyState !== "open") return false;
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: String(what || "") }]
      }
    });
    if (speak) sendEvent({ type: "response.create" });
    return true;
  }

  /** One line about a change made by hand, for the assistant's benefit. */
  function noticed(verb, name, quantity) {
    if (!name) return;
    var said =
      verb === "remove" || Number(quantity) === 0
        ? 'The customer has just taken ' + name + ' off the order themselves, by tapping the screen.'
        : verb === "add"
          ? 'The customer has just added ' + name + ' themselves, by tapping the screen.'
          : 'The customer has just set ' + name + ' to ' + quantity + ' themselves, by tapping the screen.';
    tellTheAssistant(said + ' Do not say anything about it unless they bring it up.');
  }

  /*
   * THE SAME TABLE, AGAIN.
   *
   * Owner: "same table not accepted. but how about adding extra or modifying
   * same table orders?"
   *
   * The shop allows one open order per table by default, and it is right to:
   * two tickets on one table is usually somebody picking the wrong table, and
   * the cost of finding out is a bill split in two at the end of the meal.
   * The rule even says what to do instead - "Add to it, or settle it first."
   *
   * But from a customer's phone there was no way to add to it. They scanned
   * table 34, ordered, ate half of it, wanted one more naan, and the shop
   * said no. A rule with no door next to it is just a wall.
   *
   * So this is the door. A second send at the same table, from the phone that
   * placed the first one, ADDS to that order rather than opening a second. It
   * goes through the customer's own change endpoint, which means the shop's
   * rules still decide: inside the window it simply changes, past it the
   * kitchen may have started so it becomes a request the shop answers, and a
   * billed or paid order refuses and this falls through to a fresh ticket -
   * which is correct, because a settled table is a new sitting.
   *
   * THE PROOF IS THE TOKEN, as everywhere else here. Another diner at the
   * same table holds no token for this order and cannot touch it; they get
   * the shop's refusal, which is the honest answer for them.
   */
  async function orderHereBefore(point) {
    var table = String((point && point.table) || "").trim();
    if (!table) return null;
    /* The shop is asked for, not assumed from the call: this runs on the
       button as well as the line, and a phone that ordered at table 5 in one
       shop must not add to that when it scans table 5 in another. */
    var shop = await branchNow();
    var mine = myOrders();
    for (var i = 0; i < mine.length; i += 1) {
      var row = mine[i];
      if (!row || !row.orderId || !row.token) continue;
      if (String(row.table || "").trim() !== table) continue;
      if (shop && String(row.shop || "") !== String(shop)) continue;
      return row;
    }
    return null;
  }

  /**
   * Add this basket to an order already open at this table.
   *
   * @returns {Promise<null|{ok: boolean, reason?: string, requested?: boolean, token?: string}>}
   *          null when there is nothing to add to and the caller should place
   *          a new order instead.
   */
  async function addToTheOpenOne(row, lines) {
    var shop = await branchNow();
    if (!shop) return null;
    var base =
      apiBase() + "/online-ordering/" + encodeURIComponent(shop) + "/orders/" + encodeURIComponent(row.orderId);

    /* What the shop says is on it NOW. The quantities this endpoint takes are
       absolute, so two more of something already there is what is there plus
       two - and asking the shop rather than trusting this phone is the only
       way that arithmetic is right after somebody else has touched it. */
    var said = null;
    try {
      var read = await fetch(base + "?token=" + encodeURIComponent(row.token), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!read.ok) return null;
      var body = await read.json();
      said = body && body.type === "success" ? body.data : null;
    } catch (e) {
      return null;
    }
    /* Settled, called off, or refused: that sitting is over and the next
       order is a new one. */
    if (!said || said.cancelled || said.paid) return null;
    if (said.why_not && said.why_not !== "too_late") return null;

    var already = {};
    (said.items || []).forEach(function (line) {
      already[String(line.item_id || "")] = Number(line.quantity) || 0;
    });
    var wanted = lines.map(function (line) {
      var id = String(line.item_id || "");
      return { item_id: id, quantity: (already[id] || 0) + (Number(line.quantity) || 0) };
    });
    if (!wanted.length) return null;

    try {
      var sent = await fetch(base + "/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: row.token, items: wanted }),
      });
      var answer = await sent.json().catch(function () {
        return null;
      });
      if (!sent.ok || !answer || answer.type !== "success") return null;

      /* It went onto the order, so the basket has been sent. Emptied the way
         checkout empties it, or the next screen shows it all over again. */
      try {
        if (typeof saveCartData === "function") await saveCartData([]); // eslint-disable-line no-undef
        if (typeof renderCart === "function") await renderCart([]); // eslint-disable-line no-undef
      } catch (e) {
        /* an order that went is more important than a basket that lingers */
      }
      var data = answer.data || {};
      live.placed = String(row.token || "");
      live.placedId = String(row.orderId || "");
      var a = assistant();
      /* The docket flies for something that actually went to the kitchen. A
         request past the window has NOT gone - a person still has to say yes
         - so that one opens on a still, or the drawing tells a lie. */
      if (a && a.placedPanel) {
        a.placedPanel(live.placed, { orderId: live.placedId, still: data.requested === true });
      }
      handUpAfterSending();
      return { ok: true, added: true, requested: data.requested === true, token: live.placed };
    } catch (e) {
      return null;
    }
  }

  /*
   * THE LINE GOES DOWN WHEN THE ORDER GOES IN.
   *
   * Owner: "for changnig ai assistant not needed until user click mic icon.
   * once order sent switch off mic."
   *
   * It used to stay up on purpose - the customer might want to change
   * something - but an open microphone nobody is talking into is a microphone
   * listening to a restaurant, and every burst of room noise it decides is
   * speech costs a reply and a fraction of a rupee. The order screen has its
   * own buttons for changing things; the line comes back the moment the mic
   * is tapped, and the customer is the one who decides that.
   */
  function handUpAfterSending() {
    /*
     * AFTER IT HAS FINISHED SPEAKING, not the instant the order goes.
     *
     * Closing the line here would cut the model off mid-sentence and, worse,
     * stop the tool answer ever reaching it - so it would never say the order
     * had gone at all. That is the very first thing the owner reported in
     * this feature: "after sending to order ai voice suddenly closing."
     *
     * So the intention is recorded and onEvent closes the line once the
     * speaker has gone quiet. A line that somehow never speaks again is shut
     * by the guard below rather than left listening to the room.
     */
    live.hangingUp = true;
    clearTimeout(hangUpGuard);
    hangUpGuard = setTimeout(function () {
      if (live.hangingUp) closeTheLine();
    }, 12000);
  }

  var hangUpGuard = 0;

  function closeTheLine() {
    live.hangingUp = false;
    clearTimeout(hangUpGuard);
    try {
      stop();
    } catch (e) {
      /* an order that went is more important than a line that will not close */
    }
  }

  async function sendToKitchen(args) {
    var order = await cartSummary();
    if (!order.lines.length) return { ok: false, reason: "empty_order", order: orderSize(order) };
    if (!(args && args.confirmed === true)) return { ok: false, reason: "not_confirmed", order: orderSize(order) };
    var way = resolveWay(args && args.fulfilment);
    if (!way) return { ok: false, reason: "need_fulfilment", options: waysOffered(), order: orderSize(order) };
    /*
     * THERE IS NO REVIEW BUTTON, so this must not say "review".
     *
     * Owner: "AI asking to review and click review button. there is not
     * review button." He is right, and this field is where the word came
     * from: the model reads this answer as JSON and says what it finds. The
     * button under the conversation used to say Review order and now says
     * Confirm and send, because the review is the minute AFTER the order
     * goes. A field naming a button that was renamed a while ago sent him
     * hunting the screen for it.
     */
    if (way === "delivery") return { ok: false, reason: "needs_details", next: "the_page_finishes_it", order: orderSize(order) };
    var s = shopNow();
    var payment = (s && s.payment) || {};
    if (!offlineAllowed(payment)) return { ok: false, reason: "pay_online", next: "the_page_finishes_it", order: orderSize(order) };
    if (phoneWanted(payment)) return { ok: false, reason: "needs_phone", next: "the_page_finishes_it", order: orderSize(order) };
    var point = servicePoint();
    try {
      if (way === "dine_in" && !(point && (point.table || point.venue))) {
        var table = String((args && args.table) || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
        if (!table) return { ok: false, reason: "need_table", order: orderSize(order) };
        localStorage.setItem("order_table", table);
      } else {
        localStorage.removeItem("order_table");
      }
      if (typeof chargeFor === "function") { // eslint-disable-line no-undef
        var charge = chargeFor(way, order.total); // eslint-disable-line no-undef
        if (charge && charge.allowed === false) {
          return { ok: false, reason: "below_minimum", minimum: charge.minimum, short: charge.short, order: orderSize(order) };
        }
      }
      localStorage.setItem("order_fulfilment", way);
      localStorage.setItem("orderType", WAY_WORD[way]);
    } catch (e) {
      /* a browser that keeps nothing still places the order below */
    }
    /*
     * ALREADY EATING AT THIS TABLE? Then this is one more thing on the same
     * order, not a second ticket the shop would refuse. Tried before the
     * checkout, and a null answer means there is nothing to add to - so the
     * ordinary path below still runs and nothing is lost.
     */
    if (way === "dine_in") {
      var here = await orderHereBefore(point);
      if (here) {
        var joined = await addToTheOpenOne(here, order.lines);
        if (joined && joined.ok) {
          return {
            ok: true,
            token: joined.token,
            added_to_open_order: true,
            requested: joined.requested === true,
            total: order.total,
            way: way,
            pay: "at the counter",
            order: orderSize(order)
          };
        }
      }
    }

    if (typeof checkout !== "function") return { ok: false, reason: "not_placed", next: "the_page_finishes_it", order: orderSize(order) }; // eslint-disable-line no-undef
    var placed = null;
    try {
      placed = await checkout("", "Cash", { stay: true }); // eslint-disable-line no-undef
    } catch (e) {
      placed = null;
    }
    if (!placed || !placed.token) return { ok: false, reason: "not_placed", next: "the_page_finishes_it", order: orderSize(order) };
    live.placed = String(placed.token);
    live.placedId = String(placed.saleId || "");
    var a = assistant();
    /* With the id as well as the token, the confirmation can open into the
       order itself rather than stop at a number. */
    if (a && a.placedPanel) a.placedPanel(live.placed, { orderId: live.placedId });
    else if (a && a.placedLine) a.placedLine(live.placed);
    handUpAfterSending();
    return {
      ok: true,
      token: live.placed,
      total: order.total,
      way: way,
      pay: way === "dine_in" ? "at the counter" : "when collecting",
      order: orderSize(order)
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
  /*
   * What this phone has ordered, as the shop sees it now.
   *
   * The browser holds the list - there is no account behind a QR code - and
   * the shop is asked about all of them in ONE request, the same door the
   * history page uses. Money is left out on purpose: the owner's rule is that
   * the assistant does not read totals aloud.
   */
  /*
   * What the shop says about every order this phone holds, newest first.
   *
   * One request for all of them, the same door the history page uses. Shared
   * with orderNamed below, which needs the shop's answer to match a BILL
   * number - the shop's own number, which the browser does not keep.
   */
  async function lookupOrders(kept) {
    if (!kept || !kept.length) return [];
    var branch = await branchNow();
    if (!branch) return [];
    try {
      var response = await fetch(
        apiBase() + "/online-ordering/" + encodeURIComponent(branch) + "/orders/lookup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ orders: kept.map(function (row) { return { orderId: row.orderId, token: row.token }; }) })
        }
      );
      if (!response.ok) return [];
      var answer = await response.json();
      var orders = (answer && answer.data && answer.data.orders) || [];
      /* Newest first, which is the order a person thinks in. */
      orders.sort(function (a, b) {
        return new Date(b.placed_at || 0) - new Date(a.placed_at || 0);
      });
      return orders;
    } catch (e) {
      return [];
    }
  }

  async function orderHistory() {
    var kept = myOrders();
    if (!kept.length) return { ok: true, orders: [] };
    var branch = await branchNow();
    if (!branch) return { ok: false, reason: "no_shop" };
    var orders = await lookupOrders(kept);
    return {
      ok: true,
      orders: orders.map(function (order) {
          return {
            token: order.token,
            /* The number on their receipt, so the customer may quote either. */
            bill_no: order.bill_no,
            placed_at: order.placed_at,
            state: order.cancelled ? "cancelled" : order.paid ? "paid" : order.state,
            can_change: order.can_change === true,
            why_not: order.why_not,
            seconds_left: order.can_change
              ? Math.max(0, Math.round((new Date(order.placed_at).getTime() + (Number(order.change_seconds) || 0) * 1000 - Date.now()) / 1000))
              : 0,
            cancel_requested: order.cancel_requested === true,
            lines: (order.items || []).map(function (line) {
              return { item_id: line.item_id, name: line.name, quantity: line.quantity };
            })
        };
      })
    };
  }

  /* Where the printed code said this customer is, for the line's brief. */
  function servicePointNow() {
    try {
      if (!window.KioskServicePoint) return {};
      var point = window.KioskServicePoint.read() || {};
      var out = {};
      if (point.table) out.table = String(point.table);
      if (point.venue) out.venue = String(point.venue);
      if (point.unit) out.unit = String(point.unit);
      if (point.fulfilment) out.fulfilment = String(point.fulfilment);
      return out;
    } catch (e) {
      /* No service point is the shop's own floor, which is the safe read. */
      return {};
    }
  }

  /** The shop this line is talking to. */
  async function branchNow() {
    try {
      return typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      return "";
    }
  }

  function myOrders() {
    try {
      return (typeof rememberedOrders === "function" ? rememberedOrders() : []) || []; // eslint-disable-line no-undef
    } catch (e) {
      return [];
    }
  }

  /* A bill number as a machine would compare it: S-Q43L-000018, s q43l 18 and
     "000018" are one number said three ways. */
  function tidyRef(said) {
    return String(said || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* The digits on the end of a bill number, without their leading zeros -
     what a person says when they read one out ("eighteen"). */
  function tailNumber(said) {
    var digits = tidyRef(said).match(/(\d+)$/);
    return digits ? String(Number(digits[1])) : "";
  }

  /*
   * Which order a tool call means.
   *
   * EITHER NUMBER THE CUSTOMER HAS. The token is what they were told and what
   * is called out; the bill number is what is printed on their receipt and
   * what the shop's own queue leads with. They will say whichever is in front
   * of them, so both are accepted - the token first, because it is short and
   * the one people usually quote.
   *
   * The bill number is the shop's, so matching on it needs the shop's answer;
   * that costs one request, and only when a token did not match.
   *
   * With no reference at all: the order placed during this call, and failing
   * that the most recent this phone remembers - which is what somebody means
   * when they ring back and say "make that two".
   */
  async function orderNamed(ref) {
    var asked = String(ref || "").trim();
    if (!asked && live.placedId && live.placed) {
      return { orderId: live.placedId, token: live.placed };
    }
    var kept = myOrders();
    if (!asked) {
      var newest = kept
        .slice()
        .sort(function (a, b) {
          return new Date(b.at || 0) - new Date(a.at || 0);
        })[0];
      return newest ? { orderId: newest.orderId, token: newest.token } : null;
    }

    var byToken = kept.filter(function (row) {
      return String(row.token) === asked;
    })[0];
    if (byToken) return { orderId: byToken.orderId, token: byToken.token };

    /* Not a token this phone holds. Ask the shop what these orders are
       numbered, and try the bill number. */
    var said = await lookupOrders(kept);
    if (!said.length) return null;
    var want = tidyRef(asked);
    var tail = tailNumber(asked);
    var hits = said.filter(function (order) {
      var bill = tidyRef(order.bill_no);
      if (!bill) return false;
      /* The whole number, or the part of it a person reads aloud. Never a
         bare prefix: "S" must not match every order this shop ever took. */
      return bill === want || (tail && tailNumber(order.bill_no) === tail);
    });
    /* Two of their own orders answer to what they said. Guessing between
       them is how the wrong dinner gets cancelled. */
    if (hits.length > 1) return { ambiguous: hits.map(function (o) { return o.token; }) };
    if (!hits.length) return null;
    return { orderId: hits[0].order_id, token: hits[0].token };
  }

  async function placedOrderCall(what, body, ref) {
    var which = await orderNamed(ref);
    if (which && which.ambiguous) return { ok: false, reason: "which_order", tokens: which.ambiguous };
    if (!which) return { ok: false, reason: "nothing_placed" };
    /* Named locally so the rest of this function reads as it did. */
    var placedId = which.orderId;
    var placedToken = which.token;
    var branch = "";
    try {
      branch = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      branch = "";
    }
    if (!branch) return { ok: false, reason: "no_shop", which: which };
    try {
      var response = await fetch(
        apiBase() + "/online-ordering/" + encodeURIComponent(branch) + "/orders/" + encodeURIComponent(placedId) + "/" + what,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(Object.assign({ token: placedToken }, body || {}))
        }
      );
      var answer = null;
      try {
        answer = await response.json();
      } catch (e) {
        answer = null;
      }
      if (!response.ok || !answer || answer.type !== "success") {
        return { ok: false, reason: String((answer && answer.message) || "not_changed"), which: which };
      }
      return { ok: true, data: (answer && answer.data) || {}, which: which };
    } catch (e) {
      return { ok: false, reason: "not_changed", which: which };
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
    /* Which order it acted on comes BACK from the call rather than being
       worked out twice: naming one by its bill number costs a request, and
       asking the same question again would cost a second. */
    var done = await placedOrderCall("items", { items: asked }, args && args.order_ref);
    var which = done.which;
    if (!done.ok) return { ok: false, reason: done.reason, tokens: done.tokens, token: which && which.token };
    /* The basket on screen belongs to the order being built NOW. Rewriting it
       to match an order from an earlier visit would throw that away. */
    if (which && live.placedId && which.orderId === live.placedId) {
      await matchCartTo(done.data.items || []);
    }
    var a = assistant();
    if (a && a.actionLine) a.actionLine(say("Order changed"));
    return {
      ok: true,
      token: (which && which.token) || live.placed,
      order: { lines: (done.data.items || []).length, total: done.data.total }
    };
  }

  async function cancelPlacedOrder(args) {
    if (!(args && args.confirmed === true)) return { ok: false, reason: "not_confirmed" };
    var done = await placedOrderCall("cancel", {}, args && args.order_ref);
    var which = done.which;
    if (!done.ok) return { ok: false, reason: done.reason, tokens: done.tokens, token: which && which.token };
    /* Only the order this call placed is the one the screen is showing. An
       older one being called off leaves the basket and the panel alone. */
    var wasThisCall = which && live.placedId && which.orderId === live.placedId;
    if (wasThisCall) {
      await matchCartTo([]);
      live.placed = "";
      live.placedId = "";
    }
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

  /*
   * THE MICROPHONE GOES DEAF WHILE THE ASSISTANT IS SPEAKING.
   *
   * Owner, three times and counting: "why noise cancel not working? why keep
   * saying ah.. yes.. aha..i want know what trascribed in the chat."
   *
   * Echo cancellation was switched on and it is not enough. It is built for a
   * headset and a conversation between two people; a phone lying on a table
   * playing a synthetic voice through its loudspeaker in a restaurant is the
   * case it handles worst. What is left over is enough for the far end's
   * voice detector to call it speech, so the line hears its own sentence,
   * decides the customer said something, and answers it - with "ah", "yes",
   * "aha", because there is nothing there to answer.
   *
   * So the microphone is switched OFF for as long as the assistant's voice is
   * actually coming out of the speaker, and switched back on a quarter of a
   * second after it stops. The line then physically cannot hear itself.
   *
   * WHAT IT COSTS: talking over the assistant no longer interrupts it. In a
   * quiet room that is a loss. In a restaurant, which is what this is for, a
   * line that answers the room is not a line at all.
   *
   * AND IT CANNOT GET STUCK. A muted microphone that is never unmuted is a
   * dead assistant, which is far worse than a chatty one, so a guard turns it
   * back on regardless after a few seconds - longer than any single spoken
   * answer, short enough that a lost "stopped" event costs one reply.
   */
  var SPEAKING_TAIL = 250;
  var LONGEST_ANSWER = 20000;
  var deafTail = 0;
  var deafGuard = 0;

  function hearing(on) {
    try {
      if (!live.stream || !live.stream.getAudioTracks) return;
      live.stream.getAudioTracks().forEach(function (track) {
        track.enabled = !!on;
      });
      if (window.VoiceDebug) window.VoiceDebug.did("microphone", on ? "listening" : "off - the assistant is speaking");
    } catch (e) {
      /* A browser that will not let go of the track still gets the call. */
    }
  }

  /** The assistant started speaking: stop listening until it stops. */
  function itIsSpeaking() {
    clearTimeout(deafTail);
    clearTimeout(deafGuard);
    hearing(false);
    deafGuard = setTimeout(function () {
      /* Whatever happened to the "stopped" event, the customer gets their
         microphone back. */
      hearing(true);
    }, LONGEST_ANSWER);
  }

  /** It stopped. Listen again, once the speaker has actually gone quiet. */
  function itIsDone() {
    clearTimeout(deafGuard);
    clearTimeout(deafTail);
    deafTail = setTimeout(function () {
      hearing(true);
    }, SPEAKING_TAIL);
  }

  async function onEvent(message) {
    var ev;
    try {
      ev = JSON.parse(message.data);
    } catch (e) {
      return;
    }
    /* Every event on the screen, where the shop asked to see them. This is
       the only place the whole line is visible, and it is what answers "why
       does it say ok with nobody talking". assets/assistant/debug.js. */
    try {
      if (window.VoiceDebug) window.VoiceDebug.event(ev);
    } catch (e) {
      /* a panel that fails must never take the conversation with it */
    }
    var a = assistant();
    switch (ev.type) {
      /*
       * WebRTC's own pair of events, which say when audio is genuinely
       * leaving the speaker rather than when a response began or ended.
       * response.done arrives while the last second is still playing, which
       * is exactly the second the line would otherwise hear itself in.
       */
      case "output_audio_buffer.started":
        itIsSpeaking();
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        itIsDone();
        /* The order has gone and the assistant has finished saying so, which
           is the moment the line has no more work. See handUpAfterSending. */
        if (live.hangingUp) closeTheLine();
        break;
      case "input_audio_buffer.speech_started":
        status("listening", say("Listening..."));
        break;
      case "conversation.item.input_audio_transcription.completed": {
        var heard = String(ev.transcript || "").trim();
        if (!heard) break;
        var script = scriptOf(heard);
        if (script === "tamil") lockTamil();
        if (script === "other") lockTamil();
        /*
         * NORMALLY NOT DRAWN: on a call the order stands in for the
         * transcript, which is the owner's own rule - "no need to show
         * conversation as text in the chat. just hide."
         *
         * With ?transcript=1 it is drawn anyway, because when something IS
         * wrong the words the line thought it heard are the evidence. Owner:
         * "also enable what is converted text i want to see. soemthing
         * wrong." Including a transcript that came back in the wrong
         * alphabet - especially that one, since it is what Tamil misheard
         * looks like.
         */
        keepSaid("customer", heard);
        if (showingTranscript()) transcribed("me", heard, script);
        break;
      }
      case "response.created":
        status("speaking", say("Speaking..."));
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        /* Not drawn either; the customer is listening, not reading - unless
           somebody is looking for what went wrong. */
        keepSaid("ai", String(ev.transcript || "").trim());
        if (showingTranscript()) transcribed("ai", String(ev.transcript || "").trim(), "");
        break;
      case "response.function_call_arguments.done":
        /* Answered together at response.done; see runToolCalls. */
        break;
      case "response.done": {
        var response = ev.response || {};
        /*
         * A response the customer talked over is still ANSWERED.
         *
         * Its tools are not run - see runToolCalls - but every call_id it
         * emitted gets a refusal, because one the model is waiting on and
         * never hears back about leaves it able to do nothing but say "ok".
         */
        var finished = !response.status || response.status === "completed";
        if (live.active) await runToolCalls(response, !finished);
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
  /*
   * WHAT THE MICROPHONE IS ASKED FOR.
   *
   * Owner: "ai keep saying ok ok ok. coz may be surrounding sound", and then
   * "i want see mic noise cancellation".
   *
   * This asked for `audio: true`, which is the bare default - a raw
   * microphone with nothing switched on. Every browser can do better, and in
   * a restaurant the difference is the whole feature:
   *
   *   noiseSuppression   the fan, the fridge, the room. Steady sound the
   *                      phone can recognise as not-speech and remove.
   *   echoCancellation   the assistant's OWN voice coming back in through the
   *                      speaker. Without it the line hears itself, decides
   *                      somebody spoke, and answers - which is how a
   *                      conversation talks itself in circles.
   *   autoGainControl    a customer half a metre from the phone in a loud
   *                      room, brought up to a level the far end can use.
   *
   * ASKED FOR, NOT DEMANDED. These are plain values rather than `{ exact: }`,
   * so a device that cannot do one of them gives what it can instead of
   * refusing the microphone altogether - and a refused microphone is no
   * ordering at all, which is much worse than a noisy one.
   *
   * The channel and rate matter too: one channel at 16kHz is what speech
   * recognition wants, and asking for less than the phone would send by
   * default means less of the room arriving at the far end.
   */
  var MICROPHONE = {
    audio: {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 16000,
    },
  };

  function grabMicrophone() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return null;
    try {
      var p = navigator.mediaDevices.getUserMedia(MICROPHONE);
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
    live.hangingUp = false;
    clearTimeout(hangUpGuard);
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
        /* And the orb follows the voice actually coming back, rather than
           pulsing on a fixed loop that talks whatever is being said.
           assets/assistant/talking.js. */
        try {
          if (window.VoiceTalking) window.VoiceTalking.follow(event.streams[0], el("voice-orb"));
        } catch (e) {
          /* The page keeps its own CSS animation; nobody notices. */
        }
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
        /*
         * WHERE THE CUSTOMER IS SITTING GOES WITH THE LINE.
         *
         * Owner: "table number already gone and ai asking me again table
         * number." It was not gone - the page had it the whole time - but the
         * line was opened with nothing but the offer and the language, so the
         * assistant genuinely did not know, and its opening line had no table
         * to name either. A code stuck to table thirty-four has answered that
         * question before anybody asks it.
         */
        body: JSON.stringify(
          Object.assign({ sdp: offer.sdp, lang: lang() }, servicePointNow())
        ),
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

  /*
   * WHAT WAS SAID, RIDING ALONG WITH THE METER.
   *
   * Owner: "watch my conversation via server." The audio goes phone to
   * provider and never reaches us, so the only way the shop can ever see
   * what a call did is if this page says. It is already talking to the
   * server every half minute to keep the meter honest, so the words go with
   * that - no extra request, and the whole call is on its own session row
   * where a bad call can be read back afterwards.
   *
   * Held here between ticks and handed over once. A line the server has
   * taken is dropped, so a slow network repeats nothing.
   */
  var saidSoFar = [];
  var MOST_HELD = 40;

  function keepSaid(who, text) {
    var line = String(text || "").trim();
    if (!line) return;
    saidSoFar.push({ who: who === "ai" ? "ai" : "customer", text: line.slice(0, 300) });
    while (saidSoFar.length > MOST_HELD) saidSoFar.shift();
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
          /* The last words go with the hang-up. A beacon can carry a body,
             and the end of a call is exactly the part worth reading: the
             refusal, the misheard dish, the "aha" nobody prompted. */
          var last = JSON.stringify({ end: true, said: saidSoFar });
          saidSoFar = [];
          navigator.sendBeacon(url + "?end=1", new Blob([last], { type: "application/json" }));
        } else {
          await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ end: true }), keepalive: true });
        }
      } catch (e) {
        /* the page is going; the server sweeps what it never hears from */
      }
      return null;
    }
    try {
      var handing = saidSoFar.slice();
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ end: false, said: handing }),
      });
      if (response.ok) {
        live.misses = 0;
        /* Taken. Anything said while this was in flight is still here. */
        saidSoFar = saidSoFar.slice(handing.length);
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
    /* Let go of the voice before the stream under it goes, or the analyser
       keeps a handle on a track that has ended. */
    try {
      if (window.VoiceTalking) window.VoiceTalking.stop();
    } catch (e) {
      /* nothing was following */
    }
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
    /* Nothing is speaking any more, so nothing is waiting to hear again. */
    clearTimeout(deafTail);
    clearTimeout(deafGuard);
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

  window.OrderingVoice = { changePlacedOrder: changePlacedOrder, cancelPlacedOrder: cancelPlacedOrder, leave: leave, sendToKitchen: sendToKitchen, sendNow: sendNow, noticed: noticed, tellTheAssistant: tellTheAssistant, start: start, stop: stop, standReady: standReady, runTool: runTool, onEvent: onEvent, voiceMode: voiceMode, paintTalk: paintTalk, tick: tick, live: live };
})();
