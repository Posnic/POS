'use strict';

/*
 * WHICH PHONES THIS SHOP HAS, AND WHETHER ONE OF THEM STILL MAY.
 *
 * Owner: "once logged in use jwt or proper app authendication system. map
 * device to cloud account."
 *
 * The first half was already true. A handset signs in once with a username
 * and a password and is handed a bearer token, which is the only thing it
 * presents from then on; the password is never stored on the phone. That is
 * the proper authentication system, and it stays.
 *
 * THE SECOND HALF WAS NOT. A phone described itself on every ORDER it sent -
 * its model, its platform, a random id it keeps for itself - and an order was
 * the only place any of it was ever written down. So a shop had no list of
 * its own handsets, and no answer to the one question that matters when a
 * phone goes missing: stop THAT phone, and leave the other four working.
 *
 * An expiry is not an answer to it. It does nothing about the phone in
 * somebody's pocket tonight and inconveniences the shop in a month, which is
 * the trade that made a waiter find a manager every morning.
 *
 * So a sign-in writes the phone down against the account, and the token it is
 * given names the phone. A shop can see its handsets and turn one off, and
 * the one that was turned off stops the next time it asks for anything.
 *
 * A REVOKED PHONE THAT SIGNS IN AGAIN COMES BACK, and that is deliberate.
 * The whole premise of this feature is that a waiter does not know the shop's
 * password: somebody who can type it is somebody the shop trusts with the
 * till. Revoking is for the phone in a taxi, not for keeping a manager out.
 */

const COLLECTION = 'handsets';

/*
 * A revoke has to be felt by the request AFTER it, not by the request after
 * the next database round trip. But a lookup on every call from every phone
 * on a floor is a query per tap, so the answer is held for a moment.
 *
 * Thirty seconds, and a revoke performed in THIS process clears the entry
 * immediately. A shop served by more than one process (the till serves two)
 * can therefore take up to the window for the others to notice, which is the
 * honest cost of not querying per tap and is far below the time it takes to
 * notice a phone is gone.
 */
const CACHE_MS = 30 * 1000;
const cache = new Map();

const now = () => Date.now();

function cacheGet(key) {
  const held = cache.get(key);
  if (!held) return null;
  if (now() - held.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return held;
}

function cachePut(key, revoked) {
  /* A shop has tens of handsets, not thousands, but a device id arrives from
     a client and a client can say anything. Sweep rather than grow. */
  if (cache.size > 500) {
    for (const [id, held] of cache) {
      if (now() - held.at > CACHE_MS) cache.delete(id);
    }
  }
  cache.set(key, { revoked, at: now() });
}

/** Forget what was cached about one phone, or about all of them. */
function forget(deviceId) {
  if (deviceId) cache.delete(String(deviceId));
  else cache.clear();
}

/*
 * A device id comes off a phone, so it is treated as something a stranger
 * typed: bounded, and with nothing in it that means anything to a query.
 * Everything else the phone says about itself is a label for somebody reading
 * a list, and is truncated for the same reason.
 */
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const printable = (text) => {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    /*
     * Control characters and DEL, dropped by comparison rather than by a
     * regular expression: a control character inside one is itself a lint
     * error, and escaping it does not help because eslint reads the pattern
     * rather than the source.
     */
    if (code > 31 && code !== 127) out += text[i];
  }
  return out;
};

const clean = (value, limit = 80) =>
  printable(String(value === undefined || value === null ? '' : value))
    .trim()
    .slice(0, limit);

function deviceIdOf(device) {
  const raw = device && device.device_id;
  /*
   * Not truncated to fit. A long id cut down to the limit is a DIFFERENT id
   * that happens to be valid, and two of them that share a prefix become one
   * phone in the list. Refusing is the honest answer, and nothing the app
   * sends is anywhere near the limit: a UUID is 36 characters.
   */
  if (typeof raw !== 'string' || raw.length > 64) return '';
  const id = clean(raw, 64);
  return ID.test(id) ? id : '';
}

/**
 * Write this phone down against the account, on the way through a sign-in.
 *
 * @returns {Promise<string>} the device id that was recorded, or '' when the
 *   phone said nothing usable - in which case nothing is stored and nothing
 *   downstream changes. An app that does not send a device is the app as it
 *   was, and must keep working exactly as it did.
 */
