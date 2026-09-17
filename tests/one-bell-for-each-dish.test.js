'use strict';

/*
 * ONE BELL FOR THE ORDER, ONE TAP FOR EACH DISH.
 *
 * Owner: "First bell is we got new order. I want one bell for each line item
 * before read it."
 *
 * The risk in this shape is that the page has to know where the food starts.
 * Get that boundary wrong and a kitchen hears a tap before "Table 5, new
 * order", or hears nothing before the first dish, and either way the bell
 * stops meaning anything. So the boundary travels with the words rather than
 * being counted at the far end.
 *
 * Also here: the bell a shop CHOSE. Owner: "how about user picks the bell
 * sound as choice how you gave me." A picker that silently ignores the pick is
 * the same class of bug as a switch that does nothing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('node:os');
const path = require('path');

const orderAlert = require('../src/order-alert');
const kitchenCall = require('../src/kitchen-call');

/* ------------------------------------------------------- where food starts */

test('THE WORDS CARRY WHERE THE FOOD STARTS', () => {
  /*
   * The opening and the plate count are about the ticket. Everything after is
   * a dish. Decided beside the words, so a renderer never has to guess by
   * counting sentences - a guess that breaks the first time the wording moves.
   */
  const said = kitchenCall.script({
    table: '5',
    items: [
      { item_name: 'Chicken Biryani', item_quantity: 1 },
      { item_name: 'Butter Naan', item_quantity: 2 },
    ],
  });

  assert.deepStrictEqual(said.head, ['Table 5, new order.', 'Three items.']);
  assert.deepStrictEqual(said.items, ['One Chicken Biryani.', 'Two Butter Naan.']);
});

test('and the flat list is still the two joined, in that order', () => {
  /* Everything that logs or tests this reads lines(). It must not drift. */
  const ticket = { table: '2', items: [{ item_name: 'Coffee', item_quantity: 1 }] };
  const said = kitchenCall.script(ticket);

  assert.deepStrictEqual(kitchenCall.lines(ticket), said.head.concat(said.items));
});

test('nothing worth saying has no head and no items', () => {
  assert.deepStrictEqual(kitchenCall.script({ table: '5', items: [] }), { head: [], items: [] });
});

/* ------------------------------------------------------------- the payload */

/** Catch what the main process would send to a window. */
function announced(ticket, wants) {
  let sent = null;
  const win = {
    isDestroyed: () => false,
    webContents: { send: (_channel, payload) => { sent = payload; } },
  };

  orderAlert.announceKitchenTicket(() => win, ticket, wants || { ting: true, speak: true });
  return sent;
}

const A_TICKET = {
  table: '5',
  items: [
    { item_name: 'Chicken Biryani', item_quantity: 1 },
    { item_name: 'Butter Naan', item_quantity: 2 },
  ],
};

test('BOTH BELLS ARE SENT, and the page is told where to put the small one', () => {
  const said = announced(A_TICKET);

  assert.match(said.sound, /^data:audio\/wav;base64,/, 'no arrival bell');
  assert.match(said.itemSound, /^data:audio\/wav;base64,/, 'no bell for the dishes');
  assert.strictEqual(said.head, 2, 'the page would tap before the wrong lines');
  assert.notStrictEqual(said.sound, said.itemSound, 'the same bell twice is not two bells');
});

test('a machine set to read but not chime gets no bells at all', () => {
  /* Nothing to ignore, and nothing in the payload a later change could play. */
  const said = announced(A_TICKET, { ting: false, speak: true });

  assert.strictEqual(said.sound, '');
  assert.strictEqual(said.itemSound, '');
  assert.ok(said.lines.length, 'it should still be read out');
});

test('THE BELL A SHOP CHOSE IS THE BELL IT GETS', () => {
  const rising = announced(A_TICKET, { ting: true, speak: false, arrivalBell: 'rising' });
  const bell = announced(A_TICKET, { ting: true, speak: false, arrivalBell: 'bell' });

  assert.notStrictEqual(rising.sound, bell.sound, 'the choice changed nothing');
});

