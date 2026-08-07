'use strict';
/*
 * The shop's chosen date order, and its clock.
 *
 * Configuration offers three orders - dd/mm/yyyy, yyyy/mm/dd, mm/dd/yyyy - and
 * defaults to the first. The sales report ignored that and printed month-first
 * regardless, so a receipt dated 08/03/2026 in a Goa shop read as 8 March and
 * meant 3 August. Nothing errors, nothing looks broken; the two readings simply
 * disagree by five months on a document used for accounting and for arguing
 * with a customer.
 *
 * The rule this exists to enforce: a literal date format belongs in exactly one
 * file, and this is it. Anywhere else, someone will eventually write the format
 * their own keyboard taught them.
 *
 * The timezone matters for the same reason and is worse: it can change the day.
 * A sale at 9:30pm in Goa is 16:00 UTC, and a report grouping by UTC files it
 * under the wrong date entirely for the last two and a half hours of every
 * trading day - so a shop closing at 10pm finds a chunk of takings on
 * tomorrow's sheet.
 */

/* What Configuration stores, mapped to what MongoDB's $dateToString wants. */
const MONGO_FORMATS = {
  'dd/mm/yyyy': '%d/%m/%Y',
  'yyyy/mm/dd': '%Y/%m/%d',
  'mm/dd/yyyy': '%m/%d/%Y',
};

/*
 * India, unless a branch says otherwise.
 *
 * Not UTC. Every shop running this is in one timezone and it is not that one;
 * defaulting to UTC means the default is wrong for everybody, which is a worse
 * failure than a default that is right for nearly everybody.
 */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_ORDER = 'dd/mm/yyyy';

/*
 * The $dateToString format for a branch, honouring what the shop picked.
 *
 * @param {object} branch  a branch document, or anything with client_dateformat
 * @param {object} [opts]
 * @param {boolean} [opts.withTime=true]  append 24-hour time
 */
function mongoDateFormat(branch, { withTime = true } = {}) {
  const order = String((branch && branch.client_dateformat) || DEFAULT_ORDER)
    .trim()
    .toLowerCase();
  const date = MONGO_FORMATS[order] || MONGO_FORMATS[DEFAULT_ORDER];
  return withTime ? `${date} %H:%M` : date;
}

/*
 * The timezone a branch's days are measured in.
 *
 * Falls through branch, then deployment default, then India - never the
 * server's own clock, which is a machine in a data centre and has no opinion
 * worth having about when a shop's day ends.
 */
function branchTimezone(branch) {
  const zone = (branch && branch.time_zone) || process.env.DEFAULT_TIMEZONE || DEFAULT_TIMEZONE;
  return String(zone).trim() || DEFAULT_TIMEZONE;
}

/* Both, for the common case of building one aggregation stage. */
function dateDisplay(branch, opts) {
  return {
    format: mongoDateFormat(branch, opts),
    timezone: branchTimezone(branch),
  };
}

module.exports = {
  mongoDateFormat,
  branchTimezone,
  dateDisplay,
  MONGO_FORMATS,
  DEFAULT_TIMEZONE,
  DEFAULT_ORDER,
};
