'use strict';

/*
 * ONE NAME FOR ONE KITCHEN TICKET, agreed by both sides.
 *
 * The till computes a key for every ticket it prints - sale, type and a hash of
 * the contents - and uses it twice: to skip a ticket it has already printed,
 * and to write the durable claim in print-ledger.js that stops a restart
 * reprinting the lot.
 *
 * The SERVER has never known that key. It hands out sales and is told "these
 * are printed", and the two sides describe the same piece of paper in different
 * words. So nothing can answer the question this whole area turns on:
 *
 *   Did the ticket the server expected to print actually print?
 *
 * Until both sides say the same name for the same ticket, a shadow comparison
 * is impossible and so is a queue - the server cannot queue a thing it cannot
 * identify, and cannot tell a duplicate from a different ticket.
 *
 * WHY CONTENT AND NOT JUST THE SALE
 *
 * An amended order must be able to print again: adding a dish to table 6 is a
 * NEW ticket for the same sale, and keying on the sale alone would silence
 * every amendment after the first. Two tickets that say different things are
 * different tickets. That is also what makes a duplicate detectable afterwards
 * rather than only preventable at the time.
 *
 * WHY MD5, WHICH IS NOT A SECURITY CHOICE
 *
 * This is a name, not a signature. Nothing trusts it against an attacker; it
 * only has to differ when the contents differ. It is md5 because that is what
 * the till already computed, and changing it would rename every ticket in
 * flight on ninety shops the day it shipped.
 *
 * THIS FILE IS COPIED, ON PURPOSE.
 *
 * The API ships OUTSIDE the asar archive and cannot require the desktop shell's
 * modules, so there is a second copy at api/src/utils/kot-job-key.js. A test
 * compares them byte for byte, because two copies that drift would name the
 * same ticket differently and quietly resurrect the duplicate this exists to
 * prevent. Change one, change both.
 */

const crypto = require('crypto');

/**
 * The timestamp as a stable string.
 *
 * A sale arrives as a Mongo document, as EJSON over the wire, or as a plain
 * object built by a test, and the timestamp is a Date, a {$date: ...}, a
 * {$date: {$numberLong}}, or a string depending on which. All four have to
 * reduce to the same token or the two sides hash differently for one ticket.
 */
function timestampToken(ts) {
  if (ts instanceof Date) return ts.getTime().toString();
  if (ts && ts.$date && ts.$date.$numberLong) return String(ts.$date.$numberLong);
  if (ts && ts.$date) return String(ts.$date);
  return String(ts || '');
}

/**
 * The name of one kitchen ticket.
 *
 * @param {string} saleId
 * @param {object} job  one entry of a sale's print_jobs
 * @returns {string} `saleId:type:hash`
 */
function kotJobKey(saleId, job = {}) {
  const id = String(saleId || '');
  const jobType = String(job.type || '').toLowerCase();
  const jobItems = Array.isArray(job.items) ? job.items : [];
  const raw = `${id}-${jobType}-${timestampToken(job.timestamp)}-${JSON.stringify(jobItems)}`;
  const jobHash = crypto.createHash('md5').update(raw).digest('hex');
  return `${id}:${jobType}:${jobHash}`;
}

/** Every ticket a sale is asking for, named. */
function kotJobKeys(sale = {}) {
  const saleId = sale && sale._id && sale._id.toString ? sale._id.toString() : String(sale._id || '');
  const jobs = Array.isArray(sale.print_jobs) ? sale.print_jobs : [];
  return jobs.map((job) => ({ key: kotJobKey(saleId, job), type: String(job.type || '').toLowerCase(), job }));
}

/*
 * THE OTHER KEY, for a sale that carries no print_jobs array.
 *
 * Older sales, and some paths that never built one, arrive as a whole sale with
 * no per-ticket breakdown. The till names those differently - the type comes
 * FIRST and the hash is over the sale's own fields rather than one job's:
 *
 *     print_jobs present : saleId:type:hash
 *     print_jobs absent  : kot:saleId:token   (or cancel:saleId:token)
 *
 * Two schemes for one concept is not a design anybody would choose, and
 * collapsing them would rename every ticket in flight - so both live here,
 * both named, rather than one being unified and the other quietly left behind
 * where the server still cannot see it.
 */
function kotFallbackKey(sale = {}, { cancelled = false } = {}) {
  const saleId = sale && sale._id && sale._id.toString ? sale._id.toString() : String(sale._id || '');
  const updSrc =
    sale.updated_date || sale.updated_at || sale.created_date || sale.created_at || null;
  const dateToken = timestampToken(updSrc);
  const rawToken = `${dateToken}-${sale.table_number || ''}-${sale.person_count || ''}-${JSON.stringify(sale.items || [])}`;
  const token = crypto.createHash('md5').update(rawToken).digest('hex');
  return `${cancelled ? 'cancel' : 'kot'}:${saleId}:${token}`;
}

module.exports = { kotJobKey, kotJobKeys, kotFallbackKey, timestampToken };
