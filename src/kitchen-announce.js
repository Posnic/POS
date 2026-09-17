"use strict";

/*
 * WHETHER THIS MACHINE IS THE ONE IN THE KITCHEN.
 *
 * Owner: "need to place in kitchen... there will bluetooth speaker will be
 * connected to desktop app."
 *
 * PER MACHINE, NOT PER SHOP, and that is the whole reason this file exists
 * rather than a branch setting. A shop runs a till at the counter and a
 * machine at the pass; only one of them has a speaker and only one of them is
 * standing in the noise. A shop-wide switch would make the counter talk too,
 * somebody would mute the counter, and on many installs that is the same
 * Windows volume the kitchen's speaker is on.
 *
 * OFF UNLESS SAID OTHERWISE. A till that started announcing orders after an
 * update, in a room with customers at the counter, is a support call and an
 * embarrassment. Somebody turns this on once, on the machine by the pass.
 *
 * Read fresh each time rather than cached: whoever sets it up will flip it and
 * expect the next ticket to speak, not the next restart.
 */

const fs = require("fs");
const path = require("path");

let appRef = null;

/* Injected so this can be read and tested without Electron. */
function useApp(electronApp) {
  appRef = electronApp || null;
}

function settingsPath() {
  try {
    const base =
      (appRef && typeof appRef.getPath === "function" && appRef.getPath("userData")) ||
      process.env.POSNIC_USER_DATA ||
      "";
    if (!base) return "";
    return path.join(base, "kitchen-announce.json");
  } catch (e) {
    return "";
  }
}

/*
 * TWO SWITCHES, NOT ONE.
 *
 * Owner: "ting sound on/off read it on/off seperately?"
 *
 * They are different things to a kitchen. The chime says a ticket has landed
 * and costs a second; the reading says what is on it and costs ten. A kitchen
 * that knows to look at the printer wants the first and will come to resent
 * the second, and a kitchen whose printer is across the room wants both. One
 * switch would make somebody choose between hearing nothing and hearing too
 * much, and they would choose nothing.
 *
 * BOTH OFF UNLESS SAID OTHERWISE. A till that started talking after an update,
 * in a room with customers at the counter, is a support call.
 *
 * Read fresh each time rather than cached: whoever sets this up will flip a
 * switch and expect the next ticket to obey it, not the next restart.
 */
/*
 * WHICH BELL, AND WHOSE VOICE.
 *
 * Owner: "how about user picks the bell sound as choice how you gave me" and
 * "different countries might need different voice and accent".
 *
 * Both belong beside the switches rather than in the code that makes the
 * sound. A kitchen with a fryer roaring needs a different bell from a quiet
 * dining room, and a shop in Chennai needs a different voice from one in
 * Dubai. None of that is a decision to make once, in one file, for every shop.
 *
 * A voice is stored by NAME, and an empty name means "choose the best one on
 * this machine" rather than a particular voice. That is what makes the setting
 * survive a machine that does not have the voice a shop picked: it falls back
 * instead of going silent, and a downloaded voice pack later just adds another
 * name to the same list.
 */
const DEFAULTS = { ting: false, speak: false, arrivalBell: "rising", itemBell: "soft", voice: "" };

const shape = (said) => ({
  ting: said.ting === true,
  speak: said.speak === true,
  arrivalBell: typeof said.arrivalBell === "string" && said.arrivalBell
    ? said.arrivalBell
    : DEFAULTS.arrivalBell,
  itemBell: typeof said.itemBell === "string" && said.itemBell
    ? said.itemBell
    : DEFAULTS.itemBell,
  voice: typeof said.voice === "string" ? said.voice : DEFAULTS.voice,
});

function settings() {
  const file = settingsPath();
  if (!file) return Object.assign({}, DEFAULTS);

  try {
    if (!fs.existsSync(file)) return Object.assign({}, DEFAULTS);
    const said = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!said || typeof said !== "object") return Object.assign({}, DEFAULTS);

    /*
     * The single switch this replaced meant both. A machine already set up in
     * a kitchen must not fall silent because the setting grew a second half.
     */
    if (said.ting === undefined && said.speak === undefined) {
      const both = said.announce === true;
      return shape(Object.assign({}, said, { ting: both, speak: both }));
    }

    return shape(said);
  } catch (e) {
    /* A file somebody edited by hand and broke means OFF, not noise. */
    return Object.assign({}, DEFAULTS);
  }
}

/** Is this machine meant to make any sound at all about a ticket? */
function wanted() {
  const said = settings();
  return said.ting || said.speak;
}

/**
 * Set one or both for this machine.
 *
 * A value left out is left as it was, so turning the reading off does not
 * silently take the chime with it.
 */
function set(next) {
  const file = settingsPath();
  if (!file) return false;

  const now = settings();
  const asked = typeof next === "boolean" ? { ting: next, speak: next } : next || {};

  /* Merged onto what is already there, so setting one thing never quietly
     resets another. Somebody turning the reading off must not lose the bell
     they spent five minutes choosing. */
  const wanted = shape(
    Object.assign({}, now, {
      ting: asked.ting !== undefined ? asked.ting === true : now.ting,
      speak: asked.speak !== undefined ? asked.speak === true : now.speak,
      arrivalBell: asked.arrivalBell !== undefined ? asked.arrivalBell : now.arrivalBell,
      itemBell: asked.itemBell !== undefined ? asked.itemBell : now.itemBell,
      voice: asked.voice !== undefined ? String(asked.voice || "") : now.voice,
    })
  );

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(wanted, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { settings, wanted, set, useApp, settingsPath };
