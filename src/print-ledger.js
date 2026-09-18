'use strict';

/*
 * What this till has already tried to print, remembered across a restart.
 *
 * THE BUG THIS EXISTS FOR
 *
 * kot-manager kept its record of printed tickets in `new Set()`. A Set lives in
 * memory, so every restart emptied it, and the only other guard - the server's
 * own "marked printed" flag - is written AFTER the paper comes out, in a
 * separate request, for the whole batch at once.
 *
 * Print six tickets, crash before that request, restart. The Set is empty and
 * the server still says unprinted. All six print again, the kitchen cooks twelve
 * dishes, and nobody notices: a cook prepares what arrives and does not compare
 * it against what arrived a minute ago.
 *
 * Owner: "dupliate prints should not be there its loss for company. people wont
 * care and keep preparing what receied. they dont compare usaully what
 * received. so very carefull on that."
 *
 * WHY THE RECORD IS WRITTEN BEFORE THE PRINT
 *
 * The record has to survive the thing it is protecting against, and what it is
 * protecting against is dying halfway. Written afterwards it is useless exactly
 * when it is needed. So the attempt is written first, flushed, and the outcome
 * is added after.
 *
 * That means a till which dies between the write and the paper will NOT reprint
 * that ticket, and someone has to notice a missing one. That is the intended
 * trade, argued in Intranet/docs/PRINT_APPROVAL_NOTIFICATION_ARCHITECTURE.md: a
 * duplicate is silent and costs food, a miss is loud and costs a reminder.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not retry, does not decide anything, and does not change when the
 * server is told. Printing behaves exactly as it did except that a restart no
 * longer reprints. Everything else in this area is Stage 2 and is a bigger
 * change with real trade-offs; this is the small safe one that stops the
 * bleeding.
 *
 * It also records the OUTCOME of every attempt, including failures, which is
 * the measurement this area has never had. Nobody currently knows whether
 * duplicates happen four times a week or forty.
 *
 * NOTHING HERE MAY THROW. A ledger problem must never become a printing
 * problem: a customer is standing there and the ticket matters more than the
 * bookkeeping.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Two days. Long enough that a till restarted overnight still remembers
   yesterday's last tickets, short enough that the file stays small. */
const KEEP_DAYS = 2;
/* A busy shop prints a few hundred tickets a day. This is a ceiling against a
   runaway loop filling a disk, not an expected size. */
const MAX_ENTRIES = 5000;

let _dir = '';
let _cache = null;

function _file() {
  return path.join(_dir, 'print-ledger.json');
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** Read once, then keep it in memory; the file is only the durable copy. */
function _load() {
  if (_cache) return _cache;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(_file(), 'utf8'));
  } catch (e) {
    /* No file yet, or an unreadable one. An empty ledger behaves exactly like
       the old in-memory Set, which is the safe direction to fail in: the worst
       case is the behaviour we already had. */
  }
  const keep = new Set([...Array(KEEP_DAYS).keys()].map(_dayKey));
  const entries = {};
  for (const [key, value] of Object.entries((raw && raw.entries) || {})) {
    if (value && keep.has(String(value.day || ''))) entries[key] = value;
  }
  _cache = { entries };
  return _cache;
}

/*
 * Written synchronously, on purpose.
 *
 * This costs a millisecond or two on a path that takes around 150. Doing it
 * asynchronously would mean the paper could beat the record to disk, which is
 * the exact race this file exists to close.
 */
function _save() {
  if (!_dir || !_cache) return;
  try {
    const keys = Object.keys(_cache.entries);
    if (keys.length > MAX_ENTRIES) {
      /* Oldest first. A ledger that grew without bound would eventually be the
         reason a till stopped, which would be a worse bug than the one it
         prevents. */
      keys
        .sort((a, b) => String(_cache.entries[a].at).localeCompare(String(_cache.entries[b].at)))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete _cache.entries[k]);
    }
    const tmp = _file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_cache), 'utf8');
    fs.renameSync(tmp, _file());
  } catch (e) {
    /* Swallowed. See the header: a ledger problem must not stop a ticket. The
       in-memory copy still guards this run. */
    console.warn('[PrintLedger] could not be written:', e.message);
  }
}

/** Where the ledger lives. Called once at startup, and by tests. */
function setDir(dir) {
  _dir = String(dir || '');
  _cache = null;
}

/**
 * A stable name for one ticket.
 *
 * Content as well as identity: two tickets for the same sale that say different
 * things are different tickets, and an amended order must be able to print
 * again. The hash is what makes a duplicate detectable afterwards as well as
 * preventable at the time.
 */
