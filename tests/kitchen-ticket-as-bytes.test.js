'use strict';

/*
 * The kitchen ticket goes out as bytes, the way a receipt already does.
 *
 * Owner: "prints are very slow. as soon receive order it needs to print...
 * every seconds counts here."
 *
 * Measured on a real till, order to paper:
 *
 *   before   2,080 ms, of which 1,114 ms was building the FIRST copy
 *            (HTML into a hidden window, render, convert to PDF, hand to
 *            SumatraPDF) and a further 252 ms for the second printer
 *   after      184 ms to paper, both printers, ESC/POS straight to the roll
 *
 * A receipt covering the same ground already took 124 ms, which is what made
 * it obvious where the time was going.
 *
 * The window path stays. It is what a non-thermal printer needs and it is the
 * fallback when a ticket cannot be drawn as bytes. What must never happen is
 * falling back after a printer REFUSED, because that prints the order twice.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

/* kot-manager and the renderer run in the Electron main process. The window
   class below THROWS: if anything reaches for it in these tests, the byte path
   was not taken and the test says so instead of quietly passing. */
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
const { renderKitchenTicket } = require(path.join(ROOT, 'src', 'escpos-kot.js'));
const KOTManager = require(path.join(ROOT, 'src', 'kot-manager.js'));
Module._load = load;

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

const ticket = {
  title: 'Additional Order', number: 7, dateText: '13-09-2026 8:41:15 PM',
  dineType: 'Dine in', saleId: 'SID1042', tableNo: '5', personCount: '4',
  items: [{ name: 'Sweet Corn Soup - Chicken', quantity: 2, description: 'no coriander' }],
};

test('the ticket says what it is, which table, and what to make', () => {
  const paper = readable(renderKitchenTicket(ticket, { paperWidth: '48' }));
  assert.match(paper, /Additional Order/);
  assert.match(paper, /#7/);
  assert.match(paper, /TABLE 5/, 'the table is not called out');
  assert.match(paper, /Pax: 4/);
  assert.match(paper, /SWEET CORN SOUP - CHICKEN/, 'the dish is not on the ticket');
  assert.match(paper, /x2/, 'the quantity is missing');
  assert.match(paper, /\*\* no coriander \*\*/, 'what the customer asked for is missing');
});

test('the table and the serial are the big type, and the body is not', () => {
  /* GS ! n sets the character size. The serial is the biggest thing on the
     sheet because that is what the pass calls out. */
  const bytes = renderKitchenTicket(ticket, { paperWidth: '48' });
  const sizes = [];
  for (let i = 0; i < bytes.length - 2; i += 1) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x21) sizes.push(bytes[i + 2]);
  }
  assert.ok(sizes.includes(0x22), 'nothing is set triple size; the serial should be');
  assert.ok(sizes.includes(0x11), 'nothing is set double size; the title and table should be');
  assert.ok(sizes.includes(0x00), 'the size is never returned to normal');
});

test('a takeaway says it has no table rather than printing an empty one', () => {
  const paper = readable(renderKitchenTicket(
    { title: 'New Order', number: 9, dineType: 'Take away', items: [{ name: 'Tea', quantity: 1 }] },
    { paperWidth: '48' }
  ));
  assert.match(paper, /NO TABLE/);
  assert.ok(!/TABLE \s*$/m.test(paper), 'an empty table line was printed');
});

test('a narrow roll is laid out for its own width', () => {
  const wide = readable(renderKitchenTicket(ticket, { paperWidth: '48' }));
  const narrow = readable(renderKitchenTicket(ticket, { paperWidth: '32' }));
  const ruleOf = (s) => (s.match(/-{8,}/) || [''])[0].length;
  assert.strictEqual(ruleOf(wide), 48);
  assert.strictEqual(ruleOf(narrow), 32, 'a 58mm roll is being laid out at 80mm');
});

test('every ticket ends with a cut, or they come off in one strip', () => {
  const bytes = renderKitchenTicket(ticket, { paperWidth: '48' });
  let cut = false;
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56) cut = true;
  }
  assert.ok(cut, 'no cut command');
});

test('with a printer to hand, the ticket goes as bytes and no window is opened', async () => {
  /* The electron stub above throws if a window is constructed, so reaching the
     old path fails this test rather than passing it slowly. */
  const sent = [];
  const kot = new KOTManager({
    hardware: {
      sendRawToPrinter: async (name, bytes, label) => { sent.push({ name, bytes, label }); return { success: true }; },
    },
  });
  kot.config = { branchId: 'b1', printerNames: ['Reception', 'Kitchen'] };

  const results = await kot.silentPrint(
    { _id: 'x', sales_id: 'SB-1', sale_process: 'KOT', table_number: '5', person_count: '4',
      _printKind: 'new', items: [{ item_name: 'Tea', item_quantity: 1 }] },
    ['Reception', 'Kitchen'],
    true
  );

  assert.strictEqual(sent.length, 2, 'both printers did not get the ticket');
  assert.deepStrictEqual(sent.map((s) => s.name), ['Reception', 'Kitchen']);
  assert.ok(sent[0].bytes.length > 40, 'an empty ticket was sent');
  assert.match(readable(sent[0].bytes), /TABLE 5/);
  assert.deepStrictEqual(results.map((r) => r.status), ['success', 'success']);
});

test('a printer that refuses is reported, and NOT printed again through the window', async () => {
  /* Falling back here would put the same order on paper twice. The window stub
     throwing is what proves it did not happen. */
  const kot = new KOTManager({
    hardware: { sendRawToPrinter: async () => ({ success: false, error: 'offline' }) },
  });
  kot.config = { branchId: 'b1', printerNames: ['Reception'] };

  const results = await kot.silentPrint(
    { _id: 'x', sales_id: 'SB-2', sale_process: 'KOT', table_number: '6',
      _printKind: 'new', items: [{ item_name: 'Tea', item_quantity: 1 }] },
    ['Reception'],
    true
  );

  assert.deepStrictEqual(results.map((r) => r.status), ['failed']);
  assert.strictEqual(results[0].reason, 'offline', 'the reason the printer gave was lost');
});

test('the ticket is in the packaged build', () => {
  /* build.files is an allowlist; a module missing from it throws "Cannot find
     module" on a customer's counter and nowhere else. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/escpos-kot.js'));
});
