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

/* ===================================================================== THE LOGO
 *
 * Same shop, same report: "Print Logo: enabled" and no logo on the roll. There
 * was no code to put one there - escpos-receipt.js had no image path at all.
 *
 * A thermal printer has no notion of an image file. It lays down dots, so a
 * logo has to arrive as a bitmap: one bit per dot, packed eight to a byte, as
 * GS v 0. The preparation happens in the PAGE, because the main process has no
 * canvas and no image decoder, and the page already has the logo on screen
 * decoded in the print modal.
 *
 * jsdom has no canvas, so the pixels are faked and everything else is real:
 * the real receiptLogo, the real Floyd-Steinberg, the real bit packing, the
 * real GS v 0 encoder, and the header decoded back out of the byte stream.
 */

const GS_RASTER = Buffer.from([0x1d, 0x76, 0x30]);

/** A canvas that holds the rectangle it was asked to draw, and nothing else. */
function fakeCanvas(win, { logoIsBlack = true } = {}) {
  const realCreate = win.document.createElement.bind(win.document);
  win.document.createElement = function (tag) {
    if (String(tag).toLowerCase() !== 'canvas') return realCreate(tag);
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      fillStyle: '',
      fillRect() {},
      drawImage(img, left, top, w, h) {
        canvas._drawn = { left, top, w, h };
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        const d = canvas._drawn || { left: 0, w: 0 };
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const o = (py * w + px) * 4;
            const inside = px >= d.left && px < d.left + d.w;
            /* White paper outside, the logo's own colour inside. */
            const v = inside && logoIsBlack ? 0 : 255;
            data[o] = data[o + 1] = data[o + 2] = v;
            data[o + 3] = 255;
          }
        }
        return { data, width: w, height: h };
      },
    });
    return canvas;
  };
  return win;
}

/** The modal, with Print Logo on and a decoded image in it. */
function withLogo(win, { natural = [300, 120], shown = true } = {}) {
  const holder = win.document.querySelector('.print-modal-body .branch_image');
  assert.ok(holder, 'the template no longer carries a .branch_image block');
  holder.style.display = shown ? 'block' : 'none';

  const img = holder.querySelector('img');
  assert.ok(img, 'the template no longer carries a logo <img>');
  img.setAttribute('src', 'static/images/default/store.png');
  /* jsdom never loads it, so say what a loaded image would say. */
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: natural[0], configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: natural[1], configurable: true });
  return img;
}

test('the shop logo becomes dots, and reaches the printer as GS v 0', () => {
  const { win } = till({ printUrl: false });
  fakeCanvas(win);
  withLogo(win);

  const logo = win.PosnicPro.receiptLogo('80');
  assert.ok(logo, 'no raster was produced for a shop with Print Logo on');
  assert.strictEqual(logo.width, 576, '80mm is 576 dots at 203dpi');
  assert.strictEqual(logo.height, 120, 'a 300x120 logo fits without being scaled');

  const bytes = Buffer.from(logo.data, 'base64');
  assert.strictEqual(bytes.length, (576 / 8) * 120, 'the bitmap is not the size it claims');

  const out = renderSale({ storeName: 'S', total: 8, logo }, { cut: true });
  const at = out.indexOf(GS_RASTER);
  assert.ok(at > -1, 'the logo never reached the byte stream');

  /* GS v 0 m xL xH yL yH: x is the row length in BYTES, y is dot rows. */
  assert.strictEqual(out[at + 3], 0x00, 'density should be normal');
  assert.strictEqual(out[at + 4] + out[at + 5] * 256, 72, 'row length should be 72 bytes');
  assert.strictEqual(out[at + 6] + out[at + 7] * 256, 120, 'height should be 120 dot rows');
  assert.ok(out.length - at - 8 >= 72 * 120, 'the payload is shorter than the header promises');
});

test('and it is centred in the bitmap, not left to the printer', () => {
  /* ESC a 1 centres text everywhere and raster images on most printers, and
     "most" is not a thing to discover on a shop counter. */
  const { win } = till({ printUrl: false });
  fakeCanvas(win);
  withLogo(win, { natural: [288, 40] });

  const logo = win.PosnicPro.receiptLogo('80');
  const bytes = Buffer.from(logo.data, 'base64');
  const perRow = 72;

  /* A 288-dot logo on 576 dots leaves 144 dots of paper either side. */
  const firstRow = bytes.slice(0, perRow);
  const leftEdge = firstRow.slice(0, 144 / 8);
  const rightEdge = firstRow.slice(perRow - 144 / 8);
  assert.ok(leftEdge.every((b) => b === 0), 'ink in the left margin');
  assert.ok(rightEdge.every((b) => b === 0), 'ink in the right margin');
  assert.ok(
    firstRow.slice(144 / 8, perRow - 144 / 8).some((b) => b !== 0),
    'the logo itself is blank'
  );
});

