/*
 * What is actually happening on the line, on the screen, in front of you.
 *
 * Owner, three times now: "i asked you so many times show what was talking or
 * server logs you show me. why in between it says ok, yes, sure.. looks
 * werid."
 *
 * He is right to keep asking, and the answer to every question he has raised
 * about the voice - why it says "ok" unprompted, whether Tamil is being heard
 * as Tamil, whether the model is mishearing a dish or never got the words at
 * all - is in the events the line sends, which nobody could see. Reasoning
 * about it from the outside has cost him an afternoon.
 *
 * So: every event, as it arrives, with the time since the last one. The
 * transcripts in full. Every tool the model asked for and what it was told
 * back. Every error. It is his own phone's console, except that a phone has
 * no console anybody can reach while standing in a shop.
 *
 * ONLY ON A VISIT THAT ASKED FOR IT - ?transcript=1 - and never otherwise. A
 * customer ordering lunch must never see any of this.
 *
 * NEWEST AT THE TOP, because the interesting thing is the last thing that
 * happened, and a log that scrolls away from you while you read it is a log
 * you end up chasing with your thumb.
 */
(function () {
  "use strict";

  var KEY = "posnic_show_transcript";
  var MOST = 200;

  function wanted() {
    try {
      var asked = new URLSearchParams(window.location.search).get("transcript");
      if (asked === "1") sessionStorage.setItem(KEY, "1");
      if (asked === "0") sessionStorage.removeItem(KEY);
      return sessionStorage.getItem(KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  var panel = null;
  var list = null;
  var last = 0;

  function build() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "voice-debug";
    panel.id = "voice-debug";

    var head = document.createElement("div");
    head.className = "voice-debug-head";
    var title = document.createElement("strong");
    title.textContent = "What the line is doing";
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "voice-debug-clear";
    clear.textContent = "Clear";
    clear.addEventListener("click", function () {
      if (list) list.textContent = "";
    });
    head.appendChild(title);
    head.appendChild(clear);

    list = document.createElement("ol");
    list.className = "voice-debug-list";

    panel.appendChild(head);
    panel.appendChild(list);

    /* Inside the sheet, under everything else, so it does not cover the order
       or the microphone. */
    var body = document.getElementById("assistant");
    var host = (body && body.querySelector(".assistant-body")) || document.body;
    host.appendChild(panel);
    return panel;
  }

  /**
   * One line.
   *
   * @param {string} kind  what sort of thing this is, for the colour
   * @param {string} what  the headline, usually the event name
   * @param {string} [detail] the part worth reading
   */
  function line(kind, what, detail) {
    if (!wanted()) return;
    build();
    var now = Date.now();
    var since = last ? "+" + ((now - last) / 1000).toFixed(1) + "s" : "";
    last = now;

    var row = document.createElement("li");
    row.className = "voice-debug-row";
    row.setAttribute("data-kind", kind || "event");

    var when = document.createElement("span");
    when.className = "voice-debug-when";
    when.textContent = since;

    var name = document.createElement("span");
    name.className = "voice-debug-what";
    name.textContent = String(what || "");

    row.appendChild(when);
    row.appendChild(name);

    if (detail) {
      var body = document.createElement("div");
      body.className = "voice-debug-detail";
      body.textContent = String(detail);
      row.appendChild(body);
    }

    list.insertBefore(row, list.firstChild);
    while (list.children.length > MOST) list.removeChild(list.lastChild);
  }

  /*
   * The events worth a headline of their own.
   *
   * Everything else is listed too, quietly, because "which events arrive and
   * in what order" is the question when a line is behaving oddly - and an
   * event nobody thought to name is exactly the one that turns out to matter.
   */
  var LOUD = {
    "conversation.item.input_audio_transcription.completed": "heard",
    "response.output_audio_transcript.done": "said",
    "response.audio_transcript.done": "said",
    "response.function_call_arguments.done": "tool",
    "response.done": "response done",
    "input_audio_buffer.speech_started": "somebody started speaking",
    "input_audio_buffer.speech_stopped": "speech stopped",
    error: "ERROR",
  };

  function event(ev) {
    if (!wanted() || !ev || !ev.type) return;
    var kind = "event";
    var what = LOUD[ev.type] || ev.type;
    var detail = "";

    if (ev.type === "conversation.item.input_audio_transcription.completed") {
      kind = "heard";
      detail = String(ev.transcript || "").trim() || "(nothing)";
    } else if (/audio_transcript\.done$/.test(ev.type)) {
      kind = "said";
      detail = String(ev.transcript || "").trim();
    } else if (ev.type === "response.function_call_arguments.done") {
      kind = "tool";
      detail = String(ev.name || "") + " " + String(ev.arguments || "");
    } else if (ev.type === "error") {
      kind = "error";
      detail = JSON.stringify(ev.error || ev);
    } else if (ev.type === "response.done") {
      var r = ev.response || {};
      detail = "status " + String(r.status || "?");
      /*
       * WHY IT SAID "OK" WITH NOBODY TALKING.
       *
       * A response whose output carries no audio transcript and no tool call
       * is the model answering something that was not said - which is what a
       * line triggered by room noise produces. Named here, because that is
       * the owner's actual question and counting them is the answer.
       */
      var items = (r.output || []).map(function (i) {
        return i && i.type;
      });
      if (items.length) detail += " · " + items.join(", ");
      if (!items.length) {
        kind = "error";
        detail += " · EMPTY - the model was asked to reply to nothing";
      }
    }
    line(kind, what, detail);
  }

  /** Something this page did, rather than something the line said. */
  function did(what, detail) {
    line("did", what, detail);
  }

  window.VoiceDebug = { event: event, did: did, line: line, wanted: wanted };
})();
