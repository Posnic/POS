'use strict';

/*
 * A LOGO THE PAGE IS NOT ALLOWED TO READ.
 *
 * receipt-data.js rasterises the logo in the page, which is the right place -
 * the image is on screen and already decoded. But a page can only read pixels
 * back off a canvas it is ALLOWED to read, and an image from another origin
 * without CORS headers taints it: `getImageData` throws, however you ask. A
 * shop whose logo lives on an S3 bucket or a CDN could never get one printed.
 *
 * So the page now hands the SOURCE on, and src/escpos-logo.js turns it into
 * dots in the main process, where there is no origin and no canvas - only
 * Chromium's decoder, through nativeImage.
 *
 * nativeImage needs Electron, so it is injected here: the decoder is faked and
 * everything that can be wrong is real - the byte order, the scaling, the
 * dithering, the packing, the centring, and the refusal to throw.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const { rasterFor, pack, bytesFor, DOTS, MAX_ROWS } = require('../src/escpos-logo');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

/** A solid rectangle of one colour, as nativeImage.toBitmap gives it: BGRA. */
function bgra(w, h, [r, g, b, a = 255]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = b;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = r;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

/** A stand-in for nativeImage, holding one solid colour. */
function decoder(w, h, colour) {
  const make = (width, height) => ({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toBitmap: () => bgra(width, height, colour),
    resize: ({ width: nw, height: nh }) => make(nw, nh),
  });
  return () => make(w, h);
}

const deps = (over = {}) => ({
  decode: decoder(300, 120, [0, 0, 0]),
  readFile: () => Buffer.from('not really an image'),
  get: async () => null,
  ...over,
});

/** Where the ink is in a packed bitmap. */
function inspect(b) {
  const bytes = Buffer.from(b.data, 'base64');
  const perRow = b.width / 8;
  let ink = 0;
  let first = b.width;
  let last = -1;
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (!(bytes[y * perRow + (x >> 3)] & (0x80 >> (x & 7)))) continue;
      ink += 1;
      if (x < first) first = x;
      if (x > last) last = x;
    }
  }
  return { bytes: bytes.length, ink, first, last };
}

test('a picture the page could not read becomes dots here', async () => {
  const got = await rasterFor('data:image/png;base64,AAAA', '80', deps());
  assert.ok(got, 'nothing came back for a decodable image');
  assert.strictEqual(got.width, 576, '80mm is 576 dots');
  assert.strictEqual(got.height, 120, 'a 300x120 logo fits without scaling');

  const seen = inspect(got);
  assert.strictEqual(seen.bytes, 72 * 120, 'one bit per dot, eight to a byte');
  assert.ok(seen.ink > 0, 'a solid black logo produced no ink');
});

test('and it is centred on the paper, like the page does it', async () => {
  const got = await rasterFor('data:image/png;base64,AAAA', '80', deps({
    decode: decoder(288, 40, [0, 0, 0]),
  }));
  const seen = inspect(got);
  /* 288 dots on 576 leaves 144 either side. */
  assert.strictEqual(seen.first, 144, 'ink starts in the left margin');
  assert.strictEqual(seen.last, 431, 'ink runs into the right margin');
});

test('THE BYTES ARE BGRA, WHICH IS NOT RGBA', async () => {
  /*
   * The one mistake this file invites. Red carries 0.299 of the luminance sum
   * and blue carries 0.114, so reading the channels the wrong way round turns
   * a red logo light and a blue one dark - a logo that prints, and prints
   * wrong, which is harder to notice than one that does not print at all.
   *
   * Pure red is 76/255 and pure blue is 29/255, and both are under the 128
   * threshold, so ink alone proves nothing. What separates them is how much
   * the dither spreads: blue is darker, so it fills more.
   */
  const red = await rasterFor('data:x,1', '80', deps({ decode: decoder(64, 64, [255, 0, 0]) }));
  const blue = await rasterFor('data:x,1', '80', deps({ decode: decoder(64, 64, [0, 0, 255]) }));

  const inkRed = inspect(red).ink;
  const inkBlue = inspect(blue).ink;
  assert.ok(inkRed > 0 && inkBlue > 0, 'both should be dark enough to print');
  assert.ok(
    inkBlue > inkRed,
    'blue (29) must print darker than red (76); the channels are swapped: red=' +
      inkRed + ' blue=' + inkBlue
  );
});

test('a transparent logo is over white, not a black box', async () => {
  const clear = await rasterFor('data:x,1', '80', deps({
    decode: decoder(64, 64, [0, 0, 0, 0]),
  }));
  assert.strictEqual(inspect(clear).ink, 0, 'a fully transparent logo printed as a black square');
});

test('big logos are scaled down, small ones are never blown up', async () => {
  const big = await rasterFor('data:x,1', '80', deps({ decode: decoder(2000, 1600, [0, 0, 0]) }));
  assert.ok(big.height <= MAX_ROWS, 'a logo ran past 30mm of roll: ' + big.height);

  const small = await rasterFor('data:x,1', '80', deps({ decode: decoder(64, 64, [0, 0, 0]) }));
  assert.strictEqual(small.height, 64, 'a small logo was enlarged into mud');
});

test('58mm paper gets 58mm dots', async () => {
  const narrow = await rasterFor('data:x,1', '58', deps());
  assert.strictEqual(narrow.width, DOTS[58], '58mm is 384 dots');
  assert.strictEqual(inspect(narrow).bytes, 48 * narrow.height);
});

