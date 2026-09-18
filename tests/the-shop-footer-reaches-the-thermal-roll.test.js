'use strict';

/*
 * THE SHOP'S OWN WORDS REACH THE 80mm ROLL.
 *
 * Reported from a till: "Footer Content and Brand URL are saved and enabled,
 * and they appear correctly when printing A4. However, they do not appear at
 * all in Thermal preview or on the Thermal receipt, which still shows 'Thank
 * you, please visit again'."
 *
 * All of that was true, and none of it was the ESC/POS renderer, which has
 * handled `sale.footer` since it was written. The chain is:
 *
 *   settings.js      fills <span class="footer-content"> in BOTH stored
 *                    templates on every page load, from branch.footer_print
 *   sales_view.js    shows the block, takes .print-modal-body's HTML
 *   PosnicPro.js     hands that HTML to the ESC/POS path
 *   receipt-data.js  reads the sale back OUT of that HTML
 *
 * The last step gathered its footer from `.print-sale-notes` (a note typed on
 * one sale) and `.invoice-policy` (which in both templates holds the barcode
 * and is display:none). It never looked at `.footer-content` - the one element
 * that actually carries the shop's footer, sitting right there in the markup
 * it was handed. So `sale.footer` arrived empty every time, and the renderer's
 * fallback line was the only thing left to print.
 *
 * The brand URL missed for a different reason: printView appends it AFTER the
 * thermal branch has already returned, so it is not in that HTML at all. It is
 * read from the setting here instead.
 *
 * THIS TEST DRIVES THE REAL CHAIN: the real seeded template, the real jQuery,
 * the real extractor, the real renderer, and then decodes the bytes a printer
 * would receive. A test that asserted on source text would have passed while
 * the roll still said the wrong thing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { renderSale } = require('../src/escpos-receipt');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const NL = String.fromCharCode(10);

/* What a shop types into Settings -> Footer Content. Two lines, because a
   footer is laid out, and a single collapsed line would hide a real bug. */
const SHOP_FOOTER = ['No exchange without this bill.', 'Open 7am - 11pm, all days'].join(NL);

/**
 * A till, mid-print.
 *
 * The page is the shop's real thermal template inside the real print modal,
 * put through the two things the sale path does to it before the HTML is
 * taken: unhide the footer block, and fill the slots Settings fills.
 */
function till({ printUrl }) {
  const template = read('api', 'src', 'json', 'print_standard_html.txt');
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div class="modal-body print-modal-body">' +
      '<div class="row manage-table import-standard-print receipt_medium" id="receipt_wrapper">' +
      template +
      '</div></div></body></html>',
    { runScripts: 'outside-only' }
  );

  const win = dom.window;
  win.PosnicPro = {
    BRAND_URL: 'https://www.posnic.com',
    local: {
      get(key) {
        return key === 'print_url' ? String(printUrl) : '';
      },
    },
  };

  /* The real jQuery, on this document. */
  const jq = require('jquery')(win);
  win.$ = jq;
  win.jQuery = jq;

  vm.runInContext(read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'), win);

  /* sales_view.js:1454 - the footer block ships display:none and is shown for
     a sale. Without this, dropHidden() removes it and nothing else matters. */
  jq('.hide-receiving-print').show();

  /* settings.js:1415 and its neighbours, on every page load. */
  jq('.footer-content').text(SHOP_FOOTER);
  jq('.print_store_name').text('Test Shop');
  jq('.print_view_id').text('BILL-1');

  return { jq, win };
}

test('the extractor finds the footer the shop typed', () => {
  const { jq, win } = till({ printUrl: false });
  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());

  assert.ok(
    sale.footer.includes('No exchange without this bill.'),
    'the shop footer never reached the sale data: ' + JSON.stringify(sale.footer)
  );
  assert.ok(
    sale.footer.includes('Open 7am - 11pm, all days'),
    'the second footer line was lost: ' + JSON.stringify(sale.footer)
  );
});