async function remember(db, { device, user, ip } = {}) {
  const deviceId = deviceIdOf(device);
  if (!db || !deviceId) return '';

  const seen = new Date();
  const facts = device || {};

  const set = {
    device_id: deviceId,
    last_seen: seen,
    last_ip: clean(ip, 64),
    user_id: clean(user && (user._id || user.id), 64),
    user_name: clean(user && (user.username || user.email || user.name)),
    model: clean(facts.device_model),
    platform: clean(facts.platform, 40),
    app: clean(facts.app, 40),
    app_version: clean(facts.app_version, 60),
    network: clean(facts.network, 20),
    language: clean(facts.language, 20),
    time_zone: clean(facts.time_zone, 60),
    screen: clean(facts.screen, 20),
  };
  /*
   * NO LICENCE ON THE ROW. Every shop has its own database, so the row is
   * already inside the only tenancy boundary there is, and a copy of the key
   * would be a second place for it to be wrong.
   *
   * It is also the rule mobile-app-reachability.test.js holds over this
   * handler: the licence never leaves the server, not even into a field
   * beside something that does.
   */

  try {
    await db.collection(COLLECTION).updateOne(
      { device_id: deviceId },
      {
        $set: set,
        /*
         * Never on an update. A sign-in must not quietly un-revoke a phone as
         * a side effect of touching the row; coming back is the business of
         * the branch below, which says so out loud.
         */
        $setOnInsert: { first_seen: seen, revoked: false },
      },
      { upsert: true }
    );

    /*
     * Somebody with the shop's password signed in on this phone, so it is
     * allowed again. Written as its own update so the record keeps that it
     * was once revoked, which is the interesting part when somebody asks
     * later why a phone that was stopped is taking orders.
     */
    const held = await db.collection(COLLECTION).findOne({ device_id: deviceId });
    if (held && held.revoked) {
      await db
        .collection(COLLECTION)
        .updateOne(
          { device_id: deviceId },
          {
            $set: { revoked: false, returned_at: seen },
            $unset: { revoked_at: '', revoked_by: '' },
          }
        );
    }

    forget(deviceId);
    return deviceId;
  } catch (error) {
    /*
     * Nothing here is worth failing a sign-in over. A waiter standing at a
     * table with an order to take does not care that the shop's handset list
     * is one row short, and a list is not a thing to lock somebody out for.
     */
    return '';
  }
}

/**
 * May this phone still be used?
 *
 * Answers false for a phone nobody has heard of, which is the old behaviour:
 * a shop that has never revoked anything cannot be stopped by this.
 */
async function revoked(db, deviceId) {
  const id = clean(deviceId, 64);
  if (!db || !id || !ID.test(id)) return false;

  const held = cacheGet(id);
  if (held) return held.revoked;

  try {
    const row = await db
      .collection(COLLECTION)
      .findOne({ device_id: id }, { projection: { revoked: 1 } });
    const answer = !!(row && row.revoked);
    cachePut(id, answer);
    return answer;
  } catch (error) {
    /* A database that cannot be asked must not lock a floor out. */
    return false;
  }
}

/** Every phone this shop has signed in, most recently used first. */
async function list(db) {
  if (!db) return [];
  try {
    return await db
      .collection(COLLECTION)
      .find({}, { projection: { _id: 0 } })
      .sort({ last_seen: -1 })
      .limit(200)
      .toArray();
  } catch (error) {
    return [];
  }
}

/**
 * Stop a phone, or let it back.
 *
 * @returns {Promise<boolean>} whether a phone by that id was found.
 */
async function setRevoked(db, deviceId, stop, by) {
  const id = clean(deviceId, 64);
  if (!db || !id || !ID.test(id)) return false;

  const change = stop
    ? { $set: { revoked: true, revoked_at: new Date(), revoked_by: clean(by) } }
    : {
        $set: { revoked: false, returned_at: new Date() },
        $unset: { revoked_at: '', revoked_by: '' },
      };

  try {
    const said = await db.collection(COLLECTION).updateOne({ device_id: id }, change);
    forget(id);
    return said.matchedCount > 0;
  } catch (error) {
    return false;
  }
}

module.exports = {
  COLLECTION,
  CACHE_MS,
  remember,
  revoked,
  list,
  setRevoked,
  forget,
  deviceIdOf,
};
