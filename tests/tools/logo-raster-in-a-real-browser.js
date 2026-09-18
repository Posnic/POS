'use strict';

/*
 * THE LOGO, THROUGH A REAL BROWSER.
 *
 * The unit tests for receiptLogo fake the pixels, because jsdom has no canvas:
 * they drive the real Floyd-Steinberg and the real bit packing, but the values
 * going in are invented rather than decoded from an image. That is the honest
 * limit of running a canvas API without a canvas, and it leaves one question
 * open - does this work on a real PNG, in a real browser, with a real decoder?
 *
 * This answers it. Electron is Chromium, the app already depends on it, and a
 * hidden window gives a real canvas and a real image decoder. It loads a page
 * from the running dev server so the image is SAME ORIGIN and the canvas is
 * not tainted, injects the real jQuery and the real receipt-data.js, points an
 * <img> at the shop's actual logo file, and calls PosnicPro.receiptLogo.
 *
 * Then it checks the bitmap against the source rather than against itself:
 *
 *   - the bitmap is the paper's full width and the source's aspect ratio
 *   - it carries ink, and not so much that the whole thing came out black
 *   - the ink is INSIDE the centred box and the margins are clean, which is
 *     the property that a wrong stride or a wrong offset would break first
 *
 * Not part of the CI suite: it needs a display and a running server, and a
 * test that cannot run is worse than one that is not there. Run it when
 * anything touching the raster changes.
 *
 *   node tests/tools/logo-raster-in-a-real-browser.js
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = process.env.POSNIC_DEV_URL || 'http://localhost:3000';
const LOGO = '/static/images/default/store.png';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function jqueryPath() {
  for (const p of [
    ['node_modules', 'jquery', 'dist', 'jquery.js'],
    ['api', 'node_modules', 'jquery', 'dist', 'jquery.js'],
    ['frontend', 'node_modules', 'jquery', 'dist', 'jquery.js'],
  ]) {
    const full = path.join(ROOT, ...p);
    if (fs.existsSync(full)) return full;
  }
  throw new Error('no jquery to inject');
}

/** Everything that happens inside the page, as source, because it must. */
function pageScript(receiptData, logoUrl) {
  return `(async () => {
    window.PosnicPro = {
      BRAND_URL: 'https://www.posnic.com',
      local: { get: () => '' },
    };
    ${receiptData}

    /* The print modal, as the template ships it: the logo block is hidden and
       sales_view.js shows it for a sale. */
    const holder = document.createElement('div');
    holder.className = 'modal-body print-modal-body';
    holder.innerHTML =
      '<div class="branch_image" style="display:block">' +
      '<span class="printlogoimage" id="printlogoimage"><img src="${logoUrl}"></span>' +
      '</div>';
    document.body.appendChild(holder);

    const img = holder.querySelector('img');
    await new Promise((ok, no) => {
      if (img.complete && img.naturalWidth) return ok();
      img.onload = ok;
      img.onerror = () => no(new Error('the logo did not load from ${logoUrl}'));
    });

    const logo = window.PosnicPro.receiptLogo('80');
    return {
      source: { w: img.naturalWidth, h: img.naturalHeight },
      logo: logo ? { width: logo.width, height: logo.height, data: logo.data } : null,
    };
  })()`;
}

/** Where the ink is, per row and per column, from the packed bits. */
function inspect(bitmap) {
  const bytes = Buffer.from(bitmap.data, 'base64');
  const perRow = bitmap.width / 8;
  let ink = 0;
  let firstCol = bitmap.width;
  let lastCol = -1;

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const bit = bytes[y * perRow + (x >> 3)] & (0x80 >> (x & 7));
      if (!bit) continue;
      ink += 1;
      if (x < firstCol) firstCol = x;
      if (x > lastCol) lastCol = x;
    }
  }
  return { bytes: bytes.length, ink, firstCol, lastCol };
}

/** The bitmap as a PBM, which any image viewer opens. Eyes beat assertions. */
function writePbm(bitmap, to) {
  const bytes = Buffer.from(bitmap.data, 'base64');
  const perRow = bitmap.width / 8;
  const rows = [];
  for (let y = 0; y < bitmap.height; y++) {
    const row = [];
    for (let x = 0; x < bitmap.width; x++) {
      row.push(bytes[y * perRow + (x >> 3)] & (0x80 >> (x & 7)) ? '1' : '0');
    }
    rows.push(row.join(' '));
  }
  fs.writeFileSync(to, 'P1\n' + bitmap.width + ' ' + bitmap.height + '\n' + rows.join('\n') + '\n');
}

const fail = [];
const check = (ok, what) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + what);
  if (!ok) fail.push(what);
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  });

  let result;
  try {
    /* Loaded from the server so the image is same-origin and the canvas stays
       readable - a file:// page reading a file:// image taints it. */
    await win.loadURL(SERVER + '/login.html');
    result = await win.webContents.executeJavaScript(
      pageScript(read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'), LOGO)
    );
  } catch (e) {
    console.error('\n  could not run in the browser: ' + e.message);
    console.error('  is the dev server up?  npm run dev   (or set POSNIC_DEV_URL)\n');
    app.exit(1);
    return;
  }

  console.log('\nTHE LOGO, THROUGH A REAL BROWSER\n');
  console.log('  source image : ' + result.source.w + ' x ' + result.source.h + ' px, decoded by Chromium');

  if (!result.logo) {
    console.error('  receiptLogo returned nothing for a visible, loaded image');
    app.exit(1);
    return;
  }

  const b = result.logo;
  const seen = inspect(b);
  const scale = Math.min(576 / result.source.w, 240 / result.source.h, 1);
  const expectW = Math.max(8, Math.round(result.source.w * scale));
  const expectH = Math.max(1, Math.round(result.source.h * scale));
  const left = Math.floor((576 - expectW) / 2);

  console.log('  bitmap       : ' + b.width + ' x ' + b.height + ' dots, ' + seen.bytes + ' bytes');
  console.log('  ink          : ' + seen.ink + ' dots (' +
    ((seen.ink / (b.width * b.height)) * 100).toFixed(1) + '% of the area)');
  console.log('  ink spans    : columns ' + seen.firstCol + '-' + seen.lastCol +
    ', inside the box ' + left + '-' + (left + expectW - 1) + '\n');

  check(b.width === 576, 'the bitmap is the full 80mm paper width, 576 dots');
  check(b.height === expectH, 'the height follows the source aspect ratio (' + expectH + ')');
  check(seen.bytes === (b.width / 8) * b.height, 'the payload is exactly one bit per dot');
  check(seen.ink > 0, 'a real PNG produced real ink, which the faked pixels could not prove');
  check(
    seen.ink < b.width * b.height * 0.9,
    'and not a solid black rectangle, which is what a broken decode looks like'
  );
  check(seen.firstCol >= left, 'no ink left of the centred box (a wrong stride shows up here)');
  check(seen.lastCol < left + expectW, 'no ink right of it either');

  const pbm = path.join(ROOT, 'logo-raster.pbm');
  writePbm(b, pbm);
  console.log('\n  written for eyes: ' + pbm);

  console.log(fail.length ? '\n  ' + fail.length + ' FAILED\n' : '\n  all checks passed\n');
  app.exit(fail.length ? 1 : 0);
});
