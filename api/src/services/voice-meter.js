'use strict';
/*
 * The meter on a live voice line.
 *
 * A typed question reports its token count and is metered on the spot. A
 * live line cannot: the audio goes phone to provider and never passes our
 * server, which only opened the door. Until this file, a shop that switched
 * live voice on had a monthly limit that covered every question typed and
 * not one minute spoken, which is the dearest thing it can switch on.
 *
 * HOW THE MINUTES ARE COUNTED. When the line opens, a session row is
 * written. The page then says "still talking" every half minute, and once
 * more as the line closes. Each tick is clocked HERE, on the server, as the
 * seconds since the last one, and never more than a tick and a half: a page
 * cannot lengthen a call by lying, only shorten it by staying silent, and a
 * page that stays silent is a page that has gone. Those seconds are priced
 * as audio tokens (ai-budget.js) and written to the same meter every other
 * feature uses, on the same row the opening call made, so the settings
 * screen shows the call and its minutes together.
 *
 * THE BRAKE. Every tick checks the monthly limit. Past it, the answer is a
 * refusal and the session is closed; the page hangs up and says why. So the
 * cap holds while a call is in progress, not only at the door - the door is
 * checked by ai.service before the line opens, as for every other call.
 *
 * What the seconds are worth is approximate and says so on the screen. The
 * provider's dashboard is the final word on the bill; this is the brake and
 * the meter, which is what the shop asked for when it set a limit.
 */
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const budget = require('./ai-budget');

/* Named so the sync classification finds it: it stays local, see
   api/src/sync/collections.json. */
const sessionCollection = 'ai_voice_sessions';

/*
 * WHAT WAS ACTUALLY SAID, KEPT WITH THE CALL.
 *
 * Owner: "watch my conversation via server ... i want know what trascribed
 * in the chat. not abel see."
 *
 * The audio never touches this server - phone to provider, which is the
 * point - so the only way anybody here can see what a call did is if the
 * page tells us. It already speaks to us every half minute to keep the
 * meter honest; the lines it heard and said ride along on that, which costs
 * no extra request. Diagnosing "it keeps saying aha at nothing" from the
 * outside has now cost several afternoons, and one look at the words ends
 * it: a line of room noise transcribed as speech is unmistakable.
 *
 * ON THE SESSION ROW, which is the shop's own data, scoped to the shop's
 * branch and swept with the rest of it. No public endpoint reads this back.
 * The last forty lines only: this is for looking at a call that went wrong,
 * not an archive of what customers say.
 */
const MOST_LINES = 40;
const LINE_CHARS = 300;

function linesFrom(body) {
  const asked = Array.isArray(body && body.said) ? body.said.slice(-MOST_LINES) : [];
  const out = [];
  for (const one of asked) {
    const text = String((one && one.text) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, LINE_CHARS);
    if (!text) continue;
    out.push({
      who: String((one && one.who) || '') === 'ai' ? 'ai' : 'customer',
      text,
      at: new Date(),
    });
  }
  return out;
}

/** How often the page reports the line is open. */
const TICK_SECONDS = 30;
/** The most one tick may add. A late tick is a slow network, not a longer call. */
const TICK_MAX_SECONDS = 45;
/** Sessions nobody will tick again are swept when a new one opens. */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function scope(context) {
  return {
    license: BaseModel.license,
    branch_id: String((context && context.branchId) || ''),
  };
}

/**
 * A line has opened: start its clock.
 *
 * @returns {Promise<string>} the session id the page must send back with every tick
 */
async function open({ model, feature }, context) {
  const db = await BaseModel.getDb();
  const now = new Date();
  const row = {
    ...scope(context),
    model: String(model || ''),
    feature: String(feature || 'voice_order_live'),
    started_at: now,
    last_seen_at: now,
    seconds: 0,
    ended: false,
  };
  const out = await db.collection(sessionCollection).insertOne(row);
  db.collection(sessionCollection)
    .deleteMany({ started_at: { $lt: new Date(now.getTime() - STALE_AFTER_MS) } })
    .catch(() => {});
  return String(out.insertedId);
}

/**
 * The line is still open, or has just closed.
 *
 * @param {string} id       the session the page was given when the line opened
 * @param {{end?: boolean}} body  `end` when the page is hanging up
 * @returns {Promise<{status: boolean, message?: string, data: object|null}>}
 *   `message` is 'no_session' for an id that is not an open line of this
 *   shop, and 'cap' when the monthly limit has been reached and the line
 *   must close.
 */
async function tick(id, body, context) {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return { status: false, message: 'no_session', data: null };
  }
  const end = !!(body && (body.end === true || /^(true|1)$/i.test(String(body.end))));
  const said = linesFrom(body);
  const db = await BaseModel.getDb();
  const rows = db.collection(sessionCollection);
  const now = new Date();
  const row = await rows.findOne({ _id: new ObjectId(id), ...scope(context), ended: false });
  if (!row) return { status: false, message: 'no_session', data: null };

  const since = (now.getTime() - new Date(row.last_seen_at || row.started_at).getTime()) / 1000;
  const delta = Math.max(0, Math.min(TICK_MAX_SECONDS, Math.round(since)));
  await rows.updateOne(
    { _id: row._id },
    {
      $inc: { seconds: delta },
      $set: { last_seen_at: now, ended: end },
      ...(said.length ? { $push: { said: { $each: said, $slice: -MOST_LINES } } } : {}),
    }
  );
  if (delta > 0) {
    await budget.record(
      {
        feature: row.feature,
        model: row.model,
        ...budget.voiceTokens(delta),
        seconds: delta,
        calls: 0,
      },
      context
    );
  }
  const seconds = (Number(row.seconds) || 0) + delta;

  /* The brake. Read lazily: ai.service is the one that needs this file's
     neighbour, and a require at the top would run in a circle. */
  const { cap } = await require('./ai.service').settingsFor(context);
  if (cap && !end) {
    const room = await budget.withinCap(context, cap);
    if (!room.ok) {
      await rows.updateOne({ _id: row._id }, { $set: { ended: true, ended_by: 'cap' } });
      return { status: false, message: 'cap', data: { seconds } };
    }
  }
  return { status: true, data: { seconds, ended: end, next: end ? 0 : TICK_SECONDS } };
}

/**
 * The last few calls on this shop's line, with what was said on each.
 *
 * For the shop, about the shop, behind the staff door - the same door the
 * AI spend meter is behind. Owner: "watch my conversation via server."
 * Diagnosing a live line from the outside means guessing at what it heard,
 * and guessing is what has cost the time.
 *
 * @param {{branchId?: string}} context
 * @param {number} [howMany] calls to return, newest first
 */
async function recent(context, howMany = 5) {
  const db = await BaseModel.getDb();
  const rows = await db
    .collection(sessionCollection)
    .find(scope(context))
    .sort({ started_at: -1 })
    .limit(Math.max(1, Math.min(20, Number(howMany) || 5)))
    .toArray();
  return rows.map((row) => ({
    id: String(row._id),
    started_at: row.started_at,
    seconds: Number(row.seconds) || 0,
    ended: row.ended === true,
    model: row.model || '',
    said: Array.isArray(row.said)
      ? row.said.map((one) => ({ who: one.who, text: one.text, at: one.at }))
      : [],
  }));
}

module.exports = {
  open,
  tick,
  recent,
  linesFrom,
  MOST_LINES,
  TICK_SECONDS,
  TICK_MAX_SECONDS,
  STALE_AFTER_MS,
  sessionCollection,
};