/*
 * How many times a ticket we WATCHED fail may be tried again.
 *
 * Three, and then it stops. A printer that is switched off stays
 * switched off, and a ticket that retries for ever is a poll that never
 * finishes and a queue that never drains.
 */
const MAX_ATTEMPTS = 3;

function keyFor(parts) {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

/** Has this exact ticket already been attempted, on any run? */
function attempted(key) {
  if (!_dir || !key) return false;
  return Boolean(_load().entries[String(key)]);
}

/**
 * Record that a ticket is ABOUT to print. Before the bytes go anywhere.
 *
 * @returns {boolean} false if it was already attempted, which means do not
 *   print it - the caller is about to duplicate something.
 */
function claim(key, about = {}) {
  if (!_dir || !key) return true;      // no ledger configured: behave as before
  const store = _load();
  const id = String(key);
  if (store.entries[id]) return false;
  store.entries[id] = {
    day: _today(),
    at: new Date().toISOString(),
    state: 'attempted',
    attempts: 1,
    sale: String(about.saleId || ''),
    kind: String(about.kind || ''),
  };
  _save();
  return true;
}

/**
 * How it went. Recorded after the fact, for measurement rather than for any
 * decision - nothing reads this to choose whether to print.
 */
function settle(key, outcome, detail = '') {
  if (!_dir || !key) return;
  const store = _load();
  const entry = store.entries[String(key)];
  if (!entry) return;
  entry.state = outcome === true || outcome === 'printed' ? 'printed' : 'failed';
  if (detail) entry.reason = String(detail).slice(0, 200);
  entry.settledAt = new Date().toISOString();
  _save();
}

/**
 * May a ticket that we WATCHED fail be tried again?
 *
 * The distinction this turns on, and the reason it is safe:
 *
 *   attempted, never settled   the till died between the record and the
 *                              paper. Nobody knows whether a ticket came
 *                              out. Trying again could duplicate it, so
 *                              it is left alone - that is the trade the
 *                              owner asked for and it is unchanged.
 *
 *   settled as failed          the printer ANSWERED, and the answer was
 *                              no: offline, out of paper, queue refused,
 *                              did not answer in time. There is no paper
 *                              to duplicate. Not retrying this is how a
 *                              cancellation disappears for good because a
 *                              printer was asleep for ten seconds.
 *
 * Returns false for a ticket this has never seen, so a first print falls
 * through to claim() exactly as before.
 *
 * @returns {boolean} true when the caller may print it again.
 */
function retry(key) {
  if (!_dir || !key) return false;
  const store = _load();
  const entry = store.entries[String(key)];
  if (!entry) return false;
  if (entry.state !== 'failed') return false;
  const attempts = Number(entry.attempts || 1);
  if (attempts >= MAX_ATTEMPTS) return false;
  entry.attempts = attempts + 1;
  entry.state = 'attempted';
  entry.at = new Date().toISOString();
  delete entry.settledAt;
  _save();
  return true;
}

/**
 * Is this ticket finished with, one way or the other?
 *
 * True when it printed, when it has used up its tries, or when its
 * outcome is unknown and must stay that way. The caller uses this to
 * decide whether the SERVER should be told the sale is done: a ticket
 * with a try left has to be offered again, or the retry above never
 * happens.
 */
function spent(key) {
  if (!_dir || !key) return true;
  const entry = _load().entries[String(key)];
  if (!entry) return true;
  if (entry.state !== 'failed') return true;
  return Number(entry.attempts || 1) >= MAX_ATTEMPTS;
}

/**
 * The measurement, which this area has never had.
 *
 * `attempted` that never settled is the interesting number: it means the till
 * died between the record and the paper, which is the case that used to
 * duplicate and now needs a person to look.
 */
function summary(day = _today()) {
  const out = { day, attempted: 0, printed: 0, failed: 0, unsettled: 0 };
  if (!_dir) return out;
  for (const entry of Object.values(_load().entries)) {
    if (String(entry.day) !== day) continue;
    out.attempted += 1;
    if (entry.state === 'printed') out.printed += 1;
    else if (entry.state === 'failed') out.failed += 1;
    else out.unsettled += 1;
  }
  return out;
}

module.exports = {
  setDir,
  keyFor,
  attempted,
  claim,
  retry,
  spent,
  settle,
  summary,
  KEEP_DAYS,
  MAX_ENTRIES,
  MAX_ATTEMPTS,
};
