'use strict';

/*
 * An unanswered order is never left in silence.
 *
 * WHAT WAS THERE
 *
 * order-alert.js repeated every 20 seconds, fifteen times, and then stopped -
 * with the order still unanswered and the customer still waiting:
 *
 *     const REPEAT_EVERY_MS = 20000;
 *     const MAX_REPEATS = 15; // five minutes of asking, then it stops nagging
 *
 * Its own comment is honest about why: "An alarm that never stops is one
 * somebody mutes at the speaker, and then it is gone for every future order
 * too." That reasoning is right and the conclusion is wrong. The choice is not
 * between nagging for ever and giving up, it is between the same volume for
 * ever and BACKING OFF.
 *
 * Today an order can sit until closing time and nothing says so. The roadmap
 * names it: "no order sits in pending overnight. Today they can."
 *
 * FOUR RULES, and this file is the argument for each.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const policy = require(path.join(ROOT, 'src', 'waiting-order-policy.js'));

const M = 60 * 1000;
const LONG_AGO = 99 * M;

/** Due to alert, unacknowledged, waiting this long. */
const waiting = (minutes, over = {}) => ({
  waitingMs: minutes * M,
  lastAlertedMs: LONG_AGO,
  ...over,
});

/* ----------------------------------------- 1. it backs off, it does not stop */

test('AFTER FIVE MINUTES IT IS STILL SPEAKING, which is the whole bug', () => {
  /*
   * The old code was silent from here on. An order arriving at 19:05 was never
   * mentioned again, and the customer had no idea.
   */
  assert.strictEqual(policy.decide(waiting(6)).alert, true, 'went silent at five minutes');
  assert.strictEqual(policy.decide(waiting(30)).alert, true, 'went silent at half an hour');
  assert.strictEqual(policy.decide(waiting(120)).alert, true, 'went silent after two hours');
});

test('but it slows down, because the same pace for ever gets muted', () => {
  const pace = (m) => policy.decide(waiting(m)).nextInMs;
  assert.ok(pace(0) < pace(3), 'it does not slow down after the first push');
  assert.ok(pace(3) < pace(6));
  assert.ok(pace(6) < pace(20));
  assert.strictEqual(pace(0), 20 * 1000, 'the first two minutes should stay insistent');
});

test('and it settles to a heartbeat rather than a nag', () => {
  /* A slow signal is still a signal. Silence is not. */
  const late = policy.decide(waiting(240));
  assert.strictEqual(late.alert, true);
  assert.ok(late.nextInMs >= 10 * M, `a four-hour-old order is being nagged every ${late.nextInMs}ms`);
  assert.ok(late.nextInMs <= 30 * M, 'the heartbeat is so slow it is effectively silence');
});

test('it does not speak again before its turn', () => {
  /* Otherwise every poll would fire, and the backoff would be decoration. */
  assert.strictEqual(policy.decide({ waitingMs: 30 * M, lastAlertedMs: 1000 }).alert, false);
  assert.strictEqual(policy.decide({ waitingMs: 30 * M, lastAlertedMs: LONG_AGO }).alert, true);
});

/* --------------------------------------- 2. it escalates in reach, not volume */

test('IT TRAVELS FURTHER RATHER THAN GETTING LOUDER', () => {
  /*
   * Louder is how an alarm gets muted at the speaker, and then it is gone for
   * every future order. Further is how it gets answered.
   */
  assert.strictEqual(policy.decide(waiting(0)).reach, 'till');
  assert.strictEqual(policy.decide(waiting(6)).reach, 'handsets');
  assert.strictEqual(policy.decide(waiting(20)).reach, 'owner');
});

test('reach only ever widens as the wait grows', () => {
  const order = ['till', 'handsets', 'owner'];
  let seen = -1;
  for (const minutes of [0, 1, 2, 3, 5, 6, 10, 15, 20, 60, 240]) {
    const at = order.indexOf(policy.decide(waiting(minutes)).reach);
    assert.ok(at >= seen, `reach narrowed at ${minutes} minutes`);
    seen = at;
  }
});

/* -------------------------------------------- 3. acknowledging stops the noise */

test('ACKNOWLEDGING STOPS IT, and nothing else does', () => {
  /*
   * "I have seen this" is a different act from "I have accepted it", and a shop
   * mid-rush needs the first without the second. Muting is deliberately not
   * offered: a muted alarm is gone for every future order too.
   */
  assert.strictEqual(policy.decide(waiting(20, { acknowledged: true })).alert, false);
  assert.strictEqual(policy.decide(waiting(20, { acknowledged: false })).alert, true);
});

test('BUT ACKNOWLEDGED IS NOT ANSWERED: the shop default still fires', () => {
  /*
   * Otherwise "acknowledge" becomes a way to make the timer go away, and an
   * order can be parked for ever by tapping a button - which is the bug this
   * replaces, wearing a different hat.
   */
  const shop = { onSilence: 'cancel', decideAfterMinutes: 10 };
  const seen = policy.decide(waiting(30, { acknowledged: true }), shop);
  assert.strictEqual(seen.alert, false, 'it is still making a noise');
  assert.strictEqual(seen.decide, 'cancel', 'acknowledging parked the order for ever');
});

