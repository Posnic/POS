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

  var live = { active: false, mode: "", pc: null, dc: null, stream: null, rec: null, speaking: false };

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

  function findItem(id) {
    try {
      if (typeof findProduct === "function") return findProduct(id) || null; // eslint-disable-line no-undef
    } catch (e) {
      /* no catalogue helper on this page */
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

  async function startLive() {
    status("connecting", say("Connecting..."));
    var branch = "";
    try {
      branch = typeof knownBranchId === "function" ? await knownBranchId() : ""; // eslint-disable-line no-undef
    } catch (e) {
      branch = "";
    }
    try {
      live.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      note(say("The microphone was not allowed. You can still type."));
      status("", "");
      return false;
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
      if (response.status === 403) {
        /* The shop switched it off since the page loaded; the turn-by-turn way still works. */
        stopLine();
        return startTurns();
      }
      if (!response.ok || !body || body.type !== "success" || !body.data || !body.data.sdp) throw new Error("no line");
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
    if (!live.active && !live.pc) return;
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

  function wire() {
    var button = el("assistant-talk");
    if (!button) return;
    button.addEventListener("click", function () {
      if (live.active) stop();
      else start();
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

  window.OrderingVoice = { start: start, stop: stop, runTool: runTool, onEvent: onEvent, voiceMode: voiceMode, paintTalk: paintTalk, live: live };
})();
