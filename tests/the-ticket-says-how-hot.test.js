'use strict';

/*
 * The paper says how hot.
 *
 * Owner: "when user order if food is speci food. we can have simple option
 * like low, medium high with number chilly image like one, two, three chilli
 * icons user can customize easy. we can add those into kitchen note."
 *
 * Spice is what an Indian restaurant is asked to change more often than
 * anything else on its menu, and the only way to ask was typing it into the
 * free-text note: in whatever words, in whatever language, for a kitchen that
 * then has to read prose off a ticket at speed. A LEVEL prints the same on
 * every ticket whatever language the order was placed in, and can be counted
 * afterwards, which no amount of free text will ever allow.
 *
 * TWO COPIES OF THREE WORDS, ON PURPOSE, for the reason
 * the-ticket-says-where-the-order-came-from.test.js already writes down: the
 * API ships OUTSIDE the asar archive as extraResources/server.js while src/
 * lives inside it, so src/ cannot require into api/ - a require there resolves
 * to a second copy or to nothing. So the words are written twice and this file
 * runs BOTH over every input and refuses a commit where they disagree. Two
 * copies that are checked beat one copy that cannot be reached.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/* Same guard as kitchen-ticket-as-bytes.test.js: reaching for a window means
   the byte path was not taken, and the test should say so rather than pass. */
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      BrowserWindow: class { constructor() { throw new Error('the window path was used'); } },
      app: { getPath: () => os.tmpdir() },
    };
  }
  return load.call(this, request, ...rest);
};
const { renderKitchenTicket, spiceLine } = require(path.join(ROOT, 'src', 'escpos-kot.js'));
const KOTManager = require(path.join(ROOT, 'src', 'kot-manager.js'));
Module._load = load;

const api = require(path.join(ROOT, 'api', 'src', 'utils', 'spice-level.js'));

/** The bytes as a person would read them: printable kept, controls as dots. */
const readable = (buffer) => {
  let out = '';
  for (const b of buffer) {
    if (b === 10) out += '\n';
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    else out += '.';
  }
  return out;
};

const ticket = (item) =>
  readable(
    renderKitchenTicket({
      title: 'New Order',
      number: 12,
      tableNo: '4',
      items: [Object.assign({ name: 'Chicken Chettinad', quantity: 1 }, item)],
    })
  );

/* ------------------------------------------- the two copies say one thing */

test('the shell and the server word every level identically', () => {
  /*
   * The whole reason this file exists. If somebody renames MEDIUM on one side,
   * a ticket and an order screen start describing the same food differently
   * and nothing anywhere fails - until a cook makes the wrong thing.
   */
  const inputs = [0, 1, 2, 3, 4, -1, '1', '2', '3', '', null, undefined, NaN, true, 'hot', {}, []];
  for (const value of inputs) {
    assert.strictEqual(
      spiceLine(value),
      api.ticketLine(value),
      'the two spice tables disagree about ' + JSON.stringify(value)
    );
  }
});

test('a stray boolean prints nothing, because Number(true) is 1', () => {
  /*
   * Found by the test and not by reading it: every one of these paths does
   * Number(value), and a client sending `true` would have had MILD printed on
   * real paper for a request nobody made. A level nobody chose must never
   * become a level somebody did.
   */
  assert.strictEqual(spiceLine(true), '');
  assert.strictEqual(api.ticketLine(true), '');
});

/* ------------------------------------------------------------ on the roll */

test('the level reaches the paper, worded and counted', () => {
  const paper = ticket({ spice_level: 2 });
  assert.match(paper, /SPICE: MEDIUM \(2 of 3\)/);
});

test('the count is on the paper for a cook who does not read the word', () => {
  /* The reason this is a number and not a sentence: 2 of 3 means the same
     thing in every kitchen, whatever language the order was placed in. */
  assert.match(ticket({ spice_level: 1 }), /\(1 of 3\)/);
  assert.match(ticket({ spice_level: 3 }), /\(3 of 3\)/);
});

test('nobody asked, nothing printed', () => {
  /*
   * A line reading "SPICE: NOT SAID" on every ticket is a line every cook
   * learns to skip, and the day it matters they skip it too.
   */
  assert.doesNotMatch(ticket({}), /SPICE/);
  assert.doesNotMatch(ticket({ spice_level: 0 }), /SPICE/);
});

test('the level is its own line, not folded into the note', () => {
  /*
   * A level is three fixed words on every ticket; a note is whatever somebody
   * typed. Printed as one line, the reliable half becomes as hard to trust as
   * the unreliable half - and the level reads FIRST, because it is the part
   * the cook acts on before reading anything.
   */
  const paper = ticket({ spice_level: 3, description: 'no coriander' });
  const spiceAt = paper.indexOf('SPICE: SPICY');
  const noteAt = paper.indexOf('no coriander');
  assert.ok(spiceAt !== -1 && noteAt !== -1, 'one of the two lines is missing');
  assert.ok(spiceAt < noteAt, 'the note printed above the spice level');
  assert.ok(
    paper.slice(spiceAt, noteAt).includes('\n'),
    'the level and the note printed on one line'
  );
});

test('every byte of the line is printable, so no printer swallows it', () => {
  /*
   * Receipt.text puts everything through ascii() and latin1. A chilli emoji
   * here would arrive as a question mark or as nothing at all, which is why
   * the chillies are drawn on the customer's phone and the paper gets words.
   */
  const bytes = renderKitchenTicket({
    title: 'New Order',
    items: [{ name: 'Dish', quantity: 1, spice_level: 3 }],
  });
  const line = readable(bytes).split('\n').find((l) => l.includes('SPICE'));
  assert.ok(line, 'no spice line on the ticket');
  /* From SPICE onward is the text itself; what precedes it on the same line
     is the printer's own bold-and-align bytes, which readable() shows as
     dots and which every line of every ticket carries. */
  assert.doesNotMatch(
    line.slice(line.indexOf('SPICE')),
    /\./,
    'an unprintable byte reached the spice line'
  );
  // eslint-disable-next-line no-control-regex
  assert.match(spiceLine(3), /^[\x20-\x7e]+$/, 'the line is not plain ASCII at source');
});

/* --------------------------------------------- and on the window fallback */

test('the window-and-PDF ticket says exactly the same thing', () => {
  /*
   * Two ways of printing one ticket. A thermal roll gets bytes and anything
   * else gets HTML, and a shop on the second path has no way of knowing it is
   * reading a different ticket from the shop on the first.
   */
  const manager = new KOTManager({ config: {} });
  const html = manager._buildKOTHtml(
    {
      sales_id: '7',
      table_number: '4',
      items: [
        { item_name: 'Chicken Chettinad', item_quantity: 1, spice_level: 2, item_description: 'no coriander' },
      ],
    },
    'new',
    12
  );
  assert.ok(html.includes('SPICE: MEDIUM (2 of 3)'), 'the HTML ticket lost the level');
  assert.ok(
    html.indexOf('SPICE: MEDIUM') < html.indexOf('no coriander'),
    'the HTML ticket printed the note above the level'
  );
  /* Its own element, so a shop can restyle one without touching the other. */
  assert.match(html, /<div class="is">SPICE: MEDIUM \(2 of 3\)<\/div>/);
});

test('a dish nobody chose for gets no line on the HTML ticket either', () => {
  const manager = new KOTManager({ config: {} });
  const html = manager._buildKOTHtml(
    { sales_id: '7', items: [{ item_name: 'Dish', item_quantity: 1 }] },
    'new',
    12
  );
  assert.ok(!html.includes('SPICE'), 'an unasked-for level printed anyway');
});
