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

/** Is this machine meant to say tickets out loud? */
function wanted() {
  const file = settingsPath();
  if (!file) return false;

  try {
    if (!fs.existsSync(file)) return false;
    const said = JSON.parse(fs.readFileSync(file, "utf8"));
    return said && said.announce === true;
  } catch (e) {
    /* A file somebody edited by hand and broke means OFF, not noise. */
    return false;
  }
}

/** Turn it on or off for this machine. */
function set(on) {
  const file = settingsPath();
  if (!file) return false;

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ announce: on === true }, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { wanted, set, useApp, settingsPath };
