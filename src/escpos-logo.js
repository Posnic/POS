'use strict';

/*
 * A logo the PAGE could not read, rasterised where there is no such thing as
 * a cross-origin image.
 *
 * receipt-data.js prepares the logo in the page, which is the right place: the
 * image is already on screen and already decoded, and it costs nothing. But a
 * page can only read pixels back off a canvas it is allowed to read. An image
 * served from another origin without CORS headers TAINTS the canvas, and
 * `getImageData` throws - so a shop whose logo lives somewhere other than the
 * dashboard got a receipt with no logo and a warning in a console nobody
 * opens.
 *
 * The main process has no origin and no canvas. It has `nativeImage`, which is
 * Chromium's decoder without the browser's rules, so the same picture the page
 * was refused is simply a file here. This is the fallback: the page tries
 * first and hands over a `{ src }` when it cannot, and this turns that into
 * dots.
 *
 * The dithering is deliberately the same algorithm as the page's, not a
 * simpler one. Two paths that print the same logo differently is the kind of
 * difference somebody reports as a printer fault.
 */

const DOTS = { 58: 384, 80: 576 };
const MAX_ROWS = 240;

/* Big enough for any shop logo and small enough that a wrong URL cannot pull a
   video down a till's connection. */
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_MS = 4000;

/**
 * The bytes behind a logo reference, whatever kind it is.
 *
 * Three shapes reach here: a data: URL the page inlined, an http(s) URL on the
 * shop's own server or somebody else's, and a plain path for a logo shipped
 * with the app.
 */
async function bytesFor(src, deps) {
  const ref = String(src || '').trim();
  if (!ref) return null;

  if (ref.startsWith('data:')) {
    const at = ref.indexOf(',');
    if (at === -1) return null;
    const body = ref.slice(at + 1);
    return ref.slice(0, at).includes(';base64')
      ? Buffer.from(body, 'base64')
      : Buffer.from(decodeURIComponent(body), 'binary');
  }

  if (/^https?:\/\//i.test(ref)) {
    const buf = await deps.get(ref, { timeout: FETCH_MS, limit: MAX_BYTES });
    return buf && buf.length ? buf : null;
  }

  /* A local file, which is what the bundled default logo is. */
  try {
    const buf = deps.readFile(ref);
    return buf && buf.length ? buf : null;
  } catch (e) {
    return null;
  }
}

/**
 * Floyd-Steinberg, over white, packed one bit per dot and centred on the paper.
 *
 * `pixels` is BGRA, four bytes per pixel, which is what nativeImage.toBitmap
 * gives on every platform Electron currently builds for. The order matters:
 * red and blue carry very different weights in the luminance sum, so reading
 * it as RGBA turns a red logo light and a blue one dark.
 */
/*
 * A QR CODE MUST NOT BE DITHERED.
 *
 * Floyd-Steinberg is right for a logo, which is flat colour with soft
 * edges, and wrong for anything a machine has to read back. Dithering
 * spreads each pixel's error into its neighbours, so an anti-aliased QR
 * module edge comes out speckled and a scanner looking for a clean square
 * finds noise. A shop would blame the printer, or print a thousand
 * receipts nobody can scan.
 */