test('and keeps the lines the shop laid out, rather than running them together', () => {
  /* `clean` collapses every run of whitespace, which is right for an amount
     and wrong for a footer somebody wrote over two lines. */
  const { jq, win } = till({ printUrl: false });
  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());

  assert.ok(
    sale.footer.split(NL).filter(Boolean).length >= 2,
    'the two lines were run into one: ' + JSON.stringify(sale.footer)
  );
});

test('the brand URL follows its switch, on the roll as on the sheet', () => {
  const off = till({ printUrl: false });
  const saleOff = off.win.PosnicPro.receiptData(off.jq('.print-modal-body').html());
  assert.ok(
    !saleOff.footer.includes('posnic.com'),
    'the brand URL printed with the switch off: ' + JSON.stringify(saleOff.footer)
  );

  const on = till({ printUrl: true });
  const saleOn = on.win.PosnicPro.receiptData(on.jq('.print-modal-body').html());
  assert.ok(
    saleOn.footer.includes('https://www.posnic.com'),
    'the brand URL did not reach the roll with the switch on: ' + JSON.stringify(saleOn.footer)
  );
});

/* -------------------------------------------------------------- the paper */

/**
 * The lines a printer would render, decoded from the byte stream.
 *
 * Control codes are consumed by their own length so a stray 0x0a inside a
 * command cannot be mistaken for a line break.
 */
function paper(buf) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const lines = [];
  let line = '';
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b === ESC) {
      const c = buf[i + 1];
      if (c === 0x40) { i += 2; continue; }
      if (c === 0x61 || c === 0x45 || c === 0x74) { i += 3; continue; }
      if (c === 0x64) { lines.push(line); line = ''; i += 3; continue; }
      if (c === 0x70) { i += 5; continue; }
      i += 2;
      continue;
    }
    if (b === GS) {
      const c = buf[i + 1];
      if (c === 0x21) { i += 3; continue; }
      if (c === 0x56) { i += 4; continue; }
      i += 2;
      continue;
    }
    if (b === 0x0a) {
      lines.push(line);
      line = '';
      i += 1;
      continue;
    }
    line += String.fromCharCode(b);
    i += 1;
  }
  if (line) lines.push(line);
  return lines.map((l) => l.trim());
}

test('what comes off the printer says what the shop wrote, and not the canned line', () => {
  const { jq, win } = till({ printUrl: true });
  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());
  const out = paper(renderSale(sale, { cut: true }));

  assert.ok(
    out.includes('No exchange without this bill.'),
    'the roll does not carry the shop footer:' + NL + out.join(NL)
  );
  assert.ok(
    out.includes('Open 7am - 11pm, all days'),
    'the roll lost the second footer line:' + NL + out.join(NL)
  );
  assert.ok(
    out.includes('https://www.posnic.com'),
    'the roll does not carry the brand URL:' + NL + out.join(NL)
  );
  assert.ok(
    !out.some((l) => l.includes('Thank you, please visit again')),
    'the till talked over the shop:' + NL + out.join(NL)
  );
});

test('a shop that wrote nothing still gets the canned line', () => {
  /* The fallback is the reason it exists, and removing it would leave a blank
     space under the total on every till that has never opened Settings. */
  const out = paper(renderSale({ storeName: 'Test Shop', total: 10 }, { cut: true }));
  assert.ok(
    out.some((l) => l.includes('Thank you, please visit again')),
    'the fallback went with the bug:' + NL + out.join(NL)
  );
});

test('the brand URL is spelled once, not once per print path', () => {
  /*
   * Four paths can put it on paper - silent A4, silent thermal, the browser's
   * print frame and the register report - plus the extractor deciding whether
   * to add it. Five literals is four chances for one of them to be wrong, and
   * that is how the thermal path came to be missing it.
   */
  const core = read('frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');
  assert.match(core, /BRAND_URL: 'https:\/\/www\.posnic\.com'/, 'the one spelling is gone');

  for (const file of [
    ['frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'],
    ['frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'],
    ['frontend', 'static', 'script', 'js', 'modules', 'js', 'registers.js'],
    ['frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'],
  ]) {
    const src = read(...file);
    const literals = (src.match(/https:\/\/www\.posnic\.com/g) || []).length;
    const allowed = file[file.length - 1] === 'PosnicPro.js' ? 1 : 0;
    assert.strictEqual(
      literals,
      allowed,
      file.join('/') + ' spells the brand URL itself instead of reading PosnicPro.BRAND_URL'
    );
  }
});

