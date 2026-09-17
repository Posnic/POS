'use strict';

/*
 * THE KITCHEN HEARS A TICKET ARRIVE.
 *
 * Owner: "whenever new KOT received one tink sound with full sound i want.
 * need to place in kitchen. if possible read the items. Example Table 5 new
 * order. Ting! one chicken briyani, one chicken tikka masala."
 *
 * A printer in a kitchen is silent and a ticket is small. A cook with their
 * hands in a pan does not see one arrive, and the first anybody knows is a
 * waiter asking where the food is.
 *
 * What is held here is the SENTENCE and the SWITCH, because those are the two
 * parts that can be wrong without anybody noticing until service. The tone and
 * the speech engine belong to a window and a sound card, which a test cannot
 * stand in for honestly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const kitchenCall = require('../src/kitchen-call');

/* The two switches, apart from the bell and voice choices stored beside them.
   Those are pinned in their own test; what matters here is that turning one
   switch does not move the other. */
const switches = (said) => ({ ting: said.ting, speak: said.speak });

/* ------------------------------------------------------------- the words */

test('IT IS SAID ONE LINE AT A TIME, which is where the pauses come from', () => {
  /*
   * Owner: "little pause between line items".
   *
   * A full stop inside one sentence is a shorter gap than a kitchen needs. The
   * renderer speaks each of these as its own utterance, and a speech engine
   * leaves a real gap between them - long enough to hold one dish in your head
   * before the next arrives.
   */
  const said = kitchenCall.lines({
    table: '5',
    items: [
      { item_name: 'Chicken Biryani', item_quantity: 1 },
      { item_name: 'Chicken Tikka Masala', item_quantity: 1 },
    ],
  });

  assert.deepStrictEqual(said, [
    'Table 5, new order.',
    'Two items.',
    'One Chicken Biryani.',
    'One Chicken Tikka Masala.',
  ]);
});

test('nothing worth saying is an empty list, not a line of nothing', () => {
  assert.deepStrictEqual(kitchenCall.lines({ table: '5', items: [] }), []);
});

test('IT SAYS THE TABLE FIRST, then the food', () => {
  /*
   * The table number is the one part nobody can work out from the rest, which
   * is why it leads and why the ting has to finish before this starts.
   */
  const said = kitchenCall.say({
    table: '5',
    items: [
      { item_name: 'Chicken Biryani', item_quantity: 1 },
      { item_name: 'Chicken Tikka Masala', item_quantity: 1 },
    ],
  });

  assert.strictEqual(
    said,
    'Table 5, new order. Two items. One Chicken Biryani. One Chicken Tikka Masala.'
  );
});

test('HOW MANY PLATES ARE COMING is said before the list', () => {
  /*
   * Owner: "KOT total items also print and voice read please. so that chef's
   * can hear well."
   *
   * Before rather than after, because a number heard first is one you can
   * count against: a chef told three plates are coming notices when they have
   * heard two. After the list it is a fact nobody can act on.
   *
   * PLATES, not lines. One biryani and two naan is three things to cook and
   * two lines on the ticket.
   */
  const said = kitchenCall.lines({
    table: '5',
    items: [
      { item_name: 'Chicken Biryani', item_quantity: 1 },
      { item_name: 'Butter Naan', item_quantity: 2 },
    ],
  });

  assert.strictEqual(said[1], 'Three items.');
});

test('one plate is an item, not one items', () => {
  const said = kitchenCall.lines({
    table: '2',
    items: [{ item_name: 'Coffee', item_quantity: 1 }],
  });

  assert.strictEqual(said[1], 'One item.');
});

test('the count is the whole ticket even when the list is cut short', () => {
  /* Six lines are read and the rest summarised, but the count is still what
     the kitchen has to produce - which is the point of hearing it. */
  const items = Array.from({ length: 9 }, (_, i) => ({
    item_name: `Dish ${i + 1}`,
    item_quantity: 2,
  }));

  assert.strictEqual(kitchenCall.lines({ table: '9', items })[1], '18 items.');
});

test('counts are words, because that is how somebody says them', () => {
  const said = kitchenCall.say({
    table: '2',
    items: [{ item_name: 'Butter Naan', item_quantity: 3 }],
  });

  assert.match(said, /Three Butter Naan/);
});

test('and digits once words stop helping', () => {
  assert.strictEqual(kitchenCall.countWord(7), 'seven');
  assert.strictEqual(kitchenCall.countWord(17), '17');
});

test('a takeaway is called what the shop calls it, not Table Take away', () => {
  const said = kitchenCall.say({
    table: 'Take away',
    items: [{ item_name: 'Butter Naan', item_quantity: 1 }],
  });

  assert.match(said, /^Take away, new order\./);
});