function pack(pixels, w, h, dots, dither = true) {
  const left = Math.floor((dots - w) / 2);
  const grey = new Float32Array(dots * h);
  grey.fill(255);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = pixels[o + 3] / 255;
      const b = pixels[o] * a + 255 * (1 - a);
      const g = pixels[o + 1] * a + 255 * (1 - a);
      const r = pixels[o + 2] * a + 255 * (1 - a);
      grey[y * dots + left + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  const perRow = dots / 8;
  const out = Buffer.alloc(perRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < dots; x++) {
      const at = y * dots + x;
      const old = grey[at];
      let black = old < 128;
      /* Outside the logo is paper, and paper is never dithered. */
      if (x < left || x >= left + w) black = false;
      if (black) out[y * perRow + (x >> 3)] |= 0x80 >> (x & 7);

      if (!dither) continue;
      const err = old - (black ? 0 : 255);
      if (x + 1 < dots) grey[at + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) grey[at + dots - 1] += (err * 3) / 16;
        grey[at + dots] += (err * 5) / 16;
        if (x + 1 < dots) grey[at + dots + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

/**
 * The logo for one paper width, or null for every reason there might not be one.
 *
 * Never throws. A logo is decoration and a receipt is not: an unreachable URL,
 * a file that is not an image, a decoder that does not recognise it - all of
 * them print the sale without a logo rather than failing the print.
 */
async function rasterFor(src, paperWidth, deps, { dither = true, maxRows = MAX_ROWS } = {}) {
  const dots = DOTS[paperWidth] || DOTS[80];
  try {
    const bytes = await bytesFor(src, deps);
    if (!bytes) return null;

    const image = deps.decode(bytes);
    if (!image || image.isEmpty()) return null;

    const size = image.getSize();
    if (!size.width || !size.height) return null;

    /* Never enlarged, for the same reason as in the page: a small logo blown
       up and then dithered is mud, and a shop reads mud as a broken printer. */
    const scale = Math.min(dots / size.width, maxRows / size.height, 1);
    const w = Math.max(8, Math.round(size.width * scale));
    const h = Math.max(1, Math.round(size.height * scale));

    const fitted = scale < 1 ? image.resize({ width: w, height: h, quality: 'good' }) : image;
    const pixels = fitted.toBitmap();
    const actual = fitted.getSize();
    if (pixels.length < actual.width * actual.height * 4) return null;

    return {
      width: dots,
      height: actual.height,
      data: pack(pixels, actual.width, actual.height, dots, dither).toString('base64'),
    };
  } catch (e) {
    return null;
  }
}

/**
 * The main process, as the rasteriser needs it.
 *
 * Two callers now - the till and the bill queue - and the wiring is the
 * fiddly half: a fetch that NEVER rejects, because a logo is decoration
 * and a receipt is not.
 */
function electronDeps() {
  const { nativeImage, net } = require('electron');
  return {
    decode: (buf) => nativeImage.createFromBuffer(buf),
    readFile: (file) => require('fs').readFileSync(file),
    get: (url, limits) =>
      new Promise((done) => {
        let finished = false;
        const settle = (v) => {
          if (!finished) {
            finished = true;
            done(v);
          }
        };
        const timer = setTimeout(() => settle(null), limits.timeout);
        try {
          const req = net.request(url);
          const chunks = [];
          let size = 0;
          req.on('response', (res) => {
            res.on('data', (c) => {
              size += c.length;
              if (size > limits.limit) {
                req.abort();
                settle(null);
                return;
              }
              chunks.push(c);
            });
            res.on('end', () => {
              clearTimeout(timer);
              settle(Buffer.concat(chunks));
            });
            res.on('error', () => {
              clearTimeout(timer);
              settle(null);
            });
          });
          req.on('error', () => {
            clearTimeout(timer);
            settle(null);
          });
          req.end();
        } catch (e) {
          clearTimeout(timer);
          settle(null);
        }
      }),
  };
}

/**
 * A `{ src }` picture on a sale, turned into dots. Anything else is left
 * exactly as it is - already rasterised, or not there.
 */
async function resolvePictures(sale, paperWidth) {
  const out = { ...(sale || {}) };
  const deps = electronDeps();
  for (const [field, dither] of [
    ['logo', true],
    ['footerImage', false],
  ]) {
    const asked = out[field];
    if (!asked || asked.data || !asked.src) continue;
    /* eslint-disable-next-line no-await-in-loop -- two at most, and a
       printer is a serial device anyway. */
    out[field] = await rasterFor(asked.src, paperWidth, deps, { dither });
  }
  return out;
}

module.exports = { rasterFor, pack, bytesFor, electronDeps, resolvePictures, DOTS, MAX_ROWS, MAX_BYTES };
