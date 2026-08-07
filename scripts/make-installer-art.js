#!/usr/bin/env node
/*
 * The installer's welcome sidebar and page header.
 *
 * NSIS takes these as uncompressed BMP and nothing else, and electron-builder
 * falls back to a stock NSIS graphic when they are absent - which is why the
 * installer looked like every other installer. The first thing a shop sees of
 * this product is the setup wizard, and a generic one does not say much for
 * what follows.
 *
 * Built rather than checked in as binaries: the artwork is derived from the
 * logo and the brand colour, so it can be regenerated when either changes
 * instead of being an opaque blob nobody dares touch. Run `npm run art`.
 *
 * sharp cannot write BMP, so the pipeline is SVG -> sharp -> raw RGB -> a BMP
 * header written by hand. BMP is simple enough that this is less trouble than
 * adding a dependency for it: 24-bit, bottom-up, rows padded to four bytes.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'builds');
/* The mark on its own. 512-posnic.png includes the wordmark, so using it beside
   a "Posnic" caption prints the name twice. */
const LOGO = path.join(ROOT, 'builds', 'icon-256.png');

/* The brand blue used through the application, and a darker tone of it to give
   the panel some depth without turning it into a gradient soup. */
/* Sampled from builds/icon-256.png rather than picked by eye - the mark is
   #1B81DF, hue 209 at 78% saturation. BRAND_DEEP is the same hue and
   saturation at lower lightness, so the panel reads as one colour in shadow. */
const BRAND = '#1B81DF';
const BRAND_DEEP = '#0C3A64';
const INK = '#092A49';

/**
 * Write 24-bit uncompressed BMP.
 *
 * Rows run bottom to top and each is padded to a four-byte boundary; getting
 * either wrong produces an image NSIS renders as diagonal noise, which is a
 * memorable way to find out.
 */
function writeBmp(file, rgb, width, height) {
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const pixelBytes = (rowBytes + padding) * height;
  const offset = 54;

  const header = Buffer.alloc(offset);
  header.write('BM', 0);
  header.writeUInt32LE(offset + pixelBytes, 2);
  header.writeUInt32LE(offset, 10);
  header.writeUInt32LE(40, 14); // DIB header size
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26); // planes
  header.writeUInt16LE(24, 28); // bits per pixel
  header.writeUInt32LE(pixelBytes, 34);
  header.writeInt32LE(2835, 38); // 72 dpi
  header.writeInt32LE(2835, 42);

  const pixels = Buffer.alloc(pixelBytes);
  let out = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      /* BMP stores blue, green, red - the reverse of what sharp hands over. */
      pixels[out++] = rgb[i + 2];
      pixels[out++] = rgb[i + 1];
      pixels[out++] = rgb[i];
    }
    out += padding;
  }

  fs.writeFileSync(file, Buffer.concat([header, pixels]));
  return pixelBytes + offset;
}

async function render(svg, width, height, file) {
  const { data } = await sharp(Buffer.from(svg))
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bytes = writeBmp(path.join(OUT, file), data, width, height);
  console.log(`  ${file.padEnd(24)} ${width}x${height}  ${(bytes / 1024).toFixed(0)} KB`);
}

async function main() {
  const logo = fs.existsSync(LOGO)
    ? `data:image/png;base64,${fs.readFileSync(LOGO).toString('base64')}`
    : null;

  /*
   * The sidebar, shown beside the welcome and finish pages. 164x314 is what
   * MUI2 expects; anything else is stretched.
   *
   * Deliberately quiet: a deep field, the mark, the name, and one line saying
   * what the thing is. An installer panel is read for two seconds.
   */
  const sidebar = `
<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="${BRAND}"/>
      <stop offset="100%" stop-color="${BRAND_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>

  <!-- A few soft shapes, low contrast, so the panel is not a flat rectangle. -->
  <circle cx="16" cy="34" r="52" fill="#FFFFFF" opacity="0.06"/>
  <circle cx="150" cy="252" r="66" fill="#FFFFFF" opacity="0.05"/>
  <rect x="0" y="306" width="164" height="8" fill="#FFFFFF" opacity="0.12"/>

  <!-- The mark is brand blue on transparent, so it needs a light plate to sit
       on rather than disappearing into the panel. -->
  <rect x="49" y="66" width="66" height="66" rx="16" fill="#FFFFFF" opacity="0.94"/>
  ${logo ? `<image href="${logo}" x="57" y="74" width="50" height="50"/>` : ''}

  <text x="82" y="162" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="22" font-weight="600" fill="#FFFFFF" letter-spacing="0.4">Posnic</text>
  <text x="82" y="182" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="10.5" fill="#FFFFFF" opacity="0.85">Point of Sale</text>

  <rect x="60" y="200" width="44" height="1.6" fill="#FFFFFF" opacity="0.4"/>

  <text x="82" y="230" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="9.5" fill="#FFFFFF" opacity="0.8">Works without internet</text>
  <text x="82" y="248" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="9.5" fill="#FFFFFF" opacity="0.8">Your data stays here</text>
  <text x="82" y="266" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="9.5" fill="#FFFFFF" opacity="0.8">Free and open source</text>
</svg>`;

  /*
   * The header strip on every page after the welcome. 150x57, white so it sits
   * against the wizard chrome rather than fighting it.
   */
  const header = `
<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#FFFFFF"/>
  ${logo ? `<image href="${logo}" x="12" y="12" width="33" height="33"/>` : ''}
  <text x="54" y="30" font-family="Segoe UI, Arial, sans-serif" font-size="15"
        font-weight="600" fill="${INK}">Posnic</text>
  <text x="54" y="43" font-family="Segoe UI, Arial, sans-serif" font-size="8.5"
        fill="${BRAND}">Point of Sale</text>
  <rect x="0" y="55" width="150" height="2" fill="${BRAND}"/>
</svg>`;

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  if (!logo) console.warn('  builds/icon-256.png missing - drawing without the mark');

  console.log('Installer artwork:');
  await render(sidebar, 164, 314, 'installerSidebar.bmp');
  await render(sidebar, 164, 314, 'uninstallerSidebar.bmp');
  await render(header, 150, 57, 'installerHeader.bmp');
}

main().catch((e) => {
  console.error('Could not build the installer artwork:', e.message);
  process.exit(1);
});