test('and a bell nobody has heard of falls back rather than failing', () => {
  /* A settings file from a newer version, or one somebody typed into. Silence
     would be the worst possible answer to a spelling mistake. */
  const odd = announced(A_TICKET, { ting: true, speak: false, arrivalBell: 'carillon' });
  const fallback = announced(A_TICKET, { ting: true, speak: false, arrivalBell: 'rising' });

  assert.strictEqual(odd.sound, fallback.sound);
});

test('the voice a shop chose travels by name', () => {
  const said = announced(A_TICKET, { ting: true, speak: true, voice: 'Microsoft Heera' });

  assert.strictEqual(said.voice, 'Microsoft Heera');
  assert.strictEqual(announced(A_TICKET).voice, '', 'no choice means best on this machine');
});

/* --------------------------------------------------------------- the sound */

test('THE TAP IS SMALLER THAN THE BELL', () => {
  /*
   * The arrival bell is heard once; the tap is heard three or six times in a
   * row. The arrival bell repeated six times is a fire drill, which is the
   * whole reason there are two sounds rather than one.
   */
  for (const which of orderAlert.bellChoices().item) {
    const tap = orderAlert.ITEM_BELL(which);
    for (const arrival of orderAlert.bellChoices().arrival) {
      assert.ok(
        tap.length < orderAlert.TING(arrival).length,
        `the ${which} tap is not shorter than the ${arrival} bell`
      );
    }
  }
});

test('a struck note is not a beep', () => {
  /*
   * A plain sine contains nothing but its fundamental, which is what a beep
   * is. Owner: "beep sound is not good... not beep."
   *
   * A struck note decays, so its second half is quieter than its first. A tone
   * that is switched on and off is not, and that is the difference by ear.
   */
  const wav = orderAlert.TING('rising');
  const body = wav.subarray(44);
  const loudest = (from, to) => {
    let peak = 0;
    for (let i = from; i < to; i += 2) peak = Math.max(peak, Math.abs(body.readInt16LE(i)));
    return peak;
  };

  const half = Math.floor(body.length / 4) * 2;
  assert.ok(loudest(0, half) > loudest(half, body.length - 1), 'it does not decay');
});

test('every offered bell can actually be played', () => {
  /* A name in the picker that produces nothing is a dead control. */
  const choices = orderAlert.bellChoices();
  assert.ok(choices.arrival.length >= 3 && choices.item.length >= 3);

  for (const which of choices.arrival) {
    assert.match(orderAlert.bellSound('arrival', which), /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/);
  }
  for (const which of choices.item) {
    assert.match(orderAlert.bellSound('item', which), /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/);
  }
});

/* ------------------------------------------------------------ what is kept */

test('CHOOSING A BELL DOES NOT TURN THE SOUND OFF', () => {
  /*
   * Everything is merged onto what is already stored. Somebody turning the
   * reading off must not lose the bell they spent five minutes choosing, and
   * somebody choosing a bell must not silently switch the chime on.
   */
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-bells-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');

    announce.set({ ting: true, speak: true });
    announce.set({ arrivalBell: 'bell', itemBell: 'tick', voice: 'Microsoft Heera' });

    let said = announce.settings();
    assert.strictEqual(said.ting, true, 'picking a bell turned the chime off');
    assert.strictEqual(said.speak, true, 'picking a bell turned the reading off');
    assert.strictEqual(said.arrivalBell, 'bell');
    assert.strictEqual(said.itemBell, 'tick');
    assert.strictEqual(said.voice, 'Microsoft Heera');

    announce.set({ speak: false });
    said = announce.settings();
    assert.strictEqual(said.arrivalBell, 'bell', 'the chosen bell was lost');
    assert.strictEqual(said.voice, 'Microsoft Heera', 'the chosen voice was lost');
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});

test('a machine that never chose gets the owner picks', () => {
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-bells-'));
  const before = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = where;

  try {
    delete require.cache[require.resolve('../src/kitchen-announce')];
    const announce = require('../src/kitchen-announce');
    const said = announce.settings();

    assert.strictEqual(said.arrivalBell, 'rising');
    assert.strictEqual(said.itemBell, 'soft');
    assert.strictEqual(said.voice, '');
  } finally {
    process.env.POSNIC_USER_DATA = before;
    fs.rmSync(where, { recursive: true, force: true });
  }
});
