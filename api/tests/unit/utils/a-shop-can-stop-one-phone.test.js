'use strict';

/*
 * A SHOP CAN STOP ONE PHONE.
 *
 * Owner: "once logged in use jwt or proper app authendication system. map
 * device to cloud account."
 *
 * The first half was already true and stays: a handset signs in once with a
 * username and a password and presents a bearer token afterwards. The phone
 * never stores the password.
 *
 * The second half is this. A phone described itself on every ORDER it sent
 * and nowhere else, so a shop had a record of what a phone had DONE and no
 * record of the phone. The moment that matters is the one where a handset is
 * left in a taxi: what the shop needs then is to stop that one and leave the
 * other four taking orders.
 *
 * Which is also the argument for the thirty day token. A long credential is
 * safe when it can be revoked and dangerous when the only control is an
 * expiry, because an expiry does nothing tonight and everything in a month.
 */

const handsets = require('../../../src/utils/handsets');

/** A collection that behaves enough like mongo's for these five operations. */
function fakeDb(seed = []) {
  const rows = seed.map((row) => ({ ...row }));

  const matches = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value);

  return {
    rows,
    collection() {
      return {
        async updateOne(query, change, options = {}) {
          let row = rows.find((candidate) => matches(candidate, query));
          if (!row && options.upsert) {
            row = { ...query, ...(change.$setOnInsert || {}) };
            rows.push(row);
          }
          if (!row) return { matchedCount: 0 };
          Object.assign(row, change.$set || {});
          Object.keys(change.$unset || {}).forEach((key) => delete row[key]);
          return { matchedCount: 1 };
        },
        async findOne(query) {
          return rows.find((candidate) => matches(candidate, query)) || null;
        },
        find() {
          return {
            sort: () => ({ limit: () => ({ toArray: async () => rows.slice() }) }),
          };
        },
      };
    },
  };
}

const PHONE = { device_id: 'a1b2c3d4-e5f6', device_model: 'SM-A155F', platform: 'app/android' };
const USER = { _id: 'u1', username: 'anita' };

beforeEach(() => handsets.forget());

describe('writing a phone down against the account', () => {
  it('A SIGN-IN RECORDS THE PHONE, with enough to recognise it in a list', async () => {
    /*
     * "Four handsets" is not something anybody can act on. The model and who
     * last used it are what let somebody point at the row that is the phone
     * that went missing last night.
     */
    const db = fakeDb();

    const id = await handsets.remember(db, { device: PHONE, user: USER, ip: '10.0.0.4' });

    expect(id).toBe('a1b2c3d4-e5f6');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      device_id: 'a1b2c3d4-e5f6',
      model: 'SM-A155F',
      platform: 'app/android',
      user_name: 'anita',
      revoked: false,
    });
    expect(db.rows[0].last_seen instanceof Date).toBe(true);
  });

  it('THE LICENCE NEVER LANDS ON THE ROW', async () => {
    /*
     * Every shop has its own database, so the row is already inside the only
     * tenancy boundary there is and a copy of the key would be a second place
     * for it to be wrong.
     *
     * It is also a rule the handset sign-in is held to elsewhere: the licence
     * does not leave the server, and writing it into a field beside something
     * that does is how that starts. This cost a round: the first version of
     * this file stored it and mobile-app-reachability.test.js said so.
     */
    const db = fakeDb();
    await handsets.remember(db, { device: PHONE, user: USER, ip: '10.0.0.4' });

    expect(db.rows[0].license).toBeUndefined();
  });

  it('AN APP THAT SAYS NOTHING SIGNS IN EXACTLY AS IT DID', async () => {
    /*
     * An older handset, or storage the phone will not read. Nothing about the
     * sign-in may depend on this: a waiter at a table with an order to take
     * does not care that the shop's list is a row short.
     */
    const db = fakeDb();

    expect(await handsets.remember(db, { user: USER })).toBe('');
    expect(await handsets.remember(db, { device: {}, user: USER })).toBe('');
    expect(await handsets.remember(db, { device: { device_id: 'x' }, user: USER })).toBe('');
    expect(db.rows).toHaveLength(0);
  });

  it('and a database that will not answer does not stop anybody signing in', async () => {
    const broken = {
      collection: () => ({
        updateOne: async () => {
          throw new Error('no');
        },
      }),
    };

    await expect(handsets.remember(broken, { device: PHONE, user: USER })).resolves.toBe('');
  });

  it('signing in again on the same phone updates it rather than adding another', async () => {
    const db = fakeDb();

    await handsets.remember(db, { device: PHONE, user: USER, ip: '10.0.0.4' });
    await handsets.remember(db, {
      device: { ...PHONE, device_model: 'SM-A155F', app_version: '1.2.32' },
      user: { _id: 'u2', username: 'ravi' },
      ip: '10.0.0.9',
    });

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].user_name).toBe('ravi');
    expect(db.rows[0].app_version).toBe('1.2.32');
  });
});