test('a ticket with no table still reads the food', () => {
  /* "Table undefined" is worse than saying nothing about where it is for. */
  const said = kitchenCall.say({
    items: [{ item_name: 'Butter Naan', item_quantity: 1 }],
  });

  assert.strictEqual(said, 'New order. One item. One Butter Naan.');
});

test('an amendment says so, because a cook must not start it twice', () => {
  const said = kitchenCall.say({
    table: '7',
    changed: true,
    items: [{ item_name: 'Gobi Manchurian', item_quantity: 1 }],
  });

  assert.match(said, /order changed/);
});

test('a long ticket is cut short, and says how much it cut', () => {
  /*
   * Six courses from a table of six arrive within seconds. Read in full that
   * is a minute of talking, and a kitchen that stopped listening does not hear
   * the next one either. The paper ticket still has the detail.
   */
  const items = Array.from({ length: 9 }, (_, i) => ({
    item_name: `Dish ${i + 1}`,
    item_quantity: 1,
  }));

  const said = kitchenCall.say({ table: '9', items });

  assert.match(said, /One Dish 6\./);
  assert.ok(!said.includes('Dish 7'), 'stops after six');
  assert.match(said, /And three more\./);
});

test('the name is the shop own, brackets and all', () => {
  /*
   * An earlier version stripped anything bracketed, meaning to drop decoration
   * like "(Half)". It turned "Gobi (65)" into "Gobi", which is a different
   * dish. What is in brackets is usually the part that tells a cook which one.
   */
  const said = kitchenCall.say({
    table: '3',
    items: [{ item_name: 'Gobi (65)', item_quantity: 2 }],
  });

  assert.match(said, /Two Gobi \(65\)/);
});

test('nothing worth saying is said as nothing', () => {
  /* A caller can then stay quiet rather than announce an empty ticket. */
  assert.strictEqual(kitchenCall.say({ table: '5', items: [] }), '');
  assert.strictEqual(kitchenCall.say({ table: '5', items: [{ item_quantity: 2 }] }), '');
  assert.strictEqual(kitchenCall.say({}), '');
});

test('a line with no quantity is not announced as an order for none', () => {
  const said = kitchenCall.say({
    table: '5',
    items: [
      { item_name: 'Chicken Biryani', item_quantity: 0 },
      { item_name: 'Butter Naan', item_quantity: 1 },
    ],
  });

  assert.strictEqual(said, 'Table 5, new order. One item. One Butter Naan.');
});

/* ------------------------------------------------------------ the switch */

test('THE CHIME AND THE READING ARE SEPARATE SWITCHES', () => {
  /*
   * Owner: "ting sound on/off read it on/off seperately?"
   *
   * They are different things to a kitchen. The chime says a ticket landed and
   * costs a second; the reading says what is on it and costs ten. A kitchen
   * that knows to look at the printer wants the first and will come to resent
   * the second. One switch would make somebody choose between hearing nothing
   * and hearing too much, and they would choose nothing.
   */
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kitchen-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');

    announce.set({ ting: true });
    assert.deepStrictEqual(switches(announce.settings()), { ting: true, speak: false });
    assert.strictEqual(announce.wanted(), true, 'a chime is still a sound');

    announce.set({ speak: true });
    assert.deepStrictEqual(switches(announce.settings()), { ting: true, speak: true });

    /* Turning one off must not take the other with it. */
    announce.set({ speak: false });
    assert.deepStrictEqual(switches(announce.settings()), { ting: true, speak: false });
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});

test('a machine already set up in a kitchen does not fall silent', () => {
  /*
   * The single switch this replaced meant both. Somebody who turned it on
   * yesterday must not lose their announcements because the setting grew a
   * second half overnight.
   */
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kitchen-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');

    fs.mkdirSync(path.dirname(announce.settingsPath()), { recursive: true });
    fs.writeFileSync(announce.settingsPath(), JSON.stringify({ announce: true }), 'utf8');

    assert.deepStrictEqual(switches(announce.settings()), { ting: true, speak: true });
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});

test('a machine is SILENT until somebody says otherwise', () => {
  /*
   * A till that started announcing orders after an update, in a room with
   * customers at the counter, is a support call and an embarrassment.
   */
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kitchen-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');

    assert.strictEqual(announce.wanted(), false);
    assert.deepStrictEqual(switches(announce.settings()), { ting: false, speak: false });

    announce.set(true);
    assert.strictEqual(announce.wanted(), true, 'turned on for this machine');

    announce.set(false);
    assert.strictEqual(announce.wanted(), false, 'and off again');
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});

test('a settings file somebody broke by hand means silence, not noise', () => {
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kitchen-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');

    fs.writeFileSync(announce.settingsPath(), '{ not json', 'utf8');
    assert.strictEqual(announce.wanted(), false);
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});