/* ------------------------------------------- 4. the shop's declared default */

test('A SHOP THAT HAS CHOSEN NOTHING GETS NOTHING', () => {
  /*
   * Owner: "by default dont accpept or reject." A product that cancels a
   * customer's order because a shop never opened a settings page has made a
   * decision that was not its to make.
   */
  assert.strictEqual(policy.decide(waiting(600)).decide, 'nothing');
  assert.strictEqual(policy.decide(waiting(600), {}).decide, 'nothing');
  assert.strictEqual(policy.decide(waiting(600), { onSilence: 'accept' }).decide, 'nothing',
    'a policy with no time fired anyway');
  assert.strictEqual(policy.decide(waiting(600), { decideAfterMinutes: 5 }).decide, 'nothing',
    'a time with no policy fired anyway');
});

test('and when it has chosen, it fires on its own clock', () => {
  for (const onSilence of ['accept', 'cancel']) {
    const shop = { onSilence, decideAfterMinutes: 10 };
    assert.strictEqual(policy.decide(waiting(5), shop).decide, 'nothing', 'fired early');
    assert.strictEqual(policy.decide(waiting(11), shop).decide, onSilence, 'never fired');
  }
});

test('an unrecognised choice is treated as no choice', () => {
  /* A settings field is a string from a form. "Accept" with a capital, or a
     value from a newer build, must not become "do something unexpected". */
  const shop = { onSilence: 'explode', decideAfterMinutes: 1 };
  assert.strictEqual(policy.decide(waiting(60), shop).decide, 'nothing');
});

test("AN AGGREGATOR'S CLOCK IS NOT OURS", () => {
  /*
   * Swiggy and Zomato reject on their own timer and count it against the shop.
   * A decision of ours landing after theirs is worse than none: the order is
   * already gone and we have recorded the opposite.
   */
  const shop = { onSilence: 'accept', decideAfterMinutes: 10, partnerWindowMinutes: 8 };
  const theirs = policy.decide(waiting(30, { source: 'marketplace' }), shop);
  assert.strictEqual(theirs.decide, 'nothing');
  assert.match(theirs.reason, /delivery partner/);

  /* Inside their window we may still act. */
  assert.strictEqual(
    policy.decide({ waitingMs: 9 * M, lastAlertedMs: 0, source: 'marketplace' }, shop).decide,
    'nothing',
    'acted before our own time was up'
  );
  /* And a shop order is not governed by their clock at all. */
  assert.strictEqual(policy.decide(waiting(30, { source: 'online' }), shop).decide, 'accept');
});

test('every decision says why, because a shop will ask', () => {
  for (const [order, shop] of [
    [waiting(1), {}],
    [waiting(60), { onSilence: 'accept', decideAfterMinutes: 10 }],
    [waiting(60, { source: 'marketplace' }), { onSilence: 'accept', decideAfterMinutes: 10, partnerWindowMinutes: 5 }],
  ]) {
    const d = policy.decide(order, shop);
    assert.ok(d.reason && d.reason.length > 10, 'a decision with no reason');
  }
});

/* ------------------------------------ the customer, who is not a setting */

test('THE CUSTOMER CAN ALWAYS ACT, and no shop can switch that off', () => {
  /*
   * Owner: "have option to retry from customer end. or let them contact
   * restaurant."
   *
   * If a shop never sets a timer the order sits, so the one thing that must
   * always hold is that the person waiting is not trapped in silence. A shop
   * chooses what IT does; it cannot choose to leave a customer with no way out.
   */
  const options = policy.customerOptions({ waitingMs: 40 * M });
  assert.strictEqual(options.canRetry, true);
  assert.strictEqual(options.canContactShop, true);
  assert.strictEqual(options.waitingMinutes, 40);

  /* Not reachable from the shop's settings at all. */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'waiting-order-policy.js'), 'utf8');
  const block = src.slice(src.indexOf('function customerOptions'));
  assert.ok(!/policy\./.test(block.slice(0, 400)), 'the customer options read shop settings');
});

/* ----------------------------------------------------- rubbish in */

test('nonsense never becomes a confident decision', () => {
  for (const order of [{}, { waitingMs: -5 }, { waitingMs: 'soon' }, { waitingMs: null }]) {
    const d = policy.decide(order, { onSilence: 'cancel', decideAfterMinutes: 10 });
    assert.strictEqual(d.decide, 'nothing', `cancelled an order for ${JSON.stringify(order)}`);
    assert.ok(policy.STEPS.some((s) => s.everyMs === d.nextInMs));
  }
});

test('it is in the packaged build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/waiting-order-policy.js'));
});
