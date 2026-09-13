'use strict';
/*
 * A day's receipt prints, kept the way kitchen tickets already are.
 *
 * Asked for directly: "receipt also will have 1 day log? just to see what
 * printed ?? or tried to print.. something same like KOT ?"
 *
 * Kitchen tickets have had a log with a screen for a long time. Receipts had
 * nothing at all - not a line, not a file. When a customer said their bill
 * never came out there was no way to tell whether the till had tried, which
 * printer it went to, or what the printer said back. The only recourse was to
 * print it again and watch.
 *
 * TRIED counts, not just printed. That is the half that matters: a receipt
 * that failed is the one somebody is asking about, and a log that records only
 * successes is silent at exactly the moment it is needed.
 *
 * The shape follows kot-manager's log on purpose - one JSON file per day in
 * the user's data directory, newest appended - so the screen, the date picker
 * and the housekeeping all work the same way and a person who has read one has
 * read both.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let baseDir = null;

/** Where the logs live. Set once at boot; falls back beside this file. */
function dir() {
  if (!baseDir) {
    try {
      baseDir = path.join(require('electron').app.getPath('userData'), 'receipt-logs');
    } catch (e) {
      baseDir = path.join(__dirname, 'receipt-logs');
    }
  }
  return baseDir;
}

const fileFor = (date) => path.join(dir(), `receipt-logs-${date}.json`);
const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);

/* Kept so a till that prints all day does not grow a file nobody will read.
   A day of receipts is what was asked for; more than this is a different
   feature with different storage. */
const MAX_PER_DAY = 2000;
const MAX_PRINTERS = 16;

/* Receipt jobs can arrive from another installation. Persist a deliberately
   small, plain-data record rather than copying its network payload into the
   local log: this keeps control bytes, oversized strings, and unexpected
   object shapes out of a file the Hardware Manager later displays. */
function text(value, limit) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, limit);
}

function timestamp(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function printers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PRINTERS).map((printer) => ({
    name: text(printer?.name, 128),
    status: printer?.status === 'success' ? 'success' : 'failed',
    reason: text(printer?.reason, 512) || undefined,
    bytes: Number.isFinite(Number(printer?.bytes)) ? Math.max(0, Number(printer.bytes)) : undefined,
  }));
}

function newId() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* older runtime */ }
  return crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex');
}

/**
 * Record one receipt print, whether it worked or not.
 *
 * Never throws. A log that cannot be written must not fail a receipt the
 * customer is standing there waiting for.
 *
 * @param {object} entry
 * @param {string} [entry.kind]     'receipt', 'bill', 'report'
 * @param {string} [entry.saleId]   the bill number a person would recognise
 * @param {string} [entry.title]    what the paper called itself
 * @param {number} [entry.total]
 * @param {string} [entry.source]   what asked for it: 'Till', 'Floor bill', ...
 * @param {number} [entry.ms]       asked to last copy accepted
 * @param {Array}  [entry.printers] one row per copy: {name, status, reason, ms}
 */
function record(entry = {}) {
  try {
    const time = timestamp(entry.time);
    const row = {
      id: newId(),
      time,
      kind: ['receipt', 'bill', 'report'].includes(entry.kind) ? entry.kind : 'receipt',
      saleId: text(entry.saleId, 128),
      title: text(entry.title, 128),
      total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0,
      source: text(entry.source, 64) || undefined,
      ms: Number.isFinite(Number(entry.ms)) ? Math.max(0, Number(entry.ms)) : undefined,
      printers: printers(entry.printers),
    };
    /* Said once here rather than recomputed by every reader: a receipt counts
       as printed when at least one copy landed, because the customer has their
       copy even if the file copy failed. */
    row.status = row.printers.some((p) => p.status === 'success') ? 'printed' : 'failed';

    fs.mkdirSync(dir(), { recursive: true });
    const file = fileFor(dayOf(time));
    let rows = [];
    /* Read first rather than asking whether it exists: the answer can stop
       being true before the read, and an absent log is the ordinary case on
       the first receipt of the day. */
    try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    rows.push(row);
    if (rows.length > MAX_PER_DAY) rows = rows.slice(-MAX_PER_DAY);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
    return row;
  } catch (e) {
    console.warn('[receipt-log] could not write:', e.message);
    return null;
  }
}

/** A day's rows, oldest first. Empty for a day with none, which is not an error. */
function forDate(date) {
  try {
    const rows = JSON.parse(fs.readFileSync(fileFor(date), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/** Remove one row. Returns true when it was there. */
function remove(date, id) {
  try {
    const file = fileFor(date);
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) return false;
    const kept = rows.filter((r) => r.id !== id);
    if (kept.length === rows.length) return false;
    fs.writeFileSync(file, JSON.stringify(kept, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

/* Tests only. */
function _setDir(d) { baseDir = d; }

module.exports = { record, forDate, remove, MAX_PER_DAY, _setDir };