test('the preview reads the same slot the paper does', () => {
  /*
   * The preview is the half of the report that a shop sees BEFORE committing
   * paper, and it hard-coded its own thanks line while reading nothing. It
   * cannot be driven here without the whole sale screen, so this pins the two
   * things that made it wrong: it reads .footer-content, and the canned line
   * is reached only when nothing was written.
   */
  const sales = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js');
  const at = sales.indexOf('var footerHtml = footerLines.length');
  assert.ok(at > -1, 'the preview no longer builds a footer from the shop');

  const gather = sales.slice(at - 900, at);
  assert.ok(gather.includes(".find") || gather.includes("'.footer-content'"), 'the preview stopped reading .footer-content');
  assert.ok(
    sales.indexOf('lang_thank_you_visit_again', at) > at,
    'the canned line is no longer the fallback branch'
  );
  assert.ok(
    !sales.slice(at).includes("'<div class=\"rp-thanks\"><lang class=\"lang_thank_you_visit_again\">Thank you, visit again</lang></div>' +"),
    'the preview still appends the canned line unconditionally'
  );
});

/* ------------------------------------------- what the shop said, in its own
 *                                                        letters and symbols
 *
 * Follow-up from the same shop, which is in Italy. Their A4 sheet reads
 * "€ 8.00" and their roll read "8.00". Two different things caused that, and
 * only one of them is a bug:
 *
 *   - `ascii()` DELETED every euro sign from any text it was given, because
 *     the buffer is written as latin1 and U+20AC is not in Latin-1. A footer
 *     reading "€5 off" printed "5 off": a price, silently altered. That is
 *     the bug, and it was unreachable while footers never printed at all.
 *
 *   - amounts carry no currency symbol on this path at all: `num()` keeps the
 *     digits and `money()` is toFixed(2). That is a layout decision about a
 *     48-character line, not a defect, and it is not changed here.
 */

test('a euro sign the shop typed survives to the paper', () => {
  const out = renderSale({ storeName: 'S', total: 8, footer: 'Sconto di €5 sul prossimo acquisto' }, { cut: true });
  const at = out.indexOf(Buffer.from('Sconto', 'latin1'));
  assert.ok(at > -1, 'the footer did not reach the paper at all');

  /* Decoded through the code page the receipt selects for itself, which is
     the only reading that matches what the printer will do with the bytes. */
  const said = new TextDecoder('windows-1252').decode(out.slice(at, at + 36));
  assert.ok(
    said.startsWith('Sconto di €5'),
    'the euro sign was dropped on the way to the printer: ' + JSON.stringify(said)
  );
});

test('and the code page it is sent in is the one the receipt asked for', () => {
  /* ESC t 16 selects WPC1252. The euro lives at 0x80 there and nowhere in
     Latin-1, so sending 0x80 is only correct because of that line. */
  const out = renderSale({ storeName: 'S', total: 1 }, { cut: true });
  const selects = Buffer.from([0x1b, 0x74, 0x10]);
  assert.ok(out.indexOf(selects) > -1, 'the receipt stopped selecting code page 16');
});

test('Italian accents were never at risk, and still are not', () => {
  /* They sit above 0xA0, where CP1252 and Latin-1 agree, so this is a guard
     rather than a fix - it is the half of the report that was already fine. */
  const out = renderSale({ storeName: 'S', total: 1, footer: 'Perché no? Città e più' }, { cut: true });
  const at = out.indexOf(Buffer.from('Perch', 'latin1'));
  const said = new TextDecoder('windows-1252').decode(out.slice(at, at + 24));
  assert.ok(
    said.startsWith('Perché no? Città e più'),
    'an accented letter was mangled: ' + JSON.stringify(said)
  );
});
