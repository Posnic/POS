'use strict';

/*
 * A PICTURE UNDER THE TOTAL.
 *
 * Owner: "i believe its better to give option to add image in bottom. for
 * example instead of saying visit website uer can upload qr code image, asking
 * cutomer to scan for online store" - and then "still need text we provide
 * option".
 *
 * A printed web address is something a customer has to type. A QR is something
 * they point a phone at, and a line above it saying what it is for is what
 * makes them bother.
 *
 * THE ONE THING THAT MAKES THIS DIFFERENT FROM THE LOGO: a logo is a picture
 * and reads better dithered; a QR is DATA, and dithering it can stop a scanner
 * reading it back at all. That distinction is what most of this file is about,
 * because it is invisible on screen and only shows up when a customer is
 * standing at a counter failing to scan a receipt.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { renderSale } = require('../src/escpos-receipt');
const { pack } = require('../src/escpos-logo');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const NL = String.fromCharCode(10);
const GS_RASTER = Buffer.from([0x1d, 0x76, 0x30]);

/** A bitmap of the right size, so renderSale will accept it. */
function bitmap(width, height, fill = 0xff) {
  return { width, height, data: Buffer.alloc((width / 8) * height, fill).toString('base64') };
}

/** The lines a printer would render, with rasters marked. */
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
      if (c === 0x61 || c === 0x45 || c === 0x74 || c === 0x25) { i += 3; continue; }
      if (c === 0x64) { lines.push(line); line = ''; i += 3; continue; }
      if (c === 0x70) { i += 5; continue; }
      if (c === 0x26) {
        const bands = buf[i + 2];
        const from = buf[i + 3];
        const to = buf[i + 4];
        let at = i + 5;
        for (let ch = from; ch <= to; ch += 1) at += 1 + buf[at] * bands;
        i = at;
        continue;
      }
      i += 2;
      continue;
    }
    if (b === GS) {
      const c = buf[i + 1];
      if (c === 0x21) { i += 3; continue; }
      if (c === 0x56) { i += 4; continue; }
      if (c === 0x76 && buf[i + 2] === 0x30) {
        const perRow = buf[i + 4] + buf[i + 5] * 256;
        const rows = buf[i + 6] + buf[i + 7] * 256;
        lines.push('[PICTURE]');
        i += 8 + perRow * rows;
        continue;
      }
      i += 2;
      continue;
    }
    if (b === 0x0a) { lines.push(line); line = ''; i += 1; continue; }
    line += String.fromCharCode(b);
    i += 1;
  }
  if (line) lines.push(line);
  return lines.map((l) => l.trim());
}

test('the picture prints, under everything else', () => {
  /* A customer folds a receipt to the bottom to scan it. A code in the middle
     of the totals is one they have to flatten the paper to reach. */
  const out = renderSale(
    { storeName: 'S', total: 8, footer: 'Grazie!', footerImage: bitmap(576, 64) },
    { cut: true }
  );
  const lines = paper(out);
  const at = lines.indexOf('[PICTURE]');
  assert.ok(at > -1, 'the picture never reached the paper');
  assert.ok(at > lines.indexOf('Grazie!'), 'the picture printed above the shop footer');
});

test('THE CAPTION COMES FIRST, because it is an instruction', () => {
  /*
   * "Please scan below QR for our online store" printed UNDERNEATH the thing
   * it is telling you to scan has told you nothing.
   */
  const out = renderSale(
    {
      storeName: 'S',
      total: 8,
      footerImageCaption: 'Please scan below QR for our online store',
      footerImage: bitmap(576, 64),
    },
    { cut: true }
  );
  const lines = paper(out);
  const caption = lines.findIndex((l) => l.includes('scan below QR'));
  const picture = lines.indexOf('[PICTURE]');
  assert.ok(caption > -1, 'the caption never printed');
  assert.ok(picture > -1, 'the picture never printed');
  assert.ok(caption < picture, 'the caption printed below the thing it introduces');
});

test('and a caption with no picture is not printed at all', () => {
  /*
   * A shop that clears its QR and forgets the sentence would otherwise hand
   * every customer a receipt telling them to scan something that is not there.
   */
  const out = renderSale(
    { storeName: 'S', total: 8, footerImageCaption: 'Please scan below QR for our online store' },
    { cut: true }
  );
  assert.ok(
    !paper(out).some((l) => l.includes('scan below QR')),
    'a caption printed pointing at nothing'
  );
});

test('a caption longer than the paper wraps rather than being cut', () => {
  const long = 'Scan this code to visit our online store and see everything we sell all year';
  const out = renderSale(
    { storeName: 'S', total: 8, footerImageCaption: long, footerImage: bitmap(576, 32) },
    { cut: true }
  );
  const lines = paper(out);
  for (const l of lines) assert.ok(l.length <= 48, 'a line ran past the paper: ' + JSON.stringify(l));
  /* Every word survived somewhere. */
  const joined = lines.join(' ');
  for (const word of ['Scan', 'online', 'store', 'year']) {
    assert.ok(joined.includes(word), 'wrapping lost the word ' + word);
  }
});

test('no picture means no bytes spent on one', () => {
  const out = renderSale({ storeName: 'S', total: 8 }, { cut: true });
  assert.strictEqual(out.indexOf(GS_RASTER), -1, 'a raster command with nothing to raster');
});

test('a picture the page could not read is ignored rather than half-printed', () => {
  /* `{ src }` carries no dots - the main process turns it into some. If it is
     still a `{ src }` here, emitting a GS v 0 with nothing behind it jams a
     printer. */
  const out = renderSale(
    { storeName: 'S', total: 8, footerImage: { src: 'https://example.com/qr.png' } },
    { cut: true }
  );
  assert.strictEqual(out.indexOf(GS_RASTER), -1, 'a raster command with no raster');
  assert.ok(paper(out).some((l) => l.includes('TOTAL')), 'the sale did not print');
});