test('NOTHING here can fail a receipt', async () => {
  /*
   * A logo is decoration and a receipt is not. Every one of these is a real
   * shape of failure - an unreachable URL, a file that is not an image, a
   * decoder that throws, a buffer shorter than the size it claims - and all of
   * them print the sale.
   */
  const cases = [
    ['no source', '', deps()],
    ['unreachable url', 'https://example.com/logo.png', deps({ get: async () => null })],
    ['a fetch that throws', 'https://example.com/logo.png', deps({
      get: async () => { throw new Error('ECONNREFUSED'); },
    })],
    ['a file that is not there', 'store.png', deps({
      readFile: () => { throw new Error('ENOENT'); },
    })],
    ['a decoder that throws', 'data:x,1', deps({
      decode: () => { throw new Error('unrecognised format'); },
    })],
    ['an empty image', 'data:x,1', deps({
      decode: () => ({ isEmpty: () => true }),
    })],
    ['a zero-sized image', 'data:x,1', deps({
      decode: () => ({ isEmpty: () => false, getSize: () => ({ width: 0, height: 0 }) }),
    })],
    ['a buffer shorter than it claims', 'data:x,1', deps({
      decode: () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 100, height: 100 }),
        toBitmap: () => Buffer.alloc(10),
        resize: () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 100, height: 100 }),
          toBitmap: () => Buffer.alloc(10),
        }),
      }),
    })],
  ];

  for (const [what, src, d] of cases) {
    const got = await rasterFor(src, '80', d);
    assert.strictEqual(got, null, what + ' should return nothing, not throw or lie');
  }
});

test('a data: URL is decoded rather than fetched', async () => {
  let fetched = false;
  const bytes = await bytesFor('data:image/png;base64,SGVsbG8=', {
    get: async () => { fetched = true; return null; },
    readFile: () => null,
  });
  assert.strictEqual(bytes.toString(), 'Hello');
  assert.strictEqual(fetched, false, 'a data: URL went out over the network');
});

test('an http logo is fetched, a bare path is read from disk', async () => {
  let asked = '';
  await bytesFor('https://cdn.example.com/logo.png', {
    get: async (url) => { asked = url; return Buffer.from('x'); },
    readFile: () => { throw new Error('should not touch the disk'); },
  });
  assert.strictEqual(asked, 'https://cdn.example.com/logo.png');

  let opened = '';
  await bytesFor('static/images/default/store.png', {
    get: async () => { throw new Error('should not go to the network'); },
    readFile: (f) => { opened = f; return Buffer.from('x'); },
  });
  assert.strictEqual(opened, 'static/images/default/store.png');
});

/* ------------------------------------------------------------------------- */

test('THE TWO RASTERISERS AGREE ON THE SAME PICTURE', () => {
  /*
   * This is the one that matters. There are two copies of Floyd-Steinberg now
   * - one in the page, one in the main process - because one has a canvas and
   * the other has a decoder, and neither can call the other. Two copies that
   * drift are a logo that prints differently depending on where the shop's
   * image happens to be hosted, which nobody would ever diagnose.
   *
   * The same picture goes through both and the BITS must match exactly. The
   * buffers differ on purpose: a canvas gives RGBA and nativeImage gives BGRA,
   * which is precisely the difference that must NOT show up in the output.
   */
  const w = 96;
  const h = 48;
  const dots = 576;

  /* A gradient, because a flat colour would agree even with a broken dither. */
  const shade = (x, y) => (x * 255) / w / 2 + (y * 255) / h / 2;

  const rgba = Buffer.alloc(w * h * 4);
  const asBgra = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round(shade(x, y));
      /* Grey, so the channel weights cannot hide a swap; the swap is caught by
         its own test above. */
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
      asBgra[i] = asBgra[i + 1] = asBgra[i + 2] = v;
      asBgra[i + 3] = 255;
    }
  }

  /* The page's copy, driven through jsdom with a canvas that returns RGBA. */
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.PosnicPro = { BRAND_URL: '', local: { get: () => '' } };
  const jq = require('jquery')(win);
  win.$ = jq;
  win.jQuery = jq;
  vm.runInContext(read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'), win);

  const holder = win.document.createElement('div');
  holder.className = 'branch_image';
  holder.style.display = 'block';
  holder.innerHTML = '<img src="logo.png">';
  const modal = win.document.createElement('div');
  modal.className = 'print-modal-body';
  modal.appendChild(holder);
  win.document.body.appendChild(modal);

  const img = holder.querySelector('img');
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'naturalWidth', { value: w });
  Object.defineProperty(img, 'naturalHeight', { value: h });

  const left = Math.floor((dots - w) / 2);
  win.document.createElement = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect() {},
      drawImage() {},
      getImageData: (x, y, gw, gh) => {
        /* The canvas is the full paper width with the logo drawn centred. */
        const data = new Uint8ClampedArray(gw * gh * 4);
        data.fill(255);
        for (let py = 0; py < gh; py++) {
          for (let px = 0; px < gw; px++) {
            const o = (py * gw + px) * 4;
            if (px >= left && px < left + w) {
              const s = ((py * w) + (px - left)) * 4;
              data[o] = rgba[s];
              data[o + 1] = rgba[s + 1];
              data[o + 2] = rgba[s + 2];
            }
            data[o + 3] = 255;
          }
        }
        return { data, width: gw, height: gh };
      },
    }),
  });

  const fromPage = win.PosnicPro.receiptLogo('80');
  assert.ok(fromPage && fromPage.data, 'the page produced nothing to compare');

  const fromMain = pack(asBgra, w, h, dots).toString('base64');

  assert.strictEqual(
    fromMain,
    fromPage.data,
    'the page and the main process dither the same picture differently'
  );
});
