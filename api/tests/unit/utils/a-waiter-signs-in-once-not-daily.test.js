'use strict';

/*
 * A WAITER SIGNS IN ONCE, NOT EVERY DAY.
 *
 * Owner: "username password not saved already. everytime i need to enter."
 *
 * The handset was not forgetting. It stores the credential and stores it
 * correctly; the credential expired. A till token lasting 24 hours is right,
 * because a till is a fixed machine behind a counter that somebody signs into
 * at the start of a shift.
 *
 * A HANDSET IS NOT THAT. It is carried by a part-time waiter who was handed it
 * five minutes ago and does not know the shop's password. A daily expiry means
 * finding somebody who does, and bringing them over, at the start of every
 * service, for every phone. That is one support call a day per shop, for ever,
 * produced entirely by a number.
 *
 * WHY A LONGER ONE IS SAFE HERE AND NOT ON THE TILL. A lost handset is cut off
 * by freeing its slot on the till, which the till already enforces and answers
 * 403 to. That is a revocation a manager can actually perform. An expiry is
 * not: it does nothing about the phone in somebody's pocket today, it only
 * inconveniences the shop tomorrow.
 */

const {
  jwtLifetimeSeconds,
  handsetLifetimeSeconds,
  DEFAULT_LIFETIME,
  HANDSET_DEFAULT_LIFETIME,
} = require('../../../src/utils/token-lifetime');

const DAY = 24 * 60 * 60;

describe('how long a sign-in lasts', () => {
  it('A HANDSET LASTS LONGER THAN A DAY', () => {
    expect(handsetLifetimeSeconds({})).toBeGreaterThan(DAY);
    expect(handsetLifetimeSeconds({})).toBe(30 * DAY);
  });

  it('and the till is untouched, because a counter is not a pocket', () => {
    expect(jwtLifetimeSeconds({})).toBe(DAY);
    expect(DEFAULT_LIFETIME).toBe('24h');
  });

  it('A SHOP THAT WANTS THE OLD BEHAVIOUR CAN HAVE IT', () => {
    /*
     * A number somebody can disagree with. A shop with handsets that leave the
     * building, or one whose insurer asks, sets this and gets the short life
     * back without a release.
     */
    expect(handsetLifetimeSeconds({ HANDSET_JWT_EXPIRES_IN: '24h' })).toBe(DAY);
    expect(handsetLifetimeSeconds({ HANDSET_JWT_EXPIRES_IN: '90d' })).toBe(90 * DAY);
    expect(handsetLifetimeSeconds({ HANDSET_JWT_EXPIRES_IN: '3600' })).toBe(3600);
  });

  it('a setting somebody typed wrong falls back rather than throwing', () => {
    /*
     * Same rule as the till's: a malformed value must not stop anybody signing
     * in. A waiter locked out by a typo in an env file has no way to even find
     * out what is wrong.
     */
    expect(handsetLifetimeSeconds({ HANDSET_JWT_EXPIRES_IN: 'soon' })).toBe(30 * DAY);
    expect(handsetLifetimeSeconds({ HANDSET_JWT_EXPIRES_IN: '' })).toBe(30 * DAY);
    expect(HANDSET_DEFAULT_LIFETIME).toBe('30d');
  });
});

describe('what the phone is told', () => {
  it('THE TOKEN AND THE NUMBER THE PHONE IS TOLD COME FROM ONE PLACE', () => {
    /*
     * The whole reason this lives in a dependency-free file. A client that is
     * told the wrong expiry either refreshes far more often than it needs to,
     * or discovers it has expired in the middle of taking an order.
     *
     * The handset sign-in reads it once into a variable and uses that variable
     * for both the signature and the reply, so the two cannot drift.
     */
    const fs = require('fs');
    const path = require('path');
    const controller = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'controllers', 'users.controller.js'),
      'utf8'
    );

    const at = controller.indexOf('const handsetSeconds = handsetLifetimeSeconds();');
    expect(at).toBeGreaterThan(-1);

    const after = controller.slice(at, at + 4000);
    expect(after).toMatch(/signLegacyToken\(recordsFiltered, req, undefined, handsetSeconds\)/);
    expect(after).toMatch(/expiresIn: handsetSeconds/);
  });

  it('and no other sign-in was given the longer life by accident', () => {
    /*
     * signLegacyToken takes the lifetime as an optional last argument, so the
     * till and the web sign-ins keep exactly what they had. If a third caller
     * ever passes one, this says so rather than letting it through quietly.
     */
    const fs = require('fs');
    const path = require('path');
    const controller = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'controllers', 'users.controller.js'),
      'utf8'
    );

    const longLived = [...controller.matchAll(/signLegacyToken\([^)]*handsetSeconds[^)]*\)/g)];
    expect(longLived).toHaveLength(1);
  });
});