/* ===================================================================== dither */

/** Where the ink is, and how broken up it is. */
function inspect(bytes, width, height) {
  const perRow = width / 8;
  let ink = 0;
  let flips = 0;
  for (let y = 0; y < height; y++) {
    let last = 0;
    for (let x = 0; x < width; x++) {
      const bit = bytes[y * perRow + (x >> 3)] & (0x80 >> (x & 7)) ? 1 : 0;
      ink += bit;
      if (x && bit !== last) flips += 1;
      last = bit;
    }
  }
  return { ink, flips };
}

test('A QR IS THRESHOLDED, NOT DITHERED', () => {
  /*
   * The whole reason this is not just "print the logo again".
   *
   * A mid-grey block is the test case that separates them. Thresholded, it is
   * uniformly one colour - every pixel takes the same decision. Dithered, it
   * becomes a fine checkerboard, because the error of each pixel is pushed
   * into its neighbours. That checkerboard is what a scanner sees instead of a
   * clean module, and it is why a dithered QR can fail to read.
   */
  const w = 64;
  const h = 32;
  const dots = 576;
  const grey = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    grey[i * 4] = grey[i * 4 + 1] = grey[i * 4 + 2] = 160;
    grey[i * 4 + 3] = 255;
  }

  const thresholded = inspect(pack(grey, w, h, dots, false), dots, h);
  const dithered = inspect(pack(grey, w, h, dots, true), dots, h);

  assert.strictEqual(thresholded.ink, 0, 'a light grey should threshold to white, not to ink');
  assert.ok(dithered.ink > 0, 'dithering a light grey should still lay some ink');
  assert.ok(
    dithered.flips > thresholded.flips,
    'dithering did not break the block up: ' + dithered.flips + ' vs ' + thresholded.flips
  );
});

test('and a black square stays a solid black square either way', () => {
  /* Which is what a QR module actually is. Thresholding must not thin it. */
  const w = 64;
  const h = 32;
  const dots = 576;
  const black = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) black[i * 4 + 3] = 255;

  const flat = inspect(pack(black, w, h, dots, false), dots, h);
  assert.strictEqual(flat.ink, w * h, 'a solid black block lost dots to thresholding');
  assert.strictEqual(flat.flips, h * 2, 'a solid block should have two edges per row');
});

test('the page thresholds it too, and agrees with the main process', () => {
  /*
   * Two copies of this code exist, one either side of a boundary neither can
   * cross - a canvas in the page, a decoder in the main process. Two copies
   * that drift are a QR that scans when the shop uploaded it and not when it
   * was fetched, which nobody would ever diagnose.
   */
  const w = 64;
  const h = 32;
  const dots = 576;
  const left = Math.floor((dots - w) / 2);

  /* A gradient, so a broken threshold shows up rather than agreeing by luck. */
  const shade = (x, y) => Math.round(((x / w) * 0.5 + (y / h) * 0.5) * 255);

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.PosnicPro = { BRAND_URL: '', local: { get: () => '' } };
  const jq = require('jquery')(win);
  win.$ = jq;
  win.jQuery = jq;
  vm.runInContext(read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'), win);

  const modal = win.document.createElement('div');
  modal.className = 'print-modal-body';
  modal.innerHTML = '<div class="footer-image"><img src="qr.png"></div>';
  win.document.body.appendChild(modal);
  const img = modal.querySelector('img');
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: w });
  Object.defineProperty(img, 'naturalHeight', { value: h });

  win.document.createElement = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect() {},
      drawImage() {},
      getImageData: (x, y, gw, gh) => {
        const data = new Uint8ClampedArray(gw * gh * 4);
        data.fill(255);
        for (let py = 0; py < gh; py++) {
          for (let px = 0; px < gw; px++) {
            const o = (py * gw + px) * 4;
            if (px >= left && px < left + w) {
              const v = shade(px - left, py);
              data[o] = data[o + 1] = data[o + 2] = v;
            }
            data[o + 3] = 255;
          }
        }
        return { data, width: gw, height: gh };
      },
    }),
  });

  const fromPage = win.PosnicPro.receiptFooterImage('80');
  assert.ok(fromPage && fromPage.data, 'the page produced no footer picture');

  /* The same gradient as nativeImage would hand over: BGRA, and grey, so the
     channel order cannot mask a difference. */
  const bgra = Buffer.alloc(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const v = shade(px, py);
      bgra[i] = bgra[i + 1] = bgra[i + 2] = v;
      bgra[i + 3] = 255;
    }
  }
  const fromMain = pack(bgra, w, h, dots, false).toString('base64');

  assert.strictEqual(
    fromMain,
    fromPage.data,
    'the page and the main process threshold the same picture differently'
  );
});

test('a QR gets more room than a logo, because a small one does not scan', () => {
  /* 48mm against 30mm. The logo is decoration at the top of a receipt; this is
     the reason the customer keeps it. */
  const src = read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js');
  const logoMax = Number((src.match(/LOGO_MAX_ROWS = (\d+)/) || [])[1]);
  const footerMax = Number((src.match(/FOOTER_MAX_ROWS = (\d+)/) || [])[1]);
  assert.ok(logoMax > 0 && footerMax > 0, 'the caps are gone');
  assert.ok(footerMax > logoMax, 'a QR is capped no larger than a logo: ' + footerMax + ' vs ' + logoMax);
});
