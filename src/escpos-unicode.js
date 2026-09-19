'use strict';

const fs = require('fs');
const path = require('path');
const { Receipt, renderSale, COLUMNS } = require('./escpos-receipt');
const { DOTS, pack } = require('./escpos-logo');
const { hardenPrintWindow } = require('./print-window-guard');
const { fontsFor, family, cssFor } = require('./receipt-fonts');

// A code page cannot restore letters removed by the ASCII receipt renderer.
// Shape Unicode with Chromium and send dots through the existing raw spooler.
// The downloaded euro glyph remains available on otherwise ASCII receipts.
const UNICODE = /[^\x00-\x7f\u20ac]/u;
const STRIP_ROWS = 256;
const MAX_ROWS = 48000;

function needsRaster(sale) {
  const { logo, footerImage, ...text } = sale || {};
  return UNICODE.test(JSON.stringify(text));
}

function escape(value) {
  return String(value == null ? '' : value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The adapter receives the same content as Receipt, before any ASCII conversion.
// Each cell gets its own bidi context so RTL names cannot reorder amounts.
class GraphicReceipt {
  constructor(paper) {
    this.paper = paper;
    this.width = COLUMNS[paper];
    this.parts = [];
    this.pictures = [];
    this.weight = false;
    this.heightScale = 1;
    this.widthScale = 1;
    this.alignment = 0;
  }
  style() {
    return `font-weight:${this.weight ? 700 : 400};font-size:${24 * Math.max(this.heightScale, this.widthScale)}px;`;
  }
  bold(value) { this.weight = value; return this; }
  size(w = 0, h = 0) { this.widthScale = w + 1; this.heightScale = h + 1; return this; }
  align(n) { this.alignment = n; return this; }
  line(value = '') {
    this.parts.push(`<div class="line" style="${this.style()}text-align:${['left', 'center', 'right'][this.alignment] || 'left'}"><span dir="auto">${escape(value) || '&nbsp;'}</span></div>`);
    return this;
  }
  centre(value, { bold = false, size = 0 } = {}) {
    const previous = [this.weight, this.widthScale, this.heightScale, this.alignment];
    this.bold(bold).size(size, size).align(1).line(value);
    [this.weight, this.widthScale, this.heightScale, this.alignment] = previous;
    return this;
  }
  centreWrapped(value) { return this.centre(value); }
  rule(ch = '-') { this.parts.push(`<hr${ch === '=' ? ' class="heavy"' : ''}>`); return this; }
  feed(n = 1) { this.parts.push(`<div style="height:${n * 24}px"></div>`); return this; }
  pair(left, right, { bold = false } = {}) {
    this.parts.push(`<div class="pair" style="${this.style()}${bold ? 'font-weight:700;' : ''}"><div dir="auto">${escape(left)}</div><div dir="auto">${escape(right)}</div></div>`);
    return this;
  }
  pairAtColumn(left, right) { return this.pair(left, right); }
  serviceGrid(rows) {
    for (const row of rows || []) if (row && row.label) this.pair(row.label, row.value);
    return this;
  }
  itemTable(rows, header) {
    const rate = rows.some(row => row.rate != null && row.rate !== '');
    const hsn = rows.some(row => row.hsn != null && row.hsn !== '');
    // Names always have a full row. Rates, units and totals remain aligned on
    // the row below, even on 58mm paper or with long mixed-language names.
    const keys = [...(hsn ? ['hsn'] : []), ...(rate ? ['rate'] : []), 'qty', 'amount'];
    const cells = (row, tag) => keys.map(key => `<${tag} dir="auto">${escape(row[key])}</${tag}>`).join('');
    this.parts.push(`<table><thead><tr><th colspan="${keys.length}" class="name">${escape(header.name)}</th></tr><tr>${cells(header, 'th')}</tr></thead><tbody>`);
    for (const row of rows) {
      this.parts.push(`<tr><td colspan="${keys.length}" class="name"><div dir="auto">${escape(row.name)}</div></td></tr><tr>${cells(row, 'td')}</tr>`);
    }
    this.parts.push('</tbody></table>');
    // The table owns its header border.
    return this;
  }
  raster(picture) {
    if (!picture || !picture.data) return this;
    const { width, height } = picture;
    if (!Number.isInteger(width) || width <= 0 || width > DOTS[this.paper] || width % 8 ||
        !Number.isInteger(height) || height <= 0 || height > MAX_ROWS) return this;
    if (Buffer.from(picture.data, 'base64').length !== width / 8 * height) return this;
    const index = this.pictures.push({ width, height, data: picture.data }) - 1;
    this.parts.push(`<canvas data-picture="${index}" width="${width}" height="${height}"></canvas>`);
    return this;
  }
  // These are emitted after rasterisation, never drawn or executed as HTML.
  raw() { return this; }
  cut() { return this; }
  openDrawer() { return this; }
  build() { return { body: this.parts.join(''), pictures: this.pictures }; }
}

function layout(sale, options = {}) {
  const paper = options.paperWidth === '58' ? '58' : '80';
  const result = renderSale(sale, { ...options, symbolGlyphs: false }, new GraphicReceipt(paper));
  return { ...result, width: DOTS[paper], paper };
}

function documentFor(plan) {
  const selectedFonts = fontsFor(plan.body);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src file:; script-src 'none'">
<style>
${cssFor(selectedFonts)}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:${plan.width}px;background:#fff;color:#000;overflow:hidden;}
#receipt{display:flow-root;width:${plan.width}px;font:24px/1.55 ${selectedFonts.map(family).join(',')},sans-serif;padding:2px 0;}
.line{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;}
.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start;}
.pair>div{white-space:pre-wrap;overflow-wrap:anywhere;}.pair>div:last-child{text-align:right;}
hr{border:0;border-top:2px solid #000;margin:6px 0;}hr.heavy{border-top:4px double #000;}
table{border-collapse:collapse;width:100%;table-layout:fixed;font:inherit;}
th,td{text-align:right;vertical-align:top;overflow-wrap:anywhere;padding:2px 4px;}
thead{border-bottom:2px solid #000;}th{font-size:20px;}td.name{padding-top:8px;font-weight:600;}
.name{text-align:left;}td.name>div{text-align:start;}canvas{display:block;margin:0 auto;}
</style></head><body><main id="receipt">${plan.body}</main></body></html>`;
}

async function loadDocument(win, plan) {
  const { app } = require('electron');
  // Keep the document small and load fonts directly from the application.
  // Inlining several fonts exceeds Chromium's data-URL navigation limit.
  const directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'posnic-receipt-'));
  try {
    const file = path.join(directory, 'receipt.html');
    fs.writeFileSync(file, documentFor(plan), { mode: 0o600, flag: 'wx' });
    await win.loadFile(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function rasterize(plan) {
  const { BrowserWindow } = require('electron');
  const win = hardenPrintWindow(new BrowserWindow({
    show: false, useContentSize: true, width: plan.width, height: STRIP_ROWS,
    backgroundColor: '#ffffff',
    // Offscreen rendering keeps frame callbacks running even when the till is
    // minimised or this is the application's first (hidden) window.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  }));
  let timer;
  let stage = 'loading the receipt';
  try {
    return await Promise.race([
      (async () => {
        await loadDocument(win, plan);
        win.webContents.setZoomFactor(1);
        stage = 'loading fonts';
        const height = await win.webContents.executeJavaScript(`(async () => {
          const families = ${JSON.stringify(fontsFor(plan.body).map(family))};
          const fonts = (await Promise.all(families.map(name => document.fonts.load('24px ' + name)))).flat();
          await document.fonts.ready;
          if (fonts.length < families.length || fonts.some(font => font.status !== 'loaded')) throw new Error('Receipt font did not load');
          const pictures = ${JSON.stringify(plan.pictures)};
          for (const canvas of document.querySelectorAll('canvas')) {
            const picture = pictures[Number(canvas.dataset.picture)];
            const bytes = atob(picture.data), ctx = canvas.getContext('2d');
            const pixels = ctx.createImageData(picture.width, picture.height);
            for (let y = 0; y < picture.height; y++) for (let x = 0; x < picture.width; x++) {
              const black = bytes.charCodeAt(y * picture.width / 8 + (x >> 3)) & (0x80 >> (x & 7));
              const at = (y * picture.width + x) * 4;
              pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = black ? 0 : 255;
              pixels.data[at + 3] = 255;
            }
            ctx.putImageData(pixels, 0, 0);
          }
          return Math.ceil(document.querySelector('#receipt').getBoundingClientRect().height);
        })()`);
        if (!Number.isFinite(height) || height < 1 || height > MAX_ROWS) throw new Error('Receipt exceeds the supported print length');
        const strips = [];
        for (let y = 0; y < height; y += STRIP_ROWS) {
          stage = `drawing receipt row ${y}`;
          const rows = Math.min(STRIP_ROWS, height - y);
          await win.webContents.executeJavaScript(`new Promise(resolve => {
            document.querySelector('#receipt').style.transform = 'translateY(-${y}px)';
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          })`);
          stage = `capturing receipt row ${y}`;
          let capture = await win.webContents.capturePage({ x: 0, y: 0, width: plan.width, height: rows }, { stayHidden: true, stayAwake: true });
          if (capture.isEmpty()) throw new Error('Could not render Unicode receipt');
          // Desktop display scaling must never change the number of printer dots.
          capture = capture.resize({ width: plan.width, height: rows, quality: 'best' });
          strips.push({ width: plan.width, height: rows,
            data: pack(capture.toBitmap(), plan.width, rows, plan.width, false).toString('base64') });
        }
        return strips;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Receipt rendering timed out while ' + stage)), 30000); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

async function renderReceipt(sale, options = {}, render = rasterize) {
  if (!needsRaster(sale)) return renderSale(sale, options);
  const plan = layout(sale, options);
  const strips = await render(plan);
  const receipt = new Receipt(plan.paper, { glyphs: false });
  for (const strip of strips) receipt.raster(strip);
  if (options.openDrawer) receipt.openDrawer(options.drawerPin);
  if (options.cut !== false) receipt.cut();
  return receipt.build();
}

module.exports = { renderReceipt, needsRaster, layout, documentFor, loadDocument, rasterize };
