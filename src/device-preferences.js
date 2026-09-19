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

/**
 * WHETHER THIS TILL RELAYS BILLS THAT CAME IN OVER THE INTERNET.
 *
 * Owner: "may be configuration or toggle to poll cloud. it needs to be on only
 * when required. otherwise let app connect via lan and give print."
 *
 * Off unless somebody turned it on, and that is the right default: a handset
 * on the shop's own Wi-Fi talks to this machine directly, which is faster,
 * works with the line cut, and costs nothing. The switch is for the shop whose
 * waiters are on mobile data or a guest network that cannot see the till.
 *
 * Per machine rather than per shop, like the printers beside it. A shop with
 * two tills wants ONE of them relaying cloud bills - the one by the printer
 * the customer is standing at - not both of them racing for the same job.
 *
 * The address is separate so a shop can be pointed at its tenant without the
 * relay being on, and so turning the relay off does not lose the address.
 */
function cloudPrintRelay() {
  const prefs = all();
  const said = prefs.cloud_print_relay;
  return {
    /*
     * ON only for a real yes.
     *
     * Both spellings accepted because a preferences file can be hand-edited
     * and older builds of anything here have written settings as text. What
     * must never happen is the reverse: the string 'false' is a TRUTHY string,
     * so a lazier test would read a switch somebody turned off as ON, for ever.
     * This desktop has been bitten by that before.
     */
    enabled: said === true || said === 'true',
    apiUrl: String(prefs.cloud_api_url || '').trim(),
    /*
     * The key the FAR door presents, which is deliberately not this machine's
     * kiosk key. That one guards every kiosk route on this till's own api;
     * sending it to an address somebody typed would risk all of them to buy
     * nothing. This one is worth taking print jobs and nothing else.
     *
     * Made by hardware-ipc at startup. Empty here means a till that has not
     * started since this shipped, and the far door simply stays shut.
     */
    key: String(prefs.cloud_print_key || '').trim(),
  };
}

/**
* The printers this till sends KITCHEN TICKETS to.
 *
 * Kept in its own file by the kitchen manager, not in preferences.json, which
 * is why this reads a second one. Needed here because a receipt must never
 * come out on one of them: owner, on a two-printer restaurant, "receipt only
 * send to Reception right. kitchen should receive only kot print."
 */
function kotPrinterNames() {
  try {
    const { app } = require('electron');
    const file = path.join(app.getPath('userData'), 'kot-config.json');
    if (!fs.existsSync(file)) return [];
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    const fromList = Array.isArray(cfg.printers)
      ? cfg.printers.map((t) => (t && typeof t === 'object' ? t.name : t))
      : [];
    const names = [...(Array.isArray(cfg.printerNames) ? cfg.printerNames : []), ...fromList];
    return names.map((n) => String(n || '').trim()).filter(Boolean);
  } catch (e) {
    /* No kitchen config is the ordinary case for a shop with one printer. */
    return [];
  }
}

/** Is this printer one the kitchen prints on? Matched loosely, like every
    other printer name in this codebase, because people type them. */
function isKitchenPrinter(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return false;
  return kotPrinterNames().some((n) => n.toLowerCase() === wanted);
}

function documentPrintSettings(prefs = all()) {
  const parse = (value, fallback) => {
    try { return (typeof value === 'string' ? JSON.parse(value) : value) || fallback; }
    catch (_) { return fallback; }
  };
  const documents = parse(prefs.document_print_profiles, {});
  const { normalizeTargets } = require('./printer-targets');
  const sheet = (input) => {
    const value = input && typeof input === 'object' ? input : {};
    return {
      printerName: String(value.printerName || ''),
      paperSize: ['a4', 'a5', 'letter'].includes(value.paperSize) ? value.paperSize : 'a4',
      copies: Math.min(20, Math.max(1, parseInt(value.copies, 10) || 1)),
    };
  };
  return {
    sales: normalizeTargets({ printers: parse(prefs.receipt_printers, []),
      printerName: prefs.receipt_printer || 'default', pageSize: prefs.print_width || '80mm' })
      .map((target) => ({ ...target, name: target.name || 'default' })),
    invoice: sheet(documents.invoice), quotation: sheet(documents.quotation),
  };
}

function validateDocumentPrintSettings(value) {
  const { PAPER_SIZES } = require('./printer-targets');
  const copies = (n) => Number.isInteger(n) && n >= 1 && n <= 20;
  const name = (v) => typeof v === 'string' && v.length <= 256 && !/[\r\n\0]/.test(v);
  if (!value || !Array.isArray(value.sales) || !value.sales.length || value.sales.length > 10) throw new Error('Choose at least one sales printer (up to 10).');
  const seen = new Set();
  for (const target of value.sales) {
    if (!target || !name(target.name) || !target.name.trim() || !PAPER_SIZES[target.pageSize] || !copies(target.copies)) throw new Error('Invalid sales printer settings.');
    const key = target.name.trim().toLowerCase();
    if (seen.has(key)) throw new Error('Choose each sales printer once. Use Copies for additional copies.');
    seen.add(key);
  }
  for (const kind of ['invoice', 'quotation']) {
    const target = value[kind];
    if (!target || !name(target.printerName) || !['a4', 'a5', 'letter'].includes(target.paperSize) || !copies(target.copies)) throw new Error('Invalid ' + kind + ' print settings.');
  }
  return documentPrintSettings({ receipt_printers: value.sales,
    document_print_profiles: { invoice: value.invoice, quotation: value.quotation } });
}

module.exports = {
  all,
  get,
  receiptPrinterName,
  kotPrinterNames,
  isKitchenPrinter,
  cloudPrintRelay,
  prefsPath,
  documentPrintSettings,
  validateDocumentPrintSettings,
};
