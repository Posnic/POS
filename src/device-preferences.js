'use strict';
/*
 * What this machine was told about its own hardware.
 *
 * Printer choices are per machine, not per shop, and deliberately so: two
 * tills in one shop have different printers attached, and a setting that
 * synced would have them fighting over one name. They live in
 * `userData/preferences.json`, written by Hardware Manager.
 *
 * That file was read in exactly one place, inside setupHardwareIPC, as a
 * local. Anything outside that closure had no way to ask which printer the
 * shop chose - which is how the floor-requested bill came to be sent to
 * "whatever Windows calls the default" instead of the receipt printer, and
 * printed in the kitchen in a two-printer restaurant.
 *
 * Read on every call rather than cached. These are answered when a printer is
 * about to be used, which is rare and slow anyway, and a cache here would mean
 * a shop that changed its receipt printer had to restart the till.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function prefsPath() {
  try {
    return path.join(app.getPath('userData'), 'preferences.json');
  } catch (e) {
    /* No electron app object: a test, or a script. */
    return '';
  }
}

/** Everything this machine was told. Never throws; an unreadable file is {}. */
function all() {
  const file = prefsPath();
  if (!file) return {};
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    console.error('[prefs] could not be read:', e.message);
  }
  return {};
}

/** One answer, or null. */
function get(key) {
  const prefs = all();
  return prefs[key] === undefined ? null : prefs[key];
}

/**
 * The printer the shop chose for receipts, or null to mean "nobody chose".
 *
 * `receipt_printers` is the current shape, a list of targets each with its own
 * copies and paper; `receipt_printer` is the single name older builds wrote
 * and is still kept in step by Hardware Manager. The FIRST target is the
 * receipt printer: the rest are extra copies of the same document, and a
 * document that must go to one counter goes to the first.
 *
 * Null is meaningful and must not be turned into a guess by the caller unless
 * it has decided that guessing is right. The till receipt falls back to the
 * Windows default because every shop predates this setting and refusing to
 * print would break them on upgrade. A document that must land on a
 * particular counter should say so instead.
 */
function receiptPrinterName() {
  const prefs = all();
  const list = Array.isArray(prefs.receipt_printers) ? prefs.receipt_printers : [];
  for (const target of list) {
    const name = target && typeof target === 'object' ? target.name : target;
    if (name && String(name).trim() && String(name).trim() !== 'default') {
      return String(name).trim();
    }
  }
  const single = prefs.receipt_printer;
  if (single && String(single).trim() && String(single).trim() !== 'default') {
    return String(single).trim();
  }
  return null;
}

module.exports = { all, get, receiptPrinterName, prefsPath };
