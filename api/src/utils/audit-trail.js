'use strict';

/*
 * A permanent record of who changed what, from where.
 *
 * WHY THIS EXISTS.
 *
 * A shop could not sign in. Their password had been changed the previous
 * afternoon, and the ONLY trace of it anywhere was a timestamp on the user
 * document. Not who did it, not from what address, not whether it was the
 * owner themselves at the counter or somebody who had the password. We could
 * tell the shop that their password had changed and nothing more than that,
 * which is close to useless to somebody deciding whether they have been
 * broken into.
 *
 * `data_change_log` already records edits, but models write it and models have
 * never seen a request, so it carries no address and no user agent. This is
 * the security-relevant half: the small number of events where "from where"
 * is the whole question.
 *
 * WHAT IS NEVER WRITTEN HERE: passwords, password hashes, PINs, tokens or API
 * keys, in either the old or the new value. An audit log is read by more
 * people than the thing it audits, and a log that leaks a credential is worse
 * than no log. `redactValue` enforces that rather than trusting callers.
 */

const SENSITIVE = /pass|pwd|pin|secret|token|key|hash|otp|salt/i;

/*
 * Values are recorded only when they are safe AND small. A field named
 * innocuously can still hold a secret, so the size limit is a second net: an
 * audit entry is a description of a change, not a copy of the record.
 */
function redactValue(field, value) {
  if (SENSITIVE.test(String(field))) return '[redacted]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return '[object]';
  const s = String(value);
  return s.length > 120 ? `${s.slice(0, 120)}...` : s;
}

/**
 * Describe a change as a list of fields, with old and new values, redacted.
 * `before` may be null for a creation.
 */
function describeChanges(before, after) {
  const out = [];
  for (const field of Object.keys(after || {})) {
    const from = before ? before[field] : undefined;
    const to = after[field];
    /* Dates and ObjectIds compare badly with !==; stringify first. */
    if (String(from) === String(to)) continue;
    out.push({
      field,
      from: before ? redactValue(field, from) : null,
      to: redactValue(field, to),
    });
  }
  return out;
}

/**
 * Write one entry to the shop's own audit_log.
 *
 * Never throws. An audit write that fails must not take down the operation it
 * was describing - a shopkeeper being unable to change their password because
 * the log is full would be a worse outcome than a missing line. Failures are
 * reported to the console so they are at least visible.
 *
 * @param {object} db       a mongo Db for the shop
 * @param {object} entry
 * @param {string} entry.event      what happened, e.g. 'password_changed'
 * @param {object} [entry.actor]    who did it: { id, name }
 * @param {object} [entry.target]   what it was done to: { id, name, type }
 * @param {string} [entry.ip]       the real client address, from clientIp(req)
 * @param {string} [entry.userAgent]
 * @param {Array}  [entry.changes]  from describeChanges()
 * @param {object} [entry.extra]    anything else worth keeping
 */
async function recordAudit(db, entry = {}) {
  try {
    if (!db || !entry.event) return null;
    const doc = {
      at: new Date(),
      event: String(entry.event),
      actor_user_id: entry.actor ? entry.actor.id || null : null,
      actor_name: entry.actor ? entry.actor.name || '' : '',
      target_user_id: entry.target ? entry.target.id || null : null,
      target_name: entry.target ? entry.target.name || '' : '',
      target_type: entry.target ? entry.target.type || '' : '',
      /* 'unknown' rather than absent: a missing field reads as "we did not
         look", and the difference matters when reading a log after an
         incident. */
      ip: entry.ip || 'unknown',
      user_agent: String(entry.userAgent || '').slice(0, 300),
      branch_id: entry.branchId || null,
      license: entry.license || null,
      changes: Array.isArray(entry.changes) ? entry.changes : [],
      ...(entry.extra || {}),
    };
    await db.collection('audit_log').insertOne(doc);
    return doc;
  } catch (err) {
    console.error('[audit] could not record', entry.event, '-', err.message);
    return null;
  }
}

module.exports = { recordAudit, describeChanges, redactValue };