test('a logo taller than the paper is worth is scaled down, never up', () => {
  const { win } = till({ printUrl: false });
  fakeCanvas(win);
  withLogo(win, { natural: [2000, 1600] });

  const big = win.PosnicPro.receiptLogo('80');
  assert.ok(big.height <= 240, 'a logo ran past 30mm of roll: ' + big.height + ' dot rows');

  /* And a small one stays small: enlarged then dithered is mud, and a shop
     would read that as a broken printer rather than as a small file. */
  const second = till({ printUrl: false });
  fakeCanvas(second.win);
  withLogo(second.win, { natural: [64, 64] });
  const small = second.win.PosnicPro.receiptLogo('80');
  assert.strictEqual(small.height, 64, 'a small logo was enlarged');
});

test('Print Logo off means no logo, and no bytes spent on one', () => {
  const { win } = till({ printUrl: false });
  fakeCanvas(win);
  withLogo(win, { shown: false });

  assert.strictEqual(win.PosnicPro.receiptLogo('80'), null, 'the logo printed with the switch off');

  const out = renderSale({ storeName: 'S', total: 8 }, { cut: true });
  assert.strictEqual(out.indexOf(GS_RASTER), -1, 'a raster command with nothing to raster');
});

test('a bitmap wider than the paper is refused rather than shredded', () => {
  /*
   * One receipt can go to an 80mm and a 58mm printer at once. The bits were
   * packed for the shop's own paper, and a narrow printer would render the
   * overflow as garbage rows - a receipt without a logo is a receipt, one with
   * a shredded logo is a fault report.
   */
  const wide = { width: 576, height: 8, data: Buffer.alloc(72 * 8, 0xff).toString('base64') };
  const narrow = renderSale({ storeName: 'S', total: 1, logo: wide }, { paperWidth: '58', cut: true });
  assert.strictEqual(narrow.indexOf(GS_RASTER), -1, '576 dots were sent to a 384-dot printer');

  const right = renderSale({ storeName: 'S', total: 1, logo: wide }, { paperWidth: '80', cut: true });
  assert.ok(right.indexOf(GS_RASTER) > -1, 'the same bitmap was refused by its own paper');
});

test('a logo that cannot be prepared never stops a sale printing', () => {
  const { win } = till({ printUrl: false });
  withLogo(win);
  /* No canvas at all, which is what a locked-down or ancient browser gives. */
  win.document.createElement = () => ({ getContext: () => null });

  assert.strictEqual(win.PosnicPro.receiptLogo('80'), null, 'a missing canvas should not throw');
});

/* ================================================================ THE CURRENCY
 *
 * num() keeps the digits and drops the rest, so the roll printed "8.00" where
 * the A4 sheet printed a euro and 8.00. The symbol is read back off the
 * rendered total, like everything else in that file.
 */

test('the receipt says which money it counted', () => {
  const { jq, win } = till({ printUrl: false });
  jq('.print-subtotal').html('€&nbsp;<span class="number">8.00</span>');

  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());
  assert.strictEqual(sale.currency, '€', 'the symbol was not read off the total');

  const out = renderSale(sale, { cut: true });
  const at = out.indexOf(Buffer.from('Subtotal', 'latin1'));
  assert.ok(at > -1, 'no subtotal line to check');
  const said = new TextDecoder('windows-1252').decode(out.slice(at, at + 48));
  assert.ok(said.includes('€8.00'), 'the amount lost its currency: ' + JSON.stringify(said));
});

test('and a receipt that never showed one still does not', () => {
  /* Most shops are in one country and the symbol is noise on a 48-column
     line. Whatever the template shows is what prints, and nothing invents. */
  const { jq, win } = till({ printUrl: false });
  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());
  assert.strictEqual(sale.currency, '', 'a symbol appeared from nowhere');
});

test('a quantity is not a currency', () => {
  /* "Total Qty 1.00" is a number with no symbol, and reading one would answer
     "no currency" with confidence while the totals were saying euro. */
  const { jq, win } = till({ printUrl: false });
  jq('.total-noof-item').html('<span class="number">1.00</span>');
  jq('.print-subtotal').html('€&nbsp;<span class="number">8.00</span>');

  const sale = win.PosnicPro.receiptData(jq('.print-modal-body').html());
  assert.strictEqual(sale.currency, '€', 'a quantity answered for the currency');
});

test('a rupee still becomes Rs. before the columns are measured', () => {
  /*
   * The whole reason substitutions happen in characters rather than bytes:
   * "Rs." is three characters where the sign was one, and a column measured
   * before the swap puts every amount one place off the right margin.
   */
  const out = renderSale(
    { storeName: 'S', subTotal: 800, total: 800, currency: '₹' },
    { cut: true }
  );
  const lines = paper(out).filter((l) => l.includes('800.00'));
  assert.ok(lines.length > 0, 'nothing printed');
  for (const line of lines) {
    assert.ok(line.includes('Rs.800.00'), 'the rupee did not become Rs.: ' + JSON.stringify(line));
    assert.ok(line.length <= 48, 'a line ran past the paper: ' + line.length + ' columns');
  }
});
