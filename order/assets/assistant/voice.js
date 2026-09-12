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

  var live = { active: false, mode: "", pc: null, dc: null, stream: null, pendingStream: null, rec: null, speaking: false };

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
  function findItem(id) {
    var wanted = String(id);
    try {
      if (typeof allProducts === "function") { // eslint-disable-line no-undef
        var all = allProducts() || []; // eslint-disable-line no-undef
        for (var i = 0; i < all.length; i++) {
          if (all[i] && String(all[i].id) === wanted) return all[i];
        }
      }
    } catch (e) {
      /* no catalogue on this page */
    }
    try {
      if (typeof findProduct === "function") return findProduct(wanted) || null; // eslint-disable-line no-undef
    } catch (e) {
      /* not on this page either */
    }
    return null;
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

  /* The model asked for something; the page decides and answers. */
  async function runTool(name, args) {
    var a = assistant();
    if (name === "show_order") return cartSummary();
    var id = String((args && args.item_id) || "");
    var item = findItem(id);
    if (!item) return { ok: false, reason: "not on this menu" };
    if (name !== "remove_from_order" && item.available === false) return { ok: false, reason: "not available right now" };
    var quantity = Math.min(20, Math.max(1, Math.round(Number(args && args.quantity) || 1)));
    var action = { item_id: id, name: item.name, quantity: quantity };
    if (name === "add_to_order") action.verb = "add";
    else if (name === "remove_from_order") { action.verb = "remove"; action.quantity = 0; }
    else if (name === "set_quantity") action.verb = "set";
    else return { ok: false, reason: "unknown tool" };
    var noteText = String((args && args.note) || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (noteText && action.verb !== "remove") action.note = noteText;
    if (a && a.apply) await a.apply([action]);
    return { ok: true, item: item.name, verb: action.verb, quantity: action.quantity, note: noteText || undefined };
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
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript && a && a.bubble) a.bubble("me", String(ev.transcript).trim());
        break;
      case "response.created":
        status("speaking", say("Speaking..."));
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (ev.transcript && a && a.bubble) a.bubble("ai", String(ev.transcript).trim());
        break;
      case "response.function_call_arguments.done": {
        var args = {};
        try {
          args = JSON.parse(ev.arguments || "{}");
        } catch (e) {
          args = {};
        }
        var output = await runTool(ev.name, args);
        sendEvent({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) } });
        sendEvent({ type: "response.create" });
        break;
      }
      case "response.done":
        if (live.active) status("listening", say("Listening..."));
        break;
      case "error":
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
      return true;
    } catch (e) {
      stopLine();
      note(say("Could not connect the voice line. You can still type."));
      status("", "");
      return false;
    }
  }

  function stopLine() {
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
    paintTalk();
  }

  document.addEventListener("posnic:shop", paintTalk);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.OrderingVoice = { start: start, stop: stop, standReady: standReady, runTool: runTool, onEvent: onEvent, voiceMode: voiceMode, paintTalk: paintTalk, live: live };
})();