describe('stopping one', () => {
  it('A REVOKED PHONE IS REFUSED, and the others are not', async () => {
    const db = fakeDb();
    await handsets.remember(db, { device: PHONE, user: USER });
    await handsets.remember(db, { device: { ...PHONE, device_id: 'zz9-plural-z' }, user: USER });

    expect(await handsets.setRevoked(db, 'a1b2c3d4-e5f6', true, 'manager')).toBe(true);

    expect(await handsets.revoked(db, 'a1b2c3d4-e5f6')).toBe(true);
    expect(await handsets.revoked(db, 'zz9-plural-z')).toBe(false);
  });

  it('a phone nobody has heard of is not refused', async () => {
    /*
     * The old behaviour, and the one that must survive: a shop that has never
     * revoked anything cannot be locked out by this code path.
     */
    const db = fakeDb();
    expect(await handsets.revoked(db, 'never-seen-before')).toBe(false);
    expect(await handsets.revoked(db, '')).toBe(false);
  });

  it('turning one off names who did it, and letting it back clears that', async () => {
    const db = fakeDb();
    await handsets.remember(db, { device: PHONE, user: USER });

    await handsets.setRevoked(db, PHONE.device_id, true, 'manager');
    expect(db.rows[0].revoked_by).toBe('manager');
    expect(db.rows[0].revoked_at instanceof Date).toBe(true);

    await handsets.setRevoked(db, PHONE.device_id, false, '');
    expect(db.rows[0].revoked).toBe(false);
    expect(db.rows[0].revoked_at).toBeUndefined();
  });

  it('SIGNING IN AGAIN ON A STOPPED PHONE LETS IT BACK, on purpose', async () => {
    /*
     * The premise of the whole feature is that a waiter does not know the
     * shop's password. Somebody who can type it is somebody the shop trusts
     * with the till itself, so a revoke is for the phone in a taxi, not a way
     * to keep a manager out of one.
     *
     * The record keeps that it was stopped, which is the interesting part when
     * somebody asks later why a phone that was turned off is taking orders.
     */
    const db = fakeDb();
    await handsets.remember(db, { device: PHONE, user: USER });
    await handsets.setRevoked(db, PHONE.device_id, true, 'manager');

    await handsets.remember(db, { device: PHONE, user: USER });

    expect(db.rows[0].revoked).toBe(false);
    expect(db.rows[0].returned_at instanceof Date).toBe(true);
    expect(await handsets.revoked(db, PHONE.device_id)).toBe(false);
  });

  it('and revoking is felt immediately in the process that did it', async () => {
    /*
     * The answer is cached so that a floor of phones does not put a query
     * behind every tap. A revoke performed here clears its own entry, so the
     * next request from that phone is refused rather than waiting out the
     * window.
     */
    const db = fakeDb();
    await handsets.remember(db, { device: PHONE, user: USER });
    expect(await handsets.revoked(db, PHONE.device_id)).toBe(false);

    await handsets.setRevoked(db, PHONE.device_id, true, 'manager');
    expect(await handsets.revoked(db, PHONE.device_id)).toBe(true);
  });

  it('a device id is treated as something a stranger typed', async () => {
    /* It arrives from a client, so it is bounded and has nothing in it that
       means anything to a query. */
    const db = fakeDb();

    expect(handsets.deviceIdOf({ device_id: '../../etc/passwd' })).toBe('');
    expect(handsets.deviceIdOf({ device_id: { $ne: null } })).toBe('');
    expect(handsets.deviceIdOf({ device_id: 'x'.repeat(200) })).toBe('');
    expect(handsets.deviceIdOf({ device_id: 'd-lz4k9p-8fj2ba' })).toBe('d-lz4k9p-8fj2ba');

    expect(await handsets.setRevoked(db, '../../x', true, '')).toBe(false);
  });
});

/* ------------------------------------------------------------- the wiring */

const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', ...p), 'utf8');

describe('what the token says and what the door does', () => {
  it('THE TOKEN NAMES THE PHONE, so stopping one means something', () => {
    /*
     * A header would not do: a header is whatever the caller types, and a
     * phone that names itself can name another. The claim is signed.
     */
    const auth = read('middleware', 'auth.js');
    expect(auth).toMatch(/payload\.device_id = String\(req\.handsetDevice\)/);

    /* And only when there is one, so a till's token is byte for byte what it
       was before this existed. */
    expect(auth).toMatch(/if \(req && req\.handsetDevice\) payload\.device_id/);
  });

  it('every decoded token hands the phone to the request', () => {
    const auth = read('middleware', 'auth.js');
    const sites = auth.match(/req\.handsetDevice = String\(decoded\.device_id\)/g) || [];
    expect(sites.length).toBe(3);
  });

  it('THE CHECK SITS WHERE EVERY AUTHENTICATED ROUTE PASSES', () => {
    /*
     * After the tenant is attached, because that is the first moment there is
     * a shop to ask. Before it, the connection answering is whichever shop
     * happened to start the process.
     */
    const auth = read('middleware', 'auth.js');
    const at = auth.indexOf('await attachTenantContext(req, currentUser);');
    expect(at).toBeGreaterThan(-1);

    const after = auth.slice(at, at + 1600);
    expect(after).toMatch(/handsets\.revoked\(/);
    expect(after).toMatch(/DEVICE_REVOKED/);
    expect(after).toMatch(/403/);
  });

  it('and the sign-in writes the phone down before it signs the token', () => {
    /*
     * In that order, because the token carries the id the write returns. The
     * other way round would sign a token naming nothing and leave the shop a
     * row it cannot stop.
     */
    const users = read('controllers', 'users.controller.js');

    /* Inside the handset sign-in, not the file: there are other sign-ins in
       here and they sign their own tokens, earlier in the file. */
    const login = users.slice(users.indexOf('async kioskMobileLogin(req, res)'));
    expect(login).not.toBe('');

    const wrote = login.indexOf('req.handsetDevice = await rememberHandset(db');
    const signed = login.indexOf('const jwtToken = signLegacyToken(recordsFiltered, req');

    expect(wrote).toBeGreaterThan(-1);
    expect(signed).toBeGreaterThan(wrote);
  });
});
